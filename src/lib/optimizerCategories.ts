// ─────────────────────────────────────────────────────────────────────────────
// The optimizer across every breakdown a source has.
//
// One breakdown at a time answered "which campaign is losing money". The
// account-level question is different: WHERE is it losing money — in a search
// term, a device, an hour of the day, a region? So every table the source
// exposes is analysed in turn, and each finding carries the rows it was drawn
// from, so the claim can be checked against the data rather than trusted.
//
// Source-agnostic by construction: the categories ARE the source's own
// breakdowns, read from the registry. Google Ads brings search terms and match
// types; GA4 brings channels and landing pages; a source built in the
// constructor brings whatever an admin gave it. Nothing here names a platform.
// ─────────────────────────────────────────────────────────────────────────────

import {
  findOpportunities,
  type EntityRow,
  type Opportunity,
  type QuietReason,
} from "./aiOptimizer";
import { type GoalFormat, type GoalMetricDef, type MetricTotals } from "./smartGoalMetrics";
import type { ThresholdOp, ThresholdRule } from "./connectors";

export type Priority = "high" | "medium" | "low";

/** One column of an evidence table. */
export interface EvidenceColumn {
  key: string;
  label: string;
  /** How to render it — the same vocabulary the goal metrics use. */
  format: "number" | "money" | "ratio" | "percent" | "text";
}

export interface EvidenceRow {
  label: string;
  values: Record<string, number>;
  /** The row the recommendation is about, so the eye lands on it. */
  flagged?: boolean;
}

/**
 * The rows a recommendation was drawn from.
 *
 * Shown under the recommendation itself, because "exclude these three regions"
 * is a claim about specific numbers and someone has to be able to check it
 * before acting. Without it the panel is asking to be taken on faith.
 */
export interface Evidence {
  columns: EvidenceColumn[];
  /** The preview rows — at most PREVIEW_ROWS. */
  rows: EvidenceRow[];
  /** How many qualifying rows there were in all, so the table can say it is
   *  showing only the first few of a larger set. */
  rowCount: number;
  total: Record<string, number>;
  /** What the rows add up to, in a sentence. */
  insight: string;
  /** The rule that picked these rows out, when one did. */
  filter?: string;
}

export interface Recommendation {
  id: string;
  /** The breakdown it came from — its key in the registry. */
  category: string;
  categoryLabel: string;
  priority: Priority;
  kind: Opportunity["kind"];
  entity: string;
  /** For a consolidated recommendation (Time of Day), every entity it covers —
   *  so opening the dashboard can filter to all of them at once. */
  entities?: string[];
  title: string;
  detail: string;
  impact: number;
  /** What the account does today, in one line. */
  currentState: string;
  /** What acting on it is estimated to be worth. An estimate, always labelled. */
  expectedResult: string;
  /** The change to make, phrased as an instruction. */
  action: string;
  evidence?: Evidence;
  weight: number;
}

/**
 * The two kinds of work a category represents.
 *
 * Taken from the findings themselves rather than from a list of table names:
 * cutting a losing search term and cutting a losing device are the same job,
 * and a source nobody has seen yet still sorts correctly.
 */
export type CategoryGroup = "cost_saving" | "growth";

export interface CategorySummary {
  key: string;
  label: string;
  group: CategoryGroup;
  count: number;
  /** The most urgent priority among its recommendations. */
  priority: Priority;
  impact: number;
  /** 0–100. How healthy this part of the account looks. */
  score: number;
  /** Set when the category produced nothing, saying which kind of nothing. */
  quietReason?: QuietReason;
}

export interface AccountAnalysis {
  recommendations: Recommendation[];
  categories: CategorySummary[];
  /** 0–100 across the categories that had enough data to score. */
  overallScore: number;
  totalImpact: number;
  impactMetric: string;
  impactMetricLabel: string;
  /** How to render an impact. Conversions under a dollar sign is the mistake
   *  this exists to prevent — the engine quotes gaps in money OR in
   *  conversions depending on what the source can support. */
  impactFormat: GoalFormat;
  counts: Record<Priority, number>;
}

/** Impacts come back as money or as a count of conversions, never anything
 *  else — see impactBasis in aiOptimizer. */
export function impactFormatFor(impactMetric: string): GoalFormat {
  return impactMetric === "conv" ? "number" : "money";
}

/**
 * Turn the dashboard's per-dimension rows into entities the engine can read.
 *
 * That endpoint reports money in THOUSANDS — the dashboard renders it with a K
 * suffix — and names its fields for the table, not for this. Read raw, a $858
 * search term arrives as 0.858 and every impact comes out a thousandth of what
 * it is. The conversion belongs here, once, where a test can hold it.
 */
