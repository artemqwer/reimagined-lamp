// ─────────────────────────────────────────────────────────────────────────────
// Connector manifests — the single source of truth that turns the (previously
// Google-Ads-only) dashboard into a schema-driven, multi-connector one.
//
// Each connector declares WHAT it exposes: its metrics (+ how they map onto the
// canonical row), its dimensions/tables (+ the Windsor fields to fetch for each),
// which chart tabs apply, and which dimensions the AI may query. The backend
// (/api/windsor, /api/data/[dimension]) and the UI both read from here instead of
// hardcoding Google-Ads concepts.
//
// Every connector reads through Windsor (the fields below). A second "prod"
// path — native API synced into BigQuery — used to be described here and was
// removed; see docs/bigquery-disabled.md.
// ─────────────────────────────────────────────────────────────────────────────

// Any slug is valid at runtime — built-ins (below) plus whatever an admin adds
// via the Admin Panel (see setCustomConnectors). Kept as `string` rather than a
// literal union so the registry can grow without a code deploy.
export type ConnectorId = string;

export type MetricFormat = "money" | "number" | "percent" | "ratio";

// Canonical metric keys the whole app understands, PLUS whatever an admin
// registers as a custom metric (raw Windsor field, no formula — see
// CustomConnectorMetricInput). Kept as `string` for the same reason ConnectorId
// is: the set can grow at runtime, without a code deploy.
export type CanonicalMetric = string;

export interface MetricDef {
  key: CanonicalMetric;
  label: string;
  format: MetricFormat;
  higherIsBetter?: boolean;
  // See CustomConnectorMetricInput.aggregation.
  aggregation?: "sum" | "avg";
}

export interface DimensionDef {
  key: string; // used in group_by and /api/data/[dimension]
  label: string; // table title / dropdown label ("Products Performance" derives from this)
  singular: string; // singular label used in the UI ("Product", "Search Term")
  // Windsor `fields` to request for the bare dimension and the date,<dim> variant.
  windsorFields: string;
  windsorDateFields: string;
  // Response keys (first non-empty wins) that carry this dimension's display value.
  valueKeys: string[];
}

export type ConnectorTab = "trends" | "performance" | "pl" | "sales" | "distribution";

// The canonical KPI cards the dashboard can compute. A connector lists the ones
// that make sense for it; the values themselves come from the same shared maths.
export const KPI_SLOTS = [
  "clicks",
  "convRate",
  "conversions",
  "cpa",
  "cost",
  "revenue",
  "roas",
  "profit",
  "aov",
] as const;
// Widened to `string` (not just the 9 literals above) for the same reason
// ConnectorId/CanonicalMetric are: an admin-registered custom metric (raw
// Windsor field) can also become a KPI slot — see connectorKpiOptions below.
export type KpiSlot = string;

export interface KpiCardDef {
  slot: KpiSlot;
  // Override the canonical card's name for this source (GA4: "Sessions").
  label?: string;
  shortLabel?: string;
  // Override the hover description when the canonical one is ad-specific.
  desc?: string;
}

export interface ConnectorManifest {
  id: ConnectorId;
  label: string;
  // Short brand colour used by the sidebar switcher.
  color: string;
  // The main entity the top block (KPI cards, Trends chart, primary table) is
  // built around — campaigns for ads, products for Shopify, channels for GA4.
  primaryDimension: string;
  // Label for that entity's table + "by" grouping (e.g. "Campaign", "Product").
  primaryLabel: string;
  // Windsor endpoint this source is read from (connectors.windsor.ai/<source>).
  // Google Ads keeps the blended `/all` endpoint it has always used; every other
  // connector must be scoped to its own, or Windsor returns the same merged rows
  // for all of them.
  windsorSource: string;
  // This source's metric columns, for group-bys that aren't one of its dimensions
  // (a plain `date` breakdown still needs to ask for the right metrics).
  windsorMetrics: string;
  // Canonical metrics this connector exposes, in display order.
  metrics: MetricDef[];
  // Admin-registered custom metrics only (metric key -> raw Windsor field
  // name) — undefined for built-ins. Lets windsor/route.ts and the data
  // aggregation pull through a raw Windsor field with no canonical formula
  // (e.g. GA4's bounceRate) instead of being limited to the ~15 built-in
  // canonical metrics.
  customMetricFields?: Record<string, string>;
  // Which KPI cards the top row shows, in order. `slot` picks one of the canonical
  // cards (see `kpis` in _data/constants); `label` renames it for this source.
  // Cost-free sources simply omit the cost/CPA/ROAS/profit slots.
  kpiCards: KpiCardDef[];
  // True when the connector has real ad spend → enables cost/roas/profit/CPA and
  // the Performance / P&L tabs. GA4 / Shopify are false (no ad spend).
  hasCost: boolean;
  dimensions: DimensionDef[];
  tabs: ConnectorTab[];
  timeline: boolean;
  aiDimensions: string[];
}

// ─── Shared metric-field sets (Windsor `/all` unified schema) ────────────────
// Windsor normalises many connectors onto common field names; where a connector
// differs, its own dimension fields below carry the right metric columns.
const ADS_METRICS = "clicks,impressions,spend,conversions,conversion_value";
// GA4 has no `conversion_value` field (Windsor 400s on it); revenue is
// `purchase_revenue`, which the canonical mapper already folds into revenue.
const GA4_METRICS = "sessions,users,conversions,purchase_revenue";
// Windsor's real Shopify field ids (connectors.windsor.ai/shopify/fields), all
// from the `orders` table so one request doesn't mix grains: order_count
// (orders), line_item__net_sales (total sales), line_item__quantity (items).
// The earlier names (orders / total_sales / quantity) aren't Windsor fields —
// every table 400'd with "Unexpected field(s)".
const SHOPIFY_METRICS = "order_count,line_item__net_sales,line_item__quantity";
// Amazon Ads (connectors.windsor.ai/amazon_ads/fields) does NOT share Windsor's
// unified metric names — every field is namespaced by report, e.g.
// `sponsored_products_campaign__clicks`. Requesting the generic ADS_METRICS
// (clicks/impressions/spend) 400s with "Unexpected field(s)", so an admin-added
// Amazon Ads source (schema "ads") returned no data at all. Map the Sponsored
// Products campaign report's own field ids; the canonical mapper (windsor route)
// folds them into clicks/impressions/spend/conversions/revenue. `cost` is
// Amazon's spend; attributed*14d is the standard 14-day attribution window.
// ponytail: covers the Sponsored Products *campaign* report only. Other reports
// (sponsored_brands_*, sponsored_display_*) and non-campaign breakdowns use
// different field prefixes and can't be mixed in one request — add a per-report
// override if a breakdown beyond the primary campaign table is needed.
const AMAZON_ADS_METRICS =
  "sponsored_products_campaign__clicks,sponsored_products_campaign__impressions,sponsored_products_campaign__cost,sponsored_products_campaign__attributedconversions14d,sponsored_products_campaign__attributedsales14d";
// Amazon Seller Central (Windsor source `amazon_sp`) is the same story as Ads,
// for the Sales & Traffic report (GET_SALES_AND_TRAFFIC_REPORT). It rejected the
// generic clicks/impressions/spend outright. The connector's dimension is the
// child ASIN, and Windsor refuses to mix an ASIN dimension with the by-date
// aggregate fields ("incompatible to be fetched with salesbydate fields") — so
// use the per-ASIN (`salesbyasin`/`trafficbyasin`) fields, which match the ASIN
// breakdown. The canonical mapper folds them into traffic (sessions), impressions
// (page views), conversions (units ordered) and revenue (ordered product sales).
// There is no ad spend in organic Seller Central, so `spend` stays 0.
const AMAZON_SELLER_METRICS =
  "sales_and_traffic_report_by_date__trafficbyasin_sessions,sales_and_traffic_report_by_date__trafficbyasin_pageviews,sales_and_traffic_report_by_date__salesbyasin_unitsordered,sales_and_traffic_report_by_date__salesbyasin_orderedproductsales_amount";
// Windsor source slug -> its own base metric field set, overriding the schema
// default for platforms that don't use Windsor's unified metric names.
const SOURCE_METRIC_OVERRIDES: Record<string, string> = {
  amazon_ads: AMAZON_ADS_METRICS,
  amazon_sp: AMAZON_SELLER_METRICS,
};

