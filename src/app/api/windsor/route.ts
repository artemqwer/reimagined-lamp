import { isPlatformAdmin, windsorApiKeyOf } from "@/lib/authz";
import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { checkDateRange, checkConnector } from "@/lib/requestGuards";
import { mockWindsorRows } from "@/lib/mockWindsorData";
import {
  windsorFieldsFor,
  readDimensionValue,
  windsorAccountIdFor,
  normalizeAccountId,
  getConnector,
  ensureCustomConnectorsLoaded,
  BUILT_IN_CONNECTORS,
  DEFAULT_CONNECTOR,
} from "@/lib/connectors";
import {
  fetchFromBigQuery,
  writeWindsorRowsToBQ,
  isBigQueryConfigured,
  type SyncKey,
} from "@/lib/bigquery";

// 150s so a slow Amazon breakdown (110s abort) has headroom to map + respond.
export const maxDuration = 150;

// In-memory cache for Windsor responses (per server instance, TTL 5 min).
// Saves repeat fetches when multiple PerformanceTables request the same dimension.
type CacheEntry = { data: WindsorRow[]; expires: number };
const windsorCache = new Map<string, CacheEntry>();
const WINDSOR_CACHE_TTL_MS = 30 * 60 * 1000;
// De-dupe concurrent fetches for the same key: the dashboard fires many
// parallel requests (table, dropdown, KPIs, AI) for the same dimension — share
// one in-flight Windsor call instead of N.
const windsorInFlight = new Map<string, Promise<WindsorRow[]>>();

export type WindsorRow = {
  date: string | null;
  campaign: string | null;
  // This connector's primary-entity value for the row — the key the
  // cross-filter engine attributes every other dimension through. Resolved
  // server-side because the raw field it comes from isn't part of this shape.
  pivot: string;
  campaign_type: string | null; // Google Ads advertising_channel_type (when available)
  // Serving status of the campaign — ENABLED / PAUSED / REMOVED — when Windsor
  // exposes it. Null when it doesn't, and the dashboard falls back to a
  // spend-based guess. Only meaningful on the campaign breakdowns.
  campaign_status: string | null;
  ad_group: string | null;
  keyword_text: string | null;
  match_type: string | null;
  dimension: string;
  clicks: number;
  impressions: number;
  spend: number;
  conversions: number;
  conversion_value: number;
  // Admin-registered custom metrics — raw Windsor fields with no canonical
  // formula, keyed by metric key (see CustomConnectorMetricInput). Empty for
  // built-in connectors and any custom connector with no custom metrics.
  extra?: Record<string, number>;
};

export type WindsorGroupBy =
  | "date"
  | "campaign"
  | "campaign_type"
  | "date,campaign_type"
  | "date,campaign"
  | "ad_group"
  | "ad"
  | "keyword"
  | "match_type"
  | "device"
  | "network"
  | "search_term"
  | "audience"
  | "country"
  | "region"
  | "hour"
  | "day_of_week"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "date,ad_group"
  | "date,ad"
  | "date,keyword"
  | "date,match_type"
  | "date,device"
  | "date,network"
  | "date,search_term"
  | "date,audience"
  | "date,country"
  | "date,region"
  | "date,hour"
  | "date,day_of_week"
  | "date,week"
  | "date,month"
  | "date,quarter"
  | "date,year";

const PIVOT_FIELD = "campaign";

