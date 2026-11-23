"use client";

import React, { useMemo, useState } from "react";
import { useCrossFilter } from "@/lib/store";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  LabelList,
  ComposedChart,
  Area,
  ReferenceLine,
  CartesianGrid,
  Line,
  Cell,
} from "recharts";
import SegmentDonut from "./SegmentDonut";
import {
  ChartTooltip,
  BarXTick,
  AdXTick,
  PlXTick,
  AdTooltip,
  PlTooltip,
  makeRenderConvLabel,
  renderProfitLabel,
  renderCostLabel,
  renderPlLabel,
  makeRenderLossTopLabel,
  makeRenderTotalLabel,
  renderLossSegLabel,
} from "./ChartPrimitives";
import { ChartGroupBy, AdPerfItem, PlItem, fmtChartNum, fmtChartMoney } from "../_data/constants";
import Timeline from "./Timeline";
import type { CustomEvent } from "../_data/types";

// The metric and "by" dropdowns deliberately carry no icons. They used to, but
// only for the handful of canonical Google Ads metrics and group-bys they were
// drawn for — every source's own metric or breakdown fell through to a blank
// gap, which read as a missing element rather than as a deliberate absence.

interface TabContentProps {
  activeTab: number;
  isMobile: boolean;
  isLoading?: boolean;
  hasRecords?: boolean;
  // Period Analysis
  aggregatedBarData: Record<string, string | number>[];
  chartSeries: { name: string; color: string }[];
  // The metric KEY currently plotted, plus how to show it. The dropdown used
  // to pass the display name around as the value, which only worked while the
  // list was a fixed Google-Ads set.
  chartMetric: string;
  chartMetricLabel: string;
  chartMetricIsMoney: boolean;
  chartGroupBy: ChartGroupBy;
  chartMetricOpen: boolean;
  chartGroupByOpen: boolean;
  hiddenSeries: Set<string>;
  othersNames?: string[];
  rowTypeFilter: Set<string> | null;
  renderTotalLabelChart: (props: unknown) => React.ReactNode;
  CHART_METRICS: { key: string; label: string }[];
  CHART_GROUPBY: ChartGroupBy[];
  // Display label for a group-by value — lets non-Google sources show their own
  // primary label ("Channel", "Product") while the internal value stays "Campaign".
  groupByLabel?: (g: ChartGroupBy) => string;
  onChartMetricChange: (m: string) => void;
  onChartGroupByChange: (g: ChartGroupBy) => void;
  onChartMetricOpenChange: (v: boolean) => void;
  onChartGroupByOpenChange: (v: boolean) => void;
  onToggleSeries: (name: string) => void;
  onClearRowFilter: () => void;
  // Ad Performance
  aggregatedAdPerfData: AdPerfItem[];
  hiddenAdPerf: Set<string>;
  renderConvLabel: (props: unknown) => React.ReactNode;
  renderLossTopLabel: (props: unknown) => React.ReactNode;
  onHiddenAdPerfChange: (v: Set<string>) => void;
  // P&L
  aggregatedPlData: PlItem[];
  hiddenPL: Set<string>;
  dates: string[];
  onHiddenPLChange: (v: Set<string>) => void;
  // Segments
  buildSegData: (metric: string, segBy: string) => { name: string; value: number }[];
  segDateFrom: string;
  segDateTo: string;
  // Changes whenever the chart data structure changes (metric / group-by /
  // granularity / period / filters) — used as a remount key so the whole chart
  // fades in as one component instead of re-growing bar-by-bar ("tetris").
  chartKey: string;
  // Granularity
  granularity: "days" | "weeks" | "months";
  granularityOpen: boolean;
  onGranularityChange: (g: "days" | "weeks" | "months") => void;
  onGranularityOpenChange: (v: boolean) => void;
  timelineOpen?: boolean;
  customEvents?: CustomEvent[];
  /** What to call the source behind auto platform events on the timeline. */
  autoSourceLabel?: string;
  onToggleTimeline?: () => void;
  onAddEvent?: () => void;
  onDeleteEvent?: (id: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEditEvent?: (m: any) => void;
}

export default function TabContent({
  activeTab,
  isMobile,
  isLoading = false,
  hasRecords = false,
  aggregatedBarData,
  chartSeries,
  chartMetric,
  chartMetricLabel,
  chartMetricIsMoney,
  chartGroupBy,
  chartMetricOpen,
  chartGroupByOpen,
  hiddenSeries,
  othersNames = [],
  rowTypeFilter,
  renderTotalLabelChart,
  CHART_METRICS,
  CHART_GROUPBY,
  groupByLabel = (g) => g,
  onChartMetricChange,
  onChartGroupByChange,
  onChartMetricOpenChange,
  onChartGroupByOpenChange,
  onToggleSeries,
  onClearRowFilter,
  aggregatedAdPerfData,
  hiddenAdPerf,
  renderConvLabel,
  renderLossTopLabel,
  onHiddenAdPerfChange,
  aggregatedPlData,
  hiddenPL,
  dates,
  onHiddenPLChange,
  buildSegData,
  segDateFrom,
  segDateTo,
  chartKey,
  granularity,
  granularityOpen,
  onGranularityChange,
  onGranularityOpenChange,
  timelineOpen = false,
  customEvents = [],
  autoSourceLabel,
  onToggleTimeline,
  onAddEvent,
  onDeleteEvent,
  onEditEvent,
}: TabContentProps) {
  const [legendExpanded, setLegendExpanded] = useState(false);
  // Trends chart view modes: plain bars, smooth stacked areas, or running total.
  const [chartMode, setChartMode] = useState<"columns" | "spline" | "cumulative">("columns");
  // Chart density: user-controlled height so the dashboard flexes to taste.
  const [chartScale, setChartScale] = useState<"s" | "m" | "l">("m");
  const scaleH = {
    s: "h-[240px] sm:h-[300px] lg:h-[340px]",
    m: "h-[300px] sm:h-[380px] lg:h-[440px]",
    l: "h-[360px] sm:h-[460px] lg:h-[540px]",
  }[chartScale];
  const cumulativeBarData = useMemo(() => {
    const totals = new Map<string, number>();
    return aggregatedBarData.map((row) => {
      const out: Record<string, string | number> = { ...row };
      chartSeries.forEach(({ name }) => {
        const next = (totals.get(name) || 0) + ((row[name] as number) || 0);
        totals.set(name, next);
        out[name] = next;
      });
      return out;
    });
  }, [aggregatedBarData, chartSeries]);
  const chartRows = chartMode === "cumulative" ? cumulativeBarData : aggregatedBarData;
  // Peak / average strip for the header row.
  const trendStats = useMemo(() => {
    let peakIdx = -1;
    let peakVal = -1;
    let sum = 0;
    aggregatedBarData.forEach((row, i) => {
      const v = chartSeries.reduce(
        (s, { name }) => s + (hiddenSeries.has(name) ? 0 : (row[name] as number) || 0),
        0,
      );
      if (v > peakVal) {
        peakVal = v;
        peakIdx = i;
      }
      sum += v;
    });
    return {
      peakVal,
      peakDate: peakIdx >= 0 ? String(aggregatedBarData[peakIdx]?.date ?? "") : "",
      avg: aggregatedBarData.length ? sum / aggregatedBarData.length : 0,
    };
  }, [aggregatedBarData, chartSeries, hiddenSeries]);
  const LEGEND_LIMIT = 10;
  const { filters, selectSingle, clearFilter, setFilter } = useCrossFilter();
  const selectedCampaignCount = (filters["campaign_selected"] ?? []).length;
  // The "Others" bar aggregates many real campaigns. Clicking it must cross-filter
  // to that whole set (KPIs, tables, chart) — selecting the literal string "Others"
  // matches no campaign, so nothing filtered. Detect when Others is the active set.
  const othersSelected =
    othersNames.length > 0 &&
    selectedCampaignCount === othersNames.length &&
    othersNames.every((n) => (filters["campaign_selected"] ?? []).includes(n));

  return (
    <>
      {/* Chart controls */}
      <div className="flex items-center gap-2 mb-4 text-[14px]">
        {activeTab === 0 && (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Metric dropdown. min-w-0 (not flex-1) so short labels sit compact next
                to each other; the w-full button + truncate span shrink only when the
                label is long. No overflow-hidden on the row — it would clip the menus. */}
            <div className="relative min-w-0">
              <button
                onClick={() => {
                  onChartMetricOpenChange(!chartMetricOpen);
                  onChartGroupByOpenChange(false);
                }}
                className="flex w-full items-center justify-start gap-1 min-w-0 text-[15px] sm:text-[16px] font-medium text-zinc-100 tracking-[-0.3px] overflow-hidden cursor-pointer hover:opacity-80 transition"
              >
                <span className="truncate min-w-0">{chartMetricLabel}</span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#71717A"
                  strokeWidth="2"
                  className={`shrink-0 transition-transform ${chartMetricOpen ? "rotate-180" : ""}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {chartMetricOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => onChartMetricOpenChange(false)}
                  />
                  <div className="absolute left-0 top-full mt-1.5 w-[155px] glass rounded-xl shadow-lg z-50 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top">
                    {CHART_METRICS.map((m) => (
                      <button
                        key={m.key}
                        onClick={() => {
                          onChartMetricChange(m.key);
                          onChartMetricOpenChange(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-[13px] hover:bg-zinc-800/60 flex items-center gap-2.5 transition ${chartMetric === m.key ? "text-[var(--brand-fg)] font-semibold bg-emerald-500/12" : "text-zinc-300"}`}
                      >
                        {m.label}
                        {chartMetric === m.key && (
                          <svg
                            className="ml-auto shrink-0"
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <span className="text-zinc-500 text-[15px] sm:text-[16px] shrink-0">by</span>
            {/* GroupBy dropdown — same as the metric: min-w-0 + w-full button so it
                stays compact when short and truncates (never overlaps) when long. */}
            <div className="relative min-w-0">
              <button
                onClick={() => {
                  onChartGroupByOpenChange(!chartGroupByOpen);
                  onChartMetricOpenChange(false);
                }}
                className="flex w-full items-center justify-start gap-1 min-w-0 text-[15px] sm:text-[16px] font-medium text-zinc-100 tracking-[-0.3px] overflow-hidden cursor-pointer hover:opacity-80 transition"
              >
                <span className="truncate min-w-0">{groupByLabel(chartGroupBy)}</span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#71717A"
                  strokeWidth="2"
                  className={`shrink-0 transition-transform ${chartGroupByOpen ? "rotate-180" : ""}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {chartGroupByOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => onChartGroupByOpenChange(false)}
                  />
                  <div className="absolute left-0 top-full mt-1.5 w-[175px] glass rounded-xl shadow-lg z-50 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top">
                    {CHART_GROUPBY.map((g) => (
                      <button
                        key={g}
                        onClick={() => {
                          onChartGroupByChange(g);
                          onChartGroupByOpenChange(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-[13px] hover:bg-zinc-800/60 flex items-center gap-2.5 transition ${chartGroupBy === g ? "text-[var(--brand-fg)] font-semibold bg-emerald-500/12" : "text-zinc-300"}`}
                      >
                        {groupByLabel(g)}
                        {chartGroupBy === g && (
                          <svg
                            className="ml-auto shrink-0"
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {activeTab === 1 && (
          <p className="text-[13px] text-zinc-500 flex-1 min-w-0 truncate">
            Conversion value, profit, cost, clicks &amp; ROAS over time
          </p>
        )}
        {activeTab === 2 &&
          (() => {
            const periodWord =
              granularity === "weeks" ? "weeks" : granularity === "months" ? "months" : "days";
            const avgLabel =
              granularity === "weeks"
                ? "Avg Weekly"
                : granularity === "months"
                  ? "Avg Monthly"
                  : "Avg Daily";
            const totalPL = aggregatedPlData[aggregatedPlData.length - 1]?.cumulative || 0;
            return (
              <div className="flex items-center gap-3 flex-wrap text-[13px] flex-1 min-w-0">
                <span className="text-zinc-400">
                  Total:{" "}
                  {/* The colour follows the actual result — profit green, loss red
                      — so Total never reads as "good" when it isn't. */}
                  <span className={`font-bold ${totalPL < 0 ? "text-red-600" : "text-green-700"}`}>
                    {fmtChartMoney(totalPL)}
                  </span>
                </span>
                <span className="text-zinc-500">|</span>
                <span className="text-zinc-400">
                  {avgLabel}:{" "}
                  <span className="font-bold">
                    {fmtChartMoney(
                      (aggregatedPlData[aggregatedPlData.length - 1]?.cumulative || 0) /
                        Math.max(1, aggregatedPlData.length),
                    )}
                  </span>
                </span>
                <span className="text-zinc-500">|</span>
                <span className="text-green-600 font-semibold">
                  ↗ {aggregatedPlData.filter((d) => d.dailyProfit > 0).length} {periodWord}
                </span>
                <span className="text-zinc-500">|</span>
                <span className="text-red-500 font-semibold">
                  ↘ {aggregatedPlData.filter((d) => d.dailyProfit <= 0).length} {periodWord}
                </span>
              </div>
            );
          })()}
        {activeTab === 4 && (
          <p className="text-[13px] text-zinc-500 flex-1 min-w-0 truncate">
            Total sales, orders &amp; average order value over time
          </p>
        )}
        {activeTab !== 0 && activeTab !== 1 && activeTab !== 2 && activeTab !== 4 && (
          <div className="flex-1" />
        )}
        {activeTab !== 3 && (
          <div className="relative shrink-0">
            <button
              onClick={() => onGranularityOpenChange(!granularityOpen)}
              className="flex items-center gap-2 bg-zinc-800/50 border border-zinc-700/60 rounded-xl px-4 py-2 cursor-pointer hover:bg-zinc-800/60 whitespace-nowrap text-[14px] font-medium text-zinc-400"
            >
              {granularity.charAt(0).toUpperCase() + granularity.slice(1)}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#71717A"
                strokeWidth="2"
                className={`transition-transform ${granularityOpen ? "rotate-180" : ""}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {granularityOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => onGranularityOpenChange(false)}
                />
                <div className="absolute right-0 top-full mt-1.5 w-[120px] glass rounded-xl shadow-lg z-50 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top-right">
                  {(["days", "weeks", "months"] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => {
                        onGranularityChange(g);
                        onGranularityOpenChange(false);
                      }}
                      className={`w-full text-left px-3.5 py-2 text-[13px] hover:bg-zinc-800/60 flex items-center justify-between transition ${granularity === g ? "text-[var(--brand-fg)] font-semibold bg-emerald-500/12" : "text-zinc-300"}`}
                    >
                      {g.charAt(0).toUpperCase() + g.slice(1)}
                      {granularity === g && (
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Period Analysis chart ── */}
      {activeTab === 0 &&
        (() => {
          // The chart renders whenever the selected metric has ANY non-zero value
          // (positive or negative). If the filtered dataset has records but this metric
          // is all-zero → metric-specific message. Only a truly empty dataset (no records
          // after filtering) shows "No data available".
          const metricHasValue = aggregatedBarData.some((row) =>
            chartSeries.some(
              (s) =>
                !hiddenSeries.has(s.name) &&
                (rowTypeFilter === null || rowTypeFilter.has(s.name)) &&
                Math.abs((row[s.name] as number) || 0) > 0,
            ),
          );
          return (
            <div key={chartKey} className="chart-fade">
              <div className="sm:overflow-x-auto scrollbar-none -mx-1 px-1 outline-none focus:outline-none">
                <div className={`${scaleH} sm:min-w-[600px] relative`}>
                  {!metricHasValue && (
                    <div className="absolute inset-y-0 left-12 right-4 sm:left-16 sm:right-6 z-10 flex items-center justify-center pointer-events-none">
                      {isLoading ? (
                        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                      ) : hasRecords ? (
                        // Records exist, but every value of this metric is zero.
                        <div className="text-center max-w-xs">
                          <p className="text-[14px] sm:text-[15px] font-semibold text-zinc-300">
                            {`No ${chartMetricLabel.toLowerCase()} during the selected period.`}
                          </p>
                        </div>
                      ) : (
                        <div className="text-center max-w-xs">
                          <p className="text-[14px] sm:text-[15px] font-semibold text-zinc-300 mb-1">
                            No data available
                          </p>
                          <p className="text-[12px] sm:text-[13px] text-zinc-500">
                            Try adjusting the date range, changing the metric, or clearing filters.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {/* View modes + peak/avg strip */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3 px-1">
                    <p className="text-[12px] text-zinc-500">
                      {trendStats.peakDate && (
                        <>
                          Peak:{" "}
                          <span className="text-zinc-300 font-semibold">{trendStats.peakVal}</span>{" "}
                          on{" "}
                          <span className="text-zinc-300 font-semibold">{trendStats.peakDate}</span>
                          {" · "}Avg:{" "}
                          <span className="text-zinc-300 font-semibold">
                            {chartMetricIsMoney
                              ? fmtChartMoney(trendStats.avg)
                              : fmtChartNum(trendStats.avg)}
                          </span>
                          /day
                        </>
                      )}
                    </p>
                    <div className="flex items-center gap-1 bg-zinc-800/50 rounded-xl p-1">
                      {(
                        [
                          ["columns", "Columns"],
                          ["spline", "Spline Area"],
                          ["cumulative", "Cumulative"],
                        ] as const
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          onClick={() => setChartMode(mode)}
                          className={`px-3 py-1.5 rounded-xl text-[12.5px] font-medium transition ${
                            chartMode === mode
                              ? "bg-zinc-900 text-[var(--brand-fg)] shadow-sm"
                              : "text-zinc-400 hover:text-zinc-200"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div
                      className="flex items-center gap-1 bg-zinc-800/50 rounded-xl p-1"
                      title="Chart height"
                    >
                      {(
                        [
                          ["s", "S"],
                          ["m", "M"],
                          ["l", "L"],
                        ] as const
                      ).map(([s, label]) => (
                        <button
                          key={s}
                          onClick={() => setChartScale(s)}
                          className={`w-7 py-1.5 rounded-xl text-[12px] font-semibold transition ${
                            chartScale === s
                              ? "bg-zinc-900 text-[var(--brand-fg)] shadow-sm"
                              : "text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={chartRows}
                      barCategoryGap="18%"
                      margin={{ top: 28, right: 10, left: -10, bottom: isMobile ? 0 : 4 }}
                    >
                      <CartesianGrid vertical={false} strokeDasharray="1 4" stroke="#27272A" />
                      <XAxis
                        dataKey="date"
                        tick={
                          isMobile && chartRows.length > 8
                            ? false
                            : (p) => <BarXTick {...p} data={chartRows} />
                        }
                        axisLine={{ stroke: "#3F3F46", strokeWidth: 1 }}
                        tickLine={false}
                        height={isMobile && aggregatedBarData.length > 8 ? 4 : 30}
                      />
                      <YAxis
                        domain={[0, "auto"]}
                        tick={{ fontSize: 12, fill: "#71717A" }}
                        axisLine={{ stroke: "#3F3F46", strokeWidth: 1 }}
                        tickLine={false}
                        tickFormatter={(v) =>
                          chartMetricIsMoney ? fmtChartMoney(v) : fmtChartNum(v)
                        }
                      />
                      <Tooltip
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        content={(p: any) => <ChartTooltip {...p} isMoney={chartMetricIsMoney} />}
                        cursor={{ fill: "rgba(99, 102, 241, 0.05)" }}
                      />
                      {chartSeries.map(({ name, color }) => {
                        const visibleLast = chartSeries.filter(({ name: n }) => {
                          const isHidden = hiddenSeries.has(n);
                          return !isHidden && (rowTypeFilter === null || rowTypeFilter.has(n));
                        });
                        const isVisibleTop =
                          visibleLast.length > 0 &&
                          visibleLast[visibleLast.length - 1].name === name;
                        const isHidden =
                          hiddenSeries.has(name) ||
                          (rowTypeFilter !== null && !rowTypeFilter.has(name));
                        const isCampaignGroupBy = chartGroupBy === "Campaign";
                        // Tapping a segment used to filter the dashboard to
                        // that campaign. People tap it to read the tooltip —
                        // on a phone there is no other way to see the value —
                        // and landed in a filtered view they hadn't asked for.
                        // Reading is now all a segment does here. The dimming
                        // stays: it still reflects a filter set elsewhere.
                        // Drill-down is OFF for every connector (was already off
                        // for Google Ads): clicking a bar must not filter, swap the
                        // table, or descend a level — the chart only visualises.
                        // Shared here so no current or future source re-enables it.
                        const drillDown = false;
                        const isOthers = name === "Others";
                        // Spline Area mode: smooth stacked areas instead of columns.
                        if (chartMode === "spline") {
                          return (
                            <Area
                              key={name}
                              dataKey={name}
                              stackId="a"
                              type="monotone"
                              stroke={color}
                              strokeWidth={2}
                              fill={color}
                              fillOpacity={0.22}
                              hide={isHidden}
                              isAnimationActive={true}
                              animationDuration={700}
                              animationEasing="ease-out"
                            />
                          );
                        }
                        const isBarSelected =
                          isCampaignGroupBy &&
                          (isOthers
                            ? othersSelected
                            : (filters["campaign_selected"] ?? []).includes(name));
                        // Removed renderColumnTopLabel because we use a dedicated Line component for labels
                        return (
                          <Bar
                            key={name}
                            dataKey={name}
                            stackId="a"
                            fill={color}
                            fillOpacity={
                              isCampaignGroupBy && selectedCampaignCount > 0 && !isBarSelected
                                ? 0.35
                                : 1
                            }
                            hide={isHidden}
                            radius={[6, 6, 6, 6]}
                            isAnimationActive={true}
                            animationDuration={700}
                            animationEasing="ease-out"
                            style={drillDown ? { cursor: "pointer" } : undefined}
                            onClick={
                              drillDown
                                ? () => {
                                    if (isOthers) {
                                      // Toggle the whole Others campaign set.
                                      if (othersSelected || othersNames.length === 0)
                                        clearFilter("campaign_selected");
                                      else setFilter("campaign_selected", othersNames);
                                    } else if (isBarSelected && selectedCampaignCount === 1) {
                                      clearFilter("campaign_selected");
                                    } else {
                                      selectSingle("campaign_selected", name);
                                    }
                                  }
                                : undefined
                            }
                          ></Bar>
                        );
                      })}
                      {/* Spline overlay: total across visible series, so the columns
                          always read against a smooth trend line (never "just bars"). */}
                      <Line
                        type="monotone"
                        dataKey={
                          ((row: Record<string, string | number>) =>
                            chartSeries
                              .filter(({ name }) => !hiddenSeries.has(name))
                              .reduce(
                                (s, { name }) => s + ((row[name] as number) || 0),
                                0,
                              )) as never
                        }
                        stroke="var(--brand-fg)"
                        strokeWidth={2}
                        strokeOpacity={0.9}
                        dot={false}
                        activeDot={{ r: 3.5, fill: "var(--brand-fg)", strokeWidth: 0 }}
                        isAnimationActive={false}
                        hide={chartMode !== "columns"}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {/* Timeline for Mobile */}
                <div className="sm:hidden">
                  <Timeline
                    dates={aggregatedBarData.map((d) => String(d.date))}
                    timelineOpen={timelineOpen}
                    customEvents={customEvents}
                    autoSourceLabel={autoSourceLabel}
                    granularity={granularity}
                    onToggle={onToggleTimeline}
                    onAddEvent={onAddEvent}
                    onDeleteEvent={onDeleteEvent}
                    onEditEvent={onEditEvent}
                    isMobile={true}
                  />
                </div>

                {/* Legend inside the scroll container */}
                <div className="sm:hidden mt-2 flex flex-wrap gap-2 justify-center">
                  {(() => {
                    const legendSeries = chartSeries.filter(
                      ({ name }) =>
                        (rowTypeFilter === null || rowTypeFilter.has(name)) &&
                        aggregatedBarData.some((row) => ((row[name] as number) || 0) > 0),
                    );
                    const items = legendExpanded
                      ? legendSeries
                      : legendSeries.slice(0, LEGEND_LIMIT);
                    return (
                      <>
                        {items.map(({ name, color }) => {
                          const hidden = hiddenSeries.has(name);
                          return (
                            <button
                              key={name}
                              onClick={() => onToggleSeries(name)}
                              className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-[13px] cursor-pointer select-none transition-opacity hover:opacity-80"
                              style={{ opacity: hidden ? 0.38 : 1 }}
                            >
                              <div
                                className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-sm shrink-0 transition-all"
                                style={{ background: hidden ? "#71717A" : color }}
                              />
                              <span
                                className={`transition-all ${hidden ? "line-through text-zinc-500" : "text-zinc-400"}`}
                              >
                                {name}
                              </span>
                            </button>
                          );
                        })}
                        {legendSeries.length > LEGEND_LIMIT && (
                          <button
                            onClick={() => setLegendExpanded((v) => !v)}
                            className="flex items-center gap-1 text-[11px] sm:text-[13px] text-emerald-500 hover:text-[var(--brand-fg)] font-medium transition-colors select-none"
                          >
                            {legendExpanded
                              ? "↑ Show less"
                              : `+${legendSeries.length - LEGEND_LIMIT} more...`}
                          </button>
                        )}
                        {selectedCampaignCount > 0 && (
                          <button
                            onClick={() => {
                              clearFilter("campaign_selected");
                              onClearRowFilter();
                            }}
                            className="flex items-center gap-1 text-[11px] text-red-500 font-medium select-none bg-red-500/10 px-2 py-0.5 rounded-md"
                          >
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                            >
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            Clear ({selectedCampaignCount})
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>

                <div className="hidden sm:flex flex-wrap gap-x-3 gap-y-2 mt-3 mb-8 justify-center sticky left-0 w-full z-20">
                  {(() => {
                    const legendSeries = chartSeries.filter(
                      ({ name }) =>
                        (rowTypeFilter === null || rowTypeFilter.has(name)) &&
                        aggregatedBarData.some((row) => ((row[name] as number) || 0) > 0),
                    );
                    const items = legendExpanded
                      ? legendSeries
                      : legendSeries.slice(0, LEGEND_LIMIT);
                    return (
                      <>
                        {items.map(({ name, color }) => {
                          const hidden = hiddenSeries.has(name);
                          return (
                            <button
                              key={name}
                              onClick={() => onToggleSeries(name)}
                              className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-[13px] cursor-pointer select-none transition-opacity hover:opacity-80 bg-zinc-900/80 backdrop-blur-sm px-1.5 py-0.5 rounded-md"
                              style={{ opacity: hidden ? 0.38 : 1 }}
                            >
                              <div
                                className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-sm shrink-0 transition-all"
                                style={{ background: hidden ? "#71717A" : color }}
                              />
                              <span
                                className={`transition-all ${hidden ? "line-through text-zinc-500" : "text-zinc-400"}`}
                              >
                                {name}
                              </span>
                            </button>
                          );
                        })}
                        {legendSeries.length > LEGEND_LIMIT && (
                          <button
                            onClick={() => setLegendExpanded((v) => !v)}
                            className="flex items-center gap-1 text-[11px] sm:text-[13px] text-emerald-500 hover:text-[var(--brand-fg)] font-medium transition-colors select-none bg-zinc-900/80 backdrop-blur-sm px-1.5 py-0.5 rounded-md"
                          >
                            {legendExpanded
                              ? "↑ Show less"
                              : `+${legendSeries.length - LEGEND_LIMIT} more...`}
                          </button>
                        )}
                        {selectedCampaignCount > 0 && (
                          <button
                            onClick={() => {
                              clearFilter("campaign_selected");
                              onClearRowFilter();
                            }}
                            className="flex items-center gap-1 text-[11px] sm:text-[13px] text-red-500 hover:text-red-700 font-medium transition-colors select-none bg-red-500/10 px-2 py-0.5 rounded-md cursor-pointer"
                          >
                            <svg
                              width="11"
                              height="11"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                            >
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            Clear ({selectedCampaignCount})
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* Timeline for Desktop */}
                <div className="hidden sm:block">
                  <Timeline
                    dates={aggregatedBarData.map((d) => String(d.date))}
                    timelineOpen={timelineOpen}
                    customEvents={customEvents}
                    autoSourceLabel={autoSourceLabel}
                    granularity={granularity}
                    onToggle={onToggleTimeline}
                    onAddEvent={onAddEvent}
                    onDeleteEvent={onDeleteEvent}
                    onEditEvent={onEditEvent}
                    isMobile={false}
                  />
                </div>
              </div>
            </div>
          );
        })()}

      {/* ── Ad Performance chart ── */}
      {activeTab === 1 && (
        <div key={chartKey} className="chart-fade">
          <div className="sm:overflow-x-auto scrollbar-none -mx-1 px-1 outline-none focus:outline-none">
            <div className="h-[300px] sm:h-[380px] lg:h-[440px] sm:min-w-[600px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={aggregatedAdPerfData}
                  barCategoryGap="18%"
                  margin={{ top: 28, right: 10, left: -10, bottom: isMobile ? 0 : 4 }}
                >
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="1 4"
                    stroke="#27272A"
                    yAxisId="left"
                  />
                  <XAxis
                    dataKey="date"
                    tick={
                      isMobile && aggregatedAdPerfData.length > 8
                        ? false
                        : (p) => <AdXTick {...p} data={aggregatedAdPerfData} />
                    }
                    axisLine={{ stroke: "#3F3F46", strokeWidth: 1 }}
                    tickLine={false}
                    height={isMobile && aggregatedAdPerfData.length > 8 ? 4 : 30}
                  />
                  {/* Domain drops below 0 only when a loss segment exists, so profitable
                      periods keep the axis anchored at 0 (no reserved empty space). */}
                  <YAxis
                    yAxisId="left"
                    domain={[
                      (dataMin: number) => (dataMin < 0 ? Math.floor(dataMin * 1.1) : 0),
                      "auto",
                    ]}
                    tick={{ fontSize: 12, fill: "#71717A" }}
                    axisLine={{ stroke: "#3F3F46", strokeWidth: 1 }}
                    tickLine={false}
                    tickFormatter={(v) => fmtChartMoney(v)}
                  />
                  <YAxis yAxisId="right" orientation="right" hide domain={[0, 6]} />
                  {/* Clicks use a separate (hidden) scale — counts, not $ — with top
                      headroom so the dashed line never reaches/clips the chart top. */}
                  <YAxis
                    yAxisId="clicks"
                    orientation="right"
                    hide
                    tickFormatter={(v) => fmtChartNum(v)}
                    domain={[0, (max: number) => Math.max(1, Math.ceil(max * 1.2))]}
                  />
                  <ReferenceLine yAxisId="left" y={0} stroke="#3F3F46" strokeWidth={1} />
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    content={(p: any) => <AdTooltip {...p} data={aggregatedAdPerfData} />}
                    cursor={{ fill: "rgba(99,102,241,0.04)" }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="costBar"
                    stackId="a"
                    fill="#F87171"
                    fillOpacity={0.9}
                    radius={[6, 6, 6, 6]}
                    hide={hiddenAdPerf.has("cost")}
                    isAnimationActive={true}
                    animationDuration={700}
                    animationEasing="ease-out"
                  >
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <LabelList dataKey="costBar" content={renderCostLabel as any} />
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <LabelList dataKey="costBar" content={renderLossTopLabel as any} />
                  </Bar>
                  <Bar
                    yAxisId="left"
                    dataKey="profitBar"
                    stackId="a"
                    fill="#4ADE80"
                    radius={[6, 6, 6, 6]}
                    hide={hiddenAdPerf.has("profit")}
                    isAnimationActive={true}
                    animationDuration={700}
                    animationEasing="ease-out"
                  >
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <LabelList dataKey="profitBar" content={renderProfitLabel as any} />
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <LabelList dataKey="profitBar" content={renderConvLabel as any} />
                  </Bar>
                  {/* Loss segment — the NEGATIVE profit (Revenue − Cost) drawn below the
                      X axis in a darker red so a losing period is unmistakable. Stacked in
                      the same "a" stack: positive cost/profit stack up, this stacks down. */}
                  <Bar
                    yAxisId="left"
                    dataKey="lossBar"
                    stackId="a"
                    fill="#B91C1C"
                    radius={[6, 6, 6, 6]}
                    hide={hiddenAdPerf.has("loss")}
                    isAnimationActive={true}
                    animationDuration={700}
                    animationEasing="ease-out"
                  >
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <LabelList dataKey="lossBar" content={renderLossSegLabel as any} />
                  </Bar>
                  {/* Profit spline — the smooth trend over the profit stack, so the
                      chart reads against a curve rather than bare columns. */}
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="profitBar"
                    stroke="var(--brand-fg)"
                    strokeWidth={2}
                    strokeOpacity={0.9}
                    dot={false}
                    activeDot={{ r: 3.5, fill: "var(--brand-fg)", strokeWidth: 0 }}
                    hide={hiddenAdPerf.has("profit")}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="clicks"
                    type="monotone"
                    dataKey="clicks"
                    stroke="#D4D4D8"
                    strokeWidth={1.5}
                    strokeDasharray="1 4"
                    dot={false}
                    activeDot={{ r: 4, fill: "#D4D4D8" }}
                    hide={hiddenAdPerf.has("clicks")}
                    isAnimationActive={true}
                    animationDuration={700}
                    animationEasing="ease-out"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* Timeline for Mobile */}
            <div className="sm:hidden">
              <Timeline
                dates={aggregatedAdPerfData.map((d) => String(d.date))}
                timelineOpen={timelineOpen}
                customEvents={customEvents}
                autoSourceLabel={autoSourceLabel}
                granularity={granularity}
                onToggle={onToggleTimeline}
                onAddEvent={onAddEvent}
                onDeleteEvent={onDeleteEvent}
                onEditEvent={onEditEvent}
                isMobile={true}
              />
            </div>

            <div className="sm:hidden mt-2 flex flex-wrap gap-2 justify-center">
              {(
                [
                  { key: "profit", label: "Profit", color: "#4ADE80" },
                  { key: "cost", label: "Cost", color: "#F87171" },
                  { key: "loss", label: "Loss", color: "#B91C1C" },
                  { key: "clicks", label: "Clicks", color: "#D4D4D8", line: true },
                ] as {
                  key: string;
                  label: string;
                  color: string;
                  line?: boolean;
                  dot?: boolean;
                  dual?: boolean;
                }[]
              ).map(({ key, label, color, line, dot, dual }) => {
                const hidden = hiddenAdPerf.has(key);
                return (
                  <button
                    key={key}
                    onClick={() => {
                      const n = new Set(hiddenAdPerf);
                      n.has(key) ? n.delete(key) : n.add(key);
                      onHiddenAdPerfChange(n);
                    }}
                    className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-[13px] cursor-pointer select-none transition-opacity hover:opacity-80"
                    style={{ opacity: hidden ? 0.38 : 1 }}
                  >
                    {dual ? (
                      // Cumulative can end in profit or loss, so its key shows
                      // both colours — a green and a red dot side by side.
                      <span className="flex items-center gap-0.5 shrink-0">
                        <span
                          className="w-2 h-2 rounded-full transition-all"
                          style={{ background: hidden ? "#71717A" : "#22C55E" }}
                        />
                        <span
                          className="w-2 h-2 rounded-full transition-all"
                          style={{ background: hidden ? "#71717A" : "#EF4444" }}
                        />
                      </span>
                    ) : line ? (
                      <svg width="16" height="4">
                        <line
                          x1="0"
                          y1="2"
                          x2="16"
                          y2="2"
                          stroke={hidden ? "#71717A" : color}
                          strokeWidth="1.5"
                          strokeDasharray="1 4"
                        />
                      </svg>
                    ) : dot ? (
                      <div
                        className="w-2 h-2 rounded-full shrink-0 transition-all"
                        style={{ background: hidden ? "#71717A" : color }}
                      />
                    ) : (
                      <div
                        className="w-2 h-2 rounded-sm shrink-0 transition-all"
                        style={{ background: hidden ? "#71717A" : color }}
                      />
                    )}
                    <span
                      className={`transition-all ${hidden ? "line-through text-zinc-500" : "text-zinc-400"}`}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="hidden sm:flex flex-wrap gap-x-3 gap-y-2 mt-3 mb-8 justify-center sticky left-0 w-full z-20">
              {(
                [
                  { key: "profit", label: "Profit", color: "#4ADE80" },
                  { key: "cost", label: "Cost", color: "#F87171" },
                  { key: "loss", label: "Loss", color: "#B91C1C" },
                  { key: "clicks", label: "Clicks", color: "#D4D4D8", line: true },
                ] as {
                  key: string;
                  label: string;
                  color: string;
                  line?: boolean;
                  dot?: boolean;
                  dual?: boolean;
                }[]
              ).map(({ key, label, color, line, dot, dual }) => {
                const hidden = hiddenAdPerf.has(key);
                return (
                  <button
                    key={key}
                    onClick={() => {
                      const n = new Set(hiddenAdPerf);
                      n.has(key) ? n.delete(key) : n.add(key);
                      onHiddenAdPerfChange(n);
                    }}
                    className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-[13px] cursor-pointer select-none transition-opacity hover:opacity-80 bg-zinc-900/80 backdrop-blur-sm px-1.5 py-0.5 rounded-md"
                    style={{ opacity: hidden ? 0.38 : 1 }}
                  >
                    {dual ? (
                      // Cumulative can end in profit or loss, so its key shows
                      // both colours — a green and a red dot side by side.
                      <span className="flex items-center gap-0.5 shrink-0">
                        <span
                          className="w-2 h-2 rounded-full transition-all"
                          style={{ background: hidden ? "#71717A" : "#22C55E" }}
                        />
                        <span
                          className="w-2 h-2 rounded-full transition-all"
                          style={{ background: hidden ? "#71717A" : "#EF4444" }}
                        />
                      </span>
                    ) : line ? (
                      <svg width="16" height="4">
                        <line
                          x1="0"
                          y1="2"
                          x2="16"
                          y2="2"
                          stroke={hidden ? "#71717A" : color}
                          strokeWidth="1.5"
                          strokeDasharray="1 4"
                        />
                      </svg>
                    ) : dot ? (
                      <div
                        className="w-2 h-2 rounded-full shrink-0 transition-all"
                        style={{ background: hidden ? "#71717A" : color }}
                      />
                    ) : (
                      <div
                        className="w-2 h-2 rounded-sm shrink-0 transition-all"
                        style={{ background: hidden ? "#71717A" : color }}
                      />
                    )}
                    <span
                      className={`transition-all ${hidden ? "line-through text-zinc-500" : "text-zinc-400"}`}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Timeline for Desktop */}
            <div className="hidden sm:block">
              <Timeline
                dates={aggregatedAdPerfData.map((d) => String(d.date))}
                timelineOpen={timelineOpen}
                customEvents={customEvents}
                autoSourceLabel={autoSourceLabel}
                granularity={granularity}
                onToggle={onToggleTimeline}
                onAddEvent={onAddEvent}
                onDeleteEvent={onDeleteEvent}
                onEditEvent={onEditEvent}
                isMobile={false}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Profit / Loss chart ── */}
      {activeTab === 2 && (
        <div key={chartKey} className="chart-fade">
          <div className="sm:overflow-x-auto scrollbar-none -mx-1 px-1 outline-none focus:outline-none">
            <div className="h-[300px] sm:h-[380px] lg:h-[440px] sm:min-w-[600px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={aggregatedPlData}
                  barCategoryGap="18%"
                  margin={{ top: 28, right: 10, left: -10, bottom: 4 }}
                >
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="1 4"
                    stroke="#27272A"
                    yAxisId="left"
                  />
                  <XAxis
                    dataKey="date"
                    tick={
                      isMobile && aggregatedPlData.length > 8
                        ? false
                        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          (p: any) => <PlXTick {...p} data={aggregatedPlData} />
                    }
                    height={isMobile && aggregatedPlData.length > 8 ? 4 : undefined}
                    axisLine={{ stroke: "#3F3F46", strokeWidth: 1 }}
                    tickLine={false}
                  />
                  {/* Single shared axis for bars + line. Domain hugs the ACTUAL data:
                      bottom is 0 when nothing is negative (no reserved empty space below),
                      otherwise the real minimum; top is the real max. No artificial
                      headroom that previously reserved ~-85K below the chart (#3). */}
                  <YAxis
                    yAxisId="left"
                    domain={[
                      (dataMin: number) => (dataMin < 0 ? Math.floor(dataMin * 1.05) : 0),
                      (dataMax: number) => Math.ceil(dataMax * 1.02),
                    ]}
                    tick={{ fontSize: 12, fill: "#71717A" }}
                    axisLine={{ stroke: "#3F3F46", strokeWidth: 1 }}
                    tickLine={false}
                    tickFormatter={(v) => fmtChartMoney(v)}
                  />
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    content={(p: any) => <PlTooltip {...p} data={aggregatedPlData} />}
                    cursor={{ fill: "rgba(99,102,241,0.04)" }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="cumulative"
                    radius={[6, 6, 6, 6]}
                    hide={hiddenPL.has("cumulative")}
                    isAnimationActive={true}
                    animationDuration={700}
                    animationEasing="ease-out"
                  >
                    {aggregatedPlData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.cumulative < 0 ? "#F87171" : "#4ADE80"} />
                    ))}
                    <LabelList dataKey="cumulative" content={renderPlLabel} />
                  </Bar>
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="dailyProfit"
                    stroke="var(--brand-fg)"
                    strokeWidth={2}
                    strokeOpacity={0.9}
                    hide={hiddenPL.has("daily")}
                    isAnimationActive={true}
                    animationDuration={700}
                    animationEasing="ease-out"
                    dot={(dotProps: unknown) => {
                      const p = dotProps as { cx: number; cy: number; index: number; key?: string };
                      const item = aggregatedPlData[p.index];
                      return (
                        <circle
                          key={p.index}
                          cx={p.cx}
                          cy={p.cy}
                          r={3}
                          fill={item && item.dailyProfit < 0 ? "#EF4444" : "#D4D4D8"}
                          stroke="none"
                        />
                      );
                    }}
                    activeDot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* Timeline for Mobile */}
            <div className="sm:hidden">
              <Timeline
                dates={aggregatedPlData.map((d) => String(d.date))}
                timelineOpen={timelineOpen}
                customEvents={customEvents}
                autoSourceLabel={autoSourceLabel}
                granularity={granularity}
                onToggle={onToggleTimeline}
                onAddEvent={onAddEvent}
                onDeleteEvent={onDeleteEvent}
                onEditEvent={onEditEvent}
                isMobile={true}
              />
            </div>

            <div className="sm:hidden mt-2 flex flex-wrap gap-2 justify-center">
              {(
                [
                  {
                    key: "cumulative",
                    label: "Cumulative Profit / Loss",
                    color: "#22C55E",
                    dual: true,
                  },
                  { key: "daily", label: "Daily Profit / Loss", color: "#D4D4D8", line: true },
                ] as {
                  key: string;
                  label: string;
                  color: string;
                  line?: boolean;
                  dot?: boolean;
                  dual?: boolean;
                }[]
              ).map(({ key, label, color, line, dot, dual }) => {
                const hidden = hiddenPL.has(key);
                const toggleKey = key === "loss" ? "daily" : key;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      const n = new Set(hiddenPL);
                      n.has(toggleKey) ? n.delete(toggleKey) : n.add(toggleKey);
                      onHiddenPLChange(n);
                    }}
                    className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-[13px] cursor-pointer select-none transition-opacity hover:opacity-80"
                    style={{ opacity: hidden ? 0.38 : 1 }}
                  >
                    {dual ? (
                      // Cumulative can end in profit or loss, so its key shows
                      // both colours — a green and a red dot side by side.
                      <span className="flex items-center gap-0.5 shrink-0">
                        <span
                          className="w-2 h-2 rounded-full transition-all"
                          style={{ background: hidden ? "#71717A" : "#22C55E" }}
                        />
                        <span
                          className="w-2 h-2 rounded-full transition-all"
                          style={{ background: hidden ? "#71717A" : "#EF4444" }}
                        />
                      </span>
                    ) : line ? (
                      <svg width="16" height="4">
                        <line
                          x1="0"
                          y1="2"
                          x2="16"
                          y2="2"
                          stroke={hidden ? "#71717A" : color}
                          strokeWidth="1.5"
                          strokeDasharray="1 4"
                        />
                      </svg>
                    ) : dot ? (
                      <div
                        className="w-2 h-2 rounded-full shrink-0 transition-all"
                        style={{ background: hidden ? "#71717A" : color }}
                      />
                    ) : (
                      <div
                        className="w-2 h-2 rounded-sm shrink-0 transition-all"
                        style={{ background: hidden ? "#71717A" : color }}
                      />
                    )}
                    <span
                      className={`transition-all ${hidden ? "line-through text-zinc-500" : "text-zinc-400"}`}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="hidden sm:flex flex-wrap gap-x-3 gap-y-2 mt-3 mb-8 justify-center sticky left-0 w-full z-20">
              {(
                [
                  {
                    key: "cumulative",
                    label: "Cumulative Profit / Loss",
                    color: "#22C55E",
                    dual: true,
                  },
                  { key: "daily", label: "Daily Profit / Loss", color: "#D4D4D8", line: true },
                ] as {
                  key: string;
                  label: string;
                  color: string;
                  line?: boolean;
                  dot?: boolean;
                  dual?: boolean;
                }[]
              ).map(({ key, label, color, line, dot, dual }) => {
                const hidden = hiddenPL.has(key);
                const toggleKey = key === "loss" ? "daily" : key;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      const n = new Set(hiddenPL);
                      n.has(toggleKey) ? n.delete(toggleKey) : n.add(toggleKey);
                      onHiddenPLChange(n);
                    }}
                    className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-[13px] cursor-pointer select-none transition-opacity hover:opacity-80 bg-zinc-900/80 backdrop-blur-sm px-1.5 py-0.5 rounded-md"
                    style={{ opacity: hidden ? 0.38 : 1 }}
                  >
                    {dual ? (
                      // Cumulative can end in profit or loss, so its key shows
                      // both colours — a green and a red dot side by side.
                      <span className="flex items-center gap-0.5 shrink-0">
                        <span
                          className="w-2 h-2 rounded-full transition-all"
                          style={{ background: hidden ? "#71717A" : "#22C55E" }}
                        />
                        <span
                          className="w-2 h-2 rounded-full transition-all"
                          style={{ background: hidden ? "#71717A" : "#EF4444" }}
                        />
                      </span>
                    ) : line ? (
                      <svg width="16" height="4">
                        <line
                          x1="0"
                          y1="2"
                          x2="16"
                          y2="2"
                          stroke={hidden ? "#71717A" : color}
                          strokeWidth="1.5"
                          strokeDasharray="1 4"
                        />
                      </svg>
                    ) : dot ? (
                      <div
                        className="w-2 h-2 rounded-full shrink-0 transition-all"
                        style={{ background: hidden ? "#71717A" : color }}
                      />
                    ) : (
                      <div
                        className="w-2 h-2 rounded-sm shrink-0 transition-all"
                        style={{ background: hidden ? "#71717A" : color }}
                      />
                    )}
                    <span
                      className={`transition-all ${hidden ? "line-through text-zinc-500" : "text-zinc-400"}`}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Timeline for Desktop */}
            <div className="hidden sm:block">
              <Timeline
                dates={aggregatedPlData.map((d) => String(d.date))}
                timelineOpen={timelineOpen}
                customEvents={customEvents}
                autoSourceLabel={autoSourceLabel}
                granularity={granularity}
                onToggle={onToggleTimeline}
                onAddEvent={onAddEvent}
                onDeleteEvent={onDeleteEvent}
                onEditEvent={onEditEvent}
                isMobile={false}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Segments chart ── */}
      {activeTab === 3 && (
        // pb restores the white gap below the donut cards — the chart card wraps this
        // with sm:pb-0 (inner blocks own their bottom spacing), so without it the
        // coloured cards touched the card's bottom edge and looked cut off.
        <div key={chartKey} className="chart-fade pb-4 sm:pb-6">
          {/* Mobile: first donut only, full width */}
          <div className="sm:hidden">
            <SegmentDonut
              initialMetricIndex={0}
              buildData={buildSegData}
              dateFrom={segDateFrom}
              dateTo={segDateTo}
            />
          </div>
          {/* Desktop: 3 columns */}
          <div className="hidden sm:grid grid-cols-1 lg:grid-cols-3 gap-4">
            <SegmentDonut
              initialMetricIndex={0}
              buildData={buildSegData}
              colorScheme="blue"
              dateFrom={segDateFrom}
              dateTo={segDateTo}
            />
            <SegmentDonut
              initialMetricIndex={1}
              buildData={buildSegData}
              colorScheme="green"
              dateFrom={segDateFrom}
              dateTo={segDateTo}
            />
            <SegmentDonut
              initialMetricIndex={2}
              buildData={buildSegData}
              colorScheme="violet"
              dateFrom={segDateFrom}
              dateTo={segDateTo}
            />
          </div>
        </div>
      )}

      {/* Sales — the cost-free sources' answer to Ad Performance. Same period data,
          but read as commerce: sales as bars, orders as a line on their own (count)
          scale, and AOV derived per period in the tooltip. */}
      {activeTab === 4 && (
        <div key={chartKey} className="chart-fade">
          <div className="sm:overflow-x-auto scrollbar-none -mx-1 px-1 outline-none focus:outline-none">
            <div className="h-[300px] sm:h-[380px] lg:h-[440px] sm:min-w-[600px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={aggregatedAdPerfData}
                  barCategoryGap="18%"
                  margin={{ top: 28, right: 10, left: -10, bottom: isMobile ? 0 : 4 }}
                >
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="1 4"
                    stroke="#27272A"
                    yAxisId="left"
                  />
                  <XAxis
                    dataKey="date"
                    tick={
                      isMobile && aggregatedAdPerfData.length > 8
                        ? false
                        : (p) => <AdXTick {...p} data={aggregatedAdPerfData} />
                    }
                    axisLine={{ stroke: "#3F3F46", strokeWidth: 1 }}
                    tickLine={false}
                    height={isMobile && aggregatedAdPerfData.length > 8 ? 4 : 30}
                  />
                  <YAxis
                    yAxisId="left"
                    domain={[0, "auto"]}
                    tick={{ fontSize: 12, fill: "#71717A" }}
                    axisLine={{ stroke: "#3F3F46", strokeWidth: 1 }}
                    tickLine={false}
                    tickFormatter={(v) => fmtChartMoney(v)}
                  />
                  {/* Orders are counts, not money — their own hidden scale with headroom
                      so the line never clips the top of the plot. */}
                  <YAxis
                    yAxisId="orders"
                    orientation="right"
                    hide
                    domain={[0, (max: number) => Math.max(1, Math.ceil(max * 1.25))]}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(99,102,241,0.04)" }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    content={({ active, payload, label }: any) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as { convValue: number; conv: number };
                      const aov = d.conv > 0 ? d.convValue / d.conv : 0;
                      return (
                        <div className="glass rounded-xl shadow-lg px-3 py-2 text-[12px]">
                          <p className="font-semibold text-zinc-200 mb-1">{label}</p>
                          <p className="text-zinc-400">
                            Total sales:{" "}
                            <span className="font-semibold text-zinc-100">
                              {fmtChartMoney(d.convValue)}
                            </span>
                          </p>
                          <p className="text-zinc-400">
                            Orders:{" "}
                            <span className="font-semibold text-zinc-100">
                              {fmtChartNum(d.conv)}
                            </span>
                          </p>
                          <p className="text-zinc-400">
                            AOV:{" "}
                            <span className="font-semibold text-zinc-100">
                              {fmtChartMoney(aov)}
                            </span>
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="convValue"
                    fill="#4ADE80"
                    radius={[6, 6, 6, 6]}
                    isAnimationActive={true}
                    animationDuration={700}
                    animationEasing="ease-out"
                  />
                  <Line
                    yAxisId="orders"
                    type="monotone"
                    dataKey="conv"
                    stroke="var(--brand-fg)"
                    strokeWidth={2}
                    strokeOpacity={0.9}
                    dot={false}
                    activeDot={{ r: 4, fill: "#D4D4D8" }}
                    isAnimationActive={true}
                    animationDuration={700}
                    animationEasing="ease-out"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="flex items-center justify-center gap-5 pb-4 sm:pb-5 text-[12px] text-zinc-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#4ADE80]" />
              Total sales
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 border-t-2 border-dashed border-[#D4D4D8]" />
              Orders
            </span>
          </div>
        </div>
      )}
    </>
  );
}