// Amazon Ads splits each breakdown into its OWN report (sponsored_products_campaign,
// _targeting, _search_term, _placement, _advertised_product…), each with its own
// field prefix. Windsor 400s if fields from two reports are requested together
// ("Fields from different reports cannot be requested together"), so EACH dimension
// must ask for metrics from the SAME report its dimension field belongs to — not a
// single fixed set. Derive them from the field's report prefix. clicks/impressions/
// cost exist in every SP report; the attributed conversion/sales columns exist only
// on some (verified against connectors.windsor.ai/amazon_ads/fields), so request
// them only there, else that report 400s with "field not found".
const AMAZON_REPORTS_WITH_CONVERSIONS = new Set([
  "sponsored_products_campaign",
  "sponsored_products_placement",
]);
function amazonAdsReportMetrics(windsorField: string): string | null {
  const m = /^(sponsored_[a-z_]+?)__/.exec(windsorField);
  if (!m) return null;
  const p = m[1];
  const fields = [`${p}__clicks`, `${p}__impressions`, `${p}__cost`];
  if (AMAZON_REPORTS_WITH_CONVERSIONS.has(p))
    fields.push(`${p}__attributedconversions14d`, `${p}__attributedsales14d`);
  return fields.join(",");
}
// Windsor's real Facebook/Meta field ids (connectors.windsor.ai/facebook/fields).
// Meta has NO `conversions` / `conversion_value` fields — every Meta table 400'd
// with "some of the fields you have selected are not valid" because it inherited
// Google Ads' metric names. Purchases come back as `actions_omni_purchase` (count,
// "Omni Purchases") and `action_values_omni_purchase` (value); the canonical
// mapper folds both into conversions / conversion_value.
const META_METRICS = "clicks,impressions,spend,actions_omni_purchase,action_values_omni_purchase";
// Meta's "omni"/"ranking" action fields (the purchase count + value above) are
// DELIVERY-incompatible: Facebook 400s ("Breakdown fields [...] are incompatible
// with 'omni' and 'ranking' fields") when they're requested alongside a delivery
// breakdown — placement (platform_position), platform (publisher_platform),
// geography (country) or device (impression_device). The error names ONLY omni
// and ranking, so the plain pixel-purchase action (offsite_conversion.fb_pixel_
// purchase = "Website Purchases") is used for those tables instead: it carries
// real conversions/value AND survives a delivery breakdown. Entity breakdowns
// (campaign / ad set / ad) keep omni, which counts every purchase surface.
const META_METRICS_DELIVERY =
  "clicks,impressions,spend,actions_offsite_conversion_fb_pixel_purchase,action_values_offsite_conversion_fb_pixel_purchase";

// Small helpers to compose the two Windsor field strings for a dimension.
const dim = (
  field: string,
  metrics: string,
): Pick<DimensionDef, "windsorFields" | "windsorDateFields"> => ({
  windsorFields: `${field},${metrics}`,
  windsorDateFields: `date,${field},${metrics}`,
});

// ─── Canonical metric presets ────────────────────────────────────────────────
const ADS_METRIC_DEFS: MetricDef[] = [
  { key: "impressions", label: "Impr.", format: "number", higherIsBetter: true },
  { key: "clicks", label: "Clicks", format: "number", higherIsBetter: true },
  { key: "cost", label: "Cost", format: "money" },
  { key: "conversions", label: "Conv.", format: "number", higherIsBetter: true },
  { key: "revenue", label: "Revenue", format: "money", higherIsBetter: true },
  { key: "cpc", label: "CPC", format: "money" },
  { key: "ctr", label: "CTR", format: "percent", higherIsBetter: true },
  { key: "cpa", label: "CPA", format: "money" },
  { key: "roas", label: "ROAS", format: "ratio", higherIsBetter: true },
  { key: "profit", label: "Profit", format: "money", higherIsBetter: true },
];

const GA4_METRIC_DEFS: MetricDef[] = [
  { key: "sessions", label: "Sessions", format: "number", higherIsBetter: true },
  { key: "users", label: "Users", format: "number", higherIsBetter: true },
  { key: "conversions", label: "Conversions", format: "number", higherIsBetter: true },
  { key: "revenue", label: "Revenue", format: "money", higherIsBetter: true },
  { key: "convRate", label: "Conv. Rate", format: "percent", higherIsBetter: true },
];

// Ad platforms show the full cost-aware set. Cost-free sources drop the ad-spend
// cards (cost / CPA / ROAS / profit) — they'd all read zero — and rename the rest.
const ADS_KPI_CARDS: KpiCardDef[] = [
  { slot: "clicks" },
  { slot: "convRate" },
  { slot: "conversions" },
  { slot: "cpa" },
  { slot: "cost" },
  { slot: "revenue" },
  { slot: "roas" },
  { slot: "profit" },
];

const GA4_KPI_CARDS: KpiCardDef[] = [
  {
    slot: "clicks",
    label: "Sessions",
    shortLabel: "Sessions",
    desc: "Total sessions in the selected period",
  },
  { slot: "convRate", desc: "% of sessions that result in a conversion" },
  {
    slot: "conversions",
    label: "Conversions",
    shortLabel: "Conv.",
    desc: "Total conversions in the selected period",
  },
  { slot: "revenue", desc: "Total revenue in the selected period" },
];

const SHOPIFY_KPI_CARDS: KpiCardDef[] = [
  {
    slot: "conversions",
    label: "Orders",
    shortLabel: "Orders",
    desc: "Total orders in the selected period",
  },
  {
    slot: "revenue",
    label: "Total Sales",
    shortLabel: "Sales",
    desc: "Total sales in the selected period",
  },
  { slot: "aov" },
  {
    slot: "clicks",
    label: "Items Sold",
    shortLabel: "Items",
    desc: "Total items sold in the selected period",
  },
];

const SHOPIFY_METRIC_DEFS: MetricDef[] = [
  { key: "orders", label: "Orders", format: "number", higherIsBetter: true },
  { key: "revenue", label: "Total Sales", format: "money", higherIsBetter: true },
  { key: "conversions", label: "Items Sold", format: "number", higherIsBetter: true },
  { key: "aov", label: "AOV", format: "money", higherIsBetter: true },
];

// ─── Custom connectors (admin-defined, DB-backed) ────────────────────────────
// An admin adding a data source from the Admin Panel doesn't hand-map Windsor
// field names — they pick one of these three schemas, matching how Windsor
// normalises most platforms it supports (see the comment on ADS_METRICS etc.
// above). This is what keeps a hand-written admin form safe: metrics/kpiCards/
// hasCost/tabs are DERIVED from the schema, never typed in free-form.
export type MetricSchema = "ads" | "analytics" | "commerce";

const METRIC_SCHEMAS: Record<
  MetricSchema,
  {
    windsorMetrics: string;
    metrics: MetricDef[];
    kpiCards: KpiCardDef[];
    hasCost: boolean;
    tabs: ConnectorTab[];
  }
> = {
  ads: {
    windsorMetrics: ADS_METRICS,
    metrics: ADS_METRIC_DEFS,
    kpiCards: ADS_KPI_CARDS,
    hasCost: true,
    tabs: ["trends", "performance", "pl", "distribution"],
  },
  analytics: {
    windsorMetrics: GA4_METRICS,
    metrics: GA4_METRIC_DEFS,
    kpiCards: GA4_KPI_CARDS,
    hasCost: false,
    tabs: ["trends", "distribution"],
  },
  commerce: {
    windsorMetrics: SHOPIFY_METRICS,
    metrics: SHOPIFY_METRIC_DEFS,
    kpiCards: SHOPIFY_KPI_CARDS,
    hasCost: false,
    tabs: ["trends", "sales", "distribution"],
  },
};

export interface CustomConnectorDimensionInput {
  key: string;
  label: string;
  singular: string;
  windsorField: string;
}

// A metric with no canonical formula — a raw Windsor field (e.g. GA4's
// bounceRate) read straight from the response, not derived from spend/clicks/
// conversions like ROAS or CPA are. Windsor exposes hundreds of these per
// platform (see GET connectors.windsor.ai/<connector>/fields); an admin picks
// the ones relevant to their dashboard instead of being limited to the ~15
// built-in canonical metrics.
export interface CustomConnectorMetricInput {
  key: string;
  label: string;
  windsorField: string;
  format: MetricFormat;
  // How the metric combines across rows / days. Absent falls back to the
  // format, which is only a guess: an average position is a plain number yet
  // must never be summed. Set it explicitly to stop guessing.
  aggregation?: "sum" | "avg";
}

// Shape of a row from the `custom_connectors` Supabase table.
export interface CustomConnectorRow {
  id: string;
  label: string;
  color: string;
  windsor_source: string;
  metric_schema: MetricSchema;
  primary_dimension: CustomConnectorDimensionInput;
  dimensions: CustomConnectorDimensionInput[];
  ai_dimensions: string[];
  custom_metrics?: CustomConnectorMetricInput[];
}

// Cross-filter store keys the PRIMARY table owns, whatever the connector: it
// writes its own row selection under them. A dimension may not claim one, or
// selecting a row in that dimension's table would be read everywhere as a
// selection of the primary entity — and since the values aren't primary-entity
// values, every table and chart filters down to nothing. `campaign_name` is a
// perfectly ordinary Windsor field name, so this collision is easy to hit.
export const RESERVED_FILTER_KEYS = ["campaign_name", "campaign_selected"] as const;

/** A dimension key that can't collide with the reserved cross-filter keys. */
export function safeDimensionKey(key: string): string {
  return (RESERVED_FILTER_KEYS as readonly string[]).includes(key) ? `${key}_dim` : key;
}

/** Merge admin-registered metric defs onto a canonical list. A custom metric
 *  keyed like a canonical one replaces it — a duplicate entry would render the
 *  same underlying number twice, once per label. */
/** Whether a metric is averaged across rows rather than summed.
 *  The admin's explicit choice wins; otherwise fall back to the format, where
 *  a percent or a ratio can't meaningfully be added up. */
export function isAveragedMetric(connectorId: string, key: string): boolean {
  const m = getConnector(connectorId).metrics.find((x) => x.key === key);
  if (m?.aggregation) return m.aggregation === "avg";
  return m?.format === "percent" || m?.format === "ratio";
}

function mergeMetricDefs(base: MetricDef[], custom: MetricDef[]): MetricDef[] {
  if (custom.length === 0) return base;
  const byKey = new Map(custom.map((m) => [m.key, m]));
  return [
    ...base.map((m) => byKey.get(m.key) ?? m),
    ...custom.filter((m) => !base.some((b) => b.key === m.key)),
  ];
}

function toDimensionDef(d: CustomConnectorDimensionInput, metrics: string): DimensionDef {
  return {
    key: safeDimensionKey(d.key),
    label: d.label,
    singular: d.singular,
    ...dim(d.windsorField, metrics),
    valueKeys: [d.windsorField],
  };
}