const RAW_FIELDS_BY_GROUP: Record<WindsorGroupBy, string> = {
  date: "date,clicks,impressions,spend,conversions,conversion_value",
  // The advertising channel type is appended dynamically in doFetchFromWindsor
  // (field id varies per account), so the Campaign Type breakdown uses the REAL type.
  campaign: "campaign,clicks,impressions,spend,conversions,conversion_value",
  // Campaign Type breakdown: the advertising channel type field is appended in
  // doFetchFromWindsor (its id varies per account) and normalized to Search/Display/…
  campaign_type: "clicks,impressions,spend,conversions,conversion_value",
  // date,campaign_type carries `campaign` too so the cross-filter can attribute a
  // selected type to its campaigns when distributing across the other dimensions.
  "date,campaign_type": "date,campaign,clicks,impressions,spend,conversions,conversion_value",
  "date,campaign": "date,campaign,clicks,impressions,spend,conversions,conversion_value",
  ad_group: "campaign,ad_group_name,clicks,impressions,spend,conversions,conversion_value",
  // Ad (ad_group_ad) view. The ad-identifier field id varies per account, so it is
  // appended dynamically in doFetchFromWindsor (candidate loop) like the channel type.
  ad: "campaign,clicks,impressions,spend,conversions,conversion_value",
  "date,ad": "date,campaign,clicks,impressions,spend,conversions,conversion_value",
  // Google Ads API rejects mixing keyword/match_type/search_term across views — keep each
  // dimension query minimal. Cross-filter is achieved via separate ad_group fetch +
  // filter_campaign propagation.
  // `keyword_text`, NOT `keyword`: Windsor's `keyword` is a Keyword Planner field
  // that Google Ads refuses to query without a planner seed ("fields cannot be
  // queried together") — it 400'd every keyword breakdown. keyword_text is the
  // served keyword and queries normally. (Same reason /api/optimizer/health uses it.)
  keyword: "campaign,keyword_text,clicks,impressions,spend,conversions,conversion_value",
  match_type: "campaign,match_type,clicks,impressions,spend,conversions,conversion_value",
  device: "campaign,device,clicks,impressions,spend,conversions,conversion_value",
  // Windsor returns nothing for the plain `network` field on Google Ads — the
  // real dimension is `ad_network_type` (SEARCH, SEARCH_PARTNERS, DISPLAY, YOUTUBE…).
  network: "campaign,ad_network_type,clicks,impressions,spend,conversions,conversion_value",
  search_term: "campaign,search_term,clicks,impressions,spend,conversions,conversion_value",
  "date,ad_group":
    "date,campaign,ad_group_name,clicks,impressions,spend,conversions,conversion_value",
  "date,keyword":
    "date,campaign,keyword_text,clicks,impressions,spend,conversions,conversion_value",
  "date,match_type":
    "date,campaign,match_type,clicks,impressions,spend,conversions,conversion_value",
  "date,device": "date,campaign,device,clicks,impressions,spend,conversions,conversion_value",
  "date,network":
    "date,campaign,ad_network_type,clicks,impressions,spend,conversions,conversion_value",
  "date,search_term":
    "date,campaign,search_term,clicks,impressions,spend,conversions,conversion_value",
  audience: "campaign,audience,clicks,impressions,spend,conversions,conversion_value",
  country: "campaign,country,clicks,impressions,spend,conversions,conversion_value",
  region: "campaign,region,clicks,impressions,spend,conversions,conversion_value",
  hour: "campaign,hour_of_day,clicks,impressions,spend,conversions,conversion_value",
  day_of_week: "campaign,day_of_week,clicks,impressions,spend,conversions,conversion_value",
  // For week/month/quarter we also pull year so buckets distinguish e.g. Jan 2021 vs Jan 2022
  week: "campaign,year,week,clicks,impressions,spend,conversions,conversion_value",
  month: "campaign,year,month,clicks,impressions,spend,conversions,conversion_value",
  quarter: "campaign,year,quarter,clicks,impressions,spend,conversions,conversion_value",
  year: "campaign,year,clicks,impressions,spend,conversions,conversion_value",
  "date,audience": "date,campaign,audience,clicks,impressions,spend,conversions,conversion_value",
  "date,country": "date,campaign,country,clicks,impressions,spend,conversions,conversion_value",
  "date,region": "date,campaign,region,clicks,impressions,spend,conversions,conversion_value",
  "date,hour": "date,campaign,hour_of_day,clicks,impressions,spend,conversions,conversion_value",
  "date,day_of_week":
    "date,campaign,day_of_week,clicks,impressions,spend,conversions,conversion_value",
  // year is included alongside week/month/quarter so normalizeDimension can
  // disambiguate e.g. "Jan 2021" vs "Jan 2022" when matching cross-filter values.
  "date,week": "date,campaign,year,week,clicks,impressions,spend,conversions,conversion_value",
  "date,month": "date,campaign,year,month,clicks,impressions,spend,conversions,conversion_value",
  "date,quarter":
    "date,campaign,year,quarter,clicks,impressions,spend,conversions,conversion_value",
  "date,year": "date,campaign,year,clicks,impressions,spend,conversions,conversion_value",
};

/**
 * Every breakdown carries `campaign` — this source's primary entity.
 *
 * Two things need it. `filter_campaign` scopes a breakdown to the primary
 * table's selection by comparing each row's campaign, and the cross-filter
 * attributes a selection to the other breakdowns by joining on it. A row
 * without it matches nothing, and both silently degrade to showing
 * account-wide totals under an active selection.
 *
 * It used to be written out per entry, and `campaign_type` was missing it —
 * so picking a campaign left Campaign Type Performance showing the whole
 * account. Folded in centrally so a new breakdown can't be added without it.
 * `date` is the exception: account-wide daily totals, no breakdown to scope.
 */
const FIELDS_BY_GROUP: Record<WindsorGroupBy, string> = Object.fromEntries(
  Object.entries(RAW_FIELDS_BY_GROUP).map(([groupBy, fields]) => {
    if (groupBy === "date" || fields.split(",").includes(PIVOT_FIELD))
      return [groupBy, fields] as const;
    // After `date` when present, so the field order still reads date-first.
    const parts = fields.split(",");
    const at = parts[0] === "date" ? 1 : 0;
    parts.splice(at, 0, PIVOT_FIELD);
    return [groupBy, parts.join(",")] as const;
  }),
) as Record<WindsorGroupBy, string>;

/** The breakdowns that must carry the pivot, and the field itself — exported so
 *  the invariant above can be asserted rather than trusted. */
export const GOOGLE_ADS_GROUP_BY_FIELDS = FIELDS_BY_GROUP;
export const GOOGLE_ADS_PIVOT_FIELD = PIVOT_FIELD;

