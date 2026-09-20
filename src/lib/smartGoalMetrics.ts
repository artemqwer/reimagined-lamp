// ─────────────────────────────────────────────────────────────────────────────
// Smart Goals — what a goal can be set ON, per data source.
//
// A goal is set on one of the source's own metrics. Which metrics those are is
// the source's business, not this feature's: Google Ads has cost and ROAS, GA4
// has sessions and users, and an admin-added source has whatever fields they
// registered. So the catalogue is derived from the connector registry — the
// same list the tables and the chart read from — rather than written out here.
//
// What IS written out here is the canonical vocabulary's semantics: whether a
// metric accumulates over a period, and which direction counts as success.
// That's a property of "cost" or "CTR" as concepts, not of any one source.
// ─────────────────────────────────────────────────────────────────────────────

import { applyMetricColConfig, type MetricConfigOverride, type TableMetricCol } from "./connectors";

export type GoalFormat = "money" | "ratio" | "number" | "percent";

export interface GoalMetricDef {
  key: string;
  label: string;
  format: GoalFormat;
  /** Cumulative metrics add up across the period; average ones don't. Only the
   *  cumulative kind gets a pace line, and only it starts its chart at zero. */
  accumulation: "cumulative" | "average";
  /** Which direction counts as success. Spend and cost-per-X are the ones where
   *  lower is better. */
  direction: "higher" | "lower";
  /** Set when the system can compute the target from the source's other goals
   *  instead of the user typing it — the "Auto" goals. */
  derivedFrom?: string[];
}

/**
 * The canonical metric vocabulary's semantics.
 *
 * Keyed by the metric-column keys the whole app already uses (see
 * TABLE_METRIC_COLS). A source exposes some subset of these; anything outside
 * it is an admin-registered metric and is treated by its declared format.
 */
const CANONICAL: Record<string, Omit<GoalMetricDef, "key" | "label">> = {
  revenue: { format: "money", accumulation: "cumulative", direction: "higher" },
  cost: { format: "money", accumulation: "cumulative", direction: "lower" },
  profit: { format: "money", accumulation: "cumulative", direction: "higher" },
  conv: { format: "number", accumulation: "cumulative", direction: "higher" },
  clicks: { format: "number", accumulation: "cumulative", direction: "higher" },
  impr: { format: "number", accumulation: "cumulative", direction: "higher" },
  // Rates and ratios are averages over the period — there is no accumulating to
  // a CTR, so none of these carries a pace line.
  roasVal: { format: "ratio", accumulation: "average", direction: "higher" },
  ctr: { format: "percent", accumulation: "average", direction: "higher" },
  convRate: { format: "percent", accumulation: "average", direction: "higher" },
  cpc: { format: "money", accumulation: "average", direction: "lower" },
  cpa: { format: "money", accumulation: "average", direction: "lower" },
};

/** Goals whose target the system can work out from the others, and what from.
 *  Only offered when the source actually exposes every input. */
const DERIVED: Record<string, string[]> = {
  roasVal: ["revenue", "cost"],
  profit: ["revenue", "cost"],
  net_profit: ["revenue", "cost"],
};

/** Net profit isn't a column any source reports — it's revenue at the account's
 *  margin, less what was spent to get it. Offered wherever both inputs exist,
 *  which is what the spec's "Net Profit" goal means. */
export const NET_PROFIT: GoalMetricDef = {
  key: "net_profit",
  label: "Net Profit",
  format: "money",
  accumulation: "cumulative",
  direction: "higher",
  derivedFrom: DERIVED.net_profit,
};

/**
 * The goals this source can have, in the admin's configured order.
 *
 * Anything the source shows as a metric column can carry a goal — including the
 * metrics an admin registered for it, which is what makes this work for a source
 * that didn't exist when the feature was written.
 */
