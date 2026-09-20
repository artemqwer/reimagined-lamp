import { isPlatformAdmin, windsorApiKeyOf } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  windsorAccountIdFor,
  normalizeAccountId,
  getConnector,
  ensureCustomConnectorsLoaded,
  DEFAULT_CONNECTOR,
} from "@/lib/connectors";
import { scoreHealthAxes, overallHealth, type HealthRow } from "@/lib/accountHealth";
import { checkDateRange, checkConnector } from "@/lib/requestGuards";

export const maxDuration = 120;

// The account-health radar's data: how the account is SET UP, which is a
// different question from how it performed, and needs fields the dashboard
// never asked for — lost impression share, ad strength, bidding strategy,
// asset presence.
//
// Each entry below is one Windsor request. They are separate requests because
// Windsor refuses to serve some of these field sets together (the underlying
// Google Ads views cannot be joined), and they run in parallel so the whole
// set costs about as long as its slowest member rather than the sum. A set
// that fails is left empty and its axis reports that it could not be judged —
// one unavailable view must not take the other seven down with it.
const FIELD_SETS = {
  delivery:
    "campaign,cost,conversions,campaign_budget,search_budget_lost_impression_share,search_rank_lost_impression_share,bidding_strategy_type",
  ads: "campaign,ad_strength,impressions,cost",
  // No ad_id: this view returns one ad per ad group however wide the window,
  // so it reports what served rather than what exists. See scoreStructure.
  structure: "campaign,ad_group,cost",
  targeting: "campaign,device,cost,conversions",
  tracking: "campaign,conversion_action,conversions",
  extensions: "campaign,asset_type,cost,impressions",
  // `keyword_text`, NOT `keyword`: Windsor's `keyword` is a Keyword Planner
  // field and refuses every request without a planner seed, which is why this
  // axis reported "no keyword data" on an account with 53 of them. `spend`
  // rather than `cost` — the keyword view rejects the cost family.
  keywords: "campaign,keyword_text,spend,conversions",
} as const;

type SetName = keyof typeof FIELD_SETS;

// Whether each entity is actually running. Not a health axis — it is the badge
// beside the name, which said "Active" for every campaign including the paused
// ones because nothing had ever asked.
const STATUS_FIELDS = "campaign,campaign_status,cost";

