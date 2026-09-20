// BigQuery as a materialised store for Windsor rows — the "fast read" layer.
//
// fetchFromWindsor already returns one canonical WindsorRow shape for EVERY
// connector (Google/Meta/GA4/Shopify), so we store THAT, keyed by the exact
// query it answers (account + connector + group_by + date window). Reads pull
// the latest synced copy back in the identical shape, so the dashboard is
// unchanged and every connector is covered by one table.
//
// The `date` column is STRING and we filter the window by date_from/date_to
// EQUALITY (not `BETWEEN` on a DATE column) — deliberately sidestepping the trap
// documented in docs/bigquery-disabled.md.
//
// Auth is via googleAuth (SA key today, federation later). No SDK — the REST API
// is two POSTs, and avoids pulling @google-cloud/bigquery into the bundle.

import type { WindsorRow, WindsorGroupBy } from "@/app/api/windsor/route";
import { googleAccessToken, isBigQueryConfigured } from "./googleAuth";

export { isBigQueryConfigured };

/** Identifies exactly one cached fetch — the isolation boundary is account_id. */
export interface SyncKey {
  accountId: string;
  connector: string;
  groupBy: WindsorGroupBy;
  dateFrom: string;
  dateTo: string;
}

const project = () => process.env.BQ_PROJECT_ID ?? "";
const dataset = () => process.env.BQ_DATASET || "datarocks";
const table = () => process.env.BQ_TABLE || "windsor_rows";
const tableRef = () => `${project()}.${dataset()}.${table()}`;

// Columns carried per row (the metric/dimension payload). Kept in one place so
// the writer and the reader can never drift apart.
const ROW_COLUMNS = [
  "date",
  "campaign",
  "campaign_type",
  "campaign_status",
  "ad_group",
  "keyword_text",
  "match_type",
  "pivot",
  "dimension",
  "clicks",
  "impressions",
  "spend",
  "conversions",
  "conversion_value",
  // Admin-defined custom metrics, serialised as a JSON string. NULL for
  // connectors without any (and for rows written before this column existed —
  // the read path treats a missing `extra` on a custom-metric connector as a
  // cache miss so those stale rows never surface as all-zero KPIs).
  "extra",
] as const;
const NUMERIC = new Set(["clicks", "impressions", "spend", "conversions", "conversion_value"]);

// ─── Pure mappers (unit-tested) ──────────────────────────────────────────────

/** WindsorRow → the flat object written to BigQuery for `key`. */
export function toBqRow(key: SyncKey, r: WindsorRow, syncedAt: string): Record<string, unknown> {
  return {
    account_id: key.accountId,
    connector: key.connector,
    group_by: key.groupBy,
    date_from: key.dateFrom,
    date_to: key.dateTo,
    date: r.date,
    campaign: r.campaign,
    campaign_type: r.campaign_type,
    campaign_status: r.campaign_status,
    ad_group: r.ad_group,
    keyword_text: r.keyword_text,
    match_type: r.match_type,
    pivot: r.pivot,
    dimension: r.dimension,
    clicks: r.clicks,
    impressions: r.impressions,
    spend: r.spend,
    conversions: r.conversions,
    conversion_value: r.conversion_value,
    // Custom metrics ride along as JSON so a cached read reproduces the same KPI
    // cards Windsor would (Amazon's "Sponsored …" metrics). null when there are none.
    extra: r.extra && Object.keys(r.extra).length ? JSON.stringify(r.extra) : null,
    synced_at: syncedAt,
  };
}

/** A BigQuery `queries` response → WindsorRow[]. BigQuery returns every value as
 *  a string under { schema.fields[], rows[].f[].v }; we zip names to values and
 *  coerce the numeric columns back to numbers. */