export function entitiesFromPerfRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any[],
): EntityRow[] {
  const byName = new Map<string, EntityRow>();
  for (const r of raw ?? []) {
    const name = String(r?.dimension ?? "").trim();
    if (!name) continue;
    const cur = byName.get(name) ?? {
      name,
      totals: { clicks: 0, impressions: 0, cost: 0, conversions: 0, revenue: 0, extra: {} },
    };
    cur.totals.clicks += Number(r.clicks) || 0;
    cur.totals.impressions += Number(r.impr) || 0;
    cur.totals.conversions += Number(r.conv) || 0;
    cur.totals.cost += (Number(r.cost) || 0) * 1000;
    cur.totals.revenue += (Number(r.revenue) || 0) * 1000;
    byName.set(name, cur);
  }
  return [...byName.values()];
}

/**
 * Turn /api/windsor's rows into entities — the endpoint the primary breakdown
 * actually comes from.
 *
 * /api/data/[dimension] only ever validates ad_group, device, search_term and
 * the rest of the SECONDARY tables — the primary entity (campaign, channel,
 * whatever a source calls its own primaryDimension) was never in that list,
 * because the dashboard's own primary table has always read it from
 * /api/windsor instead. Reading the primary breakdown through /api/data would
 * silently return zero rows every time, campaign list included.
 *
 * Unlike /api/data's rows, these carry raw units (not thousands) and the name
 * under `dimension` OR the connector's own field (`campaign`, for Google Ads).
 */
export function entitiesFromWindsorRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any[],
): EntityRow[] {
  const byName = new Map<string, EntityRow>();
  for (const r of raw ?? []) {
    const name = String(r?.dimension ?? r?.campaign ?? "").trim();
    if (!name) continue;
    const cur = byName.get(name) ?? {
      name,
      totals: { clicks: 0, impressions: 0, cost: 0, conversions: 0, revenue: 0, extra: {} },
    };
    cur.totals.clicks += Number(r.clicks) || 0;
    cur.totals.impressions += Number(r.impressions) || 0;
    cur.totals.conversions += Number(r.conversions) || 0;
    cur.totals.cost += Number(r.spend) || 0;
    cur.totals.revenue += Number(r.conversion_value) || 0;
    byName.set(name, cur);
  }
  return [...byName.values()];
}

/** One breakdown's rows, as fetched. */
export interface CategoryInput {
  key: string;
  label: string;
  /** The singular noun for one row — "Search term", "Device". */
  singular: string;
  rows: EntityRow[];
  /** When these rows are a scoped subset (one campaign's search terms), the
   *  account-wide rows for the same breakdown, so the subset is judged against
   *  the account's rate rather than its own. Omit for account-level analysis. */
  benchmarkRows?: EntityRow[];
}

// How much of the account's own scale a finding has to be worth before it is
// called urgent. Relative, not absolute: $500 is a crisis on a $2k account and
// a rounding error on a $2m one.
const HIGH_SHARE = 0.1;
const MEDIUM_SHARE = 0.03;

const sum = (rows: EntityRow[], pick: (t: MetricTotals) => number) =>
  rows.reduce((a, r) => a + pick(r.totals), 0);

/** The default minimum clicks in a threshold rule. */
export const DEFAULT_OPTIMIZER_MIN_CLICKS = 200;

/** The metrics an AI Optimization Threshold rule can screen on, each derived
 *  from a row's totals. A metric a row can't compute (ROAS with no spend)
 *  returns null and the rule it's in fails, so the row is left out. Percentages
 *  are 0–100 so a rule reads "CTR < 1". */
export const THRESHOLD_METRICS: Record<
  string,
  {
    label: string;
    unit: "count" | "money" | "ratio" | "percent";
    get: (t: MetricTotals) => number | null;
  }
> = {
  clicks: { label: "Clicks / Sessions", unit: "count", get: (t) => t.clicks },
  cost: { label: "Cost", unit: "money", get: (t) => t.cost },
  conversions: { label: "Conversions", unit: "count", get: (t) => t.conversions },
  revenue: { label: "Revenue", unit: "money", get: (t) => t.revenue },
  profit: { label: "Ad Profit", unit: "money", get: (t) => t.revenue - t.cost },
  roas: { label: "ROAS", unit: "ratio", get: (t) => (t.cost > 0 ? t.revenue / t.cost : null) },
  cpa: {
    label: "CPA",
    unit: "money",
    get: (t) => (t.conversions > 0 ? t.cost / t.conversions : null),
  },
  ctr: {
    label: "CTR %",
    unit: "percent",
    get: (t) => (t.impressions > 0 ? (t.clicks / t.impressions) * 100 : null),
  },
  convRate: {
    label: "Conversion rate %",
    unit: "percent",
    get: (t) => (t.clicks > 0 ? (t.conversions / t.clicks) * 100 : null),
  },
};

function compare(value: number, op: ThresholdOp, target: number): boolean {
  switch (op) {
    case "gte":
      return value >= target;
    case "lte":
      return value <= target;
    case "gt":
      return value > target;
    case "lt":
      return value < target;
    case "eq":
      return value === target;
    case "ne":
      return value !== target;
  }
}

