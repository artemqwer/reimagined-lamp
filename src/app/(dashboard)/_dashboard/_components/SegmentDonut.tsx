"use client";

import React, { useState, useMemo, useEffect } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { SEG_COLORS, fmtChartNum, fmtChartMoney } from "../_data/constants";
import { dimApiBase } from "@/lib/dataSource";
import { useCrossFilter } from "@/lib/store";
import { getConnector, chartDimensionList, chartMetricList } from "@/lib/connectors";

type SegBy = string;

function fmtSegVal(v: number, isMoney: boolean): string {
  // Monetary segment values are stored in "K" units → back to raw for adaptive $.
  return isMoney ? fmtChartMoney(v * 1000) : fmtChartNum(v);
}

interface SegmentDonutProps {
  // Which of the source's own metrics this donut opens on, by position in that
  // list. A fixed metric name can't be used: the list is the source's, and
  // Search Console has no Revenue or Conversions to open on.
  initialMetricIndex?: number;
  colorScheme?: "blue" | "green" | "violet";
  buildData: (metric: string, segBy: string) => { name: string; value: number }[];
  dateFrom: string;
  dateTo: string;
}

export default function SegmentDonut({
  initialMetricIndex = 0,
  colorScheme = "blue",
  buildData,
  dateFrom,
  dateTo,
}: SegmentDonutProps) {
  const activeConnector = useCrossFilter((s) => s.activeConnector);
  const connectorConfigs = useCrossFilter((s) => s.connectorConfigs);
  const c = getConnector(activeConnector);

  // Every source, Google Ads included, offers its primary entity plus the
  // breakdowns the admin left ticked for charts — the same list the Trends
  // chart and the tables use. Google Ads used to keep a hand-picked four here,
  // so its Charts checkboxes in the admin panel changed nothing.
  const segByTables = useMemo(
    () => chartDimensionList(c.id, connectorConfigs[c.id]?.dimensions),
    [c.id, connectorConfigs],
  );
  const segByOptions = useMemo<string[]>(
    () => [c.primaryLabel, ...segByTables.map((t) => t.dimensionLabel)],
    [c.primaryLabel, segByTables],
  );

  // The same list the Trends chart offers: this source's own metric columns,
  // minus what the admin hid or unticked for charts. It used to be a fixed
  // Revenue / Ad Profit / Conversions / Traffic / Cost set, so on another
  // source these dropdowns offered metrics it doesn't have and none of the
  // ones it does.
  const metricOptions = useMemo(
    () => chartMetricList(c.id, connectorConfigs[c.id]?.metrics),
    [c.id, connectorConfigs],
  );

  // Label -> dimension key, from the SAME list as the options above so the two
  // can't disagree. The primary entity and Google Ads' campaign type have no
  // key on purpose: both come from the in-memory rows (buildData).
  const dimKeyByLabel = useMemo<Record<string, string>>(
    () =>
      Object.fromEntries(
        segByTables.filter((t) => t.key !== "campaign_type").map((t) => [t.dimensionLabel, t.key]),
      ),
    [segByTables],
  );

  const [metricRaw, setMetric] = useState<string>("");
  const [segByRaw, setSegBy] = useState<SegBy>(segByOptions[0] ?? "Campaign");
  const [metricOpen, setMetricOpen] = useState(false);
  const [segByOpen, setSegByOpen] = useState(false);

  // Switching source (or an admin hiding a dimension) can leave the stored
  // selection pointing at something this connector doesn't offer. Resolve that
  // while rendering rather than correcting it in an effect: the stale value
  // never reaches the chart, and picking it up again is automatic if the user
  // switches back to a source that does offer it.
  const segBy = segByOptions.includes(segByRaw) ? segByRaw : (segByOptions[0] ?? "Campaign");
  const metricDef =
    metricOptions.find((m) => m.key === metricRaw) ??
    metricOptions[Math.min(initialMetricIndex, metricOptions.length - 1)] ??
    metricOptions[0];
  const metric = metricDef?.key ?? "revenue";
  const metricLabel = metricDef?.label ?? "Revenue";
  const isMoney = metricDef?.format === "money";

  const dimKey = dimKeyByLabel[segBy];

  // Campaign / Campaign Type come from the in-memory campaign rows.
  const campaignData = useMemo(
    () => (dimKey ? [] : buildData(metric, segBy)),
    [buildData, metric, segBy, dimKey],
  );

  // Match Type / Device / Network are fetched from the data API and aggregated by
  // the selected metric, then reduced to top 9 + "Others".
  const [dimData, setDimData] = useState<{ name: string; value: number }[]>([]);
  useEffect(() => {
    if (!dimKey) {
      setDimData([]);
      return;
    }
    let cancelled = false;
    const valOf = (r: {
      revenue: number;
      profit: number;
      conv: number;
      clicks: number;
      cost: number;
      extra?: Record<string, number>;
    }) => {
      switch (metric) {
        case "revenue":
          return r.revenue;
        case "profit":
          return Math.max(0, r.profit);
        case "conv":
          return r.conv;
        case "clicks":
          return r.clicks;
        case "cost":
          return r.cost;
        default:
          // An admin-registered metric — no field of its own, read from the
          // row's `extra` bag.
          return r.extra?.[metric] ?? 0;
      }
    };
    // "View as Client": carry view_as so the donut reads the client's account
    // like the rest of the dashboard, not the admin's.
    const viewAs = typeof window !== "undefined" ? sessionStorage.getItem("dr_view_as") : null;
    fetch(
      `${dimApiBase()}/${dimKey}?date_from=${dateFrom}&date_to=${dateTo}&page=1&limit=2000&sort=cost&sort_dir=desc${
        c.id !== "google_ads" ? `&connector=${encodeURIComponent(c.id)}` : ""
      }${viewAs ? `&view_as=${encodeURIComponent(viewAs)}` : ""}`,
    )
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows: any[] = Array.isArray(j.data) ? j.data : [];
        const items = rows
          .map((r) => ({ name: String(r.dimension), value: valOf(r) }))
          .filter((x) => x.value > 0)
          .sort((a, b) => b.value - a.value);
        const top = items.slice(0, 9);
        const others = items.slice(9).reduce((s, x) => s + x.value, 0);
        if (others > 0) top.push({ name: "Others", value: others });
        setDimData(top);
      })
      .catch(() => {
        if (!cancelled) setDimData([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dimKey, metric, dateFrom, dateTo, c.id]);

  const data = dimKey ? dimData : campaignData;
  const total = data.reduce((s, d) => s + d.value, 0);

  const bgCls =
    colorScheme === "green"
      ? "bg-green-50 border-green-100"
      : colorScheme === "violet"
        ? "bg-violet-50 border-violet-100"
        : "bg-emerald-50 border-emerald-100";

  return (
    <div className={`rounded-2xl border p-4 flex flex-col ${bgCls}`}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* Metric dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setMetricOpen((v) => !v);
              setSegByOpen(false);
            }}
            className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-2.5 py-1 text-[12px] font-medium cursor-pointer hover:bg-gray-50 transition"
          >
            {metricLabel}
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform ${metricOpen ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {metricOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMetricOpen(false)} />
              <div className="absolute left-0 top-full mt-1.5 w-[140px] bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top">
                {metricOptions.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => {
                      setMetric(m.key);
                      setMetricOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-gray-50 flex items-center justify-between transition ${metric === m.key ? "text-emerald-600 font-semibold bg-emerald-50/60" : "text-gray-700"}`}
                  >
                    {m.label}
                    {metric === m.key && (
                      <svg
                        width="10"
                        height="10"
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
        <span className="text-[12px] text-gray-400">by</span>
        {/* SegBy dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setSegByOpen((v) => !v);
              setMetricOpen(false);
            }}
            className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-2.5 py-1 text-[12px] font-medium cursor-pointer hover:bg-gray-50 transition"
          >
            {segBy}
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform ${segByOpen ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {segByOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSegByOpen(false)} />
              <div className="absolute left-0 top-full mt-1.5 w-[150px] bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top">
                {segByOptions.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setSegBy(s);
                      setSegByOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-gray-50 flex items-center justify-between transition ${segBy === s ? "text-emerald-600 font-semibold bg-emerald-50/60" : "text-gray-700"}`}
                  >
                    {s}
                    {segBy === s && (
                      <svg
                        width="10"
                        height="10"
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

      {/* Keyed by metric|segBy so the donut fades in as ONE component on those
          changes (period changes remount the whole SegmentDonut via chartKey above).
          Pie animation off → no segment-by-segment rebuild. */}
      <div key={`${metric}|${segBy}`} className="chart-fade h-55 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {/* Sweep the sectors in clockwise on each switch, matching the draw
                effect the other charts use. The wrapper's key changes with the
                metric / segment, so this re-runs per switch. */}
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={105}
              dataKey="value"
              paddingAngle={1}
              startAngle={90}
              endAngle={-270}
              strokeWidth={0}
              isAnimationActive={true}
              animationDuration={700}
              animationEasing="ease-out"
            >
              {data.map((_, i) => (
                <Cell key={i} fill={SEG_COLORS[i % SEG_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[11px] text-gray-400 mb-0.5">Total</span>
          <span className="text-[20px] font-extrabold text-gray-900 leading-none">
            {fmtSegVal(total, isMoney)}
          </span>
        </div>
      </div>

      <div className="space-y-1.5 mt-2">
        {data.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-[12px]">
            <div className="flex items-center gap-1.5 min-w-0">
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: SEG_COLORS[i % SEG_COLORS.length] }}
              />
              <span className="text-gray-600 truncate">{item.name}</span>
            </div>
            <span className="font-semibold text-gray-800 ml-2 shrink-0">
              {fmtSegVal(item.value, isMoney)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
