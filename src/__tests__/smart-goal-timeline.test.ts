/**
 * The two automatic sources on the Smart Goals timeline: the shopping calendar
 * and the days the data itself flags. Both put marks on a chart people read as
 * explanations, so both are held to being right about dates and conservative
 * about what counts as unusual.
 */

import { holidaysForYear, holidaysBetween } from "@/lib/holidays";
import {
  detectAnomalies,
  anomaliesFromDailyRows,
  ANOMALY_TYPE_LABELS,
} from "@/lib/smartGoalAnomalies";
import { bucketize, type DailyRow } from "@/lib/smartGoalsData";
import { periodProgress } from "@/lib/smartGoals";
import { eventTypeLabel, isEventType, manualEventTypes } from "@/lib/smartGoalEvents";

describe("the holiday calendar", () => {
  it("computes the moving dates, not just the fixed ones", () => {
    const y2026 = Object.fromEntries(holidaysForYear(2026).map((h) => [h.key, h.date]));
    expect(y2026.christmas).toBe("2026-12-25");
    expect(y2026.thanksgiving).toBe("2026-11-26"); // 4th Thursday
    expect(y2026.blackfriday).toBe("2026-11-27");
    expect(y2026.cybermonday).toBe("2026-11-30");
    expect(y2026.easter).toBe("2026-04-05");
    expect(y2026.memorial).toBe("2026-05-25"); // last Monday of May
  });

  it("stays right in another year rather than repeating one", () => {
    const y2027 = Object.fromEntries(holidaysForYear(2027).map((h) => [h.key, h.date]));
    expect(y2027.thanksgiving).toBe("2027-11-25");
    expect(y2027.easter).toBe("2027-03-28");
  });

  it("returns only what falls inside the window", () => {
    const dec = holidaysBetween("2026-12-01", "2026-12-31").map((h) => h.key);
    expect(dec).toContain("christmas");
    expect(dec).not.toContain("halloween");
    expect(holidaysBetween("2026-12-31", "2026-12-01")).toEqual([]);
  });

  it("spans a year boundary", () => {
    const keys = holidaysBetween("2026-12-30", "2027-01-02").map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(["nye", "newyear"]));
  });
});

