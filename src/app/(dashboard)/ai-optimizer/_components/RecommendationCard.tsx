"use client";

import React, { useState } from "react";
import {
  formatImpact,
  type Evidence,
  type Priority,
  type Recommendation,
} from "@/lib/optimizerCategories";

// One recommendation, with the rows it was drawn from underneath it.
//
// The evidence table is the point of the card, not decoration: "exclude these
// three regions" is a claim about specific numbers, and someone about to move
// budget on it has to be able to check those numbers first.

const PRIORITY: Record<Priority, { label: string; className: string }> = {
  high: { label: "● HIGH", className: "text-[#C10007] bg-[#FEF2F2]" },
  medium: { label: "● MEDIUM", className: "text-[#A65F00] bg-[#FEFCE8]" },
  low: { label: "● LOW", className: "text-[#047857] bg-[#EFF6FF]" },
};

const KIND_ICON: Record<Recommendation["kind"], string> = {
  wasted_spend: "🔻",
  underperformer: "⚠️",
  scale: "📈",
  weak_conversion: "🎯",
};

function fmt(v: number, format: string): string {
  if (!Number.isFinite(v)) return "—";
  switch (format) {
    case "money":
      return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    case "percent":
      return `${Math.round(v * 100)}%`;
    case "ratio":
      return `${v.toFixed(2)}x`;
    default:
      return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
}

function EvidenceTable({ evidence }: { evidence: Evidence }) {
  return (
    <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/40 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wider">
          AI analysis: data used for this recommendation
        </p>
        {evidence.filter && (
          <p className="text-[10px] font-semibold text-red-500">{evidence.filter}</p>
        )}
      </div>
      {/* Wide tables scroll inside the card rather than widening the page. */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse min-w-[520px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-gray-400">
              {evidence.columns.map((c, i) => (
                <th
                  key={c.key}
                  className={`px-3 py-1.5 font-semibold ${i === 0 ? "text-left" : "text-right"}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {evidence.rows.map((r) => (
              <tr
                key={r.label}
                className={`border-t border-violet-100 ${r.flagged ? "bg-red-50/60" : ""}`}
              >
                {evidence.columns.map((c, i) =>
                  i === 0 ? (
                    <td
                      key={c.key}
                      className={`px-3 py-1.5 truncate max-w-[220px] ${r.flagged ? "font-semibold text-gray-900" : "text-gray-600"}`}
                    >
                      {r.label}
                    </td>
                  ) : (
                    <td
                      key={c.key}
                      className={`px-3 py-1.5 text-right tabular-nums ${r.flagged ? "font-semibold text-gray-900" : "text-gray-600"}`}
                    >
                      {fmt(r.values[c.key] ?? 0, c.format)}
                    </td>
                  ),
                )}
              </tr>
            ))}
            <tr className="border-t border-violet-200 bg-white/70 font-semibold text-gray-800">
              {evidence.columns.map((c, i) => (
                <td
                  key={c.key}
                  className={`px-3 py-1.5 tabular-nums ${i === 0 ? "text-left" : "text-right"}`}
                >
                  {i === 0 ? "TOTAL" : fmt(evidence.total[c.key] ?? 0, c.format)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {evidence.rowCount > evidence.rows.length && (
        <p className="px-3 py-1.5 text-[11px] text-gray-500 border-t border-violet-100">
          Showing first {evidence.rows.length} of {evidence.rowCount.toLocaleString("en-US")} rows —
          open the dashboard for the full set.
        </p>
      )}
      <p className="px-3 py-2 text-[11px] text-violet-900/70 border-t border-violet-100">
        <span className="font-semibold">AI insight:</span> {evidence.insight}
      </p>
    </div>
  );
}

/** Secondary/ghost navigation button: opens the dashboard on this
 *  recommendation's own filters. Deliberately quiet — a way to explore, not a
 *  primary CTA competing with Completed. */
function ExploreButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-2.5 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#4A5565] bg-white border border-gray-200 hover:bg-gray-50 rounded-lg px-3 py-1.5 transition"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M3 3v18h18" />
        <path d="m7 14 4-4 3 3 5-6" />
      </svg>
      Explore in Dashboard
    </button>
  );
}

/** "May 21, 2026" from a YYYY-MM-DD string. */
function fmtDay(d: string): string {
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The blocks shared by an open recommendation and a reopened snapshot: what the
 *  data says now, what it could be, the action, and the evidence behind it. */
function AnalysisBlocks({ rec }: { rec: Recommendation }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <div className="rounded-[10px] bg-[#F9FAFB] border border-[#E5E7EB] px-3 py-2">
          <p className="text-[10px] font-bold text-[#6A7282] uppercase tracking-wider mb-0.5">
            Current state
          </p>
          <p className="text-[12px] text-[#101828] font-medium">{rec.currentState}</p>
        </div>
        <div className="rounded-[10px] bg-[#F9FAFB] border border-[#E5E7EB] px-3 py-2">
          <p className="text-[10px] font-bold text-[#6A7282] uppercase tracking-wider mb-0.5">
            Expected result
          </p>
          <p className="text-[12px] text-[#101828] font-medium">{rec.expectedResult}</p>
        </div>
      </div>

      <div className="mt-2.5 rounded-[10px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5">
        <p className="text-[12px] text-[#364153]">
          <span className="font-semibold text-[#101828]">⚡ Action:</span> {rec.action}
        </p>
      </div>

      {rec.evidence && <EvidenceTable evidence={rec.evidence} />}
    </>
  );
}

export default function RecommendationCard({
  rec,
  impactLabel,
  impactFormat,
  denomDays,
  state,
  stateAt,
  analysisPeriod,
  onDismiss,
  onComplete,
  onRestore,
  onOpenAnalytics,
  onExplore,
}: {
  rec: Recommendation;
  impactLabel: string;
  /** Money or a plain count — an impact stated in conversions must not print
   *  with a dollar sign. */
  impactFormat: "money" | "number";
  /** Days of data in the analysis window. When set, the (cumulative) impact is
   *  normalised to a month ((impact / denomDays) × 30) and shown with "/ mo.", so
   *  the card's headline potential matches the monthly figure elsewhere instead
   *  of the full-window total. Omitted (history snapshots) → the raw figure. */
  denomDays?: number;
  state?: "completed" | "dismissed";
  stateAt?: string;
  /** The window the analysis was run over, shown on a reopened snapshot. */
  analysisPeriod?: { from: string; to: string };
  onDismiss: () => void;
  onComplete: () => void;
  onRestore: () => void;
  /** Open the source's dashboard scoped to exactly this recommendation's data
   *  (same period, level and values). Absent = the button isn't shown. */
  onOpenAnalytics?: () => void;
  /** Reopen the dashboard on this snapshot's stored period + filters (history
   *  tabs). Absent = the button isn't shown. */
  onExplore?: () => void;
}) {
  const p = PRIORITY[rec.priority];
  // Normalise the potential to a month so the card reads the SAME basis as the
  // headline/list ("+$X / mo.") instead of the full analysis-window total. The
  // recommendation TEXT keeps the real window figures (spend, revenue); only
  // this one "potential" number is the monthly projection.
  const monthly = typeof denomDays === "number" && denomDays > 0;
  const impactValue = monthly ? (rec.impact / denomDays) * 30 : rec.impact;
  const impact = formatImpact(impactValue, impactFormat === "money" ? "revenue" : "conv");
  const impactSuffix = monthly ? " / mo." : "";
  const [analysisOpen, setAnalysisOpen] = useState(false);

  if (state === "completed" || state === "dismissed") {
    const isComp = state === "completed";
    return (
      <div
        className={`p-4 border rounded-[10px] my-3 mx-4 sm:mx-5 transition ${
          isComp ? "bg-[rgba(240,253,244,0.3)] border-[#7BF1A8]" : "bg-gray-50/70 border-gray-200"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div
              className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 border ${
                isComp
                  ? "bg-white border-[#00A63E] text-[#00A63E]"
                  : "bg-white border-gray-300 text-gray-400"
              }`}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6A7282]">
                  {KIND_ICON[rec.kind]} {rec.categoryLabel ?? "RECOMMENDATION"}
                </span>
              </div>
              <p className="text-[14px] font-semibold text-[#101828]">{rec.title}</p>
              <p className="text-[12px] text-[#6A7282] mt-0.5">{rec.detail}</p>
              {rec.impact > 0 && (
                <p className="text-[12px] font-medium text-[#008236] mt-1">
                  Impact: +{impact}
                  {impactSuffix} {impactLabel.toLowerCase()} potential
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end justify-between gap-3 shrink-0">
            <span className="text-[12px] font-medium text-[#008236]">
              {isComp ? "Completed" : "Dismissed"}
              {stateAt ? ` ${stateAt}` : ""}
            </span>
            <button
              onClick={onRestore}
              className="px-3.5 py-1 text-[12px] font-semibold text-[#059669] bg-[#EFF6FF] border border-[#BEDBFF] rounded-lg hover:bg-emerald-100 transition"
            >
              Restore
            </button>
          </div>
        </div>

        {/* The full analysis, frozen at the time it was marked. Kept behind a
            link so the history reads as a list until you open one — then it is
            the same analysis the recommendation showed, months later. */}
        <div className="mt-2 pl-9">
          <button
            onClick={() => setAnalysisOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#8200DB] hover:underline"
          >
            {analysisOpen ? "Hide analysis" : "View analysis"}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className={`transition-transform ${analysisOpen ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {analysisOpen && (
            <div className="mt-2">
              {analysisPeriod && (
                <div className="rounded-[10px] bg-white border border-[#E5E7EB] px-3 py-2 inline-block">
                  <p className="text-[10px] font-bold text-[#6A7282] uppercase tracking-wider mb-0.5">
                    Analysis period
                  </p>
                  <p className="text-[12px] text-[#101828] font-medium">
                    {fmtDay(analysisPeriod.from)} – {fmtDay(analysisPeriod.to)}
                  </p>
                </div>
              )}

              <AnalysisBlocks rec={rec} />

              {onExplore && <ExploreButton onClick={onExplore} />}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 px-4 sm:px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`text-[10px] font-bold tracking-wider px-2 py-0.5 rounded ${p.className}`}
            >
              {p.label}
            </span>
          </div>
          <p className="text-[14px] font-semibold text-[#101828] flex items-start gap-1.5">
            <span aria-hidden>{KIND_ICON[rec.kind]}</span>
            <span className="min-w-0">{rec.title}</span>
          </p>
          <p className="text-[12px] text-[#4A5565] mt-0.5">{rec.detail}</p>
        </div>
        <div className="text-right shrink-0 bg-[#F0FDF4] border border-[#B9F8CF] rounded-lg px-2.5 py-1">
          <p className="text-[10px] font-bold text-[#6A7282] uppercase tracking-wider">Impact</p>
          <p className="text-[13px] font-bold text-[#008236]">
            +{impact}
            {impactSuffix} {impactLabel.toLowerCase()} potential
          </p>
        </div>
      </div>

      <AnalysisBlocks rec={rec} />

      {onOpenAnalytics && <ExploreButton onClick={onOpenAnalytics} />}

      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={onDismiss}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-[12px] font-medium text-[#6A7282] hover:bg-gray-50 transition"
        >
          Dismiss
        </button>
        <button
          onClick={onComplete}
          className="px-3.5 py-1.5 rounded-lg bg-[#F3E8FF] text-[12px] font-medium text-[#8200DB] hover:bg-[#E9D4FF] transition"
        >
          Completed
        </button>
      </div>
    </div>
  );
}
