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
    <div className="kpi-tile relative rounded-xl border border-zinc-800/60 bg-gradient-to-br from-white/[0.03] to-transparent px-4 pt-4 pb-3 min-w-0 transition-colors duration-200">
      <div className="flex items-center justify-between text-zinc-400 text-[11px]">
        <span className="truncate pr-2">{label}</span>
        <span
          className="shrink-0 w-[27px] h-[27px] rounded-lg grid place-items-center bg-[var(--brand)]/10 text-[var(--brand-fg)] [&>svg]:w-[14px] [&>svg]:h-[14px]"
          style={{ color: iconColor ?? undefined }}
        >
          {icon}
        </span>
      </div>
      <div
        key={`v-${value}`}
        className="text-[23px] font-bold text-zinc-100 tracking-[-0.75px] leading-none my-3 tabular-nums animate-in fade-in slide-in-from-bottom-1 duration-300"
      >
        {value}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 whitespace-nowrap">
        <span
          key={`d-${delta}`}
          className={`inline-flex items-center gap-0.5 text-[10.5px] font-semibold ${
            up ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {delta}
        </span>
        <span>vs. previous period</span>
        <div className="w-[51px] h-[24px] ml-auto opacity-85 pointer-events-none">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Area
                type="linear"
                dataKey="v"
                stroke={up ? "#76e0b4" : "#e69b8a"}
                strokeWidth={1.7}
                fill="none"
                dot={false}
                activeDot={{ r: 2.5, fill: color, strokeWidth: 0 }}
                isAnimationActive={false}
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
                cursor={{
                  stroke: color,
                  strokeWidth: 1,
                  strokeDasharray: "3 2",
                  strokeOpacity: 0.5,
                }}
                isAnimationActive={false}
                wrapperStyle={{ zIndex: 20 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