/** Does a row meet EVERY threshold rule? An unknown metric is ignored; a metric
 *  the row can't compute fails its rule (so the row is excluded). */
export function rowMeetsThresholds(t: MetricTotals, rules: ThresholdRule[]): boolean {
  for (const r of rules) {
    const m = THRESHOLD_METRICS[r.metric];
    if (!m) continue;
    const v = m.get(t);
    if (v === null || !compare(v, r.op, r.value)) return false;
  }
  return true;
}

/** Keep only the rows that meet all the source's threshold rules, so nothing
 *  below the bar is analysed or counted. No rules = every row (pre-threshold). */
export function qualifyRows(rows: EntityRow[], rules: ThresholdRule[]): EntityRow[] {
  return rules.length ? rows.filter((r) => rowMeetsThresholds(r.totals, rules)) : rows;
}

/** The built-in rules a source uses until an admin sets its own: NONE.
 *
 *  An unconfigured source is analysed in full — findOpportunities' own
 *  materiality and account-rate comparison decide what's worth flagging. A
 *  built-in Clicks ≥ 200 default silently produced ZERO recommendations on
 *  sources whose entities don't clear 200 clicks (Meta, GA4 on smaller
 *  accounts), which read as "nothing to optimise / 100% healthy" when there was
 *  plenty to look at. A threshold only gates the analysis once an admin sets one
 *  deliberately, per source, in the threshold editor. */
export function defaultOptimizerThresholds(_hasCost?: boolean): ThresholdRule[] {
  return [];
}

/** The rules in force for a source: its own if set, the legacy single clicks
 *  threshold if that's all it has, else the built-in default. */
export function resolveOptimizerThresholds(
  cfg: { optimizerThresholds?: ThresholdRule[]; optimizerThreshold?: number } | undefined,
  hasCost: boolean,
): ThresholdRule[] {
  if (cfg?.optimizerThresholds?.length) return cfg.optimizerThresholds;
  if (typeof cfg?.optimizerThreshold === "number")
    return [{ metric: "clicks", op: "gte", value: cfg.optimizerThreshold }];
  return defaultOptimizerThresholds(hasCost);
}

/** How many rows an evidence preview table shows at most. The rest stay in the
 *  dashboard behind "Explore in Dashboard". */
export const PREVIEW_ROWS = 20;

/** Breakdowns whose findings are collapsed into ONE recommendation covering all
 *  of them, rather than one card per row. Time of Day has an entry per hour and
 *  Search Terms can have thousands — a card per row drowns the list — so each
 *  becomes a single card with a table of every qualifying row (top rows shown,
 *  the rest behind "Explore in Dashboard"). Every other breakdown (ad groups,
 *  ads, devices …) stays one card per entity. */
const CONSOLIDATED_CATEGORIES = new Set(["hour", "search_term"]);

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** Where a finding sits against the size of the account it was found in. */
export function priorityFor(impact: number, accountScale: number): Priority {
  if (accountScale <= 0) return "low";
  const share = impact / accountScale;
  if (share >= HIGH_SHARE) return "high";
  if (share >= MEDIUM_SHARE) return "medium";
  return "low";
}

/**
 * How healthy one breakdown looks, 0–100.
 *
 * The share of what this breakdown could be returning that is currently being
 * missed. A category with nothing wrong scores 100; one where half the
 * potential is going astray scores 50. Expressed against the account's own
 * numbers, so it says nothing about how this account compares to anyone else's
 * — a claim the data can't support.
 */
/**
 * The glyph a breakdown is shown with in the optimizer's category list.
 *
 * The spec draws one per category, so every row needs one — including rows the
 * spec never named, because the list is built from whatever breakdowns a source
 * actually has rather than from a fixed set. Matching is by dimension key
 * first, then by what the label says, so an admin-registered "Landing Pages"
 * table gets the same picture as a built-in one would. Anything still unknown
 * falls back to the spec's own "Other" glyph rather than an empty gap.
 */
const ICON_BY_KEY: Record<string, string> = {
  // Google Ads' own breakdowns.
  campaign: "📊",
  campaign_type: "🏷️",
  ad_group: "👥",
  ad: "📄",
  keyword: "🔑",
  match_type: "🎯",
  search_term: "🔍",
  device: "📱",
  network: "🌐",
  audience: "👥",
  time: "⏰",
  hour: "⏰",
  day_of_week: "⏰",
  country: "🌍",
  region: "🌍",
  // Common elsewhere — GA4, Shopify, and whatever a constructor source brings.
  channel: "🌐",
  source: "🔗",
  medium: "🔗",
  landing_page: "🖼️",
  page: "🖼️",
  product: "📦",
  budget: "💰",
  bidding: "💵",
  extensions: "➕",
  ad_copy: "✍️",
};