// Map a Google Ads advertising_channel_type enum / Windsor string to a short label
// (mirrors the client's normalizeChannelType so the Campaign Type table reads Search /
// Display / Shopping / PMax / … instead of raw enums).
function normalizeChannelTypeSrv(raw: unknown): string {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (!s || s === "UNKNOWN" || s === "UNSPECIFIED" || s === "NULL") return "Unknown";
  if (s.includes("PERFORMANCE_MAX") || s === "PMAX") return "Performance Max";
  if (s.includes("SHOPPING")) return "Shopping";
  if (s.includes("DISPLAY")) return "Display";
  if (s.includes("DEMAND_GEN") || s.includes("DISCOVERY")) return "Demand Gen";
  if (s.includes("VIDEO")) return "Video";
  if (s.includes("APP") || s.includes("MULTI_CHANNEL")) return "App";
  if (s.includes("SMART")) return "Smart";
  if (s.includes("LOCAL")) return "Local";
  if (s.includes("SEARCH")) return "Search";
  return "Other";
}

function normalizeDimension(r: Record<string, unknown>, groupBy: WindsorGroupBy): string {
  switch (groupBy) {
    case "campaign":
    case "date,campaign":
      return String(r.campaign ?? r.campaign_name ?? r.campaign__name ?? "Unknown");
    case "campaign_type":
    case "date,campaign_type":
      return normalizeChannelTypeSrv(
        r.advertising_channel_type ?? r.campaign_advertising_channel_type ?? r.campaign_type,
      );
    case "ad_group":
    case "date,ad_group":
      return String(r.ad_group_name ?? r.ad_group ?? "Unknown");
    case "ad":
    case "date,ad":
      // Prefer a human-readable ad name; fall back to the ad id (field id varies per account).
      return String(
        r.ad_name ??
          r.ad_group_ad_ad_name ??
          r.headline ??
          r.ad_id ??
          r.ad_group_ad_ad_id ??
          r.ad ??
          "Unknown",
      );
    case "keyword":
    case "date,keyword":
      return String(r.keyword ?? r.keyword_text ?? "Unknown");
    case "match_type":
    case "date,match_type":
      return String(r.match_type ?? "Unknown");
    case "device":
    case "date,device":
      return String(r.device ?? "Unknown");
    case "network":
    case "date,network":
      return String(r.ad_network_type ?? r.adnetwork_type ?? r.network ?? "Unknown");
    case "search_term":
    case "date,search_term":
      return String(r.search_term ?? "Unknown");
    case "audience":
    case "date,audience":
      return String(r.audience ?? r.audience_name ?? r.audience_target ?? "Unknown");
    case "country":
    case "date,country":
      return String(r.country ?? r.country_code ?? "Unknown");
    case "region":
    case "date,region":
      return String(r.region ?? r.region_name ?? "Unknown");
    case "hour":
    case "date,hour":
      return String(r.hour_of_day ?? r.hour ?? "Unknown");
    case "day_of_week":
    case "date,day_of_week":
      return String(r.day_of_week ?? "Unknown");
    case "week":
    case "date,week": {
      const w = String(r.week ?? "Unknown");
      const MONTHS = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      // Windsor may return week as ISO date (e.g. "2021-01-11" — start of week) or number.
      const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(w);
      if (isoMatch) {
        const [, yy, mm, dd] = isoMatch;
        return `${MONTHS[parseInt(mm) - 1]} ${parseInt(dd)}, ${yy}`;
      }
      return r.year ? `Week ${w} ${r.year}` : `Week ${w}`;
    }
    case "month":
    case "date,month": {
      const MONTHS = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      const mRaw = String(r.month ?? "Unknown");
      // Windsor may return: "12", "2024-12", "2024-12-01" (start date) or "December"
      const isoMatch = /^(\d{4})-(\d{1,2})(?:-\d{2})?/.exec(mRaw);
      if (isoMatch) {
        const [, yy, mm] = isoMatch;
        return `${MONTHS[parseInt(mm) - 1]} ${yy}`;
      }
      const mNum = Number(mRaw);
      const name = mNum >= 1 && mNum <= 12 ? MONTHS[mNum - 1] : mRaw;
      return r.year ? `${name} ${r.year}` : name;
    }
    case "quarter":
    case "date,quarter": {
      const qRaw = String(r.quarter ?? "Unknown");
      // Windsor most often returns the quarter START DATE (e.g. "2022-04-01");
      // derive the quarter number from the month so we emit "Q2 2022" (which
      // parsePeriodToRange understands) instead of "Q2022-04-01 2022".
      const dateMatch = /^(\d{4})-(\d{2})-\d{2}/.exec(qRaw);
      if (dateMatch) {
        const [, yy, mm] = dateMatch;
        const q = Math.floor((parseInt(mm) - 1) / 3) + 1;
        return `Q${q} ${yy}`;
      }
      // Also handle "2024-Q1" / "2024Q1" / "1" / "Q1".
      const isoMatch = /^(\d{4})-?Q?(\d)$/i.exec(qRaw);
      if (isoMatch) {
        const [, yy, q] = isoMatch;
        return `Q${q} ${yy}`;
      }
      const cleaned = qRaw.replace(/^Q/i, "");
      return r.year ? `Q${cleaned} ${r.year}` : `Q${cleaned}`;
    }
    case "year":
    case "date,year":
      return String(r.year ?? "Unknown");
    default:
      return String(r.date ?? "Unknown");
  }
}

