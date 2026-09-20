"use client";

import React, { useEffect, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GoalMetricDef } from "@/lib/smartGoalMetrics";
import type { SeriesPoint } from "@/lib/smartGoalsData";
import { formatMetric, formatBucket } from "./format";
import HelpTip from "./HelpTip";

// The goal's progress over the period.
//
// A cumulative goal is drawn as a filled run-up from zero with a dashed pace
// line beside it — where it would have to be, day by day, to land on target. An
// average goal (ROAS) gets neither: it's plotted from the first bucket with
// data against a flat target line, because there is no accumulating to an
// average.

/** Week boundaries in a daily view, quarter boundaries in a monthly one — the
 *  vertical markers that let a swing be tied to a part of the calendar. */
function boundaryMarkers(points: SeriesPoint[], daily: boolean) {
  const out: { index: number; label: string }[] = [];
  if (daily) {
    for (const p of points) {
      const d = new Date(`${p.key}T00:00:00Z`);
      // Monday starts a week.
      if (d.getUTCDay() === 1) out.push({ index: p.index, label: `W${isoWeek(d)}` });
    }
  } else {
    for (const p of points) {
      const month = Number(p.key.slice(5, 7));
      if (month % 3 === 1) out.push({ index: p.index, label: `Q${Math.floor(month / 3) + 1}` });
    }
  }
  return out;
}

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** True on phone-width screens. The chart draws a tick per day, which is
 *  readable at desktop width and an unreadable smear at 390px. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return narrow;
}