describe("anomaly detection", () => {
  const jan = "2026-01";
  const progress = periodProgress(jan, new Date("2026-02-01T00:00:00Z")); // month complete
  const days = (spec: { spend: number; revenue: number }[]): DailyRow[] =>
    spec.map((s, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      spend: s.spend,
      conversion_value: s.revenue,
      conversions: 1,
    }));
  const anomalies = (spec: { spend: number; revenue: number }[]) =>
    detectAnomalies(bucketize(jan, days(spec), progress));

  const steady = Array.from({ length: 31 }, () => ({ spend: 100, revenue: 300 }));
  const costEvents = (found: { id: string; type: string; title: string }[]) =>
    found.filter((e) => e.id.startsWith("anomaly-cost-"));
  const revEvents = (found: { id: string; type: string; title: string }[]) =>
    found.filter((e) => e.id.startsWith("anomaly-revenue-"));

  it("says nothing about a steady month", () => {
    expect(anomalies(steady)).toEqual([]);
  });

  it("flags the day a KPI jumps clear of its recent average", () => {
    const spec = [...steady];
    spec[10] = { spend: 400, revenue: 300 }; // cost 4x its recent average
    const cost = costEvents(anomalies(spec));
    expect(cost).toHaveLength(1);
    expect(cost[0]).toMatchObject({ type: "metric_spike", startDate: "2026-01-11" });
  });

  it("flags a critical metric dropping to 0", () => {
    const spec = [...steady];
    spec[7] = { spend: 100, revenue: 0 };
    const rev = revEvents(anomalies(spec));
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ type: "metric_drop", startDate: "2026-01-08" });
    expect(rev[0].title).toMatch(/dropped to 0/);
  });

  it("stays quiet with too little history to know what normal is", () => {
    expect(
      anomalies([
        { spend: 100, revenue: 300 },
        { spend: 900, revenue: 0 },
      ]),
    ).toEqual([]);
  });

  it("emits ONE event for a run in the same state, not one per day", () => {
    // Revenue drops to 0 and stays there — one anomaly at the transition, then
    // silence, not a mark every day burying everything else on the timeline.
    const spec = [
      ...Array.from({ length: 10 }, () => ({ spend: 100, revenue: 300 })),
      ...Array.from({ length: 15 }, () => ({ spend: 100, revenue: 0 })),
    ];
    const rev = revEvents(anomalies(spec));
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ type: "metric_drop", startDate: "2026-01-11" });
  });

  it("does not re-flag the return to normal after a single spike", () => {
    // One huge day is a spike; the ordinary days after it are not each a drop —
    // once flagged, the run stays quiet until it settles.
    const spec = [...steady];
    spec[3] = { spend: 5_000, revenue: 15_000 };
    const cost = costEvents(anomalies(spec));
    expect(cost.filter((e) => e.type === "metric_spike")).toHaveLength(1);
    expect(cost.filter((e) => e.type === "metric_drop")).toHaveLength(0);
  });

  it("only analyses the KPI cards it is given", () => {
    const spec = [...steady];
    spec[10] = { spend: 400, revenue: 300 };
    // Cost isn't in the set, so its spike isn't reported.
    const found = detectAnomalies(bucketize(jan, days(spec), progress), ["revenue", "conversions"]);
    expect(costEvents(found)).toHaveLength(0);
  });

  it("never flags a day that hasn't happened", () => {
    const early = periodProgress(jan, new Date("2026-01-10T00:00:00Z"));
    const found = detectAnomalies(bucketize(jan, days(steady), early));
    for (const e of found) expect(e.startDate <= "2026-01-09").toBe(true);
  });

  it("labels every type it can produce", () => {
    const spec = [...steady];
    spec[2] = { spend: 500, revenue: 0 };
    spec[4] = { spend: 0, revenue: 0 };
    for (const e of anomalies(spec)) {
      expect(ANOMALY_TYPE_LABELS[e.type]).toBeTruthy();
      // And the timeline can name it through the shared taxonomy too.
      expect(eventTypeLabel("ads", e.type)).not.toBe(e.type);
    }
  });
});

describe("detected types are the detector's alone", () => {
  it("aren't offered in the add-event modal", () => {
    const offered = manualEventTypes("ads").map((t) => t.key);
    expect(offered).toContain("budget_change");
    expect(offered).not.toContain("spend_spike");
  });

  it("are refused by the API's type check", () => {
    // Otherwise a hand-written event could masquerade as something the system
    // found on its own.
    expect(isEventType("ads", "budget_change")).toBe(true);
    expect(isEventType("ads", "spend_spike")).toBe(false);
  });
});

describe("anomaliesFromDailyRows", () => {
  // The dashboards keep their day series in their own shape. This is the one
  // translation between it and the detector's bucket vocabulary, and it is
  // what puts a source's own anomalies on that source's timeline.
  const steady = (iso: string, cost: number, total: number) => ({
    _iso: iso,
    date: iso,
    cost,
    total,
    clicks: 10,
    conv: 1,
  });

  it("finds a collapse in spend from the dashboard's own rows", () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => steady(`2026-03-0${i + 1}`, 100, 300)),
      steady("2026-03-09", 0, 0),
    ];
    const found = anomaliesFromDailyRows(rows);
    expect(found.some((a) => a.type === "metric_drop")).toBe(true);
    expect(found.every((a) => a.category === "ads")).toBe(true);
  });

  it("ignores rows with no date rather than bucketing them as one", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => steady(`2026-03-0${i + 1}`, 100, 300)),
      { date: "bad", cost: 999, total: 0 },
    ];
    expect(() => anomaliesFromDailyRows(rows)).not.toThrow();
  });

  it("has nothing to say about an empty dashboard", () => {
    expect(anomaliesFromDailyRows([])).toEqual([]);
  });
});