/** Turn a custom_connectors DB row into a full manifest, the same shape the
 *  built-in connectors below are declared with. Throws on an unknown schema
 *  (the admin API validates this before it's ever stored). */
export function buildCustomManifest(row: CustomConnectorRow): ConnectorManifest {
  const schema = METRIC_SCHEMAS[row.metric_schema];
  if (!schema) throw new Error(`Unknown metric schema: ${row.metric_schema}`);

  const customMetrics = row.custom_metrics ?? [];
  const customMetricDefs: MetricDef[] = customMetrics.map((m) => ({
    key: m.key,
    label: m.label,
    format: m.format,
    aggregation: m.aggregation,
  }));
  const customMetricFields: Record<string, string> | undefined = customMetrics.length
    ? Object.fromEntries(customMetrics.map((m) => [m.key, m.windsorField]))
    : undefined;
  // Custom metric fields must be requested from Windsor too, or they'll never
  // show up in the response — folded into the same field-string every
  // dimension's fetch already asks for (dim() below), so no extra fetch is needed.
  // Amazon and any future source whose Windsor fields aren't the unified names
  // override the schema default here (see SOURCE_METRIC_OVERRIDES).
  const baseMetrics = SOURCE_METRIC_OVERRIDES[row.windsor_source] ?? schema.windsorMetrics;
  const windsorMetrics = customMetrics.length
    ? `${baseMetrics},${customMetrics.map((m) => m.windsorField).join(",")}`
    : baseMetrics;

  // Amazon Ads: each dimension asks for its OWN report's metrics (see
  // amazonAdsReportMetrics) so a targeting/search-term/ad-group breakdown can't mix
  // reports and 400. Custom metrics are appended only when they belong to the same
  // report as the dimension, for the same reason. Every other source uses one set.
  const isAmazonAds = row.windsor_source === "amazon_ads";
  const metricsForDimension = (windsorField: string): string => {
    if (!isAmazonAds) return windsorMetrics;
    const derived = amazonAdsReportMetrics(windsorField);
    if (!derived) return windsorMetrics;
    const prefix = derived.slice(0, derived.indexOf("__"));
    const sameReportCustom = customMetrics
      .filter((m) => m.windsorField.startsWith(`${prefix}__`))
      .map((m) => m.windsorField);
    return sameReportCustom.length ? `${derived},${sameReportCustom.join(",")}` : derived;
  };

  const primary = toDimensionDef(
    row.primary_dimension,
    metricsForDimension(row.primary_dimension.windsorField),
  );
  const rest = (row.dimensions ?? []).map((d) =>
    toDimensionDef(d, metricsForDimension(d.windsorField)),
  );

  // withCrossFilterPivot so an admin-added source is cross-filterable the
  // moment it's created — same treatment the shipped connectors get, with no
  // code to write per new source.
  return withCrossFilterPivot({
    id: row.id,
    label: row.label,
    color: row.color,
    windsorSource: row.windsor_source,
    windsorMetrics,
    primaryDimension: primary.key,
    primaryLabel: primary.singular,
    metrics: mergeMetricDefs(schema.metrics, customMetricDefs),
    customMetricFields,
    kpiCards: schema.kpiCards,
    hasCost: schema.hasCost,
    tabs: schema.tabs,
    timeline: true,
    aiDimensions: row.ai_dimensions?.length
      ? row.ai_dimensions
      : [primary.key, ...rest.map((d) => d.key)],
    dimensions: [primary, ...rest],
  });
}

// The cross-filter engine (page.tsx) redistributes a selection made in one
// dimension's table proportionally across every other dimension, by joining
// rows on the connector's OWN primary entity (campaign for Ads, channel for
// GA4, product for Shopify — whatever `primaryDimension` is). That join only
// works if every OTHER dimension's Windsor fetch also returns the primary's
// field, which a hand-written manifest has no reason to ask for. This appends
// it, so the join always has something to read.
//
// Applied CENTRALLY — to BUILT_IN_CONNECTORS as a whole (below), inside
// buildCustomManifest (so an admin-added data source gets it with no code),
// and again after withCustomDimensions (so admin-added dimensions get it
// too). Nothing needs doing per connector: a new source — shipped in code or
// added from the Admin Panel — is cross-filterable automatically.
//
// Idempotent: a dimension that already carries the pivot field is left alone,
// so the repeated applications above can't duplicate it.
function withCrossFilterPivot(manifest: ConnectorManifest): ConnectorManifest {
  const primary = manifest.dimensions.find((d) => d.key === manifest.primaryDimension);
  if (!primary) return manifest;
  const pivotField = primary.windsorFields.split(",")[0];
  // Report-namespaced sources (Amazon Ads: sponsored_products_<report>__…) keep
  // each breakdown in its OWN report, and Windsor 400s if fields from two reports
  // are requested together. The pivot belongs to the primary's report, so it can
  // only ride along on breakdowns from that SAME report — carrying it into another
  // report's breakdown is exactly the "different reports cannot be requested
  // together" error. Cross-filtering across separate reports isn't meaningful
  // anyway. For non-namespaced sources pivotPrefix is null and every breakdown
  // carries the pivot as before.
  // Only Amazon Ads is report-namespaced this way (Shopify uses `__` in field
  // names too — line_item__title — but it's a single report, so it must keep the
  // normal pivot behaviour). Key on the source, not on the presence of `__`.
  const pivotPrefix =
    manifest.windsorSource === "amazon_ads" && pivotField.includes("__")
      ? pivotField.slice(0, pivotField.indexOf("__"))
      : null;
  const canCarryPivot = (d: DimensionDef) =>
    !pivotPrefix || d.windsorFields.split(",")[0].startsWith(`${pivotPrefix}__`);
  const needsIt = (d: DimensionDef) =>
    d.key !== manifest.primaryDimension &&
    canCarryPivot(d) &&
    (!d.windsorFields.split(",").includes(pivotField) ||
      !d.windsorDateFields.split(",").includes(pivotField));
  // Nothing to add → hand back the very same object, so callers that compare
  // identity (and the repeated applications noted above) see a true no-op.
  if (!manifest.dimensions.some(needsIt)) return manifest;
  const add = (fields: string) =>
    fields.split(",").includes(pivotField) ? fields : `${fields},${pivotField}`;
  return {
    ...manifest,
    dimensions: manifest.dimensions.map((d) => {
      if (d.key === manifest.primaryDimension || !canCarryPivot(d)) return d;
      return {
        ...d,
        windsorFields: add(d.windsorFields),
        windsorDateFields: add(d.windsorDateFields),
      };
    }),
  };
}

/** Apply withCrossFilterPivot across a whole manifest record. */
function withCrossFilterPivotAll(
  manifests: Record<ConnectorId, ConnectorManifest>,
): Record<ConnectorId, ConnectorManifest> {
  return Object.fromEntries(
    Object.entries(manifests).map(([id, m]) => [id, withCrossFilterPivot(m)]),
  );
}

