"use client";

import React, { useState } from "react";
import Link from "next/link";
import { attainmentPct } from "@/lib/smartGoals";
import type { GoalFormat, GoalMetricDef } from "@/lib/smartGoalMetrics";
import type { OptimizerSummary } from "@/lib/aiOptimizer";
import { confidenceBand, type Forecast } from "@/lib/smartGoalsData";
import { formatGoalValue, formatMetric } from "./format";

// Hidden until the Smart Goals optimizer summary and the AI Optimizer page count
// the same thing (this counts campaigns only; the page counts every breakdown).
// Flip to true to show the summary block again.
const SHOW_OPTIMIZER_SUMMARY = false;

// End-of-month forecast: where the period lands if the rest of it performs like
// the part that has already happened.
//
// The projection is a straight line and says so — the spec is explicit that
// this is interpretive rather than a promise, and that its confidence must be
// visible so nobody reads it as one.

const BAND_TEXT = {
  low: "Early in the period — mostly extrapolation",
  medium: "Part-way through the period",
  high: "Most of the period is real data",
} as const;

export default function ForecastPanel({
  forecasts,
  targets,
  metrics,
  optimizer,
  impactFormat,
  entityNoun,
  daily,
  outcomes,
  loading,
}: {
  /** One per enabled goal, in the same order the cards are in. */
  forecasts: Forecast[];
  targets: Record<string, number | null>;
  /** This source's metric definitions. */
  metrics: GoalMetricDef[];
  /** What the optimizer found, for the summary line and the way in. */
  optimizer: OptimizerSummary | null;
  /** How to render an impact — money or a plain count. */
  impactFormat: GoalFormat;
  /** What this source calls the things the optimizer looked at ("campaigns"). */
  entityNoun: string;
  /** A month read day by day, or a year read month by month. */
  daily: boolean;
  /** Set for a period that is over: how it actually finished, instead of a
   *  projection of where it is heading. */
  outcomes?: { metric: string; actual: number; target: number }[];
  loading: boolean;
}) {
  const defOf = (key: string) => metrics.find((m) => m.key === key);
  const [methodOpen, setMethodOpen] = useState(false);
  const title = daily ? "End-of-Month Forecast" : "End-of-Year Forecast";
  const periodNoun = daily ? "month" : "year";
  const bucketNoun = daily ? "days" : "months";

  if (loading)
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="h-4 w-40 bg-gray-100 rounded mb-3 animate-pulse" />
        <div className="h-16 bg-gray-50 rounded-xl animate-pulse" />
      </div>
    );

  // A finished period has no future to project. Leaving the block out
  // altogether read as the forecast being broken, so it says how the period
  // actually ended instead — the same shape, a different claim.
  if (outcomes && outcomes.length > 0)
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-[15px] font-bold text-gray-900">How this period finished</h2>
        <p className="text-[12px] text-gray-500 mt-0.5 mb-3">
          The period is over, so there is nothing left to project — this is what it came to.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {outcomes.map((row) => {
            const def = defOf(row.metric);
            const met = def ? attainmentPct(def, row.actual, row.target) >= 100 : null;
            return (
              <div
                key={row.metric}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 border border-gray-200 rounded-xl px-3 py-2"
              >
                <span className="text-[12px] font-semibold text-gray-800 mr-auto">
                  {def?.label ?? row.metric}
                </span>
                <span className="text-[11px] text-gray-400 tabular-nums">
                  Target <span className="text-gray-600">{formatMetric(row.target, def)}</span>
                </span>
                <span className="text-[11px] text-gray-300">→</span>
                <span className="text-[12px] font-bold text-gray-900 tabular-nums">
                  {formatMetric(row.actual, def)}
                </span>
                <span className={met ? "text-green-600" : "text-red-500"}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    {met ? (
                      <polyline points="20 6 9 17 4 12" />
                    ) : (
                      <>
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </>
                    )}
                  </svg>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );

  if (forecasts.length === 0)
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h2 className="text-[15px] font-bold text-gray-900 mb-1">End-of-period forecast</h2>
        <p className="text-[13px] text-gray-500">
          Not enough data yet to project this period — come back once a couple of days have closed.
        </p>
      </div>
    );

  const confidence = forecasts[0].confidencePct;
  const band = confidenceBand(confidence);
  return (
    <div
      className="rounded-2xl border border-[#DAB2FF] p-4 sm:p-5"
      style={{
        background: "linear-gradient(135deg, rgba(250,245,255,1) 0%, rgba(238,242,255,1) 100%)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          <span
            className="w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0"
            style={{
              background: "linear-gradient(135deg, #AD46FF 0%, #4F39F6 100%)",
              boxShadow: "0 4px 6px -4px rgba(0,0,0,.1), 0 10px 15px -3px rgba(0,0,0,.1)",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-[#101828] tracking-[-0.0195em]">
              {title}
            </h2>
            <p className="text-[12px] text-[#4A5565] mt-1">
              Based on{" "}
              <span className="font-semibold">
                {forecasts[0].basedOnBuckets} {bucketNoun}
              </span>{" "}
              of actual performance data (
              <span className="font-semibold">
                {confidence}% of {periodNoun}
              </span>
              ), our AI model projects the following outcomes for {periodNoun}-end:
            </p>
          </div>
        </div>
        <span className="text-[12px] font-semibold px-2 py-1 rounded-lg bg-[#F3E8FF] text-[#8200DB] shrink-0">
          {confidence}% Confidence
        </span>
      </div>

      {/* One card per goal: what was asked for, and where it is heading. */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
        {forecasts.map((f) => {
          const def = defOf(f.metric);
          const target = targets[f.metric] ?? null;
          // Direction-aware: finishing under a budget is success, finishing
          // under a revenue target is not.
          const willMeet =
            target === null || !def ? null : attainmentPct(def, f.projected, target) >= 100;
          return (
            <div
              key={f.metric}
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 bg-white border border-gray-200 rounded-[10px] px-3 py-2"
            >
              <span className="text-[13px] font-semibold text-[#101828] mr-auto">
                {def?.label ?? f.metric}
              </span>
              {target !== null && (
                <span className="text-[11px] text-gray-400 whitespace-nowrap">
                  Target{" "}
                  <span className="tabular-nums text-gray-600">{formatMetric(target, def)}</span>
                </span>
              )}
              <span className="text-gray-300">→</span>
              <span className="text-[11px] text-gray-400 whitespace-nowrap">
                Forecast{" "}
                <span className="font-bold tabular-nums text-[#101828]">
                  {formatMetric(f.projected, def)}
                </span>
              </span>
              {willMeet !== null &&
                (willMeet ? (
                  <span title="On track to meet this target" className="text-green-600">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                ) : (
                  <span title="Projected to miss this target" className="text-red-500">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </span>
                ))}
            </div>
          );
        })}
      </div>

      <button
        onClick={() => setMethodOpen((v) => !v)}
        className="mt-3 flex items-center gap-1.5 text-[12px] font-semibold text-[#8200DB] hover:text-violet-800"
      >
        Forecast Methodology
        <span className="font-normal text-gray-500">
          · Current accuracy: {confidence}% (based on {confidence}% {periodNoun} completion)
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`transition-transform ${methodOpen ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {methodOpen && (
        <div className="mt-2 bg-white/70 border border-[#F3E8FF] rounded-xl p-3 space-y-1.5">
          <p className="text-[12px] text-gray-600">
            A linear trend projection: the average daily performance so far, carried across the rest
            of the period. Averages such as ROAS are projected at their current level rather than
            scaled, since multiplying an average by the days remaining means nothing.
          </p>
          <p className="text-[12px] text-gray-600">
            Confidence is how much of the period is already real data — currently {confidence}%.{" "}
            {BAND_TEXT[band]}.
          </p>
          <p className="text-[12px] text-gray-400">
            This is a projection, not a commitment: it doesn&apos;t know about a sale you
            haven&apos;t run yet or a budget you&apos;re about to change.
          </p>
        </div>
      )}

      {/* What the optimizer found, and the way in. Every figure here is one it
          computed from the account's own rows; only the total is called out in
          green, matching the one figure this sentence is actually about.

          Hidden for now (SHOW_OPTIMIZER_SUMMARY): this summary counts only the
          primary breakdown (campaigns), so its number can't match the optimizer
          page, which counts every breakdown. Re-enable once the two share one
          source of truth. Flip the flag to bring it back. */}
      {SHOW_OPTIMIZER_SUMMARY && optimizer && optimizer.count > 0 && (
        <div className="mt-3 pt-3 border-t border-[#E9D4FF] flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[#8200DB]">
              {optimizer.entitiesWithOpportunities} {entityNoun}{" "}
              <span className="font-normal">
                {optimizer.entitiesWithOpportunities === 1 ? "has" : "have"} optimization
                opportunities — this can add{" "}
              </span>
              <span className="text-[#00A63E]">
                {formatGoalValue(optimizer.totalImpact, impactFormat)}
              </span>
              <span className="font-normal">
                {" "}
                total potential {optimizer.impactMetricLabel.toLowerCase()} with{" "}
              </span>
              {optimizer.count} recommendation{optimizer.count === 1 ? "" : "s"}
              <span className="font-normal">, averaging </span>
              {formatGoalValue(optimizer.averageImpact, impactFormat)}
              <span className="font-normal"> per {entityNoun.replace(/s$/, "")}.</span>
            </p>
            <p className="text-[12px] text-[#4A5565] mt-1">
              💡 Implementing these optimizations can increase your chances of achieving or
              exceeding your {periodNoun}ly goals
            </p>
          </div>
          <Link
            href="/ai-optimizer"
            className="shrink-0 p-0.5 rounded-[13px]"
            style={{
              background: "linear-gradient(90deg, #00BC7D 0%, #00BBA7 50%, #00B8DB 100%)",
            }}
          >
            <span className="flex items-center gap-2 bg-white rounded-[11px] px-3 py-1.5 text-[14px] text-[#364153]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#8200DB">
                <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" />
              </svg>
              AI Optimizer
              <span className="text-[12px] font-medium text-white bg-[#009966] rounded-full px-1.5">
                {optimizer.count}
              </span>
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