const isWeekend = (key: string) => {
  const day = new Date(`${key}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
};

// Recharts hands a tick renderer its own loosely-typed props bag; only the
// three fields used here are read out of it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AxisTick({ x, y, payload, daily }: any) {
  const key = String(payload?.value ?? "");
  if (!key) return null;
  // Weekends are blue, weekdays grey — it makes a weekly rhythm readable at a
  // glance without another legend.
  const fill = daily && isWeekend(key) ? "#2563eb" : "#9CA3AF";
  const label = daily ? key.slice(8).replace(/^0/, "") : formatBucket(key);
  return (
    <text
      x={Number(x) || 0}
      y={(Number(y) || 0) + 14}
      textAnchor="middle"
      fontSize={11}
      fill={fill}
    >
      {label}
    </text>
  );
}

/**
 * Where the plot area sits inside this card, in pixels.
 *
 * The y-axis gutter plus the chart margin — everything to the left of the
 * first data point. The event timeline underneath reads these so its dates
 * land under the chart's, rather than being eyeballed to something close.
 */
export const CHART_INSET = { left: 50, leftNarrow: 38, right: 18 } as const;

export default function GoalProgressChart({
  def,
  points,
  target,
  daily,
  hoverKey,
  onHoverKey,
  accent = "#3B82F6",
  bare,
}: {
  def: GoalMetricDef;
  points: SeriesPoint[];
  target: number | null;
  daily: boolean;
  /** The bucket the pointer is over — shared with the timeline so both show the
   *  same day at the same x position. */
  hoverKey: string | null;
  onHoverKey: (key: string | null) => void;
  accent?: string;
  /** Skip the card's own background/border/padding — the caller supplies it,
   *  because the timeline shares this card rather than getting its own. */
  bare?: boolean;
}) {
  const cumulative = def.accumulation === "cumulative";
  const narrow = useNarrow();
  // Every day fits at desktop width; on a phone show roughly a tick a week so
  // the labels stay legible instead of overlapping into a smear.
  const tickInterval = narrow && points.length > 12 ? Math.ceil(points.length / 5) : 0;
  const markers = boundaryMarkers(points, daily);
  // The y range, hugging what is actually drawn.
  //
  // Left to itself Recharts rounds the domain outward to a "nice" number, so
  // one early month at a small loss opened a band down to -$300K under a chart
  // whose data lived between 0 and $600K — most of the panel spent on empty
  // space below the axis. Zero is always included, so a normal positive chart
  // still sits on its baseline.
  const yValues = points
    .flatMap((p) => [p.value, p.pace])
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (target !== null && Number.isFinite(target)) yValues.push(target);
  const yLo = Math.min(0, ...yValues);
  const yHi = Math.max(0, ...yValues);
  const yPad = (yHi - yLo) * 0.06 || 1;
  const yDomain: [number, number] = [yLo < 0 ? yLo - yPad : 0, yHi + yPad];
  const hasData = points.some((p) => p.value !== null && p.value !== 0);

  return (
    <div className={bare ? "" : "bg-white rounded-2xl border border-gray-200 p-4 sm:p-5"}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[20px] font-bold text-[#101828] tracking-[-0.0225em]">
              {def.label} Progress Chart
            </h2>
            <HelpTip title="Goal progress over time">
              The filled area is what the account has actually done; the dashed line is where it
              needs to be to finish on target.
            </HelpTip>
          </div>
          <p className="text-[14px] text-[#4A5565] tracking-[-0.0195em] mt-0.5">
            Click on any goal above to switch the chart view.
          </p>
        </div>
      </div>

      <div className="h-[300px] sm:h-[420px] relative">
        {!hasData && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <p className="text-[13px] text-gray-400">
              No {def.label.toLowerCase()} in this period yet.
            </p>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            key={def.key}
            data={points}
            // 18 at the top, not 8: the week/quarter markers draw their label
            // above the plot area, and 8px cut every one of them in half.
            // …and 18 on the right, where the last marker's label is centred on
            // the plot's edge and half of it fell outside.
            margin={{ top: 18, right: 18, left: -12, bottom: 4 }}
            onMouseMove={(state) => {
              // Recharts' mouse state isn't typed with its payload, so the
              // hovered bucket is read defensively.
              const payload = (state as unknown as { activePayload?: { payload?: SeriesPoint }[] })
                .activePayload;
              const key = payload?.[0]?.payload?.key;
              if (key) onHoverKey(key);
            }}
            onMouseLeave={() => onHoverKey(null)}
          >
            <CartesianGrid vertical={false} strokeDasharray="4 3" stroke="#F3F4F6" />
            <XAxis
              dataKey="key"
              interval={tickInterval}
              tick={(p) => <AxisTick {...p} daily={daily} />}
              axisLine={{ stroke: "#E5E7EB" }}
              tickLine={false}
              height={26}
            />
            <YAxis
              domain={yDomain}
              // A phone can't spare 62px of gutter for axis labels — that's a
              // fifth of the screen spent on five numbers. Four, closer in.
              tickCount={narrow ? 4 : 5}
              tick={{ fontSize: narrow ? 10 : 11, fill: "#9CA3AF" }}
              axisLine={{ stroke: "#E5E7EB" }}
              tickLine={false}
              tickFormatter={(v: number) => formatMetric(v, def)}
              width={narrow ? 50 : 62}
            />
            <Tooltip
              cursor={{ stroke: "#93C5FD", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as SeriesPoint;
                return (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-md px-2.5 py-2 text-[11px]">
                    <p className="font-semibold text-gray-700 mb-1">{formatBucket(p.key)}</p>
                    <p className="text-gray-600">
                      {def.label}:{" "}
                      <span className="font-semibold">{formatMetric(p.value, def)}</span>
                    </p>
                    {p.pace !== null && cumulative && (
                      <p className="text-gray-400">Pace: {formatMetric(p.pace, def)}</p>
                    )}
                  </div>
                );
              }}
            />

            {/* Period boundaries: weeks in a daily view, quarters in a monthly one. */}
            {(narrow ? markers.filter((_, i) => i % 2 === 0) : markers).map((m) => (
              <ReferenceLine
                key={m.index}
                x={points[m.index]?.key}
                stroke="#E5E7EB"
                strokeDasharray="3 3"
                label={{ value: m.label, position: "top", fontSize: 10, fill: "#9CA3AF" }}
              />
            ))}

            {/* The target itself, so "how far from the line" is readable without
                doing arithmetic against the axis. */}
            {target !== null && (
              <ReferenceLine
                y={target}
                stroke={accent}
                strokeDasharray="2 4"
                strokeOpacity={0.8}
                label={{
                  value: `Goal: ${formatMetric(target, def)}`,
                  position: "top",
                  fill: accent,
                  fontSize: 11,
                  fontWeight: 600,
                  textAnchor: "middle",
                  offset: 6,
                }}
              />
            )}

            <Area
              type="monotone"
              dataKey="value"
              stroke={accent}
              strokeWidth={2.5}
              fill={`${accent}33`}
              fillOpacity={0.5}
              connectNulls={false}
              dot={{ r: 3, fill: accent, stroke: "none" }}
              activeDot={{ r: 5, fill: accent, stroke: "none" }}
              isAnimationActive={true}
              animationDuration={750}
              animationEasing="ease-in-out"
            />
            {/* Only a cumulative goal has a pace to keep; an average one is
                judged against the flat target line above instead. */}
            {cumulative && target !== null && (
              <Line
                type="linear"
                dataKey="pace"
                stroke="#99A1AF"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={true}
                animationDuration={750}
                animationEasing="ease-in-out"
              />
            )}
            {hoverKey && <ReferenceLine x={hoverKey} stroke="#86EFAC" strokeWidth={1} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Named as the spec names them. Three marks on one chart, two of them
          broken lines, was one guess too many without a key. */}
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5 pt-2">
        <span className="flex items-center gap-2 text-[12px] text-gray-500">
          <svg width="20" height="6" aria-hidden>
            <line
              x1="0"
              y1="3"
              x2="20"
              y2="3"
              stroke="#99A1AF"
              strokeWidth="1.5"
              strokeDasharray="5 4"
            />
          </svg>
          Target
        </span>
        <span className="flex items-center gap-2 text-[12px] text-gray-600 font-medium">
          <svg width="20" height="6" aria-hidden>
            {/* The colour picked for this goal in settings, so the key matches
                the line actually drawn — it was hardcoded green while the line
                itself followed the chosen accent. */}
            <line x1="0" y1="3" x2="20" y2="3" stroke={accent} strokeWidth="3" />
          </svg>
          {/* An average metric is not accumulating towards anything, so
              calling its line "Cumulative Progress" described the wrong
              chart. */}
          {cumulative ? "Cumulative Progress" : `${def.label} per ${daily ? "day" : "month"}`}
        </span>
        {target !== null && (
          <span className="flex items-center gap-2 text-[12px] text-gray-500">
            <svg width="20" height="6" aria-hidden>
              <line
                x1="0"
                y1="3"
                x2="20"
                y2="3"
                stroke={accent}
                strokeWidth="1.5"
                strokeDasharray="2 4"
                strokeOpacity="0.8"
              />
            </svg>
            Goal: {formatMetric(target, def)}
          </span>
        )}
      </div>
    </div>
  );
}
