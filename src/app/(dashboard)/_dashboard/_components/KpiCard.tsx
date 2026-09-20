"use client";

import React from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface KpiCardProps {
  label: string;
  shortLabel?: string;
  icon: React.ReactNode;
  iconColor?: string;
  value: string;
  delta: string;
  up: boolean;
  spark: { v: number; date: string }[];
  desc: string;
  hoverFmt: (v: number) => string;
}

export default function KpiCard({
  label,
  shortLabel,
  icon,
  iconColor,
  value,
  delta,
  up,
  spark,
  desc,
  hoverFmt,
}: KpiCardProps) {
  const color = up ? "#22C55E" : "#EF4444";
  const gradId = `kg-${label.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 px-2 sm:px-4 pt-2.5 sm:pt-3 pb-0 min-w-0 flex-1 flex flex-col transition-colors duration-200">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="shrink-0" style={{ color: iconColor ?? (up ? "#22C55E" : "#EF4444") }}>
            {icon}
          </span>
          <span className="sm:hidden text-[13px] font-medium text-gray-600 truncate">
            {shortLabel ?? label}
          </span>
          <span className="hidden sm:inline text-[13px] text-gray-500 truncate">{label}</span>
        </div>
        <div className="relative group shrink-0 ml-1 hidden sm:block">
          <span className="w-3 h-3 sm:w-4 sm:h-4 rounded-full border border-gray-200 flex items-center justify-center text-[7px] sm:text-[8px] text-gray-400 cursor-help select-none">
            i
          </span>
          <div className="absolute right-0 top-5 w-[170px] bg-gray-900 text-white text-[11px] rounded-lg px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none shadow-lg leading-snug">
            {desc}
          </div>
        </div>
      </div>
      <div className="mb-0.5">
        {/* Mobile: value with delta stacked underneath. Keyed spans fade+slide in
            whenever the value/delta changes (period, metric, filters…). Keys are
            prefixed so value and delta NEVER share a key — during loading both are
            "—", and an unprefixed key collision left a stale "—" stuck on screen. */}
        <div className="flex flex-col gap-y-0 sm:hidden">
          <span
            key={`v-${value}`}
            className="text-[15px] font-bold text-gray-900 leading-tight truncate animate-in fade-in slide-in-from-bottom-1 duration-300"
          >
            {value}
          </span>
          <span
            key={`d-${delta}`}
            className={`text-[10px] font-semibold leading-none animate-in fade-in duration-300 ${up ? "text-green-500" : "text-red-500"}`}
          >
            {delta}
          </span>
        </div>
        {/* Desktop: value on the left, delta badge on the right — ALWAYS one line
            (never wrap). A wrapping badge made only some cards' headers 2 lines tall,
            so their fixed-height sparklines shifted, leaving a gap below (the bug).
            Keeping one line + a slightly smaller value keeps every card's header the
            same height, so all sparklines align. min-w-0 + truncate is a last-resort
            guard for extreme widths so the badge is never pushed down. */}
        <div className="hidden sm:flex items-center justify-between gap-x-1.5 flex-nowrap">
          <span
            key={`v-${value}`}
            className="text-[18px] font-bold text-gray-900 leading-tight whitespace-nowrap truncate min-w-0 animate-in fade-in slide-in-from-bottom-1 duration-300"
          >
            {value}
          </span>
          <span
            key={`d-${delta}`}
            className={`shrink-0 text-[11px] font-semibold leading-none px-1.5 py-1 rounded-md animate-in fade-in duration-300 ${up ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"}`}
          >
            {delta}
          </span>
        </div>
      </div>
      {/* mt-auto pins the sparkline to the card bottom so equal-height cards never
          show empty space beneath the chart, regardless of header height. */}
      <div className="mt-auto h-[62px] sm:h-[68px] -mx-2 sm:-mx-4 overflow-hidden rounded-b-2xl">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={spark} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" hide />
            {/* Scale Y to the data's OWN range so the sparkline always fills the card
                height. Without this Recharts baselines at 0, so high-value / low-variance
                series (e.g. 200K–250K) got squeezed into the top with a big empty gap
                below — the reported bug. baseValue=dataMin keeps the fill anchored to the
                card bottom for every period / filter / dataset. */}
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="natural"
              dataKey="v"
              stroke={color}
              strokeWidth={1.5}
              fill={`url(#${gradId})`}
              baseValue="dataMin"
              dot={false}
              activeDot={{ r: 3, fill: color, strokeWidth: 0 }}
              isAnimationActive
              animationDuration={500}
              animationEasing="ease-out"
            />
            <Tooltip
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              content={({ active, payload, label: lbl }: any) => {
                if (!active || !payload?.[0]) return null;
                return (
                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #E5E7EB",
                      borderRadius: 8,
                      padding: "3px 8px",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
                      pointerEvents: "none",
                    }}
                  >
                    <div
                      style={{ fontSize: 9, color: "#9CA3AF", fontWeight: 500, lineHeight: 1.4 }}
                    >
                      {lbl}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color, lineHeight: 1.4 }}>
                      {hoverFmt(payload[0].value)}
                    </div>
                  </div>
                );
              }}
              cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "3 2", strokeOpacity: 0.5 }}
              position={{ y: 22 }}
              isAnimationActive={false}
              wrapperStyle={{ zIndex: 20 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
