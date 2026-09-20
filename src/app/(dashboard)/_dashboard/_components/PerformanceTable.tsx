"use client";

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { SortIcon } from "./ChartPrimitives";
import { fmtNum, fmtK, fmtPct, fmtCurrency, heatmapBg } from "../_data/constants";
import { useCrossFilter } from "@/lib/store";
import { isAveragedMetric, getConnector } from "@/lib/connectors";
import { dimApiBase } from "@/lib/dataSource";
import MetricFilterControls from "./MetricFilterControls";
import {
  MetricFilterState,
  METRIC_FILTER_NONE,
  metricFilterKey,
  metricFilterParams,
  applyMetricFilter,
  isMetricFilterActive,
} from "@/lib/metricFilter";
import { applyMetricColConfig, type TableMetricCol } from "@/lib/connectors";
import { toggleExcluded } from "@/lib/dropdownExclude";
import type { PerfRow, HeatRanges, PerfTotals } from "@/app/api/data/[dimension]/route";

type SortCol = keyof Omit<PerfRow, "roas" | "roasColor">;

export interface PerformanceTableProps {
  title: string;
  dimensionLabel: string;
  dimensionKey: string;
  dateFrom: string;
  dateTo: string;
  rangeLabel: string;
  isVisible: boolean;
  headerRight?: React.ReactNode;
  // Admin "table widget" overrides (see TableConfigV2 in connectors.ts). Every
  // one is optional and defaults to today's behavior — existing callers that
  // don't pass them are unaffected.
  metricColsOverride?: TableMetricCol[];
  crossFilteringEnabled?: boolean;
  defaultSortOverride?: { key: SortCol; direction: "asc" | "desc" };
}

// Calendar order for day_of_week values returned by Windsor (variants observed
// across accounts: Mon/Tue/Wed... or full names, with/without case).
const DAY_ORDER: Record<string, number> = {
  MONDAY: 0,
  TUESDAY: 1,
  WEDNESDAY: 2,
  THURSDAY: 3,
  FRIDAY: 4,
  SATURDAY: 5,
  SUNDAY: 6,
  MON: 0,
  TUE: 1,
  WED: 2,
  THU: 3,
  FRI: 4,
  SAT: 5,
  SUN: 6,
  "1": 0,
  "2": 1,
  "3": 2,
  "4": 3,
  "5": 4,
  "6": 5,
  "7": 6,
};
const MONTH_ORDER: Record<string, number> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};

// iOS Safari THROWS "The string did not match the expected pattern" on
// new Date("Week 12 2024") and other non-standard strings (Chrome silently
// returns Invalid Date). Only call Date() on values that look like real dates.
function safeDateMs(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}|^[A-Za-z]{3,}\.?\s+\d{1,2},?\s+\d{4}/.test(value.trim())) return NaN;
  const t = new Date(value).getTime();
  return isNaN(t) ? NaN : t;
}

// Map a time-dimension display string to a sortable rank.
function calendarRank(dimensionKey: string, value: string): number {
  if (dimensionKey === "hour") return Number(value) || 0;
  if (dimensionKey === "date") {
    // ISO date string e.g. "2026-06-01" — lexicographic sort already works but
    // we parse to a number for numeric comparison consistency.
    return safeDateMs(value) || 0;
  }
  if (dimensionKey === "day_of_week") {
    return DAY_ORDER[value.toUpperCase()] ?? 99;
  }
  if (dimensionKey === "month") {
    // Expected: "Jan 2024" or just "Jan"
    const [mon, year] = value.split(" ");
    const yr = Number(year) || 0;
    const m = MONTH_ORDER[mon] || 0;
    return yr * 100 + m;
  }
  if (dimensionKey === "quarter") {
    // Expected: "Q1 2024" or just "Q1"
    const [q, year] = value.split(" ");
    const yr = Number(year) || 0;
    const qNum = Number(q.replace(/^Q/i, "")) || 0;
    return yr * 10 + qNum;
  }
  if (dimensionKey === "week") {
    // Windsor may return week start as "Jan 10, 2022" (ISO date) or "Week 12 2024" (week num).
    const isoLike = safeDateMs(value);
    if (!isNaN(isoLike)) return isoLike; // "Jan 10, 2022" → timestamp
    const parts = value.split(" ");
    const wNum = Number(parts[1]) || 0;
    const yr = Number(parts[2]) || 0;
    return yr * 100 + wNum;
  }
  if (dimensionKey === "year") return Number(value) || 0;
  return 0;
}

function roasStyle(c: PerfRow["roasColor"]) {
  const map = {
    green: { bg: "#DCFCE7", text: "#15803D" },
    red: { bg: "#FEE2E2", text: "#DC2626" },
    orange: { bg: "#FFEDD5", text: "#EA580C" },
    gray: { bg: "#F3F4F6", text: "#9CA3AF" },
  };
  return map[c];
}

