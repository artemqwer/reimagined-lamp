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
    <div className="card-elevate rounded-2xl px-3 py-2.5 min-w-0 flex-1 flex items-center gap-2.5 sm:gap-3 relative kpi-tile transition-colors duration-200">
      {/* Left: identity + value */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-1 pr-4">
          <span
            className="shrink-0 w-5 h-5 rounded-md bg-zinc-800/70 flex items-center justify-center [&>svg]:w-3 [&>svg]:h-3"
            style={{ color: iconColor ?? (up ? "#22C55E" : "#EF4444") }}
          >
            {icon}
          </span>
          <span className="text-[11.5px] sm:text-[12px] text-zinc-400 truncate">{label}</span>
        </div>
        <div className="flex items-baseline gap-1.5 flex-nowrap">
          <span
            key={`v-${value}`}
            className="text-[16px] sm:text-[18px] font-bold text-zinc-100 leading-none whitespace-nowrap truncate min-w-0 animate-in fade-in slide-in-from-bottom-1 duration-300"
          >
            {value}
          </span>
          <span
            key={`d-${delta}`}
            className={`shrink-0 text-[10px] font-semibold leading-none px-1 py-0.5 rounded animate-in fade-in duration-300 ${
              up ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10"
            }`}
          >
            {delta}
          </span>
        </div>
      </div>

      {/* Right: inline mini spark */}
      <div className="w-[64px] sm:w-[84px] h-9 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={spark} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" hide />
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.32} />
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
                      background: "#18181b",
                      border: "1px solid #3F3F46",
                      borderRadius: 8,
                      padding: "3px 8px",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                      pointerEvents: "none",
                    }}
                  >
                    <div
                      style={{ fontSize: 9, color: "#A1A1AA", fontWeight: 500, lineHeight: 1.4 }}
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
              isAnimationActive={false}
              wrapperStyle={{ zIndex: 20 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Info tooltip — pinned top-right, hover only */}
      <div className="absolute right-2 top-2 hidden sm:block">
        <div className="relative group">
          <span className="w-3.5 h-3.5 rounded-full border border-zinc-800 flex items-center justify-center text-[7px] text-zinc-600 cursor-help select-none">
            i
          </span>
          <div className="absolute right-0 top-5 w-[170px] bg-zinc-900 text-zinc-100 text-[11px] rounded-lg px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none shadow-lg leading-snug">
            {desc}
          </div>
        </div>
      </div>
    </div>
  );
}
