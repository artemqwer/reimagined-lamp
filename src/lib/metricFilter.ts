// Universal numeric metric filter shared by the Campaign and Performance tables.
// Replaces the old fixed ROAS categories (Good / OK / Poor) with a "pick a metric,
// an operator and a value" filter that works for ANY numeric column.
//
// The metric keys map 1:1 to the numeric fields on both the campaign rows and the
// PerfRow shape (impr, clicks, cpc, ctr, convRate, conv, cpa, revenue, cost,
// profit, roasVal), so the same predicate and server params drive every table.

export type MetricOp = "gt" | "gte" | "lt" | "lte" | "eq" | "between";

export interface MetricFilterState {
  metric: string; // "" = no metric chosen (filter inactive)
  op: MetricOp;
  value: string; // kept as string so the inputs can be empty while typing
  value2: string; // only used when op === "between"
}

export const METRIC_FILTER_NONE: MetricFilterState = {
  metric: "",
  op: "gte",
  value: "",
  value2: "",
};

// key = the numeric row field; label = what the user sees. Values (cost/revenue/
// profit) are compared exactly as shown in the table (in "K" units).
export const METRIC_OPTIONS: { key: string; label: string }[] = [
  { key: "roasVal", label: "ROAS" },
  { key: "cpa", label: "CPA" },
  { key: "cpc", label: "CPC" },
  { key: "ctr", label: "CTR" },
  { key: "convRate", label: "Conversion Rate" },
  { key: "revenue", label: "Revenue" },
  { key: "cost", label: "Cost" },
  { key: "profit", label: "Ad Profit" },
  { key: "clicks", label: "Clicks" },
  { key: "impr", label: "Impressions" },
  { key: "conv", label: "Conversions" },
];

// The canonical metric keys. A source can filter on its admin-registered
// metrics too, which aren't listed here — see readMetric.
export const METRIC_KEYS = METRIC_OPTIONS.map((m) => m.key);

export const OP_OPTIONS: { key: MetricOp; label: string }[] = [
  { key: "gt", label: "Greater than (>)" },
  { key: "gte", label: "Greater or equal (≥)" },
  { key: "lt", label: "Less than (<)" },
  { key: "lte", label: "Less or equal (≤)" },
  { key: "eq", label: "Equal (=)" },
  { key: "between", label: "Between" },
];

// A filter only applies once a metric is chosen and the value(s) are filled in.
export function isMetricFilterActive(f: MetricFilterState | null | undefined): boolean {
  // Any non-empty key counts. It used to be checked against the canonical list,
  // which silently disabled the filter for a source's own admin-registered
  // metrics: the control showed the choice and nothing happened. Whether the
  // key resolves is decided where the value is read (see readMetric) and
  // validated by the API.
  if (!f || !f.metric.trim()) return false;
  if (f.op === "between") return f.value.trim() !== "" && f.value2.trim() !== "";
  return f.value.trim() !== "";
}

// Stable string for React deps / query keys (changes whenever the effective
// filter changes; ignores in-progress empty input).
export function metricFilterKey(f: MetricFilterState): string {
  return isMetricFilterActive(f)
    ? `${f.metric}|${f.op}|${f.value}|${f.op === "between" ? f.value2 : ""}`
    : "";
}

// URL params for the data API (server-side filtering across all pages).
export function metricFilterParams(f: MetricFilterState): string {
  if (!isMetricFilterActive(f)) return "";
  let s = `&metric=${encodeURIComponent(f.metric)}&op=${f.op}&value=${encodeURIComponent(f.value.trim())}`;
  if (f.op === "between") s += `&value2=${encodeURIComponent(f.value2.trim())}`;
  return s;
}

// Pure comparison used both client-side (override rows) and server-side.
/** A row's value for a metric key. Canonical metrics are plain fields; an
 *  admin-registered one has no field of its own and lives in `extra`, so a
 *  filter on it would otherwise always read 0. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readMetric(row: any, key: string): number {
  const direct = row?.[key];
  if (direct !== undefined && direct !== null) return Number(direct) || 0;
  return Number(row?.extra?.[key]) || 0;
}

export function matchMetric(n: number, op: MetricOp, v1: number, v2: number): boolean {
  switch (op) {
    case "gt":
      return n > v1;
    case "gte":
      return n >= v1;
    case "lt":
      return n < v1;
    case "lte":
      return n <= v1;
    case "eq":
      return Math.abs(n - v1) < 0.005; // tolerance = table's 2-decimal display
    case "between": {
      const lo = Math.min(v1, v2),
        hi = Math.max(v1, v2);
      return n >= lo && n <= hi;
    }
    default:
      return true;
  }
}

// Client-side row filter (for cross-filter override rows that skip the API).
export function applyMetricFilter<T>(rows: T[], f: MetricFilterState): T[] {
  if (!isMetricFilterActive(f)) return rows;
  const v1 = parseFloat(f.value);
  const v2 = parseFloat(f.value2);
  if (!Number.isFinite(v1) || (f.op === "between" && !Number.isFinite(v2))) return rows;
  return rows.filter((r) => matchMetric(readMetric(r, f.metric), f.op, v1, v2));
}
