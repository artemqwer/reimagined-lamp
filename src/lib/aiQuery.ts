import { fetchFromWindsor, WindsorGroupBy } from "@/app/api/windsor/route";
import { getConnector, aiQueryDimensionsFor, DEFAULT_CONNECTOR } from "@/lib/connectors";

// Dimensions the AI is allowed to query on demand. These map 1:1 to Windsor
// group-bys whose rows also carry `campaign`, so we can scope any breakdown to a
// single campaign in-memory (e.g. device performance for "Men Clothes").
export const QUERY_DIMENSIONS = [
  "campaign",
  "ad_group",
  "keyword",
  "search_term",
  "match_type",
  "device",
  "network",
  "audience",
  "country",
  "region",
  "date",
  "day_of_week",
  "hour",
  "week",
  "month",
  "quarter",
  "year",
] as const;

export type QueryDimension = (typeof QUERY_DIMENSIONS)[number];

const SORT_KEYS = [
  "cost",
  "clicks",
  "conv",
  "revenue",
  "roas",
  "cpa",
  "profit",
  "impressions",
] as const;

// JSON-schema for the tool, shared by both providers (Gemini = bare schema,
// Groq/OpenAI = wrapped in { type: "function", function: { … } }).
export const QUERY_DATA_PARAMETERS = {
  type: "object",
  properties: {
    dimension: {
      type: "string",
      enum: [...QUERY_DIMENSIONS],
      description:
        "Which breakdown to fetch. Use 'date' for individual calendar dates (e.g. 'which date lost the most money'); also ad_group, keyword, search_term, device, network, audience, country, day_of_week, hour, week, month, quarter, year, campaign.",
    },
    campaign: {
      type: "string",
      description:
        "Optional. Restrict to campaigns whose name CONTAINS this text, case-insensitive (e.g. 'Men Clothes' matches 'Search - Men Clothes').",
    },
    search: {
      type: "string",
      description:
        "Optional. Only return rows whose dimension value CONTAINS this text (e.g. a word like 'куртка' to find matching search terms/keywords).",
    },
    sort_by: {
      type: "string",
      enum: [...SORT_KEYS],
      description: "Metric to sort rows by. Default 'cost'.",
    },
    sort_dir: {
      type: "string",
      enum: ["desc", "asc"],
      description:
        "Sort direction. 'desc' (default) for largest first; use 'asc' for smallest/most-negative first — e.g. to find the date or item that LOST the most money, sort by 'profit' ascending.",
    },
    limit: {
      type: "number",
      description: "Max rows to return (default 12, max 25).",
    },
  },
  required: ["dimension"],
};

export const QUERY_DATA_TOOL = {
  name: "query_data",
  description: [
    "Fetch a REAL breakdown of the connected Google Ads account for the CURRENTLY selected period.",
    "Use this whenever the user asks about anything not already in the provided context — ad groups, keywords, search terms, devices, networks, audiences, countries/regions, day of week, hour, or time buckets (week/month/quarter/year).",
    "You can scope to a single campaign (campaign param) and/or filter the values (search param), and you may call it multiple times before answering.",
    "ALWAYS query real data instead of telling the user you don't have it.",
  ].join(" "),
  parameters: QUERY_DATA_PARAMETERS,
};

// OpenAI / Groq tool shape.
export const QUERY_DATA_TOOL_OAI = {
  type: "function" as const,
  function: {
    name: QUERY_DATA_TOOL.name,
    description: QUERY_DATA_TOOL.description,
    parameters: QUERY_DATA_PARAMETERS,
  },
};

// ─── Per-connector tool ──────────────────────────────────────────────────────
// The constants above stay as Google Ads' (unchanged) shape. Every other source
// has different breakdowns and no ad spend, so the tool it is offered is built
// from its manifest: the model can only pick dimensions that exist, and can only
// sort by metrics the source actually has.

