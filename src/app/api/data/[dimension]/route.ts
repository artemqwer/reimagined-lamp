import { isPlatformAdmin, windsorApiKeyOf } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { fetchFromWindsor, WindsorGroupBy } from "@/app/api/windsor/route";
import { matchMetric, readMetric, METRIC_KEYS, type MetricOp } from "@/lib/metricFilter";
import {
  getDimensionDef,
  getConnector,
  ensureCustomConnectorsLoaded,
  isAveragedMetric,
  DEFAULT_CONNECTOR,
} from "@/lib/connectors";

export const maxDuration = 120;

export interface PerfRow {
  dimension: string;
  impr: number;
  clicks: number;
  ctr: number;
  cpc: number;
  convRate: number;
  conv: number;
  cpa: number;
  revenue: number;
  cost: number;
  profit: number;
  roasVal: number;
  roas: string;
  roasColor: "green" | "orange" | "red" | "gray";
  // Admin-registered custom metrics (raw Windsor fields with no canonical
  // formula — see CustomConnectorMetricInput in connectors.ts), keyed by
  // metric key. Summed across the bucket, except percent/ratio-format ones
  // which are averaged (a bounce rate shouldn't be summed across rows).
  extra?: Record<string, number>;
}

export interface HeatRanges {
  // Admin-registered custom metrics get a range under their own key, so their
  // columns shade like every other one.
  [key: string]: { min: number; max: number };
  impr: { min: number; max: number };
  clicks: { min: number; max: number };
  ctr: { min: number; max: number };
  cpc: { min: number; max: number };
  convRate: { min: number; max: number };
  conv: { min: number; max: number };
  cpa: { min: number; max: number };
  revenue: { min: number; max: number };
  cost: { min: number; max: number };
  profit: { min: number; max: number };
}

export interface PerfTotals {
  totImpr: number;
  totClicks: number;
  totConv: number;
  totCost: number;
  totRev: number;
  totProfit: number;
  avgCpc: number;
  avgCtr: number;
  avgConvRate: number;
  avgCpa: number;
  roasVal: number;
  roasColor: string;
  // Totals for admin-registered custom metrics, keyed by metric key. Summed,
  // or averaged for percent/ratio metrics — the same convention the rows
  // themselves use. Absent when the connector has none.
  extra?: Record<string, number>;
}

const VALID_DIMENSIONS: WindsorGroupBy[] = [
  "campaign_type",
  "ad_group",
  "ad",
  "keyword",
  "match_type",
  "device",
  "network",
  "search_term",
  "audience",
  "country",
  "region",
  "hour",
  "day_of_week",
  "date",
  "week",
  "month",
  "quarter",
  "year",
];

type SortableKey = keyof Omit<PerfRow, "roas" | "roasColor">;
const VALID_SORT_COLS: SortableKey[] = [
  "dimension",
  "impr",
  "clicks",
  "ctr",
  "cpc",
  "convRate",
  "conv",
  "cpa",
  "revenue",
  "cost",
  "profit",
  "roasVal",
];

function computeRow(
  dimension: string,
  spend: number,
  convVal: number,
  clicks: number,
  impr: number,
  convs: number,
): PerfRow {
  const roasVal = spend > 0 ? convVal / spend : 0;
  const revenue = convVal / 1000;
  const cost = spend / 1000;
  const profit = (convVal - spend) / 1000;
  return {
    dimension,
    impr,
    clicks,
    ctr: impr > 0 ? (clicks / impr) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    convRate: clicks > 0 ? (convs / clicks) * 100 : 0,
    conv: convs,
    cpa: convs > 0 ? spend / convs : 0,
    revenue,
    cost,
    profit,
    roasVal,
    roas: spend > 0 ? `${roasVal.toFixed(2)}x` : "—",
    roasColor: spend === 0 ? "gray" : roasVal >= 1.5 ? "green" : roasVal >= 1.0 ? "orange" : "red",
  };
}

