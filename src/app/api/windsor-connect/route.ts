import { isPlatformAdmin } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { CONNECTORS, ensureCustomConnectorsLoaded, normalizeAccountId } from "@/lib/connectors";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getAuthUser(): Promise<any | null> {
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
  return user;
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Windsor "Authorize via Link" (co-user) bridge — now per data source.
//
// One central Windsor account holds every client's connected accounts (up to the
// plan limit). A user authorizes THEIR account into it via a one-time link and
// only ever sees their own — isolation is by the token-diff below, per source.
//
//   ?ds=<source>       → which Windsor data source: google_ads (default),
//                        googleanalytics4, facebook, shopify. Every action is
//                        scoped to it, so GA4 / Meta / Shopify work exactly like
//                        Google Ads always has.
//   ?action=link       → generate a co-user authorization URL for `ds` and
//                        snapshot the link tokens that already exist. Returns { url }.
//   ?action=accounts   → the account(s) that appeared AFTER the snapshot — i.e.
//                        the one(s) THIS user just authorized for `ds`.
//   ?action=save       → bind one of those accounts to the user (server-validated).
//   ?action=disconnect → unbind `ds`.
//   ?action=workspace-accounts / admin-set → admin listing / assignment for `ds`.
//   add &debug=1       → include the raw Windsor response.
//
// Per-source state lives in app_metadata (tamper-proof):
//   windsor_accounts: { [ds]: { account_id, account_name } }
//   windsor_pending:  { [ds]: { known: string[], at: number } }
// google_ads also keeps the legacy windsor_account_id/_name fields so the older
// data path keeps working unchanged.
// ─────────────────────────────────────────────────────────────────────────────

export const maxDuration = 30;
const ONBOARD = "https://onboard.windsor.ai/api";

/** Windsor data-source slugs connectable as co-user connections: whatever the
 *  live connector registry declares, so a source added from the Admin Panel is
 *  connectable the moment it exists. A fixed list here meant a new source
 *  showed up on the Data Sources page and then refused to connect with
 *  "Unsupported data source". */
async function allowedDataSources(): Promise<Set<string>> {
  await ensureCustomConnectorsLoaded();
  return new Set(Object.values(CONNECTORS).map((c) => c.windsorSource));
}
const DEFAULT_DS = "google_ads";

type Account = { account_id: string; account_name: string };
type Link = { token: string; revoked: boolean; accounts: Account[] };

function firstUrl(s: string): string | null {
  const m = /https?:\/\/[^\s"'\\]+/.exec(s);
  return m ? m[0] : null;
}

async function onboardFetch(path: string, key: string): Promise<{ res: Response; text: string }> {
  const sep = path.includes("?") ? "&" : "?";
  const withKey = `${ONBOARD}${path}${sep}api_key=${encodeURIComponent(key)}`;
  const res = await fetch(withKey, { signal: AbortSignal.timeout(25_000) });
  return { res, text: await res.text() };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// co-user-linked-accounts returns: [{ link: { access_token, revoked_at, … },
// accounts: [{ account_id, account_name }] }]. Parse into per-link groups,
// dropping deactivated accounts. Falls back to a generic walk for the ds-accounts
// shape (a flat account list, no links).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseLinks(data: any): Link[] {
  if (
    Array.isArray(data) &&
    data.some((e) => e && typeof e === "object" && ("link" in e || "accounts" in e))
  ) {
    return data.map((entry) => {
      const link = entry?.link ?? {};
      const token = String(link.access_token ?? link.token ?? "");
      const revoked = link.revoked_at != null && link.revoked_at !== "";
      const accounts: Account[] = Array.isArray(entry?.accounts)
        ? entry.accounts
            .filter(
              (a: Record<string, unknown>) =>
                a && (a.deactivated_at == null || a.deactivated_at === ""),
            )
            .map((a: Record<string, unknown>) => ({
              account_id: String(a.account_id ?? a.id ?? ""),
              account_name: String(a.account_name ?? a.name ?? a.account_id ?? ""),
            }))
            .filter((a: Account) => a.account_id)
        : [];
      return { token, revoked, accounts };
    });
  }
  // ds-accounts (flat) — wrap as a single tokenless link.
  const out: Account[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === "object") {
      const id = node.account_id ?? node.id ?? node.customer_id;
      if (id != null && String(id).trim() !== "") {
        out.push({
          account_id: String(id),
          account_name: String(node.account_name ?? node.name ?? id),
        });
      }
      Object.values(node).forEach(walk);
    }
  };
  walk(data);
  return [{ token: "", revoked: false, accounts: out }];
}

function dedupe(accs: Account[]): Account[] {
  const seen = new Set<string>();
  return accs.filter((a) => {
    const k = normalizeAccountId(a.account_id);
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

// Co-user links (each with its access token) — the source for per-user isolation.
async function coUserLinks(
  key: string,
  ds: string,
): Promise<{ links: Link[]; raw: string; ok: boolean }> {
  const { res, text } = await onboardFetch(
    `/team/co-user-linked-accounts/?ds_id=${encodeURIComponent(ds)}`,
    key,
  );
  return { links: res.ok ? parseLinks(parse(text)) : [], raw: res.ok ? text : "", ok: res.ok };
}

// Every account of this source connected to the workspace (admin-only listing).
async function workspaceAccounts(key: string, ds: string): Promise<Account[]> {
  const { res, text } = await onboardFetch(
    `/common/ds-accounts?datasource=${encodeURIComponent(ds)}`,
    key,
  );
  if (!res.ok) return [];
  return dedupe(parseLinks(parse(text)).flatMap((l) => l.accounts));
}

// ─── Per-source binding + pending snapshot in app_metadata ───────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readBinding(appMeta: Record<string, any>, ds: string): Account | null {
  const map = (appMeta.windsor_accounts ?? {}) as Record<string, Account>;
  if (map[ds]?.account_id) return map[ds];
  // Legacy single-source field (google_ads only).
  if (ds === DEFAULT_DS && appMeta.windsor_account_id) {
    return {
      account_id: appMeta.windsor_account_id,
      account_name: appMeta.windsor_account_name ?? appMeta.windsor_account_id,
    };
  }
  return null;
}

function withBinding(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  appMeta: Record<string, any>,
  ds: string,
  account: Account | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  const map = { ...((appMeta.windsor_accounts ?? {}) as Record<string, Account>) };
  if (account) map[ds] = { account_id: account.account_id, account_name: account.account_name };
  else delete map[ds];
  // Clear this source's pending snapshot on save/disconnect.
  const pending = { ...((appMeta.windsor_pending ?? {}) as Record<string, unknown>) };
  delete pending[ds];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = {
    ...appMeta,
    windsor_accounts: map,
    windsor_pending: pending,
  };
  if (ds === DEFAULT_DS) {
    patch.windsor_account_id = account ? account.account_id : null;
    patch.windsor_account_name = account ? account.account_name : null;
    patch.windsor_pending_known = null;
    patch.windsor_pending_at = null;
  }
  return patch;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readPending(appMeta: Record<string, any>, ds: string): { known: string[]; at: number } {
  const p = ((appMeta.windsor_pending ?? {}) as Record<string, { known?: string[]; at?: number }>)[
    ds
  ];
  if (p) return { known: p.known ?? [], at: p.at ?? 0 };
  // Legacy google_ads fields.
  if (ds === DEFAULT_DS && Array.isArray(appMeta.windsor_pending_known)) {
    return { known: appMeta.windsor_pending_known, at: Number(appMeta.windsor_pending_at ?? 0) };
  }
  return { known: [], at: 0 };
}

function withPending(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  appMeta: Record<string, any>,
  ds: string,
  known: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  const pending = { ...((appMeta.windsor_pending ?? {}) as Record<string, unknown>) };
  pending[ds] = { known, at: Date.now() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { ...appMeta, windsor_pending: pending };
  if (ds === DEFAULT_DS) {
    patch.windsor_pending_known = known;
    patch.windsor_pending_at = Date.now();
  }
  return patch;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") ?? "link";
  const pastedKey = searchParams.get("key");
  const key = pastedKey || process.env.WINDSOR_API_KEY;
  const debug = searchParams.get("debug") === "1";
  const ds = (searchParams.get("ds") || DEFAULT_DS).trim();

  // Session first, before anything that reports on configuration. Every action
  // on this route reaches Windsor with the workspace key, and the workspace
  // holds every client's accounts. `save` and `disconnect` checked for a
  // session; `link` and `accounts` did not, and the per-user isolation below is
  // a diff against a snapshot stored on the user — with no user there is no
  // snapshot, the known-set is empty, and the filter matches every link in the
  // workspace. Anonymous callers were served the whole client list, plus the
  // live co-user tokens in the `link` response. Nothing here is public.
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to connect a data source." }, { status: 401 });
  }

  if (!(await allowedDataSources()).has(ds)) {
    return NextResponse.json({ error: `Unsupported data source "${ds}".` }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json(
      { error: "No Windsor API key. Paste your key or set WINDSOR_API_KEY." },
      { status: 400 },
    );
  }
  // Server-authoritative mode: an authenticated app user with no pasted key. We
  // keep the snapshot + the final account in app_metadata (which the user CANNOT
  // edit client-side), and validate the chosen account server-side.
  const serverMode = !pastedKey && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isAdmin = isPlatformAdmin(user);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appMeta = (user?.app_metadata ?? {}) as Record<string, any>;

  // Resolve THIS user's accounts for `ds`: links whose token is NEW vs the snapshot
  // taken at link time. Isolation is purely by token-diff.
  async function freshAccounts(): Promise<{ accounts: Account[]; raw: string; ok: boolean }> {
    const knownArr: string[] = serverMode
      ? readPending(appMeta, ds).known
      : (searchParams.get("known") ?? "").split(",");
    const known = new Set(knownArr.map((s) => String(s).trim()).filter(Boolean));
    const { links, raw, ok } = await coUserLinks(key!, ds);
    if (!ok) return { accounts: [], raw, ok };
    const fresh = links.filter((l) => l.token && (known.size === 0 || !known.has(l.token)));
    return { accounts: dedupe(fresh.flatMap((l) => l.accounts)), raw, ok };
  }

  try {
    if (action === "link") {
      // Reuse a RECENT snapshot (within 5 min) for rapid re-clicks / multiple tabs.
      const pending = readPending(appMeta, ds);
      const reuse =
        serverMode &&
        pending.known.length >= 0 &&
        pending.at > 0 &&
        Date.now() - pending.at < 5 * 60 * 1000;

      let known: string[];
      if (reuse) {
        known = pending.known;
      } else {
        const before = await coUserLinks(key, ds);
        if (!before.ok) {
          return NextResponse.json(
            { error: "Could not reach Windsor to initialize. Please try again." },
            { status: 502 },
          );
        }
        known = before.links.map((l) => l.token).filter(Boolean);
      }

      const { res, text } = await onboardFetch(
        `/team/generate-co-user-url/?allowed_sources=${encodeURIComponent(ds)}`,
        key,
      );
      if (!res.ok) {
        return NextResponse.json(
          {
            error: `Windsor ${res.status}: ${text
              .replace(/<[^>]*>/g, "")
              .trim()
              .slice(0, 300)}`,
          },
          { status: 502 },
        );
      }
      const json = parse(text);
      const url =
        json?.url ??
        json?.link ??
        json?.co_user_url ??
        json?.authorization_url ??
        json?.data?.url ??
        firstUrl(typeof json === "string" ? json : text);
      if (!url)
        return NextResponse.json(
          { error: "No authorization URL in Windsor's response.", raw: text.slice(0, 400) },
          { status: 502 },
        );

      if (serverMode && !reuse) {
        await adminClient().auth.admin.updateUserById(user.id, {
          app_metadata: withPending(appMeta, ds, known),
        });
      }
      return NextResponse.json(serverMode ? { url } : { url, known });
    }

    if (action === "accounts") {
      const { accounts, raw, ok } = await freshAccounts();
      if (!ok) return NextResponse.json({ accounts: [] });
      return NextResponse.json({ accounts, ...(debug ? { raw: raw.slice(0, 2000) } : {}) });
    }

    if (action === "save") {
      if (!serverMode)
        return NextResponse.json({ error: "Sign in to connect an account." }, { status: 401 });
      const want = normalizeAccountId(searchParams.get("account_id"));
      if (!want) return NextResponse.json({ error: "Missing account_id." }, { status: 400 });
      const { accounts, ok } = await freshAccounts();
      if (!ok)
        return NextResponse.json({ error: "Could not reach Windsor. Try again." }, { status: 502 });
      // The account MUST come from this user's own fresh authorization.
      const match = accounts.find((a) => normalizeAccountId(a.account_id) === want);
      if (!match) {
        return NextResponse.json(
          { error: "That account isn't from your authorization." },
          { status: 403 },
        );
      }
      await adminClient().auth.admin.updateUserById(user.id, {
        app_metadata: withBinding(appMeta, ds, match),
      });
      return NextResponse.json({ ok: true, account: match });
    }

    if (action === "disconnect") {
      if (!serverMode) return NextResponse.json({ error: "Sign in." }, { status: 401 });
      await adminClient().auth.admin.updateUserById(user.id, {
        app_metadata: withBinding(appMeta, ds, null),
      });
      return NextResponse.json({ ok: true });
    }

    // ── Admin-only: list every workspace account, and assign any of them ─────────
    if (action === "workspace-accounts") {
      if (!serverMode || !isAdmin)
        return NextResponse.json({ error: "Admins only." }, { status: 403 });
      return NextResponse.json({ accounts: await workspaceAccounts(key, ds) });
    }

    if (action === "admin-set") {
      if (!serverMode || !isAdmin)
        return NextResponse.json({ error: "Admins only." }, { status: 403 });
      const want = normalizeAccountId(searchParams.get("account_id"));
      if (!want) return NextResponse.json({ error: "Missing account_id." }, { status: 400 });
      const targetId = searchParams.get("target") || user.id;
      const match = (await workspaceAccounts(key, ds)).find(
        (a) => normalizeAccountId(a.account_id) === want,
      );
      if (!match)
        return NextResponse.json({ error: "Account not found in the workspace." }, { status: 404 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let targetApp: Record<string, any> = appMeta;
      if (targetId !== user.id) {
        const { data } = await adminClient().auth.admin.getUserById(targetId);
        targetApp = (data.user?.app_metadata ?? {}) as Record<string, unknown>;
      }
      await adminClient().auth.admin.updateUserById(targetId, {
        app_metadata: withBinding(targetApp, ds, match),
      });
      return NextResponse.json({ ok: true, account: match });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Windsor request failed" },
      { status: 500 },
    );
  }
}