// ─── Manifests ───────────────────────────────────────────────────────────────
// The 4 shipped connectors — frozen, never overwritten by an admin-added one
// (setCustomConnectors below drops any custom row whose id collides with one
// of these). Declared raw here; BUILT_IN_CONNECTORS below is this record with
// the cross-filter pivot field applied to every entry, so a connector added
// to this list needs no extra wiring to be cross-filterable.
const RAW_BUILT_IN_CONNECTORS: Record<ConnectorId, ConnectorManifest> = {
  google_ads: {
    id: "google_ads",
    label: "Google Ads",
    color: "#4285F4",
    windsorSource: "google_ads",
    windsorMetrics: ADS_METRICS,
    primaryDimension: "campaign",
    primaryLabel: "Campaign",
    metrics: ADS_METRIC_DEFS,
    // Google Ads keeps the original eight cards, in the original order.
    kpiCards: ADS_KPI_CARDS,
    hasCost: true,
    tabs: ["trends", "performance", "pl", "distribution"],
    timeline: true,
    aiDimensions: [
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
      "day_of_week",
      "hour",
    ],
    // Dimensions reuse the existing Google-Ads group-bys the windsor route already
    // knows; windsorFields here are informational (the GA path keeps its bespoke
    // per-account candidate logic in the windsor route).
    dimensions: [
      {
        key: "campaign",
        label: "Campaign Performance",
        singular: "Campaign",
        ...dim("campaign", ADS_METRICS),
        valueKeys: ["campaign", "campaign_name"],
      },
      {
        key: "ad_group",
        label: "Ad Groups Performance",
        singular: "Ad Group",
        ...dim("ad_group_name", ADS_METRICS),
        valueKeys: ["ad_group_name", "ad_group"],
      },
      {
        key: "search_term",
        label: "Search Terms Performance",
        singular: "Search Term",
        ...dim("search_term", ADS_METRICS),
        valueKeys: ["search_term"],
      },
      {
        key: "match_type",
        label: "Match Type Performance",
        singular: "Match Type",
        ...dim("match_type", ADS_METRICS),
        valueKeys: ["match_type"],
      },
      {
        key: "device",
        label: "Device Performance",
        singular: "Device",
        ...dim("device", ADS_METRICS),
        valueKeys: ["device"],
      },
      {
        key: "network",
        label: "Network Performance",
        singular: "Network",
        ...dim("ad_network_type", ADS_METRICS),
        valueKeys: ["ad_network_type", "network"],
      },
      {
        key: "country",
        label: "Geography Performance",
        singular: "Country",
        ...dim("country", ADS_METRICS),
        valueKeys: ["country", "country_code"],
      },
    ],
  },

  meta_ads: {
    id: "meta_ads",
    label: "Meta Ads",
    color: "#0866FF",
    windsorSource: "facebook",
    windsorMetrics: META_METRICS,
    primaryDimension: "campaign",
    primaryLabel: "Campaign",
    metrics: ADS_METRIC_DEFS,
    kpiCards: ADS_KPI_CARDS,
    hasCost: true,
    tabs: ["trends", "performance", "pl", "distribution"],
    timeline: true,
    aiDimensions: [
      "campaign",
      "adset",
      "ad",
      "placement",
      "platform",
      "country",
      "device",
      "day_of_week",
      "hour",
    ],
    dimensions: [
      {
        key: "campaign",
        label: "Campaign Performance",
        singular: "Campaign",
        ...dim("campaign", META_METRICS),
        valueKeys: ["campaign", "campaign_name"],
      },
      {
        key: "adset",
        label: "Ad Set Performance",
        singular: "Ad Set",
        ...dim("adset_name", META_METRICS),
        valueKeys: ["adset_name", "adset"],
      },
      {
        key: "ad",
        label: "Ad Performance",
        singular: "Ad",
        ...dim("ad_name", META_METRICS),
        valueKeys: ["ad_name", "ad_id"],
      },
      {
        // Meta's placement breakdown field is `platform_position` ("Ad Placement");
        // there is no `placement` field (it 400'd). Keep the table key `placement`.
        // Delivery breakdown → basic metrics only (see META_METRICS_DELIVERY).
        key: "placement",
        label: "Placement Performance",
        singular: "Placement",
        ...dim("platform_position", META_METRICS_DELIVERY),
        valueKeys: ["platform_position", "placement"],
      },
      {
        key: "platform",
        label: "Platform Performance",
        singular: "Platform",
        ...dim("publisher_platform", META_METRICS_DELIVERY),
        valueKeys: ["publisher_platform", "platform"],
      },
      {
        key: "country",
        label: "Geography Performance",
        singular: "Country",
        ...dim("country", META_METRICS_DELIVERY),
        valueKeys: ["country"],
      },
      {
        key: "device",
        label: "Device Performance",
        singular: "Device",
        ...dim("impression_device", META_METRICS_DELIVERY),
        valueKeys: ["impression_device", "device"],
      },
    ],
  },

  ga4: {
    id: "ga4",
    label: "Google Analytics 4",
    color: "#E8710A",
    windsorSource: "googleanalytics4",
    windsorMetrics: GA4_METRICS,
    primaryDimension: "channel",
    primaryLabel: "Channel",
    metrics: GA4_METRIC_DEFS,
    kpiCards: GA4_KPI_CARDS,
    hasCost: false,
    // No ad spend → no Performance / P&L; Trends + Distribution only.
    tabs: ["trends", "distribution"],
    timeline: true,
    aiDimensions: ["channel", "source_medium", "landing_page", "device", "country", "event"],
    dimensions: [
      {
        key: "channel",
        label: "Channels Performance",
        singular: "Channel",
        ...dim("default_channel_group", GA4_METRICS),
        valueKeys: ["default_channel_group", "channel"],
      },
      {
        key: "source_medium",
        label: "Source / Medium",
        singular: "Source/Medium",
        ...dim("session_source_medium", GA4_METRICS),
        valueKeys: ["session_source_medium", "source_medium"],
      },
      {
        key: "landing_page",
        label: "Landing Pages Performance",
        singular: "Landing Page",
        ...dim("landing_page", GA4_METRICS),
        valueKeys: ["landing_page", "landing_page_path"],
      },
      {
        key: "device",
        label: "Device Performance",
        singular: "Device",
        ...dim("device", GA4_METRICS),
        valueKeys: ["device", "device_category"],
      },
      {
        key: "country",
        label: "Geography Performance",
        singular: "Country",
        ...dim("country", GA4_METRICS),
        valueKeys: ["country"],
      },
      {
        key: "event",
        label: "Events Performance",
        singular: "Event",
        ...dim("event_name", GA4_METRICS),
        valueKeys: ["event_name", "event"],
      },
    ],
  },

  shopify: {
    id: "shopify",
    label: "Shopify",
    color: "#95BF47",
    windsorSource: "shopify",
    windsorMetrics: SHOPIFY_METRICS,
    primaryDimension: "product",
    primaryLabel: "Product",
    metrics: SHOPIFY_METRIC_DEFS,
    kpiCards: SHOPIFY_KPI_CARDS,
    hasCost: false,
    // Sales-oriented: Trends + a Sales tab + Distribution (no ad Performance / P&L).
    tabs: ["trends", "sales", "distribution"],
    timeline: true,
    // Windsor exposes these as `orders`-table fields; there is no "collection"
    // or "customer type" dimension, so Collections is mapped to Product Category
    // and the Customers table is dropped (nothing valid to group it by).
    aiDimensions: ["product", "category", "source", "discount_code", "country"],
    dimensions: [
      {
        key: "product",
        label: "Products Performance",
        singular: "Product",
        ...dim("line_item__title", SHOPIFY_METRICS),
        valueKeys: ["line_item__title", "product_title", "product"],
      },
      {
        key: "variant",
        label: "Variants Performance",
        singular: "Variant",
        ...dim("line_item__variant_title", SHOPIFY_METRICS),
        valueKeys: ["line_item__variant_title", "variant_title", "variant"],
      },
      {
        key: "category",
        label: "Category Performance",
        singular: "Category",
        ...dim("line_item__product_category", SHOPIFY_METRICS),
        valueKeys: ["line_item__product_category", "collection"],
      },
      {
        key: "source",
        label: "Traffic Source",
        singular: "Source",
        ...dim("order_customer_last_visit_source", SHOPIFY_METRICS),
        valueKeys: ["order_customer_last_visit_source", "referring_site", "source"],
      },
      {
        key: "discount_code",
        label: "Discounts Performance",
        singular: "Discount",
        ...dim("order_discount_code", SHOPIFY_METRICS),
        valueKeys: ["order_discount_code", "discount_code", "discount"],
      },
      {
        key: "country",
        label: "Geography Performance",
        singular: "Country",
        ...dim("order_shipping_address_country", SHOPIFY_METRICS),
        valueKeys: ["order_shipping_address_country", "country"],
      },
    ],
  },
};

// Every shipped connector, with the cross-filter pivot field folded onto each
// of its non-primary dimensions (see withCrossFilterPivot). Applied once here
// rather than per manifest, so adding a connector to the list above is all
// that's needed — nothing to remember, nothing to wire up per source.
export const BUILT_IN_CONNECTORS: Record<ConnectorId, ConnectorManifest> =
  withCrossFilterPivotAll(RAW_BUILT_IN_CONNECTORS);

// The live registry: built-ins (each optionally topped up with admin-registered
// custom metrics — see applyAdminCustomFields) plus whatever
// setCustomConnectors last loaded. `let`-bound (not `const`) so every existing
// `import { CONNECTORS }` site sees updates automatically — ES module exports
// are live references, so no call site needs to change when an admin adds a
// connector or a custom metric.
export let CONNECTORS: Record<ConnectorId, ConnectorManifest> = { ...BUILT_IN_CONNECTORS };
// Admin-added sources exactly as their own row defines them, BEFORE any
// connector_config layering — kept pristine so the layering below is always
// recomputed from scratch rather than stacked onto an already-layered copy.
let customConnectorManifests: Record<string, ConnectorManifest> = {};
// The last connector_config map seen. Held because the two inputs arrive
// independently (config fetch vs custom-connector fetch, in either order) and
// every rebuild has to re-apply both.
let adminConfigs: ConnectorConfigMap = {};

function rebuildRegistry(): void {
  const next: Record<string, ConnectorManifest> = {};
  // Both built-in and admin-added sources get the admin's custom
  // metrics/dimensions layered on. Custom connectors used to be skipped here,
  // so anything an admin registered for one was saved, echoed back in the
  // panel, and then ignored by the dashboard: its metric column summed instead
  // of averaging (the aggregation lives on the layered def), its new metrics
  // never reached the KPI-card / metric-column pickers, and its extra
  // dimensions produced no breakdown tables.
  for (const [id, manifest] of Object.entries({
    ...BUILT_IN_CONNECTORS,
    ...customConnectorManifests,
  })) {
    const cfg = adminConfigs[id as ConnectorId];
    const withMetrics = withCustomMetrics(manifest, cfg?.customMetrics);
    const withDims = withCustomDimensions(withMetrics, cfg?.customDimensions);
    // Re-apply the pivot so an admin-added dimension carries the join field
    // too — idempotent, so the ones already carrying it are untouched.
    next[id] = withCrossFilterPivot(withDims);
  }
  CONNECTORS = next as Record<ConnectorId, ConnectorManifest>;
  CONNECTOR_IDS = Object.keys(CONNECTORS);
  for (const listener of registryListeners) listener();
}

type RegistryListener = () => void;
const registryListeners = new Set<RegistryListener>();

/**
 * Called whenever the live registry changes.
 *
 * The registry is a plain module object, so nothing re-renders when it grows.
 * Anything deriving a list from it has to be told — and leaving that to each
 * caller meant it got forgotten: the data-sources page loaded the admin's
 * sources, rendered them, and never said so, leaving the sidebar showing the
 * built-ins only while the page beside it listed a connected source.
 *
 * Announcing it here means a caller cannot forget: whoever changes the
 * registry announces it by having changed it.
 */
export function onConnectorRegistryChange(listener: RegistryListener): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

