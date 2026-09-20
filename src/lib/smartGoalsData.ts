// ─────────────────────────────────────────────────────────────────────────────
// Smart Goals — turning the account's daily rows into what the page draws.
//
// The dashboard's data layer speaks in dated rows of spend/revenue/conversions.
// Everything Smart Goals shows is a view of those: what each goal is at right
// now, the series behind the progress chart, and where the period is heading.
// Kept separate from smartGoals.ts (which knows the rules) so the rules stay
// testable without a data shape, and this stays testable without a screen.
// ─────────────────────────────────────────────────────────────────────────────

import { periodBucketCount, periodKind, periodRange, type PeriodProgress } from "./smartGoals";
import { metricValue, type GoalMetricDef, type MetricTotals } from "./smartGoalMetrics";

/** One dated row of account performance — the shape /api/windsor returns for
 *  `group_by=date`, narrowed to what goals are computed from. */
export interface DailyRow {
  date: string | null;
  clicks?: number | null;
  impressions?: number | null;
  spend?: number | null;
  conversion_value?: number | null;
  conversions?: number | null;
  /** Admin-registered metrics, as /api/windsor returns them. */
  extra?: Record<string, number> | null;
}

/** One bucket of the period: a day in a month view, a month in a year view. */
export interface Bucket {
  /** "2026-01-09" for a day, "2026-01" for a month. */
  key: string;
  /** Position in the period, 0-based — the chart's x index. */
  index: number;
  /** Everything the source reported for this bucket, in the canonical row
   *  vocabulary. Every metric is computed from these rather than stored per
   *  metric, so a source with metrics nobody anticipated still works. */
  totals: MetricTotals;
  /** False for buckets that haven't happened yet: they hold no data and must
   *  not be drawn as a zero, which would read as a collapse to nothing. */
  elapsed: boolean;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Every bucket of the period, in order, whether or not there's data for it —
 *  the chart's x-axis spans the whole period even before it has happened. */
export function periodBuckets(period: string): string[] {
  const kind = periodKind(period);
  const { start } = periodRange(period);
  const count = periodBucketCount(period);
  return Array.from({ length: count }, (_, i) => {
    if (kind === "year") return `${start.getUTCFullYear()}-${String(i + 1).padStart(2, "0")}`;
    const d = new Date(start.getTime() + i * 86_400_000);
    return dayKey(d);
  });
}

/** Fold dated rows into the period's buckets. Rows outside the period are
 *  dropped rather than folded into the nearest bucket — a stale fetch for
 *  another month would otherwise quietly inflate this one. */
export function bucketize(period: string, rows: DailyRow[], progress: PeriodProgress): Bucket[] {
  const keys = periodBuckets(period);
  const kind = periodKind(period);
  const byKey = new Map<string, Bucket>(
    keys.map((k, index) => [
      k,
      {
        key: k,
        index,
        totals: { clicks: 0, impressions: 0, cost: 0, conversions: 0, revenue: 0, extra: {} },
        elapsed: index < progress.elapsedBuckets,
      },
    ]),
  );

  for (const row of rows) {
    if (!row.date) continue;
    const iso = String(row.date).slice(0, 10);
    const key = kind === "year" ? iso.slice(0, 7) : iso;
    const bucket = byKey.get(key);
    if (!bucket) continue;
    const t = bucket.totals;
    t.revenue += Number(row.conversion_value) || 0;
    t.cost += Number(row.spend) || 0;
    t.conversions += Number(row.conversions) || 0;
    t.clicks += Number(row.clicks) || 0;
    t.impressions += Number(row.impressions) || 0;
    for (const [k, v] of Object.entries(row.extra ?? {}))
      t.extra[k] = (t.extra[k] ?? 0) + (Number(v) || 0);
  }
  return keys.map((k) => byKey.get(k)!);
}

/** Period-to-date totals — the numbers every goal is computed from. */
export function totalsOf(buckets: Bucket[]): MetricTotals {
  const out: MetricTotals = {
    clicks: 0,
    impressions: 0,
    cost: 0,
    conversions: 0,
    revenue: 0,
    extra: {},
  };
  for (const b of buckets) {
    out.clicks += b.totals.clicks;
    out.impressions += b.totals.impressions;
    out.cost += b.totals.cost;
    out.conversions += b.totals.conversions;
    out.revenue += b.totals.revenue;
    for (const [k, v] of Object.entries(b.totals.extra)) out.extra[k] = (out.extra[k] ?? 0) + v;
  }
  return out;
}

export interface SeriesPoint {
  key: string;
  index: number;
  /** The plotted value: running total for a cumulative metric, the bucket's own
   *  value for an average one. Null past the last elapsed bucket, so the line
   *  stops rather than dropping to zero. */
  value: number | null;
  /** Where the goal should be by this bucket. Null for average metrics, which
   *  have no pace to keep. */
  pace: number | null;
  elapsed: boolean;
}

/**
 * The progress chart's series.
 *
 * A cumulative metric accumulates from zero and carries a pace line — the
 * straight run from 0 to target across the period, which is what "on track"
 * means at any point. An average metric (ROAS) does neither: it starts at the
 * first bucket that has data and is judged against a flat target, because
 * averaging up to a number over a month isn't a thing.
 */
/** Nothing happened in this bucket, so any ratio built from it is 0/0. */
function isEmptyBucket(t: MetricTotals): boolean {
  return (
    t.clicks === 0 &&
    t.impressions === 0 &&
    t.cost === 0 &&
    t.conversions === 0 &&
    t.revenue === 0 &&
    Object.values(t.extra).every((v) => !v)
  );
}

export function goalSeries(
  def: GoalMetricDef,
  buckets: Bucket[],
  target: number | null,
  marginPct: number,
): SeriesPoint[] {
  const cumulative = def.accumulation === "cumulative";
  const total = buckets.length;
  const running: MetricTotals = {
    clicks: 0,
    impressions: 0,
    cost: 0,
    conversions: 0,
    revenue: 0,
    extra: {},
  };

  return buckets.map((b) => {
    running.clicks += b.totals.clicks;
    running.impressions += b.totals.impressions;
    running.cost += b.totals.cost;
    running.conversions += b.totals.conversions;
    running.revenue += b.totals.revenue;
    for (const [k, v] of Object.entries(b.totals.extra))
      running.extra[k] = (running.extra[k] ?? 0) + v;

    // A cumulative metric reads the running totals — that IS its progress.
    //
    // An average one reads its own bucket. Running totals gave the
    // period-to-date average, which climbs on the first conversion and then
    // decays as later spend dilutes it: a shape that describes the arithmetic
    // of accumulating, not the account. A ratio is not a thing you accumulate
    // towards, and each day's ROAS is what someone reading a ROAS chart is
    // looking for.
    //
    // A bucket with nothing in it plots null rather than zero. That was the
    // real objection to per-bucket values — a day without spend reading 0
    // would drag the line through the floor — and a gap says "no data here",
    // which is true, where a zero would say the day performed terribly.
    const value: number | null = !b.elapsed
      ? null
      : cumulative
        ? metricValue(def.key, running, marginPct)
        : isEmptyBucket(b.totals)
          ? null
          : metricValue(def.key, b.totals, marginPct);

    const pace = target === null ? null : cumulative ? (target * (b.index + 1)) / total : target;

    return { key: b.key, index: b.index, value, pace, elapsed: b.elapsed };
  });
}

// ─── Forecast ────────────────────────────────────────────────────────────────

export interface Forecast {
  metric: string;
  /** Where the period is expected to end up. */
  projected: number;
  /** How much of the projection is already banked rather than extrapolated. */
  confidencePct: number;
  /** Buckets of real data the projection is built on. */
  basedOnBuckets: number;
  totalBuckets: number;
}

/**
 * A straight-line projection: what the period ends at if the rest of it
 * performs like the part that has already happened.
 *
 * Deliberately simple, and labelled as such in the UI — the spec is explicit
 * that this is interpretive, not a promise, and that its confidence has to be
 * visible so nobody reads it as one. Confidence is simply how much of the
 * period is real data, which is the honest thing it measures: a projection made
 * on day 2 is mostly extrapolation, one made on day 28 is mostly fact.
 *
 * Average metrics project to their current average rather than being scaled —
 * multiplying a ROAS by the remaining days would be meaningless.
 */
export function forecastFor(
  def: GoalMetricDef,
  buckets: Bucket[],
  marginPct: number,
  progress: PeriodProgress,
): Forecast | null {
  const elapsed = buckets.filter((b) => b.elapsed);
  // One bucket is a single data point; a straight line through it says more
  // about luck than about the month.
  if (elapsed.length < 2) return null;
  // And a period with no activity at all has nothing to extrapolate. Projecting
  // zero "with 26% confidence" reads as a finding rather than as an absence.
  // "Activity" is any signal the source reports, not only cost/revenue/
  // conversions — those are Google-Ads terms, and checking only them left GA4
  // and Search Console (whose activity is sessions/clicks/impressions) reading
  // "not enough data yet" while the cards above showed real numbers.
  if (elapsed.every((b) => isEmptyBucket(b.totals))) return null;

  const totals = totalsOf(elapsed);
  const scale = progress.totalBuckets / elapsed.length;

  // A cumulative metric is projected by scaling the raw inputs and recomputing
  // — scaling the derived VALUE would be wrong for anything that isn't a plain
  // sum. An average is left as it stands: multiplying a ROAS by the days
  // remaining means nothing.
  const projected =
    def.accumulation === "cumulative"
      ? metricValue(
          def.key,
          {
            clicks: totals.clicks * scale,
            impressions: totals.impressions * scale,
            cost: totals.cost * scale,
            conversions: totals.conversions * scale,
            revenue: totals.revenue * scale,
            extra: Object.fromEntries(Object.entries(totals.extra).map(([k, v]) => [k, v * scale])),
          },
          marginPct,
        )
      : metricValue(def.key, totals, marginPct);

  return {
    metric: def.key,
    projected,
    confidencePct: Math.round((elapsed.length / progress.totalBuckets) * 100),
    basedOnBuckets: elapsed.length,
    totalBuckets: progress.totalBuckets,
  };
}

/** The confidence bands the methodology panel explains. Early in a period a
 *  projection is mostly extrapolation; by the end it is mostly fact. */
export function confidenceBand(confidencePct: number): "low" | "medium" | "high" {
  if (confidencePct >= 70) return "high";
  if (confidencePct >= 35) return "medium";
  return "low";
}