export function rowsFromQueryResponse(resp: unknown): WindsorRow[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = resp as any;
  const fields: string[] = (r?.schema?.fields ?? []).map((f: { name: string }) => f.name);
  const rows: { f: { v: unknown }[] }[] = r?.rows ?? [];
  return rows.map((row) => {
    const o: Record<string, unknown> = {};
    fields.forEach((name, i) => {
      const v = row.f[i]?.v ?? null;
      o[name] = NUMERIC.has(name) ? Number(v) || 0 : v === null ? null : String(v);
    });
    // extra: a JSON string when stored, null when the connector has none OR when
    // the row predates the column. undefined (not {}) in the latter cases so the
    // caller can tell "no custom metrics cached" from "cached as empty".
    let extra: Record<string, number> | undefined;
    if (o.extra != null) {
      try {
        extra = JSON.parse(o.extra as string) as Record<string, number>;
      } catch {
        extra = undefined;
      }
    }
    return {
      date: (o.date ?? null) as string | null,
      campaign: (o.campaign ?? null) as string | null,
      pivot: (o.pivot ?? "") as string,
      campaign_type: (o.campaign_type ?? null) as string | null,
      campaign_status: (o.campaign_status ?? null) as string | null,
      ad_group: (o.ad_group ?? null) as string | null,
      keyword_text: (o.keyword_text ?? null) as string | null,
      match_type: (o.match_type ?? null) as string | null,
      dimension: (o.dimension ?? "") as string,
      clicks: o.clicks as number,
      impressions: o.impressions as number,
      spend: o.spend as number,
      conversions: o.conversions as number,
      conversion_value: o.conversion_value as number,
      extra,
    };
  });
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

async function bqRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const token = await googleAccessToken();
  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${project()}/${path}`,
    {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  const json = await res.json();
  if (!res.ok)
    throw new Error(`BigQuery ${path} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}
const bqPost = (path: string, body: unknown) => bqRequest("POST", path, body);

// The `extra` column was added after the table was first created. Add it once per
// serverless instance if missing (needs bigquery.dataEditor, same as the write) so
// custom metrics can be cached. A newly added streaming column can take a few
// minutes to accept inserts — until then the insert throws and the caller just
// falls back to live Windsor, so this self-heals rather than failing hard.
let extraColumnEnsured = false;
async function ensureExtraColumn(): Promise<void> {
  if (extraColumnEnsured) return;
  const path = `datasets/${dataset()}/tables/${table()}`;
  const t = (await bqRequest("GET", path)) as { schema?: { fields?: { name: string }[] } };
  const fields = t.schema?.fields ?? [];
  if (!fields.some((f) => f.name === "extra")) {
    await bqRequest("PATCH", path, {
      schema: { fields: [...fields, { name: "extra", type: "STRING", mode: "NULLABLE" }] },
    });
  }
  extraColumnEnsured = true;
}

/** Materialise one fetch's rows into BigQuery (streaming insert). */
export async function writeWindsorRowsToBQ(key: SyncKey, rows: WindsorRow[]): Promise<void> {
  if (rows.length === 0) return; // v1: don't store empties — a miss falls back to Windsor
  await ensureExtraColumn();
  const syncedAt = new Date().toISOString();
  const payload = { rows: rows.map((r) => ({ json: toBqRow(key, r, syncedAt) })) };
  const res = (await bqPost(`datasets/${dataset()}/tables/${table()}/insertAll`, payload)) as {
    insertErrors?: unknown[];
  };
  if (res.insertErrors?.length)
    throw new Error(`BigQuery insert errors: ${JSON.stringify(res.insertErrors).slice(0, 300)}`);
}

/** Read the latest synced copy of `key` back as WindsorRow[], or null if nothing
 *  is cached (caller then falls back to live Windsor). */
export async function fetchFromBigQuery(key: SyncKey): Promise<WindsorRow[] | null> {
  const cols = ROW_COLUMNS.join(", ");
  const where = `account_id=@account_id AND connector=@connector AND group_by=@group_by AND date_from=@date_from AND date_to=@date_to`;
  const sql =
    `SELECT ${cols} FROM \`${tableRef()}\` WHERE ${where} ` +
    `AND synced_at = (SELECT MAX(synced_at) FROM \`${tableRef()}\` WHERE ${where})`;
  const param = (name: string, value: string) => ({
    name,
    parameterType: { type: "STRING" },
    parameterValue: { value },
  });
  const resp = (await bqPost("queries", {
    query: sql,
    useLegacySql: false,
    parameterMode: "NAMED",
    queryParameters: [
      param("account_id", key.accountId),
      param("connector", key.connector),
      param("group_by", key.groupBy),
      param("date_from", key.dateFrom),
      param("date_to", key.dateTo),
    ],
  })) as { rows?: unknown[] };
  if (!resp.rows || resp.rows.length === 0) return null;
  return rowsFromQueryResponse(resp);
}