/** Replace the custom (admin-added) connectors with this set, rebuilding the
 *  live CONNECTORS/CONNECTOR_IDS registry. Called once per session load after
 *  fetching /api/admin/custom-connectors. Rows whose id collides with a
 *  built-in, or that fail to build (malformed schema), are silently dropped —
 *  the admin API validates on write, so this is just defense in depth. */
export function setCustomConnectors(rows: CustomConnectorRow[]): void {
  const next: Record<string, ConnectorManifest> = {};
  for (const row of rows) {
    if (row.id in BUILT_IN_CONNECTORS) continue;
    try {
      next[row.id] = buildCustomManifest(row);
    } catch {
      /* skip malformed row */
    }
  }
  customConnectorManifests = next;
  rebuildRegistry();
}

export function getCustomConnectorIds(): string[] {
  return Object.keys(customConnectorManifests);
}

// Layers admin-registered custom metrics (raw Windsor fields, no formula) onto
// a built-in manifest: appended to `metrics`, folded into `windsorMetrics` and
// every dimension's own windsorFields/windsorDateFields so they're actually
// requested, and tracked in `customMetricFields` for the fetch/aggregation
// layer — the exact same mechanism buildCustomManifest uses for custom
// connectors, just layered on top of a fixed manifest instead of built fresh.
/** Join Windsor field strings without repeating a field. A metric registered
 *  both when the source was created and again in its config would otherwise be
 *  asked for twice in the same request. */
function joinFields(...parts: string[]): string {
  const seen = new Set<string>();
  for (const f of parts.join(",").split(",")) {
    const t = f.trim();
    if (t) seen.add(t);
  }
  return [...seen].join(",");
}

function withCustomMetrics(
  base: ConnectorManifest,
  customMetrics: CustomConnectorMetricInput[] | undefined,
): ConnectorManifest {
  if (!customMetrics?.length) return base;
  const extraFieldStr = customMetrics.map((m) => m.windsorField).join(",");
  const customMetricDefs: MetricDef[] = customMetrics.map((m) => ({
    key: m.key,
    label: m.label,
    format: m.format,
    aggregation: m.aggregation,
  }));
  // Amazon Ads: KPI-card metrics an admin adds can span DIFFERENT Windsor reports
  // (sponsored_products_campaign, sponsored_brands_ad_group, …), and Windsor 400s
  // if two reports are requested together. So a dimension may only carry the custom
  // metric fields from ITS OWN report — the ones from other reports simply read 0 on
  // that breakdown (Amazon can't serve them alongside it anyway). Every other source
  // appends them all, as before.
  const isAmazonAds = base.windsorSource === "amazon_ads";
  const extraForDim = (d: DimensionDef): string => {
    if (!isAmazonAds) return extraFieldStr;
    const first = d.windsorFields.split(",")[0];
    const prefix = first.includes("__") ? first.slice(0, first.indexOf("__")) : null;
    if (!prefix) return extraFieldStr;
    return customMetrics
      .filter((m) => m.windsorField.startsWith(`${prefix}__`))
      .map((m) => m.windsorField)
      .join(",");
  };
  return {
    ...base,
    // For Amazon Ads the plain-`date` breakdown (which uses windsorMetrics) must
    // not mix reports either — keep it to the base report's metrics.
    windsorMetrics: isAmazonAds
      ? base.windsorMetrics
      : joinFields(base.windsorMetrics, extraFieldStr),
    metrics: mergeMetricDefs(base.metrics, customMetricDefs),
    customMetricFields: {
      ...base.customMetricFields,
      ...Object.fromEntries(customMetrics.map((m) => [m.key, m.windsorField])),
    },
    dimensions: base.dimensions.map((d) => {
      const extra = extraForDim(d);
      return {
        ...d,
        windsorFields: extra ? joinFields(d.windsorFields, extra) : d.windsorFields,
        windsorDateFields: extra ? joinFields(d.windsorDateFields, extra) : d.windsorDateFields,
      };
    }),
  };
}

// Layers admin-registered custom dimensions (extra Windsor fields) onto a
// built-in manifest: appended to `dimensions` using the manifest's (already
// custom-metric-topped-up) `windsorMetrics`, so a new dimension's fetch also
// asks for any custom metric fields — same fetch string every other
// dimension gets. Same mechanism CustomConnectorModal already offers at
// creation time for custom connectors, just layered onto a fixed manifest.
function withCustomDimensions(
  base: ConnectorManifest,
  customDimensions: CustomConnectorDimensionInput[] | undefined,
): ConnectorManifest {
  if (!customDimensions?.length) return base;
  // A dimension the manifest already has (typically the primary one re-picked
  // from the Windsor field list, whose label reads identically) must not be
  // appended again: it would render the same breakdown twice and, since tables
  // are keyed by dimension key, collide.
  const taken = new Set(base.dimensions.map((d) => d.key));
  // Amazon Ads: a new breakdown gets its OWN report's metrics (see the choke-point
  // in the windsor route) — using base.windsorMetrics would mix reports and 400.
  const isAmazonAds = base.windsorSource === "amazon_ads";
  const newDims = customDimensions
    .map((d) => {
      const metrics =
        (isAmazonAds ? amazonAdsReportMetrics(d.windsorField) : null) ?? base.windsorMetrics;
      return toDimensionDef(d, metrics);
    })
    .filter((d) => !taken.has(d.key));
  if (newDims.length === 0) return base;
  return {
    ...base,
    dimensions: [...base.dimensions, ...newDims],
    // The AI is offered aiDimensions, not `dimensions`, so an admin-added
    // breakdown was invisible to it: asked about one it would either say it
    // can't do that, or answer using the nearest built-in dimension instead —
    // e.g. reaching for `device` (phone models) when the admin had added
    // `devicecategory` (desktop/mobile/tablet), which then matches nothing and
    // reads as "no data" plus a filter that appears not to apply.
    aiDimensions: [...base.aiDimensions, ...newDims.map((d) => d.key)],
  };
}

/** Store the given connector_config map as the admin layer and rebuild the live
 *  registry, so every source — built-in or admin-added — carries its own
 *  `customMetrics`/`customDimensions` (a source with neither is left exactly
 *  as-is). Called both client-side (whenever connector_config loads — see
 *  useCrossFilter's setConnectorConfigs) and server-side
 *  (ensureCustomConnectorsLoaded) since each runs in its own JS context and
 *  neither shares the other's state. */
export function applyAdminCustomFields(configs: ConnectorConfigMap): void {
  adminConfigs = configs;
  rebuildRegistry();
}

let customConnectorsLoadedAt = 0;
const CUSTOM_CONNECTORS_TTL_MS = 60_000;

/** Server-only. API routes (windsor, data/[dimension], connector-config,
 *  preset-questions, ai-chat, ai-insights, …) run in a separate JS context
 *  from the browser — `setCustomConnectors` calls made by client components
 *  after fetching /api/admin/custom-connectors never reach the server's own
 *  module instance. Without this, `getConnector(customId)` on the server
 *  always falls back to DEFAULT_CONNECTOR (wrong windsorSource, dimensions,
 *  metrics — silently, not an error). Call this once at the top of any route
 *  that resolves a connector id that might be a custom one; a short TTL
 *  cache keeps it from hitting the DB on every request. No-ops in the
 *  browser (client components already keep the registry fresh themselves)
 *  and when the service role key / table aren't set up yet. */
export async function ensureCustomConnectorsLoaded(): Promise<void> {
  if (typeof window !== "undefined") return;
  if (Date.now() - customConnectorsLoadedAt < CUSTOM_CONNECTORS_TTL_MS) return;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const { adminClient } = await import("./supabase-admin");
    const client = adminClient();

    const { data, error } = await client
      .from("custom_connectors")
      .select(
        "id, label, color, windsor_source, metric_schema, primary_dimension, dimensions, ai_dimensions, custom_metrics",
      );
    if (!error && data) setCustomConnectors(data as CustomConnectorRow[]);

    // Also fold in any custom metrics/dimensions an admin registered for a
    // BUILT-IN connector (google_ads/meta_ads/ga4/shopify) via connector_config
    // — same "server has its own JS context" problem as custom_connectors above.
    const { data: configRows, error: configError } = await client
      .from("connector_config")
      .select("connector, config");
    if (!configError && configRows) {
      const configs: ConnectorConfigMap = {};
      for (const row of configRows as { connector: string; config: unknown }[]) {
        if (row.config && typeof row.config === "object") {
          configs[row.connector] = row.config as ConnectorConfig;
        }
      }
      applyAdminCustomFields(configs);
    }

    customConnectorsLoadedAt = Date.now();
  } catch {
    // Network/DB hiccup — keep whatever was loaded before; self-heals on the
    // next call once the TTL elapses.
  }
}

// ─── Admin overrides (global, DB-backed) ─────────────────────────────────────
// Admins configure — per data source — which tables show, their order and labels
// (and later which metrics), stored globally like the AI prompts and applied to
// every user's dashboard. A DimensionConfigOverride is the editable slice of a
// DimensionDef; the manifest above stays the built-in default.
export interface DimensionConfigOverride {
  key: string;
  visible: boolean;
  order: number;
  label?: string; // optional custom table title (falls back to the manifest label)
  // Whether this breakdown is offered in the Trends / Distribution "by"
  // dropdowns. Separate from `visible` because the two aren't the same
  // question: a dimension can be worth a table while charting badly (hundreds
  // of near-unique values, say). Absent = offered, so existing configs keep
  // showing everything they showed before this flag existed.
  charts?: boolean;
  // Whether the AI Optimizer analyses this breakdown. Lets an admin start the
  // optimizer on a few core tables and add the rest as they're validated, or
  // drop a table that isn't useful. Absent = analysed, so existing configs are
  // unchanged.
  optimizer?: boolean;
}
// How a KPI card / metric column's value is displayed. Independent of the
// underlying metric's own MetricFormat — an admin can e.g. show `cost` (money
// by default) as a plain Number if that reads better in their KPI row.
export type ValueFormat = "number" | "currency" | "percent";

