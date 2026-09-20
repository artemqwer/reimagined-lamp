// ─────────────────────────────────────────────────────────────────────────────
// Smart Goals — the goal, pacing and status model.
//
// Everything here is pure: given a period, a configuration and the numbers the
// account actually did, it says what the targets are, whether each goal is on
// track (or, once the period is over, whether it was met) and how the account
// is doing overall. The UI and the API both read from this, so the rules live
// in one place rather than being re-derived per screen.
//
// Two ideas drive most of the logic:
//   • A period is either ACTIVE or COMPLETED, and the two are judged
//     differently — pacing while it runs, outcome once it's done. The spec is
//     emphatic that the two vocabularies never mix.
//   • A metric either accumulates over the period (revenue, spend, orders) or
//     it doesn't (ROAS is an average). Pacing only means something for the
//     first kind.
// ─────────────────────────────────────────────────────────────────────────────

import { derivedTarget, goalMetricDefIn, type GoalMetricDef } from "./smartGoalMetrics";

export type { GoalMetricDef, GoalFormat } from "./smartGoalMetrics";

// ─── Configuration ───────────────────────────────────────────────────────────

export interface GoalConfig {
  /** A metric key from the SOURCE's own catalogue (see goalMetricsFor). */
  metric: string;
  /** Whether this goal is tracked at all. A disabled goal is invisible to the
   *  health score, the cards and the forecast. */
  enabled: boolean;
  order: number;
  /** Custom hex color for the metric card and graph line (e.g. #3B82F6). */
  color?: string;
  /** The user's own target. Ignored while `auto` is on. */
  target: number | null;
  /** Derive the target from the other goals rather than taking `target`. Only
   *  meaningful on a metric that declares `derivedFrom`. */
  auto: boolean;
}

export interface SmartGoalsSettings {
  /** The data source these goals belong to. Each source has its own metrics,
   *  so it has its own goals — a revenue target for Google Ads says nothing
   *  about GA4. */
  connector: string;
  /** "2026-01" for a month, "2026" for a year. */
  period: string;
  goals: GoalConfig[];
  /** The one goal the AI builds its recommendations around. */
  aiFocus: string | null;
  /** Average product margin, percent. Turns revenue into gross profit, which
   *  is what makes Net Profit computable. */
  marginPct: number;
  /** Show the event timeline expanded by default. */
  alwaysShowTimeline: boolean;
}

export const DEFAULT_MARGIN_PCT = 40;

/** The largest target a goal may carry. Money and counts only — see
 *  validateSettings for the tighter ceiling on ratios and rates. */
export const MAX_GOAL_TARGET = 1_000_000_000;

/**
 * Default color palette options for metrics. Blue (#3B82F6) is default for all metrics.
 */
export function defaultColorForMetric(_metricKey: string, _index: number = 0): string {
  return "#3B82F6";
}

/** A settings object with every one of the SOURCE's metrics present and nothing
 *  enabled — the starting point the goal-settings modal edits. */
export function emptySettings(
  period: string,
  connector: string,
  metrics: GoalMetricDef[],
): SmartGoalsSettings {
  return {
    connector,
    period,
    goals: metrics.map((m, i) => ({
      metric: m.key,
      enabled: false,
      order: i,
      color: defaultColorForMetric(m.key, i),
      target: null,
      auto: !!m.derivedFrom,
    })),
    aiFocus: null,
    marginPct: DEFAULT_MARGIN_PCT,
    // On by default for a fresh set of goals — the client wants the event
    // timeline expanded when goals are first created. An existing saved set
    // keeps whatever it was saved with.
    alwaysShowTimeline: true,
  };
}

/**
 * One row per metric the SOURCE has, carrying whatever was saved for it.
 *
 * Built from the source rather than from the saved goals, because the two
 * drift: a metric an admin registers after these goals were saved has no stored
 * goal and would never appear, and a metric since retired has a stored goal
 * that can no longer be filled in. The source is the authority on what CAN be
 * tracked; the saved config only says what IS.
 */