/** Words worth recognising in a label when the key itself isn't known. */
const ICON_BY_WORD: [RegExp, string][] = [
  [/keyword/i, "🔑"],
  [/match/i, "🎯"],
  [/search term|query|queries/i, "🔍"],
  [/device/i, "📱"],
  [/network/i, "🌐"],
  [/audience|segment/i, "👥"],
  [/time|hour|day|week|month/i, "⏰"],
  [/geo|country|region|location|city/i, "🌍"],
  [/landing|page/i, "🖼️"],
  [/product|item|sku/i, "📦"],
  [/budget|spend|cost/i, "💰"],
  [/bid/i, "💵"],
  [/extension/i, "➕"],
  [/ad group/i, "👥"],
  [/ad copy|creative|headline/i, "✍️"],
  [/campaign type|type/i, "🏷️"],
  [/campaign/i, "📊"],
  [/\bads?\b/i, "📄"],
  [/channel/i, "🌐"],
];

export function categoryIcon(key: string, label = ""): string {
  const byKey = ICON_BY_KEY[key.toLowerCase()];
  if (byKey) return byKey;
  for (const [re, icon] of ICON_BY_WORD) if (re.test(label) || re.test(key)) return icon;
  return "⋯";
}

export function categoryScore(impact: number, potential: number): number {
  if (potential <= 0) return 100;
  const missed = Math.min(1, Math.max(0, impact / potential));
  return Math.round((1 - missed) * 100);
}

/** An impact in its own units. A conversion count under a dollar sign would be
 *  a number nobody could act on. */
export function formatImpact(v: number, impactMetric: string): string {
  const n = Math.round(Math.abs(v)).toLocaleString("en-US");
  return impactFormatFor(impactMetric) === "money" ? `$${n}` : n;
}

/** The evidence columns every breakdown gets: what was spent, what came back. */
function columnsFor(hasCost: boolean, singular: string): EvidenceColumn[] {
  const first: EvidenceColumn = { key: "label", label: singular, format: "text" };
  return hasCost
    ? [
        first,
        { key: "clicks", label: "Clicks", format: "number" },
        { key: "cost", label: "Cost", format: "money" },
        { key: "conversions", label: "Conv.", format: "number" },
        { key: "roas", label: "ROAS", format: "ratio" },
        { key: "adProfit", label: "Ad Profit", format: "money" },
      ]
    : [
        first,
        { key: "clicks", label: "Sessions", format: "number" },
        { key: "conversions", label: "Conv.", format: "number" },
        { key: "convRate", label: "Conv. rate", format: "percent" },
        { key: "revenue", label: "Revenue", format: "money" },
      ];
}

function valuesOf(t: MetricTotals, _marginPct: number): Record<string, number> {
  return {
    clicks: t.clicks,
    cost: t.cost,
    conversions: t.conversions,
    revenue: t.revenue,
    roas: t.cost > 0 ? t.revenue / t.cost : 0,
    convRate: t.clicks > 0 ? t.conversions / t.clicks : 0,
    // Ad Profit = revenue − spend, matching the metric named everywhere else in
    // DataRocks (not a margin-adjusted "net profit"). marginPct is unused here now.
    adProfit: t.revenue - t.cost,
  };
}

/**
 * What the shown rows add up to, in a sentence.
 *
 * Repeating the recommendation's own wording here taught nobody anything. The
 * point of the table is the comparison, so the insight states it: what this row
 * costs against what the ones beside it return, in their own numbers.
 */
function insightFrom(
  shown: { name: string; totals: MetricTotals }[],
  entity: string,
  hasCost: boolean,
  impactMetric: string,
): string {
  const target = shown.find((r) => r.name === entity);
  const others = shown.filter((r) => r.name !== entity);
  if (!target || others.length === 0)
    return "Not enough rows beside this one to compare it against.";

  if (hasCost) {
    const otherCost = others.reduce((a, r) => a + r.totals.cost, 0);
    const otherRev = others.reduce((a, r) => a + r.totals.revenue, 0);
    const rate = otherCost > 0 ? otherRev / otherCost : 0;
    const wouldReturn = target.totals.cost * rate;
    const gap = wouldReturn - target.totals.revenue;
    return `The other ${others.length} rows shown return ${rate.toFixed(2)}x on their spend. At that rate the ${formatImpact(target.totals.cost, "revenue")} on "${target.name}" would be worth ${formatImpact(wouldReturn, "revenue")}; it returned ${formatImpact(target.totals.revenue, "revenue")}, a difference of ${formatImpact(gap, "revenue")}.`;
  }

  const otherClicks = others.reduce((a, r) => a + r.totals.clicks, 0);
  const otherConv = others.reduce((a, r) => a + r.totals.conversions, 0);
  const rate = otherClicks > 0 ? otherConv / otherClicks : 0;
  const wouldConvert = target.totals.clicks * rate;
  return `The other ${others.length} rows shown convert at ${(rate * 100).toFixed(1)}%. At that rate "${target.name}" would have produced ${formatImpact(wouldConvert, impactMetric)} conversions from its ${target.totals.clicks.toLocaleString("en-US")} sessions; it produced ${formatImpact(target.totals.conversions, impactMetric)}.`;
}