export async function GET(request: NextRequest) {
  await ensureCustomConnectorsLoaded();
  const { searchParams } = new URL(request.url);
  // The setup axes are off by default and the page no longer asks for them.
  //
  // Settings differ per platform and none of them are in the approved tables,
  // so a radar built on them says something new every time a source is added —
  // and there is nothing on screen to check it against. The tables ARE agreed
  // at setup, so the analysis and the remaining radar stand on them instead.
  // The scoring is kept, and tested, for when a settings view is worth having.
  const wantAxes = searchParams.get("axes") === "1";
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const connector = searchParams.get("connector") ?? DEFAULT_CONNECTOR;
  const campaign = searchParams.get("campaign")?.trim() || null;

  const range = checkDateRange(dateFrom, dateTo);
  if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 });
  const known = checkConnector(connector);
  if (!known.ok) return NextResponse.json({ error: known.error }, { status: 400 });

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // See the note in lib/supabase-route: without setAll a refreshed token
        // is discarded and the session dies on the next burst of requests.
        setAll(list) {
          try {
            for (const { name, value, options } of list) cookieStore.set(name, value, options);
          } catch {
            /* not a route handler — nothing to persist to */
          }
        },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // "View as Client": read the target's connection so the health score reflects
  // the client, like the rest of the optimizer. Same authorisation as the data
  // routes (admin, or same team).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let targetAppMeta: any = user.app_metadata;
  const viewAs = searchParams.get("view_as");
  if (viewAs && viewAs !== user.id && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const {
      data: { user: target },
    } = await admin.auth.admin.getUserById(viewAs);
    if (target) {
      const targetTeamId = target.user_metadata?.team_id as string | undefined;
      // Authorize view_as ONLY on values the caller cannot forge (see the note in
      // /api/windsor): the removed myTeamId clauses trusted the caller's own
      // user_metadata.team_id, which any user can rewrite to a victim's id.
      const authorized = isPlatformAdmin(user) || targetTeamId === user.id;
      if (authorized) {
        targetAppMeta = target.app_metadata;
      }
    }
  }

  // Same account scoping rule as /api/windsor, for the same reason: the shared
  // workspace key may only be used together with the user's own server-bound
  // account, or a user who connected nothing would read the whole workspace.
  const accountId = windsorAccountIdFor(targetAppMeta, connector);
  let windsorKey: string | undefined = windsorApiKeyOf({ app_metadata: targetAppMeta });
  if (!windsorKey && accountId) windsorKey = process.env.WINDSOR_API_KEY;
  if (!windsorKey) return NextResponse.json({ error: "No data source connected" }, { status: 503 });

  const endpoint = getConnector(connector).windsorSource;
  const toDashed = (s: string) => {
    const d = s.replace(/\D/g, "");
    return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : s;
  };

  // null means the request failed; an empty array means the view answered and
  // had nothing. Only the second licenses a statement about the account.
  const fetchFields = async (fields: string, scoped = true): Promise<HealthRow[] | null> => {
    const p = new URLSearchParams({
      api_key: windsorKey!,
      date_from: range.from,
      date_to: range.to,
      // Request account_id on every row so we can enforce isolation below. The
      // &account_id= query param is IGNORED by Windsor (verified — it returns the
      // whole workspace for any value), so the real scoping is the row filter.
      fields: accountId ? `${fields},account_id` : fields,
    });
    if (accountId) p.set("account_id", toDashed(accountId));
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(`https://connectors.windsor.ai/${endpoint}?${p}`, {
        signal: ctrl.signal,
      });
      // A 400 is Windsor refusing the field combination — this account has no
      // such view, which is an answer. Anything else is a failure to ask.
      if (res.status === 400) return [];
      if (!res.ok) return null;
      const json = await res.json();
      let rows: HealthRow[] = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
          ? json
          : [];
      // STRICT account isolation (same as /api/windsor): Windsor ignores the
      // server filter and returns the whole workspace, so keep ONLY the connected
      // account's rows. Without this the health scan leaks other accounts'
      // campaigns into a client's optimizer. account_id is requested in fields
      // above, so every row carries it.
      if (accountId) {
        const want = normalizeAccountId(accountId);
        rows = rows.filter((r) => {
          const rr = r as Record<string, unknown>;
          return (
            normalizeAccountId(
              String(
                rr.account_id ?? rr.accountid ?? rr.customer_id ?? rr.external_account_id ?? "",
              ),
            ) === want
          );
        });
      }
      // Viewing one campaign narrows every axis to it, so the radar on a
      // campaign page describes that campaign and not the account around it.
      // The status map is the exception: the list on the account page needs a
      // status for every entity, not just the open one.
      return scoped && campaign ? rows.filter((r) => String(r.campaign ?? "") === campaign) : rows;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // One retry for a view that failed.
  //
  // Windsor computes each field combination the first time anyone asks for it,
  // and a cold one can outrun the timeout — the first person to open a new
  // account lost an axis to it. The work is cached by then, so the second ask
  // is the fast path rather than the same wait again.
  const withRetry = async (fields: string, scoped = true) => {
    const first = await fetchFields(fields, scoped);
    return first ?? (await fetchFields(fields, scoped));
  };

  const names = (wantAxes ? Object.keys(FIELD_SETS) : []) as SetName[];
  const [results, statusRows] = await Promise.all([
    Promise.all(names.map((n) => withRetry(FIELD_SETS[n]))),
    withRetry(STATUS_FIELDS, false),
  ]);
  const unreadable = new Set<SetName>(names.filter((_, i) => results[i] === null));
  const input = Object.fromEntries(names.map((n, i) => [n, results[i] ?? []])) as Record<
    SetName,
    HealthRow[]
  >;

  // One status per entity. A campaign appears on many rows and Google reports
  // the same status on each, so last-write-wins is the same as first.
  const statuses: Record<string, string> = {};
  for (const r of statusRows ?? []) {
    const name = String(r.campaign ?? "").trim();
    const st = String(r.campaign_status ?? "").trim();
    if (name && st) statuses[name] = st;
  }

  const axes = wantAxes ? scoreHealthAxes(input, unreadable) : [];
  return NextResponse.json({
    axes,
    statuses,
    overall: overallHealth(axes),
    // What each view answered — a row count, or null where the read failed.
    views: Object.fromEntries(names.map((n, i) => [n, results[i]?.length ?? null])),
  });
}
