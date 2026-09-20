/**
 * Smart Goals — the goal, pacing and status model.
 *
 * This is the layer every screen reads from, and its mistakes are quiet ones:
 * a wrong formula still renders a confident number. So the rules from the spec
 * are asserted directly here, including the ones that are easy to get backwards
 * (Budget succeeds by staying LOW) and the ones that must never mix (pacing
 * language during a period, outcome language after it).
 */

import {
  emptySettings,
  activeGoals,
  goalRowsFor,
  resolveAiFocus,
  type GoalConfig,
  rollUpMonthsToYear,
  splitYearToMonth,
  monthsOfYear,
  switchPeriodKind,
  periodKind,
  periodRange,
  periodBucketCount,
  isPeriodCompleted,
  isPeriodFuture,
  periodPositionText,
  periodProgress,
  effectiveTarget,
  validateSettings,
  attainmentPct,
  expectedByNow,
  goalStatus,
  healthSummary,
  carryForward,
  previousPeriod,
  periodFor,
  DEFAULT_MARGIN_PCT,
  type SmartGoalsSettings,
  type GoalStatus,
} from "@/lib/smartGoals";
import { nextPeriod } from "@/app/(dashboard)/smart-goals/_components/PeriodPicker";
import {
  goalMetricsFor,
  derivedTarget,
  metricValue,
  type GoalMetricDef,
} from "@/lib/smartGoalMetrics";

// Google Ads has the fullest metric set, so it exercises every rule; the
// per-source behaviour itself is covered in smart-goal-metrics.test.ts.
const ADS = goalMetricsFor("google_ads");
const defOf = (key: string): GoalMetricDef => ADS.find((m) => m.key === key)!;

// A configuration the way a user would leave it: revenue and budget typed in,
// the derived three on Auto.
const settingsWith = (over: Partial<SmartGoalsSettings> = {}): SmartGoalsSettings => {
  const base = emptySettings("2026-01", "google_ads", ADS);
  const set = (metric: string, patch: Partial<(typeof base.goals)[number]>) => {
    const g = base.goals.find((x) => x.metric === metric)!;
    Object.assign(g, patch);
  };
  set("revenue", { enabled: true, target: 10_000 });
  set("cost", { enabled: true, target: 2_000 });
  set("roasVal", { enabled: true, auto: true });
  return { ...base, ...over };
};

