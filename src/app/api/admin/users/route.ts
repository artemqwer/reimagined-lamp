import { isPlatformAdmin } from "@/lib/authz";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { listAllUsers, makeAvatarColor } from "@/lib/supabase-admin";
import { connectedConnectorsFrom, getConnector, type ConnectorId } from "@/lib/connectors";

export type Plan = "Free" | "Professional" | "Business" | "Enterprise";
export type SubStatus = "Active" | "Trial" | "Expired";

export const PLAN_PRICE: Record<Plan, number> = {
  Free: 0,
  Professional: 199,
  Business: 349,
  Enterprise: 499,
};
const PLANS: Plan[] = ["Professional", "Business", "Enterprise", "Professional"];
const STATUSES: SubStatus[] = ["Active", "Active", "Active", "Trial", "Expired"];

export interface AdminUser {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  avatarUrl: string | null;
  email: string;
  phone: string;
  company: string;
  plan: Plan;
  status: SubStatus;
  expiry: string | null; // ISO date
  expiryLabel: string; // "Expired" | "4 days left" | "Mar 10, 2026"
  expiryState: "expired" | "soon" | "ok" | "none";
  revenueMonthly: number;
  revenueTotal: number;
  lastLogin: string;
  lastLoginMins: number;
  registered: string;
  registeredMs: number;
  isAdmin: boolean;
  /** The sources this user has actually connected — so "View as Client" can show
   *  the client's own platform list, not the admin's. */
  connectors: ConnectorId[];
  /** Real connected-channel detail for the user's admin card: one per connected
   *  source, with the bound Windsor account name (the placeholder cards these
   *  replaced showed a fake account@example.com for platforms no one had). */
  channels: { id: ConnectorId; label: string; account: string }[];
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return Math.abs(h);
}
function makeInitials(name: string) {
  return (
    name
      .split(" ")
      .map((w) => w[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "??"
  );
}
function parseLogin(iso: string | null | undefined): { label: string; mins: number } {
  if (!iso) return { label: "Never", mins: 9_999_999 };
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return { label: `${mins} min ago`, mins };
  if (mins < 1440) return { label: `${Math.floor(mins / 60)}h ago`, mins };
  const days = Math.floor(mins / 1440);
  return { label: `${days} day${days > 1 ? "s" : ""} ago`, mins };
}
const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

async function requireAdmin() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        // Writing back a refreshed token is what stops the session dying.
        // Without this the server refreshes the access token, drops the new
        // cookies on the floor, and the browser keeps presenting the old
        // refresh token — which Supabase then rejects as already used. Ten
        // parallel requests turn that into a burst of 401s and a logout.
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) cookieStore.set(name, value, options);
          } catch {
            // Called from somewhere cookies can't be written (a render rather
            // than a route handler). The request still works; the refresh just
            // isn't persisted from here.
          }
        },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isPlatformAdmin(user)) return null;
  return user;
}

export async function GET() {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 503 },
    );
  }

  const users = await listAllUsers();
  const now = Date.now();

  const mapped: AdminUser[] = users.map((u) => {
    const m = u.user_metadata ?? {};
    const name =
      (m.full_name as string) || (m.name as string) || u.email?.split("@")[0] || "Unknown";
    const h = hash(u.id);
    const registeredMs = new Date(u.created_at).getTime();

    // Subscription fields come from metadata when set, otherwise deterministic
    // defaults derived from the user id (so the panel is populated & stable).
    // Validate against known values — metadata may carry plans/statuses this
    // panel doesn't know about (e.g. "Starter"), which must not break rendering.
    let plan = (m.plan as Plan) || PLANS[h % PLANS.length];
    if (PLAN_PRICE[plan] === undefined) plan = PLANS[h % PLANS.length];
    let status = (m.subscription_status as SubStatus) || STATUSES[(h >> 3) % STATUSES.length];
    if (status !== "Active" && status !== "Trial" && status !== "Expired") status = "Active";
    const expiryMs = m.subscription_expiry
      ? new Date(m.subscription_expiry as string).getTime()
      : registeredMs + (6 + (h % 14)) * 30 * 86_400_000;

    const daysLeft = Math.round((expiryMs - now) / 86_400_000);
    const expiryState: AdminUser["expiryState"] =
      daysLeft < 0 ? "expired" : daysLeft <= 14 ? "soon" : "ok";
    const expiryLabel =
      daysLeft < 0
        ? "Expired"
        : daysLeft <= 14
          ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
          : fmtDate(expiryMs);

    const revenueMonthly = status === "Active" ? (PLAN_PRICE[plan] ?? 0) : 0;
    const months = Math.max(1, Math.round((now - registeredMs) / (30 * 86_400_000)));
    const revenueTotal = revenueMonthly * months;

    const login = parseLogin(u.last_sign_in_at);

    return {
      id: u.id,
      name,
      initials: makeInitials(name),
      avatarColor: makeAvatarColor(u.id),
      avatarUrl: (m.avatar_url as string | undefined) ?? (m.picture as string | undefined) ?? null,
      email: u.email ?? "",
      phone: (m.phone as string) ?? "",
      company: (m.company as string) ?? "",
      plan,
      status,
      expiry: new Date(expiryMs).toISOString().slice(0, 10),
      expiryLabel,
      expiryState,
      revenueMonthly,
      revenueTotal,
      lastLogin: login.label,
      lastLoginMins: login.mins,
      registered: fmtDate(registeredMs),
      registeredMs,
      isAdmin: isPlatformAdmin(u),
      connectors: connectedConnectorsFrom(u),
      channels: connectedConnectorsFrom(u).map((id) => {
        const ds = getConnector(id).windsorSource;
        const bound = (
          (u.app_metadata?.windsor_accounts ?? {}) as Record<
            string,
            { account_id?: string; account_name?: string }
          >
        )[ds];
        const account =
          bound?.account_name ||
          bound?.account_id ||
          (id === "google_ads" ? (u.app_metadata?.windsor_account_name as string) : "") ||
          (id === "google_ads" ? (u.app_metadata?.windsor_account_id as string) : "") ||
          "—";
        return { id, label: getConnector(id).label, account };
      }),
    };
  });

  return NextResponse.json({ users: mapped });
}
