"use client";

import React from "react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { CategorySummary } from "@/lib/optimizerCategories";
import type { HealthAxis } from "@/lib/accountHealth";

// Where the account is strong and where it isn't, at a glance.
//
// Two things can be drawn here. When the source can answer how the account is
// SET UP — budgets, bidding, ad strength, assets — those are the eight axes
// the design specifies, and they are the ones worth looking at. When it
// cannot, the fallback is one axis per breakdown the source does have, so the
// shape is still the account's own rather than a padded octagon with axes
// drawn at zero for things nobody measured.
//
// An axis that could not be judged is dropped, never drawn at zero: zero is a
// verdict, and silence is not.

const BANDS = [
  {
    from: 80,
    label: "80-100: Excellent",
    color: "#00BC7D",
    pillBg: "#ECFDF5",
    pillText: "#00994D",
  },
  { from: 60, label: "60-79: Good", color: "#FE9A00", pillBg: "#FFFBEB", pillText: "#E17100" },
  { from: 40, label: "40-59: Fair", color: "#FF6900", pillBg: "#FFF7ED", pillText: "#C2410C" },
  { from: 0, label: "0-39: Critical", color: "#FB2C36", pillBg: "#FEF2F2", pillText: "#C10007" },
];

export function bandFor(score: number) {
  return BANDS.find((b) => score >= b.from) ?? BANDS[BANDS.length - 1];
}

// A score on its own says an axis is bad without saying what is bad about it.
// The note carries the finding — "27% of impressions lost to budget caps" —
// which is the part someone can act on.
interface TooltipDatum {
  payload?: { category: string; score: number; note?: string };
}

function AxisTooltip({ active, payload }: { active?: boolean; payload?: TooltipDatum[] }) {
  const d = active ? payload?.[0]?.payload : undefined;
  if (!d) return null;
  const band = bandFor(d.score);
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-3 py-2 max-w-[240px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold text-gray-800">{d.category}</span>
        <span className="text-[12px] font-bold" style={{ color: band.color }}>
          {d.score}
        </span>
      </div>
      {d.note && <p className="text-[11px] text-gray-500 mt-1 leading-snug">{d.note}</p>}
    </div>
  );
}

export default function HealthRadar({
  categories,
  axes,
  legend = true,
}: {
  categories: CategorySummary[];
  axes?: HealthAxis[];
  /** Off for the second of a pair — one band key under both says it once. */
  legend?: boolean;
}) {
  // The setup axes when they could be judged; otherwise the breakdowns.
  const judged = (axes ?? []).filter((a) => a.score !== null);
  const data = judged.length
    ? judged.map((a) => ({ category: a.label, score: a.score as number, note: a.note }))
    : categories
        .filter((c) => c.quietReason !== "no_rows")
        .map((c) => ({ category: c.label, score: c.score, note: "" }));

  // What the source could not answer, so the gaps are stated rather than left
  // as an octagon that quietly became a pentagon.
  const unjudged = (axes ?? []).filter((a) => a.score === null);

  if (data.length < 3)
    return (
      <div className="h-[260px] flex items-center justify-center text-center px-6">
        <p className="text-[13px] text-gray-400 max-w-xs">
          A shape needs at least three sides. This source has{" "}
          {data.length === 0 ? "no breakdowns" : `only ${data.length}`} with data in this period, so
          the scores are listed beside it instead.
        </p>
      </div>
    );

  return (
    <div>
      <div className="h-[260px] sm:h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="#E5E7EB" />
            <PolarAngleAxis
              dataKey="category"
              tick={{ fontSize: 11, fill: "#6B7280" }}
              // Recharts hands the tick its own props bag; the label just needs
              // to stay inside the card on a phone.
            />
            <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#D1D5DB" }} />
            <Radar dataKey="score" stroke="#7F22FE" fill="#AD46FF" fillOpacity={0.45} />
            <Tooltip content={<AxisTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      {legend && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pb-1">
          {BANDS.map((b) => (
            <span key={b.label} className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className="w-2 h-2 rounded-full" style={{ background: b.color }} />
              {b.label}
            </span>
          ))}
        </div>
      )}
      {unjudged.length > 0 && (
        <p className="text-[11px] text-gray-400 text-center px-4 pb-1">
          Not shown: {unjudged.map((a) => a.label).join(", ")} — this source did not report the
          settings behind {unjudged.length === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  );
}