export interface MetricConfigOverride {
  key: string; // a TABLE_METRIC_COLS key (roasVal / impr / clicks / …)
  visible: boolean;
  order: number;
  label?: string;
  format?: ValueFormat;
  // Offer this metric in the Trends / Distribution chart's metric dropdown.
  // Defaults to true; mirrors DimensionConfigOverride.charts, which does the
  // same for the chart's "by" dropdown — so an admin can keep a column in the
  // tables while dropping it from the chart.
  charts?: boolean;
}

// An admin-built "table widget": a dimension-tab switcher (primary +
// additional dimensions as tabs) with its OWN metric-column set, own
// cross-filtering toggle and own default sort — independent of every other
// table widget for the same connector. Optional/opt-in: a connector with no
// `tables` in its ConnectorConfig keeps rendering its built-in
// connectorTableList() exactly as before (see ExtendedAnalytics.tsx).
export interface TableConfigV2 {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  primaryDimension: string; // a dimension key from the manifest
  additionalDimensions: string[]; // shown as tabs above the table
  metricColumns: MetricConfigOverride[];
  crossFiltering: boolean;
  defaultSort: { key: string; direction: "asc" | "desc" } | null;
}

export interface ConnectorConfig {
  dimensions?: DimensionConfigOverride[];
  metrics?: MetricConfigOverride[];
  // The KPI cards along the top of the dashboard (key = a KPI slot).
  kpis?: MetricConfigOverride[];
  // Admin-built table widgets (see TableConfigV2). Empty/absent = the
  // built-in connectorTableList() rendering, unchanged.
  tables?: TableConfigV2[];
  // Raw Windsor fields with no canonical formula (e.g. GA4's bounceRate),
  // registered for a BUILT-IN connector — same idea as custom connectors'
  // custom_metrics, just layered onto a fixed manifest instead of built from
  // scratch. See applyAdminCustomFields().
  customMetrics?: CustomConnectorMetricInput[];
  // Extra dimensions (Windsor fields) registered for a BUILT-IN connector —
  // same idea as custom connectors' own `dimensions`, just layered onto a
  // fixed manifest. Appended to the manifest's `dimensions` so they show up
  // anywhere a dimension picker reads it (Table Widgets' "+ Add dimension").
  customDimensions?: CustomConnectorDimensionInput[];
  // Which table renders in the "hero" position at the top of the dashboard,
  // above Extended Analytics. Absent = the built-in default (CampaignTable,
  // bound to the manifest's own primaryDimension) — unchanged from before
  // this existed. This ONLY changes what's displayed there; cross-filtering
  // and KPI computation stay pivoted on the manifest's primaryDimension
  // regardless of what's shown, so swapping this is purely visual/low-risk.
  primaryTableSource?: { type: "dimension"; key: string } | { type: "widget"; widgetId: string };
  // Whether Smart Goals and the AI Optimizer apply to this source at all.
  // Goals and optimization advice make sense for an ad platform and much less
  // for, say, Search Console — there is no budget to pace and no bid to
  // change. Absent means yes: nothing changes until an admin turns one off.
  features?: { smartGoals?: boolean; optimizer?: boolean };
  // Free-text instructions an admin writes per source to steer HOW the AI
  // Optimizer phrases its findings — emphasis, tone, what to call out first.
  // Added above the built-in rewording rules (which still hold: never invent a
  // number, never promise a result), so it shapes the wording without touching
  // the deterministic findings. Absent/blank = the built-in prompt alone.
  optimizerInstructions?: string;
  // AI Optimization Threshold: the minimum clicks (sessions on a spend-free
  // source) a single row must have before the AI Optimizer analyses it. Rows
  // below it never produce a recommendation or count toward impact — it stops
  // thin, noisy rows (most search terms) from driving advice. Absent = the
  // built-in default (see DEFAULT_OPTIMIZER_MIN_CLICKS).
  // DEPRECATED: superseded by optimizerThresholds; still read as a single
  // clicks>= rule when the new field is absent.
  optimizerThreshold?: number;
  // AI Optimization Thresholds: the conditions a single row must ALL meet before
  // the AI Optimizer analyses it (Clicks >= 200 AND Ad Profit < 0, say). Rows
  // that fail any rule are never analysed, never produce a recommendation, and
  // never count toward impact. Per source, so each platform screens on its own
  // metrics. Absent = the built-in default (see defaultOptimizerThresholds).
  optimizerThresholds?: ThresholdRule[];
}

/** Comparison used by a threshold rule. */
export type ThresholdOp = "gte" | "lte" | "gt" | "lt" | "eq" | "ne";

/** One AI Optimization Threshold: "<metric> <op> <value>". Rules are ANDed. */
export interface ThresholdRule {
  /** A metric key from THRESHOLD_METRICS (clicks, cost, profit, roas, …). */
  metric: string;
  op: ThresholdOp;
  value: number;
}

export type ConnectorConfigMap = Partial<Record<ConnectorId, ConnectorConfig>>;

/** Is this source meant to carry Smart Goals / the optimizer? Default yes. */
export function connectorHasFeature(
  feature: "smartGoals" | "optimizer",
  cfg?: ConnectorConfig,
): boolean {
  return cfg?.features?.[feature] !== false;
}

// Merge an admin config onto a manifest → the EFFECTIVE manifest the dashboard
// renders (hidden dimensions removed, remaining ones reordered + relabelled; same
// for metrics). Returns the base untouched when there's no config.
export function applyConnectorConfig(
  base: ConnectorManifest,
  cfg?: ConnectorConfig,
): ConnectorManifest {
  let dimensions = base.dimensions;
  if (cfg?.dimensions?.length) {
    const byKey = new Map(cfg.dimensions.map((d) => [d.key, d]));
    dimensions = base.dimensions
      .map((d) => {
        const o = byKey.get(d.key);
        const label = o?.label?.trim() ? o.label.trim() : d.label;
        return {
          dim: { ...d, label },
          visible: o ? o.visible !== false : true,
          order: o ? o.order : 999,
        };
      })
      .filter((x) => x.visible)
      .sort((a, b) => a.order - b.order)
      .map((x) => x.dim);
  }

  let metrics = base.metrics;
  if (cfg?.metrics?.length) {
    const byKey = new Map(cfg.metrics.map((m) => [m.key, m]));
    metrics = base.metrics
      .map((m) => {
        const o = byKey.get(m.key);
        return { metric: m, visible: o ? o.visible !== false : true, order: o ? o.order : 999 };
      })
      .filter((x) => x.visible)
      .sort((a, b) => a.order - b.order)
      .map((x) => x.metric);
  }

  return { ...base, dimensions, metrics };
}

// Build the default (unconfigured) override rows for a connector — used by the
// admin editor to render the initial, fully-visible, in-order list.
export function defaultConfig(
  id: ConnectorId,
): Required<Pick<ConnectorConfig, "dimensions" | "metrics">> {
  const c = CONNECTORS[id];
  return {
    dimensions: c.dimensions.map((d, i) => ({
      key: d.key,
      visible: true,
      order: i,
      label: d.label,
    })),
    metrics: TABLE_METRIC_COLS.map((m, i) => ({
      key: m.key,
      visible: true,
      order: i,
      label: m.label,
    })),
  };
}

// ─── Extended-Analytics table list (shared by the dashboard + admin editor) ──
// A rendered table row. Google Ads keeps a bespoke set (Ads / Campaign Type / Time
// have custom handling); other connectors derive theirs from the manifest.
export interface ConnectorTable {
  key: string;
  label: string;
  dimensionLabel: string;
  available: boolean;
  custom?: "time";
}

export const GOOGLE_ADS_EXTENDED_TABLES: ConnectorTable[] = [
  { key: "ad_group", label: "Ad Groups Performance", dimensionLabel: "Ad Group", available: true },
  { key: "ad", label: "Ad Performance", dimensionLabel: "Ad", available: true },
  {
    key: "campaign_type",
    label: "Campaign Type Performance",
    dimensionLabel: "Campaign Type",
    available: true,
  },
  {
    key: "search_term",
    label: "Search Terms Performance",
    dimensionLabel: "Search Term",
    available: true,
  },
  {
    key: "match_type",
    label: "Match Type Performance",
    dimensionLabel: "Match Type",
    available: true,
  },
  { key: "device", label: "Device Performance", dimensionLabel: "Device", available: true },
  { key: "network", label: "Network Performance", dimensionLabel: "Network", available: true },
  {
    key: "time",
    label: "Time Performance",
    dimensionLabel: "Time",
    available: true,
    custom: "time",
  },
  { key: "country", label: "Geography Performance", dimensionLabel: "Country", available: true },
];