/**
 * The rows behind one finding: the entity itself, plus the rest of the
 * breakdown for context, so a number can be read against its neighbours rather
 * than in isolation.
 */
function evidenceFor(args: {
  rows: EntityRow[];
  entity: string;
  singular: string;
  hasCost: boolean;
  marginPct: number;
  impactMetric: string;
  filter?: string;
}): Evidence {
  const { rows, entity, singular, hasCost, marginPct, impactMetric, filter } = args;
  const ordered = [...rows].sort((a, b) =>
    hasCost ? b.totals.cost - a.totals.cost : b.totals.clicks - a.totals.clicks,
  );
  // A preview, capped at PREVIEW_ROWS: the row in question is always present,
  // whatever its size, then the largest others fill in around it. A breakdown
  // with thousands of rows (search terms) is not dumped into the card — the
  // full set is one click away in the dashboard.
  const flagged = ordered.find((r) => r.name === entity);
  const context = ordered
    .filter((r) => r.name !== entity)
    .slice(0, PREVIEW_ROWS - (flagged ? 1 : 0));
  const shown = flagged ? [flagged, ...context] : context;

  const total: Record<string, number> = {};
  const totals = shown.reduce<MetricTotals>(
    (a, r) => ({
      clicks: a.clicks + r.totals.clicks,
      impressions: a.impressions + r.totals.impressions,
      cost: a.cost + r.totals.cost,
      conversions: a.conversions + r.totals.conversions,
      revenue: a.revenue + r.totals.revenue,
      extra: {},
    }),
    { clicks: 0, impressions: 0, cost: 0, conversions: 0, revenue: 0, extra: {} },
  );
  Object.assign(total, valuesOf(totals, marginPct));

  return {
    columns: columnsFor(hasCost, singular),
    rows: shown.map((r) => ({
      label: r.name,
      values: valuesOf(r.totals, marginPct),
      flagged: r.name === entity,
    })),
    rowCount: rows.length,
    total,
    insight: insightFrom(shown, entity, hasCost, impactMetric),
    filter,
  };
}

/**
 * The evidence table for a CONSOLIDATED recommendation: every flagged entity at
 * once (Time of Day's underperforming hours), not one and its context. All the
 * flagged rows are shown first and marked, up to the preview cap.
 */
function evidenceForMany(args: {
  rows: EntityRow[];
  entities: string[];
  singular: string;
  hasCost: boolean;
  marginPct: number;
  filter?: string;
}): Evidence {
  const { rows, entities, singular, hasCost, marginPct, filter } = args;
  const flaggedSet = new Set(entities);
  const ordered = [...rows].sort((a, b) =>
    hasCost ? b.totals.cost - a.totals.cost : b.totals.clicks - a.totals.clicks,
  );
  const flagged = ordered.filter((r) => flaggedSet.has(r.name));
  const context = ordered
    .filter((r) => !flaggedSet.has(r.name))
    .slice(0, Math.max(0, PREVIEW_ROWS - flagged.length));
  const shown = [...flagged, ...context].slice(0, PREVIEW_ROWS);

  const total: Record<string, number> = {};
  const totals = shown.reduce<MetricTotals>(
    (a, r) => ({
      clicks: a.clicks + r.totals.clicks,
      impressions: a.impressions + r.totals.impressions,
      cost: a.cost + r.totals.cost,
      conversions: a.conversions + r.totals.conversions,
      revenue: a.revenue + r.totals.revenue,
      extra: {},
    }),
    { clicks: 0, impressions: 0, cost: 0, conversions: 0, revenue: 0, extra: {} },
  );
  Object.assign(total, valuesOf(totals, marginPct));

  return {
    columns: columnsFor(hasCost, singular),
    rows: shown.map((r) => ({
      label: r.name,
      values: valuesOf(r.totals, marginPct),
      flagged: flaggedSet.has(r.name),
    })),
    rowCount: rows.length,
    total,
    insight: `${flagged.length} ${singular.toLowerCase()}${flagged.length === 1 ? "" : "s"} returning below the account's own rate.`,
    filter,
  };
}