export function sortKeysFor(connectorId: string): string[] {
  const c = getConnector(connectorId);
  // Cost-free sources have no cost / ROAS / CPA / profit to sort on.
  return c.hasCost ? [...SORT_KEYS] : ["revenue", "conv", "clicks"];
}

/** Google Ads' breakdowns, plus any the admin added to it. QUERY_DIMENSIONS is
 *  a fixed list that predates admin-added dimensions, so on its own it hides
 *  them from the AI exactly like aiDimensions used to for the other sources. */
export function googleAdsQueryDimensions(): string[] {
  return [...new Set([...QUERY_DIMENSIONS, ...aiQueryDimensionsFor(DEFAULT_CONNECTOR)])];
}

export function queryDataToolFor(connectorId: string) {
  const c = getConnector(connectorId);
  if (c.id === DEFAULT_CONNECTOR) {
    const dims = googleAdsQueryDimensions();
    // Keep the hand-written Google Ads tool as-is unless an admin has added
    // dimensions to it, in which case the enum has to grow or the model can't
    // name them.
    if (dims.length === QUERY_DIMENSIONS.length) return QUERY_DATA_TOOL;
    return {
      ...QUERY_DATA_TOOL,
      parameters: {
        ...QUERY_DATA_PARAMETERS,
        properties: {
          ...QUERY_DATA_PARAMETERS.properties,
          dimension: { ...QUERY_DATA_PARAMETERS.properties.dimension, enum: dims },
        },
      },
    };
  }

  const dims = aiQueryDimensionsFor(c.id);
  const sortKeys = sortKeysFor(c.id);
  const entity = c.primaryLabel.toLowerCase();

  return {
    name: "query_data",
    description: [
      `Fetch a REAL breakdown of the connected ${c.label} account for the CURRENTLY selected period.`,
      `Available breakdowns: ${dims.join(", ")}.`,
      c.hasCost
        ? "Metrics include cost, ROAS and profit."
        : `${c.label} has NO ad spend — there is no cost, CPA, ROAS or profit. Never report or reason about them; talk about ${entity}s, ${c.metrics.map((m) => m.label.toLowerCase()).join(", ")} instead.`,
      "Use the search param to filter values, and call it multiple times before answering if needed.",
      "ALWAYS query real data instead of telling the user you don't have it.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        dimension: {
          type: "string",
          enum: dims,
          description: `Which breakdown to fetch. Use 'date' for individual calendar dates; otherwise one of: ${dims.join(", ")}.`,
        },
        search: {
          type: "string",
          description: `Optional. Only return rows whose ${entity} name CONTAINS this text (case-insensitive).`,
        },
        sort_by: {
          type: "string",
          enum: sortKeys,
          description: `Metric to sort rows by. Default '${sortKeys[0]}'.`,
        },
        sort_dir: {
          type: "string",
          enum: ["desc", "asc"],
          description: "Sort direction. 'desc' (default) for largest first.",
        },
        limit: { type: "number", description: "Max rows to return (default 12, max 25)." },
      },
      required: ["dimension"],
    },
  };
}