describe("periods", () => {
  it("reads both shapes and rejects anything else", () => {
    expect(periodKind("2026-01")).toBe("month");
    expect(periodKind("2026")).toBe("year");
    // Guessing at a malformed period would silently produce "the year 0".
    expect(() => periodKind("2026-13")).toThrow();
    expect(() => periodKind("Jan 2026")).toThrow();
    expect(() => periodKind("")).toThrow();
  });

  it("spans the calendar month, in UTC", () => {
    const { start, endExclusive } = periodRange("2026-02");
    expect(start.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(endExclusive.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("counts days in a month and months in a year", () => {
    expect(periodBucketCount("2026-01")).toBe(31);
    expect(periodBucketCount("2026-02")).toBe(28);
    expect(periodBucketCount("2028-02")).toBe(29); // leap year
    expect(periodBucketCount("2026")).toBe(12);
  });

  it("calls a period completed only once it is entirely past", () => {
    expect(isPeriodCompleted("2026-01", new Date("2026-01-31T23:59:00Z"))).toBe(false);
    expect(isPeriodCompleted("2026-01", new Date("2026-02-01T00:00:00Z"))).toBe(true);
    expect(isPeriodFuture("2026-03", new Date("2026-02-15T00:00:00Z"))).toBe(true);
  });

  it("counts only FINISHED buckets as elapsed", () => {
    // Part-way through the 5th means four complete days of data — the honest
    // denominator for "what should we have by now".
    const p = periodProgress("2026-01", new Date("2026-01-05T18:00:00Z"));
    expect(p.elapsedBuckets).toBe(4);
    expect(p.totalBuckets).toBe(31);
    expect(p.bucketsRemaining).toBe(27);
    expect(p.elapsedFraction).toBeCloseTo(4 / 31);
  });

  it("is fully elapsed once completed and empty before it starts", () => {
    expect(periodProgress("2026-01", new Date("2026-05-01T00:00:00Z"))).toMatchObject({
      completed: true,
      elapsedBuckets: 31,
      elapsedFraction: 1,
      bucketsRemaining: 0,
    });
    expect(periodProgress("2026-06", new Date("2026-01-01T00:00:00Z"))).toMatchObject({
      future: true,
      elapsedBuckets: 0,
      elapsedFraction: 0,
    });
  });

  it("measures a year in whole months", () => {
    const p = periodProgress("2026", new Date("2026-04-20T00:00:00Z"));
    expect(p.kind).toBe("year");
    expect(p.elapsedBuckets).toBe(3); // Jan, Feb, Mar
    expect(p.totalBuckets).toBe(12);
  });

  it("walks back a period in the same shape", () => {
    expect(previousPeriod("2026-01")).toBe("2025-12");
    expect(previousPeriod("2026-07")).toBe("2026-06");
    expect(previousPeriod("2026")).toBe("2025");
  });

  it("names the period a date falls in", () => {
    expect(periodFor(new Date("2026-01-09T12:00:00Z"), "month")).toBe("2026-01");
    expect(periodFor(new Date("2026-11-30T12:00:00Z"), "month")).toBe("2026-11");
    expect(periodFor(new Date("2026-01-09T12:00:00Z"), "year")).toBe("2026");
  });
});

describe("auto targets", () => {
  it("derives the three formulas from revenue, spend and margin", () => {
    const inputs = { revenue: 10_000, cost: 2_000, marginPct: 40 };
    expect(derivedTarget("roasVal", inputs)).toBe(5);
    expect(derivedTarget("profit", inputs)).toBe(8_000);
    // Margin turns revenue into gross profit; ad spend comes off that.
    expect(derivedTarget("net_profit", inputs)).toBe(10_000 * 0.4 - 2_000);
  });

  it("returns nothing rather than a fabricated number when an input is missing", () => {
    expect(derivedTarget("roasVal", { revenue: null, cost: 2_000, marginPct: 40 })).toBeNull();
    expect(derivedTarget("roasVal", { revenue: 10_000, cost: null, marginPct: 40 })).toBeNull();
    // Would divide by zero.
    expect(derivedTarget("roasVal", { revenue: 10_000, cost: 0, marginPct: 40 })).toBeNull();
  });

  it("uses the manual target when the goal is not on Auto", () => {
    const s = settingsWith();
    const roas = s.goals.find((g) => g.metric === "roasVal")!;
    roas.auto = false;
    roas.target = 3;
    expect(effectiveTarget(roas, s, ADS)).toBe(3);
  });

  it("ignores a dependency that is switched off", () => {
    // Deriving from a goal the user isn't tracking would invent a target out
    // of a number they never committed to.
    const s = settingsWith();
    s.goals.find((g) => g.metric === "cost")!.enabled = false;
    const roas = s.goals.find((g) => g.metric === "roasVal")!;
    expect(effectiveTarget(roas, s, ADS)).toBeNull();
  });

  it("computes the same formulas over actuals", () => {
    const totals = {
      clicks: 0,
      impressions: 0,
      cost: 300,
      conversions: 0,
      revenue: 900,
      extra: {},
    };
    expect(metricValue("profit", totals, 40)).toBe(600);
    expect(metricValue("roasVal", totals, 40)).toBe(3);
    expect(metricValue("net_profit", totals, 40)).toBe(60);
  });
});

describe("validation", () => {
  it("accepts a configuration with a target and something enabled", () => {
    expect(validateSettings(settingsWith(), ADS).canSave).toBe(true);
  });

  it("blocks the spec's two examples: a zero budget and a zero ROAS", () => {
    const zeroBudget = settingsWith();
    zeroBudget.goals.find((g) => g.metric === "cost")!.target = 0;
    expect(validateSettings(zeroBudget, ADS).errors.cost).toBeTruthy();
    expect(validateSettings(zeroBudget, ADS).canSave).toBe(false);

    const zeroRoas = settingsWith();
    const roas = zeroRoas.goals.find((g) => g.metric === "roasVal")!;
    roas.auto = false;
    roas.target = 0;
    expect(validateSettings(zeroRoas, ADS).errors.roasVal).toBeTruthy();
  });

  it("blocks a configuration with nothing to track", () => {
    const none = emptySettings("2026-01", "google_ads", ADS);
    const v = validateSettings(none, ADS);
    expect(v.canSave).toBe(false);
    expect(v.formErrors).toContain("Enable at least one goal");
  });

  it("allows a negative profit target — a loss-making month is still a plan", () => {
    const s = settingsWith();
    const ap = s.goals.find((g) => g.metric === "profit")!;
    ap.enabled = true;
    ap.auto = false;
    ap.target = -500;
    expect(validateSettings(s, ADS).errors.profit).toBeUndefined();
  });

  it("explains an Auto goal that can't be computed yet", () => {
    const s = settingsWith();
    s.goals.find((g) => g.metric === "revenue")!.enabled = false;
    expect(validateSettings(s, ADS).errors.roasVal).toMatch(/Auto/);
  });

  it("rejects a margin outside 0–100%", () => {
    expect(validateSettings(settingsWith({ marginPct: 140 }), ADS).canSave).toBe(false);
    expect(validateSettings(settingsWith({ marginPct: -1 }), ADS).canSave).toBe(false);
    expect(validateSettings(settingsWith({ marginPct: 0 }), ADS).canSave).toBe(true);
  });

  it("does not require an AI focus — the first enabled goal stands in", () => {
    const s = settingsWith({ aiFocus: null });
    expect(validateSettings(s, ADS).canSave).toBe(true);
    // First by the source's own column order, which on Google Ads is ROAS.
    expect(resolveAiFocus(s)).toBe(activeGoals(s)[0].metric);
  });
});

describe("the AI focus", () => {
  it("keeps the user's choice", () => {
    expect(resolveAiFocus(settingsWith({ aiFocus: "cost" }))).toBe("cost");
  });

  it("falls back when the chosen goal is switched off", () => {
    const s = settingsWith({ aiFocus: "impr" }); // never enabled
    expect(resolveAiFocus(s)).toBe(activeGoals(s)[0].metric);
  });

  it("follows the order rather than the catalogue when goals are reordered", () => {
    const s = settingsWith({ aiFocus: null });
    for (const g of s.goals) g.order = 50;
    s.goals.find((g) => g.metric === "cost")!.order = 0;
    expect(activeGoals(s)[0].metric).toBe("cost");
    expect(resolveAiFocus(s)).toBe("cost");
  });

  it("has nothing to focus on when no goal is enabled", () => {
    expect(resolveAiFocus(emptySettings("2026-01", "google_ads", ADS))).toBeNull();
  });
});

describe("attainment reads the same for both directions", () => {
  it("counts up for a higher-is-better goal", () => {
    expect(attainmentPct(defOf("revenue"), 5_000, 10_000)).toBe(50);
    expect(attainmentPct(defOf("revenue"), 12_000, 10_000)).toBe(120);
  });

  it("rewards underspending on Budget", () => {
    // Spending 1,800 of a 2,000 budget is BEATING the goal, not falling short
    // of it — the trap this metric sets for a naive actual/target.
    expect(attainmentPct(defOf("cost"), 1_800, 2_000)).toBeCloseTo(111.1, 1);
    expect(attainmentPct(defOf("cost"), 2_500, 2_000)).toBe(80);
    expect(attainmentPct(defOf("cost"), 2_000, 2_000)).toBe(100);
  });
});

describe("an active period is judged on pace only", () => {
  // Ten days into January, a third of the way through a 31-day month.
  const progress = periodProgress("2026-01", new Date("2026-01-11T00:00:00Z"));

  it("expects a cumulative goal to be part-way there", () => {
    expect(expectedByNow(defOf("revenue"), 31_000, progress)).toBeCloseTo(10_000);
  });

  it("expects an average goal to be at its target already", () => {
    // ROAS doesn't build up over the month; it should sit at target from day one.
    expect(expectedByNow(defOf("roasVal"), 5, progress)).toBe(5);
  });

  it("reports ahead of pace", () => {
    const s = goalStatus({ def: defOf("revenue"), actual: 13_000, target: 31_000, progress });
    expect(s.kind).toBe("pace");
    if (s.kind !== "pace") throw new Error("expected pacing");
    expect(s.pacePct).toBeCloseTo(30);
    expect(s.state).toBe("ahead");
    expect(s.onTrack).toBe(true);
    expect(s.bucketsRemaining).toBe(21);
  });

  it("reports behind pace", () => {
    const s = goalStatus({ def: defOf("revenue"), actual: 5_000, target: 31_000, progress });
    if (s.kind !== "pace") throw new Error("expected pacing");
    expect(s.pacePct).toBeCloseTo(-50);
    expect(s.state).toBe("behind");
    expect(s.onTrack).toBe(false);
  });

  it("tolerates a hair off the line rather than calling it a failure", () => {
    const s = goalStatus({ def: defOf("revenue"), actual: 9_900, target: 31_000, progress });
    if (s.kind !== "pace") throw new Error("expected pacing");
    expect(s.state).toBe("on_track");
    expect(s.onTrack).toBe(true);
  });

  it("treats underspending as ahead on Budget", () => {
    const s = goalStatus({ def: defOf("cost"), actual: 500, target: 3_100, progress });
    if (s.kind !== "pace") throw new Error("expected pacing");
    expect(s.state).toBe("ahead");
    expect(s.onTrack).toBe(true);
  });

  it("treats overspending as behind on Budget", () => {
    const s = goalStatus({ def: defOf("cost"), actual: 2_000, target: 3_100, progress });
    if (s.kind !== "pace") throw new Error("expected pacing");
    expect(s.state).toBe("behind");
  });

  it("judges nothing on day one, when no bucket has finished", () => {
    const dayOne = periodProgress("2026-01", new Date("2026-01-01T06:00:00Z"));
    const s = goalStatus({ def: defOf("revenue"), actual: 0, target: 31_000, progress: dayOne });
    if (s.kind !== "pace") throw new Error("expected pacing");
    expect(s.pacePct).toBeNull();
    expect(s.state).toBe("on_track");
    // A goal with no elapsed time isn't failing.
    expect(s.onTrack).toBe(true);
  });

  it("never produces outcome language while the period runs", () => {
    const s = goalStatus({ def: defOf("revenue"), actual: 1, target: 31_000, progress });
    expect(s.kind).toBe("pace");
    expect(s).not.toHaveProperty("achieved");
  });
});

describe("a completed period is judged on the result only", () => {
  const progress = periodProgress("2026-01", new Date("2026-02-05T00:00:00Z"));

  it.each([
    [12_000, "exceeded", true],
    [10_000, "achieved", true],
    [9_500, "near", false],
    [7_000, "below", false],
  ])("%i against a 10,000 target reads as %s", (actual, state, achieved) => {
    const s = goalStatus({
      def: defOf("revenue"),
      actual: actual as number,
      target: 10_000,
      progress,
    });
    if (s.kind !== "result") throw new Error("expected a result");
    expect(s.state).toBe(state);
    expect(s.achieved).toBe(achieved);
  });

  it("puts the thresholds exactly where the spec does", () => {
    const at = (pct: number) =>
      (
        goalStatus({
          def: defOf("revenue"),
          actual: pct * 100,
          target: 10_000,
          progress,
        }) as Extract<GoalStatus, { kind: "result" }>
      ).state;
    expect(at(100.01)).toBe("exceeded");
    expect(at(100)).toBe("achieved");
    expect(at(99.99)).toBe("near");
    expect(at(90)).toBe("near");
    expect(at(89.99)).toBe("below");
  });

  it("counts a budget kept as achieved", () => {
    const s = goalStatus({ def: defOf("cost"), actual: 1_900, target: 2_000, progress });
    if (s.kind !== "result") throw new Error("expected a result");
    expect(s.achieved).toBe(true);
  });

  it("never produces pacing language once the period is over", () => {
    const s = goalStatus({ def: defOf("revenue"), actual: 1, target: 10_000, progress });
    expect(s.kind).toBe("result");
    expect(s).not.toHaveProperty("pacePct");
    expect(s).not.toHaveProperty("bucketsRemaining");
  });
});

describe("the health score", () => {
  const pace = (onTrack: boolean): GoalStatus => ({
    kind: "pace",
    metric: "revenue",
    actual: 0,
    target: 1,
    progressPct: 0,
    expected: 0,
    pacePct: 0,
    state: onTrack ? "on_track" : "behind",
    onTrack,
    bucketsRemaining: 1,
  });
  const result = (achieved: boolean): GoalStatus => ({
    kind: "result",
    metric: "revenue",
    actual: 0,
    target: 1,
    attainmentPct: achieved ? 100 : 10,
    state: achieved ? "achieved" : "below",
    achieved,
  });

  it("is the share of goals on track", () => {
    const h = healthSummary([pace(true), pace(true), pace(true), pace(false)], false);
    expect(h.met).toBe(3);
    expect(h.total).toBe(4);
    expect(h.scorePct).toBe(75);
  });

  // The bands from the spec: 80–100 / 60–79 / 40–59 / 20–39 / 0–19.
  it.each([
    [5, 5, "Excellent progress"], // 100%
    [3, 5, "On track"], // 60%
    [2, 5, "Needs attention"], // 40%
    [1, 5, "Action required"], // 20%
    [0, 5, "Critical risk"], // 0%
  ])("labels %i of %i on track as %s", (met, total, text) => {
    const statuses = [
      ...Array.from({ length: met as number }, () => pace(true)),
      ...Array.from({ length: (total as number) - (met as number) }, () => pace(false)),
    ];
    expect(healthSummary(statuses, false).label.text).toBe(text);
  });

  it.each([
    [5, 5, "Excellent results"], // 100%
    [3, 5, "Good results"], // 60%
    [2, 5, "Moderate results"], // 40%
    [1, 5, "Weak results"], // 20%
    [0, 5, "Poor results"], // 0%
  ])("labels %i of %i achieved as %s", (met, total, text) => {
    const statuses = [
      ...Array.from({ length: met as number }, () => result(true)),
      ...Array.from({ length: (total as number) - (met as number) }, () => result(false)),
    ];
    expect(healthSummary(statuses, true).label.text).toBe(text);
  });

  it("keeps the two vocabularies apart", () => {
    // Progress-shaped wording must never appear on a finished period, and
    // outcome-shaped wording never on a running one.
    const active = ACTIVE_TEXTS();
    const completed = COMPLETED_TEXTS();
    expect(active.some((t) => completed.includes(t))).toBe(false);
  });

  it("says on track while running and achieved once finished", () => {
    expect(healthSummary([pace(true)], false).summaryText).toBe("1 / 1 goals on track");
    expect(healthSummary([result(true)], true).summaryText).toBe("1 / 1 goals achieved");
  });

  it("scores zero rather than dividing by it when nothing is enabled", () => {
    const h = healthSummary([], false);
    expect(h.scorePct).toBe(0);
    expect(h.total).toBe(0);
    expect(Number.isNaN(h.scorePct)).toBe(false);
  });

  const ACTIVE_TEXTS = () =>
    [0, 25, 45, 65, 85].map(
      (pct) =>
        healthSummary(
          [
            ...Array.from({ length: pct }, () => pace(true)),
            ...Array.from({ length: 100 - pct }, () => pace(false)),
          ],
          false,
        ).label.text,
    );
  const COMPLETED_TEXTS = () =>
    [0, 25, 45, 65, 85].map(
      (pct) =>
        healthSummary(
          [
            ...Array.from({ length: pct }, () => result(true)),
            ...Array.from({ length: 100 - pct }, () => result(false)),
          ],
          true,
        ).label.text,
    );
});

describe("carrying goals into a new period", () => {
  it("copies the previous period's goals, targets and focus", () => {
    const prev = settingsWith({ period: "2025-12", aiFocus: "cost", marginPct: 35 });
    const next = carryForward("2026-01", "google_ads", null, prev)!;
    expect(next.period).toBe("2026-01");
    expect(next.aiFocus).toBe("cost");
    expect(next.marginPct).toBe(35);
    expect(activeGoals(next).map((g) => g.metric)).toEqual(activeGoals(prev).map((g) => g.metric));
    expect(next.goals.find((g) => g.metric === "revenue")!.target).toBe(10_000);
  });

  it("never overwrites goals the user planned ahead", () => {
    // The spec calls this out: pre-planning a month only works if the
    // roll-over can't clobber it.
    const planned = settingsWith({ period: "2026-01" });
    planned.goals.find((g) => g.metric === "revenue")!.target = 99_000;
    const prev = settingsWith({ period: "2025-12" });
    expect(carryForward("2026-01", "google_ads", planned, prev)).toBe(planned);
  });

  it("copies the goals rather than sharing them", () => {
    const prev = settingsWith({ period: "2025-12" });
    const next = carryForward("2026-01", "google_ads", null, prev)!;
    next.goals.find((g) => g.metric === "revenue")!.target = 1;
    expect(prev.goals.find((g) => g.metric === "revenue")!.target).toBe(10_000);
  });

  it("leaves the empty state in place when there is nothing to carry", () => {
    expect(carryForward("2026-01", "google_ads", null, null)).toBeNull();
  });
});

describe("defaults", () => {
  it("starts with every preset present, nothing enabled and the derived ones on Auto", () => {
    const s = emptySettings("2026-03", "google_ads", ADS);
    expect(s.goals).toHaveLength(ADS.length);
    expect(s.goals.every((g) => !g.enabled)).toBe(true);
    expect(s.goals.find((g) => g.metric === "net_profit")!.auto).toBe(true);
    expect(s.goals.find((g) => g.metric === "revenue")!.auto).toBe(false);
    expect(s.marginPct).toBe(DEFAULT_MARGIN_PCT);
    expect(activeGoals(s)).toEqual([]);
  });
});

describe("the rows the settings modal offers", () => {
  it("has one per metric the source has, not per goal that was saved", () => {
    // The bug this guards: a config saved before a metric existed showed only
    // the goals it happened to contain, so a metric an admin registered later
    // could never be switched on.
    const saved = settingsWith();
    saved.goals = saved.goals.filter((g) => g.metric === "revenue");
    const rows = goalRowsFor(saved, ADS);
    expect(rows).toHaveLength(ADS.length);
    expect(rows.map((r) => r.metric)).toEqual(expect.arrayContaining(["cost", "roasVal", "cpa"]));
  });

  it("keeps what was saved for a metric", () => {
    const rows = goalRowsFor(settingsWith(), ADS);
    expect(rows.find((r) => r.metric === "revenue")).toMatchObject({
      enabled: true,
      target: 10_000,
    });
  });

  it("drops a goal on a metric the source no longer has", () => {
    // Left in, it would be an unfillable row for something nobody can read.
    const stale = settingsWith();
    stale.goals.push({ metric: "retired_metric", enabled: true, order: 0, target: 5, auto: false });
    expect(goalRowsFor(stale, ADS).map((r) => r.metric)).not.toContain("retired_metric");
  });

  it("puts newly available metrics after the ones already arranged", () => {
    const saved = settingsWith();
    saved.goals = saved.goals.filter((g) => g.metric === "revenue");
    saved.goals[0].order = 0;
    expect(goalRowsFor(saved, ADS)[0].metric).toBe("revenue");
  });
});

describe("moving between periods", () => {
  it("steps a month at a time, across a year boundary", () => {
    expect(nextPeriod("2026-08")).toBe("2026-09");
    expect(nextPeriod("2026-12")).toBe("2027-01");
    expect(previousPeriod("2026-01")).toBe("2025-12");
  });

  it("steps a year at a time in the yearly view", () => {
    expect(nextPeriod("2026")).toBe("2027");
    expect(previousPeriod("2026")).toBe("2025");
  });

  it("reaches any year by stepping", () => {
    // The complaint this answers: the old picker offered a year either side,
    // so 2022 simply couldn't be opened.
    let p = "2026-08";
    for (let i = 0; i < 56; i++) p = previousPeriod(p);
    expect(p).toBe("2021-12");
    expect(() => periodKind(p)).not.toThrow();
  });

  it("keeps a period valid however far it is walked", () => {
    let p = "2026-01";
    for (let i = 0; i < 40; i++) p = nextPeriod(p);
    expect(periodKind(p)).toBe("month");
    expect(periodRange(p).start.getUTCFullYear()).toBe(2029);
  });
});

describe("switching what a period means", () => {
  // Rebuilding the month from the year alone always produced January, which is
  // how someone lost the month they were working on.
  it("keeps the month across a round trip", () => {
    const year = switchPeriodKind("year", "2026-08", "2026-08");
    expect(year).toBe("2026");
    expect(switchPeriodKind("month", year, "2026-08")).toBe("2026-08");
  });

  it("keeps the month when the year was changed in between", () => {
    // Yearly view, stepped back to 2024, then back to days: August 2024.
    expect(switchPeriodKind("month", "2024", "2026-08")).toBe("2024-08");
  });

  it("produces periods both shapes can parse", () => {
    for (const month of ["2026-01", "2026-08", "2026-12"]) {
      const year = switchPeriodKind("year", month, month);
      expect(periodKind(year)).toBe("year");
      expect(periodKind(switchPeriodKind("month", year, month))).toBe("month");
    }
  });
});

describe("a year and its months describing the same plan", () => {
  // Flipping to the yearly view used to demand a second set of goals: the
  // months said nothing about the year, so the year came up empty and had to
  // be filled in again. Whoever has planned a month has planned the year.
  const month = (period: string, goals: Partial<GoalConfig>[]): SmartGoalsSettings => ({
    connector: "google_ads",
    period,
    goals: goals.map((g, i) => ({
      metric: "revenue",
      enabled: true,
      order: i,
      target: null,
      auto: false,
      ...g,
    })),
    aiFocus: null,
    marginPct: 40,
    alwaysShowTimeline: false,
  });
  const targetOf = (s: SmartGoalsSettings | null, metric: string) =>
    s?.goals.find((g) => g.metric === metric)?.target;

  it("carries a monthly commitment across the year", () => {
    const rolled = rollUpMonthsToYear(
      "2026",
      "google_ads",
      [month("2026-08", [{ metric: "revenue", target: 30_000 }])],
      ADS,
    );
    expect(targetOf(rolled, "revenue")).toBe(360_000);
  });

  it("averages the months that were planned before extending them", () => {
    const rolled = rollUpMonthsToYear(
      "2026",
      "google_ads",
      [
        month("2026-01", [{ metric: "revenue", target: 20_000 }]),
        month("2026-02", [{ metric: "revenue", target: 40_000 }]),
      ],
      ADS,
    );
    expect(targetOf(rolled, "revenue")).toBe(360_000);
  });

  it("does not count an unplanned month as a zero", () => {
    // Ten silent months must not drag the year's target down to a sixth.
    const planned = [month("2026-08", [{ metric: "revenue", target: 30_000 }])];
    const withSilent = [...planned, month("2026-09", [{ metric: "revenue", enabled: false }])];
    expect(targetOf(rollUpMonthsToYear("2026", "google_ads", withSilent, ADS), "revenue")).toBe(
      targetOf(rollUpMonthsToYear("2026", "google_ads", planned, ADS), "revenue"),
    );
  });

  it("leaves a rate alone, because rates do not accumulate", () => {
    // Aiming at 4x every month is aiming at 4x for the year, not 48x.
    const rolled = rollUpMonthsToYear(
      "2026",
      "google_ads",
      [month("2026-08", [{ metric: "roasVal", target: 4 }])],
      ADS,
    );
    expect(targetOf(rolled, "roasVal")).toBe(4);
  });

  it("keeps a derived goal derived rather than rolling up a computed number", () => {
    const rolled = rollUpMonthsToYear(
      "2026",
      "google_ads",
      [month("2026-08", [{ metric: "net_profit", auto: true, target: null }])],
      ADS,
    );
    expect(rolled?.goals.find((g) => g.metric === "net_profit")).toMatchObject({
      auto: true,
      target: null,
    });
  });

  it("says nothing when no month was planned", () => {
    expect(rollUpMonthsToYear("2026", "google_ads", [], ADS)).toBeNull();
    expect(
      rollUpMonthsToYear("2026", "google_ads", [month("2026-08", [{ enabled: false }])], ADS),
    ).toBeNull();
  });

  it("gives each month its share of a yearly target", () => {
    const split = splitYearToMonth(
      "2026-08",
      "google_ads",
      month("2026", [{ metric: "revenue", target: 360_000 }]),
      ADS,
    );
    expect(targetOf(split, "revenue")).toBe(30_000);
  });

  it("applies a rate to the month as it stands", () => {
    const split = splitYearToMonth(
      "2026-08",
      "google_ads",
      month("2026", [{ metric: "roasVal", target: 4 }]),
      ADS,
    );
    expect(targetOf(split, "roasVal")).toBe(4);
  });

  it("round-trips: a year built from months splits back into them", () => {
    const rolled = rollUpMonthsToYear(
      "2026",
      "google_ads",
      [
        month("2026-08", [
          { metric: "revenue", target: 30_000 },
          { metric: "roasVal", target: 4 },
        ]),
      ],
      ADS,
    );
    const back = splitYearToMonth("2026-09", "google_ads", rolled, ADS);
    expect(targetOf(back, "revenue")).toBe(30_000);
    expect(targetOf(back, "roasVal")).toBe(4);
  });

  it("names all twelve months of a year", () => {
    expect(monthsOfYear("2026")).toHaveLength(12);
    expect(monthsOfYear("2026")[0]).toBe("2026-01");
    expect(monthsOfYear("2026")[11]).toBe("2026-12");
    for (const m of monthsOfYear("2026")) expect(periodKind(m)).toBe("month");
  });
});

describe("saying where in the period today falls", () => {
  // "Day 18 of 31 · Week 3 · 13 days remaining" is what decides whether a
  // number is alarming or just early.
  const at = (period: string, iso: string) =>
    periodPositionText(periodProgress(period, new Date(iso)));

  it("counts the day being lived, not the ones already closed", () => {
    // 17 closed days means today is the 18th.
    expect(at("2026-08", "2026-08-18T09:00:00Z")).toContain("Day 18 of 31");
  });

  it("names the week that day falls in", () => {
    expect(at("2026-08", "2026-08-18T09:00:00Z")).toContain("Week 3");
    expect(at("2026-08", "2026-08-01T09:00:00Z")).toContain("Week 1");
    expect(at("2026-08", "2026-08-31T09:00:00Z")).toContain("Week 5");
  });

  it("counts what is left", () => {
    expect(at("2026-08", "2026-08-18T09:00:00Z")).toContain("13 days remaining");
  });

  it("says a period is over rather than quoting a day nobody is on", () => {
    expect(at("2026-07", "2026-08-18T09:00:00Z")).toContain("Complete");
    expect(at("2026-07", "2026-08-18T09:00:00Z")).not.toContain("Day");
  });

  it("says a period hasn't started instead of counting into it", () => {
    expect(at("2026-12", "2026-08-18T09:00:00Z")).toContain("Not started");
  });

  it("counts a year in months, with no week in it", () => {
    const y = at("2026", "2026-08-18T09:00:00Z");
    expect(y).toContain("Month 8 of 12");
    expect(y).toContain("4 months remaining");
    expect(y).not.toContain("Week");
  });

  it("never counts past the end of the period", () => {
    expect(at("2026-08", "2026-08-31T23:59:00Z")).toContain("Day 31 of 31");
  });

  it("says one day left in the singular", () => {
    expect(at("2026-08", "2026-08-30T12:00:00Z")).toContain("1 day remaining");
  });
});
