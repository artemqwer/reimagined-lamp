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
    <div className="kpi-tile relative overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-800/30 px-3 py-2.5 min-w-0 transition-colors duration-200">
      {/* Spark as a quiet background layer — no horizontal squeeze */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-8 opacity-60 pointer-events-none">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={spark} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" hide />
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.28} />
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
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="relative flex items-center gap-1.5 mb-1 pr-5">
        <span
          className="shrink-0 w-5 h-5 rounded-md bg-zinc-800/80 flex items-center justify-center [&>svg]:w-3 [&>svg]:h-3"
          style={{ color: iconColor ?? (up ? "#22C55E" : "#EF4444") }}
        >
          {icon}
        </span>
        <span className="text-[11.5px] text-zinc-400 truncate">{label}</span>
      </div>

      <div className="relative flex items-baseline gap-1.5 flex-nowrap">
        <span
          key={`v-${value}`}
          className="text-[16px] sm:text-[17px] font-bold text-zinc-100 leading-none whitespace-nowrap truncate min-w-0 tabular-nums animate-in fade-in slide-in-from-bottom-1 duration-300"
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

      {/* Info tooltip — pinned top-right, hover only */}
      <div className="absolute right-2 top-2">
        <div className="relative group">
          <span className="w-3.5 h-3.5 rounded-full border border-zinc-700/70 flex items-center justify-center text-[7px] text-zinc-500 cursor-help select-none">
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
