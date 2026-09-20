/**
 * Smart Goals — the data layer that turns dated account rows into what the
 * page draws. The subtle parts are the ones about time: a bucket that hasn't
 * happened is not a zero, a stale row from another month must not be folded
 * in, and an average metric is never scaled up by the days remaining.
 */

import {
  periodBuckets,
  bucketize,
  totalsOf,
  goalSeries,
  forecastFor,
  confidenceBand,
  type DailyRow,
} from "@/lib/smartGoalsData";
import { periodProgress } from "@/lib/smartGoals";
import { goalMetricsFor, metricValue, type GoalMetricDef } from "@/lib/smartGoalMetrics";

const ADS = goalMetricsFor("google_ads");
const defOf = (key: string): GoalMetricDef => ADS.find((m) => m.key === key)!;

const jan = "2026-01";
// Ten days into January: nine complete days of data.
const midJan = periodProgress(jan, new Date("2026-01-10T12:00:00Z"));
const janDone = periodProgress(jan, new Date("2026-02-05T00:00:00Z"));

const day = (d: string, spend: number, revenue: number, orders = 0): DailyRow => ({
  date: d,
  spend,
  conversion_value: revenue,
  conversions: orders,
});

describe("buckets", () => {
  it("spans the whole month, one bucket per day", () => {
    const keys = periodBuckets(jan);
    expect(keys).toHaveLength(31);
    expect(keys[0]).toBe("2026-01-01");
    expect(keys[30]).toBe("2026-01-31");
  });

  it("spans a year in months", () => {
    const keys = periodBuckets("2026");
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe("2026-01");
    expect(keys[11]).toBe("2026-12");
  });

  it("folds rows onto their day and marks what has happened", () => {
    const buckets = bucketize(
      jan,
      [day("2026-01-01", 100, 400), day("2026-01-01", 50, 100)],
      midJan,
    );
    expect(buckets[0].totals).toMatchObject({ cost: 150, revenue: 500 });
    expect(buckets[0].elapsed).toBe(true);
    // Day 20 hasn't happened: empty AND flagged, so the chart can stop the line
    // rather than draw a drop to zero.
    expect(buckets[19].totals.revenue).toBe(0);
    expect(buckets[19].elapsed).toBe(false);
  });

  it("drops rows from outside the period", () => {
    // A stale fetch for another month would otherwise inflate this one.
    const buckets = bucketize(
      jan,
      [day("2025-12-31", 999, 999), day("2026-02-01", 999, 999)],
      midJan,
    );
    expect(totalsOf(buckets)).toMatchObject({ revenue: 0, cost: 0, conversions: 0 });
  });

  it("rolls days up into months for a year period", () => {
    const buckets = bucketize(
      "2026",
      [day("2026-03-04", 10, 40), day("2026-03-29", 10, 60)],
      periodProgress("2026", new Date("2026-06-01T00:00:00Z")),
    );
    expect(buckets[2].key).toBe("2026-03");
    expect(buckets[2].totals).toMatchObject({ cost: 20, revenue: 100 });
  });

  it("ignores a row with no date", () => {
    expect(
      totalsOf(bucketize(jan, [{ date: null, spend: 5, conversion_value: 5 }], midJan)),
    ).toMatchObject({ revenue: 0, cost: 0 });
  });
});

describe("what a goal currently stands at", () => {
  const totals = {
    revenue: 1_000,
    cost: 250,
    conversions: 20,
    clicks: 100,
    impressions: 5_000,
    extra: {},
  };

  it("reads the direct metrics straight off", () => {
    expect(metricValue("revenue", totals, 40)).toBe(1_000);
    expect(metricValue("cost", totals, 40)).toBe(250);
    expect(metricValue("conv", totals, 40)).toBe(20);
  });

  it("computes the derived ones from the same totals", () => {
    expect(metricValue("roasVal", totals, 40)).toBe(4);
    expect(metricValue("profit", totals, 40)).toBe(750);
    expect(metricValue("net_profit", totals, 40)).toBe(1_000 * 0.4 - 250);
  });

  it("reads zero rather than dividing by it before any spend", () => {
    const empty = { revenue: 0, cost: 0, conversions: 0, clicks: 0, impressions: 0, extra: {} };
    expect(metricValue("roasVal", empty, 40)).toBe(0);
    expect(metricValue("cpc", empty, 40)).toBe(0);
  });
});