export function goalRowsFor(settings: SmartGoalsSettings, metrics: GoalMetricDef[]): GoalConfig[] {
  return metrics
    .map((m, i) => {
      const saved = settings.goals.find((g) => g.metric === m.key);
      const fallbackColor = defaultColorForMetric(m.key, i);
      if (!saved) {
        return {
          metric: m.key,
          enabled: false,
          order: 1000 + i,
          color: fallbackColor,
          target: null,
          auto: !!m.derivedFrom,
        };
      }
      return {
        ...saved,
        color: saved.color ?? fallbackColor,
      };
    })
    .sort((a, b) => a.order - b.order);
}

/** The goals to show, in the admin's order, enabled ones only. */
export function activeGoals(settings: SmartGoalsSettings): GoalConfig[] {
  return [...settings.goals].filter((g) => g.enabled).sort((a, b) => a.order - b.order);
}

/** The goal the AI focuses on. Falls back to the first enabled goal when the
 *  user hasn't chosen one, per the spec — never to nothing, so downstream
 *  features always have a subject. */
export function resolveAiFocus(settings: SmartGoalsSettings): string | null {
  const active = activeGoals(settings);
  if (settings.aiFocus && active.some((g) => g.metric === settings.aiFocus))
    return settings.aiFocus;
  return active[0]?.metric ?? null;
}

// ─── Periods ─────────────────────────────────────────────────────────────────

export type PeriodKind = "month" | "year";

/** Does this string name a period at all? For callers holding something from
 *  a URL or storage, where the answer decides a fallback rather than an error. */
export function isPeriod(period: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period) || /^\d{4}$/.test(period);
}

/** Which shape a period key has. Anything else is rejected rather than guessed
 *  at: an unparseable period would otherwise silently become "the year 0". */
export function periodKind(period: string): PeriodKind {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return "month";
  if (/^\d{4}$/.test(period)) return "year";
  throw new Error(`Unsupported period "${period}" — expected YYYY-MM or YYYY`);
}

/**
 * The last N days, ending today — the optimizer's default analysis window.
 *
 * A goal is set on a calendar month, but an account cannot be judged on one:
 * opened on the 2nd, a month-to-date window has two days of data deciding
 * every recommendation on the page. Ninety days is enough for the slower
 * signals (lost impression share, keyword waste) to mean something.
 *
 * Same UTC half-open basis as periodRange, so the two are interchangeable
 * wherever a range is wanted.
 */
export function lastNDaysRange(days: number, now: Date): { start: Date; endExclusive: Date } {
  const endExclusive = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return { start: new Date(endExclusive.getTime() - days * 86_400_000), endExclusive };
}

/** Inclusive start / exclusive end, in UTC — the same basis the dashboard's
 *  date handling uses, so a goal period and a data range line up. */
export function periodRange(period: string): { start: Date; endExclusive: Date } {
  if (periodKind(period) === "month") {
    const [y, m] = period.split("-").map(Number);
    return { start: new Date(Date.UTC(y, m - 1, 1)), endExclusive: new Date(Date.UTC(y, m, 1)) };
  }
  const y = Number(period);
  return { start: new Date(Date.UTC(y, 0, 1)), endExclusive: new Date(Date.UTC(y + 1, 0, 1)) };
}

/** How many buckets the period holds: days for a month, months for a year.
 *  This is the x-axis of the progress chart and the denominator of pacing. */
export function periodBucketCount(period: string): number {
  if (periodKind(period) === "year") return 12;
  const { start, endExclusive } = periodRange(period);
  return Math.round((endExclusive.getTime() - start.getTime()) / 86_400_000);
}

/** A period is completed once it is entirely in the past. "Now" is passed in
 *  rather than read, so every caller — and every test — agrees on it. */
export function isPeriodCompleted(period: string, now: Date): boolean {
  return now.getTime() >= periodRange(period).endExclusive.getTime();
}

export function isPeriodFuture(period: string, now: Date): boolean {
  return now.getTime() < periodRange(period).start.getTime();
}

export interface PeriodProgress {
  kind: PeriodKind;
  completed: boolean;
  future: boolean;
  /** Buckets in the period, and how many of them have finished. */
  totalBuckets: number;
  elapsedBuckets: number;
  bucketsRemaining: number;
  /** How far through the period we are, 0–1. A completed period is 1. */
  elapsedFraction: number;
}

