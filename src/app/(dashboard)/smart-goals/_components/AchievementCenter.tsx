"use client";

import React, { useState } from "react";
import { progressFill, type GoalStatus, type HealthSummary } from "@/lib/smartGoals";
import type { GoalMetricDef } from "@/lib/smartGoalMetrics";
import { formatMetric, formatSignedPct } from "./format";
import HelpTip from "./HelpTip";

// The Goal Achievement Center: one health read on the period, then a card per
// goal. Which language a card speaks is decided by the period, not by this
// component — an active period only ever shows pacing, a finished one only ever
// shows the outcome (see goalStatus).

/** Card chrome per health band — the badge on the card, not a per-metric card. */
const BAND_STYLES: Record<
  HealthSummary["label"]["band"],
  { bg: string; border: string; chip: string; title: string; text: string }
> = {
  excellent: {
    bg: "bg-[#ECFDF5]",
    border: "border-[#A4F4CF]",
    chip: "bg-[#D0FAE5]",
    title: "text-[#004F3B]",
    text: "text-[#007A55]",
  },
  good: {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    chip: "bg-emerald-100",
    title: "text-emerald-900",
    text: "text-emerald-700",
  },
  mixed: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    chip: "bg-amber-100",
    title: "text-amber-900",
    text: "text-amber-700",
  },
  poor: {
    bg: "bg-orange-50",
    border: "border-orange-200",
    chip: "bg-orange-100",
    title: "text-orange-900",
    text: "text-orange-700",
  },
  critical: {
    bg: "bg-red-50",
    border: "border-red-200",
    chip: "bg-red-100",
    title: "text-red-900",
    text: "text-red-700",
  },
};

const RESULT_TEXT = {
  exceeded: "Exceeded",
  achieved: "Achieved",
  near: "Near target",
  below: "Below target",
} as const;

// The same four states, said the way a budget reads. "Exceeded" on a cost goal
// meant "you spent less than planned" — the opposite of how anyone reads it.
const RESULT_TEXT_LOWER = {
  exceeded: "Under budget",
  achieved: "On budget",
  near: "Near budget",
  below: "Over budget",
} as const;

const PACE_TEXT = { ahead: "Ahead of pace", on_track: "On track", behind: "Behind pace" } as const;

const PACE_TEXT_LOWER = {
  ahead: "Under pace",
  on_track: "On track",
  behind: "Over pace",
} as const;

/** Which wording a metric's direction calls for. */
function wordsFor(def: GoalMetricDef) {
  const lower = def.direction === "lower";
  return {
    result: lower ? RESULT_TEXT_LOWER : RESULT_TEXT,
    pace: lower ? PACE_TEXT_LOWER : PACE_TEXT,
  };
}

/**
 * Default color palette options for metrics.
 */
export const COLOR_PALETTE = [
  "#10b981", // Blue
  "#EF4444", // Red
  "#8B5CF6", // Purple
  "#009966", // Green
  "#F59E0B", // Amber
  "#0EA5E9", // Sky
];

/**
 * Custom color per metric if configured.
 * Default color is Blue (#10b981) for all metrics unless user picks a custom color.
 */
function accentFor(_def: GoalMetricDef, config?: { color?: string }): string {
  if (config?.color) return config.color;
  return "#10b981";
}

/** The glyph inside the icon chip — from the metric's format, so it still
 *  makes sense on a metric this component has never seen a name for. */
function glyphFor(def: GoalMetricDef): string {
  return def.format === "money"
    ? "$"
    : def.format === "percent"
      ? "%"
      : def.format === "ratio"
        ? "×"
        : "#";
}

/** Met or not, as a mark rather than a sentence — the sentence is still there
 *  on hover, and the pace figure below says how far off it is. */
function StatusMark({ status, def }: { status: GoalStatus; def: GoalMetricDef }) {
  const good = status.kind === "result" ? status.achieved : status.onTrack;
  const words = wordsFor(def);
  return (
    <span
      title={status.kind === "result" ? words.result[status.state] : words.pace[status.state]}
      className={good ? "text-green-600" : "text-red-500"}
    >
      {good ? (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="16 9 11 15 8 12" />
        </svg>
      ) : (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="13" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      )}
    </span>
  );
}

