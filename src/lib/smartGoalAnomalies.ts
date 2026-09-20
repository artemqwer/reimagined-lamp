// ─────────────────────────────────────────────────────────────────────────────
// Smart Goals — anomalies detected from the account's own daily numbers.
//
// The timeline exists to explain a swing in a KPI. Some of what explains it is
// recorded by a person (a sale, a site release), some comes from an API — and
// some is visible in the data itself: the day revenue stopped, the day cost
// doubled. Those are found here, so the timeline can point at them.
//
// One event per CHANGE, not per day. A day is flagged only when a KPI moves
// clear of its own recent average; while it STAYS moved, nothing new is added.
// A metric that drops to 0 and stays there for three weeks is one anomaly, not
// twenty-one — a timeline that repeats itself gets ignored, and then it explains
// nothing at all.
// ─────────────────────────────────────────────────────────────────────────────

import type { Bucket } from "./smartGoalsData";
import type { TimelineEvent } from "./smartGoalEvents";

/** How far from the recent average counts as an anomaly — 50% either way. */
const DEVIATION = 0.5;
/** The window whose average is "recent normal": the previous 7–14 active days. */
const WINDOW = 14;
/** Fewer real (active) days than this and there's no normal to compare to. */
const MIN_ACTIVE_DAYS = 5;
/** A baseline needs at least this many prior points before it means anything. */
const MIN_HISTORY = 3;

/** One KPI-card metric, derived from a day's totals. A metric a source can't
 *  compute (ROAS / CPA where there's no spend) returns null and is skipped, so
 *  the analysed set follows whatever the source actually reports. Keys match the
 *  KPI-card slots, so a caller can pass the visible cards to narrow the set. */
interface AnomalyMetric {
  key: string;
  label: string;
  /** Also flag the moment it hits 0, whatever the percentage. */
  critical?: boolean;
  value: (t: Bucket["totals"]) => number | null;
}

const METRICS: AnomalyMetric[] = [
  { key: "cost", label: "Cost", value: (t) => t.cost },
  { key: "revenue", label: "Revenue", critical: true, value: (t) => t.revenue },
  { key: "clicks", label: "Clicks", value: (t) => t.clicks },
  { key: "conversions", label: "Conversions", critical: true, value: (t) => t.conversions },
  {
    key: "convRate",
    label: "Conversion rate",
    value: (t) => (t.clicks > 0 ? (t.conversions / t.clicks) * 100 : null),
  },
  { key: "cpa", label: "CPA", value: (t) => (t.conversions > 0 ? t.cost / t.conversions : null) },
  { key: "roas", label: "ROAS", value: (t) => (t.cost > 0 ? t.revenue / t.cost : null) },
  { key: "profit", label: "Profit", value: (t) => t.revenue - t.cost },
];

function titleFor(m: AnomalyMetric, cur: number, baseline: number, drop: boolean): string {
  if (cur === 0 && m.critical) return `${m.label} dropped to 0`;
  const pct = Math.round((Math.abs(cur - baseline) / Math.abs(baseline)) * 100);
  return `${m.label} ${drop ? "down" : "up"} ${pct}% vs recent average`;
}

/**
 * Days where a KPI moved clear of its own recent average.
 *
 * For each metric, each elapsed day is compared with the average of the
 * previous up-to-14 days: an anomaly when it deviates 50%+ either way, or when a
 * critical metric (revenue, conversions) hits 0. An event is emitted only on the
 * TRANSITION into that state — while the metric stays anomalous the run adds
 * nothing, and the rolling average makes a persistent new level the "normal" it
 * is measured against, so a metric that stays flat produces no further events.
 *
 * `metricKeys`, when given, narrows the analysed metrics to those KPI cards (by
 * slot) — so the timeline follows whatever cards the source shows.
 */
export function detectAnomalies(buckets: Bucket[], metricKeys?: string[]): TimelineEvent[] {
  const days = buckets.filter((b) => b.elapsed);
  const activeDays = days.filter(
    (b) => b.totals.cost > 0 || b.totals.revenue > 0 || b.totals.clicks > 0,
  ).length;
  if (activeDays < MIN_ACTIVE_DAYS) return [];

  let metrics = METRICS;
  if (metricKeys && metricKeys.length) {
    const picked = METRICS.filter((m) => metricKeys.includes(m.key));
    if (picked.length) metrics = picked; // ignore an unrecognised set rather than go silent
  }

  const out: TimelineEvent[] = [];
  for (const m of metrics) {
    const vals = days.map((d) => m.value(d.totals));
    let inAnomaly = false;
    for (let i = 0; i < days.length; i++) {
      const cur = vals[i];
      if (cur === null) continue; // metric undefined this day — no signal either way
      const prev: number[] = [];
      for (let j = i - 1; j >= 0 && prev.length < WINDOW; j--) {
        if (vals[j] !== null) prev.push(vals[j] as number);
      }
      if (prev.length < MIN_HISTORY) {
        inAnomaly = false;
        continue;
      }
      const baseline = prev.reduce((a, b) => a + b, 0) / prev.length;
      const zeroCritical = !!m.critical && cur === 0 && baseline > 0;
      const deviated = baseline !== 0 && Math.abs(cur - baseline) / Math.abs(baseline) >= DEVIATION;
      const anomalous = zeroCritical || deviated;
      // Only the moment it BECOMES anomalous — not every day it stays that way.
      if (anomalous && !inAnomaly) {
        const drop = cur < baseline;
        out.push({
          id: `anomaly-${m.key}-${days[i].key}`,
          category: "ads",
          type: drop ? "metric_drop" : "metric_spike",
          startDate: days[i].key,
          endDate: null,
          title: titleFor(m, cur, baseline, drop),
          source: "anomaly",
        });
      }
      inAnomaly = anomalous;
    }
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
}

/** Labels for the anomaly types, so the timeline can name them like any other
 *  event. The specific metric and direction are in the event's title. */
export const ANOMALY_TYPE_LABELS: Record<string, string> = {
  metric_spike: "KPI spike",
  metric_drop: "KPI drop",
};

/**
 * The dashboard's daily chart rows → detected anomalies.
 *
 * The dashboards keep their day series in their own shape (`_iso`, `total` for
 * revenue, `cost`, `clicks`, `conv`), which is not the bucket vocabulary this
 * detector reads. Converting here rather than at the call site keeps the one
 * translation in the same file as the rule it feeds, and gives it a test.
 */
export function anomaliesFromDailyRows(
  rows: Record<string, unknown>[],
  metricKeys?: string[],
): TimelineEvent[] {
  const buckets: Bucket[] = rows
    .filter((d) => typeof d._iso === "string" && d._iso)
    .map((d, index) => ({
      key: String(d._iso),
      index,
      elapsed: true,
      totals: {
        clicks: Number(d.clicks) || 0,
        impressions: 0,
        cost: Number(d.cost) || 0,
        conversions: Number(d.conv) || 0,
        revenue: Number(d.total) || 0,
        extra: {},
      },
    }));
  return detectAnomalies(buckets, metricKeys);
}
