"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { SortIcon } from "./ChartPrimitives";
import { StatusIndicator } from "./StatusIndicator";
import { SortKey, SortDir, fmtNum, fmtK, fmtPct, fmtCurrency, heatmapBg } from "../_data/constants";
import { useCrossFilter } from "@/lib/store";
import MetricFilterControls from "./MetricFilterControls";
import { MetricFilterState, METRIC_FILTER_NONE, isMetricFilterActive } from "@/lib/metricFilter";
import { isAveragedMetric, type MetricFormat } from "@/lib/connectors";

type CampaignRow = {
  status: string;
  name: string;
  type: string;
  roas: string;
  roasColor: string;
  impr: number;
  clicks: number;
  cpc: number;
  ctr: number;
  convRate: number;
  conv: number;
  cpa: number;
  revenue: number;
  cost: number;
  profit: number;
  roasVal: number;
  // Admin-registered custom metrics (raw Windsor fields, no canonical
  // formula) — see ConnectorManifest.customMetricFields in @/lib/connectors.
  extra?: Record<string, number>;
};

function formatCustomMetricCell(v: number, format?: MetricFormat): string {
  switch (format) {
    case "money":
      return `$${fmtK(v)}`;
    case "percent":
      return fmtPct(v);
    case "ratio":
      return `${v.toFixed(2)}x`;
    default:
      return fmtNum(v);
  }
}

type TableTotals = CampaignTableProps["tableTotals"];

// Metric-column key (the admin's own TABLE_METRIC_COLS vocabulary) → how to
// read, format and heat-shade that column. Keys with bespoke markup (roasVal's
// coloured badge, profit's +/- colouring) are handled inline at the call sites
// instead. Anything NOT here is an admin-registered custom metric, read from
// the row's `extra` bag.
const CELL_RENDERERS: Record<
  string,
  { value: (r: CampaignRow) => number; fmt: (v: number) => string; heat: "blue" | "green" | "red" }
> = {
  impr: { value: (r) => r.impr, fmt: fmtNum, heat: "blue" },
  clicks: { value: (r) => r.clicks, fmt: fmtNum, heat: "blue" },
  cpc: { value: (r) => r.cpc, fmt: fmtCurrency, heat: "blue" },
  ctr: { value: (r) => r.ctr, fmt: fmtPct, heat: "blue" },
  convRate: { value: (r) => r.convRate, fmt: fmtPct, heat: "blue" },
  conv: { value: (r) => r.conv, fmt: fmtNum, heat: "blue" },
  cpa: { value: (r) => r.cpa, fmt: fmtCurrency, heat: "green" },
  revenue: { value: (r) => r.revenue, fmt: (v) => `$${fmtK(v)}`, heat: "green" },
  cost: { value: (r) => r.cost, fmt: (v) => `$${fmtK(v)}`, heat: "green" },
};

// Same keys → the matching footer total. Sums for counts, averages for rates,
// exactly as the totals were computed before this became config-driven.
const TOTAL_RENDERERS: Record<string, (t: TableTotals) => string> = {
  impr: (t) => fmtNum(t.totImpr),
  clicks: (t) => fmtNum(t.totClicks),
  cpc: (t) => fmtCurrency(t.avgCpc),
  ctr: (t) => fmtPct(t.avgCtr),
  convRate: (t) => fmtPct(t.avgConvRate),
  conv: (t) => fmtNum(t.totConv),
  cpa: (t) => fmtCurrency(t.avgCpa),
  revenue: (t) => `$${fmtK(t.totRev)}`,
  cost: (t) => `$${fmtK(t.totCost)}`,
};

// The metric-column keys differ from the sortable row keys in one place: the
// admin config calls the ROAS column `roasVal`, the sort key is `roas`.
const SORT_KEY_BY_COL: Record<string, SortKey> = { roasVal: "roas" };