export function queryDataToolOaiFor(connectorId: string) {
  const t = queryDataToolFor(connectorId);
  return {
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

// ─── Campaign settings (bid strategy, budget, status, type) ──────────────────
// These are configuration fields, not the performance metrics query_data returns.

const CAMPAIGN_SETTINGS_PARAMETERS = {
  type: "object",
  properties: {
    campaign: {
      type: "string",
      description:
        "Optional. Only return campaigns whose name contains this text (case-insensitive).",
    },
  },
};

export const CAMPAIGN_SETTINGS_TOOL = {
  name: "campaign_settings",
  description: [
    "Fetch campaign SETTINGS (configuration, not performance metrics): bidding strategy, campaign type/channel, status, daily budget, and target ROAS / target CPA.",
    "Use this for questions about how a campaign is set up — e.g. 'what bid strategy does the Shoes campaign use', 'what's the budget/status of campaign X'.",
    "Optionally filter by campaign name. (Performance numbers come from query_data instead.)",
  ].join(" "),
  parameters: CAMPAIGN_SETTINGS_PARAMETERS,
};

export const CAMPAIGN_SETTINGS_TOOL_OAI = {
  type: "function" as const,
  function: {
    name: CAMPAIGN_SETTINGS_TOOL.name,
    description: CAMPAIGN_SETTINGS_TOOL.description,
    parameters: CAMPAIGN_SETTINGS_PARAMETERS,
  },
};

// Windsor "all" connector fields for campaign configuration. Best-effort: if the
// connector doesn't expose some of these, Windsor returns an error and we report
// it gracefully so the assistant can say settings aren't available.
const SETTINGS_FIELDS =
  "campaign,bidding_strategy_type,advertising_channel_type,campaign_budget_amount,campaign_status,target_roas,target_cpa";

export interface CampaignSettingsArgs {
  campaign?: string;
}

export async function executeCampaignSettings(
  windsorKey: string | undefined,
  dateFrom: string,
  dateTo: string,
  args: CampaignSettingsArgs,
  accountId?: string,
): Promise<Record<string, unknown>> {
  if (!windsorKey) {
    return {
      error:
        "No data source is connected. Tell the user to connect Windsor.ai / Google Ads in Data Sources.",
    };
  }
  if (!dateFrom || !dateTo) {
    return { error: "No date range available for the query." };
  }
  const campaignFilter = String(args.campaign ?? "")
    .toLowerCase()
    .trim();
  const onlyDigits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
  const toDashed = (s: string) => {
    const d = onlyDigits(s);
    return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : s;
  };
  const fields = accountId ? `${SETTINGS_FIELDS},account_id` : SETTINGS_FIELDS;
  const params = new URLSearchParams({
    api_key: windsorKey,
    date_from: dateFrom,
    date_to: dateTo,
    fields,
  });
  if (accountId) params.set("account_id", toDashed(accountId));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try {
    const res = await fetch(`https://connectors.windsor.ai/all?${params}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = (await res.text())
        .replace(/<[^>]*>/g, "")
        .trim()
        .slice(0, 200);
      return {
        error: `Campaign settings aren't available from this data source (Windsor ${res.status}). The bidding-strategy fields may not be enabled for this Google Ads account. ${body}`,
      };
    }
    json = await res.json();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to fetch campaign settings." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  // Windsor IGNORES the &account_id= server filter (it returns the whole
  // workspace for any value), so account isolation MUST be enforced here. STRICT,
  // like /api/windsor: keep ONLY the connected account's rows — account_id is
  // requested in the field list above, so every row carries it. A row with a
  // blank or different account_id belongs to another account and is dropped,
  // never leaked (the previous `a === ""` pass-through was a soft isolation edge).
  if (accountId) {
    const want = onlyDigits(accountId);
    rows = rows.filter((r) => {
      const a = onlyDigits(r.account_id ?? r.accountid ?? r.customer_id ?? r.external_account_id);
      return a === want;
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byCampaign = new Map<string, any>();
  for (const r of rows) {
    const name = r.campaign ?? r.campaign_name;
    if (!name || byCampaign.has(name)) continue;
    byCampaign.set(name, {
      campaign: name,
      bidding_strategy: r.bidding_strategy_type ?? r.bidding_strategy ?? null,
      campaign_type: r.advertising_channel_type ?? null,
      status: r.campaign_status ?? r.status ?? null,
      daily_budget: r.campaign_budget_amount ?? r.budget_amount ?? null,
      target_roas: r.target_roas ?? null,
      target_cpa: r.target_cpa ?? null,
    });
  }

  let list = Array.from(byCampaign.values());
  if (campaignFilter)
    list = list.filter((c) => String(c.campaign).toLowerCase().includes(campaignFilter));

  if (list.length === 0) {
    return {
      note: campaignFilter
        ? `No campaign matching "${args.campaign}" was found (or the settings fields aren't available for this account).`
        : "No campaign settings were returned — the bidding-strategy fields may not be enabled for this Windsor / Google Ads account.",
      campaigns: [],
    };
  }

  return {
    date_range: `${dateFrom} to ${dateTo}`,
    count: list.length,
    campaigns: list.slice(0, 25),
  };
}

// ─── Show on dashboard (apply filters from chat) ─────────────────────────────
// Dashboard cross-filter keys the client knows how to apply.
export const DASHBOARD_FILTER_KEYS = [
  "campaign_name",
  "device",
  "network",
  "match_type",
  "ad_group",
  "keyword",
  "search_term",
  "audience",
  "country",
  "region",
  "day_of_week",
  "hour",
] as const;

/** Filter keys the "Show on dashboard" action may use for a source: its own
 *  breakdowns (including admin-added ones), plus the two fixed keys the primary
 *  table stores its selection under whatever the connector. A fixed Google Ads
 *  list here meant the model was offered dimensions the source doesn't have,
 *  and its action was then discarded for naming one it does. */
export function dashboardFilterKeysFor(connectorId: string): string[] {
  return [...new Set(["campaign_name", "campaign_selected", ...aiQueryDimensionsFor(connectorId)])];
}

const SHOW_ON_DASHBOARD_PARAMETERS = {
  type: "object",
  properties: {
    label: {
      type: "string",
      description: "Short button/summary label, e.g. 'Show Mobile · Shoes campaign'.",
    },
    filters: {
      type: "array",
      description:
        "Cross-filters to apply. Each item targets one dimension. Usually one or two items.",
      items: {
        type: "object",
        properties: {
          dimension: {
            type: "string",
            enum: [...DASHBOARD_FILTER_KEYS],
            description:
              "Use 'campaign_name' for a campaign; otherwise device/network/match_type/ad_group/keyword/search_term/audience/country/region/day_of_week/hour. (For a date period use date_from/date_to, not a filter.)",
          },
          values: {
            type: "array",
            items: { type: "string" },
            description:
              "Exact dimension values to filter to (e.g. ['Mobile'] or ['Search - Men Shoes']). Use for a small, specific set.",
          },
          search: {
            type: "string",
            description:
              "A 'contains' filter: applies to ALL values of this dimension containing this text (e.g. search='куртка' selects every search term with that word). Prefer this over listing values for high-cardinality dimensions like search_term/keyword. Provide EITHER values OR search.",
          },
        },
        required: ["dimension"],
      },
    },
    date_from: {
      type: "string",
      description: "Optional YYYY-MM-DD — narrow the dashboard period start.",
    },
    date_to: {
      type: "string",
      description: "Optional YYYY-MM-DD — narrow the dashboard period end.",
    },
  },
  required: ["label"],
};

export const SHOW_ON_DASHBOARD_TOOL = {
  name: "show_on_dashboard",
  description: [
    "Attach a one-click 'Show on dashboard' button to your answer that applies the exact filters you analyzed to the live dashboard — rebuilding the charts and tables to match.",
    "Call this when your answer is about a specific slice the user could view: a campaign, device, network, match type, ad group, keyword, search term, audience, country/region, and/or a narrower date range.",
    "Provide the filters with the precise dimension values, plus a short label. Use exact values as they appear in the data.",
  ].join(" "),
  parameters: SHOW_ON_DASHBOARD_PARAMETERS,
};

/** SHOW_ON_DASHBOARD_TOOL with the enum narrowed to this source's own keys. */
export function showOnDashboardToolFor(connectorId: string) {
  const keys = dashboardFilterKeysFor(connectorId);
  return {
    ...SHOW_ON_DASHBOARD_TOOL,
    parameters: {
      ...SHOW_ON_DASHBOARD_PARAMETERS,
      properties: {
        ...SHOW_ON_DASHBOARD_PARAMETERS.properties,
        filters: {
          ...SHOW_ON_DASHBOARD_PARAMETERS.properties.filters,
          items: {
            ...SHOW_ON_DASHBOARD_PARAMETERS.properties.filters.items,
            properties: {
              ...SHOW_ON_DASHBOARD_PARAMETERS.properties.filters.items.properties,
              dimension: {
                ...SHOW_ON_DASHBOARD_PARAMETERS.properties.filters.items.properties.dimension,
                enum: keys,
                description: `Which breakdown to filter by. One of: ${keys.join(", ")}. (For a date period use date_from/date_to, not a filter.)`,
              },
            },
          },
        },
      },
    },
  };
}

export function showOnDashboardToolOaiFor(connectorId: string) {
  const t = showOnDashboardToolFor(connectorId);
  return {
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

export const SHOW_ON_DASHBOARD_TOOL_OAI = {
  type: "function" as const,
  function: {
    name: SHOW_ON_DASHBOARD_TOOL.name,
    description: SHOW_ON_DASHBOARD_TOOL.description,
    parameters: SHOW_ON_DASHBOARD_PARAMETERS,
  },
};

// Normalize raw tool args into a FilterAction-shaped object (defensive: the model
// may omit fields or send odd types). Returns null if nothing usable.
export function normalizeFilterAction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  connectorId: string = DEFAULT_CONNECTOR,
): {
  label: string;
  filters?: { dimension: string; values?: string[]; search?: string }[];
  date_from?: string;
  date_to?: string;
} | null {
  if (!args || typeof args !== "object") return null;
  const keys = new Set<string>(dashboardFilterKeysFor(connectorId));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawFilters: any[] = Array.isArray(args.filters) ? args.filters : [];
  const filters = rawFilters
    .map((f) => {
      const dimension = String(f?.dimension ?? "");
      const values = Array.isArray(f?.values)
        ? f.values.map((v: unknown) => String(v)).filter(Boolean)
        : [];
      const search = typeof f?.search === "string" ? f.search.trim() : "";
      return { dimension, ...(values.length ? { values } : {}), ...(search ? { search } : {}) };
    })
    .filter((f) => keys.has(f.dimension) && ((f.values && f.values.length > 0) || !!f.search));
  const date_from =
    typeof args.date_from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date_from)
      ? args.date_from
      : undefined;
  const date_to =
    typeof args.date_to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date_to)
      ? args.date_to
      : undefined;
  if (filters.length === 0 && !date_from && !date_to) return null;
  return {
    label: String(args.label ?? "Show on dashboard"),
    filters: filters.length ? filters : undefined,
    date_from,
    date_to,
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r0 = (n: number) => Math.round(n);

export interface DataQueryArgs {
  dimension?: string;
  campaign?: string;
  search?: string;
  sort_by?: string;
  sort_dir?: string;
  limit?: number;
}

// Executes a query_data tool call. Returns a compact, model-friendly JSON object
// (numbers rounded, top-N rows + grand totals + match count). All metrics are in
// raw account units: spend/revenue/profit in dollars.
export async function executeDataQuery(
  windsorKey: string | undefined,
  dateFrom: string,
  dateTo: string,
  args: DataQueryArgs,
  userId?: string,
  accountId?: string,
  connector: string = DEFAULT_CONNECTOR,
): Promise<Record<string, unknown>> {
  if (!windsorKey) {
    return {
      error:
        "No data source is connected. Tell the user to connect Windsor.ai / Google Ads in Data Sources.",
    };
  }
  if (!dateFrom || !dateTo) {
    return { error: "No date range available for the query." };
  }
  // Google Ads keeps its full dimension list; every other source is restricted to
  // the breakdowns its own manifest resolves.
  const isGoogle = connector === DEFAULT_CONNECTOR;
  const allowedDims: readonly string[] = isGoogle
    ? googleAdsQueryDimensions()
    : aiQueryDimensionsFor(connector);

  const dimension = String(args.dimension ?? "")
    .toLowerCase()
    .trim();
  if (!allowedDims.includes(dimension)) {
    return {
      error: `Unknown dimension "${dimension}". Valid dimensions: ${allowedDims.join(", ")}.`,
    };
  }
  const campaignFilter = String(args.campaign ?? "")
    .toLowerCase()
    .trim();
  const search = String(args.search ?? "")
    .toLowerCase()
    .trim();
  // A cost-free source can't be sorted by cost, so fall back to its revenue.
  const defaultSort = getConnector(connector).hasCost ? "cost" : "revenue";
  const sortBy = (SORT_KEYS as readonly string[]).includes(String(args.sort_by))
    ? String(args.sort_by)
    : defaultSort;
  const sortDir = args.sort_dir === "asc" ? "asc" : "desc";
  const limit = Math.min(25, Math.max(1, Number(args.limit) || 12));

  let raw;
  try {
    raw = await fetchFromWindsor(
      windsorKey,
      dateFrom,
      dateTo,
      dimension as WindsorGroupBy,
      accountId,
      connector,
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Data fetch failed." };
  }

  if (campaignFilter) {
    raw = raw.filter((r) => r.campaign && r.campaign.toLowerCase().includes(campaignFilter));
    if (raw.length === 0) {
      return {
        dimension,
        campaign_filter: args.campaign,
        note: `No rows found for a campaign matching "${args.campaign}". The campaign name may differ — try querying dimension "campaign" first to see exact names.`,
        rows: [],
      };
    }
  }

  // Aggregate by dimension value.
  const map = new Map<
    string,
    { spend: number; convVal: number; clicks: number; impr: number; convs: number }
  >();
  for (const row of raw) {
    const key = row.dimension || "Unknown";
    const cur = map.get(key) ?? { spend: 0, convVal: 0, clicks: 0, impr: 0, convs: 0 };
    cur.spend += row.spend;
    cur.convVal += row.conversion_value;
    cur.clicks += row.clicks;
    cur.impr += row.impressions;
    cur.convs += row.conversions;
    map.set(key, cur);
  }

  let rows = Array.from(map.entries()).map(([name, v]) => ({
    name,
    cost: r2(v.spend),
    revenue: r2(v.convVal),
    profit: r2(v.convVal - v.spend),
    roas: v.spend > 0 ? r2(v.convVal / v.spend) : 0,
    clicks: r0(v.clicks),
    conv: r0(v.convs),
    cpa: v.convs > 0 ? r2(v.spend / v.convs) : 0,
    impressions: r0(v.impr),
  }));

  if (search) rows = rows.filter((r) => r.name.toLowerCase().includes(search));

  const totalRows = rows.length;
  const totals = rows.reduce(
    (t, r) => {
      t.cost += r.cost;
      t.revenue += r.revenue;
      t.profit += r.profit;
      t.clicks += r.clicks;
      t.conv += r.conv;
      t.impressions += r.impressions;
      return t;
    },
    { cost: 0, revenue: 0, profit: 0, clicks: 0, conv: 0, impressions: 0 },
  );
  const totalsOut = {
    cost: r2(totals.cost),
    revenue: r2(totals.revenue),
    profit: r2(totals.profit),
    roas: totals.cost > 0 ? r2(totals.revenue / totals.cost) : 0,
    clicks: totals.clicks,
    conv: totals.conv,
    cpa: totals.conv > 0 ? r2(totals.cost / totals.conv) : 0,
    impressions: totals.impressions,
  };

  const sortKey = (sortBy === "cost" ? "cost" : sortBy) as keyof (typeof rows)[number];
  rows.sort((a, b) =>
    sortDir === "asc"
      ? (a[sortKey] as number) - (b[sortKey] as number)
      : (b[sortKey] as number) - (a[sortKey] as number),
  );
  const topRows = rows.slice(0, limit);

  return {
    dimension,
    ...(args.campaign ? { campaign_filter: args.campaign } : {}),
    ...(search ? { search } : {}),
    date_range: `${dateFrom} to ${dateTo}`,
    currency: "USD",
    total_matching_rows: totalRows,
    showing_top: topRows.length,
    sorted_by: `${sortBy} ${sortDir}`,
    totals: totalsOut,
    rows: topRows,
  };
}