// POST accepts a large `filter_self` (dropdown value selection) in the JSON body
// so the table can be narrowed to thousands of selected values without hitting the
// URL-length limit that a GET query string would. Everything else stays in the
// query string; we merge the body values in and delegate to the GET handler.
export async function POST(request: NextRequest, ctx: { params: Promise<{ dimension: string }> }) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const url = new URL(request.url);
  const merge = (key: string) => {
    const v = (body as Record<string, unknown>)[key];
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(key, String(x)));
  };
  merge("filter_self");
  merge("filter_exclude");
  merge("filter_campaign");
  merge("filter_ad_group");
  merge("filter_keyword");
  // cookies() reads the ambient request context (not this object), so auth is
  // preserved; we only need the merged URL for GET's searchParams.
  return GET(new NextRequest(url), ctx);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dimension: string }> },
) {
  await ensureCustomConnectorsLoaded();
  const { dimension } = await params;
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "Missing date_from or date_to" }, { status: 400 });
  }

  // Which connector's schema to use. Google Ads keeps the built-in VALID_DIMENSIONS;
  // other connectors validate against their manifest dimensions instead.
  const connector = searchParams.get("connector") ?? DEFAULT_CONNECTOR;
  const dimensionOk =
    connector === DEFAULT_CONNECTOR
      ? VALID_DIMENSIONS.includes(dimension as WindsorGroupBy)
      : getDimensionDef(connector, dimension) !== null;
  if (!dimensionOk) {
    return NextResponse.json({
      data: [],
      total: 0,
      totals: null,
      heat: null,
      source: "unsupported",
    });
  }

  // Server-side pagination / sort / filter params
  const namesOnly = searchParams.get("names_only") === "true";
  // namesLimit: how many names to return in dropdown mode. Default 300 (fast).
  // When the user types a search query, the client sends a larger limit or
  // the search already narrows results server-side so all matches are returned.
  const namesLimit = Math.min(
    2000,
    Math.max(1, parseInt(searchParams.get("names_limit") ?? "300", 10)),
  );
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(2000, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  const rawSort = searchParams.get("sort") ?? "dimension";
  // Custom metric columns are sortable as well. They have no PerfRow field of
  // their own, so an unknown key used to fall back to "dimension" — clicking
  // such a header appeared to do nothing.
  const sortableCustom = Object.keys(getConnector(connector).customMetricFields ?? {});
  const sortCol = (
    VALID_SORT_COLS.includes(rawSort as SortableKey) || sortableCustom.includes(rawSort)
      ? rawSort
      : "dimension"
  ) as SortableKey;
  const sortDir = searchParams.get("sort_dir") === "asc" ? "asc" : "desc";
  const search = (searchParams.get("search") ?? "").toLowerCase().trim();
  const statusFilter = searchParams.get("status") ?? "All";
  // Universal numeric metric filter (replaces the old Good/OK/Poor ROAS categories):
  // metric = row field key, op = comparison, value/value2 = threshold(s).
  const metricKey = searchParams.get("metric") ?? "";
  const metricOp = (searchParams.get("op") ?? "") as MetricOp;
  const metricV1 = parseFloat(searchParams.get("value") ?? "");
  const metricV2 = parseFloat(searchParams.get("value2") ?? "");
  const metricActive =
    (METRIC_KEYS.includes(metricKey) ||
      metricKey in (getConnector(connector).customMetricFields ?? {})) &&
    ["gt", "gte", "lt", "lte", "eq", "between"].includes(metricOp) &&
    Number.isFinite(metricV1) &&
    (metricOp !== "between" || Number.isFinite(metricV2));
  const filterSelf = searchParams.getAll("filter_self");
  const filterExclude = searchParams.getAll("filter_exclude");

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

  let targetUserId = user.id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let targetMeta: any = user.user_metadata;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let targetAppMeta: any = user.app_metadata;
  let windsorKey: string | undefined = windsorApiKeyOf(user);

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

  // Account scope comes ONLY from app_metadata (server-validated, not user-editable),
  // resolved PER SOURCE: each connector's co-user binding lives under
  // windsor_accounts[<ds>]; google_ads also honours the legacy windsor_account_id.
  // The shared env key is ONLY used together with the user's own account scope.
  const ds = getConnector(connector).windsorSource;
  const boundAccounts = (targetAppMeta?.windsor_accounts ?? {}) as Record<
    string,
    { account_id?: string }
  >;
  const accountId =
    boundAccounts[ds]?.account_id ||
    (connector === DEFAULT_CONNECTOR
      ? (targetAppMeta?.windsor_account_id as string | undefined)
      : undefined) ||
    undefined;
  if (!windsorKey && accountId) windsorKey = process.env.WINDSOR_API_KEY;

  // Windsor is the only source, so a key is always required.
  if (!windsorKey) {
    return NextResponse.json({ error: "No data source configured" }, { status: 503 });
  }

  const filterCampaigns = searchParams.getAll("filter_campaign");
  const filterAdGroups = searchParams.getAll("filter_ad_group");
  const filterKeywords = searchParams.getAll("filter_keyword");

  try {
    const rawAll = await fetchFromWindsor(
      windsorKey,
      dateFrom,
      dateTo,
      dimension as WindsorGroupBy,
      accountId,
      connector,
    );
    let raw = rawAll;
    // `filter_campaign` scopes a breakdown to the primary table's selection.
    // It used to compare against `r.campaign`, which only exists on Google Ads
    // rows — so on every other connector the predicate was vacuously true and
    // the selection silently did nothing. `pivot` is that same value resolved
    // per connector (campaign / channel / product / …). Rows whose pivot
    // couldn't be resolved stay in, matching the previous `!r.campaign`
    // lenience rather than vanishing from the table.
    if (filterCampaigns.length > 0) {
      const scoped = raw.filter((r) => {
        const p = r.pivot && r.pivot !== "Unknown" ? r.pivot : null;
        return !p || filterCampaigns.includes(p);
      });
      // If not one row matched, the values aren't primary-entity values at all
      // (a mislabelled filter) rather than a selection that genuinely covers
      // nothing. Narrowing to zero there wipes the table for a reason the user
      // can't see, so leave it unscoped instead.
      raw = scoped.length > 0 ? scoped : raw;
    }
    if (filterAdGroups.length > 0)
      raw = raw.filter((r) => !r.ad_group || filterAdGroups.includes(r.ad_group));
    if (filterKeywords.length > 0)
      raw = raw.filter((r) => !r.keyword_text || filterKeywords.includes(r.keyword_text));

    // Aggregate by dimension value
    const map = new Map<
      string,
      {
        spend: number;
        convVal: number;
        clicks: number;
        impr: number;
        convs: number;
        extraSum: Record<string, number>;
        rows: number;
      }
    >();
    for (const r of raw) {
      const key = r.dimension || "Unknown";
      const cur = map.get(key) ?? {
        spend: 0,
        convVal: 0,
        clicks: 0,
        impr: 0,
        convs: 0,
        extraSum: {},
        rows: 0,
      };
      const extraSum = { ...cur.extraSum };
      if (r.extra)
        for (const [k, v] of Object.entries(r.extra)) extraSum[k] = (extraSum[k] ?? 0) + v;
      map.set(key, {
        spend: cur.spend + r.spend,
        convVal: cur.convVal + r.conversion_value,
        clicks: cur.clicks + r.clicks,
        impr: cur.impr + r.impressions,
        convs: cur.convs + r.conversions,
        extraSum,
        rows: cur.rows + 1,
      });
    }

    // Percent/ratio-format custom metrics are averaged across the bucket
    // instead of summed (e.g. a bounce rate isn't meaningful added up).
    const averagedMetricKeys = new Set(
      getConnector(connector)
        .metrics.filter((m) => isAveragedMetric(connector, m.key))
        .map((m) => m.key),
    );

    let allRows: PerfRow[] = Array.from(map.entries()).map(([dim, v]) => {
      const row = computeRow(dim, v.spend, v.convVal, v.clicks, v.impr, v.convs);
      if (Object.keys(v.extraSum).length > 0) {
        row.extra = Object.fromEntries(
          Object.entries(v.extraSum).map(([k, sum]) => [
            k,
            averagedMetricKeys.has(k) ? sum / v.rows : sum,
          ]),
        );
      }
      return row;
    });

    // Apply filters server-side
    if (filterSelf.length > 0) allRows = allRows.filter((r) => filterSelf.includes(r.dimension));
    // Exclusion filter (Data Studio style — unchecked values removed from the report)
    if (filterExclude.length > 0)
      allRows = allRows.filter((r) => !filterExclude.includes(r.dimension));
    if (search) allRows = allRows.filter((r) => r.dimension.toLowerCase().includes(search));
    if (statusFilter === "Active") allRows = allRows.filter((r) => r.cost > 0);
    else if (statusFilter === "Paused") allRows = allRows.filter((r) => r.cost === 0);
    if (metricActive) {
      allRows = allRows.filter((r) =>
        matchMetric(readMetric(r, metricKey), metricOp, metricV1, metricV2),
      );
    }

    // names_only mode — return dimension names sorted by cost.
    // Returns top `namesLimit` names (default 300) + total count for the hint.
    // When search is active, the filtered set is usually small so limit doesn't matter.
    if (namesOnly) {
      allRows.sort((a, b) => b.cost - a.cost);
      const totalNames = allRows.length;
      const sliced = search ? allRows : allRows.slice(0, namesLimit);
      return NextResponse.json({
        names: sliced.map((r) => r.dimension),
        total_names: totalNames,
        truncated: !search && totalNames > namesLimit,
      });
    }

    const total = allRows.length;

    // Totals across all filtered rows
    const totImpr = allRows.reduce((s, r) => s + r.impr, 0);
    const totClicks = allRows.reduce((s, r) => s + r.clicks, 0);
    const totConv = allRows.reduce((s, r) => s + r.conv, 0);
    const totCost = allRows.reduce((s, r) => s + r.cost, 0);
    const totRev = allRows.reduce((s, r) => s + r.revenue, 0);
    const totProfit = allRows.reduce((s, r) => s + r.profit, 0);
    const totSpend = totCost * 1000;
    const totRevRaw = totRev * 1000;
    const roasVal = totSpend > 0 ? totRevRaw / totSpend : 0;
    const totals: PerfTotals = {
      totImpr,
      totClicks,
      totConv,
      totCost,
      totRev,
      totProfit,
      avgCpc: totClicks > 0 ? totSpend / totClicks : 0,
      avgCtr: totImpr > 0 ? (totClicks / totImpr) * 100 : 0,
      avgConvRate: totClicks > 0 ? (totConv / totClicks) * 100 : 0,
      avgCpa: totConv > 0 ? totSpend / totConv : 0,
      roasVal,
      roasColor: roasVal >= 1.5 ? "green" : roasVal >= 1.0 ? "orange" : "red",
    };
    // Custom metrics need their own totals, or the footer has nothing to show
    // for those columns and renders them blank. Computed over ALL filtered
    // rows, like every other total here — a client-side sum would only cover
    // the current page.
    const customTotalKeys = Object.keys(getConnector(connector).customMetricFields ?? {});
    if (customTotalKeys.length > 0 && allRows.length > 0) {
      totals.extra = Object.fromEntries(
        customTotalKeys.map((k) => {
          const sum = allRows.reduce((s, r) => s + (r.extra?.[k] ?? 0), 0);
          return [k, averagedMetricKeys.has(k) ? sum / allRows.length : sum];
        }),
      );
    }

    // Heat ranges across all filtered rows (use reduce to avoid spread limit on large arrays)
    const heatKey = (k: keyof PerfRow): { min: number; max: number } => ({
      min: allRows.reduce((m, r) => Math.min(m, r[k] as number), 0),
      max: allRows.reduce((m, r) => Math.max(m, r[k] as number), 1),
    });
    const heat: HeatRanges = {
      impr: heatKey("impr"),
      clicks: heatKey("clicks"),
      ctr: heatKey("ctr"),
      cpc: heatKey("cpc"),
      convRate: heatKey("convRate"),
      conv: heatKey("conv"),
      cpa: heatKey("cpa"),
      revenue: heatKey("revenue"),
      cost: heatKey("cost"),
      profit: heatKey("profit"),
    };
    // Same ranges for the admin-registered metrics, read from each row's own
    // `extra` bag rather than a dedicated field.
    for (const k of customTotalKeys) {
      heat[k] = {
        min: allRows.reduce((m, r) => Math.min(m, r.extra?.[k] ?? 0), 0),
        max: allRows.reduce((m, r) => Math.max(m, r.extra?.[k] ?? 0), 1),
      };
    }

    // Sort then paginate. A custom metric has no field of its own, so fall back
    // to the row's `extra` bag — but only for the value, since `dimension`
    // itself is a string and must still compare as one.
    const sortValue = (r: PerfRow): number | string => {
      const direct = (r as unknown as Record<string, unknown>)[sortCol];
      if (direct !== undefined && direct !== null) return direct as number | string;
      return r.extra?.[sortCol] ?? 0;
    };
    allRows.sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    const data = allRows.slice((page - 1) * limit, page * limit);

    return NextResponse.json({ data, total, totals, heat, source: "windsor" });
  } catch (err) {
    console.error("API Error on dimension " + dimension + ":", err);
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
