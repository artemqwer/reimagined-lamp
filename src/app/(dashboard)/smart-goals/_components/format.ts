import type { GoalFormat, GoalMetricDef } from "@/lib/smartGoalMetrics";

/** Money / ratio / count, formatted the way the dashboard formats the same
 *  kinds of number, so a goal card and a KPI card read alike. */
export function formatGoalValue(value: number | null | undefined, format: GoalFormat): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (format === "ratio") return `${value.toFixed(2)}x`;
  if (format === "percent") return `${value.toFixed(2)}%`;
  if (format === "number")
    return Math.abs(value) >= 1000
      ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K`
      : String(Math.round(value));
  // Money. Negative profit reads "-$1.2K", not "$-1.2K".
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `${sign}$${abs.toFixed(abs < 100 ? 2 : 0)}`;
}

export function formatMetric(
  value: number | null | undefined,
  def: GoalMetricDef | undefined,
): string {
  return formatGoalValue(value, def?.format ?? "number");
}

/** A signed percentage, for pace ("+31% pace") and deltas. */
export function formatSignedPct(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const rounded = Math.round(pct);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/** "January 2026" / "2026" — how a period reads in a heading. */
export function formatPeriod(period: string): string {
  if (/^\d{4}$/.test(period)) return period;
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Jan 9" — a bucket key on the chart's axis. */
export function formatBucket(key: string): string {
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
      month: "short",
      timeZone: "UTC",
    });
  }
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
