"use client";

import React from "react";
import { AdPerfItem, PlItem, fmtChartNum, fmtChartMoney } from "../_data/constants";

export const MONTH_IDX: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

// Weekend highlighting applies ONLY to daily labels ("Jun 5"). Month / week /
// quarter / year buckets all carry a 4-digit year in their label ("Jun 2022",
// "Q2 2022", "Jun 5, 2022") — those must never be weekend-coloured (otherwise the
// second token, the year, was misread as a day-of-month and randomly turned some
// months blue).
const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Day-of-week from a row's ISO date ("2022-02-07"). Uses the REAL calendar year —
// the daily label ("Feb 7") omits the year, so the weekday MUST come from the iso.
function isoWeekday(iso?: string): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
}

export function dowName(iso?: string): string {
  const wd = isoWeekday(iso);
  return wd === null ? "" : DOW_NAMES[wd];
}

// Weekend highlighting applies ONLY to single-day labels ("Feb 7"), and the weekday
// is derived from the row's ISO date (real year). Passing iso is required — without
// it the year is unknown, so we do NOT guess (the old code hard-coded 2026, which
// turned the wrong weekdays blue).
export function isWeekend(dateStr: string, iso?: string) {
  if (dateStr.includes("–")) return false;
  if (/\d{4}/.test(dateStr)) return false; // has a year → a bucket label, not a day
  const wd = isoWeekday(iso);
  return wd === 0 || wd === 6;
}

export const ChartTooltip = ({
  active,
  payload,
  label,
  // The chart plots whichever metric the source offers, so the caller says how
  // to read the numbers rather than the tooltip inferring it from a fixed set
  // of metric names (which left every other source's metrics formatted as money).
  isMoney = true,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: string;
  isMoney?: boolean;
}) => {
  if (!active || !payload?.length) return null;
  const nonZero = payload.filter((p) => (p.value || 0) > 0);
  if (nonZero.length === 0) return null;
  const total = nonZero.reduce((s, p) => s + p.value, 0);
  // Show the weekday next to a daily label, e.g. "Feb 10 (Thursday)".
  const dow = dowName(payload[0]?.payload?._iso);
  const heading = dow ? `${label} (${dow})` : label;
  const fmtV = (v: number) => (isMoney ? fmtChartMoney(v) : fmtChartNum(v));
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-2.5 py-2 text-[11px] max-w-50 sm:max-w-70">
      <p className="font-semibold text-gray-700 mb-1.5">{heading}</p>
      <div className="max-h-40 sm:max-h-none overflow-y-auto space-y-0.5">
        {nonZero.map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 min-w-0">
              <div className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ background: p.color }} />
              <span className="text-gray-500 truncate">{p.name}</span>
            </span>
            <span className="font-medium text-gray-700 shrink-0">{fmtV(p.value)}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-gray-100 mt-1.5 pt-1 flex justify-between font-semibold text-gray-800">
        <span>Total</span>
        <span>{fmtV(total)}</span>
      </div>
    </div>
  );
};