/** Where in the period "now" falls. Elapsed counts FINISHED buckets — being
 *  part-way through day 5 means 4 days of data are complete, which is the
 *  honest denominator for "what should we have by now". */
export function periodProgress(period: string, now: Date): PeriodProgress {
  const kind = periodKind(period);
  const { start } = periodRange(period);
  const totalBuckets = periodBucketCount(period);
  const completed = isPeriodCompleted(period, now);
  const future = isPeriodFuture(period, now);

  let elapsedBuckets: number;
  if (completed) elapsedBuckets = totalBuckets;
  else if (future) elapsedBuckets = 0;
  else if (kind === "month")
    elapsedBuckets = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  else elapsedBuckets = now.getUTCMonth();

  return {
    kind,
    completed,
    future,
    totalBuckets,
    elapsedBuckets,
    bucketsRemaining: Math.max(0, totalBuckets - elapsedBuckets),
    elapsedFraction: totalBuckets > 0 ? elapsedBuckets / totalBuckets : 0,
  };
}

/**
 * Where in the period today falls, in words.
 *
 * "Day 18 of 31 · Week 3 · 13 days remaining" — the same sentence a media
 * buyer says out loud, and the thing that decides whether a number is alarming
 * or just early. A period that is over or hasn't started says so instead of
 * quoting a day nobody is on.
 */
export function periodPositionText(p: PeriodProgress): string {
  const unit = p.kind === "month" ? "day" : "month";
  if (p.future) return `Not started · ${p.totalBuckets} ${unit}s ahead`;
  if (p.completed) return `Complete · all ${p.totalBuckets} ${unit}s in`;

  // elapsedBuckets counts CLOSED buckets, so today is the one after them.
  const current = Math.min(p.elapsedBuckets + 1, p.totalBuckets);
  // Counted AFTER today, so the sentence adds up: day 18 of 31 leaves 13. Not
  // bucketsRemaining, which counts today as still to come because pacing needs
  // it that way — the two mean different things and only one of them is being
  // read next to "of 31".
  const remaining = p.totalBuckets - current;
  const parts = [`${p.kind === "month" ? "Day" : "Month"} ${current} of ${p.totalBuckets}`];
  if (p.kind === "month") parts.push(`Week ${Math.ceil(current / 7)}`);
  parts.push(`${remaining} ${unit}${remaining === 1 ? "" : "s"} remaining`);
  return parts.join(" · ");
}

// ─── Targets ─────────────────────────────────────────────────────────────────

/** The inputs an Auto target is computed from — the manual targets it depends
 *  on, plus the margin. */
/** The target a goal is actually judged against: the user's number, or the
 *  derived one when it's on Auto. Derived targets are computed from the
 *  SOURCE's own revenue and cost goals — a source that has neither can't offer
 *  Auto at all (see goalMetricsFor). */
