"use client";

import React from "react";
import { MetricFilterState, MetricOp, METRIC_OPTIONS, OP_OPTIONS } from "@/lib/metricFilter";

// Metric → Operator → Value control block used in every table's Filters popover.
// Replaces the fixed Good / OK / Poor ROAS pills with a universal numeric filter.
export default function MetricFilterControls({
  value,
  onChange,
  options = METRIC_OPTIONS,
}: {
  value: MetricFilterState;
  onChange: (next: MetricFilterState) => void;
  // The metrics this source actually has, in the admin's order. Defaults to the
  // canonical list; a caller that knows its columns passes them so the picker
  // never offers another platform's metrics (ROAS/Cost on Search Console).
  options?: { key: string; label: string }[];
}) {
  const selectCls =
    "w-full appearance-none glass rounded-xl pl-3 pr-8 py-2 text-[13px] text-zinc-300 cursor-pointer hover:border-zinc-700 focus:outline-none focus:border-emerald-400 transition";
  const inputCls =
    "w-full glass rounded-xl px-3 py-2 text-[13px] text-zinc-300 focus:outline-none focus:border-emerald-400 transition tabular-nums";
  const labelCls = "text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-1.5";

  const chevron = (
    <svg
      className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );

  return (
    <div className="flex flex-col gap-2.5">
      {/* Metric — above Operator */}
      <div>
        <p className={labelCls}>Metric</p>
        <div className="relative">
          <select
            value={value.metric}
            onChange={(e) => onChange({ ...value, metric: e.target.value })}
            className={selectCls}
          >
            <option value="">Select metric…</option>
            {options.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          {chevron}
        </div>
      </div>

      {/* Operator — above Value. Disabled until a metric is chosen. */}
      <div>
        <p className={labelCls}>Operator</p>
        <div className="relative">
          <select
            value={value.op}
            disabled={!value.metric}
            onChange={(e) => onChange({ ...value, op: e.target.value as MetricOp })}
            className={`${selectCls} ${!value.metric ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {OP_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          {chevron}
        </div>
      </div>

      {/* Value — one input, or two when the operator is "Between". */}
      <div>
        <p className={labelCls}>Value</p>
        {value.op === "between" ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              value={value.value}
              disabled={!value.metric}
              onChange={(e) => onChange({ ...value, value: e.target.value })}
              placeholder="2.0"
              className={`${inputCls} ${!value.metric ? "opacity-50" : ""}`}
            />
            <span className="text-zinc-500 shrink-0">—</span>
            <input
              type="number"
              inputMode="decimal"
              value={value.value2}
              disabled={!value.metric}
              onChange={(e) => onChange({ ...value, value2: e.target.value })}
              placeholder="5.0"
              className={`${inputCls} ${!value.metric ? "opacity-50" : ""}`}
            />
          </div>
        ) : (
          <input
            type="number"
            inputMode="decimal"
            value={value.value}
            disabled={!value.metric}
            onChange={(e) => onChange({ ...value, value: e.target.value })}
            placeholder="3.5"
            className={`${inputCls} ${!value.metric ? "opacity-50" : ""}`}
          />
        )}
      </div>
    </div>
  );
}