export function SortIcon({ dir }: { dir: "asc" | "desc" | null }) {
  return (
    <span className="ml-1 text-gray-300 text-[10px]">
      {dir === "asc" ? "↑" : dir === "desc" ? "↓" : "↕"}
    </span>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BarXTick = ({ x, y, payload, data }: any) => {
  const weekend = isWeekend(payload.value, data?.[payload.index]?._iso);
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={12}
        fill={weekend ? "#3B82F6" : "#9CA3AF"}
        fontSize={13}
        textAnchor="middle"
        fontWeight={400}
      >
        {payload.value}
      </text>
    </g>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AdXTick = ({ x, y, payload, data }: any) => {
  // ROAS points removed per design — ROAS now shows only on column hover (see AdTooltip).
  const weekend = isWeekend(payload.value, data?.[payload.index]?._iso);
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={12}
        fill={weekend ? "#3B82F6" : "#9CA3AF"}
        fontSize={12}
        textAnchor="middle"
        fontWeight={400}
      >
        {payload.value}
      </text>
    </g>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PlXTick = ({ x, y, payload, data }: any) => {
  const weekend = isWeekend(payload.value, data?.[payload.index]?._iso);
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={12}
        fill={weekend ? "#3B82F6" : "#9CA3AF"}
        fontSize={12}
        textAnchor="middle"
        fontWeight={400}
      >
        {payload.value}
      </text>
    </g>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AdTooltip = ({ active, payload, label, data }: any) => {
  if (!active || !payload?.length) return null;
  const item = data.find((d: AdPerfItem) => d.date === label);
  if (!item) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2.5 text-[11px]">
      <p className="font-semibold text-gray-700 mb-1.5">{label}</p>
      <div className="flex justify-between gap-4">
        <span className="text-gray-500">Conv. Value</span>
        <span className="font-semibold text-gray-800">{fmtChartMoney(item.convValue)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-green-600">Profit</span>
        <span className={`font-semibold ${item.profit < 0 ? "text-red-600" : "text-green-700"}`}>
          {fmtChartMoney(item.profit)}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-red-400">Cost</span>
        <span className="font-semibold text-gray-800">{fmtChartMoney(item.cost)}</span>
      </div>
      <div className="flex justify-between gap-4 border-t border-gray-100 mt-1.5 pt-1">
        <span className="text-purple-500">ROAS</span>
        <span className="font-semibold text-gray-800">{item.roas.toFixed(2)}x</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-gray-400">Clicks</span>
        <span className="font-semibold text-gray-800">{fmtChartNum(item.clicks)}</span>
      </div>
    </div>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PlTooltip = ({ active, payload, label, data }: any) => {
  if (!active || !payload?.length) return null;
  const item = data.find((d: PlItem) => d.date === label);
  if (!item) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2.5 text-[11px]">
      <p className="font-semibold text-gray-700 mb-1.5">{label}</p>
      <div className="flex justify-between gap-4">
        <span className="text-green-600">Cumulative</span>
        <span className="font-semibold text-green-700">{fmtChartMoney(item.cumulative)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className={item.dailyProfit < 0 ? "text-red-400" : "text-gray-500"}>Daily</span>
        <span
          className={`font-semibold ${item.dailyProfit < 0 ? "text-red-600" : "text-green-700"}`}
        >
          {fmtChartMoney(item.dailyProfit)}
        </span>
      </div>
    </div>
  );
};

export const makeRenderConvLabel = (data: AdPerfItem[], hideConv = false) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function ConvLabel({ x = 0, y = 0, width = 0, index: idx = 0 }: any) {
    if (hideConv || width < 24) return null;
    const item = data[idx];
    // Revenue label sits above the profit bar for profitable periods. It is ALWAYS
    // blue (#3B82F6) so the Revenue colour never changes between periods.
    if (!item || item.profit < 0) return null;
    return (
      <text
        className="hidden sm:block"
        x={x + width / 2}
        y={y - 5}
        fill="#3B82F6"
        fontSize={11}
        fontWeight={700}
        textAnchor="middle"
      >
        {fmtChartMoney(item.convValue)}
      </text>
    );
  };

export const renderProfitLabel = ({
  x = 0,
  y = 0,
  width: w = 0,
  height: h = 0,
  value: val = 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}: any) => {
  if (w < 34 || h < 16 || val <= 0) return null;
  return (
    <text
      className="hidden sm:block"
      x={x + w / 2}
      y={y + h / 2 + 4}
      fill="white"
      fontSize={11}
      fontWeight={700}
      textAnchor="middle"
    >
      {fmtChartMoney(val)}
    </text>
  );
};

export const renderCostLabel = ({
  x = 0,
  y = 0,
  width: w = 0,
  height: h = 0,
  value: val = 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}: any) => {
  if (w < 34 || h < 16 || val <= 0) return null;
  return (
    <text
      className="hidden sm:block"
      x={x + w / 2}
      y={y + h / 2 + 4}
      fill="white"
      fontSize={11}
      fontWeight={700}
      textAnchor="middle"
    >
      {fmtChartMoney(val)}
    </text>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderPlLabel = ({ x = 0, y = 0, width: w = 0, value: val = 0 }: any) => {
  if (w < 32) return null;
  return (
    <text
      className="hidden sm:block"
      x={x + w / 2}
      y={y - 5}
      fill="#374151"
      fontSize={12}
      fontWeight={700}
      textAnchor="middle"
    >
      {fmtChartMoney(val)}
    </text>
  );
};

export const makeRenderLossTopLabel = (data: AdPerfItem[], hideConv = false) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function LossTopLabel({ x = 0, y = 0, width: w = 0, index: idx = 0 }: any) {
    if (hideConv || w < 24) return null;
    const item = data[idx];
    if (!item || item.profit >= 0) return null;
    // Loss period: only the Revenue value above the Cost bar (always blue). The loss
    // amount is now shown INSIDE the separate below-axis Loss segment, not here.
    return (
      <text
        className="hidden sm:block"
        x={x + w / 2}
        y={y - 5}
        fill="#3B82F6"
        fontSize={11}
        fontWeight={700}
        textAnchor="middle"
      >
        {fmtChartMoney(item.convValue)}
      </text>
    );
  };

// Label rendered INSIDE the below-axis Loss segment (negative value, e.g. −$3.3K),
// white text centred so it reads against the dark-red segment fill.
export const renderLossSegLabel = ({
  x = 0,
  y = 0,
  width: w = 0,
  height: h = 0,
  value: val = 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}: any) => {
  const absH = Math.abs(h);
  if (w < 34 || val >= 0 || absH < 14) return null;
  return (
    <text
      className="hidden sm:block"
      x={x + w / 2}
      y={y + absH / 2 + 4}
      fill="white"
      fontSize={11}
      fontWeight={700}
      textAnchor="middle"
    >
      {fmtChartMoney(val)}
    </text>
  );
};

// Custom label renderer for stacked bar totals — hidden on narrow bars
export const makeRenderTotalLabel = (isMoney: boolean) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function TotalLabel({ x: rawX, y: rawY, width: rawW, value: rawV }: any) {
    const x = typeof rawX === "number" ? rawX : 0;
    const y = typeof rawY === "number" ? rawY : 0;
    const width = typeof rawW === "number" ? rawW : 0;
    const value = typeof rawV === "number" ? rawV : 0;
    if (width < 18 || value <= 0) return null;
    const label = isMoney ? fmtChartMoney(value) : fmtChartNum(value);
    return (
      <text
        className="hidden sm:block"
        x={x + width / 2}
        y={y - 6}
        fill="#374151"
        fontSize={12}
        fontWeight={600}
        textAnchor="middle"
      >
        {label}
      </text>
    );
  };