// The full (unconfigured) Extended-Analytics table list for a connector.
// Whichever dimension is currently the "hero" (primary) table is left out —
// it's already shown above Extended Analytics, so including it here would
// show e.g. "Channel Performance" twice. Defaults to the manifest's own
// primaryDimension; pass `effectivePrimaryKey` when an admin has swapped a
// different dimension into that slot (see ConnectorConfig.primaryTableSource)
// so THAT one is excluded instead, and the manifest's original primary
// (e.g. "campaign") reappears here since it's no longer the hero.
export function connectorTableList(id: string, effectivePrimaryKey?: string): ConnectorTable[] {
  const c = getConnector(id);
  const primaryKey = effectivePrimaryKey ?? c.primaryDimension;
  if (id === "google_ads") {
    // "campaign" isn't a member of this hardcoded list by default (it's the
    // hero); add it back in when something else has taken that slot.
    const list =
      primaryKey === "campaign"
        ? GOOGLE_ADS_EXTENDED_TABLES
        : [
            {
              key: "campaign",
              label: "Campaign Performance",
              dimensionLabel: "Campaign",
              available: true,
            },
            ...GOOGLE_ADS_EXTENDED_TABLES,
          ];
    return list.filter((t) => t.key !== primaryKey);
  }
  return c.dimensions
    .filter((d) => d.key !== primaryKey)
    .map((d) => ({ key: d.key, label: d.label, dimensionLabel: d.singular, available: true }));
}

/** The breakdowns a source's chart "by" dropdowns offer: its visible tables in
 *  the admin's order, minus any the admin excluded from charts. The primary
 *  entity is added by the caller — it isn't part of the table list. */
// Dimensions a source can break down by that have no table of their own: the
// buckets the Time Performance widget switches between, and a few Google Ads
// breakdowns the API can group by. A cross-filter has to redistribute across
// these too, or their table keeps showing account-wide numbers under an active
// selection.
const EXTRA_CROSS_FILTER_DIMS: Record<string, string[]> = {
  google_ads: [
    "keyword",
    "audience",
    "region",
    "hour",
    "day_of_week",
    "week",
    "month",
    "quarter",
    "year",
  ],
};

/** Every dimension a cross-filter selection is redistributed across for a
 *  source: each breakdown it renders a table for, plus the ones above. Derived
 *  from the source's own table list — Google Ads used to carry a hand-written
 *  list here that silently omitted three of its tables (search terms, campaign
 *  type, ad), so those three ignored every selection made anywhere else and
 *  went on showing whole-account totals. */
export function crossFilterDimensionsFor(id: string): string[] {
  const fromTables = connectorTableList(id)
    .filter((t) => t.available && !t.custom)
    .map((t) => t.key);
  return [...new Set([...fromTables, ...(EXTRA_CROSS_FILTER_DIMS[id] ?? [])])].filter(
    (k) => k !== getConnector(id).primaryDimension,
  );
}

export function chartDimensionList(id: string, dims?: DimensionConfigOverride[]): ConnectorTable[] {
  const byKey = new Map((dims ?? []).map((d) => [d.key, d]));
  return applyTableConfig(connectorTableList(id), dims).filter(
    (t) =>
      byKey.get(t.key)?.charts !== false &&
      // A breakdown with no data behind it yet, and the Time table (its own
      // date buckets — the chart is already a time series), can't be plotted.
      t.available &&
      !t.custom,
  );
}

// Apply an admin dimension config to any table list (hide / reorder / relabel).
export function applyTableConfig(
  list: ConnectorTable[],
  dims?: DimensionConfigOverride[],
): ConnectorTable[] {
  if (!dims?.length) return list;
  const byKey = new Map(dims.map((d) => [d.key, d]));
  return list
    .map((t) => {
      const o = byKey.get(t.key);
      return {
        t: o?.label?.trim() ? { ...t, label: o.label.trim() } : t,
        visible: o ? o.visible !== false : true,
        order: o ? o.order : 999,
      };
    })
    .filter((x) => x.visible)
    .sort((a, b) => a.order - b.order)
    .map((x) => x.t);
}

/** Compare two Windsor account ids.
 *  Google Ads reports its customer id in two shapes — "2177919789" and
 *  "217-791-9789" — so those are compared digits-only. Other platforms' ids
 *  aren't numeric at all (Search Console uses e.g. "sc-domain:example.com"),
 *  and stripping non-digits reduced them to an empty string: the connect flow
 *  then read that as "no account id was given" and refused to save. */
export function normalizeAccountId(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  // Numeric ids (Google Ads) differ only in punctuation.
  if (!/[a-z]/i.test(raw)) return raw.replace(/\D/g, "");
  // Property-style ids differ in FORM between Windsor's two APIs: the account
  // list reports a Search Console property as "sc-domain:example.com" while the
  // data rows report the bare host "example.com". Reduce both to the host, or
  // the account a user was assigned never matches the rows and the dashboard
  // comes back empty.
  return raw
    .toLowerCase()
    .replace(/^sc-domain[:.]/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

/** The Windsor account this user has bound for a given source. Each connector
 *  has its own binding under app_metadata.windsor_accounts[<windsorSource>];
 *  google_ads additionally honours the legacy single windsor_account_id.
 *  Passing another source's account id would filter every row out — the fetch
 *  scopes results to it — so this must be resolved per connector, not once. */
export function windsorAccountIdFor(
  appMetadata: Record<string, unknown> | null | undefined,
  connectorId: string,
): string | undefined {
  const ds = getConnector(connectorId).windsorSource;
  const bound = (appMetadata?.windsor_accounts ?? {}) as Record<string, { account_id?: string }>;
  return (
    bound[ds]?.account_id ||
    (connectorId === DEFAULT_CONNECTOR
      ? (appMetadata?.windsor_account_id as string | undefined)
      : undefined) ||
    undefined
  );
}

// The connectors the signed-in user has actually connected — a Windsor co-user
// binding (windsor_accounts[<ds>]) for any source, plus Google Ads via OAuth or
// its legacy Windsor account. Used by the sidebar + header switcher so both list
// only connected platforms. Falls back to Google Ads so the dashboard is reachable.
export function connectedConnectorsFrom(
  user: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } | null,
): ConnectorId[] {
  if (!user) return [DEFAULT_CONNECTOR];
  const am = user.app_metadata ?? {};
  const accounts = (am.windsor_accounts ?? {}) as Record<string, unknown>;
  const out = CONNECTOR_IDS.filter((id) => {
    const ds = CONNECTORS[id].windsorSource;
    return (
      !!accounts[ds] ||
      (id === DEFAULT_CONNECTOR && (!!am.windsor_account_id || !!am.google_ads_refresh_token))
    );
  });
  return out.length > 0 ? out : [DEFAULT_CONNECTOR];
}

/** The sources the user has ACTUALLY connected, in registry (admin) order —
 *  possibly empty. Unlike connectedConnectorsFrom this does NOT fall back to
 *  Google Ads, so callers can tell "nothing connected" apart from "Google Ads
 *  connected" (onboarding routing and the sidebar's section visibility). */
export function connectedConnectorsRaw(
  user: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } | null,
): ConnectorId[] {
  if (!user) return [];
  const am = user.app_metadata ?? {};
  const accounts = (am.windsor_accounts ?? {}) as Record<string, unknown>;
  return CONNECTOR_IDS.filter((id) => {
    const ds = CONNECTORS[id].windsorSource;
    return (
      !!accounts[ds] ||
      (id === DEFAULT_CONNECTOR && (!!am.windsor_account_id || !!am.google_ads_refresh_token))
    );
  });
}

/** The user's first actually-connected source, or null when none. */
export function firstConnectedConnector(
  user: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } | null,
): ConnectorId | null {
  return connectedConnectorsRaw(user)[0] ?? null;
}

// ─── Table metric columns (shared by the dashboard tables + admin editor) ────
// Every connector's per-dimension table is a PerfRow, so the metric columns are
// the same set; the admin picks which show, in what order, and their label.
export interface TableMetricCol {
  key: string;
  label: string;
  // Set only for admin-registered custom metrics — tells the table renderer
  // there's no dedicated PerfRow field for this key and it should read
  // `row.extra[key]` instead, formatted per this value.
  format?: MetricFormat;
}
export const TABLE_METRIC_COLS: TableMetricCol[] = [
  { key: "roasVal", label: "ROAS" },
  { key: "impr", label: "Impr." },
  { key: "clicks", label: "Clicks" },
  { key: "cpc", label: "CPC" },
  { key: "ctr", label: "CTR" },
  { key: "convRate", label: "Conv. rate" },
  { key: "conv", label: "Conv." },
  { key: "cpa", label: "CPA" },
  { key: "revenue", label: "Revenue" },
  { key: "cost", label: "Cost" },
  { key: "profit", label: "Profit (ads)" },
];

// The metric columns that make sense for a source. Cost-free connectors (GA4,
// Shopify) have no spend, so the spend-derived columns are dropped rather than
// offered as always-zero; the shared ones are renamed to the source's wording.
const COST_ONLY_METRIC_COLS = new Set(["roasVal", "cpc", "cpa", "cost", "profit", "impr", "ctr"]);
const METRIC_COL_LABELS: Record<string, Record<string, string>> = {
  ga4: { clicks: "Sessions", conv: "Conversions" },
  shopify: { clicks: "Items sold", conv: "Orders", revenue: "Total sales" },
};
export function connectorMetricCols(id: string): TableMetricCol[] {
  const c = getConnector(id);
  const labels = METRIC_COL_LABELS[c.id] ?? {};
  const base = TABLE_METRIC_COLS.filter((m) => c.hasCost || !COST_ONLY_METRIC_COLS.has(m.key)).map(
    (m) => (labels[m.key] ? { ...m, label: labels[m.key] } : m),
  );
  // Admin-registered custom metrics (raw Windsor fields, e.g. GA4's bounceRate)
  // — offered in the same picker as the built-in columns. A key is free to
  // match a canonical one ("clicks", "impressions", "ctr" are ordinary Windsor
  // field names), and when it does the admin's choice REPLACES that column
  // rather than adding a second one showing the same number under a different
  // name.
  const custom: TableMetricCol[] = c.customMetricFields
    ? Object.keys(c.customMetricFields).map((key) => {
        const def = c.metrics.find((m) => m.key === key);
        return { key, label: def?.label ?? key, format: def?.format };
      })
    : [];
  const overridden = new Map(custom.map((m) => [m.key, m]));
  return [
    ...base.map((m) => overridden.get(m.key) ?? m),
    ...custom.filter((m) => !base.some((b2) => b2.key === m.key)),
  ];
}