interface CampaignTableProps {
  filtered: CampaignRow[];
  currentRows: CampaignRow[];
  page: number;
  rowsPerPage: number;
  totalPages: number;
  sortCol: SortKey | null;
  sortDir: SortDir;
  typeFilter: string;
  types: string[];
  namesCollapsed: boolean;
  expandedNameIdx: number | null;
  isMobile: boolean;
  heatCols: Record<string, { min: number; max: number }>;
  tableTotals: {
    totImpr: number;
    totClicks: number;
    totConv: number;
    totCost: number;
    totRev: number;
    totProfit: number;
    avgCpc: number;
    avgCtr: number;
    avgConvRate: number;
    avgCpa: number;
    totRoasVal: number;
    totRoasColor: string;
  };
  rangeStart: number;
  rangeEnd: number;
  fmtMs: (ts: number) => string;
  onSort: (col: SortKey) => void;
  onTypeFilter: (v: string) => void;
  onPageChange: (p: number) => void;
  onRowsPerPageChange: (n: number) => void;
  onNamesCollapsedChange: (v: boolean) => void;
  onExpandedNameIdxChange: (v: number | null) => void;
  campaignDropdownOpen: boolean;
  campaignSearch: string;
  onCampaignDropdownOpen: (open: boolean) => void;
  onCampaignSearchChange: (v: string) => void;
  statusFilter: string;
  onStatusFilter: (v: string) => void;
  metricFilter: MetricFilterState;
  onMetricFilter: (v: MetricFilterState) => void;
  crossFilterCampaigns?: string[] | null;
  primaryLabel?: string;
  // False for sources with no ad spend (GA4, Shopify): the cost-derived columns
  // (Type / ROAS / Impr. / CPC / CTR / CPA / Cost / Profit) would all read zero,
  // so they are dropped entirely rather than shown empty.
  hasCost?: boolean;
  // The metric columns to render, in order — straight from the admin's
  // "Metric columns" config (applyMetricColConfig), exactly like every other
  // table on the dashboard. Includes admin-registered custom metrics, which
  // are read from `row.extra[key]`. Required, so this table can't drift back
  // out of sync with the rest of the dashboard.
  metricCols: { key: string; label: string; format?: MetricFormat }[];
}

