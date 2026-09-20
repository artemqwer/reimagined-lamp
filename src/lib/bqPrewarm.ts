import type { User } from "@supabase/supabase-js";
import { listAllUsers } from "@/lib/supabase-admin";
import {
  connectedConnectorsRaw,
  windsorAccountIdFor,
  getConnector,
  ensureCustomConnectorsLoaded,
  BUILT_IN_CONNECTORS,
} from "@/lib/connectors";
import { windsorApiKeyOf } from "@/lib/authz";
import { refreshBQ, type WindsorGroupBy } from "@/app/api/windsor/route";
import { isBigQueryConfigured } from "@/lib/bigquery";

// Proactive prewarm — the reason a NEW account's first dashboard open is still
// fast. The read path already populates BigQuery on a miss (the user who opens a
// cold key waits once); this runs ahead of them so nobody waits at all. It syncs
// the default dashboard window (last 14 days, matching DashboardView) for the
// primary breakdown table + its daily time series — the two fetches the initial
// view fires — for every connected account of every connector.
function defaultRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export interface PrewarmResult {
  accounts: number;
  synced: number;
  errors: number;
  skipped: boolean;
  // First error message hit (auth / permission / missing table …) — the whole
  // point when the cron or a manual self-test reports errors > 0. No secrets:
  // googleAuth/bigquery errors carry Google's own error text, not credentials.
  firstError?: string;
}

/** Sync every connected account's default view into BigQuery. Per-item errors are
 *  isolated so one bad account can't stop the batch. No-op unless BQ configured. */
export async function prewarmAll(): Promise<PrewarmResult> {
  if (!isBigQueryConfigured()) return { accounts: 0, synced: 0, errors: 0, skipped: true };
  await ensureCustomConnectorsLoaded();
  const users: User[] = await listAllUsers();
  const range = defaultRange(14);
  const envKey = process.env.WINDSOR_API_KEY;
  let accounts = 0;
  let synced = 0;
  let errors = 0;
  let firstError: string | undefined;

  for (const u of users) {
    // Personal key if the user has one, else the shared workspace key — the same
    // resolution the data routes use, always paired with the account scope below.
    const windsorKey = windsorApiKeyOf(u) ?? envKey;
    if (!windsorKey) continue;
    for (const connector of connectedConnectorsRaw(u)) {
      // Only built-in connectors are served from BigQuery (see resolveRows). Custom
      // connectors (Amazon) are always read live, so prewarming them just writes a
      // cache nobody reads AND lets a slow Amazon report stall the whole sync.
      if (!(connector in BUILT_IN_CONNECTORS)) continue;
      const accountId = windsorAccountIdFor(u.app_metadata, connector);
      if (!accountId) continue;
      accounts++;
      const primary = getConnector(connector).primaryDimension;
      // Primary table + its daily series — exactly what the default view loads.
      const dims = [primary, `date,${primary}`] as WindsorGroupBy[];
      for (const groupBy of dims) {
        try {
          await refreshBQ(windsorKey, range.from, range.to, groupBy, accountId, connector);
          synced++;
        } catch (e) {
          errors++;
          if (!firstError) firstError = e instanceof Error ? e.message : String(e);
        }
      }
    }
  }
  return { accounts, synced, errors, skipped: false, firstError };
}

/** Prewarm ONE freshly-connected account (called on connect) so its owner's first
 *  open is instant instead of waiting on the cold Windsor fetch. Best-effort. */
export async function prewarmAccount(
  windsorKey: string,
  accountId: string,
  connector: string,
): Promise<void> {
  if (!isBigQueryConfigured() || !accountId || !windsorKey) return;
  await ensureCustomConnectorsLoaded();
  const range = defaultRange(14);
  const primary = getConnector(connector).primaryDimension;
  for (const groupBy of [primary, `date,${primary}`] as WindsorGroupBy[]) {
    await refreshBQ(windsorKey, range.from, range.to, groupBy, accountId, connector).catch(
      () => {},
    );
  }
}