export default function PerformanceTable({
  title,
  dimensionLabel,
  dimensionKey,
  dateFrom,
  dateTo,
  rangeLabel,
  isVisible,
  headerRight,
  metricColsOverride,
  crossFilteringEnabled,
  defaultSortOverride,
}: PerformanceTableProps) {
  const [data, setData] = useState<PerfRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<PerfTotals | null>(null);
  const [heat, setHeat] = useState<HeatRanges | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [everVisible, setEverVisible] = useState(false);
  // Default sort: most clicks first — matches Campaign Performance behavior.
  // Time dimensions default to calendar order via dimension asc. An admin's
  // configured default (defaultSortOverride) wins over both when provided.
  const isCalendarDim = [
    "hour",
    "day_of_week",
    "date",
    "week",
    "month",
    "quarter",
    "year",
  ].includes(dimensionKey);
  const [sortCol, setSortCol] = useState<SortCol>(
    defaultSortOverride?.key ?? (isCalendarDim ? "dimension" : "clicks"),
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">(
    defaultSortOverride?.direction ?? (isCalendarDim ? "asc" : "desc"),
  );
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Paused">("All");
  // Universal numeric metric filter (replaces the fixed Good/OK/Poor ROAS pills).
  // Debounced copy drives fetching so typing a value doesn't spam the API.
  const [metricFilter, setMetricFilter] = useState<MetricFilterState>(METRIC_FILTER_NONE);
  const [debouncedMetricFilter, setDebouncedMetricFilter] =
    useState<MetricFilterState>(METRIC_FILTER_NONE);
  const [filterOpen, setFilterOpen] = useState(false);
  const [namesCollapsed, setNamesCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Names this table pushed to the store because a Status/ROAS filter is active.
  // Lets us clear our own global selection when the filter is cleared, without
  // wiping a manual row selection the user made independently.
  const filterDrivenRef = useRef<string[]>([]);
  const dimBtnRef = useRef<HTMLButtonElement>(null);
  const dimDropdownRef = useRef<HTMLDivElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const [dimDropdownOpen, setDimDropdownOpen] = useState(false);
  const [dimDropdownPos, setDimDropdownPos] = useState({ top: 0, left: 0, maxHeight: 480 });
  const [filterDropdownPos, setFilterDropdownPos] = useState({ top: 0, left: 0, maxHeight: 480 });
  const [dimDropdownSearch, setDimDropdownSearch] = useState("");
  const [dimDropdownDebouncedSearch, setDimDropdownDebouncedSearch] = useState("");
  // How many dropdown rows are currently rendered. The list loads in chunks and
  // grows on scroll (infinite scroll) so we never paint hundreds of DOM nodes for
  // huge dimensions (e.g. 98k+ search terms). Server-side search narrows the set.
  const DROPDOWN_CHUNK = 60;
  const [dropdownRender, setDropdownRender] = useState(DROPDOWN_CHUNK);

  useEffect(() => {
    const t = setTimeout(() => setDimDropdownDebouncedSearch(dimDropdownSearch), 350);
    return () => clearTimeout(t);
  }, [dimDropdownSearch]);

  // Reset the rendered chunk when the search changes or the dropdown re-opens.
  useEffect(() => {
    setDropdownRender(DROPDOWN_CHUNK);
  }, [dimDropdownDebouncedSearch, dimDropdownOpen]);

  const [allNames, setAllNames] = useState<string[] | null>(null);
  const [namesLoading, setNamesLoading] = useState(false);
  // Data-Studio-style dropdown: all values included by default; unchecking a
  // Data-Studio-style dropdown selection.
  //   null            = ALL values selected (default) → no filter, every checkbox checked
  //   []              = nothing selected (after unchecking Select All) → still NO filter,
  //                     the table keeps showing all rows; the user builds a selection up
  //   [a, b, …]       = explicit include filter (applies only when it's a partial subset)
  // The filter is sent to the API only when the selection is a non-empty proper subset
  // of all names — i.e. not null, not empty, and not "everything".
  const [dropdownSel, setDropdownSel] = useState<string[] | null>(null);
  // Rows excluded from the DEFAULT "everything selected" state (dropdownSel ===
  // null). Untick a row (found via search, or in the list) and it drops out of
  // the dashboards; the table then shows all-except. Only meaningful while
  // dropdownSel is null — once an explicit include subset is being built, this
  // is cleared. Sent to the API as filter_exclude.
  const [excludeSel, setExcludeSel] = useState<string[]>([]);
  const [namesTruncated, setNamesTruncated] = useState(false);
  const [totalNamesCount, setTotalNamesCount] = useState(0);
  const isAllSelected =
    dropdownSel === null ||
    (allNames !== null &&
      allNames.length > 0 &&
      !namesTruncated &&
      !dimDropdownDebouncedSearch &&
      dropdownSel.length === allNames.length);
  // Active filter = partial, non-empty selection
  const includeFilter =
    dropdownSel !== null && dropdownSel.length > 0 && !isAllSelected ? dropdownSel : [];
  // Excluded rows only apply from the "everything selected" default — once an
  // explicit include subset exists, exclusions don't.
  const excludeFilter = dropdownSel === null ? excludeSel : [];
  const excludeFilterKey = excludeFilter.join(" ");
  // The dropdown carries a filter when it's narrowing to a subset OR excluding.
  const dropdownFiltered = includeFilter.length > 0 || excludeFilter.length > 0;
  // Track names we pushed to global store via the dropdown filter, so we can
  // clear only our own contribution when the dropdown resets.
  const dropdownDrivenRef = useRef<string[]>([]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Click-outside handler — uses "click" (not "pointerdown") so mobile scroll
  // gestures don't accidentally close the dropdown.
  useEffect(() => {
    if (!dimDropdownOpen && !filterOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dimDropdownOpen) {
        if (dimDropdownRef.current?.contains(target) || dimBtnRef.current?.contains(target)) return;
        setDimDropdownOpen(false);
        setDimDropdownSearch("");
      }
      if (filterOpen) {
        if (filterDropdownRef.current?.contains(target) || filterBtnRef.current?.contains(target))
          return;
        setFilterOpen(false);
      }
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [dimDropdownOpen, filterOpen]);

  // Keep the dropdown glued to its trigger while open. A continuous rAF loop
  // reads the button rect every frame and updates the fixed position — this is
  // the only approach with zero lag on desktop AND iOS momentum scroll (scroll
  // events lag a frame or don't fire during momentum). The dropdown is also
  // portaled to <body> so no ancestor overflow/transform can clip or offset it.
  useEffect(() => {
    if (!dimDropdownOpen && !filterOpen) return;
    // Clamp both axes so the dropdown never leaves the viewport, and flip above the
    // trigger when there's more room there; maxHeight lets the body scroll if tall.
    const computePos = (r: DOMRect, width: number, estHeight: number, left: number) => {
      const m = 8;
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
    let rafId = 0;
    const loop = () => {
      if (dimDropdownOpen && dimBtnRef.current) {
        const r = dimBtnRef.current.getBoundingClientRect();
        const left = Math.max(8, Math.min(r.left, window.innerWidth - 296));
        const np = computePos(r, 280, 400, left);
        setDimDropdownPos((p) =>
          p.top === np.top && p.left === np.left && p.maxHeight === np.maxHeight ? p : np,
        );
      }
      if (filterOpen && filterBtnRef.current) {
        const r = filterBtnRef.current.getBoundingClientRect();
        const left = Math.max(8, Math.min(r.right - 288, window.innerWidth - 296));
        const np = computePos(r, 288, 360, left);
        setFilterDropdownPos((p) =>
          p.top === np.top && p.left === np.left && p.maxHeight === np.maxHeight ? p : np,
        );
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [dimDropdownOpen, filterOpen]);

  useEffect(() => {
    if (isVisible) setEverVisible(true);
  }, [isVisible]);

  // Debounce search — also resets page
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Debounce the metric filter — applies (and resets page) shortly after the user
  // stops changing the metric / operator / value, so fetches don't fire per keystroke.
  const metricKeyStr = metricFilterKey(metricFilter);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedMetricFilter(metricFilter);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricKeyStr]);

  const {
    filters: storeFilters,
    dimSearch,
    dimInclude,
    dimExclude: storeDimExclude,
    activeConnector,
    connectorConfigs,
    toggleValue: storeToggleValue,
    selectSingle: storeSelectSingle,
    clearFilter: storeClearFilter,
    setFilter: storeSetFilter,
    setDimExclude: storeSetDimExclude,
    clearAll,
    setDimSearch,
    incTableLoading,
    decTableLoading,
    crossFilterCampaigns: storeCrossFilterCampaigns,
    crossFilterAdGroups: storeCrossFilterAdGroups,
    crossFilterKeywords: storeCrossFilterKeywords,
    crossFilterMatchTypes: storeCrossFilterMatchTypes,
    crossFilterRowsByDim: storeCrossFilterRowsByDim,
    crossFilterBusy,
    clearSignal,
  } = useCrossFilter();
  // A table widget with cross-filtering turned off neither reads nor writes the
  // shared filter store, and ignores the Google-Ads distribution overrides too —
  // it behaves as if nothing is ever selected/filtered. Every read/write below
  // keeps its original name (just re-bound here) so the rest of the component
  // doesn't need to change at each of its call sites.
  const crossFilteringOn = crossFilteringEnabled !== false;
  const noop = () => {};
  const filters = crossFilteringOn ? storeFilters : {};
  const toggleValue = crossFilteringOn ? storeToggleValue : noop;
  const selectSingle = crossFilteringOn ? storeSelectSingle : noop;
  const clearFilter = crossFilteringOn ? storeClearFilter : noop;
  const setFilter = crossFilteringOn ? storeSetFilter : noop;
  const setDimExclude = crossFilteringOn ? storeSetDimExclude : noop;
  const crossFilterCampaigns = crossFilteringOn ? storeCrossFilterCampaigns : null;
  const crossFilterAdGroups = crossFilteringOn ? storeCrossFilterAdGroups : null;
  const crossFilterKeywords = crossFilteringOn ? storeCrossFilterKeywords : null;
  const crossFilterMatchTypes = crossFilteringOn ? storeCrossFilterMatchTypes : null;
  const crossFilterRowsByDim = crossFilteringOn ? storeCrossFilterRowsByDim : {};
  // Non-Google connectors carry a &connector= param so the API uses their schema.
  const connectorParam = activeConnector !== "google_ads" ? `&connector=${activeConnector}` : "";
  // "View as Client": these tables fetch /api/data on their own, so they must
  // carry the same view_as the rest of the dashboard sends — otherwise they read
  // the admin's account (who may not have this source) and 503 "No data source
  // configured". Set on the admin page before navigating in; stable per session.
  const viewAsParam =
    typeof window !== "undefined" && sessionStorage.getItem("dr_view_as")
      ? `&view_as=${encodeURIComponent(sessionStorage.getItem("dr_view_as")!)}`
      : "";
  // Status is derived from spend > 0, so it says nothing on a source without
  // ad spend. The primary table already drops it there; dropping it here too
  // keeps both tables' columns lined up.
  const showStatus = getConnector(activeConnector).hasCost;
  // Metric columns to render (which / order / label): an explicit override (a
  // table widget's own column set) wins; otherwise the admin's global
  // per-connector config; empty = the built-in full column set.
  const metricCols =
    metricColsOverride ??
    applyMetricColConfig(connectorConfigs[activeConnector]?.metrics, activeConnector);
  // Explicit narrow set for THIS dimension pushed by the AI (show_on_dashboard).
  // Falls back to the local dropdown selection. Either one narrows the table to
  // exactly those rows (server-side filter_self), so it shows only the analysed set.
  const storeInclude = dimInclude[dimensionKey] ?? [];
  const effectiveInclude = includeFilter.length > 0 ? includeFilter : storeInclude;
  const effectiveIncludeKey = effectiveInclude.join(" ");
  // A "contains" search pushed from elsewhere (e.g. the AI's show_on_dashboard)
  // → this table lists ONLY the matching rows, server-side, without enumerating
  // thousands of values. The user's own search box still takes priority.
  const storeSearch = dimSearch[dimensionKey] ?? "";

  // Global "Clear all" (top indicator) → reset this table's LOCAL filter state
  // too, so its dropdown checkboxes, Status/ROAS pills and search go back to
  // default along with the cleared store.
  useEffect(() => {
    if (clearSignal === 0) return;
    setDropdownSel(null);
    setExcludeSel([]);
    setStatusFilter("All");
    setMetricFilter(METRIC_FILTER_NONE);
    setSearch("");
    setDebouncedSearch("");
    filterDrivenRef.current = [];
    dropdownDrivenRef.current = [];
    setPage(1);
  }, [clearSignal]);
  // When a cross-filter is active, the parent provides distributed rows
  // (metrics attributed proportionally to the selection) for every non-source
  // dimension. We render those directly and skip the API fetch. An empty
  // array still counts as "override active" — falling back to the API would
  // show un-attributed campaign totals (inflated numbers).
  const selected = filters[dimensionKey] ?? [];
  // If THIS table is the source of cross-filter (someone selected rows here),
  // it must keep ALL its rows visible — the selection only highlights them and
  // cross-filters the OTHER tables/charts. So never narrow the source table
  // with its own distributed override; fetch the full list normally.
  const isSelfCrossSource = selected.length > 0;
  const hasOverride = dimensionKey in crossFilterRowsByDim && !isSelfCrossSource;
  const overrideRows: PerfRow[] | null = hasOverride
    ? ((crossFilterRowsByDim[dimensionKey] as PerfRow[] | null) ?? [])
    : null;

  const ownCampaignFilter = filters["campaign_name"] ?? [];
  const rowSelectedCampaigns = filters["campaign_selected"] ?? [];
  const mergedCampaignFilter =
    ownCampaignFilter.length > 0 && rowSelectedCampaigns.length > 0
      ? ownCampaignFilter.filter((c) => rowSelectedCampaigns.includes(c))
      : ownCampaignFilter.length > 0
        ? ownCampaignFilter
        : rowSelectedCampaigns.length > 0
          ? rowSelectedCampaigns
          : [];
  // Apply the EXPLICIT campaign filter (from the campaign table) as an outer scope.
  // But when THIS table is the cross-filter source (its own rows are selected), do
  // NOT also apply the DERIVED crossFilterCampaigns — those are the campaigns of the
  // selected rows, so feeding them back would collapse the table to just the selected
  // rows' campaign. The source table must stay fully visible (selection only
  // highlights + cross-filters the OTHER tables/charts).
  const campaignFilter =
    mergedCampaignFilter.length > 0
      ? mergedCampaignFilter
      : isSelfCrossSource
        ? []
        : (crossFilterCampaigns ?? []);
  const adGroupFilter = dimensionKey !== "ad_group" ? (filters["ad_group"] ?? []) : [];
  const keywordFilter = !["ad_group", "keyword"].includes(dimensionKey)
    ? (filters["keyword"] ?? [])
    : [];
  // Self-cross-filter via filter_self is skipped when THIS table is the source,
  // so other rows stay visible (dimmed) rather than disappearing.
  const crossAdGroupsFilter =
    dimensionKey === "ad_group" && adGroupFilter.length === 0 && !isSelfCrossSource
      ? (crossFilterAdGroups ?? [])
      : [];
  const crossKeywordsFilter =
    dimensionKey === "keyword" && keywordFilter.length === 0 && !isSelfCrossSource
      ? (crossFilterKeywords ?? [])
      : [];
  const crossMatchTypesFilter =
    dimensionKey === "match_type" && !isSelfCrossSource ? (crossFilterMatchTypes ?? []) : [];

  const upstreamKey = [
    campaignFilter,
    adGroupFilter,
    keywordFilter,
    crossAdGroupsFilter,
    crossKeywordsFilter,
    crossMatchTypesFilter,
  ]
    .map((a) => a.slice().sort().join("\0"))
    .join("|");

  // Load dimension names for dropdown. Fetches top 300 by cost on open (fast).
  // Re-fetches server-side when user types in the search box to find matching names.

  useEffect(() => {
    if (!dimDropdownOpen || !everVisible) return;
    // If we have names AND no search is active AND not truncated — use cache.
    if (allNames !== null && !dimDropdownDebouncedSearch && !namesTruncated) return;
    // With a search query we always re-fetch (server filters); without search + already loaded → skip.
    if (allNames !== null && !dimDropdownDebouncedSearch) return;
    setNamesLoading(true);
    let url = `${dimApiBase()}/${dimensionKey}?date_from=${dateFrom}&date_to=${dateTo}&names_only=true${connectorParam}${viewAsParam}`;
    if (dimDropdownDebouncedSearch)
      url += `&search=${encodeURIComponent(dimDropdownDebouncedSearch)}`;
    campaignFilter.forEach((c) => {
      url += `&filter_campaign=${encodeURIComponent(c)}`;
    });
    adGroupFilter.forEach((g) => {
      url += `&filter_ad_group=${encodeURIComponent(g)}`;
    });
    keywordFilter.forEach((k) => {
      url += `&filter_keyword=${encodeURIComponent(k)}`;
    });
    fetch(url)
      .then((r) => r.json())
      .then((json) => {
        setAllNames(json.names ?? []);
        setNamesTruncated(json.truncated === true);
        setTotalNamesCount(json.total_names ?? json.names?.length ?? 0);
      })
      .catch(() => {
        setAllNames([]);
        setNamesTruncated(false);
        setTotalNamesCount(0);
      })
      .finally(() => setNamesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dimDropdownOpen,
    everVisible,
    dimensionKey,
    dateFrom,
    dateTo,
    upstreamKey,
    dimDropdownDebouncedSearch,
  ]);

  // Reset dropdown name cache when upstream filters or date range change
  useEffect(() => {
    setAllNames(null);
    setNamesTruncated(false);
    setTotalNamesCount(0);
  }, [upstreamKey, dateFrom, dateTo, dimensionKey]);

  // Publish this table's exclusions to the shared store, so the Active Filters
  // bar shows them and the cross-filter engine drops them from KPIs, charts and
  // the other tables — not just this table's own rows. Cleared when empty.
  useEffect(() => {
    setDimExclude(dimensionKey, excludeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excludeFilterKey, dimensionKey]);

  // If the exclusion is cleared from the Active Filters bar (store emptied while
  // we still hold it locally), drop the local copy so the checkboxes and the
  // chip stay in sync. Only when cross-filtering is on — otherwise the store
  // never mirrors our exclusions and this would wrongly wipe them.
  const storeExcludeForDim = (storeDimExclude[dimensionKey] ?? []).join(" ");
  useEffect(() => {
    if (crossFilteringOn && excludeSel.length > 0 && storeExcludeForDim === "") setExcludeSel([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeExcludeForDim]);

  // Sync dropdown selection → global cross-filter store so KPIs, chart and
  // other tables all rebuild when the user picks specific items in the dropdown.
  // We only push when includeFilter is a non-empty subset (active filter).
  useEffect(() => {
    const fd = filterDrivenRef.current; // names pushed via Status/ROAS
    if (includeFilter.length > 0) {
      // Don't stomp a Status/ROAS driven selection — merge instead.
      if (fd.length > 0) return;
      dropdownDrivenRef.current = includeFilter;
      setFilter(dimensionKey, includeFilter);
    } else if (dropdownDrivenRef.current.length > 0) {
      // Dropdown reset — clear only our contribution.
      const cur = filters[dimensionKey] ?? [];
      const ours = dropdownDrivenRef.current;
      const sameSet = cur.length === ours.length && cur.every((v) => ours.includes(v));
      if (sameSet) clearFilter(dimensionKey);
      dropdownDrivenRef.current = [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeFilter.join(","), dimensionKey]);

  // NOTE: typing in the dropdown search box must NEVER filter the dashboard.
  // It only re-runs the `names_only` fetch above to populate the dropdown list.
  // Filtering (tables / charts / KPIs / AI) starts ONLY when the user selects
  // values via the checkboxes — see toggleOne / toggleSelectAll below, which
  // accumulate explicit values into `dropdownSel`. So there is intentionally no
  // search-driven effect here.

  // Reset page when upstream cross-filters or date range changes
  const prevUpstreamKey = useRef(upstreamKey);
  const prevDateRange = useRef(`${dateFrom}|${dateTo}`);
  useEffect(() => {
    const dateRange = `${dateFrom}|${dateTo}`;
    if (prevUpstreamKey.current !== upstreamKey || prevDateRange.current !== dateRange) {
      prevUpstreamKey.current = upstreamKey;
      prevDateRange.current = dateRange;
      setPage(1);
    }
  }, [upstreamKey, dateFrom, dateTo]);

  // Status / ROAS filter → GLOBAL cross-filter. When the user filters this
  // table by Status or ROAS, resolve the full set of matching dimension names
  // (server-side, all pages) and push them into the store as this dimension's
  // selection — so KPIs, charts and every other table rebuild for exactly that
  // subset. Cleared filter → remove only the names we pushed (don't touch a
  // manual row selection).
  useEffect(() => {
    if (!everVisible) return;
    const active = statusFilter !== "All" || isMetricFilterActive(debouncedMetricFilter);
    if (active) {
      let url = `${dimApiBase()}/${dimensionKey}?date_from=${dateFrom}&date_to=${dateTo}&names_only=true${connectorParam}${viewAsParam}`;
      if (statusFilter !== "All") url += `&status=${statusFilter}`;
      url += metricFilterParams(debouncedMetricFilter);
      campaignFilter.forEach((c) => {
        url += `&filter_campaign=${encodeURIComponent(c)}`;
      });
      adGroupFilter.forEach((g) => {
        url += `&filter_ad_group=${encodeURIComponent(g)}`;
      });
      keywordFilter.forEach((k) => {
        url += `&filter_keyword=${encodeURIComponent(k)}`;
      });
      let cancelled = false;
      fetch(url)
        .then((r) => r.json())
        .then((json) => {
          if (cancelled) return;
          const names: string[] = json.names ?? [];
          filterDrivenRef.current = names;
          if (names.length > 0) setFilter(dimensionKey, names);
          else clearFilter(dimensionKey);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    } else if (filterDrivenRef.current.length > 0) {
      // Filter cleared — drop our pushed selection (unless the user changed it).
      const cur = filters[dimensionKey] ?? [];
      const ours = filterDrivenRef.current;
      const sameSet = cur.length === ours.length && cur.every((v) => ours.includes(v));
      if (sameSet) clearFilter(dimensionKey);
      filterDrivenRef.current = [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    everVisible,
    dimensionKey,
    dateFrom,
    dateTo,
    statusFilter,
    debouncedMetricFilter,
    upstreamKey,
  ]);

  // Main fetch — fires whenever any server-side param changes.
  // When override rows are present (distributed cross-filter), we skip API and
  // process those rows client-side instead.
  useEffect(() => {
    if (!everVisible) return;

    if (hasOverride) {
      setLoading(false);
      setError(null);
      let rows = [...(overrideRows ?? [])];
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        rows = rows.filter((r) => r.dimension.toLowerCase().includes(q));
      }
      if (statusFilter === "Active") rows = rows.filter((r) => r.cost > 0);
      else if (statusFilter === "Paused") rows = rows.filter((r) => r.cost === 0);
      rows = applyMetricFilter(rows, debouncedMetricFilter);
      if (effectiveInclude.length > 0)
        rows = rows.filter((r) => effectiveInclude.includes(r.dimension));
      if (excludeFilter.length > 0) rows = rows.filter((r) => !excludeFilter.includes(r.dimension));
      if (sortCol === "dimension" && isCalendarDim) {
        rows.sort((a, b) => {
          const av = calendarRank(dimensionKey, a.dimension);
          const bv = calendarRank(dimensionKey, b.dimension);
          return sortDir === "asc" ? av - bv : bv - av;
        });
      } else {
        rows.sort((a, b) => {
          const av = a[sortCol] as number;
          const bv = b[sortCol] as number;
          if (typeof av === "number" && typeof bv === "number")
            return sortDir === "asc" ? av - bv : bv - av;
          return sortDir === "asc"
            ? String(av).localeCompare(String(bv))
            : String(bv).localeCompare(String(av));
        });
      }
      const total = rows.length;
      const sum = (k: keyof PerfRow) => rows.reduce((s, r) => s + ((r[k] as number) || 0), 0);
      const totSpend = sum("cost") * 1000;
      const totRevRaw = sum("revenue") * 1000;
      const totClicks = sum("clicks");
      const totImpr = sum("impr");
      const totConv = sum("conv");
      const roasVal = totSpend > 0 ? totRevRaw / totSpend : 0;
      const totals = {
        totImpr,
        totClicks,
        totConv,
        totCost: sum("cost"),
        totRev: sum("revenue"),
        totProfit: sum("profit"),
        avgCpc: totClicks > 0 ? totSpend / totClicks : 0,
        avgCtr: totImpr > 0 ? (totClicks / totImpr) * 100 : 0,
        avgConvRate: totClicks > 0 ? (totConv / totClicks) * 100 : 0,
        avgCpa: totConv > 0 ? totSpend / totConv : 0,
        roasVal,
        roasColor: roasVal >= 1.5 ? "green" : roasVal >= 1.0 ? "orange" : "red",
        // Same custom-metric totals the API computes on the normal path, so the
        // footer isn't blank for those columns while a cross-filter is active.
        extra: (() => {
          const keys = [...new Set(rows.flatMap((r) => Object.keys(r.extra ?? {})))];
          if (keys.length === 0) return undefined;
          return Object.fromEntries(
            keys.map((k) => {
              const sum = rows.reduce((acc, r) => acc + (r.extra?.[k] ?? 0), 0);
              const avg = isAveragedMetric(activeConnector, k);
              return [k, avg ? sum / (rows.length || 1) : sum];
            }),
          );
        })(),
      };
      const heatKey = (k: keyof PerfRow) => ({
        min: rows.reduce((m, r) => Math.min(m, r[k] as number), 0),
        max: rows.reduce((m, r) => Math.max(m, r[k] as number), 1),
      });
      const heat = {
        impr: heatKey("impr"),
        clicks: heatKey("clicks"),
        ctr: heatKey("ctr"),
        cpc: heatKey("cpc"),
        convRate: heatKey("convRate"),
        conv: heatKey("conv"),
        cpa: heatKey("cpa"),
        revenue: heatKey("revenue"),
        cost: heatKey("cost"),
        profit: heatKey("profit"),
      };
      setData(rows.slice((page - 1) * rowsPerPage, page * rowsPerPage));
      setTotal(total);
      setTotals(totals);
      setHeat(heat);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    incTableLoading();

    // For calendar dims (hour / day_of_week / week / month / quarter / year)
    // pull the whole set and paginate client-side so the chronological order
    // is preserved across pages (server doesn't know calendar sort).
    const useClientPagination = sortCol === "dimension" && isCalendarDim;
    let url = `${dimApiBase()}/${dimensionKey}?date_from=${dateFrom}&date_to=${dateTo}${connectorParam}${viewAsParam}`;
    if (useClientPagination) {
      url += `&page=1&limit=2000`;
    } else {
      url += `&page=${page}&limit=${rowsPerPage}`;
    }
    url += `&sort=${sortCol}&sort_dir=${sortDir}`;
    const searchParam = debouncedSearch || storeSearch;
    if (searchParam) url += `&search=${encodeURIComponent(searchParam)}`;
    if (statusFilter !== "All") url += `&status=${statusFilter}`;
    url += metricFilterParams(debouncedMetricFilter);
    campaignFilter.forEach((c) => {
      url += `&filter_campaign=${encodeURIComponent(c)}`;
    });
    adGroupFilter.forEach((g) => {
      url += `&filter_ad_group=${encodeURIComponent(g)}`;
    });
    keywordFilter.forEach((k) => {
      url += `&filter_keyword=${encodeURIComponent(k)}`;
    });
    crossAdGroupsFilter.forEach((g) => {
      url += `&filter_self=${encodeURIComponent(g)}`;
    });
    crossKeywordsFilter.forEach((k) => {
      url += `&filter_self=${encodeURIComponent(k)}`;
    });
    crossMatchTypesFilter.forEach((m) => {
      url += `&filter_self=${encodeURIComponent(m)}`;
    });

    // DROPDOWN value selection narrows THIS table to ONLY the chosen values (and the
    // Total recalculates server-side for them). Row-click / checkbox selection does
    // NOT set includeFilter, so those still only highlight here and cross-filter the
    // OTHER tables (source stays full). A selection can be huge (e.g. "select all"
    // of a search over thousands of terms), so it's sent in the POST body instead of
    // the query string — no URL-length cap, every selected row is filtered.
    const fetchOpts: RequestInit = { signal: ctrl.signal };
    if (effectiveInclude.length > 0 || excludeFilter.length > 0) {
      fetchOpts.method = "POST";
      fetchOpts.headers = { "Content-Type": "application/json" };
      // Include narrows to the chosen rows; exclude drops the unticked ones and
      // keeps the rest (the API honours both — see filter_exclude in the route).
      fetchOpts.body = JSON.stringify({
        ...(effectiveInclude.length > 0 ? { filter_self: effectiveInclude } : {}),
        ...(excludeFilter.length > 0 ? { filter_exclude: excludeFilter } : {}),
      });
    }

    fetch(url, fetchOpts)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        let rows: PerfRow[] = json.data ?? [];
        if (useClientPagination) {
          rows = [...rows].sort((a, b) => {
            const av = calendarRank(dimensionKey, a.dimension);
            const bv = calendarRank(dimensionKey, b.dimension);
            return sortDir === "asc" ? av - bv : bv - av;
          });
          setTotal(rows.length);
          setData(rows.slice((page - 1) * rowsPerPage, page * rowsPerPage));
        } else {
          setData(rows);
          setTotal(json.total ?? 0);
        }
        setTotals(json.totals ?? null);
        setHeat(json.heat ?? null);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) {
          setLoading(false);
          decTableLoading();
        }
      });

    return () => {
      ctrl.abort();
      decTableLoading();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    everVisible,
    dimensionKey,
    dateFrom,
    dateTo,
    page,
    rowsPerPage,
    sortCol,
    sortDir,
    debouncedSearch,
    storeSearch,
    statusFilter,
    debouncedMetricFilter,
    upstreamKey,
    dropdownSel,
    effectiveIncludeKey,
    excludeFilterKey,
    connectorParam,
    hasOverride,
    overrideRows,
  ]);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("desc");
    }
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));

  // Fallback range for a column the server sent no range for (an older cached
  // response, or a metric registered since it was built).
  const DEFAULT_RANGE = { min: 0, max: 1 };
  const h: HeatRanges = heat ?? {
    impr: { min: 0, max: 1 },
    clicks: { min: 0, max: 1 },
    ctr: { min: 0, max: 1 },
    cpc: { min: 0, max: 1 },
    convRate: { min: 0, max: 1 },
    conv: { min: 0, max: 1 },
    cpa: { min: 0, max: 1 },
    revenue: { min: 0, max: 1 },
    cost: { min: 0, max: 1 },
    profit: { min: 0, max: 1 },
  };
  // For profit heatmap: positive values scale on green range (0..max), negative on red (min..0).
  const profitMax = Math.max(1, h.profit?.max ?? 1);
  const profitMin = Math.min(0, h.profit?.min ?? 0);

  // ─── Config-driven metric column rendering ─────────────────────────────────
  // Header / body / footer cells for each metric key, so the admin-configured
  // set + order render consistently across the three table sections.
  const renderMetricTh = (m: TableMetricCol) => (
    <th
      key={m.key}
      className="px-1.5 sm:px-2.5 py-2.5 text-right text-gray-500 font-medium text-[12px] sm:whitespace-nowrap cursor-pointer hover:text-gray-700 select-none"
      onClick={() => handleSort(m.key as SortCol)}
    >
      {m.label} <SortIcon dir={sortCol === m.key ? sortDir : null} />
    </th>
  );
  const heatTd = (
    key: string,
    content: React.ReactNode,
    val: number,
    range: { min: number; max: number },
    color: "blue" | "green",
    extra = "",
  ) => (
    <td
      key={key}
      className={`px-1.5 sm:px-2.5 py-2.5 text-gray-700 text-right tabular-nums ${extra}`}
      style={{ backgroundColor: heatmapBg(val, range.min, range.max, color) }}
    >
      {content}
    </td>
  );
  // An admin-registered custom metric has no dedicated PerfRow/PerfTotals
  // field, so both the cell and the footer total format it from the column's
  // own declared format. Shared so the two can't drift apart.
  const formatCustomMetric = (v: number, format?: TableMetricCol["format"]) =>
    format === "money"
      ? fmtCurrency(v)
      : format === "percent" || format === "ratio"
        ? fmtPct(v)
        : fmtNum(v);

  const renderMetricTd = (m: TableMetricCol, row: PerfRow) => {
    switch (m.key) {
      case "roasVal": {
        const rs = roasStyle(row.roasColor);
        return (
          <td key={m.key} className="px-2.5 py-2.5 text-right tabular-nums">
            {row.roasColor !== "gray" ? (
              <span
                className="inline-block px-2 py-0.5 rounded text-[12px] font-semibold"
                style={{ backgroundColor: rs.bg, color: rs.text }}
              >
                {row.roas}
              </span>
            ) : (
              <span className="text-gray-400 text-[12px]">—</span>
            )}
          </td>
        );
      }
      case "impr":
        return heatTd(m.key, fmtNum(row.impr), row.impr, h.impr, "blue");
      case "clicks":
        return heatTd(m.key, fmtNum(row.clicks), row.clicks, h.clicks, "blue");
      case "cpc":
        return heatTd(m.key, fmtCurrency(row.cpc), row.cpc, h.cpc, "blue");
      case "ctr":
        return heatTd(m.key, fmtPct(row.ctr), row.ctr, h.ctr, "blue");
      case "convRate":
        return heatTd(m.key, fmtPct(row.convRate), row.convRate, h.convRate, "blue");
      case "conv":
        return heatTd(m.key, fmtNum(row.conv), row.conv, h.conv, "blue");
      case "cpa":
        return heatTd(m.key, fmtCurrency(row.cpa), row.cpa, h.cpa, "green");
      case "revenue":
        return heatTd(
          m.key,
          <>${fmtK(row.revenue)}</>,
          row.revenue,
          h.revenue,
          "green",
          "font-medium",
        );
      case "cost":
        return heatTd(m.key, <>${fmtK(row.cost)}</>, row.cost, h.cost, "green");
      case "profit":
        return (
          <td
            key={m.key}
            className={`px-2.5 py-2.5 text-right tabular-nums ${row.profit < 0 ? "text-red-600" : "text-green-700"}`}
            style={{
              backgroundColor:
                row.profit < 0
                  ? heatmapBg(Math.abs(row.profit), 0, Math.abs(profitMin) || 1, "red")
                  : heatmapBg(row.profit, 0, profitMax, "green"),
            }}
          >
            {row.profit < 0 ? "-$" : "$"}
            {fmtK(row.profit)}
          </td>
        );
      default: {
        // Admin-registered custom metric (raw Windsor field, e.g. GA4's
        // bounceRate) — no dedicated PerfRow field, read from `extra` and
        // format per the column's own declared format.
        const raw = row.extra?.[m.key];
        if (raw === undefined) return <td key={m.key} />;
        // Shaded like every other numeric column — the server sends a range for
        // these keys too. Without it these columns read as a different, dead
        // kind of column next to the shaded canonical ones.
        return heatTd(
          m.key,
          formatCustomMetric(raw, m.format),
          raw,
          h[m.key] ?? DEFAULT_RANGE,
          "blue",
        );
      }
    }
  };
  const renderMetricFootTd = (m: TableMetricCol, t: PerfTotals) => {
    switch (m.key) {
      case "roasVal":
        return (
          <td key={m.key} className="px-2.5 py-3 text-right tabular-nums">
            <span
              className="inline-block px-2 py-0.5 rounded text-[12px] font-semibold"
              style={{
                backgroundColor:
                  t.roasColor === "green"
                    ? "#DCFCE7"
                    : t.roasColor === "red"
                      ? "#FEE2E2"
                      : "#FFEDD5",
                color:
                  t.roasColor === "green"
                    ? "#15803D"
                    : t.roasColor === "red"
                      ? "#DC2626"
                      : "#EA580C",
              }}
            >
              {t.roasVal.toFixed(2)}x
            </span>
          </td>
        );
      case "impr":
        return (
          <td key={m.key} className="px-2.5 py-3 text-right tabular-nums">
            {fmtNum(t.totImpr)}
          </td>
        );
      case "clicks":
        return (
          <td key={m.key} className="px-2.5 py-3 text-right tabular-nums">
            {fmtNum(t.totClicks)}
          </td>
        );
      case "cpc":
        return (
          <td key={m.key} className="px-2.5 py-3 text-right tabular-nums">
            {fmtCurrency(t.avgCpc)}
          </td>
        );
      case "ctr":
        return (
          <td key={m.key} className="px-2.5 py-3 text-right tabular-nums">
            {fmtPct(t.avgCtr)}
          </td>
        );
      case "convRate":
        return (
          <td key={m.key} className="px-2.5 py-3 text-right tabular-nums">
            {fmtPct(t.avgConvRate)}
          </td>
        );
      case "conv":
        return (
          <td key={m.key} className="px-2.5 py-3 text-right tabular-nums">
            {fmtNum(t.totConv)}
          </td>
        );
      case "cpa":
        return (
          <td key={m.key} className="px-2.5 py-3 text-right tabular-nums">
            {fmtCurrency(t.avgCpa)}
          </td>
        );
      case "revenue":
        return (
          <td key={m.key} className="px-2.5 py-3 text-right tabular-nums font-medium">
            ${fmtK(t.totRev)}
          </td>
        );
      case "cost":
        return (
          <td key={m.key} className="px-2.5 py-3 text-right tabular-nums">
            ${fmtK(t.totCost)}
          </td>
        );
      case "profit":
        return (
          <td
            key={m.key}
            className={`px-2.5 py-3 text-right tabular-nums ${t.totProfit < 0 ? "text-red-600" : "text-green-700"}`}
          >
            {t.totProfit < 0 ? "-$" : "$"}
            {fmtK(t.totProfit)}
          </td>
        );
      default: {
        // Admin-registered custom metric — no dedicated PerfTotals field, so
        // read the per-key total the API computes alongside the canonical ones.
        const v = t.extra?.[m.key];
        return (
          <td key={m.key} className="px-2.5 py-3 text-right tabular-nums">
            {v === undefined ? "" : formatCustomMetric(v, m.format)}
          </td>
        );
      }
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 relative">
      {/* Header — title + meta on the left, dropdown / filters / clear on the right (single row) */}
      <div className="px-4 sm:px-5 py-3 sm:py-4 flex items-start sm:items-center justify-between flex-wrap gap-3 border-b border-gray-100">
        <div className="min-w-0">
          <h2 className="text-[15px] sm:text-[17px] font-bold text-gray-900">{title}</h2>
          <p className="text-[13px] text-gray-400 mt-0.5 hidden sm:block">
            {loading
              ? "Loading…"
              : error
                ? "Error loading data"
                : `${total} ${dimensionLabel.toLowerCase()}s • ${rangeLabel}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto overflow-x-auto scrollbar-none">
          {/* Multi-select dimension dropdown */}
          <div className="relative shrink-0">
            <button
              ref={dimBtnRef}
              onClick={() => {
                if (!dimDropdownOpen && dimBtnRef.current) {
                  const r = dimBtnRef.current.getBoundingClientRect();
                  const left = Math.max(8, Math.min(r.left, window.innerWidth - 296));
                  setDimDropdownPos({
                    top: r.bottom + 6,
                    left,
                    maxHeight: Math.max(180, window.innerHeight - r.bottom - 14),
                  });
                }
                setDimDropdownOpen((v) => !v);
              }}
              className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5 text-[13px] transition whitespace-nowrap shrink-0 ${
                dropdownFiltered
                  ? "bg-emerald-50 border-emerald-300 text-emerald-700 font-medium"
                  : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
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
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
              {dimensionLabel}
              {/* Count shows how many rows the dropdown is acting on — the
                  included subset, or the excluded set prefixed with a minus. */}
              {includeFilter.length > 0 ? (
                <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                  {includeFilter.length}
                </span>
              ) : excludeFilter.length > 0 ? (
                <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                  −{excludeFilter.length}
                </span>
              ) : null}
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`transition-transform ${dimDropdownOpen ? "rotate-180" : ""}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {/* Dimension multi-select dropdown — portaled to body so no table
                overflow/transform can clip or offset it */}
            {dimDropdownOpen &&
              typeof document !== "undefined" &&
              createPortal(
                <>
                  <div
                    ref={dimDropdownRef}
                    className="fixed w-70 bg-white border border-gray-200 rounded-xl shadow-xl z-130 flex flex-col animate-in fade-in zoom-in-95 duration-150 origin-top-left"
                    style={{
                      top: dimDropdownPos.top,
                      left: dimDropdownPos.left,
                      maxHeight: dimDropdownPos.maxHeight,
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
                          value={dimDropdownSearch}
                          onChange={(e) => setDimDropdownSearch(e.target.value)}
                          placeholder={`Search ${dimensionLabel.toLowerCase()}s:`}
                          className="text-[12px] outline-none w-full bg-transparent"
                        />
                        {dimDropdownSearch && (
                          <button
                            onClick={() => setDimDropdownSearch("")}
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
                      const all = allNames ?? [];
                      // When a server-side search is active (user typed something and server
                      // returned filtered results), use them directly without client filtering.
                      // When no server search is active, do client-side filter on the local list.
                      const visibleNames = dimDropdownDebouncedSearch
                        ? all // server already filtered
                        : all.filter((n) =>
                            n.toLowerCase().includes(dimDropdownSearch.toLowerCase()),
                          );
                      // checked(n): in the "everything" default (dropdownSel === null) a
                      // row is checked unless excluded — EXCEPT while a search is active,
                      // where results start UNCHECKED so the user ticks the ones to filter
                      // TO (an include), instead of seeing them pre-checked and having to
                      // untick. Once an explicit include subset exists, membership decides.
                      const searching = dimDropdownSearch.trim().length > 0;
                      const isChecked = (n: string) =>
                        dropdownSel === null
                          ? searching
                            ? false
                            : !excludeSel.includes(n)
                          : dropdownSel.includes(n);
                      const allVisibleChecked =
                        visibleNames.length > 0 && visibleNames.every(isChecked);
                      const someVisibleChecked = visibleNames.some(isChecked);

                      const toggleOne = (n: string) => {
                        if (dropdownSel === null) {
                          if (searching) {
                            // Searching from the "everything" default → start an explicit
                            // INCLUDE with this row (filter_self), so ticking a found row
                            // filters the table TO it instead of excluding it from all.
                            setDropdownSel([n]);
                          } else {
                            // Everything mode, no search → unticking excludes (all-except).
                            setExcludeSel((cur) => toggleExcluded(cur, n));
                          }
                        } else {
                          // Explicit include subset → tick rows to narrow to them.
                          const base = [...dropdownSel];
                          const next = base.includes(n)
                            ? base.filter((x) => x !== n)
                            : [...base, n];
                          const shouldCollapse =
                            next.length === all.length &&
                            !namesTruncated &&
                            !dimDropdownDebouncedSearch &&
                            !searching;
                          setDropdownSel(shouldCollapse ? null : next);
                        }
                        setPage(1);
                      };
                      const toggleSelectAll = () => {
                        if (dropdownSel === null) {
                          if (!searching) {
                            // No search: unticking the header still means "start from
                            // nothing and build an include", the same as before.
                            if (allVisibleChecked) setDropdownSel([]);
                            else setExcludeSel([]);
                          } else {
                            // Searching + "Select all" → keep ONLY the found rows.
                            // Intuitive intent: search "Stuhr", Select-all, see just
                            // the Stuhr terms. Build an explicit INCLUDE set
                            // (filter_self) from the matches — the old code EXCLUDED
                            // them instead (all-except-Stuhr), which looked like the
                            // filter did nothing / reset. With a search active the
                            // route returns every match (not truncated), so the set is
                            // complete. Empty match set → back to "everything" (null).
                            setDropdownSel(
                              visibleNames.length > 0 ? [...new Set(visibleNames)] : null,
                            );
                            setDimSearch(dimensionKey, "");
                          }
                        } else if (allVisibleChecked) {
                          const visSet = new Set(visibleNames);
                          setDropdownSel(dropdownSel.filter((x) => !visSet.has(x)));
                          setDimSearch(dimensionKey, "");
                        } else {
                          const next = [...new Set([...dropdownSel, ...visibleNames])];
                          const shouldCollapse =
                            next.length === all.length &&
                            !namesTruncated &&
                            !dimDropdownDebouncedSearch &&
                            !searching;
                          setDropdownSel(shouldCollapse ? null : next);
                        }
                        setPage(1);
                      };

                      return (
                        <>
                          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 shrink-0">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={allVisibleChecked}
                                ref={(el) => {
                                  if (el)
                                    el.indeterminate = someVisibleChecked && !allVisibleChecked;
                                }}
                                onChange={toggleSelectAll}
                                className="rounded"
                              />
                              <span className="text-[12px] font-medium text-gray-700">
                                Select all
                              </span>
                            </label>
                            {(dropdownSel !== null || excludeSel.length > 0) && (
                              <button
                                onClick={() => {
                                  setDropdownSel(null);
                                  setExcludeSel([]);
                                  clearFilter(dimensionKey);
                                  setPage(1);
                                }}
                                className="text-[11px] text-gray-400 hover:text-gray-700 transition"
                              >
                                × Reset
                              </button>
                            )}
                          </div>
                          <div
                            className="overflow-y-auto p-1 flex-1"
                            onScroll={(e) => {
                              const el = e.currentTarget;
                              // Load the next chunk when scrolled near the bottom.
                              if (
                                el.scrollTop + el.clientHeight >= el.scrollHeight - 80 &&
                                dropdownRender < visibleNames.length
                              ) {
                                setDropdownRender((c) =>
                                  Math.min(c + DROPDOWN_CHUNK, visibleNames.length),
                                );
                              }
                            }}
                          >
                            {visibleNames.slice(0, dropdownRender).map((n) => (
                              <label
                                key={n}
                                className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 cursor-pointer rounded-lg transition"
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked(n)}
                                  onChange={() => toggleOne(n)}
                                  className="rounded"
                                />
                                <span className="text-[12px] text-gray-700 truncate">{n}</span>
                              </label>
                            ))}
                            {dropdownRender < visibleNames.length && (
                              <div className="px-2 py-2 text-center text-[10px] text-gray-300">
                                Scroll for more…
                              </div>
                            )}
                            {namesLoading && (
                              <div className="px-2 py-3 text-center text-[11px] text-gray-400 flex items-center justify-center gap-1.5">
                                <svg
                                  className="animate-spin w-3 h-3"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                >
                                  <circle
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeDasharray="32"
                                    strokeDashoffset="8"
                                  />
                                </svg>
                                {dimDropdownDebouncedSearch ? "Searching…" : "Loading…"}
                              </div>
                            )}
                            {allNames && visibleNames.length === 0 && !namesLoading && (
                              <div className="px-2 py-4 text-center text-[12px] text-gray-400">
                                No results found
                              </div>
                            )}
                            {namesTruncated && !dimDropdownDebouncedSearch && (
                              <div className="px-3 py-2 border-t border-gray-100 text-[10px] text-gray-400 text-center">
                                Showing top {allNames?.length ?? 0} of{" "}
                                {totalNamesCount.toLocaleString()} — type to search all
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
          </div>

          {/* Filter dropdown */}
          <div className="relative shrink-0">
            <button
              ref={filterBtnRef}
              onClick={() => {
                if (!filterOpen && filterBtnRef.current) {
                  const r = filterBtnRef.current.getBoundingClientRect();
                  const left = Math.max(8, Math.min(r.right - 288, window.innerWidth - 296));
                  setFilterDropdownPos({
                    top: r.bottom + 6,
                    left,
                    maxHeight: Math.max(180, window.innerHeight - r.bottom - 14),
                  });
                }
                setFilterOpen((v) => !v);
              }}
              className={`flex items-center gap-1 border rounded-lg px-2.5 py-1.5 text-[13px] transition ${
                statusFilter !== "All" || isMetricFilterActive(metricFilter)
                  ? "bg-emerald-50 border-emerald-300 text-emerald-700 font-medium"
                  : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
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
              {(statusFilter !== "All" || isMetricFilterActive(metricFilter)) && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              )}
            </button>
            {filterOpen &&
              typeof document !== "undefined" &&
              createPortal(
                <>
                  <div
                    ref={filterDropdownRef}
                    className="fixed w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-130 p-3 space-y-3 overflow-y-auto animate-in fade-in zoom-in-95 duration-150 origin-top-right"
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
                      onChange={setMetricFilter}
                    />
                    {/* Status — moved BELOW the numeric filter per spec. Offered
                        only where it means something (see showStatus): filtering
                        by it on a spend-free source returns every row or none. */}
                    {showStatus && (
                      <div>
                        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                          Status
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {(["All", "Active", "Paused"] as const).map((s) => (
                            <button
                              key={s}
                              onClick={() => {
                                setStatusFilter(s);
                                setPage(1);
                              }}
                              className={`px-2 py-0.5 rounded-full text-[12px] font-medium transition ${
                                statusFilter === s
                                  ? "bg-emerald-600 text-white"
                                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                              }`}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {(statusFilter !== "All" || isMetricFilterActive(metricFilter)) && (
                      <button
                        onClick={() => {
                          setStatusFilter("All");
                          setMetricFilter(METRIC_FILTER_NONE);
                          setPage(1);
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
          {(selected.length > 0 ||
            includeFilter.length > 0 ||
            statusFilter !== "All" ||
            isMetricFilterActive(metricFilter) ||
            debouncedSearch) && (
            <button
              onClick={() => {
                clearFilter(dimensionKey);
                setDropdownSel(null);
                setStatusFilter("All");
                setMetricFilter(METRIC_FILTER_NONE);
                setSearch("");
                setPage(1);
              }}
              className="text-[13px] text-emerald-600 hover:text-emerald-800 whitespace-nowrap shrink-0 font-medium"
            >
              Clear (
              {Math.max(selected.length, includeFilter.length) +
                (statusFilter !== "All" ? 1 : 0) +
                (isMetricFilterActive(metricFilter) ? 1 : 0) +
                (debouncedSearch ? 1 : 0)}
              )
            </button>
          )}
          {headerRight}
        </div>
      </div>

      {/* Loading / Error / Empty.
          The big centered spinner only shows on the FIRST load (no rows yet).
          Subsequent paging / sorting / searching / filtering keep the previous
          page visible (dimmed) and show a small "Updating…" chip instead — see
          the table block below. The dataset is cached server-side for 30 min, so
          those refetches resolve almost instantly; blanking to a full spinner is
          what made them feel slow. */}
      {(loading || crossFilterBusy) && data.length === 0 && (
        <div className="flex items-center justify-center py-12 gap-2 text-gray-400 text-[14px]">
          <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          Loading data…
        </div>
      )}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-12 text-[14px] text-red-500 gap-2">
          <div className="flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error.includes("not configured") || error.includes("503")
              ? "Connect a data source to see this data."
              : error.includes("timed out") || error.toLowerCase().includes("timeout")
                ? "Request timed out — try a smaller date range."
                : error}
          </div>
          {(error.toLowerCase().includes("timeout") ||
            error.includes("timed out") ||
            error.includes("500")) && (
            <button
              onClick={() => {
                setError(null);
                setPage(1);
              }}
              className="text-[12px] text-emerald-600 hover:text-emerald-800 underline"
            >
              Retry
            </button>
          )}
        </div>
      )}
      {!loading && !crossFilterBusy && !error && total === 0 && everVisible && (
        <div className="flex flex-col items-center justify-center gap-1 py-12 text-[14px] text-gray-400">
          {/* An empty table means two very different things. Without a
              cross-filter it's genuinely no data for the period. WITH one, the
              rows exist — none of them just happen to overlap the current
              selection, which is a normal outcome for a narrow selection on a
              sparse dimension. Saying "no data for selected period" there reads
              as a broken table, so name the actual cause. */}
          {hasOverride ? (
            <>
              <span>No rows match the current filter selection.</span>
              <button
                onClick={clearAll}
                className="text-[13px] text-emerald-600 hover:text-emerald-700 underline"
              >
                Clear filters
              </button>
            </>
          ) : (
            <span>No data for selected period.</span>
          )}
        </div>
      )}

      {/* Table — stays visible (dimmed) during refetch so paging / sorting /
          searching / filtering feels instant instead of blanking to a spinner. */}
      {!error && data.length > 0 && (
        <div
          className={`relative transition-opacity duration-200 ${loading ? "opacity-50" : "opacity-100"}`}
          aria-busy={loading || crossFilterBusy}
        >
          {/* Stays visible for the WHOLE operation: the table's own fetch (loading) AND
              the longer background cross-filter / period / dimension work (crossFilterBusy),
              so the indicator never disappears while the request is still running. */}
          {(loading || crossFilterBusy) && (
            <div className="absolute top-2.5 right-3 z-30 flex items-center gap-1.5 text-[12px] font-medium text-emerald-600 bg-white/95 border border-emerald-100 px-2.5 py-1 rounded-lg shadow-sm">
              <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              Updating…
            </div>
          )}
          <div className="overflow-x-auto overflow-y-hidden rounded-b-2xl">
            {/* The min-width applies from sm up only. Forcing it on a phone pushed the
                metric columns past the right edge — behind the sticky name column
                they were simply never reachable. Unset, the table fills the
                viewport and the columns shrink to their content, scrolling only
                as far as the content actually needs. */}
            <table className="w-full text-[13px] border-collapse sm:min-w-275">
              <thead>
                <tr className="bg-gray-50/80">
                  <th className="px-2.5 py-2.5 w-8 sticky left-0 z-20 bg-gray-50">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5 rounded accent-emerald-600 cursor-pointer"
                        checked={
                          data.length > 0 &&
                          (() => {
                            const sSet = new Set(selected);
                            return data.every((r) => sSet.has(r.dimension));
                          })()
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            const next = [
                              ...new Set([...selected, ...data.map((r) => r.dimension)]),
                            ];
                            setFilter(dimensionKey, next);
                          } else {
                            const remove = new Set(data.map((r) => r.dimension));
                            const next = selected.filter((v) => !remove.has(v));
                            if (next.length === 0) clearFilter(dimensionKey);
                            else setFilter(dimensionKey, next);
                          }
                        }}
                      />
                      {namesCollapsed && (
                        <button
                          onClick={() => setNamesCollapsed(false)}
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
                  {showStatus && (
                    <th className="px-2 py-2.5 text-left text-gray-500 font-medium text-[12px] whitespace-nowrap hidden sm:table-cell">
                      Status
                    </th>
                  )}
                  <th className="sm:w-[184px] text-left text-gray-500 font-medium text-[12px] sticky left-8 z-20 bg-gray-50 overflow-hidden p-0 after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-gray-200">
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
                      <span
                        className="flex items-center justify-between w-full cursor-pointer hover:text-gray-700 select-none"
                        onClick={() => handleSort("dimension")}
                      >
                        <span className="flex items-center gap-1">
                          {dimensionLabel}{" "}
                          <SortIcon dir={sortCol === "dimension" ? sortDir : null} />
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setNamesCollapsed(true);
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
                  </th>
                  {metricCols.map(renderMetricTh)}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // When the store selection equals what a Status/ROAS filter
                  // pushed, treat it as "no manual selection" for row styling so
                  // the matching rows aren't all rendered bold/highlighted.
                  const fd = filterDrivenRef.current;
                  const fdSet = new Set(fd);
                  const isFilterDriven =
                    selected.length > 0 &&
                    selected.length === fd.length &&
                    selected.every((v) => fdSet.has(v));
                  const displaySelected = isFilterDriven ? [] : selected;
                  const displaySelectedSet = new Set(displaySelected);
                  return data.map((row, i) => {
                    const isSelected = displaySelectedSet.has(row.dimension);
                    const anySelected = displaySelected.length > 0;
                    const isActive = row.cost > 0;
                    return (
                      <tr
                        key={i}
                        onClick={() => {
                          // Single-select on ROW click (same as the Campaigns table):
                          // clears any previous selection and keeps only this row. Clicking
                          // the already-only-selected row clears it. Multi-select is via the
                          // checkbox (toggleValue). The list stays fully visible regardless.
                          const isOnly = selected.length === 1 && selected[0] === row.dimension;
                          if (isOnly) clearFilter(dimensionKey);
                          else selectSingle(dimensionKey, row.dimension);
                        }}
                        className={`border-t border-gray-100 cursor-pointer group transition-colors duration-150 ${
                          isSelected
                            ? "bg-emerald-50/40 [&_td]:font-bold"
                            : anySelected
                              ? "opacity-50 hover:opacity-80"
                              : "hover:bg-emerald-50/20"
                        }`}
                      >
                        <td
                          className={`px-2.5 py-2.5 sticky left-0 z-10 isolate ${isSelected ? "bg-emerald-50" : "bg-white group-hover:bg-emerald-50/40"}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            className="w-3.5 h-3.5 rounded accent-emerald-600 cursor-pointer"
                            checked={isSelected}
                            onChange={() => toggleValue(dimensionKey, row.dimension)}
                          />
                        </td>
                        {showStatus && (
                          <td className="hidden sm:table-cell px-2 py-2.5">
                            <span
                              className={`w-2 h-2 rounded-full inline-block ${isActive ? "bg-green-500" : "bg-gray-300"}`}
                            />
                          </td>
                        )}
                        <td
                          className={`sticky left-8 z-10 isolate overflow-hidden after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-gray-100 p-0 ${isSelected ? "bg-emerald-50" : "bg-white group-hover:bg-emerald-50/40"}`}
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
                              transition:
                                "width 380ms cubic-bezier(0.4, 0, 0.2, 1), padding-left 380ms cubic-bezier(0.4, 0, 0.2, 1), padding-right 380ms cubic-bezier(0.4, 0, 0.2, 1), opacity 260ms ease",
                              whiteSpace: "normal",
                            }}
                          >
                            {/* Always wrap long names onto multiple lines instead of truncating. */}
                            <span
                              className="font-medium text-gray-800 text-[12px] whitespace-normal wrap-break-word max-w-40 block"
                              title={row.dimension}
                            >
                              {row.dimension}
                            </span>
                          </div>
                        </td>
                        {metricCols.map((m) => renderMetricTd(m, row))}
                      </tr>
                    );
                  });
                })()}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold text-gray-800 text-[13px]">
                    <td className="px-2.5 py-3 sticky left-0 z-10 bg-gray-50" />
                    {showStatus && <td className="hidden sm:table-cell px-2 py-3 bg-gray-50" />}
                    <td className="sticky left-8 z-10 bg-gray-50 overflow-hidden p-0">
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
                        <span className="text-gray-400 font-normal text-[11px]">({total})</span>
                      </div>
                    </td>
                    {metricCols.map((m) => renderMetricFootTd(m, totals))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Pagination */}
          <div className="px-4 sm:px-5 py-3 flex items-center justify-between flex-wrap gap-2 border-t border-gray-100">
            <p className="text-[13px] text-gray-500">
              <span className="hidden sm:inline">
                Showing {(page - 1) * rowsPerPage + 1}–{Math.min(page * rowsPerPage, total)} of{" "}
                {total} {dimensionLabel.toLowerCase()}s
              </span>
              <span className="sm:hidden">
                {(page - 1) * rowsPerPage + 1}–{Math.min(page * rowsPerPage, total)} / {total}
              </span>
              {total > rowsPerPage && (
                <>
                  <span className="mx-2 hidden sm:inline">|</span>
                  <span className="hidden sm:inline">Rows:</span>
                  <select
                    value={rowsPerPage}
                    onChange={(e) => {
                      setRowsPerPage(Number(e.target.value));
                      setPage(1);
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
                onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                    onClick={() => setPage(p)}
                    className={`w-7 h-7 rounded-lg text-[13px] font-medium transition ${page === p ? "bg-emerald-600 text-white" : "text-gray-500 hover:bg-gray-100"}`}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
        </div>
      )}
    </div>
  );
}