export function effectiveTarget(
  goal: GoalConfig,
  settings: SmartGoalsSettings,
  metrics: GoalMetricDef[],
): number | null {
  const def = goalMetricDefIn(metrics, goal.metric);
  if (!goal.auto || !def?.derivedFrom) return goal.target;
  const manual = (key: string) => {
    const g = settings.goals.find((x) => x.metric === key);
    return g && g.enabled ? g.target : null;
  };
  return derivedTarget(goal.metric, {
    revenue: manual("revenue"),
    cost: manual("cost"),
    marginPct: settings.marginPct,
  });
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface SettingsValidation {
  /** Per-metric messages, keyed by metric. Empty when that goal is fine. */
  errors: Record<string, string>;
  /** Reasons the whole configuration can't be saved. */
  formErrors: string[];
  canSave: boolean;
}

/**
 * What blocks a save. Two distinct kinds: a goal with a nonsensical target
 * (the spec's examples are a $0 budget and a 0% ROAS), and a configuration
 * that isn't usable at all — nothing enabled, so there is nothing to track.
 *
 * A missing AI focus is deliberately NOT an error: the spec says the first
 * goal stands in when none is chosen (see resolveAiFocus).
 */
export function validateSettings(
  settings: SmartGoalsSettings,
  metrics: GoalMetricDef[],
): SettingsValidation {
  const errors: Record<string, string> = {};
  const active = activeGoals(settings);

  for (const goal of active) {
    const def = goalMetricDefIn(metrics, goal.metric);
    // A goal on a metric this source doesn't have — left over from a source
    // whose admin config changed. Named rather than ignored, so it can be
    // turned off instead of silently blocking every save.
    if (!def) {
      errors[goal.metric] = `${goal.metric} isn't a metric this source has any more`;
      continue;
    }
    const target = effectiveTarget(goal, settings, metrics);
    if (target === null) {
      errors[goal.metric] = goal.auto
        ? `${def.label} is set to Auto — enable Revenue and Cost with targets to compute it`
        : `${def.label} needs a target`;
      continue;
    }
    if (!Number.isFinite(target)) {
      errors[goal.metric] = `${def.label} target must be a number`;
      continue;
    }
    // A profit goal can legitimately be negative — a loss-making month is still
    // a real plan. Everything else has to be above zero.
    const mayBeNegative = def.key === "profit" || def.key === "net_profit";
    if (target <= 0 && !mayBeNegative) errors[goal.metric] = `${def.label} target must be above 0`;
    // A ceiling, because there wasn't one: a twelve-digit target saved happily
    // and every pace figure computed against it afterwards was meaningless.
    // Ratios and rates get a much lower one — nothing real is 1000x or 5000%.
    const ceiling = def.format === "ratio" || def.format === "percent" ? 10_000 : MAX_GOAL_TARGET;
    if (Math.abs(target) > ceiling)
      errors[goal.metric] =
        `${def.label} target is too large — keep it under ${ceiling.toLocaleString("en-US")}`;
  }

  const formErrors: string[] = [];
  if (active.length === 0) formErrors.push("Enable at least one goal");
  if (settings.marginPct < 0 || settings.marginPct > 100)
    formErrors.push("Average product margin must be between 0 and 100%");

  return {
    errors,
    formErrors,
    canSave: Object.keys(errors).length === 0 && formErrors.length === 0,
  };
}

// ─── Attainment, pacing and status ───────────────────────────────────────────

/**
 * How full a goal's progress bar is: the plain share of the target reached.
 *
 * Not direction-aware, deliberately. The bar answers "how far along", and for
 * a cost goal that is how much of the budget has been spent — $214 of $500 is
 * 43% of the way there whether spending more is good or bad. It used to show
 * the attainment figure, which is inverted for a lower-is-better goal, so the
 * bar was full at $214 of $500 and part-full at $652 of $500. Whether the
 * number is good news is the colour's job, and the word beside it.
 */
export function progressFill(actual: number, target: number): number {
  if (!Number.isFinite(actual) || !Number.isFinite(target) || target === 0) return 0;
  return Math.max(0, Math.min(100, (actual / target) * 100));
}

/**
 * How much of the goal is done, as a percentage, in a form that reads the same
 * for both directions: 100 means exactly on target, above 100 is better than
 * asked for. For a Budget goal — where the aim is to stay within the number —
 * that means spending less scores higher.
 */
export function attainmentPct(def: GoalMetricDef, actual: number, target: number): number {
  if (def.direction === "lower") {
    if (actual <= 0) return target > 0 ? Infinity : 100;
    return (target / actual) * 100;
  }
  if (target === 0) return actual > 0 ? Infinity : 100;
  return (actual / target) * 100;
}

/** The share of the target that should be reached by now for the goal to be on
 *  pace. Only cumulative goals have one — an average metric like ROAS is
 *  supposed to sit at its target from day one, not build up to it. */
export function expectedByNow(
  def: GoalMetricDef,
  target: number,
  progress: PeriodProgress,
): number {
  return def.accumulation === "cumulative" ? target * progress.elapsedFraction : target;
}

export type PaceState = "ahead" | "on_track" | "behind";
export type ResultState = "exceeded" | "achieved" | "near" | "below";

export interface ActiveGoalStatus {
  kind: "pace";
  metric: string;
  actual: number;
  target: number;
  /** Progress toward the full-period target, percent. */
  progressPct: number;
  /** Where the goal should be by now, in the metric's own units. */
  expected: number;
  /** How far ahead (+) or behind (−) that expectation, percent. Null for the
   *  average metrics, which have no pace to be ahead of. */
  pacePct: number | null;
  state: PaceState;
  /** Counted by the health score: pacing at or above expectation. */
  onTrack: boolean;
  bucketsRemaining: number;
}

export interface CompletedGoalStatus {
  kind: "result";
  metric: string;
  actual: number;
  target: number;
  /** Final attainment, percent — direction-aware (see attainmentPct). */
  attainmentPct: number;
  state: ResultState;
  /** Counted by the health score: the goal was met. */
  achieved: boolean;
}

export type GoalStatus = ActiveGoalStatus | CompletedGoalStatus;

/** Attainment bands for a finished period. Fixed for the MVP; the spec notes
 *  they may become configurable later. */
export const RESULT_THRESHOLDS = { achieved: 100, near: 90 } as const;

/** Being within this much of the expected pace still counts as "on track"
 *  rather than "behind" — without it, a goal a fraction of a percent off its
 *  line would read as failing all month. */
const PACE_TOLERANCE_PCT = 2;

/** How far ahead of pace a goal has to be before it reads as "ahead" rather
 *  than simply on track. */
const PACE_AHEAD_PCT = 5;

/**
 * Judge one goal. Which vocabulary comes back is decided by the period, not by
 * the caller: an active period only ever produces pacing, a completed one only
 * ever produces a result. The spec is explicit that they must never cross.
 */
export function goalStatus(args: {
  /** The metric's definition FOR THIS SOURCE — how it accumulates and which way
   *  is good both come from the source's own catalogue. */
  def: GoalMetricDef;
  actual: number;
  target: number;
  progress: PeriodProgress;
}): GoalStatus {
  const { def, actual, target, progress } = args;
  const metric = def.key;

  if (progress.completed) {
    const pct = attainmentPct(def, actual, target);
    const state: ResultState =
      pct > RESULT_THRESHOLDS.achieved
        ? "exceeded"
        : pct === RESULT_THRESHOLDS.achieved
          ? "achieved"
          : pct >= RESULT_THRESHOLDS.near
            ? "near"
            : "below";
    return {
      kind: "result",
      metric,
      actual,
      target,
      attainmentPct: pct,
      state,
      achieved: pct >= RESULT_THRESHOLDS.achieved,
    };
  }

  const expected = expectedByNow(def, target, progress);
  const progressPct = attainmentPct(def, actual, target);
  // Nothing has finished yet, so there is nothing to be ahead or behind of.
  const measurable = progress.elapsedBuckets > 0 && expected !== 0;
  const pacePct = measurable ? attainmentPct(def, actual, expected) - 100 : null;
  const state: PaceState =
    pacePct === null || Math.abs(pacePct) <= PACE_TOLERANCE_PCT
      ? "on_track"
      : pacePct >= PACE_AHEAD_PCT
        ? "ahead"
        : pacePct > 0
          ? "on_track"
          : "behind";

  return {
    kind: "pace",
    metric,
    actual,
    target,
    progressPct,
    expected,
    pacePct,
    state,
    // A goal with no elapsed time yet is not failing — treat it as on track
    // until there is something to judge.
    onTrack: state !== "behind",
    bucketsRemaining: progress.bucketsRemaining,
  };
}

// ─── Health score ────────────────────────────────────────────────────────────

export interface HealthLabel {
  /** Machine-readable band, for styling. */
  band: "excellent" | "good" | "mixed" | "poor" | "critical";
  icon: string;
  text: string;
}

/** The five bands, in the two vocabularies. Progress-shaped labels are only
 *  ever used while a period runs; outcome-shaped ones only once it's over. */
const ACTIVE_LABELS: { min: number; label: HealthLabel }[] = [
  { min: 80, label: { band: "excellent", icon: "🎯", text: "Excellent progress" } },
  { min: 60, label: { band: "good", icon: "✓", text: "On track" } },
  { min: 40, label: { band: "mixed", icon: "⚠️", text: "Needs attention" } },
  { min: 20, label: { band: "poor", icon: "🔶", text: "Action required" } },
  { min: 0, label: { band: "critical", icon: "🚨", text: "Critical risk" } },
];

const COMPLETED_LABELS: { min: number; label: HealthLabel }[] = [
  { min: 80, label: { band: "excellent", icon: "✅", text: "Excellent results" } },
  { min: 60, label: { band: "good", icon: "✓", text: "Good results" } },
  { min: 40, label: { band: "mixed", icon: "📊", text: "Moderate results" } },
  { min: 20, label: { band: "poor", icon: "📉", text: "Weak results" } },
  { min: 0, label: { band: "critical", icon: "⚠️", text: "Poor results" } },
];

export interface HealthSummary {
  /** Goals on track (active) or achieved (completed), out of the active total. */
  met: number;
  total: number;
  scorePct: number;
  label: HealthLabel;
  /** The line under the score: "3 / 5 goals on track" or "… achieved". */
  summaryText: string;
}

/** The account-level read on a period. With no active goals there is nothing
 *  to score, so it reports zero rather than dividing by it. */
export function healthSummary(statuses: GoalStatus[], completed: boolean): HealthSummary {
  const total = statuses.length;
  const met = statuses.filter((s) => (s.kind === "result" ? s.achieved : s.onTrack)).length;
  const scorePct = total > 0 ? (met / total) * 100 : 0;
  const table = completed ? COMPLETED_LABELS : ACTIVE_LABELS;
  const label = (table.find((t) => scorePct >= t.min) ?? table[table.length - 1]).label;
  return {
    met,
    total,
    scorePct,
    label,
    summaryText: `${met} / ${total} goals ${completed ? "achieved" : "on track"}`,
  };
}

// ─── Carrying goals into a new period ────────────────────────────────────────

/**
 * What a period's settings should be when nobody has configured it yet: the
 * previous period's, targets, AI focus and all. Anything the user set ahead of
 * time wins — the spec calls this out specifically, since pre-planning a month
 * only works if the roll-over can't overwrite it.
 *
 * Returns null when there is nothing to carry, which is what puts the empty
 * state on screen.
 */
export function carryForward(
  period: string,
  connector: string,
  existing: SmartGoalsSettings | null,
  previous: SmartGoalsSettings | null,
): SmartGoalsSettings | null {
  if (existing) return existing;
  if (!previous) return null;
  // Stamped with the period AND source being asked for: a row stored before
  // goals became per-source carries whatever connector it was saved with.
  return { ...previous, period, connector, goals: previous.goals.map((g) => ({ ...g })) };
}

/**
 * A year's goals, worked out from the months inside it.
 *
 * Without this, flipping to the yearly view demanded a whole second set of
 * goals — the months said nothing about the year, so the year came up empty and
 * had to be filled in again. Someone who has said what a month should look like
 * has already said what the year should look like.
 *
 * A cumulative target (revenue, spend, conversions) is the monthly commitment
 * carried across the year: the average of the months that have one, times
 * twelve. A rate (ROAS, CTR, cost per conversion) doesn't accumulate — aiming
 * at 4x every month is aiming at 4x for the year — so it is the average as it
 * stands. Which of the two a metric is comes from the source's own definition,
 * so an admin-registered metric rolls up by its declared format.
 *
 * The months that carry no target contribute nothing rather than counting as
 * zero, which would drag every target down by however little of the year has
 * been planned.
 */
export function rollUpMonthsToYear(
  year: string,
  connector: string,
  months: SmartGoalsSettings[],
  metrics: GoalMetricDef[],
): SmartGoalsSettings | null {
  if (months.length === 0) return null;
  // The most recently planned month decides the shared settings and the order
  // goals appear in — it is the closest thing to what the user last intended.
  const latest = [...months].sort((a, b) => a.period.localeCompare(b.period)).at(-1)!;
  const goals: GoalConfig[] = [];

  for (const g of latest.goals) {
    const def = goalMetricDefIn(metrics, g.metric);
    if (!def) continue;
    const enabled = months.some((m) => m.goals.find((x) => x.metric === g.metric)?.enabled);
    if (!enabled) continue;

    // A goal the system derives stays derived: its target is computed from the
    // year's other goals, not rolled up from the months'.
    const auto = months.some((m) => m.goals.find((x) => x.metric === g.metric)?.auto);
    if (auto) {
      goals.push({
        metric: g.metric,
        enabled: true,
        order: g.order,
        color: g.color,
        target: null,
        auto: true,
      });
      continue;
    }

    const set = months
      .map((m) => m.goals.find((x) => x.metric === g.metric))
      .filter((x): x is GoalConfig => !!x?.enabled && typeof x.target === "number" && x.target > 0)
      .map((x) => x.target as number);
    if (set.length === 0) continue;

    const mean = set.reduce((a, b) => a + b, 0) / set.length;
    const target =
      def.accumulation === "cumulative" ? Math.round(mean * 12) : Math.round(mean * 1e6) / 1e6;
    goals.push({
      metric: g.metric,
      enabled: true,
      order: g.order,
      color: g.color,
      target,
      auto: false,
    });
  }

  if (goals.length === 0) return null;
  return {
    connector,
    period: year,
    goals,
    aiFocus: latest.aiFocus,
    marginPct: latest.marginPct,
    alwaysShowTimeline: latest.alwaysShowTimeline,
  };
}

/**
 * One month's share of a year's goals — the same reasoning, inverted.
 *
 * Whoever sets a yearly target has said what a month should look like too, so
 * the monthly view is not empty just because the goals were entered on the
 * year. A cumulative target is split twelve ways; a rate applies to every month
 * as it stands.
 *
 * The split is even. Seasonality is real, and someone who wants December to
 * carry more than February can set that month directly — a guess at the shape
 * of their year would be the system inventing a plan nobody asked for.
 */
export function splitYearToMonth(
  month: string,
  connector: string,
  year: SmartGoalsSettings | null,
  metrics: GoalMetricDef[],
): SmartGoalsSettings | null {
  if (!year) return null;
  const goals: GoalConfig[] = [];
  for (const g of year.goals) {
    const def = goalMetricDefIn(metrics, g.metric);
    if (!def || !g.enabled) continue;
    if (g.auto) {
      goals.push({ ...g, target: null });
      continue;
    }
    if (typeof g.target !== "number" || g.target <= 0) continue;
    const target =
      def.accumulation === "cumulative" ? Math.round((g.target / 12) * 1e6) / 1e6 : g.target;
    goals.push({
      metric: g.metric,
      enabled: true,
      order: g.order,
      color: g.color,
      target,
      auto: false,
    });
  }
  if (goals.length === 0) return null;
  return {
    connector,
    period: month,
    goals,
    aiFocus: year.aiFocus,
    marginPct: year.marginPct,
    alwaysShowTimeline: year.alwaysShowTimeline,
  };
}

/** Every month of a year, as periods — what a year's goals are rolled up from. */
export function monthsOfYear(year: string): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

/** The period immediately before this one, in the same shape. */
export function previousPeriod(period: string): string {
  if (periodKind(period) === "year") return String(Number(period) - 1);
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The period a date falls in. */
export function periodFor(date: Date, kind: PeriodKind): string {
  return kind === "year"
    ? String(date.getUTCFullYear())
    : `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Switching what a period means, without losing where you were.
 *
 * A period is either a month looked at day by day, or a year looked at month
 * by month — so switching between them has to translate the selection rather
 * than reset it. Going yearly shows the year containing the month you were on;
 * coming back returns to that same month, in whichever year is then selected.
 *
 * Rebuilding the month from the year alone always produced January, which is
 * how someone glancing at the yearly view lost the month they were working on.
 *
 * @param to the kind being switched to
 * @param current the period showing now
 * @param remembered the month last looked at, used to come back to it
 */
export function switchPeriodKind(to: PeriodKind, current: string, remembered: string): string {
  if (to === "year") return current.slice(0, 4);
  return `${current.slice(0, 4)}-${remembered.slice(5, 7)}`;
}