export async function fetchFromWindsor(
  apiKey: string,
  dateFrom: string,
  dateTo: string,
  groupBy: WindsorGroupBy,
  // When set, Windsor returns ONLY this Google Ads account's data (server-side
  // filter). This is how a shared workspace key serves many users — each scoped
  // to their own account_id. Part of the cache key so accounts never mix.
  accountId?: string,
  // Which connector's schema to use (google_ads | meta_ads | ga4 | shopify). For
  // non-Google connectors the dimension fields come from the connector manifest
  // and the Google-Ads-specific channel-type / ad-id candidate logic is skipped.
  connector: string = DEFAULT_CONNECTOR,
): Promise<WindsorRow[]> {
  const cacheKey = `${apiKey}|${connector}|${accountId ?? ""}|${dateFrom}|${dateTo}|${groupBy}`;
  const cached = windsorCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  const inflight = windsorInFlight.get(cacheKey);
  if (inflight) return inflight;
  const promise = resolveRows(apiKey, dateFrom, dateTo, groupBy, cacheKey, accountId, connector);
  windsorInFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    windsorInFlight.delete(cacheKey);
  }
}

/** Proactive prewarm: fetch Windsor LIVE (bypassing the BigQuery read) and
 *  materialise into BigQuery, so a later dashboard read of this key is instant.
 *  Used by the sync cron and on-connect. No-op unless BigQuery is configured. */
export async function refreshBQ(
  apiKey: string,
  dateFrom: string,
  dateTo: string,
  groupBy: WindsorGroupBy,
  accountId: string,
  connector: string,
): Promise<void> {
  if (!isBigQueryConfigured()) return;
  const cacheKey = `${apiKey}|${connector}|${accountId}|${dateFrom}|${dateTo}|${groupBy}`;
  // Keep the default 90s abort. A longer per-fetch budget blows the whole sync:
  // the loop is sequential in ONE 300s request, so two slow Amazon Seller Central
  // pulls at 200s each ran the function past its limit and the gateway returned a
  // 504 with no result at all. 90s bounds each fetch so the batch always returns;
  // a source too slow for that (Seller Central's first report-generating pull)
  // just times out as one counted error and is retried on the next run, by which
  // point Windsor has the report ready.
  const rows = await doFetchFromWindsor(
    apiKey,
    dateFrom,
    dateTo,
    groupBy,
    cacheKey,
    accountId,
    connector,
  );
  await writeWindsorRowsToBQ({ accountId, connector, groupBy, dateFrom, dateTo }, rows);
}

// BigQuery-aware resolution. When the request is scoped to an account AND BigQuery
// is configured, read the materialised copy from BigQuery first (instant); on a
// miss, fetch Windsor live and populate BigQuery in the background so the next
// read of this key is instant. Personal-key users (no accountId) and an
// unconfigured BigQuery read Windsor live — unchanged behaviour, so this is
// dormant until BQ_* env is set. Isolation: the BigQuery key is scoped by
// account_id, so one account's rows can never be served to another.
async function resolveRows(
  apiKey: string,
  dateFrom: string,
  dateTo: string,
  groupBy: WindsorGroupBy,
  cacheKey: string,
  accountId: string | undefined,
  connector: string,
): Promise<WindsorRow[]> {
  // BigQuery caches ONLY the built-in connectors (Google Ads, Meta, GA4, Shopify).
  // Admin-defined custom connectors — both Amazon sources included — are always
  // read live: their fields, dimensions and metric mapping are configured at
  // runtime, and a BigQuery snapshot of them proved unreliable (Amazon Ads, which
  // uses the canonical metric set, came back all-zero the moment the cache was
  // switched on even though the live fetch was correct). Live is fast enough for
  // these, and the built-ins are where the caching actually pays off. Keyed on the
  // connector being built-in, NOT on whether it has custom METRICS — Amazon Ads is
  // a custom CONNECTOR that happens to use canonical metrics.
  const isBuiltIn = connector in BUILT_IN_CONNECTORS;
  if (accountId && isBigQueryConfigured() && isBuiltIn) {
    const key: SyncKey = { accountId, connector, groupBy, dateFrom, dateTo };
    try {
      const hit = await fetchFromBigQuery(key);
      if (hit) return hit;
    } catch {
      /* BigQuery unavailable → fall through to live Windsor */
    }
    const live = await doFetchFromWindsor(
      apiKey,
      dateFrom,
      dateTo,
      groupBy,
      cacheKey,
      accountId,
      connector,
    );
    try {
      after(() => writeWindsorRowsToBQ(key, live).catch(() => {}));
    } catch {
      /* not inside a request (cron/sync) — skip the background write */
    }
    return live;
  }
  return doFetchFromWindsor(apiKey, dateFrom, dateTo, groupBy, cacheKey, accountId, connector);
}