/** What to do about it, in the imperative — the mockup's "Action" line. */
// The deterministic next-step shown until the model rewords it (and the hint the
// model rewrites from — see optimizerPhrasing). Diagnostic-first, matching the
// analyst guidance the model follows: investigate WHY before cutting, and reserve
// "pause / exclude" for when the finding genuinely warrants stopping spend, rather
// than defaulting every finding to a blunt exclude.
function actionFor(o: Opportunity, singular: string): string {
  const noun = singular.toLowerCase();
  const name = `${noun} "${o.entity}"`;
  switch (o.kind) {
    case "wasted_spend":
      return `Review the ${name}'s search terms, targeting and landing page to find why the spend isn't converting — pause it only if those check out and it still returns nothing`;
    case "underperformer":
      return `Compare the ${name}'s targeting, creative and bids against your stronger ${noun}s, tighten what's weakest, and shift budget toward what already returns`;
    case "scale":
      return `Raise the budget on the ${name} while it holds this rate, and watch that the return stays`;
    case "weak_conversion":
      return `Review the landing experience and conversion path for the ${name} — page speed, offer and form — before changing spend`;
  }
}

export interface EntitySummary {
  name: string;
  /** Whether the entity meets the source's AI Optimization Threshold. False =
   *  it has activity but not enough to analyse yet ("Not enough data"). */
  qualified: boolean;
  /** 0–100, the same rule the categories are scored by. 0 when not qualified. */
  score: number;
  /** How many findings are about this one. 0 when not qualified. */
  count: number;
  impact: number;
  priority: Priority;
  /** Its share of what the account spent (or, with no spend, of its traffic) —
   *  what makes a low score worth reading. */
  share: number;
}

/**
 * One line per primary entity: how healthy it looks, how much is at stake, and
 * how many findings are about it.
 *
 * This is the list you land on — a campaign at 20% with $108K behind it is the
 * one to open, and that judgement can't be made from a single account-wide
 * number. Each entity is scored against what IT could be returning, so a small
 * campaign performing badly doesn't hide behind a large one doing well.
 */
export function summariseEntities(args: {
  rows: EntityRow[];
  focus: GoalMetricDef;
  marginPct: number;
  hasCost: boolean;
  /** The Data Source's AI Optimization Threshold rules — entities that fail any
   *  are left off the list entirely, since they aren't analysed. */
  thresholds?: ThresholdRule[];
}): { entities: EntitySummary[]; impactMetric: string; impactFormat: GoalFormat } {
  const { focus, marginPct, hasCost } = args;
  // Every entity with ANY activity in the window is listed; the ones that don't
  // meet the threshold show a "Not enough data" state rather than vanishing.
  // Entities with no activity at all are simply not here.
  const active = args.rows.filter((r) => rowHasActivity(r.totals));
  const qualifying = qualifyRows(active, args.thresholds ?? []);
  const qualifiedNames = new Set(qualifying.map((r) => r.name));
  const summary = findOpportunities({ rows: qualifying, focus, marginPct, hasCost });
  // Share is over ALL active entities, so an unqualified one still reads as big
  // or small relative to the account.
  const total = hasCost ? sum(active, (t) => t.cost) : sum(active, (t) => t.clicks);
  const accountRevenue = sum(qualifying, (t) => t.revenue);

  const entities = active
    .map((r): EntitySummary => {
      const share = total > 0 ? (hasCost ? r.totals.cost : r.totals.clicks) / total : 0;
      if (!qualifiedNames.has(r.name)) {
        return {
          name: r.name,
          qualified: false,
          score: 0,
          count: 0,
          impact: 0,
          priority: "low",
          share,
        };
      }
      const mine = summary.opportunities.filter((o) => o.entity === r.name);
      const impact = mine.reduce((a, o) => a + o.impact, 0);
      return {
        name: r.name,
        qualified: true,
        // Against what this entity could be returning, not the account's total
        // — otherwise every small row scores 100 whatever it does.
        score: categoryScore(impact, r.totals.revenue + impact),
        count: mine.length,
        impact,
        priority: priorityFor(impact, accountRevenue || total),
        share,
      };
    })
    // Qualified first (most at stake, then worst score); then the "not enough
    // data" ones, biggest spenders first.
    .sort((a, b) =>
      a.qualified !== b.qualified
        ? a.qualified
          ? -1
          : 1
        : a.qualified
          ? b.impact - a.impact || a.score - b.score
          : b.share - a.share,
    );

  return {
    entities,
    impactMetric: summary.impactMetric,
    impactFormat: impactFormatFor(summary.impactMetric),
  };
}

/** Any activity at all in the window — the bar for appearing in the entity list
 *  (a row with none is "no data", not "not enough data"). */
function rowHasActivity(t: MetricTotals): boolean {
  return t.cost > 0 || t.clicks > 0 || t.impressions > 0 || t.conversions > 0 || t.revenue > 0;
}

/** The threshold rules in words for the footer, e.g. "Clicks ≥ 200 AND Ad
 *  Profit < $0" — built from the current rules so it's never hardcoded. */