// ─── KPI cards (top of the dashboard) ────────────────────────────────────────
// The admin can pick WHICH cards a source shows, their order and labels — so the
// catalog below is every slot the source can actually compute, not just the ones
// its manifest ships by default (that's what makes "add a card" possible).
const KPI_SLOT_LABELS: Record<KpiSlot, string> = {
  clicks: "Clicks",
  convRate: "Conv. Rate",
  conversions: "Conversions",
  cpa: "CPA",
  cost: "Cost",
  revenue: "Revenue",
  roas: "ROAS",
  profit: "Profit",
  aov: "AOV",
};
const COST_ONLY_KPI_SLOTS = new Set<KpiSlot>(["cost", "cpa", "roas", "profit"]);

export interface KpiCardOption {
  slot: KpiSlot;
  label: string;
  defaultVisible: boolean;
  // Set only for admin-registered custom metrics — the metric's OWN format
  // (money/percent/…), independent of an admin's Value Format override.
  format?: MetricFormat;
}

export function connectorKpiOptions(id: string): KpiCardOption[] {
  const c = getConnector(id);
  const shipped = new Map(c.kpiCards.map((k) => [k.slot, k]));
  const canonical = KPI_SLOTS.filter((slot) => c.hasCost || !COST_ONLY_KPI_SLOTS.has(slot))
    .map((slot) => ({
      slot,
      label: shipped.get(slot)?.label ?? KPI_SLOT_LABELS[slot],
      defaultVisible: shipped.has(slot),
    }))
    // Keep the manifest's own order first, then the rest of the catalog.
    .sort((a, b) => {
      const ai = c.kpiCards.findIndex((k) => k.slot === a.slot);
      const bi = c.kpiCards.findIndex((k) => k.slot === b.slot);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  // Admin-registered custom metrics (raw Windsor fields, e.g. GA4's
  // bounceRate) can also become a KPI card — opt-in only (never shown by
  // default, same as a fresh custom metric column), appended after the
  // canonical catalog.
  const custom: KpiCardOption[] = c.customMetricFields
    ? Object.keys(c.customMetricFields).map((key) => {
        const def = c.metrics.find((m) => m.key === key);
        return { slot: key, label: def?.label ?? key, defaultVisible: false, format: def?.format };
      })
    : [];
  // Same rule as the metric columns: a custom metric named after a canonical
  // slot renames that card instead of producing a second one beside it.
  const bySlot = new Map(custom.map((o) => [o.slot, o]));
  return [
    ...canonical.map((o) =>
      bySlot.has(o.slot)
        ? { ...o, label: bySlot.get(o.slot)!.label, format: bySlot.get(o.slot)!.format }
        : o,
    ),
    ...custom.filter((o) => !canonical.some((c2) => c2.slot === o.slot)),
  ];
}

/** The KPI cards a source shows, honouring the admin config (hide/reorder/rename/format). */
export function applyKpiConfig(
  id: string,
  cfg?: MetricConfigOverride[],
): { slot: KpiSlot; label: string; format?: ValueFormat }[] {
  const options = connectorKpiOptions(id);
  if (!cfg?.length) {
    return options.filter((o) => o.defaultVisible).map((o) => ({ slot: o.slot, label: o.label }));
  }
  const byKey = new Map(cfg.map((m) => [m.key, m]));
  return options
    .map((o, i) => {
      const ov = byKey.get(o.slot);
      return {
        slot: o.slot,
        label: ov?.label?.trim() ? ov.label.trim() : o.label,
        visible: ov ? ov.visible !== false : o.defaultVisible,
        order: ov ? ov.order : 100 + i,
        format: ov?.format,
      };
    })
    .filter((x) => x.visible)
    .sort((a, b) => a.order - b.order)
    .map(({ slot, label, format }) => ({ slot, label, format }));
}

// Apply an admin metric config (hide / reorder / relabel) to the column list.
export function applyMetricColConfig(
  cfg?: MetricConfigOverride[],
  connectorId?: string,
): TableMetricCol[] {
  const base = connectorId ? connectorMetricCols(connectorId) : TABLE_METRIC_COLS;
  if (!cfg?.length) return base;
  const byKey = new Map(cfg.map((m) => [m.key, m]));
  return base
    .map((c) => {
      const o = byKey.get(c.key);
      return {
        c: o?.label?.trim() ? { ...c, label: o.label.trim() } : c,
        visible: o ? o.visible !== false : true,
        order: o ? o.order : 999,
      };
    })
    .filter((x) => x.visible)
    .sort((a, b) => a.order - b.order)
    .map((x) => x.c);
}

// The canonical metrics the day-level chart data actually carries per primary
// entity (revenue as the bare key, the rest under `_cost_`/`_clicks_`/`_conv_`
// prefixes — see page.tsx). Ratio-style columns like CTR, CPC or ROAS have no
// such per-entity series, so offering them would only draw a flat zero line.
const CHART_PLOTTABLE_METRICS: Record<string, MetricFormat> = {
  revenue: "money",
  cost: "money",
  profit: "money",
  clicks: "number",
  conv: "number",
};

/** The metrics offered in the chart's metric dropdown for a source: its visible
 *  metric columns, minus any the admin unticked for charts, minus the ones the
 *  chart has no series for. Admin-registered custom metrics are always
 *  plottable — the chart data carries a per-entity series for each. The list
 *  used to be a fixed Google-Ads set (Revenue / Conversions / Traffic), which
 *  on another source offered metrics it doesn't have and hid the ones it
 *  does. */
export function chartMetricList(id: string, cfg?: MetricConfigOverride[]): TableMetricCol[] {
  const customKeys = new Set(Object.keys(getConnector(id).customMetricFields ?? {}));
  const byKey = new Map((cfg ?? []).map((m) => [m.key, m]));
  return (
    applyMetricColConfig(cfg, id)
      .filter(
        (m) =>
          byKey.get(m.key)?.charts !== false &&
          (customKeys.has(m.key) || m.key in CHART_PLOTTABLE_METRICS),
      )
      // Canonical columns carry no format of their own (the tables know how to
      // render them); the chart needs one to format its axis and tooltip.
      .map((m) => (m.format ? m : { ...m, format: CHART_PLOTTABLE_METRICS[m.key] }))
  );
}

/** URL slug for a source's dashboard. Ids use underscores; URLs read better
 *  with hyphens, and google_ads keeps the /google-ads path it has always had. */
export function connectorSlug(id: ConnectorId): string {
  return id.replace(/_/g, "-");
}

/** The source a dashboard URL segment refers to, or null when it names none.
 *  Matches the live registry, so an admin-added source is routable the moment
 *  it exists — nothing to add here per source. */
export function connectorFromSlug(slug: string): ConnectorId | null {
  const want = String(slug ?? "").toLowerCase();
  return CONNECTOR_IDS.find((id) => connectorSlug(id).toLowerCase() === want) ?? null;
}

export let CONNECTOR_IDS: ConnectorId[] = Object.keys(CONNECTORS);

export const DEFAULT_CONNECTOR: ConnectorId = "google_ads";

export function isConnectorId(v: unknown): v is ConnectorId {
  return typeof v === "string" && v in CONNECTORS;
}

export function getConnector(id: string | null | undefined): ConnectorManifest {
  return isConnectorId(id) ? CONNECTORS[id] : CONNECTORS[DEFAULT_CONNECTOR];
}

// Resolve a dimension def within a connector, tolerant of the `date,<dim>` prefix.
export function getDimensionDef(
  connectorId: string | null | undefined,
  groupBy: string,
): DimensionDef | null {
  const c = getConnector(connectorId);
  const base = groupBy.replace(/^date,/, "");
  return c.dimensions.find((d) => d.key === base) ?? null;
}

// The Windsor `fields` string for a connector + group_by, or null when the
// connector/dimension is unknown (the caller then keeps its own default — e.g.
// the Google-Ads windsor route's bespoke logic).
export function windsorFieldsFor(
  connectorId: string | null | undefined,
  groupBy: string,
): string | null {
  // A plain date breakdown isn't one of the connector's dimensions, but it still
  // has to ask for THAT source's metric columns — not Google Ads' ones.
  if (groupBy === "date") return `date,${getConnector(connectorId).windsorMetrics}`;
  const d = getDimensionDef(connectorId, groupBy);
  if (!d) return null;
  return groupBy.startsWith("date,") ? d.windsorDateFields : d.windsorFields;
}

// Dimensions the AI may query for a source. Derived from the ones that actually
// resolve to Windsor fields, so the model can never pick a breakdown that would
// fall through to another connector's schema.
export function aiQueryDimensionsFor(connectorId: string | null | undefined): string[] {
  const c = getConnector(connectorId);
  const resolvable = new Set(c.dimensions.map((d) => d.key));
  return [...c.aiDimensions.filter((d) => resolvable.has(d)), "date"];
}

// First populated value across a dimension's candidate response keys.
export function readDimensionValue(
  connectorId: string | null | undefined,
  groupBy: string,
  row: Record<string, unknown>,
): string {
  if (groupBy === "date") return String(row.date ?? "Unknown");
  const d = getDimensionDef(connectorId, groupBy);
  if (!d) return String(row.dimension ?? "Unknown");
  for (const k of d.valueKeys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v);
  }
  return "Unknown";
}