async function doFetchFromWindsor(
  apiKey: string,
  dateFrom: string,
  dateTo: string,
  groupBy: WindsorGroupBy,
  cacheKey: string,
  accountId?: string,
  connector: string = DEFAULT_CONNECTOR,
): Promise<WindsorRow[]> {
  // Non-Google connectors resolve their Windsor fields + dimension value from the
  // manifest. `genericFields` is null for Google Ads (keeps its bespoke path below).
  const genericFields =
    connector !== DEFAULT_CONNECTOR ? windsorFieldsFor(connector, groupBy) : null;
  const isGeneric = genericFields !== null;
  // windsorFieldsFor returns null for a dimension this connector doesn't have.
  // Falling through to FIELDS_BY_GROUP below would then quietly serve GOOGLE
  // ADS' field set to a different platform — the request succeeds, but asks for
  // clicks/impressions/spend instead of that platform's own metrics and omits
  // the cross-filter pivot, so the response looks like real data while being
  // mostly zeros with an unresolvable pivot. Refuse instead: a wrong dimension
  // is a caller bug, and silently answering it with another platform's schema
  // is far harder to notice than an error.
  if (connector !== DEFAULT_CONNECTOR && !isGeneric) {
    throw new Error(`Unknown dimension "${groupBy}" for connector "${connector}"`);
  }

  // Scope to a single Google Ads account when provided. Windsor reports the
  // account id in two formats — plain digits ("2177919789", in the account list)
  // and dash-grouped ("217-791-9789", in messages / connector docs). We send the
  // dash-grouped form to the server filter AND keep the raw `account_id` column so
  // we can re-filter client-side by digits — robust to whichever format the
  // connector actually matches on.
  const onlyDigits = (s: string) => s.replace(/\D/g, "");
  const toDashed = (s: string) => {
    const d = onlyDigits(s);
    return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : s;
  };
  let fields = genericFields ?? FIELDS_BY_GROUP[groupBy];
  if (accountId) fields += ",account_id";

  // Amazon Ads choke-point: Windsor 400s when fields from two of its reports
  // (sponsored_products_campaign, sponsored_brands_ad_group, …) are requested
  // together, and admin-layered metrics/dimensions can mix them in several ways.
  // Rather than police every layer, strip — right before the request — any
  // report-namespaced field that isn't from THIS breakdown's report (the report of
  // its dimension field, the first `sponsored_…` field). Generic fields (date,
  // account_id) and the dimension itself are always kept. This makes a cross-report
  // request structurally impossible; other-report metrics simply read 0 here.
  if (getConnector(connector).windsorSource === "amazon_ads") {
    const parts = fields.split(",");
    const dimField = parts.find((f) => f.startsWith("sponsored_") && f.includes("__"));
    if (dimField) {
      const prefix = dimField.slice(0, dimField.indexOf("__"));
      fields = parts
        .filter((f) => !f.startsWith("sponsored_") || f.startsWith(`${prefix}__`))
        .join(",");
    }
  }

  // WHICH source Windsor reads from: always this connector's own endpoint.
  //
  // Google Ads used to read from `/all`, which merges every source wired into
  // the Windsor account. That made it hostage to the others: connecting Search
  // Console — which only keeps 16 months — made `/all` reject any longer range
  // outright, and the Google Ads dashboard went blank for every breakdown at
  // once. Nothing about Google Ads had changed.
  //
  // Its own endpoint answers every breakdown over any range, and returns the
  // identical rows and totals on the ranges where `/all` still worked.
  const endpoint = getConnector(connector).windsorSource;

  // Facebook/Meta rejects any range whose start is beyond ~37 months from today
  // ("(#3018) The start date of the time range cannot be beyond 37 months …"),
  // so a wide range 400'd every Meta table instead of returning what it can.
  // Clamp the start to inside that window (36 months, a month of safety margin);
  // the rest of the range is served normally.
  let effectiveDateFrom = dateFrom;
  if (endpoint === "facebook") {
    const floor = new Date();
    floor.setMonth(floor.getMonth() - 36);
    const floorIso = floor.toISOString().slice(0, 10);
    if (effectiveDateFrom < floorIso) effectiveDateFrom = floorIso;
  }

  const fetchRows = async (useServerAccountFilter: boolean): Promise<Record<string, unknown>[]> => {
    const p = new URLSearchParams({
      api_key: apiKey,
      date_from: effectiveDateFrom,
      date_to: dateTo,
      fields,
    });
    if (accountId && useServerAccountFilter) p.set("account_id", toDashed(accountId));
    const ctrl = new AbortController();
    // Amazon generates its reports asynchronously and answers slowly, especially
    // the targeting / ad-group breakdowns on a first (cold) pull — give it more of
    // the route's 120s budget than the 90s default. It's a single request per
    // breakdown (no candidate loop for a custom connector), so this can't stack.
    const abortMs = endpoint.startsWith("amazon") ? 110_000 : 90_000;
    const timeoutId = setTimeout(() => ctrl.abort(), abortMs);
    let res: Response;
    try {
      res = await fetch(`https://connectors.windsor.ai/${endpoint}?${p}`, { signal: ctrl.signal });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError")
        throw new Error("Windsor.ai request timed out — try a smaller date range.");
      throw err;
    }
    clearTimeout(timeoutId);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Windsor.ai ${res.status}: ${body
          .replace(/<[^>]*>/g, "")
          .trim()
          .slice(0, 800)}`,
      );
    }
    const json = await res.json();
    return Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  };

  // Append the Google Ads channel type so the Campaign Type breakdown uses the REAL
  // type (SEARCH/DISPLAY/SHOPPING/PERFORMANCE_MAX…) instead of a name heuristic that
  // fails on non-English names. Windsor exposes it under different field ids per
  // account, and some ids are ACCEPTED but return an empty column — so we try each
  // candidate and keep the first that actually returns a POPULATED type (a candidate
  // that 200s with an empty type is rejected, not stopped on). If none work, fall
  // back to the base fields (name heuristic) rather than breaking the breakdown.
  const baseFields = fields;
  const isFieldError = (err: unknown) =>
    err instanceof Error && /\b400\b|field|column|invalid|not.*(found|exist)/i.test(err.message);

  // Some dimensions need an extra field whose Windsor id varies per account (and some
  // ids 200 with an EMPTY column). For those we try each candidate id and keep the
  // first that returns a POPULATED value; if none work we fall back to base fields.
  const wantsType =
    groupBy === "campaign" ||
    groupBy === "date,campaign" ||
    groupBy === "campaign_type" ||
    groupBy === "date,campaign_type";
  const wantsAd = groupBy === "ad" || groupBy === "date,ad";
  // Response keys the mapping reads for the channel type.
  const TYPE_KEYS = [
    "campaign_type",
    "advertising_channel_type",
    "campaign_advertising_channel_type",
  ];
  const rowsHaveType = (rs: Record<string, unknown>[]) =>
    rs.some((r) => TYPE_KEYS.some((k) => r[k] != null && String(r[k]).trim() !== ""));
  // Response keys the mapping reads for the ad identifier.
  const AD_KEYS = [
    "ad_name",
    "ad_group_ad_ad_name",
    "headline",
    "ad_id",
    "ad_group_ad_ad_id",
    "ad",
  ];
  const rowsHaveAd = (rs: Record<string, unknown>[]) =>
    rs.some((r) => AD_KEYS.some((k) => r[k] != null && String(r[k]).trim() !== ""));

  // The campaign breakdowns also want the serving status (ENABLED/PAUSED/
  // REMOVED). It's requested alongside the type: each type candidate is tried
  // with `,campaign_status` FIRST, then plain. If Windsor rejects the status
  // field (a 400), that variant is skipped and the plain one still resolves the
  // type — so a status the account doesn't expose can never cost us the type
  // column or break the fetch. When present it rides along for free.
  const wantsStatus = groupBy === "campaign" || groupBy === "date,campaign";
  const withStatus = (t: string) => (wantsStatus ? [`${t},campaign_status`, t] : [t]);

  // Field-id candidates to REQUEST. Request name+id together where possible so the
  // table shows a readable ad name but still works when only an id is exposed.
  const candidates: string[] = wantsType
    ? ["campaign_type", "advertising_channel_type", "campaign_advertising_channel_type"].flatMap(
        withStatus,
      )
    : wantsAd
      ? [
          "ad_id,ad_name",
          "ad_name",
          "ad_id",
          "ad_group_ad_ad_id,ad_group_ad_ad_name",
          "ad_group_ad_ad_name",
          "ad_group_ad_ad_id",
        ]
      : [];
  const rowsPopulated = wantsAd ? rowsHaveAd : rowsHaveType;

  // Fetch honouring the account scope (server filter first, unscoped refetch if the
  // server-side account filter returns nothing — the client-side digit filter below
  // is the real isolation).
  const runFetch = async (): Promise<Record<string, unknown>[]> => {
    let r = await fetchRows(true);
    if (accountId && r.length === 0) r = await fetchRows(false);
    return r;
  };

  let rows: Record<string, unknown>[] | null = null;
  for (const cf of candidates) {
    fields = `${baseFields},${cf}`; // fetchRows reads `fields` via closure
    try {
      const r = await runFetch();
      rows = r; // keep as fallback even if the extra column came back empty
      if (rowsPopulated(r)) break; // this candidate actually populated the value
    } catch (err) {
      if (!isFieldError(err)) throw err; // real error → surface it
      // field-shaped error → try the next candidate id
    }
  }
  if (rows === null) {
    // Dimension needs no extra field, or every candidate errored → base fields.
    fields = baseFields;
    rows = await runFetch();
  }
  // Client-side scope = the REAL isolation. Windsor IGNORES the &account_id= query
  // param (verified: it returns the same account's rows for any value), so we MUST
  // filter here. account_id is always present in the rows (we request it in fields),
  // so this is strict: keep ONLY the user's account, drop everything else — no other
  // client's data can leak. Compared via normalizeAccountId so Google Ads'
  // "2177919789" == "217-791-9789", while a non-numeric id (Search Console's
  // "sc-domain:example.com") is compared as-is instead of collapsing to "" and
  // matching everything.
  if (accountId) {
    const want = normalizeAccountId(accountId);
    rows = rows.filter(
      (r) =>
        normalizeAccountId(
          String(r.account_id ?? r.accountid ?? r.customer_id ?? r.external_account_id ?? ""),
        ) === want,
    );
  }

  // Admin-registered custom metrics for this connector (metric key -> raw
  // Windsor field name) — undefined/empty for built-ins and custom connectors
  // with none declared.
  const customMetricFields = getConnector(connector).customMetricFields;
  // The connector's primary entity for THIS row (campaign for Ads, channel for
  // GA4, product for Shopify…). The cross-filter engine joins every dimension
  // through it, but it can only be read HERE — the raw Windsor field
  // (default_channel_group, product_title, …) is dropped by the mapping below,
  // so resolving it client-side off the mapped row yielded "Unknown" for every
  // connector except Google Ads (whose `campaign` happens to survive).
  const primaryDimKey = getConnector(connector).primaryDimension;

  // Amazon Ads namespaces every metric by report (sponsored_products_campaign__clicks,
  // sponsored_products_targeting__clicks, …), and a row only ever carries ONE report's
  // fields — so match by suffix to fold whichever report THIS breakdown used into the
  // canonical metric. Only for amazon_ads; other sources keep their plain field names.
  const isAmazonAds = getConnector(connector).windsorSource === "amazon_ads";
  const amz = (row: Record<string, unknown>, suffix: string): number | undefined => {
    if (!isAmazonAds) return undefined;
    for (const k in row) if (k.endsWith(suffix)) return Number(row[k]) || 0;
    return undefined;
  };

  const mapped: WindsorRow[] = rows.map((r) => ({
    date: (r.date ?? r.day ?? null) as string | null,
    campaign: (r.campaign ?? r.campaign_name ?? null) as string | null,
    pivot: readDimensionValue(connector, primaryDimKey, r),
    // Real channel type if the source provides it (BigQuery does; Windsor's default
    // field set doesn't, so it stays null → the client falls back to a heuristic).
    campaign_type: (r.advertising_channel_type ??
      r.campaign_advertising_channel_type ??
      r.campaign_type ??
      null) as string | null,
    campaign_status: (r.campaign_status ?? r.status ?? null) as string | null,
    ad_group: (r.ad_group_name ?? r.ad_group ?? null) as string | null,
    keyword_text: (r.keyword ?? r.keyword_text ?? null) as string | null,
    match_type: (r.match_type ?? null) as string | null,
    dimension: isGeneric
      ? readDimensionValue(connector, groupBy, r)
      : normalizeDimension(r, groupBy),
    // Metric fallbacks span every connector's native field names so one mapper
    // serves all: sessions (GA4) and quantity (Shopify) count as traffic; orders
    // (Shopify) as conversions; total_sales / purchase_revenue as revenue.
    // Amazon Ads namespaces every metric by report (sponsored_products_campaign__*);
    // its fields are folded in here alongside GA4's sessions and Shopify's quantity.
    clicks:
      Number(
        r.clicks ??
          r.sessions ??
          r.line_item__quantity ??
          r.quantity ??
          amz(r, "__clicks") ??
          r.sales_and_traffic_report_by_date__trafficbyasin_sessions ??
          0,
      ) || 0,
    impressions:
      Number(
        r.impressions ??
          r.reach ??
          amz(r, "__impressions") ??
          r.sales_and_traffic_report_by_date__trafficbyasin_pageviews ??
          0,
      ) || 0,
    spend: Number(r.spend ?? r.cost ?? amz(r, "__cost") ?? 0),
    // Meta purchases: omni on entity tables, pixel (offsite_conversion) on the
    // delivery-breakdown tables (omni 400s there). order_count/orders is Shopify;
    // attributedconversions14d is Amazon's 14-day attributed conversions.
    conversions:
      Number(
        r.conversions ??
          r.actions_omni_purchase ??
          r.actions_offsite_conversion_fb_pixel_purchase ??
          r.order_count ??
          r.orders ??
          amz(r, "__attributedconversions14d") ??
          r.sales_and_traffic_report_by_date__salesbyasin_unitsordered ??
          0,
      ) || 0,
    conversion_value: Number(
      r.conversion_value ??
        r.action_values_omni_purchase ??
        r.action_values_offsite_conversion_fb_pixel_purchase ??
        r.revenue ??
        r.line_item__net_sales ??
        r.total_sales ??
        r.purchase_revenue ??
        r.conversionValue ??
        amz(r, "__attributedsales14d") ??
        r.sales_and_traffic_report_by_date__salesbyasin_orderedproductsales_amount ??
        0,
    ),
    extra: customMetricFields
      ? Object.fromEntries(
          Object.entries(customMetricFields).map(([key, field]) => [key, Number(r[field]) || 0]),
        )
      : undefined,
  }));

  windsorCache.set(cacheKey, { data: mapped, expires: Date.now() + WINDSOR_CACHE_TTL_MS });
  if (windsorCache.size > 40) {
    const now = Date.now();
    for (const [k, v] of windsorCache.entries()) if (v.expires < now) windsorCache.delete(k);
    // Still over cap → drop oldest (insertion order) to bound memory.
    while (windsorCache.size > 40) {
      const oldest = windsorCache.keys().next().value;
      if (oldest === undefined) break;
      windsorCache.delete(oldest);
    }
  }

  return mapped;
}

// GET for the normal reads; POST carries the same params but lets a large
// filter_self / filter_exclude ride in the body (a dropdown exclusion can be
// thousands of values — far past any URL length).
export async function GET(request: NextRequest) {
  return handle(request, {});
}
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    filter_self?: string[];
    filter_exclude?: string[];
  };
  return handle(request, body);
}

async function handle(
  request: NextRequest,
  body: { filter_self?: string[]; filter_exclude?: string[] },
) {
  await ensureCustomConnectorsLoaded();
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const groupBy = (searchParams.get("group_by") ?? "date") as WindsorGroupBy;
  const connector = searchParams.get("connector") ?? DEFAULT_CONNECTOR;

  // Decided here rather than upstream: see lib/requestGuards.
  const range = checkDateRange(dateFrom, dateTo);
  if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 });
  const known = checkConnector(connector);
  if (!known.ok) return NextResponse.json({ error: known.error }, { status: 400 });
  // Narrowed by checkDateRange above; named so the rest of the handler reads
  // them as the strings they now are.
  const from = range.from;
  const to = range.to;

  // Demo mode (admin "Mock data" switch sets the mf_demo cookie): serve generated
  // rows so the whole dashboard renders populated for a presentation, no Windsor
  // call and no account binding needed.
  if (request.cookies.get("mf_demo")?.value === "1") {
    return NextResponse.json({ data: mockWindsorRows(groupBy, from, to), source: "demo" });
  }

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

  const viewAs = searchParams.get("view_as");
  // Resolve the effective user (self, or an authorized view_as target) and read
  // that user's connection metadata to decide the data source.
  let targetUserId = user.id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let targetMeta: any = user.user_metadata;
  // app_metadata holds the SERVER-validated connected account (user can't edit it).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let targetAppMeta: any = user.app_metadata;
  let windsorKey: string | undefined = windsorApiKeyOf(user);

  if (viewAs && viewAs !== user.id && process.env.SUPABASE_SERVICE_ROLE_KEY) {
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
      // Authorize view_as ONLY on values the caller cannot forge. isPlatformAdmin
      // reads app_metadata; `targetTeamId === user.id` means the TARGET joined the
      // caller's team (the target set that, not the caller). The removed
      // `myTeamId === viewAs` / `myTeamId === targetTeamId` clauses trusted the
      // CALLER's own user_metadata.team_id — which any signed-in user can rewrite
      // via updateUser to a victim's id and read their data. Restore only once
      // team_id is server-set in app_metadata like is_admin.
      const authorized = isPlatformAdmin(user) || targetTeamId === user.id;
      if (authorized) {
        targetUserId = viewAs;
        targetMeta = target.user_metadata;
        targetAppMeta = target.app_metadata;
        windsorKey = windsorApiKeyOf(target);
      }
    }
  }

  // Optional server-side scoping for cross-filter fetches: narrow a date,<dim>
  // response to the selected dimension values (filter_self) or a contains term
  // (search). Without this, a date,search_term cross-fetch returns the WHOLE set
  // (tens of thousands of terms × dates) — a huge payload that times out / fails
  // to parse on the client, so the KPIs/charts never rebuild.
  const filterSelf = [...searchParams.getAll("filter_self"), ...(body.filter_self ?? [])];
  const filterExclude = [...searchParams.getAll("filter_exclude"), ...(body.filter_exclude ?? [])];
  const scopeSearch = (searchParams.get("search") ?? "").toLowerCase().trim();
  const scopeRows = (rows: WindsorRow[]): WindsorRow[] => {
    let out = rows;
    if (filterSelf.length > 0) {
      const set = new Set(filterSelf);
      out = out.filter((r) => set.has(r.dimension));
    }
    if (filterExclude.length > 0) {
      const set = new Set(filterExclude);
      out = out.filter((r) => !set.has(r.dimension));
    }
    if (scopeSearch) out = out.filter((r) => r.dimension.toLowerCase().includes(scopeSearch));
    return out;
  };

  // Account scope comes ONLY from app_metadata — server-validated at connect time
  // and not editable by the user. (No user_metadata fallback: that would let a user
  // set an arbitrary account_id and read another client's data.) It is resolved PER
  // SOURCE: each connector's co-user binding lives under windsor_accounts[<ds>];
  // google_ads also honours the legacy single windsor_account_id field.
  const accountId = windsorAccountIdFor(targetAppMeta, connector);
  // The shared workspace key (env) may ONLY be used together with the user's own
  // connected account scope — otherwise a user who hasn't connected anything would
  // see the ENTIRE shared workspace (data leak). Personal per-user keys are used
  // as-is. No personal key and no account = not connected → no data.
  if (!windsorKey && accountId) windsorKey = process.env.WINDSOR_API_KEY;

  // Windsor is the only source. (An internal BigQuery mirror used to be resolved
  // per user here — removed, see docs/bigquery-disabled.md.)
  if (windsorKey) {
    try {
      const data = scopeRows(
        await fetchFromWindsor(windsorKey, from, to, groupBy, accountId, connector),
      );
      return NextResponse.json({ data, source: "windsor" });
    } catch (err) {
      console.error("Windsor API Error:", err);
      const msg = err instanceof Error ? err.message : "Windsor.ai error";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // No key and no connected account. Named per connector so the message says
  // what is actually missing rather than "no data source".
  if (connector !== DEFAULT_CONNECTOR) {
    return NextResponse.json(
      { error: `${getConnector(connector).label} isn't connected for this account yet.` },
      { status: 503 },
    );
  }
  return NextResponse.json({ error: "No data source configured" }, { status: 503 });
}