describe("the progress series", () => {
  const rows = Array.from({ length: 9 }, (_, i) => day(`2026-01-0${i + 1}`, 100, 300, 2));
  const buckets = bucketize(jan, rows, midJan);

  it("accumulates a cumulative metric and stops at today", () => {
    const s = goalSeries(defOf("revenue"), buckets, 31_000, 40);
    expect(s[0].value).toBe(300);
    expect(s[8].value).toBe(2_700); // nine days at 300
    // Nothing is drawn past the last complete day — a zero there would read as
    // revenue collapsing rather than as the month not being over.
    expect(s[9].value).toBeNull();
    expect(s[30].value).toBeNull();
  });

  it("runs the pace line from zero to target across the whole period", () => {
    const s = goalSeries(defOf("revenue"), buckets, 31_000, 40);
    expect(s[0].pace).toBeCloseTo(1_000);
    expect(s[30].pace).toBeCloseTo(31_000);
  });

  it("gives an average metric a flat target and no ramp", () => {
    // ROAS should sit at target from day one; there is no accumulating to it.
    const s = goalSeries(defOf("roasVal"), buckets, 3, 40);
    expect(s[0].pace).toBe(3);
    expect(s[30].pace).toBe(3);
    expect(s[0].value).toBe(3); // 300 revenue on 100 spend
    expect(s[8].value).toBe(3); // still 3 — an average, not a total
  });

  it("plots an average metric bucket by bucket, not period-to-date", () => {
    // Nine days at ROAS 3, then one day at ROAS 1. Period-to-date would soften
    // that day to 2.8 — the arithmetic of accumulating, not what happened. The
    // chart is asked what that day's ROAS was, and it was 1.
    const mixed = [
      ...Array.from({ length: 8 }, (_, i) => day(`2026-01-0${i + 1}`, 100, 300, 2)),
      day("2026-01-09", 100, 100, 1),
    ];
    const s = goalSeries(defOf("roasVal"), bucketize(jan, mixed, midJan), 3, 40);
    expect(s[7].value).toBe(3);
    expect(s[8].value).toBe(1);
  });

  it("leaves a gap for a bucket with nothing in it rather than plotting zero", () => {
    // A day without spend has no ROAS. Zero would read as a day that performed
    // terribly; a gap reads as a day with no data, which is what it is.
    const withHole = [day("2026-01-01", 100, 300, 2), day("2026-01-03", 100, 300, 2)];
    const s = goalSeries(defOf("roasVal"), bucketize(jan, withHole, midJan), 3, 40);
    expect(s[0].value).toBe(3);
    expect(s[1].value).toBeNull();
    expect(s[2].value).toBe(3);
  });

  it("still accumulates the metrics that are meant to accumulate", () => {
    // The change above must not touch revenue: a total IS a running total.
    const s = goalSeries(defOf("revenue"), buckets, 31_000, 40);
    expect(s[8].value).toBe(2_700);
  });

  it("has no pace line at all when the goal has no target", () => {
    expect(goalSeries(defOf("revenue"), buckets, null, 40).every((p) => p.pace === null)).toBe(
      true,
    );
  });
});

describe("the forecast", () => {
  const steady = bucketize(
    jan,
    Array.from({ length: 9 }, (_, i) => day(`2026-01-0${i + 1}`, 100, 300, 2)),
    midJan,
  );

  it("projects the rest of the period at the rate so far", () => {
    // 300/day over nine days, 31 days in the month.
    const f = forecastFor(defOf("revenue"), steady, 40, midJan)!;
    expect(f.projected).toBeCloseTo(300 * 31);
    expect(f.basedOnBuckets).toBe(9);
    expect(f.totalBuckets).toBe(31);
  });

  it("does not scale an average metric by the days remaining", () => {
    // A ROAS of 3 stays 3 — multiplying it by the month would be meaningless.
    expect(forecastFor(defOf("roasVal"), steady, 40, midJan)!.projected).toBeCloseTo(3);
  });

  it("reports confidence as the share of the period that is real data", () => {
    const f = forecastFor(defOf("revenue"), steady, 40, midJan)!;
    expect(f.confidencePct).toBe(Math.round((9 / 31) * 100));
  });

  it("refuses to project from a single day", () => {
    const oneDay = bucketize(
      jan,
      [day("2026-01-01", 100, 300)],
      periodProgress(jan, new Date("2026-01-02T12:00:00Z")),
    );
    expect(
      forecastFor(
        defOf("revenue"),
        oneDay,
        40,
        periodProgress(jan, new Date("2026-01-02T12:00:00Z")),
      ),
    ).toBeNull();
  });

  it("is certain about a period that is over", () => {
    const done = bucketize(
      jan,
      Array.from({ length: 31 }, (_, i) =>
        day(`2026-01-${String(i + 1).padStart(2, "0")}`, 100, 300),
      ),
      janDone,
    );
    const f = forecastFor(defOf("revenue"), done, 40, janDone)!;
    expect(f.confidencePct).toBe(100);
    expect(f.projected).toBeCloseTo(31 * 300);
  });

  it("bands confidence the way the methodology panel describes", () => {
    expect(confidenceBand(10)).toBe("low");
    expect(confidenceBand(50)).toBe("medium");
    expect(confidenceBand(90)).toBe("high");
  });
});

describe("the forecast declines to guess", () => {
  it("says nothing when the period has no activity at all", () => {
    // Projecting zero "with 26% confidence" reads as a finding rather than as
    // an absence — the panel's "not enough data" state is the honest answer.
    const empty = bucketize(jan, [], midJan);
    expect(forecastFor(defOf("revenue"), empty, 40, midJan)).toBeNull();
  });

  it("still projects from a period that has only spend", () => {
    const spendOnly = bucketize(
      jan,
      Array.from({ length: 9 }, (_, i) => day(`2026-01-0${i + 1}`, 100, 0)),
      midJan,
    );
    expect(forecastFor(defOf("cost"), spendOnly, 40, midJan)?.projected).toBeCloseTo(100 * 31);
  });

  it("projects a source whose only activity is clicks (GA4 / Search Console)", () => {
    // The activity gate used to read cost/revenue/conversions only — Google Ads
    // terms — so a Search Console period with real clicks but no spend forecast
    // as "not enough data". Any reported signal now counts.
    const clicksOnly = bucketize(
      jan,
      Array.from({ length: 9 }, (_, i) => ({ date: `2026-01-0${i + 1}`, clicks: 10 })),
      midJan,
    );
    expect(forecastFor(defOf("clicks"), clicksOnly, 40, midJan)?.projected).toBeCloseTo(10 * 31);
  });
});