export default function CampaignTable({
  filtered,
  currentRows,
  page,
  rowsPerPage,
  totalPages,
  sortCol,
  sortDir,
  typeFilter,
  types,
  namesCollapsed,
  expandedNameIdx,
  isMobile,
  heatCols,
  tableTotals,
  rangeStart,
  rangeEnd,
  fmtMs,
  onSort,
  onTypeFilter,
  onPageChange,
  onRowsPerPageChange,
  onNamesCollapsedChange,
  onExpandedNameIdxChange,
  campaignDropdownOpen,
  campaignSearch,
  onCampaignDropdownOpen,
  onCampaignSearchChange,
  statusFilter,
  onStatusFilter,
  metricFilter,
  onMetricFilter,
  crossFilterCampaigns,
  primaryLabel = "Campaign",
  hasCost = true,
  metricCols,
}: CampaignTableProps) {
  const {
    filters,
    toggleValue,
    selectSingle,
    clearFilter,
    setFilter,
    clearSignal,
    activeConnector,
  } = useCrossFilter();
  // The name column is pinned after the checkbox, plus the Status column when
  // that one is rendered at all (see the Status <th> below).
  const nameSticky = hasCost ? "sticky left-8 sm:left-24" : "sticky left-8";
  const selected = filters["campaign_name"] ?? [];
  const rowSelected = filters["campaign_selected"] ?? [];
  const headerRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const campaignBtnRef = useRef<HTMLButtonElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);

  const [campaignDropdownPos, setCampaignDropdownPos] = useState({
    top: 0,
    left: 0,
    maxHeight: 480,
  });
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [filterDropdownPos, setFilterDropdownPos] = useState({ top: 0, left: 0, maxHeight: 480 });

  // Portals need a client-mounted document.body; render dropdowns only after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Campaign Name dropdown — Data-Studio inclusion model with null sentinel.
  // null = ALL checked (no filter); [] = none checked (no filter, build up);
  // partial subset = include filter written to store campaign_name.
  const [campSel, setCampSel] = useState<string[] | null>(null);
  const allCampNames = currentRows.map((r) => r.name);
  // Push the effective include filter to the store and keep local state.
  const applyCampSel = (next: string[] | null) => {
    setCampSel(next);
    const isPartial = next !== null && next.length > 0 && next.length < allCampNames.length;
    if (isPartial) setFilter("campaign_name", next);
    else clearFilter("campaign_name");
  };

  // Global "Clear all" → reset the dropdown's local selection to default.
  useEffect(() => {
    if (clearSignal === 0) return;
    setCampSel(null);
  }, [clearSignal]);

  // Position a fixed dropdown so it is never clipped by the viewport: clamp the
  // left edge to keep the full width on-screen, and flip above the trigger when
  // there isn't enough room below. maxHeight lets the body scroll if still tall.
  const computePos = (btn: HTMLButtonElement | null, width: number, estHeight: number) => {
    if (!btn) return { top: 0, left: 0, maxHeight: 480 };
    const r = btn.getBoundingClientRect();
    const m = 8;
    const left = Math.max(m, Math.min(r.left, window.innerWidth - width - m));
    const spaceBelow = window.innerHeight - r.bottom - m;
    const spaceAbove = r.top - m;
    let top: number;
    let maxHeight: number;
    if (spaceBelow >= estHeight || spaceBelow >= spaceAbove) {
      top = r.bottom + 6;
      maxHeight = spaceBelow - 6;
    } else {
      maxHeight = spaceAbove - 6;
      top = Math.max(m, r.top - 6 - Math.min(estHeight, maxHeight));
    }
    return { top, left, maxHeight: Math.max(180, maxHeight) };
  };

  const updatePositions = useCallback(() => {
    if (campaignDropdownOpen) setCampaignDropdownPos(computePos(campaignBtnRef.current, 260, 360));
    if (filterDropdownOpen) setFilterDropdownPos(computePos(filterBtnRef.current, 288, 340));
  }, [campaignDropdownOpen, filterDropdownOpen]);

  useEffect(() => {
    updatePositions();
  }, [updatePositions]);

  useEffect(() => {
    const f = filtersRef.current;
    const update = () => {
      if (campaignDropdownOpen || filterDropdownOpen) {
        updatePositions();
      }
    };
    if (f) f.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      f?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [updatePositions]);

  const cellStyle = (
    col: keyof typeof heatCols,
    value: number,
    color: "blue" | "green" | "red",
  ) => ({
    backgroundColor: heatmapBg(value, heatCols[col].min, heatCols[col].max, color),
  });

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-200 relative">
        <div
          ref={headerRef}
          className="px-4 sm:px-5 py-4 flex items-start justify-between flex-wrap gap-2 sm:gap-3 border-b border-gray-100 relative"
        >
          <div className="min-w-0">
            <h2 className="text-[15px] sm:text-[17px] font-bold text-gray-900">
              {primaryLabel} Performance
            </h2>
            <p className="text-[13px] text-gray-400 mt-0.5 hidden sm:block">
              Detailed analytics for {currentRows.length} {primaryLabel.toLowerCase()}s •{" "}
              {fmtMs(rangeStart)} – {fmtMs(rangeEnd)}
            </p>
          </div>
          <div
            ref={filtersRef}
            className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto scrollbar-none w-full sm:w-auto"
          >
            <span className="text-[13px] text-gray-500 hidden sm:inline shrink-0">Filters:</span>

            {/* Campaign Name multi-select dropdown */}
            <div className="shrink-0">
              <button
                ref={campaignBtnRef}
                onClick={() => {
                  if (!campaignDropdownOpen)
                    setCampaignDropdownPos(computePos(campaignBtnRef.current, 260, 360));
                  onCampaignDropdownOpen(!campaignDropdownOpen);
                }}
                className={`flex items-center gap-1.5 text-[13px] border rounded-lg px-2.5 py-1.5 transition whitespace-nowrap ${
                  selected.length > 0 || campaignSearch
                    ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                <span className="sm:hidden">{primaryLabel}</span>
                <span className="hidden sm:inline">{primaryLabel} Name</span>
                {selected.length > 0 && (
                  <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    {selected.length}
                  </span>
                )}
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`transition-transform ${campaignDropdownOpen ? "rotate-180" : ""}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>

            {/* Unified Filters dropdown (Type + Status + ROAS) — matches other tables */}
            <div className="shrink-0">
              <button
                ref={filterBtnRef}
                onClick={() => {
                  if (!filterDropdownOpen)
                    setFilterDropdownPos(computePos(filterBtnRef.current, 288, 340));
                  setFilterDropdownOpen(!filterDropdownOpen);
                  onCampaignDropdownOpen(false);
                }}
                className={`flex items-center gap-1 text-[13px] border rounded-lg px-2.5 py-1.5 transition whitespace-nowrap ${
                  typeFilter !== "All" ||
                  statusFilter !== "Status" ||
                  isMetricFilterActive(metricFilter)
                    ? "border-emerald-400 bg-emerald-50 text-emerald-700 font-medium"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                  <line x1="11" y1="18" x2="13" y2="18" />
                </svg>
                Filters
                {(typeFilter !== "All" ||
                  statusFilter !== "Status" ||
                  isMetricFilterActive(metricFilter)) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                )}
              </button>
            </div>
            {(selected.length > 0 ||
              rowSelected.length > 0 ||
              campaignSearch ||
              typeFilter !== "All" ||
              statusFilter !== "Status" ||
              isMetricFilterActive(metricFilter)) && (
              <button
                onClick={() => {
                  onCampaignSearchChange("");
                  onTypeFilter("All");
                  onStatusFilter("Status");
                  onMetricFilter(METRIC_FILTER_NONE);
                  setCampSel(null);
                  clearFilter("campaign_name");
                  clearFilter("campaign_selected");
                }}
                className="text-[13px] text-emerald-600 hover:text-emerald-800 transition whitespace-nowrap shrink-0 font-medium"
              >
                Clear (
                {selected.length +
                  rowSelected.length +
                  (campaignSearch ? 1 : 0) +
                  (typeFilter !== "All" ? 1 : 0) +
                  (statusFilter !== "Status" ? 1 : 0) +
                  (isMetricFilterActive(metricFilter) ? 1 : 0)}
                )
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto overflow-y-hidden rounded-b-2xl">
          {/* No <colgroup>: the breakdown tables below don't use one either, and
              a column list that didn't match the columns actually rendered (a
              Status and a Type col on sources that render neither, eleven
              metric cols whatever the admin configured, a hardcoded 108px on
              the first of them) was what made this table's columns land at
              different widths from theirs. Both now size by content alone. */}
          <table
            className={`w-full text-[13px] border-collapse ${hasCost ? "sm:min-w-[1280px]" : "sm:min-w-275"}`}
          >
            <thead>
              <tr className="bg-gray-50/80">
                <th className="px-2.5 py-2.5 w-8 sticky left-0 z-20 bg-gray-50">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="rounded cursor-pointer"
                      checked={
                        rowSelected.length > 0 &&
                        filtered.every((r) => rowSelected.includes(r.name))
                      }
                      ref={(el) => {
                        if (el)
                          el.indeterminate =
                            rowSelected.length > 0 &&
                            !filtered.every((r) => rowSelected.includes(r.name));
                      }}
                      onChange={() => {
                        if (filtered.every((r) => rowSelected.includes(r.name)))
                          clearFilter("campaign_selected");
                        else
                          setFilter(
                            "campaign_selected",
                            filtered.map((r) => r.name),
                          );
                      }}
                    />
                    {namesCollapsed && (
                      <button
                        onClick={() => onNamesCollapsedChange(false)}
                        className="flex items-center justify-center w-6 h-6 rounded-md bg-emerald-100 text-emerald-600 hover:bg-emerald-200 transition shrink-0 sm:hidden"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    )}
                  </div>
                </th>
                {/* Status is derived from spend > 0, so on a source with no ad
                spend every row would read "paused" — hide it there. Dropping it
                also lines this table's name column up with the other tables,
                which have no Status column at all. */}
                {hasCost && (
                  <th className="px-2 py-2.5 text-left text-gray-500 font-medium text-[12px] w-16 sticky left-8 z-20 bg-gray-50 hidden sm:table-cell">
                    Status
                  </th>
                )}
                {(
                  [
                    [primaryLabel, "name", "left"],
                    // Type is an attribute of the entity, not a metric column,
                    // so it isn't part of the admin's Metric Columns config.
                    ...(hasCost
                      ? ([["Type", "type", "left"]] as [string, SortKey, "left" | "right"][])
                      : []),
                    // Everything else comes from the admin config, in the
                    // configured order — the same list every other table on
                    // the dashboard renders from.
                    ...metricCols.map(
                      (m) =>
                        [m.label, (SORT_KEY_BY_COL[m.key] ?? m.key) as SortKey, "right"] as [
                          string,
                          SortKey,
                          "left" | "right",
                        ],
                    ),
                  ] as [string, SortKey, "left" | "right"][]
                ).map(([label, col, align]) => (
                  <th
                    key={col}
                    onClick={() => onSort(col)}
                    className={`text-${align} text-gray-500 font-medium sm:whitespace-nowrap cursor-pointer hover:text-gray-700 select-none text-[12px]${col === "name" ? ` sm:w-[184px] ${nameSticky} z-20 bg-gray-50 after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-gray-200 overflow-hidden p-0` : " px-1.5 sm:px-2.5 py-2.5"}${col === "type" ? " hidden sm:table-cell" : ""}`}
                  >
                    {col === "name" ? (
                      <div
                        style={{
                          width: isMobile ? (namesCollapsed ? 0 : 120) : 160,
                          overflow: "hidden",
                          paddingLeft: isMobile && namesCollapsed ? 0 : 12,
                          paddingRight: isMobile && namesCollapsed ? 0 : 4,
                          paddingTop: 10,
                          paddingBottom: 10,
                          opacity: isMobile && namesCollapsed ? 0 : 1,
                          transition:
                            "width 380ms cubic-bezier(0.4, 0, 0.2, 1), padding-left 380ms cubic-bezier(0.4, 0, 0.2, 1), padding-right 380ms cubic-bezier(0.4, 0, 0.2, 1), opacity 260ms ease",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span className="flex items-center justify-between w-full">
                          <span className="flex items-center gap-0.5">
                            {label}
                            <SortIcon dir={sortCol === col ? sortDir : null} />
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onNamesCollapsedChange(true);
                              onExpandedNameIdxChange(null);
                            }}
                            className="flex items-center justify-center w-5 h-5 rounded bg-gray-100 text-gray-500 hover:bg-gray-200 transition shrink-0 sm:hidden"
                          >
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                            >
                              <polyline points="15 18 9 12 15 6" />
                            </svg>
                          </button>
                        </span>
                      </div>
                    ) : (
                      <>
                        {label}
                        <SortIcon dir={sortCol === col ? sortDir : null} />
                      </>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice((page - 1) * rowsPerPage, page * rowsPerPage).map((row, pageI) => {
                const i = (page - 1) * rowsPerPage + pageI;
                const isSelected = rowSelected.includes(row.name);
                const anySelected = rowSelected.length > 0;
                const inCrossFilter =
                  !crossFilterCampaigns || crossFilterCampaigns.includes(row.name);
                const isDimmed = (anySelected && !isSelected) || (!anySelected && !inCrossFilter);
                return (
                  <tr
                    key={i}
                    onClick={() => {
                      if (isSelected && rowSelected.length === 1) clearFilter("campaign_selected");
                      else selectSingle("campaign_selected", row.name);
                    }}
                    className={`border-t border-gray-100 cursor-pointer group transition-colors duration-150 ${
                      isSelected
                        ? "bg-emerald-50/40"
                        : isDimmed
                          ? "opacity-50 hover:opacity-80"
                          : "hover:bg-emerald-50/20"
                    }`}
                  >
                    <td
                      className={`px-2.5 py-2.5 sticky left-0 z-10 isolate ${isSelected ? "bg-emerald-50" : "bg-white group-hover:bg-emerald-50"}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="rounded cursor-pointer"
                        checked={isSelected}
                        onChange={() => toggleValue("campaign_selected", row.name)}
                      />
                    </td>
                    {hasCost && (
                      <td
                        className={`px-2 py-2.5 sticky left-8 z-10 isolate hidden sm:table-cell ${isSelected ? "bg-emerald-50" : "bg-white group-hover:bg-emerald-50"}`}
                      >
                        <StatusIndicator status={row.status} />
                      </td>
                    )}
                    <td
                      className={`${nameSticky} z-10 isolate overflow-hidden after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-gray-100 p-0 ${isSelected ? "bg-emerald-50" : "bg-white group-hover:bg-emerald-50"}`}
                    >
                      <div
                        style={{
                          width: isMobile ? (namesCollapsed ? 0 : 120) : 160,
                          overflow: "hidden",
                          paddingLeft: isMobile && namesCollapsed ? 0 : 12,
                          paddingRight: isMobile && namesCollapsed ? 0 : 12,
                          paddingTop: 10,
                          paddingBottom: 10,
                          opacity: isMobile && namesCollapsed ? 0 : 1,
                          cursor: isMobile && namesCollapsed ? undefined : "pointer",
                          transition:
                            "width 380ms cubic-bezier(0.4, 0, 0.2, 1), padding-left 380ms cubic-bezier(0.4, 0, 0.2, 1), padding-right 380ms cubic-bezier(0.4, 0, 0.2, 1), opacity 260ms ease",
                        }}
                        onClick={
                          isMobile && namesCollapsed
                            ? undefined
                            : (e) => {
                                e.stopPropagation();
                                onExpandedNameIdxChange(expandedNameIdx === i ? null : i);
                                if (isSelected && rowSelected.length === 1)
                                  clearFilter("campaign_selected");
                                else selectSingle("campaign_selected", row.name);
                              }
                        }
                        title={namesCollapsed ? undefined : row.name}
                      >
                        {/* Always wrap long names onto multiple lines (row grows as needed)
                        instead of truncating with an ellipsis. */}
                        <span className="font-medium text-gray-800 text-[12px] hover:text-emerald-600 transition block whitespace-normal wrap-break-word">
                          {row.name}
                        </span>
                      </div>
                    </td>
                    {hasCost && (
                      <td className="px-2.5 py-2.5 hidden sm:table-cell">
                        <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px] font-medium">
                          {row.type}
                        </span>
                      </td>
                    )}
                    {metricCols.map((m) => {
                      if (m.key === "roasVal") {
                        return (
                          <td key={m.key} className="px-2.5 py-2.5 text-right tabular-nums">
                            {row.roas !== "null" ? (
                              <span
                                className="inline-block px-2 py-0.5 rounded text-[12px] font-semibold"
                                style={{
                                  backgroundColor:
                                    row.roasColor === "green"
                                      ? "#DCFCE7"
                                      : row.roasColor === "red"
                                        ? "#FEE2E2"
                                        : row.roasColor === "orange"
                                          ? "#FFEDD5"
                                          : "#F3F4F6",
                                  color:
                                    row.roasColor === "green"
                                      ? "#15803D"
                                      : row.roasColor === "red"
                                        ? "#DC2626"
                                        : row.roasColor === "orange"
                                          ? "#EA580C"
                                          : "#9CA3AF",
                                }}
                              >
                                {row.roas}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-[12px]">—</span>
                            )}
                          </td>
                        );
                      }
                      if (m.key === "profit") {
                        return (
                          <td
                            key={m.key}
                            className={`px-1.5 sm:px-2.5 py-2.5 text-right tabular-nums ${row.profit < 0 ? "text-red-600" : "text-green-700"}`}
                            style={cellStyle(
                              "profit",
                              Math.abs(row.profit),
                              row.profit < 0 ? "red" : "green",
                            )}
                          >
                            {row.profit < 0 ? "-$" : "$"}
                            {fmtK(row.profit)}
                          </td>
                        );
                      }
                      const cell = CELL_RENDERERS[m.key];
                      if (!cell) {
                        // No canonical field for this key → an admin-registered
                        // custom metric, read from the row's `extra` bag.
                        const customVal = row.extra?.[m.key] ?? 0;
                        return (
                          <td
                            key={m.key}
                            className="px-1.5 sm:px-2.5 py-2.5 text-gray-700 text-right tabular-nums"
                            style={
                              heatCols[m.key] ? cellStyle(m.key, customVal, "blue") : undefined
                            }
                          >
                            {formatCustomMetricCell(customVal, m.format)}
                          </td>
                        );
                      }
                      const v = cell.value(row);
                      return (
                        <td
                          key={m.key}
                          className={`px-1.5 sm:px-2.5 py-2.5 text-gray-700 text-right tabular-nums${m.key === "revenue" ? " font-medium" : ""}`}
                          style={cellStyle(m.key, v, cell.heat)}
                        >
                          {cell.fmt(v)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold text-gray-800 text-[13px]">
                <td className="px-2.5 py-3 sticky left-0 z-10 bg-gray-50" />
                {hasCost && (
                  <td className="px-2 py-3 sticky left-8 z-10 bg-gray-50 hidden sm:table-cell" />
                )}
                <td
                  className={`${nameSticky} z-10 bg-gray-50 overflow-hidden after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-gray-200 p-0`}
                >
                  <div
                    style={{
                      width: isMobile ? (namesCollapsed ? 0 : 120) : 160,
                      overflow: "hidden",
                      paddingLeft: isMobile && namesCollapsed ? 0 : 12,
                      paddingRight: isMobile && namesCollapsed ? 0 : 12,
                      paddingTop: 12,
                      paddingBottom: 12,
                      opacity: isMobile && namesCollapsed ? 0 : 1,
                      whiteSpace: "nowrap",
                      transition:
                        "width 380ms cubic-bezier(0.4, 0, 0.2, 1), padding-left 380ms cubic-bezier(0.4, 0, 0.2, 1), padding-right 380ms cubic-bezier(0.4, 0, 0.2, 1), opacity 260ms ease",
                    }}
                  >
                    Total{" "}
                    <span className="text-gray-400 font-normal text-[11px]">
                      ({filtered.length})
                    </span>
                  </div>
                </td>
                {hasCost && <td className="px-2.5 py-3 hidden sm:table-cell" />}
                {metricCols.map((m) => {
                  if (m.key === "roasVal") {
                    return (
                      <td key={m.key} className="px-2.5 py-3 text-right tabular-nums">
                        <span
                          className="inline-block px-2 py-0.5 rounded text-[12px] font-semibold"
                          style={{
                            backgroundColor:
                              tableTotals.totRoasColor === "green"
                                ? "#DCFCE7"
                                : tableTotals.totRoasColor === "red"
                                  ? "#FEE2E2"
                                  : "#FFEDD5",
                            color:
                              tableTotals.totRoasColor === "green"
                                ? "#15803D"
                                : tableTotals.totRoasColor === "red"
                                  ? "#DC2626"
                                  : "#EA580C",
                          }}
                        >
                          {tableTotals.totRoasVal.toFixed(2)}x
                        </span>
                      </td>
                    );
                  }
                  if (m.key === "profit") {
                    return (
                      <td
                        key={m.key}
                        className={`px-2.5 py-3 text-right tabular-nums ${tableTotals.totProfit < 0 ? "text-red-600" : "text-green-700"}`}
                      >
                        {tableTotals.totProfit < 0 ? "-$" : "$"}
                        {fmtK(tableTotals.totProfit)}
                      </td>
                    );
                  }
                  const total = TOTAL_RENDERERS[m.key];
                  if (!total) {
                    // Custom metric — sum, or average when it's a rate/ratio
                    // (summing e.g. a bounce rate across rows is meaningless).
                    const vals = filtered.map((r) => r.extra?.[m.key] ?? 0);
                    const sum = vals.reduce((s, v) => s + v, 0);
                    const isAverage = isAveragedMetric(activeConnector, m.key);
                    return (
                      <td key={m.key} className="px-2.5 py-3 text-right tabular-nums">
                        {formatCustomMetricCell(
                          isAverage ? sum / (vals.length || 1) : sum,
                          m.format,
                        )}
                      </td>
                    );
                  }
                  return (
                    <td key={m.key} className="px-2.5 py-3 text-right tabular-nums">
                      {total(tableTotals)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 sm:px-5 py-3 flex items-center justify-between flex-wrap gap-2 border-t border-gray-100">
          <p className="text-[13px] text-gray-500">
            <span className="hidden sm:inline">
              Showing {(page - 1) * rowsPerPage + 1} to{" "}
              {Math.min(page * rowsPerPage, filtered.length)} of {filtered.length}{" "}
              {primaryLabel.toLowerCase()}s
            </span>
            <span className="sm:hidden">
              {(page - 1) * rowsPerPage + 1}–{Math.min(page * rowsPerPage, filtered.length)} /{" "}
              {filtered.length}
            </span>
            {filtered.length > rowsPerPage && (
              <>
                <span className="mx-2 hidden sm:inline">|</span>
                <span className="hidden sm:inline">Rows per page:</span>
                <select
                  value={rowsPerPage}
                  onChange={(e) => {
                    onRowsPerPageChange(Number(e.target.value));
                    onPageChange(1);
                  }}
                  className="ml-1.5 text-[13px] border border-gray-200 rounded px-1.5 py-0.5 bg-white outline-none cursor-pointer"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </>
            )}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(Math.max(1, page - 1))}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 transition"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, idx) => {
              const p =
                totalPages <= 5
                  ? idx + 1
                  : page <= 3
                    ? idx + 1
                    : page >= totalPages - 2
                      ? totalPages - 4 + idx
                      : page - 2 + idx;
              return (
                <button
                  key={p}
                  onClick={() => onPageChange(p)}
                  className={`w-7 h-7 rounded-lg text-[13px] font-medium transition ${
                    page === p ? "bg-emerald-600 text-white" : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 transition"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Dropdowns rendered in a body portal so they escape any ancestor stacking
        context / overflow clipping and always sit above the AI Analytics panel. */}
        {mounted &&
          campaignDropdownOpen &&
          createPortal(
            <>
              <div
                className="fixed inset-0 z-125"
                onClick={() => {
                  onCampaignDropdownOpen(false);
                  onCampaignSearchChange("");
                }}
              />
              <div
                className="fixed w-65 bg-white border border-gray-200 rounded-xl shadow-xl z-130 flex flex-col overflow-hidden"
                style={{
                  top: campaignDropdownPos.top,
                  left: campaignDropdownPos.left,
                  maxHeight: campaignDropdownPos.maxHeight,
                }}
              >
                <div className="p-2 border-b border-gray-100 shrink-0">
                  <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50/50">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-gray-400 shrink-0"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.35-4.35" />
                    </svg>
                    <input
                      autoFocus
                      value={campaignSearch}
                      onChange={(e) => onCampaignSearchChange(e.target.value)}
                      placeholder={`Search ${primaryLabel.toLowerCase()}s...`}
                      className="text-[12px] outline-none w-full bg-transparent"
                    />
                    {campaignSearch && (
                      <button
                        onClick={() => onCampaignSearchChange("")}
                        className="text-gray-400 hover:text-gray-600 transition shrink-0"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                {(() => {
                  const visible = currentRows.filter((r) =>
                    r.name.toLowerCase().includes(campaignSearch.toLowerCase()),
                  );
                  const isChecked = (n: string) => (campSel === null ? true : campSel.includes(n));
                  const allVisibleChecked =
                    visible.length > 0 && visible.every((r) => isChecked(r.name));
                  const someVisibleChecked = visible.some((r) => isChecked(r.name));
                  const toggleOne = (n: string) => {
                    const base = campSel === null ? [...allCampNames] : [...campSel];
                    const next = base.includes(n) ? base.filter((x) => x !== n) : [...base, n];
                    applyCampSel(next.length === allCampNames.length ? null : next);
                  };
                  const toggleSelectAll = () => {
                    const searching = campaignSearch.trim().length > 0;
                    if (allVisibleChecked) {
                      if (!searching) applyCampSel([]);
                      else {
                        const base = campSel === null ? [...allCampNames] : [...campSel];
                        const visSet = new Set(visible.map((r) => r.name));
                        applyCampSel(base.filter((x) => !visSet.has(x)));
                      }
                    } else {
                      const base = campSel === null ? [] : [...campSel];
                      const next = [...new Set([...base, ...visible.map((r) => r.name)])];
                      applyCampSel(next.length === allCampNames.length ? null : next);
                    }
                  };
                  return (
                    <>
                      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 shrink-0">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allVisibleChecked}
                            ref={(el) => {
                              if (el) el.indeterminate = someVisibleChecked && !allVisibleChecked;
                            }}
                            onChange={toggleSelectAll}
                            className="rounded"
                          />
                          <span className="text-[11px] text-gray-500">Select all</span>
                        </label>
                        {campSel !== null && (
                          <button
                            onClick={() => applyCampSel(null)}
                            className="text-[11px] text-gray-400 hover:text-gray-700 transition"
                          >
                            × Reset
                          </button>
                        )}
                      </div>
                      <div className="flex-1 min-h-0 max-h-55 overflow-y-auto py-1">
                        {visible.map((r) => (
                          <label
                            key={r.name}
                            className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked(r.name)}
                              onChange={() => toggleOne(r.name)}
                              className="rounded"
                            />
                            <span className="text-[12px] text-gray-700 truncate">{r.name}</span>
                          </label>
                        ))}
                        {visible.length === 0 && (
                          <div className="px-3 py-4 text-center text-[12px] text-gray-400">
                            No results found
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </>,
            document.body,
          )}

        {mounted &&
          filterDropdownOpen &&
          createPortal(
            <>
              <div className="fixed inset-0 z-125" onClick={() => setFilterDropdownOpen(false)} />
              <div
                className="fixed w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-130 p-3 space-y-3 overflow-y-auto"
                style={{
                  top: filterDropdownPos.top,
                  left: filterDropdownPos.left,
                  maxHeight: filterDropdownPos.maxHeight,
                }}
              >
                {/* Universal numeric filter: Metric over Operator over Value. */}
                <MetricFilterControls
                  options={metricCols}
                  value={metricFilter}
                  onChange={onMetricFilter}
                />
                {/* Type */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                    Type
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {types.map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          onTypeFilter(t);
                          clearFilter("campaign_name");
                        }}
                        className={`px-2 py-0.5 rounded-full text-[12px] font-medium transition ${
                          typeFilter === t
                            ? "bg-emerald-600 text-white"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Status — below the numeric filter per spec */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                    Status
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {[
                      { v: "Status", label: "All" },
                      { v: "Active", label: "Active" },
                      { v: "Paused", label: "Paused" },
                    ].map(({ v, label }) => (
                      <button
                        key={v}
                        onClick={() => onStatusFilter(v)}
                        className={`px-2 py-0.5 rounded-full text-[12px] font-medium transition ${
                          statusFilter === v
                            ? "bg-emerald-600 text-white"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {(typeFilter !== "All" ||
                  statusFilter !== "Status" ||
                  isMetricFilterActive(metricFilter)) && (
                  <button
                    onClick={() => {
                      onTypeFilter("All");
                      onStatusFilter("Status");
                      onMetricFilter(METRIC_FILTER_NONE);
                    }}
                    className="w-full text-[12px] text-red-500 hover:text-red-700 transition text-center pt-1 border-t border-gray-100"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </>,
            document.body,
          )}
      </div>
    </>
  );
}