export function describeThresholds(rules: ThresholdRule[]): string {
  const sym: Record<ThresholdOp, string> = {
    gte: "≥",
    lte: "≤",
    gt: ">",
    lt: "<",
    eq: "=",
    ne: "≠",
  };
  return rules
    .map((r) => {
      const m = THRESHOLD_METRICS[r.metric];
      const label = m?.label ?? r.metric;
      const v =
        m?.unit === "money"
          ? `$${r.value}`
          : m?.unit === "percent"
            ? `${r.value}%`
            : String(r.value);
      return `${label} ${sym[r.op]} ${v}`;
    })
    .join(" AND ");
}

/**
 * Analyse every breakdown and rank what comes back.
 *
 * Each category is judged on its own rows — a device is compared to other
 * devices, a region to other regions — because that is the only comparison its
 * numbers support. Rankings across categories are by what is at stake.
 */
export function analyseAccount(args: {
  categories: CategoryInput[];
  focus: GoalMetricDef;
  marginPct: number;
  hasCost: boolean;
  /** Accepted for call-site compatibility but no longer used to gate analysis.
   *  The AI Optimization Threshold governs the CAMPAIGN LIST only (summariseEntities
   *  marks below-threshold campaigns "Not enough data"); the recommendations and
   *  the health radar analyse EVERY breakdown table in full, because the client
   *  wants ad groups, ads, search terms, devices and time all analysed — not just
   *  the coarse tables where enough rows happen to clear a per-row click bar.
   *  The threshold instead decides which rows get FLAGGED and counted as savings
   *  (via `flaggable` below): a table is analysed in full, its norm and evidence
   *  context come from every row, but only rows meeting the threshold are marked
   *  as opportunities. Rows that don't meet it show as context, unflagged. */
  thresholds?: ThresholdRule[];
}): AccountAnalysis {
  const { focus, marginPct, hasCost, thresholds = [] } = args;
  const categories = args.categories;
  // Only rows meeting every threshold rule may be flagged. No rules → every row
  // is flaggable (unchanged behaviour).
  const flaggable = thresholds.length
    ? (t: MetricTotals) => rowMeetsThresholds(t, thresholds)
    : undefined;

  // The account's own scale, from the biggest breakdown available — every
  // breakdown covers the same account, so any of them totals to the same thing.
  const scaleOf = (rows: EntityRow[]) =>
    hasCost ? sum(rows, (t) => t.cost) : sum(rows, (t) => t.clicks);
  const accountScale = categories.reduce((a, c) => Math.max(a, scaleOf(c.rows)), 0);
  const accountRevenue = categories.reduce(
    (a, c) =>
      Math.max(
        a,
        sum(c.rows, (t) => t.revenue),
      ),
    0,
  );

  const recommendations: Recommendation[] = [];
  const summaries: CategorySummary[] = [];
  let impactMetric = "revenue";
  let impactMetricLabel = "revenue";
  // Account-level headline impact (the "+$… / month" figure). Every breakdown
  // RE-SLICES the same account spend, so summing recommendations across
  // breakdowns counts the same money many times (a wasteful campaign reappears
  // under its network, its ad groups and its ads — three cards, one fact). The
  // honest account figure is the single breakdown that surfaces the most
  // RECOVERABLE waste (below-rate spend), NOT the sum — and it excludes the
  // speculative "grow the budget" (scale) projections, which assume a flat
  // marginal ROAS the extra budget almost never actually returns. Individual
  // recommendations keep their own per-slice impact for context; only the
  // headline is de-duplicated here.
  let headlineImpact = 0;

  for (const cat of categories) {
    const summary = findOpportunities({
      rows: cat.rows,
      focus,
      marginPct,
      hasCost,
      benchmark: cat.benchmarkRows,
      flaggable,
      // A consolidated table (Hours, Search Terms) shows ONE card listing every
      // qualifying row, so it must be able to flag them all — not just the top 12.
      limit: CONSOLIDATED_CATEGORIES.has(cat.key) ? 1000 : undefined,
    });
    impactMetric = summary.impactMetric;
    impactMetricLabel = summary.impactMetricLabel;

    const catRecs = summary.opportunities.map((o): Recommendation => {
      const priority = priorityFor(o.impact, accountRevenue || accountScale);
      return {
        id: `${cat.key}:${o.id}`,
        category: cat.key,
        categoryLabel: cat.label,
        priority,
        kind: o.kind,
        entity: o.entity,
        title: o.title,
        detail: o.detail,
        impact: o.impact,
        currentState: o.detail,
        expectedResult: `Reaching the account's own rate would recover the ${impactMetricLabel.toLowerCase()} lost to this gap (monthly potential shown above).`,
        action: actionFor(o, cat.singular),
        evidence: evidenceFor({
          rows: cat.rows,
          entity: o.entity,
          singular: cat.singular,
          hasCost,
          marginPct,
          impactMetric,
          filter:
            o.kind === "underperformer" || o.kind === "wasted_spend"
              ? "Rows returning below the account's own rate"
              : undefined,
        }),
        weight: o.weight,
      };
    });

    // Consolidate a Time-of-Day / Search-Terms breakdown into ONE recommendation
    // whose table lists every underperforming entity, with a single combined
    // impact — rather than a near-identical card per hour / per term.
    //
    // Only the "returning below the account's own rate" findings go in the card —
    // wasted spend and underperformers. A row that IS returning (a scale finding:
    // an hour/term with conversions doing better than the account's rate) must NOT
    // be flagged in a "reduce spend" card, so those are dropped for the
    // consolidated tables. Other breakdowns keep every kind, one card each.
    let finalRecs = catRecs;
    if (CONSOLIDATED_CATEGORIES.has(cat.key)) {
      const belowRate = catRecs.filter(
        (r) => r.kind === "wasted_spend" || r.kind === "underperformer",
      );
      if (belowRate.length === 0) {
        finalRecs = [];
      } else {
        const total = belowRate.reduce((a, r) => a + r.impact, 0);
        const entities = belowRate.map((r) => r.entity);
        const count = belowRate.length;
        const plural = `${cat.singular.toLowerCase()}s`;
        const dominant = [...belowRate].sort((a, b) => b.impact - a.impact)[0];
        const detail = `${count} ${plural} returned below the account's own rate this period — together worth ${formatImpact(total, impactMetric)} in ${impactMetricLabel.toLowerCase()}.`;
        finalRecs = [
          {
            id: `${cat.key}:all`,
            category: cat.key,
            categoryLabel: cat.label,
            priority: priorityFor(total, accountRevenue || accountScale),
            kind: dominant.kind,
            entity: dominant.entity,
            entities,
            title: `${count} ${plural} are returning below the account's rate`,
            detail,
            impact: total,
            currentState: detail,
            expectedResult: `Reaching the account's own rate would recover the ${impactMetricLabel.toLowerCase()} these ${plural} leave on the table (monthly potential shown above).`,
            action: `Reduce or reschedule spend on the ${plural} returning below the account's rate.`,
            evidence: evidenceForMany({
              rows: cat.rows,
              entities,
              singular: cat.singular,
              hasCost,
              marginPct,
              filter: "Rows returning below the account's own rate",
            }),
            weight: belowRate.reduce((a, r) => a + r.weight, 0),
          },
        ];
      }
    }

    recommendations.push(...finalRecs);
    const impact = finalRecs.reduce((a, r) => a + r.impact, 0);
    // Whichever kind of work carries more of what is at stake here.
    const saving = finalRecs
      .filter((r) => r.kind === "wasted_spend" || r.kind === "underperformer")
      .reduce((a, r) => a + r.impact, 0);
    // Largest single breakdown's recoverable waste — never the sum across
    // breakdowns (see headlineImpact above).
    if (saving > headlineImpact) headlineImpact = saving;
    summaries.push({
      key: cat.key,
      label: cat.label,
      group: saving >= impact - saving ? "cost_saving" : "growth",
      count: finalRecs.length,
      priority:
        finalRecs.length === 0
          ? "low"
          : finalRecs
              .map((r) => r.priority)
              .sort((a, b) => PRIORITY_ORDER[a] - PRIORITY_ORDER[b])[0],
      impact,
      // Against what this breakdown could return, not against the impact alone
      // — otherwise a category with one big finding and nothing else looks the
      // same as one where everything is broken. Then: a breakdown that has
      // findings can't read as fully Healthy (≥80). If records here carry real
      // Potential Impact the status must show it — a High finding drops it to
      // Fair/Critical, a Medium to Good, and even a Low takes it out of the
      // Excellent band. A clean breakdown keeps its high score.
      score: (() => {
        const base = categoryScore(impact, sum(cat.rows, (t) => t.revenue) + impact);
        if (finalRecs.some((r) => r.priority === "high")) return Math.min(base, 55);
        if (finalRecs.some((r) => r.priority === "medium")) return Math.min(base, 70);
        if (finalRecs.length > 0) return Math.min(base, 79);
        return base;
      })(),
      quietReason: summary.quietReason,
    });
  }

  // Ranked purely by Potential Impact — the biggest opportunity first, whatever
  // table it came from — with the weight only breaking ties.
  recommendations.sort((a, b) => b.impact - a.impact || b.weight - a.weight);
  const scored = summaries.filter((s) => s.quietReason !== "no_rows");

  return {
    recommendations,
    categories: summaries,
    overallScore: scored.length
      ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length)
      : 100,
    totalImpact: headlineImpact,
    impactMetric,
    impactMetricLabel,
    impactFormat: impactFormatFor(impactMetric),
    counts: {
      high: recommendations.filter((r) => r.priority === "high").length,
      medium: recommendations.filter((r) => r.priority === "medium").length,
      low: recommendations.filter((r) => r.priority === "low").length,
    },
  };
}