export function goalMetricsFor(connectorId: string, cfg?: MetricConfigOverride[]): GoalMetricDef[] {
  const cols: TableMetricCol[] = applyMetricColConfig(cfg, connectorId);
  const present = new Set(cols.map((c) => c.key));

  const defs = cols.map((col) => {
    const canonical = CANONICAL[col.key];
    const base: Omit<GoalMetricDef, "key" | "label"> = canonical ?? {
      // An admin-registered metric: its own declared format decides how it
      // behaves. A percentage or a ratio is an average; everything else adds up.
      format: (col.format as GoalFormat) ?? "number",
      accumulation: col.format === "percent" || col.format === "ratio" ? "average" : "cumulative",
      direction: "higher",
    };
    const inputs = DERIVED[col.key];
    return {
      key: col.key,
      label: col.label,
      ...base,
      // Derivable only when the source really has everything it's derived from.
      ...(inputs && inputs.every((i) => present.has(i)) ? { derivedFrom: inputs } : {}),
    };
  });

  // Net profit rides along on any source that reports both revenue and spend.
  if (NET_PROFIT.derivedFrom!.every((i) => present.has(i))) defs.push(NET_PROFIT);
  return defs;
}

export function goalMetricDefIn(metrics: GoalMetricDef[], key: string): GoalMetricDef | undefined {
  return metrics.find((m) => m.key === key);
}

/** Whether a source can carry goals at all — one with no metric columns can't. */
export function sourceSupportsGoals(connectorId: string): boolean {
  return goalMetricsFor(connectorId).length > 0;
}

// ─── Turning a period's totals into each metric's value ──────────────────────

/** The account's raw totals for a period, in the canonical row vocabulary the
 *  data API speaks. Everything else is computed from these. */
export interface MetricTotals {
  clicks: number;
  impressions: number;
  cost: number;
  conversions: number;
  revenue: number;
  /** Admin-registered metrics, summed (or averaged) by the fetch layer. */
  extra: Record<string, number>;
}

export const EMPTY_TOTALS: MetricTotals = {
  clicks: 0,
  impressions: 0,
  cost: 0,
  conversions: 0,
  revenue: 0,
  extra: {},
};

const div = (a: number, b: number) => (b > 0 ? a / b : 0);

/**
 * What a metric currently stands at, from the period's totals.
 *
 * The same formulas the dashboard's tables use, so a goal card and a table row
 * can't disagree about what CTR or ROAS is for the same period.
 */
export function metricValue(key: string, totals: MetricTotals, marginPct: number): number {
  switch (key) {
    case "revenue":
      return totals.revenue;
    case "cost":
      return totals.cost;
    case "conv":
      return totals.conversions;
    case "clicks":
      return totals.clicks;
    case "impr":
      return totals.impressions;
    case "profit":
      return totals.revenue - totals.cost;
    case "net_profit":
      return totals.revenue * (marginPct / 100) - totals.cost;
    case "roasVal":
      return div(totals.revenue, totals.cost);
    case "ctr":
      return div(totals.clicks, totals.impressions) * 100;
    case "convRate":
      return div(totals.conversions, totals.clicks) * 100;
    case "cpc":
      return div(totals.cost, totals.clicks);
    case "cpa":
      return div(totals.cost, totals.conversions);
    default:
      // An admin-registered metric has no formula — it's read straight from the
      // response, which the fetch layer has already folded into `extra`.
      return totals.extra[key] ?? 0;
  }
}

/** A derived goal's TARGET, from the targets of what it's derived from. Returns
 *  null when an input is missing or would divide by zero, so the UI can show
 *  "Auto" as unavailable rather than a fabricated number. */
export function derivedTarget(
  key: string,
  inputs: { revenue: number | null; cost: number | null; marginPct: number },
): number | null {
  const { revenue, cost, marginPct } = inputs;
  if (revenue === null || cost === null) return null;
  switch (key) {
    case "roasVal":
      return cost > 0 ? revenue / cost : null;
    case "profit":
      return revenue - cost;
    case "net_profit":
      return revenue * (marginPct / 100) - cost;
    default:
      return null;
  }
}