function GoalCard({
  def,
  status,
  isFocus,
  selected,
  draggable,
  accent,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  note,
}: {
  def: GoalMetricDef;
  status: GoalStatus;
  isFocus: boolean;
  selected: boolean;
  draggable: boolean;
  /** This card's hex accent — icon chip, progress fill, glow, selected border. */
  accent: string;
  onSelect: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  /** A short qualifier the number can't carry itself — the margin a net profit
   *  goal was computed at, say. */
  note?: string;
}) {
  const fill = progressFill(status.actual, status.target);
  // The figure beside the bar reads the bar: how much of the target has been
  // used or reached. It used to be the direction-aware attainment figure, so a
  // cost goal at $8.0K of $7.5K reported 94% — under a bar that was full — and
  // $4.7K of $5.0K reported 105% "Exceeded" for money not spent. Whether that
  // is good is what the colour and the word beside it are for.
  const pct =
    status.target === 0 || !Number.isFinite(status.target)
      ? 0
      : (status.actual / status.target) * 100;
  const words = wordsFor(def);
  // Only cumulative metrics in an active period have a pace expectation marker ("should be here by now").
  const isCumulative = def.accumulation === "cumulative";
  const expectedPct =
    isCumulative && status.kind === "pace" && status.target > 0 && status.expected > 0
      ? Math.max(0, Math.min(100, (status.expected / status.target) * 100))
      : null;
  const good = status.kind === "result" ? status.achieved : status.onTrack;
  const barColor = accent || (good ? "#009966" : "#DC2626");
  const statusColor = good ? "#009966" : "#DC2626";

  return (
    <button
      onClick={onSelect}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={selected ? { borderColor: barColor } : undefined}
      className={`relative text-left bg-white rounded-[14px] border p-2.5 sm:p-3 transition w-full ${
        selected ? "shadow-md" : "border-gray-200 shadow-sm hover:border-gray-300"
      }`}
    >
      {/* Pinned to the corner rather than sharing the header row — competing
          with it for width is what truncated the label ("Reven…", "Net P…")
          on the cards carrying a badge too. */}
      <span className="absolute top-2.5 right-2.5 sm:top-3 sm:right-3">
        <StatusMark status={status} def={def} />
      </span>

      {/* flex-wrap, not truncate: the label is the one thing on this card that
          must never be cut short. A badge that doesn't fit drops to its own
          line instead. */}
      <div className="flex flex-wrap items-center gap-x-1.5 sm:gap-x-2 gap-y-1 pr-5 sm:pr-6 mb-2 sm:mb-3">
        <span
          aria-hidden
          className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg sm:rounded-[14px] flex items-center justify-center text-[11px] sm:text-[13px] font-bold shrink-0"
          style={{ background: `${barColor}14`, color: barColor }}
        >
          {glyphFor(def)}
        </span>
        <span className="text-[13px] sm:text-[16px] font-semibold text-[#101828]">{def.label}</span>
        {note && (
          <span className="text-[9px] sm:text-[10px] font-semibold text-gray-400 bg-gray-50 border border-gray-200 rounded px-1 py-0.5">
            {note}
          </span>
        )}
        {isFocus && (
          <span
            title="The AI builds its recommendations around this goal"
            className="text-[9px] sm:text-[10px] font-bold text-violet-700 bg-violet-50 border border-violet-200 rounded px-1 sm:px-1.5 py-0.5"
          >
            AI FOCUS
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-1 sm:gap-2 mb-2 sm:mb-2.5">
        <span className="text-[15px] sm:text-[20px] font-bold text-[#101828] tabular-nums">
          {formatMetric(status.actual, def)}
        </span>
        <span className="text-[11px] sm:text-[14px] tabular-nums shrink-0 text-[#6A7282]">
          of {formatMetric(status.target, def)}
        </span>
      </div>

      <div
        className="relative h-2 sm:h-2.5 bg-gray-200 rounded-full mb-2 sm:mb-2.5"
        style={{ boxShadow: "inset 0 2px 4px 0 rgba(0,0,0,.05)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${fill}%`,
            backgroundColor: barColor,
            boxShadow: `0 0 8px 0 ${barColor}40`,
          }}
        />
        {/* Where the goal should be by now. Without it the bar says how far
            along you are but not whether that is enough — which is the whole
            question mid-period. Left off the average metrics, whose expectation
            is the target itself, so a marker at the end would say nothing. */}
        {expectedPct !== null && (
          <span
            title={`Should be around ${formatMetric(status.kind === "pace" ? status.expected : status.target, def)} by now`}
            className="absolute -top-1 -bottom-1 w-0.5 rounded bg-[#101828]"
            style={{ left: `${expectedPct}%` }}
          />
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] sm:text-[14px]">
        <span className="tabular-nums font-semibold" style={{ color: statusColor }}>
          {Number.isFinite(pct) ? Math.round(pct) : 0}%
        </span>
        {status.kind === "pace" ? (
          <span className="font-medium text-[10px] sm:text-[12px]" style={{ color: statusColor }}>
            {status.pacePct === null || !Number.isFinite(status.pacePct)
              ? words.pace[status.state]
              : `${formatSignedPct(status.pacePct)} pace`}
          </span>
        ) : (
          <span className="font-medium text-[10px] sm:text-[12px]" style={{ color: statusColor }}>
            {words.result[status.state]}
          </span>
        )}
      </div>
    </button>
  );
}

export default function AchievementCenter({
  health,
  statuses,
  metrics,
  goalsConfig,
  aiFocus,
  selected,
  completed,
  onSelect,
  onReorder,
  positionText,
  daysLeftLabel,
  bare,
  marginNote,
}: {
  health: HealthSummary;
  statuses: GoalStatus[];
  /** This source's metric definitions, so each card knows how to read itself. */
  metrics: GoalMetricDef[];
  goalsConfig?: { metric: string; color?: string }[];
  aiFocus: string | null;
  selected: string | null;
  completed: boolean;
  onSelect: (metric: string) => void;
  onReorder: (from: string, to: string) => void;
  /** "Day 18 of 31 · Week 3 · 13 days remaining" — what decides whether a
   *  number is alarming or just early. */
  positionText: string;
  /** "13 days left" — folded into the health badge's own subtitle; empty for a
   *  period that hasn't started or is already over. */
  daysLeftLabel: string;
  /** "40% margin" — what net profit was computed at, which the figure alone
   *  can't say. */
  marginNote?: string;
  /** Skip the card's own background and border — the section header supplies
   *  them, so the tabs and this read as one block rather than two. */
  bare?: boolean;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const band = BAND_STYLES[health.label.band];
  const accents = new Map(
    statuses.map((s) => {
      const def = metrics.find((m) => m.key === s.metric)!;
      const cfg = goalsConfig?.find((g) => g.metric === s.metric);
      return [s.metric, accentFor(def, cfg)];
    }),
  );

  return (
    <div className={bare ? "" : "bg-white rounded-2xl border border-gray-200 p-4 sm:p-5"}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[20px] font-bold text-[#101828] tracking-[-0.0225em]">
              Goals Achievement Center
            </h2>
            <HelpTip title="Track and hit your advertising goals">
              Set monthly targets for the metrics that matter and follow them in real time. Click a
              goal card to see its progress chart. Use Edit Goals to change targets. AI Focus picks
              the one goal recommendations are built around.
            </HelpTip>
          </div>
          {/* No inline "Edit Goals" link here: it duplicated the Edit goals
              button in the section header, which is the one way in. */}
          <p className="text-[14px] text-[#4A5565] mt-0.5">{positionText}</p>
        </div>

        <div
          className={`flex items-center gap-2.5 rounded-2xl border ${band.bg} ${band.border} px-3 py-3`}
        >
          <span
            className={`w-8 h-8 rounded-[14px] flex items-center justify-center text-[15px] shrink-0 ${band.chip}`}
          >
            {health.label.icon}
          </span>
          <div className="min-w-0">
            <p className={`text-[14px] font-bold leading-5 ${band.title}`}>{health.label.text}</p>
            <p className={`text-[12px] leading-4 ${band.text}`}>
              {health.met}/{health.total} goals {completed ? "achieved" : "on track"}
              {daysLeftLabel && ` • ${daysLeftLabel}`}
            </p>
          </div>
        </div>
      </div>

      {/* One row on a wide screen when there are six or fewer — the usual case.
          More than that, or a narrower screen, and they wrap. The column count
          is the goal count so five cards make five columns rather than three
          and an orphan. */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:[grid-template-columns:repeat(var(--goal-cols),minmax(0,1fr))] gap-3"
        style={{ ["--goal-cols" as string]: Math.min(statuses.length, 6) }}
      >
        {statuses.map((s) => (
          <GoalCard
            key={s.metric}
            def={metrics.find((m) => m.key === s.metric)!}
            status={s}
            isFocus={aiFocus === s.metric}
            selected={selected === s.metric}
            accent={accents.get(s.metric)!}
            // Reordering a finished period's cards would imply its goals can
            // still be arranged; they can't.
            draggable={!completed}
            note={s.metric === "net_profit" ? marginNote : undefined}
            onSelect={() => onSelect(s.metric)}
            onDragStart={() => setDragging(s.metric)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragging && dragging !== s.metric) onReorder(dragging, s.metric);
              setDragging(null);
            }}
          />
        ))}
      </div>
    </div>
  );
}
