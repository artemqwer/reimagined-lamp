"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { fetchWindsorData } from "@/lib/windsor";
import { rowsApiBase, dimApiBase } from "@/lib/dataSource";
import { useCrossFilter } from "@/lib/store";

// ─── Data imports ─────────────────────────────────────────────────────────────
import {
  kpis,
  I,
  tabs,
  TAB_INDEX,
  COLORS,
  CAMPAIGN_TYPE_MAP,
  TYPES,
  TYPE_COLORS_MAP,
  normalizeChannelType,
  END_MS,
  DAY_MS,
  fmtMs,
  TYPE_TO_GROUPS,
  fmtNum,
  fmtCurrency,
  fmtPct,
  ChartGroupBy,
  SortDir,
  SortKey,
  AdPerfItem,
  PlItem,
  AiMessage,
  AiInsight,
  AiSelectionChip,
  DateAction,
  FilterAction,
  ChatSession,
} from "./_data/constants";
import { generatePeriodData } from "./_data/generators";

// ─── Component imports ────────────────────────────────────────────────────────
import {
  MetricFilterState,
  METRIC_FILTER_NONE,
  isMetricFilterActive,
  applyMetricFilter,
  metricFilterKey,
} from "@/lib/metricFilter";
import KpiCard from "./_components/KpiCard";
import CampaignTable from "./_components/CampaignTable";
import PerformanceTable from "./_components/PerformanceTable";
import ConfigurableTableWidget from "./_components/ConfigurableTableWidget";
import AiSidebar from "./_components/AiSidebar";
import DatePickerPanel from "./_components/DatePickerPanel";
import MobileDatePicker from "./_components/MobileDatePicker";
import AddEventModal from "./_components/AddEventModal";
import { generateHolidays, hasVisibleEvents } from "./_components/Timeline";
import type { CustomEvent, EventType } from "./_data/types";
import TabContent from "./_components/TabContent";
import { createClient } from "@/lib/supabase";
import {
  makeRenderConvLabel,
  makeRenderLossTopLabel,
  makeRenderTotalLabel,
} from "./_components/ChartPrimitives";
import ExtendedAnalytics from "./_components/ExtendedAnalytics";
import ConnectorSwitcher from "./_components/ConnectorSwitcher";
import { anomaliesFromDailyRows } from "@/lib/smartGoalAnomalies";
import {
  getConnector,
  getDimensionDef,
  readDimensionValue,
  applyKpiConfig,
  applyMetricColConfig,
  chartDimensionList,
  isAveragedMetric,
  chartMetricList,
  crossFilterDimensionsFor,
  type MetricFormat,
} from "@/lib/connectors";

// Formats a raw custom-metric value (an admin-registered raw Windsor field
// with no canonical formula) for KPI-card display, using the metric's own
// declared format — mirrors the money/number/percent conventions the
// hardcoded canonical KPI formatters below already use.
function formatCustomMetricValue(v: number, format?: MetricFormat): string {
  switch (format) {
    case "money":
      return v >= 1_000_000
        ? `$${(v / 1_000_000).toFixed(2)}M`
        : v >= 1000
          ? `$${(v / 1000).toFixed(2)}K`
          : `$${v.toFixed(2)}`;
    case "percent":
      return `${v.toFixed(2)}%`;
    case "ratio":
      return `${v.toFixed(2)}x`;
    default:
      return v >= 1_000_000
        ? `${(v / 1_000_000).toFixed(2)}M`
        : v >= 1000
          ? `${(v / 1000).toFixed(2)}K`
          : String(Math.round(v));
  }
}

// Cross-filter dimension → human label. Used by the Active Filters bar and the AI
// selection chips. Covers Google Ads' dimensions plus the synthetic keys that
// aren't manifest dimensions at all (the two campaign ones, the time buckets).
// Every OTHER connector's dimensions are resolved from its manifest instead —
// see dimLabelFor.
const DIM_LABELS: Record<string, string> = {
  ad_group: "Ad Group",
  keyword: "Keyword",
  match_type: "Match Type",
  search_term: "Search Term",
  device: "Device",
  network: "Network",
  audience: "Audience",
  country: "Country",
  region: "Region",
  hour: "Hour",
  day_of_week: "Day of Week",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

// Last-resort label for a key that's neither a manifest dimension nor a known
// synthetic one, so an active filter is never invisible (and therefore
// impossible to clear) just because nothing named it.
const humanizeDimKey = (key: string) =>
  key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

/** Human label for a cross-filter key, for whatever source is active.
 *  The primary table writes its selection under the two fixed `campaign_*`
 *  keys regardless of connector, so those take the connector's own primary
 *  label — "Channel" on GA4, "Product" on Shopify — not a hardcoded
 *  "Campaign". Everything else prefers the connector's manifest, which is
 *  what makes admin-added dimensions show up here at all. */
function dimLabelFor(connectorId: string, key: string): string {
  if (key === "campaign_name" || key === "campaign_selected")
    return getConnector(connectorId).primaryLabel;
  return getDimensionDef(connectorId, key)?.singular ?? DIM_LABELS[key] ?? humanizeDimKey(key);
}

// The status dot's colour: the campaign's real serving status when the source
// reports it (Windsor's campaign_status), a spend-based guess when it doesn't.
// A campaign paused today but with spend earlier in the range would otherwise
// read "active" green — the whole point of the client's report.
//   ENABLED → green · PAUSED → yellow · REMOVED → red · unknown → spend guess
export type StatusColor = "green" | "yellow" | "red" | "gray";
export function campaignStatusColor(status: unknown, spend: number): StatusColor {
  const s = String(status ?? "")
    .trim()
    .toUpperCase();
  if (s.includes("REMOV")) return "red";
  if (s.includes("PAUSE")) return "yellow";
  if (s.includes("ENABLE") || s.includes("ACTIV") || s === "SERVING") return "green";
  return spend > 0 ? "green" : "gray";
}

// Active Filters bar: once a single dimension has MORE than this many selected
// values, collapse them into ONE aggregated chip ("Search Terms (2000)") whose ×
// clears the whole dimension at once — instead of rendering thousands of tags
// (which overloads the UI and tanks performance). Selections at/below the limit
// keep showing individual, individually-removable tags. Tune here.
const FILTER_CHIP_AGG_THRESHOLD = 20;

// Pluralize a dimension label for the aggregated chip ("Search Term" → "Search
// Terms", "Country" → "Countries"). Already-plural labels are left alone.
function pluralizeDim(label: string): string {
  if (/s$/i.test(label)) return label;
  if (/[^aeiou]y$/i.test(label)) return label.replace(/y$/i, "ies");
  return `${label}s`;
}

// Tab icons (Trends / Performance / Profit & Loss / Distribution). Shared by the
// desktop tab buttons and the mobile dropdown. `currentColor` so the parent's text
// colour drives them; size is controlled by the parent via `[&>svg]:size-*`.
const TAB_ICONS = [
  <svg
    key="0"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>,
  <svg
    key="1"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="23 6 13.5 16.5 8.5 11.5 1 19" />
    <polyline points="17 6 23 6 23 12" />
  </svg>,
  <svg
    key="2"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>,
  <svg
    key="3"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
    <path d="M22 12A10 10 0 0 0 12 2v10z" />
  </svg>,
  // Sales (cost-free sources): a shopping bag.
  <svg
    key="4"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>,
];

// Extract an explicit time period named in free text (e.g. a preset/suggested
// question like "Q3 2022", "March 2023", "2021", "3 квартал 2022"). Returns UTC
// millisecond bounds so the dashboard can auto-switch to that period before the AI
// analyses it — otherwise the question runs against whatever the date picker shows.
function parsePeriodFromText(text: string): { start: number; end: number; label: string } | null {
  const t = (text || "").toLowerCase();
  const ym = /\b(20\d{2})\b/.exec(t);
  const year = ym ? parseInt(ym[1]) : null;
  if (!year) return null;

  // Quarter: "q3", "quarter 3", "3 quarter", "3 квартал", "квартал 3"
  const qm =
    /\bq\s*([1-4])\b/.exec(t) ||
    /\b([1-4])\s*(?:st|nd|rd|th)?\s*(?:quarter|квартал|кв)\b/.exec(t) ||
    /\b(?:quarter|квартал)\s*([1-4])\b/.exec(t);
  if (qm) {
    const q = parseInt(qm[1]);
    return {
      start: Date.UTC(year, (q - 1) * 3, 1),
      end: Date.UTC(year, q * 3, 0),
      label: `Q${q} ${year}`,
    };
  }

  // Month name (EN + UA), full or 3-letter.
  const MONTHS: [RegExp, number][] = [
    [/\b(jan|january|січень|січня)\b/, 0],
    [/\b(feb|february|лютий|лютого)\b/, 1],
    [/\b(mar|march|березень|березня)\b/, 2],
    [/\b(apr|april|квітень|квітня)\b/, 3],
    [/\b(may|травень|травня)\b/, 4],
    [/\b(jun|june|червень|червня)\b/, 5],
    [/\b(jul|july|липень|липня)\b/, 6],
    [/\b(aug|august|серпень|серпня)\b/, 7],
    [/\b(sep|sept|september|вересень|вересня)\b/, 8],
    [/\b(oct|october|жовтень|жовтня)\b/, 9],
    [/\b(nov|november|листопад|листопада)\b/, 10],
    [/\b(dec|december|грудень|грудня)\b/, 11],
  ];
  for (const [re, mi] of MONTHS) {
    if (re.test(t)) {
      return {
        start: Date.UTC(year, mi, 1),
        end: Date.UTC(year, mi + 1, 0),
        label:
          ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mi] +
          ` ${year}`,
      };
    }
  }

  // Half-year
  if (/\bh1\b|first half|перш(?:а|е) пів/.test(t))
    return { start: Date.UTC(year, 0, 1), end: Date.UTC(year, 6, 0), label: `H1 ${year}` };
  if (/\bh2\b|second half|друг(?:а|е) пів/.test(t))
    return { start: Date.UTC(year, 6, 1), end: Date.UTC(year, 12, 0), label: `H2 ${year}` };

  // Bare year — only treat as a period when the text clearly refers to it as one
  // (avoid hijacking questions that merely mention a year in passing).
  if (
    /\b(for|in|за|у|в)\s+20\d{2}\b/.test(t) ||
    /\b20\d{2}\s*(year|рік|року|год)\b/.test(t) ||
    /^20\d{2}$/.test(t.trim())
  ) {
    return { start: Date.UTC(year, 0, 1), end: Date.UTC(year, 12, 0), label: `${year}` };
  }
  return null;
}

// Group daily rows into real calendar weeks (Sun–Sat) by their ISO date, instead
// of slicing every 7 array elements. Index-slicing produced buckets that spanned
// more than 7 days when the data had gaps (and arbitrary partial buckets). With
// calendar alignment, full weeks are exactly 7 days and only the first/last week
// of the range is partial (which is correct). Rows are assumed chronological.
function chunkByWeek<T>(rows: T[], getIso: (r: T) => string | undefined): T[][] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const r of rows) {
    const iso = getIso(r);
    let key: string;
    if (iso) {
      const d = new Date(iso + "T00:00:00Z");
      // Group by ISO calendar week (Monday start). This keeps a trailing day like a
      // Sunday inside its own week (e.g. Feb 20 belongs to the Feb 14–20 week) instead
      // of starting a new one-day "week" bucket. getUTCDay: Sun=0…Sat=6 → Monday offset.
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to the week's Monday
      key = d.toISOString().slice(0, 10);
    } else {
      key = `__${order.length}`; // no date → its own bucket
    }
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(r);
  }
  return order.map((k) => groups.get(k)!);
}

/** The dashboard itself. Rendered by every source's route (see
 *  [source]/page.tsx) — which source it shows comes from the store, kept in
 *  step with the URL by those routes. */
export default function DashboardView() {
  const [activeTab, setActiveTab] = useState(0);
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState<SortKey | null>("clicks");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [typeFilter, setTypeFilter] = useState("All");
  const [campaignDropdownOpen, setCampaignDropdownOpen] = useState(false);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Status");
  // Universal numeric metric filter for the Campaign table (replaces Good/OK/Poor).
  const [metricFilter, setMetricFilter] = useState<MetricFilterState>(METRIC_FILTER_NONE);
  const [debouncedMetricFilter, setDebouncedMetricFilter] =
    useState<MetricFilterState>(METRIC_FILTER_NONE);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [expandedNameIdx, setExpandedNameIdx] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isPortrait, setIsPortrait] = useState(true);
  const [rangeStart, setRangeStart] = useState(() => {
    if (typeof window !== "undefined") {
      const s = sessionStorage.getItem("dr_range_start");
      if (s) return Number(s);
    }
    return END_MS - 13 * DAY_MS;
  });
  const [rangeEnd, setRangeEnd] = useState(() => {
    if (typeof window !== "undefined") {
      const s = sessionStorage.getItem("dr_range_end");
      if (s) return Number(s);
    }
    return END_MS;
  });
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const openDatePicker = () => {
    setPickerTempStart(rangeStart);
    setPickerTempEnd(rangeEnd);
    setPickerStep(0);
    setPickerHover(null);
    const d = new Date(rangeStart);
    setPickerViewYear(d.getFullYear());
    setPickerViewMonth(d.getMonth());
    setDatePickerOpen(true);
  };
  const openDatePickerRef = useRef(openDatePicker);
  useEffect(() => {
    openDatePickerRef.current = openDatePicker;
  });
  useEffect(() => {
    sessionStorage.setItem("dr_range_start", String(rangeStart));
    sessionStorage.setItem("dr_range_end", String(rangeEnd));
  }, [rangeStart, rangeEnd]);
  const [pickerTempStart, setPickerTempStart] = useState<number | null>(null);
  const [pickerTempEnd, setPickerTempEnd] = useState<number | null>(null);
  const [pickerHover, setPickerHover] = useState<number | null>(null);
  const [pickerStep, setPickerStep] = useState<0 | 1>(0);
  const [pickerViewYear, setPickerViewYear] = useState(() => new Date().getFullYear());
  const [pickerViewMonth, setPickerViewMonth] = useState(() => new Date().getMonth());
  const [namesCollapsed, setNamesCollapsed] = useState(false);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [granularity, setGranularity] = useState<"days" | "weeks" | "months">("days");
  const [granularityOpen, setGranularityOpen] = useState(false);
  // Arriving from the AI Optimizer's "Explore in Dashboard": open the view best
  // suited to the recommendation — Profit & Loss, weekly, over the optimizer's
  // own ~90-day window — so the loss is visible without switching tabs by hand.
  // One-shot flags set by the optimizer, consumed once here. If the source lacks
  // the requested tab, the guard effect below falls back to its first tab.
  useEffect(() => {
    try {
      const tab = sessionStorage.getItem("dr_open_tab");
      if (tab && TAB_INDEX[tab] !== undefined) setActiveTab(TAB_INDEX[tab]);
      sessionStorage.removeItem("dr_open_tab");
      const g = sessionStorage.getItem("dr_granularity");
      if (g === "days" || g === "weeks" || g === "months") setGranularity(g);
      sessionStorage.removeItem("dr_granularity");
    } catch {
      /* storage unavailable — the dashboard just opens on its defaults */
    }
  }, []);
  const [hiddenAdPerf, setHiddenAdPerf] = useState<Set<string>>(new Set());
  const [hiddenPL, setHiddenPL] = useState<Set<string>>(new Set());
  // The metric KEY plotted in the Trends / Distribution chart (see
  // chartMetricList): one of the source's own metric columns, not a fixed
  // Google-Ads name. Empty until the user picks one, so the default falls
  // through to the FIRST chart-enabled metric in the admin's column order
  // (chartMetricDef → chartMetricOptions[0]) rather than a hardcoded Revenue.
  const [chartMetric, setChartMetric] = useState<string>("");
  const [chartGroupBy, setChartGroupBy] = useState<ChartGroupBy>("Campaign");
  // The inline "AI Analytics" button (desktop/tablet). A floating AI button shows
  // when this scrolls out of view; on mobile the inline button is gone so the
  // floating one is always shown.
  const aiBtnRef = useRef<HTMLButtonElement | null>(null);
  const [aiBtnVisible, setAiBtnVisible] = useState(true);
  // Sticky Active Filters bar expand/collapse. `null` = follow the per-mode
  // default (inline mode that fits one row starts expanded; the compact mode used
  // on mobile or when chips overflow starts collapsed). A boolean = explicit user
  // override of the toggle within the current mode.
  const [filtersExpandedOverride, setFiltersExpandedOverride] = useState<boolean | null>(null);
  // Whether ALL active-filter chips fit on a single row alongside the header /
  // toggle / Clear All. Measured below; drives inline vs compact layout on
  // desktop/laptop/tablet (mobile is always compact).
  const [filtersFitOneRow, setFiltersFitOneRow] = useState(false);
  const filtersBarRef = useRef<HTMLDivElement | null>(null);
  const filtersMeasureRef = useRef<HTMLDivElement | null>(null);
  const [chartMetricOpen, setChartMetricOpen] = useState(false);
  const [chartGroupByOpen, setChartGroupByOpen] = useState(false);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiMsgs, setAiMsgs] = useState<AiMessage[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInsights, setAiInsights] = useState<AiInsight[]>([]);
  const [aiInsightsLoading, setAiInsightsLoading] = useState(false);
  const [aiSuggestedQuestions, setAiSuggestedQuestions] = useState<string[]>([]);
  // The preset question that triggered the current insight analysis — kept so it
  // stays shown above the AI response (like a chat turn), not lost after the run.
  const [aiFocusQuestion, setAiFocusQuestion] = useState<string | null>(null);
  const aiScrollRef = useRef<HTMLDivElement>(null);
  // Chat session persistence
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const isLoadingSessionRef = useRef(false);
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isWindsorLoadingRef = useRef(false);
  const windsorConnectedRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realKpisRef = useRef<any>(null);
  // Filtered (cross-filter-driven) KPIs, so the AI cites the selected numbers
  // not the whole-account numbers when a filter is active.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynKpisRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realCampaignRowsRef = useRef<any[] | null>(null);
  const dataSourceRef = useRef<string | null>(null);
  const aiSelectionChipsRef = useRef<AiSelectionChip[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const crossFilterRowsByDimRef = useRef<Record<string, any[] | null>>({});
  // Top rows per dimension fetched on demand for the AI (so it can analyze
  // search terms / ad groups / devices etc. even with nothing selected).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aiDimsRef = useRef<Record<string, any[]>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectedRowsRef = useRef<any[]>([]);
  const [addEventOpen, setAddEventOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [evtType, setEvtType] = useState<EventType>("promotions");
  const [currentUserName, setCurrentUserName] = useState<string>("");
  const [evtStartDate, setEvtStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [evtEndDate, setEvtEndDate] = useState("");
  const [evtTitle, setEvtTitle] = useState("");
  const [evtDesc, setEvtDesc] = useState("");
  const [isWindsorLoading, setIsWindsorLoading] = useState(false);
  // Which source the currently loaded rows came from — see the `stale` guard
  // where realCampaignRows/realBarData are derived.
  const [dataConnector, setDataConnector] = useState<string | null>(null);
  const [, setWindsorError] = useState<string | null>(null);
  const [windsorConnected, setWindsorConnected] = useState(false);
  const [dataSource, setDataSource] = useState<string | null>(null);
  const [, setTeamMembers] = useState<
    { id: string; name: string; email: string; avatarColor: string; isPending: boolean }[]
  >([]);
  // "View as Client": an admin opened this dashboard from a user's detail page.
  // The id is passed to every data fetch as view_as, and the API re-scopes to
  // that user's connected account (server validates the admin may see them). Read
  // from sessionStorage so it survives the navigation here and a refresh; the
  // app-wide banner (dashboard layout) shows it and clears it. null = own data.
  const [viewAsUserId] = useState<string | null>(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("dr_view_as");
    return null;
  });
  const [customEvents, setCustomEvents] = useState<CustomEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/custom-events")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setCustomEvents(data);
        }
        setEventsLoading(false);
      })
      .catch(() => setEventsLoading(false));
  }, []);

  // Current user's display name — stored as "Created By" on manual events.
  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        const m = data.user?.user_metadata ?? {};
        const name =
          (m.full_name as string) || (m.name as string) || data.user?.email?.split("@")[0] || "You";
        setCurrentUserName(name);
      })
      .catch(() => {});
  }, []);

  // Open the modal pre-filled to edit an existing event.
  const openEditEvent = (ev: CustomEvent) => {
    setEditingEventId(ev.id);
    setEvtType(
      (["promotions", "website", "products", "custom"] as EventType[]).includes(
        ev.category as EventType,
      )
        ? (ev.category as EventType)
        : "custom",
    );
    setEvtStartDate(ev.startDate);
    setEvtEndDate(ev.endDate || "");
    setEvtTitle(ev.title);
    setEvtDesc(ev.desc || "");
    setAddEventOpen(true);
  };

  const handleAddEvent = async () => {
    // ── Edit existing ──
    if (editingEventId) {
      const id = editingEventId;
      const patch = {
        category: evtType,
        startDate: evtStartDate,
        endDate: evtEndDate,
        title: evtTitle,
        desc: evtDesc,
      };
      setCustomEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e))); // optimistic
      setAddEventOpen(false);
      setEditingEventId(null);
      try {
        const res = await fetch(`/api/custom-events/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (res.ok) {
          const data = await res.json();
          setCustomEvents((prev) => prev.map((e) => (e.id === id ? data : e)));
        }
      } catch {
        /* keep optimistic */
      }
      return;
    }

    // ── Create new ──
    const newEvent = {
      category: evtType,
      type: currentUserName || "You", // stored as "Created By"
      startDate: evtStartDate,
      endDate: evtEndDate,
      title: evtTitle,
      desc: evtDesc,
    };

    // Optimistic update
    const tempId = Date.now().toString();
    setCustomEvents((prev) => [...prev, { ...newEvent, id: tempId } as CustomEvent]);
    setAddEventOpen(false);

    try {
      const res = await fetch("/api/custom-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newEvent),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        setCustomEvents((prev) => prev.map((e) => (e.id === tempId ? data : e)));
      } else {
        // Revert on error
        setCustomEvents((prev) => prev.filter((e) => e.id !== tempId));
      }
    } catch {
      setCustomEvents((prev) => prev.filter((e) => e.id !== tempId));
    }
  };

  const handleDeleteEvent = async (id: string) => {
    // Auto events (holidays/ads) aren't stored — nothing to delete server-side.
    if (id.startsWith("holiday-") || id.startsWith("ads-")) return;
    const prev = customEvents;
    setCustomEvents((p) => p.filter((e) => e.id !== id)); // optimistic
    try {
      const res = await fetch(`/api/custom-events/${id}`, { method: "DELETE" });
      if (!res.ok) setCustomEvents(prev); // revert
    } catch {
      setCustomEvents(prev);
    }
  };

  // Helpers to parse selected time dimension values into contiguous date ranges
  const parsePeriodToRange = (dim: string, val: string): { start: string; end: string } | null => {
    const MONTHS = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    if (dim === "date") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return { start: val, end: val };
    }
    if (dim === "week") {
      const match = /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/.exec(val);
      if (match) {
        const [, mStr, dStr, yStr] = match;
        const mIdx = MONTHS.indexOf(mStr);
        if (mIdx !== -1) {
          const start = new Date(Date.UTC(parseInt(yStr), mIdx, parseInt(dStr)));
          const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
          return {
            start: start.toISOString().split("T")[0],
            end: end.toISOString().split("T")[0],
          };
        }
      }
    }
    if (dim === "month") {
      const match = /^([A-Za-z]{3})\s+(\d{4})$/.exec(val);
      if (match) {
        const [, mStr, yStr] = match;
        const mIdx = MONTHS.indexOf(mStr);
        if (mIdx !== -1) {
          const start = new Date(Date.UTC(parseInt(yStr), mIdx, 1));
          const end = new Date(Date.UTC(parseInt(yStr), mIdx + 1, 0));
          return {
            start: start.toISOString().split("T")[0],
            end: end.toISOString().split("T")[0],
          };
        }
      }
    }
    if (dim === "quarter") {
      let q = 0,
        y = 0;
      const match = /^Q([1-4])\s+(\d{4})$/.exec(val); // "Q2 2022"
      if (match) {
        q = parseInt(match[1]);
        y = parseInt(match[2]);
      } else {
        // Tolerate a malformed label like "Q2022-04-01 2022" (embedded start date).
        const d = /(\d{4})-(\d{2})-\d{2}/.exec(val);
        if (d) {
          y = parseInt(d[1]);
          q = Math.floor((parseInt(d[2]) - 1) / 3) + 1;
        }
      }
      if (q >= 1 && q <= 4 && y > 0) {
        const start = new Date(Date.UTC(y, (q - 1) * 3, 1));
        const end = new Date(Date.UTC(y, q * 3, 0));
        return {
          start: start.toISOString().split("T")[0],
          end: end.toISOString().split("T")[0],
        };
      }
    }
    if (dim === "year") {
      const match = /^(\d{4})$/.exec(val);
      if (match) {
        const y = parseInt(val);
        const start = new Date(Date.UTC(y, 0, 1));
        const end = new Date(Date.UTC(y, 12, 0));
        return {
          start: start.toISOString().split("T")[0],
          end: end.toISOString().split("T")[0],
        };
      }
    }
    return null;
  };

  const getTimeFilterRange = (
    flts: Record<string, string[]>,
    dateFromDefault: string,
    dateToDefault: string,
  ) => {
    let minStart = "";
    let maxEnd = "";
    const timeDims = ["date", "week", "month", "quarter", "year"];
    for (const dim of timeDims) {
      const vals = flts[dim] ?? [];
      for (const val of vals) {
        const range = parsePeriodToRange(dim, val);
        if (range) {
          if (!minStart || range.start < minStart) minStart = range.start;
          if (!maxEnd || range.end > maxEnd) maxEnd = range.end;
        }
      }
    }
    // Clamp the bucket range to the dashboard's current period. A year/quarter
    // bucket spans more than the selected period (e.g. picking "Year 2022" while
    // the period is Apr–Jun 2022 would otherwise pull the WHOLE year into the
    // tables, while the KPIs only have the period's data → mismatch). Clamping
    // keeps every component on the same period. Day/week/month buckets already
    // fit inside the period, so this is a no-op for them.
    if (minStart && minStart < dateFromDefault) minStart = dateFromDefault;
    if (maxEnd && maxEnd > dateToDefault) maxEnd = dateToDefault;
    return {
      dateFrom: minStart || dateFromDefault,
      dateTo: maxEnd || dateToDefault,
      hasTimeFilter: !!minStart,
    };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [realCampaignRowsRaw, setRealCampaignRows] = useState<any[] | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [timeFilteredCampaignRowsRaw, setTimeFilteredCampaignRows] = useState<any[] | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [realBarDataRaw, setRealBarData] = useState<any[] | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [crossFilterData, setCrossFilterData] = useState<any[] | null>(null);
  // True while the cross-filter Windsor fetch (+ side fetches) is in flight —
  // drives the top progress bar so applying a filter shows activity (~20s).
  const [crossFilterLoading, setCrossFilterLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [crossFilterCampaignRows, setCrossFilterCampaignRows] = useState<any[] | null>(null);
  // Raw `date,<dimension>` rows for the chart's current group-by. Kept raw
  // (rather than pre-aggregated) because each row carries the primary-entity
  // value the table selection is expressed in — aggregating first would throw
  // that away, and the chart could then never follow a selection.
  const [dimensionBarRows, setDimensionBarRows] = useState<Record<string, unknown>[] | null>(null);
  const [dimensionBarLoading, setDimensionBarLoading] = useState(false);
  const {
    filters,
    dimSearch,
    dimExclude,
    activeConnector,
    connectorConfigs,
    clearFilter,
    clearAll,
    setFilter,
    toggleValue,
    setDimSearch,
    setDimInclude,
    setDimExclude,
    setConnectorConfigs,
    clearSignal,
    tableLoadingCount,
    crossFilterCampaigns,
    crossFilterRowsByDim,
    setCrossFilterCampaigns,
    setCrossFilterAdGroups,
    setCrossFilterKeywords,
    setCrossFilterMatchTypes,
    setCrossFilterRowsByDim,
    setCrossFilterBusy,
  } = useCrossFilter();
  // The active connector's primary entity (campaign / product / channel) drives
  // the top block's fetches so switching source rebuilds the whole dashboard.
  // Rows still belonging to the source we just switched away from must not
  // render: the fetch for the new one takes a moment, and until then the
  // dashboard would keep showing the previous platform's numbers under the new
  // platform's name. Treating them as absent shows the loading state instead.
  const stale = dataConnector !== activeConnector;
  const realCampaignRows = stale ? null : realCampaignRowsRaw;
  const realBarData = stale ? null : realBarDataRaw;

  // User events, the auto US holiday calendar, and this source's own detected
  // anomalies for the visible range.
  //
  // The detector already ran on Smart Goals; it belongs here too, per source —
  // a Google Ads spend drop on the Google Ads timeline, a GA4 one on GA4's.
  // It reads the same daily series the charts draw, so it costs no extra
  // request.
  const timelineEvents = useMemo(() => {
    // Analyse the KPI-card metrics this source ships, so the anomalies follow
    // its KPI set. Read from the connector directly — visibleKpis is defined
    // further down, and reaching it here would be a use-before-init.
    const kpiSlots = getConnector(activeConnector).kpiCards.map((c) => c.slot);
    const anomalies: CustomEvent[] = anomaliesFromDailyRows(realBarData ?? [], kpiSlots).map(
      (a) => ({
        id: a.id,
        category: a.category,
        type: null,
        startDate: a.startDate,
        endDate: a.endDate ?? "",
        title: a.title,
        desc: a.description ?? "",
      }),
    );
    return [...customEvents, ...generateHolidays(rangeStart, rangeEnd), ...anomalies];
  }, [customEvents, rangeStart, rangeEnd, realBarData, activeConnector]);
  const timeFilteredCampaignRows = stale ? null : timeFilteredCampaignRowsRaw;

  const primaryDim = getConnector(activeConnector).primaryDimension;

  // Admin-registered custom metrics (raw Windsor fields, no canonical formula)
  // for the active connector, turned into synthetic KPI-card "bases" — the
  // same shape the static `kpis` catalog uses (icon/label/hoverFmt/desc) — so
  // they can slot into the exact same rendering path as the canonical 9.
  // Opt-in only (connectorKpiOptions defaults them to hidden).
  const customKpiBases = useMemo(() => {
    const c = getConnector(activeConnector);
    const keys = Object.keys(c.customMetricFields ?? {});
    return keys.map((key) => {
      const def = c.metrics.find((m) => m.key === key);
      return {
        slot: key,
        label: def?.label ?? key,
        shortLabel: def?.label ?? key,
        icon: I.bar,
        iconColor: "#6b7280",
        desc: `${def?.label ?? key} in the selected period`,
        hoverFmt: (v: number) => formatCustomMetricValue(v, def?.format),
        format: def?.format,
        // percent/ratio values are averaged across rows rather than summed —
        // summing e.g. a bounce rate across campaigns would be meaningless.
        isAverage: isAveragedMetric(activeConnector, key),
      };
    });
    // connectorConfigs is a real dependency even though it isn't referenced
    // directly: getConnector() reads the live registry, and that registry only
    // gains a connector's custom metrics once connectorConfigs has been loaded
    // and folded in (applyAdminCustomFields). Without it this memo kept the
    // pre-load result — an empty list — while applyKpiConfig below re-read the
    // populated registry, so the custom KPI cards were computed by one and
    // then dropped by the other, and the card count flipped between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnector, connectorConfigs]);

  // Metric columns for the primary table (Campaign/Channel/Product
  // Performance) — the admin's "Metric Columns" config, which is the exact
  // same list every other table on the dashboard renders from. This table
  // used to hardcode its own fixed column set, so hiding or reordering a
  // column in the admin panel changed every table EXCEPT this one.
  const primaryTableMetricCols = useMemo(
    () =>
      applyMetricColConfig(connectorConfigs[activeConnector]?.metrics, activeConnector).map(
        (c) => ({
          key: c.key,
          label: c.label,
          format: c.format,
        }),
      ),
    [activeConnector, connectorConfigs],
  );

  // Which table renders in the "hero" position above Extended Analytics —
  // built-in CampaignTable by default, or an admin-promoted dimension/Table
  // Widget (see ConnectorConfig.primaryTableSource). Purely a display choice:
  // cross-filtering/KPI computation below stay pivoted on this connector's
  // real primaryDimension regardless of what's shown here.
  const primaryTableSource = connectorConfigs[activeConnector]?.primaryTableSource;
  const primaryTableSourceDimensionDef =
    primaryTableSource?.type === "dimension"
      ? getDimensionDef(activeConnector, primaryTableSource.key)
      : null;
  const primaryTableWidgetConfig =
    primaryTableSource?.type === "widget"
      ? (connectorConfigs[activeConnector]?.tables ?? []).find(
          (t) => t.id === primaryTableSource.widgetId,
        )
      : undefined;
  // An admin can rename the primary (hero) table in Data Sources — its label
  // lives in the dimensions config under the effective primary key. Applied to
  // the hero's title so the rename shows here too, not only in the optimizer.
  const heroPrimaryKey =
    primaryTableSource?.type === "dimension" ? primaryTableSource.key : primaryDim;
  const primaryCustomLabel = (connectorConfigs[activeConnector]?.dimensions ?? []).find(
    (d) => d.key === heroPrimaryKey,
  )?.label;

  // KPI cards the active source actually has: the manifest picks which canonical
  // slots to show and renames them, so Shopify gets Orders / Total Sales / AOV
  // instead of ad-spend cards that would all read zero. `idx` keeps each card
  // pointing at its value in the shared KPI computations below.
  const visibleKpis = useMemo(() => {
    const combinedBase = [...kpis, ...customKpiBases];
    const bySlot = new Map(combinedBase.map((k, i) => [k.slot, i]));
    const shipped = new Map(getConnector(activeConnector).kpiCards.map((c) => [c.slot, c]));
    // Admin config (which cards, order, labels) wins over the manifest defaults.
    return applyKpiConfig(activeConnector, connectorConfigs[activeConnector]?.kpis).flatMap(
      (card) => {
        const idx = bySlot.get(card.slot);
        if (idx === undefined) return [];
        const base = combinedBase[idx];
        const ship = shipped.get(card.slot);
        return [
          {
            ...base,
            idx,
            label: card.label,
            shortLabel: ship?.shortLabel ?? card.label,
            desc: ship?.desc ?? base.desc,
            format: card.format,
          },
        ];
      },
    );
  }, [activeConnector, connectorConfigs, customKpiBases]);
  // The AI callbacks read the cards through a ref so they don't need to re-create
  // themselves every time the connector changes.
  const visibleKpisRef = useRef(visibleKpis);
  visibleKpisRef.current = visibleKpis;
  const activeConnectorRef = useRef(activeConnector);
  activeConnectorRef.current = activeConnector;

  // Tabs the active source supports. Cost-free sources have no Performance / P&L
  // (there is no ad spend to analyse); Shopify swaps them for Sales. `idx` is the
  // canonical tab index TabContent switches on.
  const visibleTabs = useMemo(
    () =>
      getConnector(activeConnector).tabs.map((key) => ({
        key,
        idx: TAB_INDEX[key],
        label: tabs[TAB_INDEX[key]],
      })),
    [activeConnector],
  );
  // Switching to a source that lacks the open tab (e.g. P&L → Shopify) would leave
  // the bar with nothing highlighted, so fall back to its first tab.
  useEffect(() => {
    if (!visibleTabs.some((t) => t.idx === activeTab)) setActiveTab(visibleTabs[0]?.idx ?? 0);
  }, [visibleTabs, activeTab]);

  // Trends "by <X>" options + metrics per source. The secondary group-bys
  // (Campaign Type / Device / Network) are Google-Ads concepts, so other sources
  // offer only their primary breakdown, and cost-free sources drop the Cost metric.
  // Every source, Google Ads included, offers its primary entity plus whichever
  // breakdowns the admin left ticked for charts — the same list its tables
  // render from. Google Ads used to keep a hand-picked four here, so its
  // Charts checkboxes in the admin panel changed nothing.
  const chartGroupByTables = useMemo(
    () => chartDimensionList(activeConnector, connectorConfigs[activeConnector]?.dimensions),
    [activeConnector, connectorConfigs],
  );
  const chartGroupByOptions = useMemo<ChartGroupBy[]>(
    () => [
      getConnector(activeConnector).primaryLabel,
      ...chartGroupByTables.map((t) => t.dimensionLabel),
    ],
    [activeConnector, chartGroupByTables],
  );
  // Chart "by" label -> the dimension key its data is fetched under. Built from
  // the SAME list as the options above, so the two can't disagree: when they
  // did, the dropdown offered a breakdown that resolved to no dimension, no
  // fetch ran, and the chart quietly kept the primary-entity series under that
  // breakdown's name. Two labels have no key on purpose — the primary entity
  // and Google Ads' campaign type both come from the already-loaded rows.
  const chartGroupByDim = useMemo<Record<string, string>>(
    () =>
      Object.fromEntries(
        chartGroupByTables
          .filter((t) => t.key !== "campaign_type")
          .map((t) => [t.dimensionLabel, t.key]),
      ),
    [chartGroupByTables],
  );
  // The chart's metric dropdown, driven by the source's own metric columns and
  // the admin's config (hidden columns and ones unticked for charts drop out).
  // connectorConfigs is a real dependency: getConnector reads the live registry,
  // which only carries the admin-registered metrics once that config has loaded.
  const chartMetricOptions = useMemo(
    () => chartMetricList(activeConnector, connectorConfigs[activeConnector]?.metrics),
    [activeConnector, connectorConfigs],
  );
  const chartMetricDef = useMemo(
    () => chartMetricOptions.find((m) => m.key === chartMetric) ?? chartMetricOptions[0],
    [chartMetricOptions, chartMetric],
  );
  // The metric actually plotted. `chartMetric` is only the user's last pick; a
  // source that doesn't offer it (Search Console has no revenue) falls back to
  // its first metric, and everything downstream — series, totals, axis, label —
  // must read THIS, or the chart would draw one metric under another's name.
  const chartMetricKey = chartMetricDef?.key ?? chartMetric;
  // The admin-registered metric keys for this source. The connector config
  // loads asynchronously, so a fetch that ran before it arrived produced rows
  // with no custom-metric series at all — the chart and KPI cards for those
  // metrics then stayed empty for the rest of the session. The fetches below
  // depend on this, and re-run once the keys appear.
  // Which primary entities (campaign / channel / search query …) the chart is
  // scoped to: an attributed cross-filter first, otherwise a direct row
  // selection in the primary table. null = the whole account. Hoisted out of
  // the chart memo because the dimension-grouped series has to honour the same
  // scope — without it, picking rows in a table left a chart grouped by another
  // dimension showing the unfiltered account.
  const chartEntityScope = useMemo<string[] | null>(() => {
    if (crossFilterCampaigns && crossFilterCampaigns.length > 0) return crossFilterCampaigns;
    const selected = [...(filters["campaign_selected"] ?? []), ...(filters["campaign_name"] ?? [])];
    return selected.length > 0 ? [...new Set(selected)] : null;
  }, [crossFilterCampaigns, filters]);

  const customMetricSig = useMemo(
    () => Object.keys(getConnector(activeConnector).customMetricFields ?? {}).join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeConnector, connectorConfigs],
  );
  const chartMetricLabel = chartMetricDef?.label ?? "Revenue";
  // Money-formatted unless the metric says otherwise. Custom metrics carry their
  // own format; of the canonical ones only revenue/cost/profit are money.
  const chartMetricIsMoney = chartMetricDef ? chartMetricDef.format === "money" : true;
  // Non-Google options already carry their real labels.
  const groupByLabel = (g: ChartGroupBy) => g;
  // Reset the chart group-by when the source changes (a Google-only group-by
  // can otherwise stay stuck). The metric needs no reset — it's derived above.
  useEffect(() => {
    if (!chartGroupByOptions.includes(chartGroupBy))
      setChartGroupBy(chartGroupByOptions[0] ?? "Campaign");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnector]);
  // Query-string suffix for the raw dimension / cross-filter fetches below.
  const connectorQS = activeConnector !== "google_ads" ? `&connector=${activeConnector}` : "";
  // When an admin is viewing as a client, every /api/data fetch must carry the
  // same view_as the primary chart sends (fetchWindsorData), or the secondary
  // tables and cross-filter would show the admin's own account instead.
  const viewAsQS = viewAsUserId ? `&view_as=${encodeURIComponent(viewAsUserId)}` : "";

  // Load the admin-defined global connector display config once, so the dashboard
  // renders the tables/metrics/order the admin configured (defaults until then).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/connector-config")
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && j?.configs) setConnectorConfigs(j.configs);
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, [setConnectorConfigs]);

  const originalDateFrom = useMemo(
    () => new Date(rangeStart).toISOString().slice(0, 10),
    [rangeStart],
  );
  const originalDateTo = useMemo(() => new Date(rangeEnd).toISOString().slice(0, 10), [rangeEnd]);

  const {
    dateFrom: effectiveDateFrom,
    dateTo: effectiveDateTo,
    hasTimeFilter,
  } = useMemo(() => {
    return getTimeFilterRange(filters, originalDateFrom, originalDateTo);
  }, [filters, originalDateFrom, originalDateTo]);

  // Load time-filtered campaign table rows if a time-dimension filter is active
  useEffect(() => {
    if (!windsorConnected) {
      setTimeFilteredCampaignRows(null);
      return;
    }
    if (!hasTimeFilter) {
      setTimeFilteredCampaignRows(null);
      return;
    }
    let cancelled = false;
    fetchWindsorData(effectiveDateFrom, effectiveDateTo, primaryDim, viewAsUserId, activeConnector)
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mappedRows = data.map((d: any) => {
            const spend = Number(d.spend) || 0;
            const convVal = Number(d.conversion_value) || 0;
            const clicks = Number(d.clicks) || 0;
            const convs = Number(d.conversions) || 0;
            const impr = Number(d.impressions) || 0;
            const roasNum = spend > 0 ? convVal / spend : 0;
            const name = d.dimension || d.campaign || "Unknown";
            const nl = String(name).toLowerCase();
            const type =
              nl.includes("pmax") || nl.includes("performance max")
                ? "PMax"
                : nl.includes("shopping")
                  ? "Shopping"
                  : nl.includes("display") || nl.includes("retarget")
                    ? "Display"
                    : "Search";
            return {
              status: campaignStatusColor(d.campaign_status, spend),
              name,
              type,
              roas: spend > 0 ? `${roasNum.toFixed(2)}x` : "null",
              roasColor:
                spend === 0 ? "gray" : roasNum >= 1.5 ? "green" : roasNum >= 1.0 ? "orange" : "red",
              impr,
              clicks,
              cpc: clicks > 0 ? spend / clicks : 0,
              ctr: impr > 0 ? (clicks / impr) * 100 : 0,
              convRate: clicks > 0 ? (convs / clicks) * 100 : 0,
              conv: convs,
              cpa: convs > 0 ? spend / convs : 0,
              revenue: convVal / 1000,
              cost: spend / 1000,
              profit: (convVal - spend) / 1000,
              roasVal: roasNum,
              extra: d.extra,
            };
          });
          setTimeFilteredCampaignRows(mappedRows);
        } else {
          setTimeFilteredCampaignRows([]);
        }
      })
      .catch(() => {
        if (!cancelled) setTimeFilteredCampaignRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [
    effectiveDateFrom,
    effectiveDateTo,
    windsorConnected,
    viewAsUserId,
    hasTimeFilter,
    primaryDim,
    activeConnector,
  ]);

  useEffect(() => {
    // Switching source starts a new fetch while the previous one may still be
    // in flight. Without this guard a slow reply for the source you just left
    // still wrote itself into state — which is how Google Ads numbers ended up
    // under Google Analytics and vice versa when switching quickly.
    let cancelled = false;
    const loadData = async () => {
      setIsWindsorLoading(true);
      setWindsorError(null);
      const start = new Date(rangeStart).toISOString().split("T")[0];
      const end = new Date(rangeEnd).toISOString().split("T")[0];

      const [campResult, dailyResult] = await Promise.all([
        fetchWindsorData(start, end, primaryDim, viewAsUserId, activeConnector),
        fetchWindsorData(start, end, `date,${primaryDim}`, viewAsUserId, activeConnector),
      ]);

      if (cancelled) return;
      const { data: campData, error: campErr, source: src } = campResult;
      if (campErr) {
        setWindsorConnected(false);
        setDataSource(null);
        setWindsorError(campErr.includes("not configured") ? null : campErr);
        setRealCampaignRows(null);
        setRealBarData(null);
        setDataConnector(activeConnector);
        setIsWindsorLoading(false);
        return;
      }
      setWindsorConnected(true);
      setDataSource(src ?? null);

      // Merge rows that share a campaign name into one. Windsor requests
      // campaign_status alongside the campaign, and it groups by (campaign,
      // campaign_status) — so a campaign whose serving status changed in the
      // period comes back as TWO rows (e.g. ENABLED + PAUSED), each with part of
      // the numbers, and the table showed the same campaign twice with different
      // data. Two genuinely different campaigns that share a name collapse here
      // too, which matches how the rest of the app keys campaigns (by name).

      const mergedCamp = (() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const byName = new Map<string, any>();
        const num = (v: unknown) => Number(v) || 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const d of (campData as any[]) ?? []) {
          const name = String(d?.dimension ?? d?.campaign ?? "Unknown");
          const prev = byName.get(name);
          if (!prev) {
            byName.set(name, { ...d });
            continue;
          }
          prev.spend = num(prev.spend) + num(d.spend);
          prev.clicks = num(prev.clicks) + num(d.clicks);
          prev.conversions = num(prev.conversions) + num(d.conversions);
          prev.impressions = num(prev.impressions) + num(d.impressions);
          prev.conversion_value = num(prev.conversion_value) + num(d.conversion_value);
          // Keep the "most active" status: ENABLED/ACTIVE wins over paused/removed.
          const s = String(d.campaign_status ?? "").toUpperCase();
          const ps = String(prev.campaign_status ?? "").toUpperCase();
          if (
            !(ps.includes("ENABLE") || ps.includes("ACTIV")) &&
            (s.includes("ENABLE") || s.includes("ACTIV"))
          )
            prev.campaign_status = d.campaign_status;
          if (d.extra) {
            prev.extra = { ...(prev.extra ?? {}) };
            for (const k of Object.keys(d.extra))
              prev.extra[k] = num(prev.extra[k]) + num(d.extra[k]);
          }
        }
        return [...byName.values()];
      })();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedRows = mergedCamp.map((d: any) => {
        const spend = Number(d.spend) || 0;
        const convVal = Number(d.conversion_value) || 0;
        const clicks = Number(d.clicks) || 0;
        const convs = Number(d.conversions) || 0;
        const impr = Number(d.impressions) || 0;
        const roasNum = spend > 0 ? convVal / spend : 0;
        const name = d.dimension || d.campaign || "Unknown";
        const nl = String(name).toLowerCase();
        // Prefer the REAL Google Ads channel type from the data source; fall back
        // to a name heuristic only when it isn't provided (e.g. Windsor test data).
        const type =
          normalizeChannelType(d.campaign_type) ??
          (nl.includes("pmax") || nl.includes("performance max")
            ? "PMax"
            : nl.includes("shopping")
              ? "Shopping"
              : nl.includes("display") || nl.includes("retarget")
                ? "Display"
                : nl.includes("video") || nl.includes("youtube")
                  ? "Video"
                  : nl.includes("demand") || nl.includes("discovery")
                    ? "Demand Gen"
                    : nl.includes("app")
                      ? "App"
                      : "Search");
        return {
          status: campaignStatusColor(d.campaign_status, spend),
          name,
          type,
          roas: spend > 0 ? `${roasNum.toFixed(2)}x` : "null",
          roasColor:
            spend === 0 ? "gray" : roasNum >= 1.5 ? "green" : roasNum >= 1.0 ? "orange" : "red",
          impr,
          clicks,
          cpc: clicks > 0 ? spend / clicks : 0,
          ctr: impr > 0 ? (clicks / impr) * 100 : 0,
          convRate: clicks > 0 ? (convs / clicks) * 100 : 0,
          conv: convs,
          cpa: convs > 0 ? spend / convs : 0,
          revenue: convVal / 1000,
          cost: spend / 1000,
          profit: (convVal - spend) / 1000,
          roasVal: roasNum,
          extra: d.extra,
        };
      });
      setRealCampaignRows(mappedRows);

      // Admin-registered custom metrics (raw Windsor fields, no canonical
      // formula) for this connector — folded into the day-level bar data
      // below so realKpis/dynKpis can compute a KPI card for them too.
      // percent/ratio-format ones are AVERAGED across campaigns for a day
      // (summing e.g. a bounce rate across campaigns would be meaningless);
      // everything else is summed, same as clicks/conv/cost.
      const customConnectorDef = getConnector(activeConnector);
      const customKeys = Object.keys(customConnectorDef.customMetricFields ?? {});
      const avgCustomKeys = new Set(customKeys.filter((k) => isAveragedMetric(activeConnector, k)));

      const { data: dailyData } = dailyResult;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dateMap: Record<string, any> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dailyData.forEach((d: any) => {
        const dt = d.date!;
        if (!dateMap[dt]) {
          dateMap[dt] = {
            date: new Date(dt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }),
            _iso: dt,
            total: 0,
            cost: 0,
            clicks: 0,
            profit: 0,
            conv: 0,
            _extra: {} as Record<string, number>,
            _extraCount: 0,
          };
        }
        const rev = Number(d.conversion_value) || 0;
        const cost = Number(d.spend) || 0;
        const name = d.dimension || d.campaign || "Unknown";
        dateMap[dt][name] = rev;
        dateMap[dt][`_cost_${name}`] = cost;
        dateMap[dt][`_clicks_${name}`] = Number(d.clicks) || 0;
        dateMap[dt][`_conv_${name}`] = Number(d.conversions) || 0;
        dateMap[dt].total += rev;
        dateMap[dt].cost += cost;
        dateMap[dt].clicks += Number(d.clicks) || 0;
        dateMap[dt].profit += rev - cost;
        dateMap[dt].conv += Number(d.conversions) || 0;
        dateMap[dt]._extraCount += 1;
        for (const k of customKeys) {
          const v = Number(d.extra?.[k]) || 0;
          dateMap[dt]._extra[k] = (dateMap[dt]._extra[k] || 0) + v;
          dateMap[dt][`_extra_${k}_${name}`] =
            ((dateMap[dt][`_extra_${k}_${name}`] as number) || 0) + v;
        }
      });
      for (const dt of Object.keys(dateMap)) {
        if (dateMap[dt]._extraCount > 0) {
          for (const k of customKeys) {
            if (avgCustomKeys.has(k)) dateMap[dt]._extra[k] /= dateMap[dt]._extraCount;
          }
        }
      }
      if (cancelled) return;
      setRealBarData(
        Object.keys(dateMap)
          .sort()
          .map((k) => dateMap[k]),
      );
      setDataConnector(activeConnector);
      setIsWindsorLoading(false);
    };

    const timer = setTimeout(loadData, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rangeStart, rangeEnd, viewAsUserId, activeConnector, primaryDim, customMetricSig]);

  useEffect(() => {
    const dim = chartGroupByDim[chartGroupBy];
    if (!dim || !windsorConnected) {
      setDimensionBarRows(null);
      return;
    }
    setDimensionBarRows(null);
    setDimensionBarLoading(true);
    const dateFrom = new Date(rangeStart).toISOString().split("T")[0];
    const dateTo = new Date(rangeEnd).toISOString().split("T")[0];
    let cancelled = false;
    fetch(
      `${rowsApiBase()}?date_from=${dateFrom}&date_to=${dateTo}&group_by=${encodeURIComponent(`date,${dim}`)}${connectorQS}${viewAsQS}`,
    )
      .then((r) => r.json())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((json: any) => {
        if (cancelled) return;
        if (!json.data) {
          setDimensionBarRows(null);
          return;
        }
        setDimensionBarRows(json.data as Record<string, unknown>[]);
      })
      .catch(() => {
        if (!cancelled) setDimensionBarRows(null);
      })
      .finally(() => {
        if (!cancelled) setDimensionBarLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // activeConnector/connectorQS matter: a reply for the source we just left
    // must not repaint the chart under the new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartGroupBy, rangeStart, rangeEnd, windsorConnected, activeConnector, customMetricSig]);

  // Day-level series for the chart's current group-by, scoped to whatever the
  // user picked in the tables. Rows carry `pivot` (the primary entity, folded
  // into every dimension's fetch by withCrossFilterPivot), which is what a
  // selection is expressed in — so scoping needs no extra request.
  const dimensionBarData = useMemo<Record<string, unknown>[] | null>(() => {
    if (!dimensionBarRows) return null;
    const customKeys = Object.keys(getConnector(activeConnector).customMetricFields ?? {});
    const avgKeys = new Set(customKeys.filter((k) => isAveragedMetric(activeConnector, k)));
    const scope = chartEntityScope ? new Set(chartEntityScope) : null;
    const pivotVal = (row: Record<string, unknown>): string =>
      (row.pivot as string) || readDimensionValue(activeConnector, primaryDim, row);
    let rows = dimensionBarRows;
    // A filter on the chart's OWN dimension (grouped by Device, Device=Mobile
    // picked in its table) narrows the series directly — the entity scope below
    // only knows which campaigns/channels were attributed, which would still
    // leave every device of those campaigns on the chart.
    const ownDimKey = chartGroupByDim[chartGroupBy];
    const ownDimValues = ownDimKey ? filters[ownDimKey] : undefined;
    if (ownDimValues && ownDimValues.length > 0) {
      const want = new Set(ownDimValues);
      const kept = rows.filter((r) => want.has(String(r.dimension ?? "")));
      rows = kept.length > 0 ? kept : rows;
    }
    if (scope) {
      const kept = rows.filter((r) => scope.has(pivotVal(r)));
      // Nothing matched means the join didn't land (rows from a shape with no
      // pivot), not that the selection genuinely accounts for nothing. Showing
      // an empty chart there reads as broken; the unscoped series is less
      // precise but truthful about there being data.
      rows = kept.length > 0 ? kept : rows;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dateMap: Record<string, any> = {};
    for (const row of rows) {
      const dt = row.date as string;
      if (!dt) continue;
      const name = (row.dimension as string) || "Unknown";
      if (!dateMap[dt])
        dateMap[dt] = {
          date: new Date(dt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          }),
          _iso: dt,
          total: 0,
          cost: 0,
          profit: 0,
          clicks: 0,
          conv: 0,
          _extra: {} as Record<string, number>,
          _extraCount: 0,
        };
      const rev = Number(row.conversion_value) || 0;
      const cost = Number(row.spend) || 0;
      const clk = Number(row.clicks) || 0;
      const cnv = Number(row.conversions) || 0;
      dateMap[dt][name] = ((dateMap[dt][name] as number) || 0) + rev;
      dateMap[dt][`_cost_${name}`] = ((dateMap[dt][`_cost_${name}`] as number) || 0) + cost;
      dateMap[dt][`_clicks_${name}`] = ((dateMap[dt][`_clicks_${name}`] as number) || 0) + clk;
      dateMap[dt][`_conv_${name}`] = ((dateMap[dt][`_conv_${name}`] as number) || 0) + cnv;
      dateMap[dt].total += rev;
      dateMap[dt].cost += cost;
      dateMap[dt].profit += rev - cost;
      dateMap[dt].clicks += clk;
      dateMap[dt].conv += cnv;
      dateMap[dt]._extraCount += 1;
      for (const k of customKeys) {
        const v = Number((row.extra as Record<string, number> | undefined)?.[k]) || 0;
        dateMap[dt]._extra[k] = (dateMap[dt]._extra[k] || 0) + v;
        dateMap[dt][`_extra_${k}_${name}`] =
          ((dateMap[dt][`_extra_${k}_${name}`] as number) || 0) + v;
      }
    }
    for (const dt of Object.keys(dateMap)) {
      if (dateMap[dt]._extraCount > 0)
        for (const k of avgKeys) dateMap[dt]._extra[k] /= dateMap[dt]._extraCount;
    }
    return Object.keys(dateMap)
      .sort()
      .map((k) => dateMap[k]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dimensionBarRows,
    activeConnector,
    connectorConfigs,
    chartEntityScope,
    primaryDim,
    chartGroupBy,
    chartGroupByDim,
    filters,
  ]);

  useEffect(() => {
    fetch("/api/team/members")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.members) setTeamMembers(json.members);
      })
      .catch(() => {});
  }, []);

  const handlePresetClick = (label: string) => {
    const today = new Date(END_MS);
    today.setUTCHours(0, 0, 0, 0);
    const nowTs = today.getTime();
    let start = nowTs;
    let end = nowTs;

    switch (label) {
      case "Today":
        start = nowTs;
        end = nowTs;
        break;
      case "Yesterday":
        start = nowTs - DAY_MS;
        end = nowTs - DAY_MS;
        break;
      case "This week (Sun - Today)": {
        const d = new Date(nowTs);
        const day = d.getUTCDay();
        start = nowTs - day * DAY_MS;
        end = nowTs;
        break;
      }
      case "This week (Mon - Today)": {
        const d = new Date(nowTs);
        const day = d.getUTCDay();
        const offset = (day + 6) % 7; // days since Monday
        start = nowTs - offset * DAY_MS;
        end = nowTs;
        break;
      }
      case "Last 7 days":
        start = nowTs - 6 * DAY_MS;
        end = nowTs;
        break;
      case "Last week (Sun - Sat)": {
        const d = new Date(nowTs);
        const day = d.getUTCDay();
        end = nowTs - (day + 1) * DAY_MS;
        start = end - 6 * DAY_MS;
        break;
      }
      case "Last week (Mon - Sun)": {
        const d = new Date(nowTs);
        const day = d.getUTCDay();
        const offset = (day + 6) % 7; // days since this Monday
        end = nowTs - offset * DAY_MS - DAY_MS; // last Sunday
        start = end - 6 * DAY_MS; // previous Monday
        break;
      }
      case "Last 14 days":
        start = nowTs - 13 * DAY_MS;
        end = nowTs;
        break;
      case "This month": {
        const d = new Date(nowTs);
        d.setUTCDate(1);
        start = d.getTime();
        end = nowTs;
        break;
      }
      case "Last 30 days":
        start = nowTs - 29 * DAY_MS;
        end = nowTs;
        break;
      case "Last month": {
        const d = new Date(nowTs);
        d.setUTCMonth(d.getUTCMonth() - 1);
        d.setUTCDate(1);
        start = d.getTime();
        const d2 = new Date(start);
        d2.setUTCMonth(d2.getUTCMonth() + 1);
        d2.setUTCDate(0);
        end = d2.getTime();
        break;
      }
      case "This year": {
        const d = new Date(nowTs);
        start = Date.UTC(d.getUTCFullYear(), 0, 1);
        end = nowTs;
        break;
      }
      case "All time":
        start = Date.UTC(2025, 0, 1);
        end = nowTs;
        break;
      default:
        return;
    }
    setPickerTempStart(start);
    setPickerTempEnd(end);
    setPickerStep(0);
    const sd = new Date(start);
    setPickerViewMonth(sd.getUTCMonth());
    setPickerViewYear(sd.getUTCFullYear());
  };

  const timeFilteredBarData = useMemo(() => {
    if (!realBarData) return null;
    if (!hasTimeFilter) return realBarData;
    const start = effectiveDateFrom;
    const end = effectiveDateTo;
    return realBarData.filter((r) => r._iso && r._iso >= start && r._iso <= end);
  }, [realBarData, effectiveDateFrom, effectiveDateTo, hasTimeFilter]);

  // Per-campaign value of the CURRENTLY selected chart metric, read from each row's
  // raw per-campaign keys (revenue = bare `<name>`; cost/clicks/conv = `_cost_/`
  // `_clicks_/_conv_<name>`). Drives the metric-specific campaign set, bars, tooltip
  // and legend so switching metric fully rebuilds the chart (not always Revenue).
  const metricValueOf = useCallback(
    (d: Record<string, unknown>, name: string): number => {
      switch (chartMetricKey) {
        case "cost":
          return (d[`_cost_${name}`] as number) || 0;
        case "clicks":
          return (d[`_clicks_${name}`] as number) || 0;
        case "conv":
          return (d[`_conv_${name}`] as number) || 0;
        case "profit":
          return Math.max(0, ((d[name] as number) || 0) - ((d[`_cost_${name}`] as number) || 0));
        case "revenue":
          return (d[name] as number) || 0;
        default:
          // An admin-registered custom metric — the bar data carries a series
          // per primary entity for each of them, alongside the canonical four.
          return (d[`_extra_${chartMetricKey}_${name}`] as number) || 0;
      }
    },
    [chartMetricKey],
  );

  const { dates, barData, campaignAvgs, adPerfData, plData, allNames, othersNames } = useMemo(
    () => {
      const { dates } = generatePeriodData(rangeStart, rangeEnd);
      // An EMPTY crossFilterData (matched rows had no usable per-date bars, e.g. rows
      // missing `date`) must NOT blank the chart while the KPI cards still show data
      // from realBarData. Fall back to the full per-date data, and — when a lower-dim
      // cross-filter is active (crossFilterCampaigns set) — scope it to those campaigns
      // so the chart stays consistent with the KPIs instead of showing "No data".
      let effectiveBarData: typeof timeFilteredBarData;
      // Chart campaign scope: an active lower-dimension cross-filter
      // (crossFilterCampaigns) takes priority; otherwise a DIRECT campaign selection
      // (Campaign-table checkboxes / the Others bar → campaign_selected). Without the
      // latter the series set is built from the WHOLE account, so a selection whose
      // campaigns fall outside the top-9 rendered nothing ("No revenue…") even though
      // the KPIs showed their totals. Scoping here rebuilds the series to exactly the
      // selected campaigns so the chart displays and filters to them.
      const chartCampaignScope = chartEntityScope;
      if (crossFilterData && crossFilterData.length > 0) {
        effectiveBarData = crossFilterData;
      } else if (timeFilteredBarData && chartCampaignScope && chartCampaignScope.length > 0) {
        const keep = new Set(chartCampaignScope);
        // This projection rebuilds each day from scratch for the selected
        // entities, so it has to copy the admin-registered metric series as
        // well. Copying only the canonical four left the chart with nothing to
        // plot for a source whose metrics are all custom (Search Console):
        // selecting a row blanked it to "No impressions during the selected
        // period" while the KPI cards, computed elsewhere, showed the totals.
        const scopeCustomKeys = Object.keys(getConnector(activeConnector).customMetricFields ?? {});
        const scopeAvgKeys = new Set(
          scopeCustomKeys.filter((k) => isAveragedMetric(activeConnector, k)),
        );
        effectiveBarData = timeFilteredBarData.map((row: Record<string, unknown>) => {
          const extra: Record<string, number> = {};
          let extraCount = 0;
          const out: Record<string, unknown> = {
            date: row.date,
            _iso: row._iso,
            total: 0,
            cost: 0,
            clicks: 0,
            profit: 0,
            conv: 0,
            _extra: extra,
            _extraCount: 0,
          };
          for (const name of keep) {
            const rev = (row[name] as number) || 0;
            const cost = (row[`_cost_${name}`] as number) || 0;
            const clk = (row[`_clicks_${name}`] as number) || 0;
            const cnv = (row[`_conv_${name}`] as number) || 0;
            out[name] = rev;
            out[`_cost_${name}`] = cost;
            out[`_clicks_${name}`] = clk;
            out[`_conv_${name}`] = cnv;
            out.total = (out.total as number) + rev;
            out.cost = (out.cost as number) + cost;
            out.clicks = (out.clicks as number) + clk;
            out.conv = (out.conv as number) + cnv;
            out.profit = (out.profit as number) + (rev - cost);
            let present = false;
            for (const k of scopeCustomKeys) {
              const key = `_extra_${k}_${name}`;
              if (!(key in row)) continue;
              present = true;
              const v = (row[key] as number) || 0;
              out[key] = v;
              extra[k] = (extra[k] || 0) + v;
            }
            if (present) extraCount += 1;
          }
          if (extraCount > 0) for (const k of scopeAvgKeys) extra[k] /= extraCount;
          out._extraCount = extraCount;
          return out;
        });
      } else {
        effectiveBarData = timeFilteredBarData;
      }
      if (!windsorConnected || !effectiveBarData || effectiveBarData.length === 0) {
        return {
          dates,
          barData: [],
          adPerfData: [] as AdPerfItem[],
          plData: [] as PlItem[],
          campaignAvgs: [],
          allNames: [] as string[],
        };
      }

      // adPerfData and plData always from account-wide effectiveBarData
      const derivedAdPerfData: AdPerfItem[] = effectiveBarData.map((d: Record<string, unknown>) => {
        const convValue = d.total as number;
        const cost = d.cost as number;
        const profit = d.profit as number;
        const clicks = d.clicks as number;
        const conv = (d.conv as number) || 0;
        const roas = cost > 0 ? convValue / cost : 0;
        return {
          date: d.date as string,
          _iso: d._iso as string | undefined,
          convValue,
          cost,
          profit,
          clicks,
          conv,
          roas,
          costBar: cost,
          profitBar: Math.max(0, profit),
          lossBar: Math.min(0, profit),
        };
      });

      const derivedPlData: PlItem[] = effectiveBarData.map((d: Record<string, unknown>) => ({
        date: d.date as string,
        _iso: d._iso as string | undefined,
        dailyProfit: d.profit as number,
        cumulative: 0,
      }));

      // barData and campaignAvgs: use the dimension series whenever the chart is
      // grouped by a dimension. It used to be dropped as soon as a cross-filter
      // was active — the chart then silently regrouped by the primary entity
      // while the "by" dropdown still named the dimension. It can stay now:
      // dimensionBarData is scoped to the same selection (chartEntityScope).
      const isDimMode =
        chartGroupBy !== "Campaign" &&
        chartGroupBy !== "Campaign Type" &&
        dimensionBarData !== null &&
        dimensionBarData.length > 0;
      const sourceBarData = isDimMode ? dimensionBarData : effectiveBarData;

      const EXCLUDE_KEYS = new Set([
        "date",
        "total",
        "cost",
        "clicks",
        "profit",
        "conv",
        "visibleTotal",
      ]);
      const allNames = Array.from(
        new Set(
          sourceBarData.flatMap((d: Record<string, unknown>) =>
            Object.keys(d).filter((k) => !EXCLUDE_KEYS.has(k) && !k.startsWith("_")),
          ),
        ),
      );

      // Build the campaign set from the SELECTED metric's non-zero totals (not always
      // Revenue). ≤10 campaigns → show all; >10 → top 9 by value + an aggregated
      // "Others". chartBarData below fills the per-row metric values for this set, and
      // barData stays RAW (revenue + _cost_/_clicks_/_conv_ per campaign) because the
      // Ad Performance / P&L aggregation reads those raw keys.
      const nameWithTotals = allNames
        .map((name) => ({
          name,
          total: sourceBarData.reduce(
            (s: number, d: Record<string, unknown>) => s + metricValueOf(d, name),
            0,
          ),
        }))
        .filter((item) => item.total > 0)
        .sort((a, b) => b.total - a.total);

      const topItems = nameWithTotals.length <= 10 ? nameWithTotals : nameWithTotals.slice(0, 9);
      const otherItems = nameWithTotals.length <= 10 ? [] : nameWithTotals.slice(9);
      const othersTotal = otherItems.reduce((s, n) => s + n.total, 0);
      // Real campaigns folded into the "Others" bar — clicking Others cross-filters
      // to this whole set (not the literal string "Others", which matches nothing).
      const othersNames = otherItems.map((n) => n.name);

      const allEntries = [
        ...topItems,
        ...(otherItems.length > 0 ? [{ name: "Others", total: othersTotal }] : []),
      ].sort((a, b) => b.total - a.total);

      let colorIdx = 0;
      const campaignAvgs = allEntries.map((item) => ({
        name: item.name,
        avg: item.total / sourceBarData.length,
        color: item.name === "Others" ? "#9CA3AF" : COLORS[colorIdx++ % COLORS.length],
      }));

      return {
        dates,
        barData: sourceBarData,
        adPerfData: derivedAdPerfData,
        plData: derivedPlData,
        campaignAvgs,
        allNames,
        othersNames,
      };
    },
    // timeFilteredBarData must be a dep — without it, selecting a time bucket
    // (week/month/…) narrowed the range but the charts kept the stale full data.
    [
      rangeStart,
      rangeEnd,
      realBarData,
      crossFilterData,
      timeFilteredBarData,
      windsorConnected,
      dimensionBarData,
      chartGroupBy,
      metricValueOf,
      chartEntityScope,
      activeConnector,
      connectorConfigs,
    ],
  );

  // Build the AI context shared by insights + chat
  const buildAiContext = useCallback(() => {
    const dateFrom = new Date(rangeStart).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    const dateTo = new Date(rangeEnd).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    const freshKpis = dynKpisRef.current ?? realKpisRef.current;
    const freshCampaigns = realCampaignRowsRef.current;
    const dynamic = selectedRowsRef.current.length > 0 ? selectedRowsRef.current : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapRow = (r: any) => ({
      name: r.name,
      type: r.type,
      cost: `$${(r.cost as number).toFixed(2)}K`,
      revenue: `$${(r.revenue as number).toFixed(2)}K`,
      roas: r.roas,
      cpa: `$${(r.cpa as number).toFixed(2)}`,
      clicks: r.clicks,
      conv: r.conv,
    });
    // Cross-dimensional data: selection-driven override rows take precedence;
    // otherwise fall back to the top rows fetched for the AI (account level).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dimSource: Record<string, any[]> = { ...aiDimsRef.current };
    for (const [k, rows] of Object.entries(crossFilterRowsByDimRef.current ?? {})) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (Array.isArray(rows) && (rows as any[]).length > 0) dimSource[k] = rows as any[];
    }
    const crossDims = Object.entries(dimSource)
      .filter(([, rows]) => Array.isArray(rows) && rows.length > 0)
      .slice(0, 8)
      .map(([dimension, rows]) => ({
        dimension,
        // Pass up to 30 rows per dimension (matches the fetch + the route's slice)
        // so admin "Additional Instructions" like "show 10 search terms" actually
        // have enough rows to satisfy. An 8-row cap here silently starved them.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rows: rows.slice(0, 40).map((r: any) => ({
          name: r.dimension ?? r.name,
          cost: `$${(Number(r.cost) || 0).toFixed(2)}K`,
          revenue: `$${(Number(r.revenue) || 0).toFixed(2)}K`,
          roas: r.roas,
          cpa: `$${(Number(r.cpa) || 0).toFixed(2)}`,
          clicks: r.clicks,
          conv: r.conv,
        })),
      }));
    return {
      dateRange: `${dateFrom} – ${dateTo}`,
      connected: windsorConnectedRef.current,
      dataSource: dataSourceRef.current,
      mode: aiSelectionChipsRef.current.length > 0 ? ("selection" as const) : ("account" as const),
      selection: aiSelectionChipsRef.current.map((c) => ({
        dimension: c.dimension,
        values: c.values,
      })),
      kpis: freshKpis
        ? visibleKpisRef.current.map((k) => ({
            label: k.label,
            value: freshKpis[k.idx]?.value ?? "—",
            trend: freshKpis[k.idx]?.delta ?? "—",
          }))
        : null,
      campaigns: (dynamic ?? freshCampaigns)?.slice(0, 15).map(mapRow),
      crossDims,
    };
  }, [rangeStart, rangeEnd]);

  // Pull top rows for the key dimensions so the AI can analyze search terms,
  // ad groups, devices, etc. at the account level without the user selecting
  // anything. Skips dims already loaded by an active cross-filter.
  const loadTopDimensions = useCallback(
    async (fromIso?: string, toIso?: string) => {
      const from = fromIso ?? new Date(rangeStart).toISOString().slice(0, 10);
      const to = toIso ?? new Date(rangeEnd).toISOString().slice(0, 10);
      const dims = [
        "ad_group",
        "keyword",
        "search_term",
        "device",
        "network",
        "country",
        "audience",
        "match_type",
      ];
      const results = await Promise.all(
        dims.map(async (d) => {
          if (
            Array.isArray(crossFilterRowsByDimRef.current?.[d]) &&
            crossFilterRowsByDimRef.current[d]!.length > 0
          )
            return [d, null] as const;
          try {
            const r = await fetch(
              `${dimApiBase()}/${d}?date_from=${from}&date_to=${to}&page=1&limit=40&sort=cost&sort_dir=desc${viewAsQS}`,
            );
            const j = await r.json();
            return [d, Array.isArray(j.data) ? j.data : []] as const;
          } catch {
            return [d, []] as const;
          }
        }),
      );
      const next: Record<string, unknown[]> = {};
      for (const [d, rows] of results) if (rows) next[d] = rows;
      aiDimsRef.current = next;
    },
    [rangeStart, rangeEnd],
  );

  const loadInsights = useCallback(
    async (focus?: string, focusInstructions?: string) => {
      setAiInsightsLoading(true);
      setAiInsights([]);
      setAiSuggestedQuestions([]);
      try {
        // If the question names an explicit period (e.g. "Q3 2022"), switch the
        // dashboard to that period FIRST so the AI analyses the right data — instead
        // of saying "no data" because the date picker is on a different period.
        let effStart = rangeStart,
          effEnd = rangeEnd,
          switched = false;
        if (focus) {
          const period = parsePeriodFromText(focus);
          if (period && (period.start !== rangeStart || period.end !== rangeEnd)) {
            setRangeStart(period.start);
            setRangeEnd(period.end);
            setHiddenSeries(new Set());
            window.dispatchEvent(
              new CustomEvent("date-range-changed", {
                detail: { start: period.start, end: period.end },
              }),
            );
            effStart = period.start;
            effEnd = period.end;
            switched = true;
            // Let the dashboard kick off its refetch for the new period.
            await new Promise((r) => setTimeout(r, 500));
          }
        }
        // Wait for Windsor data so insights reflect the (possibly new) period
        if (isWindsorLoadingRef.current) {
          await new Promise<void>((resolve) => {
            const check = setInterval(() => {
              if (!isWindsorLoadingRef.current) {
                clearInterval(check);
                resolve();
              }
            }, 150);
            setTimeout(() => {
              clearInterval(check);
              resolve();
            }, 8000);
          });
        }
        const effFrom = new Date(effStart).toISOString().slice(0, 10);
        const effTo = new Date(effEnd).toISOString().slice(0, 10);
        await loadTopDimensions(effFrom, effTo);
        // Build the context, overriding the date label when we switched period (the
        // closure's rangeStart is stale within this single call; the data refs are
        // already refreshed for the new period by the dashboard refetch above).
        const context = buildAiContext();
        if (switched) {
          const fmtUTC = (ms: number) =>
            new Date(ms).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
            });
          context.dateRange = `${fmtUTC(effStart)} – ${fmtUTC(effEnd)}`;
        }
        // Pass recent session Q&A so suggested questions are session-aware (don't
        // repeat what was already asked/answered — see Suggested Questions Rules).
        const history = aiMsgs.slice(-8).map((m) => ({ role: m.role, content: m.text }));
        const res = await fetch("/api/ai-insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context,
            focus: focus || undefined,
            focusInstructions: focusInstructions || undefined,
            history,
            dateFrom: effFrom,
            dateTo: effTo,
            connector: activeConnectorRef.current,
          }),
        });
        const data = await res.json();
        if (Array.isArray(data.insights)) setAiInsights(data.insights);
        if (Array.isArray(data.suggestedQuestions))
          setAiSuggestedQuestions(data.suggestedQuestions);
        if (data.error)
          setAiInsights([
            {
              insight: "Could not generate insights right now.",
              whyItMatters: data.error,
              action: ["Try again in a moment."],
            },
          ]);
      } catch {
        setAiInsights([
          {
            insight: "Could not reach the AI service.",
            action: ["Check your connection and try again."],
          },
        ]);
      } finally {
        setAiInsightsLoading(false);
      }
    },
    [buildAiContext, loadTopDimensions, aiMsgs, rangeStart, rangeEnd],
  );

  const openAi = () => {
    // Insights are generated by the open-effect (deps: [aiOpen]); don't also call
    // here or it double-fires.
    setAiOpen(true);
  };

  const sendAiMsg = async (text?: string) => {
    const msg = (text ?? aiInput).trim();
    if (!msg || aiLoading) return;
    setAiInput("");
    const t = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    const snapshot = aiMsgs;
    setAiMsgs((prev) => [
      ...prev,
      { id: Date.now(), role: "user", text: msg, time: t, pinned: false },
    ]);
    setAiLoading(true);
    try {
      // Wait for Windsor data to finish loading (max 6s) so AI gets fresh context
      if (isWindsorLoadingRef.current) {
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (!isWindsorLoadingRef.current) {
              clearInterval(check);
              resolve();
            }
          }, 150);
          setTimeout(() => {
            clearInterval(check);
            resolve();
          }, 6000);
        });
      }

      await loadTopDimensions();
      const dateFrom = new Date(rangeStart).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
      const dateTo = new Date(rangeEnd).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
      const freshKpis = dynKpisRef.current ?? realKpisRef.current;
      const freshCampaigns = realCampaignRowsRef.current;
      // Cross-dimensional data (ad groups, keywords, search terms, devices, …) so
      // the chat can answer questions beyond campaign level. Selection override
      // takes precedence; otherwise use the account-level top rows.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dimSource: Record<string, any[]> = { ...aiDimsRef.current };
      for (const [k, rows] of Object.entries(crossFilterRowsByDimRef.current ?? {})) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (Array.isArray(rows) && (rows as any[]).length > 0) dimSource[k] = rows as any[];
      }
      const crossDims = Object.entries(dimSource)
        .filter(([, rows]) => Array.isArray(rows) && rows.length > 0)
        .slice(0, 8)
        .map(([dimension, rows]) => ({
          dimension,
          // Up to 30 rows per dimension so the chat can satisfy "list N" requests.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rows: rows.slice(0, 40).map((r: any) => ({
            name: r.dimension ?? r.name,
            cost: `$${(Number(r.cost) || 0).toFixed(2)}K`,
            revenue: `$${(Number(r.revenue) || 0).toFixed(2)}K`,
            roas: r.roas,
            cpa: `$${(Number(r.cpa) || 0).toFixed(2)}`,
            clicks: r.clicks,
            conv: r.conv,
          })),
        }));
      const context = {
        dateRange: `${dateFrom} – ${dateTo}`,
        connected: windsorConnectedRef.current,
        dataSource: dataSourceRef.current,
        mode:
          aiSelectionChipsRef.current.length > 0 ? ("selection" as const) : ("account" as const),
        selection: aiSelectionChipsRef.current.map((c) => ({
          dimension: c.dimension,
          values: c.values,
        })),
        kpis: freshKpis
          ? visibleKpisRef.current.map((k) => ({
              label: k.label,
              value: freshKpis[k.idx]?.value ?? "—",
              trend: freshKpis[k.idx]?.delta ?? "—",
            }))
          : null,
        campaigns: freshCampaigns?.slice(0, 20).map((r: Record<string, unknown>) => ({
          name: r.name,
          type: r.type,
          cost: `$${(r.cost as number).toFixed(2)}K`,
          revenue: `$${(r.revenue as number).toFixed(2)}K`,
          roas: r.roas,
          clicks: r.clicks,
          conversions: r.conv,
          cpa: `$${(r.cpa as number).toFixed(2)}`,
        })),
        crossDims,
      };
      const history = snapshot.slice(-10).map((m) => ({ role: m.role, content: m.text }));
      const res = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          context,
          history,
          // ISO dates power the query_data tool so the AI can fetch any breakdown
          // (ad groups, devices, search terms, weekly data…) for the live period.
          dateFrom: new Date(rangeStart).toISOString().slice(0, 10),
          dateTo: new Date(rangeEnd).toISOString().slice(0, 10),
          // Which source the model is analysing — it decides the breakdowns it may
          // query and whether cost/ROAS exist at all.
          connector: activeConnectorRef.current,
        }),
      });
      const data = await res.json();
      const t2 = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      if (data.dateAction) {
        const { start, end } = data.dateAction as DateAction;
        const startMs = new Date(start).getTime();
        const endMs = new Date(end).getTime();
        setRangeStart(startMs);
        setRangeEnd(endMs);
        window.dispatchEvent(
          new CustomEvent("date-range-changed", { detail: { start: startMs, end: endMs } }),
        );
      }
      setAiMsgs((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: "assistant",
          text: data.error ? `Error: ${data.error}` : data.text,
          time: t2,
          pinned: false,
          dateAction: data.dateAction,
          filterAction: data.filterAction,
          actions: data.actions,
        },
      ]);
    } catch {
      const t2 = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      setAiMsgs((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: "assistant",
          text: "Couldn't reach AI. Please try again.",
          time: t2,
          pinned: false,
        },
      ]);
    } finally {
      setAiLoading(false);
    }
  };

  const toggleAiPin = (id: number) =>
    setAiMsgs((prev) => prev.map((m) => (m.id === id ? { ...m, pinned: !m.pinned } : m)));

  // Keep session ID ref in sync
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // Auto-save conversation 1.5s after any message change
  useEffect(() => {
    if (isLoadingSessionRef.current || aiMsgs.length === 0) return;
    if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current);
    sessionSaveTimerRef.current = setTimeout(async () => {
      const title = (aiMsgs.find((m) => m.role === "user")?.text ?? "Conversation").slice(0, 60);
      const id = currentSessionIdRef.current;
      if (!id) {
        const res = await fetch("/api/ai-chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, messages: aiMsgs, insights: aiInsights }),
        });
        if (res.ok) {
          const { id: newId } = (await res.json()) as { id: string };
          setCurrentSessionId(newId);
          currentSessionIdRef.current = newId;
        }
      } else {
        await fetch(`/api/ai-chats/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, messages: aiMsgs, insights: aiInsights }),
        });
      }
    }, 1500);
  }, [aiMsgs, aiInsights]);

  const loadChatSession = useCallback((session: ChatSession) => {
    isLoadingSessionRef.current = true;
    setCurrentSessionId(session.id);
    currentSessionIdRef.current = session.id;
    setAiMsgs(session.messages ?? []);
    setAiInsights(session.insights ?? []);
    setAiSuggestedQuestions([]);
    setAiFocusQuestion(null);
    setAiInput("");
    setTimeout(() => {
      isLoadingSessionRef.current = false;
    }, 200);
  }, []);

  const newChat = useCallback(() => {
    isLoadingSessionRef.current = true;
    setCurrentSessionId(null);
    currentSessionIdRef.current = null;
    setAiMsgs([]);
    setAiInsights([]);
    setAiSuggestedQuestions([]);
    setAiFocusQuestion(null);
    setAiInput("");
    setTimeout(() => {
      isLoadingSessionRef.current = false;
    }, 200);
  }, []);

  const deleteSession = useCallback(
    async (id: string) => {
      await fetch(`/api/ai-chats/${id}`, { method: "DELETE" });
      if (currentSessionIdRef.current === id) newChat();
    },
    [newChat],
  );

  // "Show on dashboard" — apply the filters/period the AI analyzed to the live
  // dashboard. Resets any existing filters, sets the new ones + period, and
  // closes the AI panel so the rebuilt charts/tables are visible.
  const applyFilterAction = async (fa: FilterAction) => {
    clearAll();
    // Resolve the date range used for any "contains" name lookups (a new range
    // from the action, otherwise the current one).
    let fromIso = new Date(rangeStart).toISOString().slice(0, 10);
    let toIso = new Date(rangeEnd).toISOString().slice(0, 10);
    if (fa.date_from && fa.date_to) {
      const s = Date.parse(`${fa.date_from}T00:00:00Z`);
      const e = Date.parse(`${fa.date_to}T00:00:00Z`);
      if (!isNaN(s) && !isNaN(e)) {
        setRangeStart(s);
        setRangeEnd(e);
        fromIso = fa.date_from;
        toIso = fa.date_to;
        window.dispatchEvent(
          new CustomEvent("date-range-changed", { detail: { start: s, end: e } }),
        );
      }
    }
    setActiveTab(0); // Period Analysis shows the rebuilt chart
    setHiddenSeries(new Set());
    // Desktop: keep the chat open (dashboard sits beside it) so the user can
    // keep the conversation going. Mobile: the panel is full-screen, so close it
    // to reveal the rebuilt dashboard.
    if (isMobile) setAiOpen(false);

    // Real campaign names for tolerant matching — the AI often passes a slightly
    // different label (e.g. "Shoes" or "Shoes [Search]") than the exact campaign
    // name, which made the campaign_name filter match nothing → empty dashboard.
    const realNames: string[] = (realCampaignRows ?? []).map((r: { name: string }) => r.name);
    const resolveCampaigns = (vals: string[]): string[] => {
      const out = new Set<string>();
      for (const v of vals) {
        const raw = v.toLowerCase().trim();
        const needle = raw.replace(/\s*\[[^\]]*\]\s*/g, "").trim(); // strip "[Search]" etc.
        const exact = realNames.filter(
          (n) => n.toLowerCase() === raw || n.toLowerCase() === needle,
        );
        if (exact.length) {
          exact.forEach((n) => out.add(n));
          continue;
        }
        if (needle)
          realNames.filter((n) => n.toLowerCase().includes(needle)).forEach((n) => out.add(n));
      }
      return [...out];
    };

    for (const f of fa.filters ?? []) {
      if (f.dimension === "campaign_name" && f.values && f.values.length > 0) {
        // Map the AI's campaign label(s) onto the real campaign name(s).
        const resolved = resolveCampaigns(f.values);
        if (resolved.length > 0) setFilter("campaign_name", resolved);
        else setFilter("campaign_name", f.values); // fall back to as-given
      } else if (f.dimension === "campaign_name" && f.search) {
        // Campaign "contains" — campaigns don't come from /api/data/[dimension];
        // resolve from the in-memory campaign list by substring instead, so e.g.
        // 'All campaigns including "Accessories"' actually filters the dashboard.
        const needle = f.search.toLowerCase().trim();
        const matches = realNames.filter((n) => n.toLowerCase().includes(needle));
        if (matches.length > 0) setFilter("campaign_name", matches);
      } else if (f.search) {
        // "Contains" filter → resolve to ALL matching values via the data API
        // (same set the table's search box selects), so the dashboard matches
        // exactly what the AI analyzed.
        try {
          const r = await fetch(
            `${dimApiBase()}/${f.dimension}?date_from=${fromIso}&date_to=${toIso}&names_only=true&search=${encodeURIComponent(f.search)}${connectorQS}${viewAsQS}`,
          );
          const j = await r.json();
          const names: string[] = Array.isArray(j.names) ? j.names : [];
          // Bound the applied set so a very broad "contains" match can't push
          // thousands of values into the store and choke rendering.
          if (names.length > 0) setFilter(f.dimension, names.slice(0, 2000));
          // Drive the matching table's search so it lists ONLY the found rows.
          setDimSearch(f.dimension, f.search);
        } catch {
          /* ignore — leave that dimension unfiltered */
        }
      } else if (f.values && f.values.length > 0) {
        setFilter(f.dimension, f.values);
        // Narrow this dimension's OWN table to exactly these values (server-side
        // filter_self) so it shows ONLY the analysed rows instead of just
        // highlighting them, matching the AI's answer.
        setDimInclude(f.dimension, f.values);
      }
    }
  };

  useEffect(() => {
    if (aiScrollRef.current) aiScrollRef.current.scrollTop = aiScrollRef.current.scrollHeight;
  }, [aiMsgs, aiLoading]);

  // Show the floating AI button once the inline AI Analytics button scrolls out of
  // the viewport (desktop/tablet). On mobile the inline button isn't rendered.
  useEffect(() => {
    const el = aiBtnRef.current;
    if (!el) {
      setAiBtnVisible(false);
      return;
    }
    const obs = new IntersectionObserver(([entry]) => setAiBtnVisible(entry.isIntersecting), {
      threshold: 0,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [isMobile, aiOpen]);

  // Prevent background scroll when modal is open
  useEffect(() => {
    const isOpen = addEventOpen || (aiOpen && isMobile);
    if (!isOpen) return;
    const scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      window.scrollTo(0, scrollY);
    };
  }, [addEventOpen, aiOpen, isMobile]);

  const toggleSeries = (name: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  useEffect(() => {
    const checkSize = () => setIsMobile(window.innerWidth < 640);
    const portraitMql = window.matchMedia("(orientation: portrait)");
    const checkOrientation = (e: MediaQueryListEvent | MediaQueryList) => setIsPortrait(e.matches);

    checkSize();
    checkOrientation(portraitMql);
    window.addEventListener("resize", checkSize);
    portraitMql.addEventListener("change", checkOrientation);

    const handleOpen = () => openDatePickerRef.current();
    window.addEventListener("open-date-picker", handleOpen);

    return () => {
      window.removeEventListener("resize", checkSize);
      portraitMql.removeEventListener("change", checkOrientation);
      window.removeEventListener("open-date-picker", handleOpen);
    };
  }, []);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("date-range-changed", {
        detail: { start: rangeStart, end: rangeEnd },
      }),
    );
  }, [rangeStart, rangeEnd]);

  const handleSort = (col: SortKey) => {
    clearFilter("campaign_name");
    if (sortCol === col) {
      const next: SortDir = sortDir === "asc" ? "desc" : sortDir === "desc" ? null : "asc";
      setSortDir(next);
      if (next === null) setSortCol(null);
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const currentRows = useMemo(
    () => (windsorConnected ? (timeFilteredCampaignRows ?? realCampaignRows ?? []) : []),
    [windsorConnected, timeFilteredCampaignRows, realCampaignRows],
  );
  const types = ["All", ...Array.from(new Set(currentRows.map((r) => r.type)))];

  const filtered = useMemo(() => {
    // When a cross-filter is active from a lower dimension (e.g. search term),
    // use the aggregated per-campaign rows that reflect only the selected dimension's
    // metrics, not the full campaign totals.
    const base = crossFilterCampaignRows ?? currentRows;
    let rows = typeFilter === "All" ? base : base.filter((r) => r.type === typeFilter);
    if (statusFilter !== "Status") {
      // Active = green (serving); Paused = anything else (paused / removed /
      // unknown), so the filter still splits the table in two now that status
      // carries more than green/gray.
      rows = rows.filter((r) =>
        statusFilter === "Active" ? r.status === "green" : r.status !== "green",
      );
    }
    if (campaignSearch)
      rows = rows.filter((r) => r.name.toLowerCase().includes(campaignSearch.toLowerCase()));
    rows = applyMetricFilter(rows, debouncedMetricFilter);
    const campaignNameFilter = filters["campaign_name"] ?? [];
    if (campaignNameFilter.length > 0)
      rows = rows.filter((r) => campaignNameFilter.includes(r.name));
    // crossFilterCampaigns is no longer applied here — crossFilterCampaignRows already
    // contains only the relevant campaigns when a lower-dimension cross-filter is active.
    // When crossFilterCampaignRows is null we fall back to realCampaignRows, which shows all.
    if (!crossFilterCampaignRows && crossFilterCampaigns && crossFilterCampaigns.length > 0) {
      rows = rows.filter((r) => crossFilterCampaigns.includes(r.name));
    }
    if (sortCol && sortDir) {
      // A custom metric column has no field of its own; its value is in the
      // row's `extra` bag. Reading only the field left every row undefined, so
      // clicking such a header did nothing.
      const sortValue = (r: (typeof rows)[number]): unknown => {
        const direct = (r as unknown as Record<string, unknown>)[sortCol];
        return direct !== undefined && direct !== null ? direct : (r.extra?.[sortCol] ?? 0);
      };
      rows = [...rows].sort((a, b) => {
        const av = sortValue(a);
        const bv = sortValue(b);
        if (typeof av === "number" && typeof bv === "number")
          return sortDir === "asc" ? av - bv : bv - av;
        return sortDir === "asc"
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      });
    }
    return rows;
  }, [
    typeFilter,
    statusFilter,
    debouncedMetricFilter,
    campaignSearch,
    filters,
    sortCol,
    sortDir,
    realCampaignRows,
    windsorConnected,
    crossFilterCampaigns,
    crossFilterCampaignRows,
  ]);

  const totalPages = Math.ceil(filtered.length / rowsPerPage);

  // Any campaign-level filter active in the Campaign table → the chart and KPIs
  // must scope to exactly those campaigns (the `filtered` set). null = no scope.
  const campaignFilterActive =
    typeFilter !== "All" ||
    statusFilter !== "Status" ||
    isMetricFilterActive(debouncedMetricFilter) ||
    !!campaignSearch ||
    (filters["campaign_name"]?.length ?? 0) > 0;
  const campaignScopeNames = useMemo(
    () => (campaignFilterActive ? new Set(filtered.map((r) => r.name)) : null),
    [campaignFilterActive, filtered],
  );

  // Campaign Filters (Type / Status / ROAS / search) → GLOBAL. Resolve the
  // matching campaign names from realCampaignRows (independent of campaign_name
  // to avoid a feedback loop) and push them to the store so every other
  // Performance table filters to that campaign set. Cleared filter → drop only
  // what we pushed (don't wipe a dropdown selection).
  const campaignFilterDrivenRef = useRef<string[]>([]);
  useEffect(() => {
    const base = realCampaignRows ?? [];
    const baseFilterActive =
      typeFilter !== "All" ||
      statusFilter !== "Status" ||
      isMetricFilterActive(debouncedMetricFilter) ||
      !!campaignSearch;
    if (baseFilterActive) {
      let rows = typeFilter === "All" ? base : base.filter((r) => r.type === typeFilter);
      if (statusFilter !== "Status")
        rows = rows.filter((r) =>
          statusFilter === "Active" ? r.status === "green" : r.status !== "green",
        );
      rows = applyMetricFilter(rows, debouncedMetricFilter);
      if (campaignSearch)
        rows = rows.filter((r) => r.name.toLowerCase().includes(campaignSearch.toLowerCase()));
      const names = rows.map((r) => r.name);
      campaignFilterDrivenRef.current = names;
      setFilter("campaign_name", names);
    } else if (campaignFilterDrivenRef.current.length > 0) {
      const cur = filters["campaign_name"] ?? [];
      const ours = campaignFilterDrivenRef.current;
      const sameSet = cur.length === ours.length && cur.every((v) => ours.includes(v));
      if (sameSet) clearFilter("campaign_name");
      campaignFilterDrivenRef.current = [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, statusFilter, debouncedMetricFilter, campaignSearch, realCampaignRows]);

  // Global "Clear all" → also reset the Campaign-table page-level filters
  // (type / status / ROAS / search) so the top Clear truly resets everything.
  useEffect(() => {
    if (clearSignal === 0) return;
    setTypeFilter("All");
    setStatusFilter("Status");
    setMetricFilter(METRIC_FILTER_NONE);
    setCampaignSearch("");
    campaignFilterDrivenRef.current = [];
  }, [clearSignal]);

  // Debounce the Campaign metric filter so typing a value doesn't re-filter/re-push
  // on every keystroke.
  const campaignMetricKeyStr = metricFilterKey(metricFilter);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedMetricFilter(metricFilter), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignMetricKeyStr]);

  useEffect(() => {
    setPage(1);
  }, [filtered, rowsPerPage]);

  const rowTypeFilter = useMemo(() => {
    const campaignNames = filters["campaign_selected"] ?? [];
    if (campaignNames.length === 0) return null;
    const selRows = currentRows.filter((r) => campaignNames.includes(r.name));
    const selTypes = new Set(selRows.map((r) => r.type));
    const groups = new Set<string>(selRows.map((r) => r.name));
    selTypes.forEach((t) => (TYPE_TO_GROUPS[t] ?? []).forEach((g) => groups.add(g)));
    return groups;
  }, [filters, currentRows]);

  const selectedRows = useMemo(() => {
    const campaignNames = filters["campaign_selected"] ?? [];
    return currentRows.filter((r) => campaignNames.includes(r.name));
  }, [filters, currentRows]);

  const selectedNames = useMemo(() => new Set(filters["campaign_selected"] ?? []), [filters]);

  // Unified campaign scope for the Ad Performance, Profit/Loss and Segments charts:
  // an explicit bar-click selection (campaign_selected) takes priority; otherwise
  // fall back to the Campaign-table filter scope (dropdown / Type / Status / ROAS /
  // search). null = no scope → account-wide totals. Without this, only Period
  // Analysis reacted to the table filters while the other three tabs stayed full.
  const chartScopeNames = useMemo<Set<string> | null>(
    () => (selectedNames.size > 0 ? selectedNames : campaignScopeNames),
    [selectedNames, campaignScopeNames],
  );

  // AI Analytics: friendly labels for active selections → context chips
  // Active filters grouped by display label, carrying the underlying store keys
  // so each can be removed individually from the Active Filters bar.
  const activeFilterGroups = useMemo(() => {
    const grouped = new Map<string, { values: string[]; keys: string[] }>();
    for (const [key, vals] of Object.entries(filters)) {
      if (!vals || vals.length === 0) continue;
      const label = dimLabelFor(activeConnector, key);
      const cur = grouped.get(label) ?? { values: [], keys: [] };
      grouped.set(label, {
        values: [...new Set([...cur.values, ...vals])],
        keys: [...new Set([...cur.keys, key])],
      });
    }
    return [...grouped.entries()].map(([dimension, { values, keys }]) => ({
      dimension,
      values,
      keys,
    }));
  }, [filters, activeConnector]);

  // Chips for the Active Filters bar.
  //  • Small selections (≤ FILTER_CHIP_AGG_THRESHOLD values in a dimension) render
  //    as individual, individually-removable tags — deduped by dimension+value.
  //  • Large selections collapse into ONE aggregated chip ("Search Terms (2000)")
  //    whose × clears the entire dimension in a single click. This keeps the bar
  //    compact and performant no matter how many values are selected.
  const activeFilterChips = useMemo(() => {
    const out: {
      key: string;
      label: string;
      value: string;
      aggregated: boolean;
      count: number;
      excluded?: boolean;
    }[] = [];
    const seen = new Set<string>();
    // Exclusions first — the "block with the active filter" the report asked
    // for. One chip per dimension, e.g. "Search Terms excluded (3)"; its × drops
    // the whole exclusion.
    for (const [key, vals] of Object.entries(dimExclude)) {
      const uniq = [...new Set(vals ?? [])];
      if (uniq.length === 0) continue;
      const label = dimLabelFor(activeConnector, key);
      out.push({
        key,
        label,
        value: `${pluralizeDim(label)} excluded (${uniq.length})`,
        aggregated: true,
        count: uniq.length,
        excluded: true,
      });
    }
    for (const [key, vals] of Object.entries(filters)) {
      if (!vals || vals.length === 0) continue;
      const label = dimLabelFor(activeConnector, key);
      // Unique values within this dimension.
      const uniq: string[] = [];
      const localSeen = new Set<string>();
      for (const v of vals) {
        if (!localSeen.has(v)) {
          localSeen.add(v);
          uniq.push(v);
        }
      }

      if (uniq.length > FILTER_CHIP_AGG_THRESHOLD) {
        out.push({
          key,
          label,
          value: `${pluralizeDim(label)} (${uniq.length})`,
          aggregated: true,
          count: uniq.length,
        });
      } else {
        for (const v of uniq) {
          const id = `${label}|${v}`;
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ key, label, value: v, aggregated: false, count: 1 });
        }
      }
    }
    return out;
  }, [filters, dimExclude, activeConnector]);

  // Measure whether the chips fit on one row. A hidden, single-line (no-wrap)
  // mirror of the full bar row is laid out off-screen; if its natural width is
  // wider than the visible bar, the chips would wrap → use the compact layout.
  // Re-measured on resize and whenever the chip set changes.
  useEffect(() => {
    const measure = () => {
      const bar = filtersBarRef.current;
      const probe = filtersMeasureRef.current;
      if (!bar || !probe) return;
      // +1px tolerance for sub-pixel rounding.
      setFiltersFitOneRow(probe.scrollWidth <= bar.clientWidth + 1);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro && filtersBarRef.current) ro.observe(filtersBarRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [activeFilterChips]);

  const aiSelectionChips = useMemo<AiSelectionChip[]>(
    () => activeFilterGroups.map(({ dimension, values }) => ({ dimension, values })),
    [activeFilterGroups],
  );

  const aiMode: "account" | "selection" = aiSelectionChips.length > 0 ? "selection" : "account";

  // Real campaign → channel-type map from the fetched data (falls back to the
  // name heuristic / mock map when the source doesn't provide a type).
  const campaignTypeByName = useMemo(() => {
    const m: Record<string, string> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (realCampaignRows ?? []).forEach((r: any) => {
      if (r?.name) m[r.name] = r.type || "Search";
    });
    return m;
  }, [realCampaignRows]);

  // Single source of truth for a campaign's channel type: the real type from the
  // data, else a name heuristic, else "Search". Used by BOTH the series list and
  // the chart aggregation so they can never disagree (which left the chart empty).
  const typeOfCampaign = useCallback(
    (name: string): string => {
      const real = campaignTypeByName[name] || CAMPAIGN_TYPE_MAP[name];
      if (real) return real;
      const nl = name.toLowerCase();
      return nl.includes("pmax") || nl.includes("performance max")
        ? "PMax"
        : nl.includes("shopping")
          ? "Shopping"
          : nl.includes("display") || nl.includes("retarget")
            ? "Display"
            : nl.includes("video") || nl.includes("youtube")
              ? "Video"
              : nl.includes("demand") || nl.includes("discovery")
                ? "Demand Gen"
                : nl.includes("app")
                  ? "App"
                  : "Search";
    },
    [campaignTypeByName],
  );

  // Channel types present among the chart's campaigns (campaignAvgs) — the stacked
  // series for "by Campaign Type". Derived from the SAME campaigns the chart sums,
  // so it's consistent and non-empty whenever there are campaigns.
  const presentTypes = useMemo(() => {
    const set = new Set<string>();
    campaignAvgs.forEach((c) => {
      if (c.name !== "Others") set.add(typeOfCampaign(c.name));
    });
    if (set.size === 0) Object.values(campaignTypeByName).forEach((t) => set.add(t));
    const ordered = TYPES.filter((t) => set.has(t));
    return ordered.length > 0 ? ordered : ["Search"];
  }, [campaignAvgs, typeOfCampaign, campaignTypeByName]);

  const chartSeries = useMemo(() => {
    if (chartGroupBy === "Campaign Type") {
      return presentTypes.map((name) => ({ name, color: TYPE_COLORS_MAP[name] ?? "#9CA3AF" }));
    }
    return campaignAvgs.map(({ name, color }) => ({ name, color }));
  }, [chartGroupBy, campaignAvgs, presentTypes]);

  const chartBarData = useMemo(() => {
    const activeCampaigns = chartSeries.map((s) => s.name);
    return barData.map((row, i) => {
      const perf = adPerfData[i] || {
        convValue: (row.total as number) || 0,
        cost: 0,
        clicks: 0,
        conv: 0,
        profit: 0,
      };
      const metricTotal =
        chartMetricKey === "cost"
          ? perf.cost
          : chartMetricKey === "clicks"
            ? perf.clicks
            : chartMetricKey === "profit"
              ? Math.max(0, perf.profit)
              : chartMetricKey === "conv"
                ? perf.conv
                : chartMetricKey === "revenue"
                  ? perf.convValue
                  : // Custom metric: the day-level total the fetch already
                    // folded up (averaged rather than summed where the admin
                    // chose Average).
                    ((row._extra as Record<string, number> | undefined)?.[chartMetricKey] ?? 0);

      if (chartGroupBy === "Campaign Type") {
        // Sum EVERY campaign's real metric value by its channel type (metric-aware,
        // reading the raw per-campaign keys — no revenue-based scaling).
        const typeVals: Record<string, number> = {};
        allNames.forEach((c) => {
          const t = typeOfCampaign(c);
          typeVals[t] = (typeVals[t] || 0) + metricValueOf(row, c);
        });
        const obj: Record<string, string | number> = {
          date: row.date as string,
          _iso: (row._iso as string) ?? "",
        };
        presentTypes.forEach((t) => {
          obj[t] = Math.round(typeVals[t] || 0);
        });
        obj.total = Math.round(metricTotal);
        return obj;
      } else {
        // Each visible campaign gets its REAL value for the selected metric; "Others"
        // is the remainder (metric total minus the visible campaigns) so the stack
        // still sums to the account total for that metric.
        const obj: Record<string, string | number> = {
          date: row.date as string,
          _iso: (row._iso as string) ?? "",
        };
        let visSum = 0;
        activeCampaigns.forEach((c) => {
          if (c === "Others") return;
          const v = metricValueOf(row, c);
          obj[c] = Math.round(v);
          visSum += v;
        });
        if (activeCampaigns.includes("Others"))
          obj["Others"] = Math.max(0, Math.round(metricTotal - visSum));
        obj.total = Math.round(metricTotal);
        return obj;
      }
    });
  }, [
    barData,
    adPerfData,
    chartMetricKey,
    chartGroupBy,
    chartSeries,
    allNames,
    metricValueOf,
    typeOfCampaign,
    presentTypes,
  ]);

  // A stable signature of everything that changes the chart's STRUCTURE (metric,
  // group-by, granularity, period, active filters). Used as a remount key so the
  // whole chart fades in as one piece instead of re-growing bar-by-bar ("tetris").
  const chartKey = useMemo(() => {
    const fSig = Object.entries(filters)
      .map(([k, v]) => `${k}:${[...v].sort().join(",")}`)
      .sort()
      .join("|");
    const sSig = Object.entries(dimSearch)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("|");
    return `${chartMetricKey}|${chartGroupBy}|${granularity}|${rangeStart}|${rangeEnd}|${fSig}|${sSig}`;
  }, [chartMetricKey, chartGroupBy, granularity, rangeStart, rangeEnd, filters, dimSearch]);

  const filteredChartSeries = useMemo(() => {
    if (chartGroupBy === "Campaign Type" || chartBarData.length === 0) return chartSeries;
    return chartSeries.filter(
      ({ name }) =>
        // restrict to the campaign scope (Campaign-table filters) when active…
        (campaignScopeNames === null || campaignScopeNames.has(name)) &&
        // …and drop all-zero series for the current metric
        chartBarData.some((row) => ((row[name] as number) || 0) > 0),
    );
  }, [chartSeries, chartBarData, chartGroupBy, campaignScopeNames]);

  // For dimension groupBys, rowTypeFilter (campaign-based) doesn't apply
  const effectiveRowTypeFilter =
    chartGroupBy !== "Campaign" && chartGroupBy !== "Campaign Type" ? null : rowTypeFilter;

  const displayBarData = useMemo(
    () =>
      chartBarData
        .map((row) => ({
          ...row,
          visibleTotal: chartSeries
            .filter(({ name }) => {
              const isHidden = hiddenSeries.has(name);
              const inScope = campaignScopeNames === null || campaignScopeNames.has(name);
              return (
                !isHidden &&
                inScope &&
                (effectiveRowTypeFilter === null || effectiveRowTypeFilter.has(name))
              );
            })
            .reduce((s, { name }) => s + ((row[name] as number) || 0), 0),
        }))
        // Always chronological (left→right). Cross-filter distributed rows can arrive
        // out of order; ISO dates sort lexicographically = by real date. This also
        // satisfies chunkByWeek's assumption that input rows are chronological.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .sort((a, b) => String((a as any)._iso ?? "").localeCompare(String((b as any)._iso ?? ""))),
    [chartBarData, chartSeries, hiddenSeries, effectiveRowTypeFilter, campaignScopeNames],
  );

  // Reindex a DAILY series onto EVERY calendar day of the period, inserting a
  // zero-row for days with no data — so days when everything was paused still appear
  // (empty bar) instead of collapsing the time axis (e.g. Feb 18 → Feb 20).
  const fillDailyGrid = useCallback(
    function <T>(rows: T[], makeZero: (iso: string, label: string) => T): T[] {
      const start = effectiveDateFrom ? Date.parse(`${effectiveDateFrom}T00:00:00Z`) : NaN;
      const end = effectiveDateTo ? Date.parse(`${effectiveDateTo}T00:00:00Z`) : NaN;
      const DAY = 86400000;
      // Guard against pathological ranges (Days over years) → thousands of rows.
      if (isNaN(start) || isNaN(end) || end < start || (end - start) / DAY > 400) return rows;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byIso = new Map(rows.map((r) => [(r as any)._iso as string, r]));
      const out: T[] = [];
      for (let t = start; t <= end; t += DAY) {
        const iso = new Date(t).toISOString().slice(0, 10);
        const existing = byIso.get(iso);
        out.push(
          existing ??
            makeZero(
              iso,
              new Date(t).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              }),
            ),
        );
      }
      return out;
    },
    [effectiveDateFrom, effectiveDateTo],
  );

  const aggregatedBarData = useMemo(() => {
    if (granularity === "days")
      return fillDailyGrid(
        displayBarData,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (iso, label) => ({ date: label, _iso: iso, total: 0, visibleTotal: 0 }) as any,
      );
    const chunks: (typeof displayBarData)[] = [];
    if (granularity === "weeks") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chunks.push(...chunkByWeek(displayBarData, (r) => (r as any)._iso));
    } else {
      // Group months by full year-month bucket (YYYY-MM) — otherwise Jan 2021,
      // Jan 2022, Jan 2023 collapse into a single "Jan" bar.
      const byMon: Record<string, typeof displayBarData> = {};
      displayBarData.forEach((r) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const iso = (r as any)._iso as string | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const key = iso ? iso.slice(0, 7) : (r as any).date.split(" ")[0];
        (byMon[key] ??= []).push(r);
      });
      // Sort buckets chronologically so the chart reads left-to-right.
      Object.keys(byMon)
        .sort()
        .forEach((k) => chunks.push(byMon[k]));
    }
    const MONTH_LABELS = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const seriesKeys =
      chartGroupBy === "Campaign Type" ? presentTypes : chartSeries.map((s) => s.name);
    return chunks.map((chunk) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firstIso = (chunk[0] as any)._iso as string | undefined;
      let label: string;
      if (granularity === "weeks") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        label = `${(chunk[0] as any).date}–${(chunk[chunk.length - 1] as any).date}`;
      } else if (firstIso) {
        const [yy, mm] = firstIso.split("-");
        label = `${MONTH_LABELS[parseInt(mm) - 1]} ${yy}`;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        label = (chunk[0] as any).date.split(" ")[0];
      }
      const agg: Record<string, number | string> = { date: label };
      seriesKeys.forEach((n) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (agg as any)[n] = chunk.reduce((s, r) => s + (((r as any)[n] as number) || 0), 0);
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (agg as any).visibleTotal = chartSeries
        .filter(({ name }) => {
          const isHidden = hiddenSeries.has(name);
          const realType = typeOfCampaign(name);
          return (
            !isHidden &&
            (effectiveRowTypeFilter === null ||
              effectiveRowTypeFilter.has(name) ||
              (realType && effectiveRowTypeFilter.has(realType)))
          );
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .reduce((s, r) => s + (((agg as any)[r.name] as number) || 0), 0);
      return agg as (typeof displayBarData)[0];
    });
  }, [
    displayBarData,
    granularity,
    chartSeries,
    chartGroupBy,
    hiddenSeries,
    effectiveRowTypeFilter,
    presentTypes,
    typeOfCampaign,
    fillDailyGrid,
  ]);

  // Drive the Event Timeline open state from event presence: >0 events → expanded,
  // 0 events → collapsed. Uses the SAME date columns + granularity the Timeline
  // renders, so it matches its visible count. The effect only re-runs when the
  // presence actually flips, so a manual toggle within the same period still sticks.
  const timelineHasEvents = useMemo(
    () =>
      hasVisibleEvents(
        aggregatedBarData.map((d) => String((d as { date: string }).date)),
        timelineEvents,
        granularity,
      ),
    [aggregatedBarData, timelineEvents, granularity],
  );
  useEffect(() => {
    setTimelineOpen(timelineHasEvents);
  }, [timelineHasEvents]);

  const aggregatedAdPerfData = useMemo(() => {
    const data = adPerfData.map((d, di) => {
      const bRow = barData[di] as Record<string, unknown>;
      let convValue = d.convValue;
      let cost = d.cost;
      let profit = d.profit;
      let clicks = d.clicks;

      if (chartScopeNames && bRow) {
        convValue = 0;
        cost = 0;
        clicks = 0;
        chartScopeNames.forEach((name) => {
          convValue += (bRow[name] as number) || 0;
          cost += (bRow[`_cost_${name}`] as number) || 0;
          clicks += (bRow[`_clicks_${name}`] as number) || 0;
        });
        profit = convValue - cost;
      } else if (chartScopeNames && !bRow) {
        convValue = 0;
        cost = 0;
        clicks = 0;
        profit = 0;
      }

      return {
        ...d,
        convValue,
        cost,
        profit,
        clicks,
        costBar: cost,
        profitBar: Math.max(0, profit),
        lossBar: Math.min(0, profit),
        roas: cost > 0 ? convValue / cost : 0,
      };
    });
    // Keep the time axis chronological even when cross-filter rows arrive unsorted.
    data.sort((a, b) => String(a._iso ?? "").localeCompare(String(b._iso ?? "")));
    if (granularity === "days")
      return fillDailyGrid(data, (iso, label) => ({
        date: label,
        _iso: iso,
        convValue: 0,
        cost: 0,
        profit: 0,
        clicks: 0,
        conv: 0,
        roas: 0,
        costBar: 0,
        profitBar: 0,
        lossBar: 0,
      }));
    const chunks: AdPerfItem[][] = [];
    if (granularity === "weeks") {
      chunks.push(...chunkByWeek(data, (r) => r._iso));
    } else {
      const byMon: Record<string, AdPerfItem[]> = {};
      data.forEach((r) => {
        const key = r._iso ? r._iso.slice(0, 7) : r.date.split(" ")[0];
        (byMon[key] ??= []).push(r);
      });
      Object.keys(byMon)
        .sort()
        .forEach((k) => chunks.push(byMon[k]));
    }
    const MONTH_LABELS = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return chunks.map((chunk) => {
      const convValue = chunk.reduce((s, r) => s + r.convValue, 0);
      const cost = chunk.reduce((s, r) => s + r.cost, 0);
      const profit = chunk.reduce((s, r) => s + r.profit, 0);
      const clicks = chunk.reduce((s, r) => s + r.clicks, 0);
      const conv = chunk.reduce((s, r) => s + (r.conv || 0), 0);
      const roas = cost > 0 ? parseFloat((convValue / cost).toFixed(2)) : 0;
      let date: string;
      if (granularity === "weeks") date = `${chunk[0].date}–${chunk[chunk.length - 1].date}`;
      else if (chunk[0]._iso) {
        const [yy, mm] = chunk[0]._iso.split("-");
        date = `${MONTH_LABELS[parseInt(mm) - 1]} ${yy}`;
      } else date = chunk[0].date.split(" ")[0];
      return {
        date,
        convValue,
        cost,
        profit,
        clicks,
        conv,
        roas,
        costBar: cost,
        profitBar: Math.max(0, profit),
        lossBar: Math.min(0, profit),
      };
    });
  }, [adPerfData, granularity, chartScopeNames, barData, fillDailyGrid]);

  // Whether the CURRENT filtered dataset actually has records (any activity) — the
  // same scoped data the KPI cards use. Lets the Trends chart tell "records exist but
  // this metric is all-zero" (→ metric-specific message) apart from "no records at
  // all" (→ No data available).
  const chartHasRecords = useMemo(
    () =>
      aggregatedAdPerfData.some(
        (d) =>
          (d.cost || 0) > 0 || (d.clicks || 0) > 0 || (d.conv || 0) > 0 || (d.convValue || 0) > 0,
      ),
    [aggregatedAdPerfData],
  );

  const aggregatedPlData = useMemo(() => {
    const rawData = crossFilterData ?? realBarData;
    const data = plData.map((d, i) => {
      let dailyProfit = d.dailyProfit;
      if (chartScopeNames) {
        const bRow = rawData ? (rawData[i] as Record<string, unknown>) : null;
        if (bRow) {
          let cv = 0,
            ct = 0;
          chartScopeNames.forEach((name) => {
            cv += (bRow[name] as number) || 0;
            ct += (bRow[`_cost_${name}`] as number) || 0;
          });
          dailyProfit = cv - ct;
        } else {
          dailyProfit = 0;
        }
      }
      return { ...d, dailyProfit };
    });
    // Chronological order so the cumulative P/L line builds left→right correctly.
    data.sort((a, b) => String(a._iso ?? "").localeCompare(String(b._iso ?? "")));
    if (granularity === "days") {
      const full = fillDailyGrid(data, (iso, label) => ({
        date: label,
        _iso: iso,
        dailyProfit: 0,
        cumulative: 0,
      }));
      let c = 0;
      return full.map((d) => {
        c += d.dailyProfit;
        return { ...d, cumulative: c };
      });
    }
    const chunks: PlItem[][] = [];
    if (granularity === "weeks") {
      chunks.push(...chunkByWeek(data, (r) => r._iso));
    } else {
      const byMon: Record<string, PlItem[]> = {};
      data.forEach((r) => {
        const key = r._iso ? r._iso.slice(0, 7) : r.date.split(" ")[0];
        (byMon[key] ??= []).push(r);
      });
      Object.keys(byMon)
        .sort()
        .forEach((k) => chunks.push(byMon[k]));
    }
    const MONTH_LABELS = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    let cum = 0;
    return chunks.map((chunk) => {
      const dailyProfit = chunk.reduce((s, r) => s + r.dailyProfit, 0);
      cum += dailyProfit;
      let date: string;
      if (granularity === "weeks") date = `${chunk[0].date}–${chunk[chunk.length - 1].date}`;
      else if (chunk[0]._iso) {
        const [yy, mm] = chunk[0]._iso.split("-");
        date = `${MONTH_LABELS[parseInt(mm) - 1]} ${yy}`;
      } else date = chunk[0].date.split(" ")[0];
      return { date, dailyProfit, cumulative: cum };
    });
  }, [plData, granularity, chartScopeNames, crossFilterData, realBarData, fillDailyGrid]);

  const renderConvLabel = useMemo(
    () => makeRenderConvLabel(aggregatedAdPerfData, hiddenAdPerf.has("conv")),
    [aggregatedAdPerfData, hiddenAdPerf],
  );
  const renderLossTopLabel = useMemo(
    () => makeRenderLossTopLabel(aggregatedAdPerfData, hiddenAdPerf.has("conv")),
    [aggregatedAdPerfData, hiddenAdPerf],
  );
  const renderTotalLabelChart = useMemo(
    () => makeRenderTotalLabel(chartMetricIsMoney),
    [chartMetricIsMoney],
  );

  const dynKpis = useMemo(() => {
    // Scope = explicitly selected rows, or the Campaign-table filtered set when a
    // campaign-level filter (type / status / ROAS / search / dropdown) is active.
    const scopeRows =
      selectedRows.length > 0 ? selectedRows : campaignFilterActive ? filtered : null;
    if (!scopeRows || scopeRows.length === 0) return null;
    const selClicks = scopeRows.reduce((s, r) => s + r.clicks, 0);
    const selConv = scopeRows.reduce((s, r) => s + r.conv, 0);
    // selCost / selRev / selProfit are already in $K units (rows store spend / 1000).
    // Multiply back to raw dollars before formatting so the $ / K logic matches realKpis.
    const selCostRaw = scopeRows.reduce((s, r) => s + r.cost, 0) * 1000;
    const selRevRaw = scopeRows.reduce((s, r) => s + r.revenue, 0) * 1000;
    const selProfitRaw = scopeRows.reduce((s, r) => s + r.profit, 0) * 1000;
    const convRate = selClicks > 0 ? (selConv / selClicks) * 100 : 0;
    const cpa = selConv > 0 ? selCostRaw / selConv : 0;
    const roas = selCostRaw > 0 ? selRevRaw / selCostRaw : 0;
    const fmtCount = (v: number) =>
      v >= 1_000_000
        ? `${(v / 1_000_000).toFixed(2)}M`
        : v >= 1000
          ? `${(v / 1000).toFixed(2)}K`
          : String(Math.round(v));
    const fmtMoney = (v: number) =>
      v >= 1_000_000
        ? `$${(v / 1_000_000).toFixed(2)}M`
        : v >= 1000
          ? `$${(v / 1000).toFixed(2)}K`
          : `$${v.toFixed(2)}`;
    const fmtProfit = (v: number) => (v >= 0 ? fmtMoney(v) : `-${fmtMoney(Math.abs(v))}`);

    // Period-over-period delta — split the date range in half and compare second
    // half vs first half for ONLY the selected campaigns (so trend reflects the
    // selection, not the whole account). Mirrors realKpis trend logic.
    const selNames = new Set(scopeRows.map((r) => r.name));
    const series = (realBarData ?? []).map((d) => {
      let clk = 0,
        cnv = 0,
        cost = 0,
        rev = 0;
      for (const name of selNames) {
        clk += (d[`_clicks_${name}`] as number) || 0;
        cnv += (d[`_conv_${name}`] as number) || 0;
        cost += (d[`_cost_${name}`] as number) || 0;
        rev += (d[name] as number) || 0;
      }
      return { clk, cnv, cost, rev, profit: rev - cost };
    });
    const half = Math.max(1, Math.floor(series.length / 2));
    const sumF = (k: "clk" | "cnv" | "cost" | "rev" | "profit") =>
      series.slice(0, half).reduce((s, d) => s + d[k], 0);
    const sumS = (k: "clk" | "cnv" | "cost" | "rev" | "profit") =>
      series.slice(half).reduce((s, d) => s + d[k], 0);
    const trend = (k: "clk" | "cnv" | "cost" | "rev" | "profit") => {
      const f = sumF(k);
      const s = sumS(k);
      const pct = f !== 0 ? ((s - f) / Math.abs(f)) * 100 : 0;
      return { delta: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, up: s >= f };
    };
    const cvrTrend = (() => {
      const fClk = sumF("clk"),
        fCnv = sumF("cnv"),
        sClk = sumS("clk"),
        sCnv = sumS("cnv");
      const r1 = fClk > 0 ? (fCnv / fClk) * 100 : 0;
      const r2 = sClk > 0 ? (sCnv / sClk) * 100 : 0;
      const pct = r1 > 0 ? ((r2 - r1) / r1) * 100 : 0;
      return { delta: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, up: r2 >= r1 };
    })();
    const cpaTrend = (() => {
      const fCost = sumF("cost"),
        fCnv = sumF("cnv"),
        sCost = sumS("cost"),
        sCnv = sumS("cnv");
      const c1 = fCnv > 0 ? fCost / fCnv : 0;
      const c2 = sCnv > 0 ? sCost / sCnv : 0;
      const pct = c1 > 0 ? ((c2 - c1) / c1) * 100 : 0;
      return { delta: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, up: c2 <= c1 };
    })();
    const roasTrend = (() => {
      const fCost = sumF("cost"),
        fRev = sumF("rev"),
        sCost = sumS("cost"),
        sRev = sumS("rev");
      const r1 = fCost > 0 ? fRev / fCost : 0;
      const r2 = sCost > 0 ? sRev / sCost : 0;
      const pct = r1 > 0 ? ((r2 - r1) / r1) * 100 : 0;
      return { delta: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, up: r2 >= r1 };
    })();
    // Average order value — the cost-free sources' headline efficiency metric.
    const aov = selConv > 0 ? selRevRaw / selConv : 0;
    const aovTrend = (() => {
      const fRev = sumF("rev"),
        fCnv = sumF("cnv"),
        sRev = sumS("rev"),
        sCnv = sumS("cnv");
      const a1 = fCnv > 0 ? fRev / fCnv : 0;
      const a2 = sCnv > 0 ? sRev / sCnv : 0;
      const pct = a1 > 0 ? ((a2 - a1) / a1) * 100 : 0;
      return { delta: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, up: a2 >= a1 };
    })();
    // Sparkline for the SELECTED scope, bucketed by the SAME granularity the
    // chart and the account KPI cards use — not always per-day. Selecting a row
    // in the primary table used to force the cards to a daily sparkline while
    // the chart stayed on Weeks/Months; grouping here keeps them in step.
    //
    // Fill the calendar the way the main chart does (fillDailyGrid) so a day
    // with no clicks shows a 0 point on the same timeline instead of vanishing.
    // Only the sparkline uses the filled rows — the trend split above stays on
    // the raw `series`, so filling can't shift its first-half/second-half
    // boundary. Days granularity fills; weeks/months chunk raw, as the chart does.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rb: any[] =
      granularity === "days"
        ? fillDailyGrid(realBarData ?? [], (iso, label) => ({ _iso: iso, date: label }))
        : (realBarData ?? []);
    // Canonical + custom series re-derived over the FILLED rows, index-aligned
    // with `rb` so the groups below sum the right buckets.
    const sparkSeries = rb.map((d) => {
      let clk = 0,
        cnv = 0,
        cost = 0,
        rev = 0;
      for (const name of selNames) {
        clk += (d[`_clicks_${name}`] as number) || 0;
        cnv += (d[`_conv_${name}`] as number) || 0;
        cost += (d[`_cost_${name}`] as number) || 0;
        rev += (d[name] as number) || 0;
      }
      return { clk, cnv, cost, rev, profit: rev - cost };
    });
    const groups: number[][] = [];
    if (granularity === "days") {
      rb.forEach((_, i) => groups.push([i]));
    } else if (granularity === "weeks") {
      for (let i = 0; i < rb.length; i += 7)
        groups.push(Array.from({ length: Math.min(7, rb.length - i) }, (_, j) => i + j));
    } else {
      const byMon: Record<string, number[]> = {};
      rb.forEach((d, i) => {
        const key = d?._iso ? String(d._iso).slice(0, 7) : String(d?.date ?? "").split(" ")[0];
        (byMon[key] ??= []).push(i);
      });
      Object.keys(byMon)
        .sort()
        .forEach((k) => groups.push(byMon[k]));
    }
    const groupDate = (idxs: number[]) =>
      granularity === "weeks"
        ? `${rb[idxs[0]]?.date}–${rb[idxs[idxs.length - 1]]?.date}`
        : String(rb[idxs[0]]?.date ?? "");
    const spk = (getV: (d: (typeof sparkSeries)[number]) => number) =>
      groups.map((idxs) => {
        const b = idxs.reduce(
          (a, i) => ({
            clk: a.clk + sparkSeries[i].clk,
            cnv: a.cnv + sparkSeries[i].cnv,
            cost: a.cost + sparkSeries[i].cost,
            rev: a.rev + sparkSeries[i].rev,
            profit: a.profit + sparkSeries[i].profit,
          }),
          { clk: 0, cnv: 0, cost: 0, rev: 0, profit: 0 },
        );
        return { v: getV(b), date: groupDate(idxs) };
      });

    // Admin-registered custom metrics, scoped to the same selected campaigns —
    // mirrors the canonical cards above but reads `_extra_<key>_<name>`
    // columns (see the realBarData/crossFilterData builders) instead of a
    // hardcoded field.
    // Raw (for the trend split) and filled (for the sparkline) — same split as
    // the canonical metrics above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customSumRow = (d: any): Record<string, number> => {
      const sums: Record<string, number> = {};
      for (const name of selNames) {
        for (const b of customKpiBases) {
          sums[b.slot] = (sums[b.slot] || 0) + ((d[`_extra_${b.slot}_${name}`] as number) || 0);
        }
      }
      return sums;
    };
    const customSeries = (realBarData ?? []).map(customSumRow);
    const customSparkSeries = rb.map(customSumRow);
    const customHalf = Math.max(1, Math.floor(customSeries.length / 2));
    const customEntries = customKpiBases.map((b) => {
      const rowsWithSel = scopeRows.length;
      const totalSum = scopeRows.reduce((s, r) => s + ((r.extra?.[b.slot] as number) || 0), 0);
      const total = b.isAverage && rowsWithSel > 0 ? totalSum / rowsWithSel : totalSum;
      const f = customSeries.slice(0, customHalf).reduce((s, d) => s + (d[b.slot] || 0), 0);
      const sNum = customSeries.slice(customHalf).reduce((s, d) => s + (d[b.slot] || 0), 0);
      const pct = f !== 0 ? ((sNum - f) / Math.abs(f)) * 100 : 0;
      return {
        value: formatCustomMetricValue(total, b.format),
        raw: total,
        delta: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
        up: sNum >= f,
        spark: groups.map((idxs) => ({
          v: idxs.reduce((s, i) => s + (customSparkSeries[i]?.[b.slot] || 0), 0),
          date: groupDate(idxs),
        })),
      };
    });

    return [
      { value: fmtCount(selClicks), raw: selClicks, ...trend("clk"), spark: spk((d) => d.clk) },
      {
        value: `${convRate.toFixed(2)}%`,
        raw: convRate,
        ...cvrTrend,
        spark: spk((d) => (d.clk > 0 ? (d.cnv / d.clk) * 100 : 0)),
      },
      { value: fmtCount(selConv), raw: selConv, ...trend("cnv"), spark: spk((d) => d.cnv) },
      {
        value: `$${cpa.toFixed(2)}`,
        raw: cpa,
        ...cpaTrend,
        spark: spk((d) => (d.cnv > 0 ? d.cost / d.cnv : 0)),
      },
      { value: fmtMoney(selCostRaw), raw: selCostRaw, ...trend("cost"), spark: spk((d) => d.cost) },
      { value: fmtMoney(selRevRaw), raw: selRevRaw, ...trend("rev"), spark: spk((d) => d.rev) },
      {
        value: `${roas.toFixed(2)}x`,
        raw: roas,
        ...roasTrend,
        spark: spk((d) => (d.cost > 0 ? d.rev / d.cost : 0)),
      },
      {
        value: fmtProfit(selProfitRaw),
        raw: selProfitRaw,
        ...trend("profit"),
        spark: spk((d) => d.profit),
      },
      {
        value: `$${aov.toFixed(2)}`,
        raw: aov,
        ...aovTrend,
        spark: spk((d) => (d.cnv > 0 ? d.rev / d.cnv : 0)),
      },
      ...customEntries,
    ];
  }, [
    selectedRows,
    realBarData,
    campaignFilterActive,
    filtered,
    customKpiBases,
    granularity,
    fillDailyGrid,
  ]);

  const realKpis = useMemo(() => {
    if (!windsorConnected) return null;
    const effectiveBarData = crossFilterData ?? timeFilteredBarData;
    if (!realCampaignRows || !effectiveBarData || effectiveBarData.length === 0) {
      return [...kpis, ...customKpiBases].map((k) => ({
        value: "—",
        delta: "—",
        up: true,
        spark: [] as { v: number; date: string }[],
        hoverFmt: k.hoverFmt,
      }));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (d: any, key: string): number => (d[key] as number) || 0;
    // Admin-registered custom metrics live under `d.extra[key]` (see the
    // realBarData/crossFilterData builders), not as a top-level field.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ge = (d: any, key: string): number => (d._extra?.[key] as number) || 0;

    // The sparklines must run on the SAME calendar as the main chart — every day
    // in range, zeros included — or a day with no clicks silently vanishes and
    // the card's timeline drifts out of step with the graph below it. The raw
    // rows only carry days that had data, so fill the grid the way the main
    // chart does (fillDailyGrid). Totals/trend below stay on the raw rows: zero
    // days add nothing to a sum, and filling them would shift the trend's
    // first-half/second-half split.
    const sparkBarData =
      granularity === "days"
        ? fillDailyGrid(
            effectiveBarData,
            (iso, label) =>
              ({
                _iso: iso,
                date: label,
                clicks: 0,
                conv: 0,
                total: 0,
                cost: 0,
                profit: 0,
                _extra: {},
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              }) as any,
          )
        : effectiveBarData;

    const totClicks = effectiveBarData.reduce((s: number, d) => s + g(d, "clicks"), 0);
    const totConv = effectiveBarData.reduce((s: number, d) => s + g(d, "conv"), 0);
    const totRev = effectiveBarData.reduce((s: number, d) => s + g(d, "total"), 0);
    const totCost = effectiveBarData.reduce((s: number, d) => s + g(d, "cost"), 0);
    const totProfit = effectiveBarData.reduce((s: number, d) => s + g(d, "profit"), 0);
    const convRate = totClicks > 0 ? (totConv / totClicks) * 100 : 0;
    const cpa = totConv > 0 ? totCost / totConv : 0;
    const roas = totCost > 0 ? totRev / totCost : 0;
    const aov = totConv > 0 ? totRev / totConv : 0;

    const fmtN = (v: number) =>
      v >= 1_000_000
        ? `${(v / 1_000_000).toFixed(2)}M`
        : v >= 1000
          ? `${(v / 1000).toFixed(2)}K`
          : String(Math.round(v));
    const fmtD = (v: number) =>
      v >= 1_000_000
        ? `$${(v / 1_000_000).toFixed(2)}M`
        : v >= 1000
          ? `$${(v / 1000).toFixed(2)}K`
          : `$${v.toFixed(2)}`;

    const half = Math.max(1, Math.floor(effectiveBarData.length / 2));

    const trend = (key: string) => {
      const f = effectiveBarData.slice(0, half).reduce((s, d) => s + g(d, key), 0);
      const s = effectiveBarData.slice(half).reduce((s, d) => s + g(d, key), 0);
      const pct = f > 0 ? ((s - f) / f) * 100 : 0;
      return { delta: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, up: s >= f };
    };

    const cvrTrend = (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fClk = effectiveBarData.slice(0, half).reduce((s, d: any) => s + g(d, "clicks"), 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fCnv = effectiveBarData.slice(0, half).reduce((s, d: any) => s + g(d, "conv"), 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sClk = effectiveBarData.slice(half).reduce((s, d: any) => s + g(d, "clicks"), 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sCnv = effectiveBarData.slice(half).reduce((s, d: any) => s + g(d, "conv"), 0);
      const r1 = fClk > 0 ? (fCnv / fClk) * 100 : 0;
      const r2 = sClk > 0 ? (sCnv / sClk) * 100 : 0;
      const pct = r1 > 0 ? ((r2 - r1) / r1) * 100 : 0;
      return { delta: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, up: r2 >= r1 };
    })();

    const cpaTrend = (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fCost = effectiveBarData.slice(0, half).reduce((s, d: any) => s + g(d, "cost"), 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fCnv = effectiveBarData.slice(0, half).reduce((s, d: any) => s + g(d, "conv"), 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sCost = effectiveBarData.slice(half).reduce((s, d: any) => s + g(d, "cost"), 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sCnv = effectiveBarData.slice(half).reduce((s, d: any) => s + g(d, "conv"), 0);
      const c1 = fCnv > 0 ? fCost / fCnv : 0;
      const c2 = sCnv > 0 ? sCost / sCnv : 0;
      const pct = c1 > 0 ? ((c2 - c1) / c1) * 100 : 0;
      return { delta: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, up: c2 <= c1 };
    })();

    const roasTrend = (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fCost = effectiveBarData.slice(0, half).reduce((s, d: any) => s + g(d, "cost"), 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fRev = effectiveBarData.slice(0, half).reduce((s, d: any) => s + g(d, "total"), 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sCost = effectiveBarData.slice(half).reduce((s, d: any) => s + g(d, "cost"), 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sRev = effectiveBarData.slice(half).reduce((s, d: any) => s + g(d, "total"), 0);
      const r1 = fCost > 0 ? fRev / fCost : 0;
      const r2 = sCost > 0 ? sRev / sCost : 0;
      const pct = r1 > 0 ? ((r2 - r1) / r1) * 100 : 0;
      return { delta: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, up: r2 >= r1 };
    })();

    const aovTrend = (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fRev = effectiveBarData.slice(0, half).reduce((s, d: any) => s + g(d, "total"), 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fCnv = effectiveBarData.slice(0, half).reduce((s, d: any) => s + g(d, "conv"), 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sRev = effectiveBarData.slice(half).reduce((s, d: any) => s + g(d, "total"), 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sCnv = effectiveBarData.slice(half).reduce((s, d: any) => s + g(d, "conv"), 0);
      const a1 = fCnv > 0 ? fRev / fCnv : 0;
      const a2 = sCnv > 0 ? sRev / sCnv : 0;
      const pct = a1 > 0 ? ((a2 - a1) / a1) * 100 : 0;
      return { delta: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, up: a2 >= a1 };
    })();

    // Grouped data for sparklines based on granularity
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chunks: any[][] = [];
    if (granularity === "days") {
      // no grouping needed
    } else if (granularity === "weeks") {
      for (let i = 0; i < effectiveBarData.length; i += 7) {
        chunks.push(effectiveBarData.slice(i, i + 7));
      }
    } else {
      const byMon: Record<string, (typeof effectiveBarData)[number][]> = {};
      effectiveBarData.forEach((r) => {
        const key = r._iso ? r._iso.slice(0, 7) : r.date.split(" ")[0];
        (byMon[key] ??= []).push(r);
      });
      Object.keys(byMon)
        .sort()
        .forEach((k) => chunks.push(byMon[k]));
    }
    const MONTH_LABELS = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const sparkData =
      granularity === "days"
        ? sparkBarData
        : chunks.map((chunk) => {
            const clicks = chunk.reduce((s, d) => s + g(d, "clicks"), 0);
            const conv = chunk.reduce((s, d) => s + g(d, "conv"), 0);
            const total = chunk.reduce((s, d) => s + g(d, "total"), 0);
            const cost = chunk.reduce((s, d) => s + g(d, "cost"), 0);
            const profit = chunk.reduce((s, d) => s + g(d, "profit"), 0);
            const _extra: Record<string, number> = {};
            for (const b of customKpiBases) {
              const vals = chunk.map((d) => ge(d, b.slot));
              const sum = vals.reduce((s, v) => s + v, 0);
              _extra[b.slot] = b.isAverage ? sum / (vals.length || 1) : sum;
            }

            let date: string;
            if (granularity === "weeks") {
              date = `${chunk[0].date}–${chunk[chunk.length - 1].date}`;
            } else if (chunk[0]._iso) {
              const [yy, mm] = chunk[0]._iso.split("-");
              date = `${MONTH_LABELS[parseInt(mm) - 1]} ${yy}`;
            } else {
              date = chunk[0].date.split(" ")[0];
            }

            return {
              date,
              clicks,
              conv,
              total,
              cost,
              profit,
              cvr: clicks > 0 ? (conv / clicks) * 100 : 0,
              cpa: conv > 0 ? cost / conv : 0,
              roas: cost > 0 ? total / cost : 0,
              aov: conv > 0 ? total / conv : 0,
              _extra,
            };
          });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sp = (getV: (d: any) => number) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sparkData.map((d: any) => ({ v: getV(d), date: d.date as string }));

    const absProfit = Math.abs(totProfit);
    const profitFmt =
      totProfit >= 0
        ? fmtD(totProfit)
        : `-$${absProfit >= 1_000_000 ? `${(absProfit / 1_000_000).toFixed(2)}M` : absProfit >= 1000 ? `${(absProfit / 1000).toFixed(2)}K` : absProfit.toFixed(2)}`;
    const fmtDv = (v: number) => fmtD(Math.abs(v));

    // Admin-registered custom metrics (raw Windsor fields, no canonical
    // formula) — same total/trend/sparkline treatment as the canonical cards
    // above, just reading `extra[key]` instead of a hardcoded field.
    const customEntries = customKpiBases.map((b) => {
      const vals = effectiveBarData.map((d) => ge(d, b.slot));
      const sum = vals.reduce((s, v) => s + v, 0);
      const total = b.isAverage ? sum / (vals.length || 1) : sum;
      const fVals = effectiveBarData.slice(0, half).map((d) => ge(d, b.slot));
      const sVals = effectiveBarData.slice(half).map((d) => ge(d, b.slot));
      const fSum = fVals.reduce((s, v) => s + v, 0);
      const sSum = sVals.reduce((s, v) => s + v, 0);
      const fVal = b.isAverage ? fSum / (fVals.length || 1) : fSum;
      const sVal = b.isAverage ? sSum / (sVals.length || 1) : sSum;
      const pct = fVal > 0 ? ((sVal - fVal) / fVal) * 100 : 0;
      return {
        value: formatCustomMetricValue(total, b.format),
        raw: total,
        delta: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
        up: sVal >= fVal,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        spark: sp((d: any) => (d._extra ? (d._extra[b.slot] as number) || 0 : 0)),
        hoverFmt: (v: number) => formatCustomMetricValue(v, b.format),
      };
    });

    return [
      {
        value: fmtN(totClicks),
        raw: totClicks,
        ...trend("clicks"),
        spark: sp((d) => (granularity === "days" ? g(d, "clicks") : d.clicks)),
        hoverFmt: (v: number) => `${Math.round(v)}`,
      },
      {
        value: `${convRate.toFixed(2)}%`,
        raw: convRate,
        ...cvrTrend,
        spark: sp((d) =>
          granularity === "days"
            ? g(d, "clicks") > 0
              ? (g(d, "conv") / g(d, "clicks")) * 100
              : 0
            : d.cvr,
        ),
        hoverFmt: (v: number) => `${v.toFixed(2)}%`,
      },
      {
        value: fmtN(totConv),
        raw: totConv,
        ...trend("conv"),
        spark: sp((d) => (granularity === "days" ? g(d, "conv") : d.conv)),
        hoverFmt: (v: number) => `${Math.round(v)}`,
      },
      {
        value: `$${cpa.toFixed(2)}`,
        raw: cpa,
        ...cpaTrend,
        spark: sp((d) =>
          granularity === "days" ? (g(d, "conv") > 0 ? g(d, "cost") / g(d, "conv") : 0) : d.cpa,
        ),
        hoverFmt: (v: number) => `$${v.toFixed(2)}`,
      },
      {
        value: fmtD(totCost),
        raw: totCost,
        ...trend("cost"),
        spark: sp((d) => (granularity === "days" ? g(d, "cost") : d.cost)),
        hoverFmt: fmtDv,
      },
      {
        value: fmtD(totRev),
        raw: totRev,
        ...trend("total"),
        spark: sp((d) => (granularity === "days" ? g(d, "total") : d.total)),
        hoverFmt: fmtDv,
      },
      {
        value: `${roas.toFixed(2)}x`,
        raw: roas,
        ...roasTrend,
        spark: sp((d) =>
          granularity === "days" ? (g(d, "cost") > 0 ? g(d, "total") / g(d, "cost") : 0) : d.roas,
        ),
        hoverFmt: (v: number) => `${v.toFixed(2)}x`,
      },
      {
        value: profitFmt,
        raw: totProfit,
        ...trend("profit"),
        spark: sp((d) => (granularity === "days" ? g(d, "profit") : d.profit)),
        hoverFmt: (v: number) => (v >= 0 ? fmtD(v) : `-${fmtDv(v)}`),
      },
      {
        value: `$${aov.toFixed(2)}`,
        raw: aov,
        ...aovTrend,
        spark: sp((d) =>
          granularity === "days" ? (g(d, "conv") > 0 ? g(d, "total") / g(d, "conv") : 0) : d.aov,
        ),
        hoverFmt: (v: number) => `$${v.toFixed(2)}`,
      },
      ...customEntries,
    ];
  }, [
    realCampaignRows,
    realBarData,
    crossFilterData,
    windsorConnected,
    timeFilteredBarData,
    granularity,
    customKpiBases,
    fillDailyGrid,
  ]);

  // Cross-filter: fetch Windsor data filtered by Extended Analytics selection
  useEffect(() => {
    // Dims that don't support the date,{dim} group_by combination (or for which
    // cross-filtering makes no sense, because they ARE the pivot everything is
    // already attributed through).
    const NON_CROSS_DIMS = new Set([
      // The connector's own primary entity — campaign for Ads, channel for
      // GA4, product for Shopify, whatever an admin-added source declares.
      primaryDim,
      // The primary table pushes its selection under these two fixed store
      // keys regardless of connector (see CampaignTable), so they're excluded
      // for every source, not just Google Ads.
      "campaign_name",
      "campaign_selected",
      "date", // "date,date" doesn't exist in Windsor
      // Time buckets are pure range filters resolved by getTimeFilterRange →
      // timeFilteredBarData. They must NOT trigger a "date,<bucket>" Windsor
      // cross-fetch (that returned no matching rows → charts went "No data").
      "week",
      "month",
      "quarter",
      "year",
    ]);

    // Special case: "date" dimension selected in Time Performance → filter
    // realBarData to those specific dates so the chart reflects the selection.
    // Other tables are not cross-filtered (they fall back to normal fetches).
    const dateFilter = filters["date"] ?? [];
    if (dateFilter.length > 0 && windsorConnected && realBarData) {
      // date values from the table are ISO strings like "2026-06-01";
      // realBarData rows carry _iso in that same format.
      const isoSet = new Set(dateFilter);
      const filtered = realBarData.filter((r: Record<string, unknown>) =>
        isoSet.has(r._iso as string),
      );
      if (filtered.length > 0) {
        setCrossFilterData(filtered);
      } else {
        setCrossFilterData(null);
      }
      setCrossFilterCampaigns(null);
      setCrossFilterAdGroups(null);
      setCrossFilterKeywords(null);
      setCrossFilterMatchTypes(null);
      setCrossFilterCampaignRows(null);
      setCrossFilterRowsByDim({});
      setCrossFilterLoading(false);
      return;
    }
    const inclEntries = Object.entries(filters).filter(
      ([k, v]) => !NON_CROSS_DIMS.has(k) && v.length > 0,
    );
    const exclEntries = Object.entries(dimExclude).filter(
      ([k, v]) => !NON_CROSS_DIMS.has(k) && v.length > 0,
    );
    // Exclude mode: rows unticked from a dropdown, with no active include. The
    // server drops them (filter_exclude) and returns everything that is LEFT,
    // which we push through the SAME distribution the include path uses — so
    // KPIs, charts and the other tables all reflect "everything except", for any
    // number of exclusions (they ride in a POST body, past any URL limit).
    const excludeMode = inclEntries.length === 0 && exclEntries.length > 0;
    const activeEntry = inclEntries[0] ?? (excludeMode ? exclEntries[0] : undefined);
    if (!windsorConnected || !activeEntry) {
      setCrossFilterData(null);
      setCrossFilterCampaigns(null);
      setCrossFilterAdGroups(null);
      setCrossFilterKeywords(null);
      setCrossFilterMatchTypes(null);
      setCrossFilterCampaignRows(null);
      setCrossFilterRowsByDim({});
      setCrossFilterLoading(false);
      return;
    }
    setCrossFilterLoading(true);
    // Same race as the main fetch: this chain does several awaits, and a reply
    // for the source the user just left must not repaint the tables.
    let cancelled = false;
    const [dim, values] = activeEntry;
    // O(1) membership for the matched-rows filter below — `values` can be large
    // (e.g. a "contains" filter resolving to thousands of search terms), and an
    // includes() per row would be O(n·m) and freeze the tab.
    const valueSet = new Set(values);
    const groupBy = `date,${dim}`;
    const dateFrom = new Date(rangeStart).toISOString().split("T")[0];
    const dateTo = new Date(rangeEnd).toISOString().split("T")[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uniq = (arr: any[]): string[] => [
      ...new Set<string>(
        arr.filter((c: unknown): c is string => typeof c === "string" && c.length > 0),
      ),
    ];
    // Safe json parse — avoids the Safari "string did not match the expected
    // pattern" error when the server returns HTML instead of JSON.
    const safeJson = async (res: Response): Promise<unknown> => {
      if (!res.ok) return null;
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    };
    // The join key every dimension is attributed through — this connector's
    // OWN primary entity (campaign for Ads, channel for GA4, product for
    // Shopify). /api/windsor resolves it per row into `pivot`, since the raw
    // field it comes from (default_channel_group, product_title…) doesn't
    // survive that route's row mapping. The fallbacks cover rows from other
    // shapes (BigQuery) that predate the `pivot` field.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pivotOf = (row: any): string =>
      (row?.pivot as string) || readDimensionValue(activeConnector, primaryDim, row);

    // Campaign-level constraint active in parallel (campaign dropdown or row
    // selection). When present, the cross-filter is the INTERSECTION: e.g.
    // Device=Mobile AND Campaign=X → only X's mobile rows. campaignConstraint
    // null means no campaign restriction.
    const campaignConstraintArr = [
      ...(filters["campaign_name"] ?? []),
      ...(filters["campaign_selected"] ?? []),
    ];
    const campaignConstraint =
      campaignConstraintArr.length > 0 ? new Set(campaignConstraintArr) : null;

    // Scope the date,<dim> cross-fetch on the SERVER so high-cardinality dims
    // (search_term, keyword) don't return the whole set (tens of thousands of rows
    // × dates). Use the contains term when one drives the table; otherwise pass the
    // explicit values when the set is small enough for a URL.
    let crossUrl = `${rowsApiBase()}?date_from=${dateFrom}&date_to=${dateTo}&group_by=${encodeURIComponent(groupBy)}${connectorQS}${viewAsQS}`;
    const dimSearchTerm = dimSearch[dim];
    // In exclude mode `values` ARE the exclusions — POST them in the body (there
    // can be thousands) and the server returns every row EXCEPT them. Otherwise
    // scope the include set on the server the usual way.
    let crossRequest: Promise<Response>;
    if (excludeMode) {
      crossRequest = fetch(crossUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter_exclude: values }),
      });
    } else {
      if (dimSearchTerm) crossUrl += `&search=${encodeURIComponent(dimSearchTerm)}`;
      else if (values.length > 0 && values.length <= 150)
        values.forEach((v) => {
          crossUrl += `&filter_self=${encodeURIComponent(v)}`;
        });
      crossRequest = fetch(crossUrl);
    }

    crossRequest
      .then(safeJson)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(async (json: any) => {
        if (cancelled) return;
        if (!json.data) {
          setCrossFilterData(null);
          setCrossFilterCampaigns(null);
          setCrossFilterAdGroups(null);
          setCrossFilterKeywords(null);
          setCrossFilterMatchTypes(null);
          setCrossFilterCampaignRows(null);
          setCrossFilterRowsByDim({});
          return;
        }
        const matched = json.data.filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (row: any) =>
            // Exclude mode: the server already dropped the excluded rows, so
            // everything it returned is kept — no per-value membership test.
            (excludeMode || valueSet.has(row.dimension)) &&
            (!campaignConstraint || campaignConstraint.has(pivotOf(row))),
        );

        // Extract every dimension level present in the matched rows — propagate cross-filter
        // up the hierarchy so all higher-level tables get filtered to only relevant items.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const campNames = uniq(matched.map((r: any) => pivotOf(r)));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kwNames = uniq(matched.map((r: any) => r.keyword_text));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mtNames = uniq(matched.map((r: any) => r.match_type));
        setCrossFilterCampaigns(dim !== primaryDim && campNames.length > 0 ? campNames : null);

        // Build per-campaign aggregated rows from matched data so Campaign Performance
        // table shows metrics ONLY for the selected dimension (e.g. specific search term),
        // not the full campaign totals.
        if (dim !== primaryDim && campNames.length > 0) {
          const campAggConnectorDef = getConnector(activeConnector);
          const campAggCustomKeys = Object.keys(campAggConnectorDef.customMetricFields ?? {});
          const campAggAvgKeys = new Set(
            campAggCustomKeys.filter((k) => isAveragedMetric(activeConnector, k)),
          );
          const campAgg = new Map<
            string,
            {
              clicks: number;
              impr: number;
              spend: number;
              convs: number;
              convVal: number;
              extra: Record<string, number>;
              extraCount: number;
            }
          >();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const row of matched as any[]) {
            const camp = pivotOf(row);
            const cur = campAgg.get(camp) ?? {
              clicks: 0,
              impr: 0,
              spend: 0,
              convs: 0,
              convVal: 0,
              extra: {},
              extraCount: 0,
            };
            const nextExtra = { ...cur.extra };
            for (const k of campAggCustomKeys) {
              nextExtra[k] = (nextExtra[k] || 0) + (Number(row.extra?.[k]) || 0);
            }
            campAgg.set(camp, {
              clicks: cur.clicks + (Number(row.clicks) || 0),
              impr: cur.impr + (Number(row.impressions) || 0),
              spend: cur.spend + (Number(row.spend) || 0),
              convs: cur.convs + (Number(row.conversions) || 0),
              convVal: cur.convVal + (Number(row.conversion_value) || 0),
              extra: nextExtra,
              extraCount: cur.extraCount + 1,
            });
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const existingRows: any[] = realCampaignRows ?? [];
          const filteredRows = Array.from(campAgg.entries()).map(([name, v]) => {
            const roasNum = v.spend > 0 ? v.convVal / v.spend : 0;
            const existing = existingRows.find((r: { name: string }) => r.name === name);
            const extra: Record<string, number> = {};
            for (const k of campAggCustomKeys) {
              extra[k] =
                campAggAvgKeys.has(k) && v.extraCount > 0 ? v.extra[k] / v.extraCount : v.extra[k];
            }
            return {
              // Reuse the real status from the full campaign rows (this
              // distributed set is built from another dimension's rows, which
              // don't carry campaign_status); spend guess only if unknown.
              status: existing?.status ?? (v.spend > 0 ? "green" : "gray"),
              name,
              type: existing?.type ?? "Search",
              roas: v.spend > 0 ? `${roasNum.toFixed(2)}x` : "null",
              roasColor:
                v.spend === 0
                  ? "gray"
                  : roasNum >= 1.5
                    ? "green"
                    : roasNum >= 1.0
                      ? "orange"
                      : "red",
              impr: v.impr,
              clicks: v.clicks,
              cpc: v.clicks > 0 ? v.spend / v.clicks : 0,
              ctr: v.impr > 0 ? (v.clicks / v.impr) * 100 : 0,
              convRate: v.clicks > 0 ? (v.convs / v.clicks) * 100 : 0,
              conv: v.convs,
              cpa: v.convs > 0 ? v.spend / v.convs : 0,
              revenue: v.convVal / 1000,
              cost: v.spend / 1000,
              profit: (v.convVal - v.spend) / 1000,
              roasVal: roasNum,
              extra,
            };
          });
          setCrossFilterCampaignRows(filteredRows.length > 0 ? filteredRows : null);
        } else {
          setCrossFilterCampaignRows(null);
        }
        // Distribute the selected dimension's metrics across EVERY other
        // dimension (ad_group, keyword, match_type, device, network, audience,
        // geography, time) proportionally to their share in each campaign.
        // Google Ads API doesn't return composite breakdowns, so we fetch each
        // dim's per-campaign totals and then for each row compute
        // attributed_metric = row_metric * (matched_in_camp / camp_total).
        // Sum across campaigns for the final attributed metric. This way e.g.
        // 10 conversions in selected search_terms becomes 10 conversions
        // distributed proportionally across devices, ad_groups, etc.
        if (campNames.length > 0) {
          const matchedByCamp = new Map<
            string,
            { clicks: number; impr: number; spend: number; convs: number; convVal: number }
          >();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const row of matched as any[]) {
            const camp = pivotOf(row);
            const cur = matchedByCamp.get(camp) ?? {
              clicks: 0,
              impr: 0,
              spend: 0,
              convs: 0,
              convVal: 0,
            };
            matchedByCamp.set(camp, {
              clicks: cur.clicks + (Number(row.clicks) || 0),
              impr: cur.impr + (Number(row.impressions) || 0),
              spend: cur.spend + (Number(row.spend) || 0),
              convs: cur.convs + (Number(row.conversions) || 0),
              convVal: cur.convVal + (Number(row.conversion_value) || 0),
            });
          }

          const distributeFor = async (
            groupBy: string,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ): Promise<{ names: string[]; rows: any[] | null }> => {
            try {
              const res = await fetch(
                `${rowsApiBase()}?date_from=${dateFrom}&date_to=${dateTo}&group_by=${groupBy}${connectorQS}${viewAsQS}`,
              );
              // safeJson returns unknown — the endpoint may answer with HTML on a
              // bad gateway, which is the whole reason it exists. Narrow to the
              // one field this reads rather than asserting a shape.
              const j = (await safeJson(res)) as { data?: unknown } | null;
              if (!Array.isArray(j?.data)) return { names: [], rows: null };
              // /api/windsor maps rows so the dimension value lives in `dimension`,
              // and the pivot value is resolved generically via pivotOf() — the
              // manifest folds that field onto every dimension's fetch (see
              // withCrossFilterPivot). Per-dim fields (device, network, hour,
              // etc.) are NOT present on the mapped row.
              const filtered = j.data.filter((r) => matchedByCamp.has(pivotOf(r)));
              // Per-campaign totals across this dimension (sum of all dim values in each camp)
              const campTotal = new Map<
                string,
                { clicks: number; impr: number; spend: number; convs: number; convVal: number }
              >();
              for (const row of filtered) {
                const camp = pivotOf(row);
                const cur = campTotal.get(camp) ?? {
                  clicks: 0,
                  impr: 0,
                  spend: 0,
                  convs: 0,
                  convVal: 0,
                };
                campTotal.set(camp, {
                  clicks: cur.clicks + (Number(row.clicks) || 0),
                  impr: cur.impr + (Number(row.impressions) || 0),
                  spend: cur.spend + (Number(row.spend) || 0),
                  convs: cur.convs + (Number(row.conversions) || 0),
                  convVal: cur.convVal + (Number(row.conversion_value) || 0),
                });
              }
              // Distribute each row's metrics by ratio matched/total per campaign
              const attributed = new Map<
                string,
                { clicks: number; impr: number; spend: number; convs: number; convVal: number }
              >();
              // Admin-registered custom metrics ride along, or every custom
              // column would read 0 in a cross-filtered table. Counts are
              // attributed by the same share as the canonical metrics; rates
              // and ratios can't be summed, so they're averaged across the
              // rows that contributed to each value.
              const attributedExtra = new Map<string, Record<string, number>>();
              const attributedExtraCount = new Map<string, number>();
              const sideConnectorDef = getConnector(activeConnector);
              const sideCustomKeys = Object.keys(sideConnectorDef.customMetricFields ?? {});
              const sideAvgKeys = new Set(
                sideCustomKeys.filter((k) => isAveragedMetric(activeConnector, k)),
              );
              for (const row of filtered) {
                const camp = pivotOf(row);
                const dimVal = (row.dimension as string) || "Unknown";
                const m = matchedByCamp.get(camp);
                const t = campTotal.get(camp);
                if (!m || !t) continue;
                const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);
                const rClk = ratio(m.clicks, t.clicks);
                const rImp = ratio(m.impr, t.impr);
                const rSpd = ratio(m.spend, t.spend);
                const rCnv = ratio(m.convs, t.convs);
                const rCv = ratio(m.convVal, t.convVal);
                const cur = attributed.get(dimVal) ?? {
                  clicks: 0,
                  impr: 0,
                  spend: 0,
                  convs: 0,
                  convVal: 0,
                };
                attributed.set(dimVal, {
                  clicks: cur.clicks + (Number(row.clicks) || 0) * rClk,
                  impr: cur.impr + (Number(row.impressions) || 0) * rImp,
                  spend: cur.spend + (Number(row.spend) || 0) * rSpd,
                  convs: cur.convs + (Number(row.conversions) || 0) * rCnv,
                  convVal: cur.convVal + (Number(row.conversion_value) || 0) * rCv,
                });
                if (sideCustomKeys.length > 0) {
                  const curExtra = attributedExtra.get(dimVal) ?? {};
                  for (const k of sideCustomKeys) {
                    const v = Number(row.extra?.[k]) || 0;
                    // Rates keep their own value (averaged below); counts take
                    // the same share of the row as the canonical metrics.
                    curExtra[k] = (curExtra[k] || 0) + (sideAvgKeys.has(k) ? v : v * rClk);
                  }
                  attributedExtra.set(dimVal, curExtra);
                  attributedExtraCount.set(dimVal, (attributedExtraCount.get(dimVal) ?? 0) + 1);
                }
              }
              const rows = Array.from(attributed.entries())
                .filter(([, v]) => v.clicks > 0 || v.impr > 0 || v.spend > 0 || v.convs > 0)
                .map(([name, v]) => {
                  const roasVal = v.spend > 0 ? v.convVal / v.spend : 0;
                  const rawExtra = attributedExtra.get(name);
                  const n = attributedExtraCount.get(name) || 1;
                  const extra = rawExtra
                    ? Object.fromEntries(
                        Object.entries(rawExtra).map(([k, val]) => [
                          k,
                          sideAvgKeys.has(k) ? val / n : val,
                        ]),
                      )
                    : undefined;
                  return {
                    dimension: name,
                    extra,
                    impr: Math.round(v.impr),
                    clicks: Math.round(v.clicks),
                    ctr: v.impr > 0 ? (v.clicks / v.impr) * 100 : 0,
                    cpc: v.clicks > 0 ? v.spend / v.clicks : 0,
                    convRate: v.clicks > 0 ? (v.convs / v.clicks) * 100 : 0,
                    conv: v.convs >= 1 ? Math.round(v.convs) : Number(v.convs.toFixed(2)),
                    cpa: v.convs > 0 ? v.spend / v.convs : 0,
                    revenue: v.convVal / 1000,
                    cost: v.spend / 1000,
                    profit: (v.convVal - v.spend) / 1000,
                    roasVal,
                    roas: v.spend > 0 ? `${roasVal.toFixed(2)}x` : "—",
                    roasColor:
                      v.spend === 0
                        ? "gray"
                        : roasVal >= 1.5
                          ? "green"
                          : roasVal >= 1.0
                            ? "orange"
                            : "red",
                  };
                });
              return { names: rows.map((r) => r.dimension), rows };
            } catch {
              return { names: [], rows: null };
            }
          };

          // Every breakdown this source shows a table for, minus the one that
          // triggered this cross-filter and the primary (which never gets a
          // side-fetch here). Derived from the source itself, so a table can't
          // be left out of the redistribution by accident.
          const allDims = crossFilterDimensionsFor(activeConnector);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rowsByDim: Record<string, any[] | null> = {};
          // While cross-filter is active, a non-source dim that ATTRIBUTED to
          // nothing still gets an override (an empty array). Otherwise
          // PerformanceTable would fall back to the API and show the
          // un-attributed total — which inflates the numbers (e.g. Network
          // showing 55 conversions for a 50-conversion search_term selection).
          //
          // A side-fetch that FAILED is different, and must not be conflated
          // with that: distributeFor returns null there, and forcing an empty
          // override for it blanked the table outright. That only ever showed
          // up once these dims came from the connector's own manifest — the
          // old hardcoded list named Google-Ads dims, which on another source
          // matched no table, so nothing rendered the bogus override.
          const sideFetches = allDims
            .filter((d) => d !== dim)
            .map((d) =>
              (async () => {
                const { names, rows } = await distributeFor(d);
                if (rows !== null) rowsByDim[d] = rows;
                if (d === "ad_group") setCrossFilterAdGroups(names.length > 0 ? names : null);
                if (d === "keyword") setCrossFilterKeywords(names.length > 0 ? names : null);
                if (d === "match_type") setCrossFilterMatchTypes(names.length > 0 ? names : null);
              })(),
            );
          if (dim === "ad_group") setCrossFilterAdGroups(null);
          if (dim === "keyword") setCrossFilterKeywords(null);
          if (dim === "match_type") setCrossFilterMatchTypes(null);

          await Promise.all(sideFetches);
          if (cancelled) return;
          // Every single dimension attributing to nothing means the join
          // itself didn't land — the selection's pivot values never matched
          // any other dimension's — not that the selection genuinely accounts
          // for zero everywhere. Publishing those overrides empties every
          // table at once, which tells the user nothing and looks broken. Fall
          // back to un-attributed data instead: less precise, but readable.
          // A partial result is kept as-is; a dimension that really did
          // attribute to zero should still show zero.
          const anyAttributed = Object.values(rowsByDim).some((r) => (r?.length ?? 0) > 0);
          setCrossFilterRowsByDim(anyAttributed ? rowsByDim : {});
        } else {
          setCrossFilterAdGroups(null);
          setCrossFilterKeywords(null);
          setCrossFilterMatchTypes(null);
          setCrossFilterRowsByDim({});
        }

        // Build the chart series broken down by the connector's primary entity
        // (the chart's default group-by) so selecting Device=Mobile keeps the
        // per-entity breakdown instead of collapsing to a single bar. Read via
        // pivotOf() (defined above) rather than a hardcoded field.
        const crossConnectorDef = getConnector(activeConnector);
        const crossCustomKeys = Object.keys(crossConnectorDef.customMetricFields ?? {});
        const crossAvgKeys = new Set(
          crossCustomKeys.filter((k) => isAveragedMetric(activeConnector, k)),
        );
        const dateMap: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const row of matched) {
          const dt: string = row.date;
          if (!dt) continue;
          if (!dateMap[dt]) {
            let label = dt;
            try {
              label = new Date(dt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              });
            } catch {
              /* ignore */
            }
            dateMap[dt] = {
              date: label,
              _iso: dt,
              total: 0,
              cost: 0,
              profit: 0,
              clicks: 0,
              conv: 0,
              _extra: {} as Record<string, number>,
              _extraCount: 0,
            };
          }
          const rev = Number(row.conversion_value) || 0;
          const cost = Number(row.spend) || 0;
          const clk = Number(row.clicks) || 0;
          const cnv = Number(row.conversions) || 0;
          const camp = pivotOf(row);
          dateMap[dt].total += rev;
          dateMap[dt].cost += cost;
          dateMap[dt].profit += rev - cost;
          dateMap[dt].clicks += clk;
          dateMap[dt].conv += cnv;
          dateMap[dt][camp] = ((dateMap[dt][camp] as number) || 0) + rev;
          dateMap[dt][`_cost_${camp}`] = ((dateMap[dt][`_cost_${camp}`] as number) || 0) + cost;
          dateMap[dt][`_clicks_${camp}`] = ((dateMap[dt][`_clicks_${camp}`] as number) || 0) + clk;
          dateMap[dt][`_conv_${camp}`] = ((dateMap[dt][`_conv_${camp}`] as number) || 0) + cnv;
          dateMap[dt]._extraCount += 1;
          for (const k of crossCustomKeys) {
            const v = Number((row as { extra?: Record<string, number> }).extra?.[k]) || 0;
            dateMap[dt]._extra[k] = (dateMap[dt]._extra[k] || 0) + v;
            dateMap[dt][`_extra_${k}_${camp}`] =
              ((dateMap[dt][`_extra_${k}_${camp}`] as number) || 0) + v;
          }
        }
        for (const dt of Object.keys(dateMap)) {
          if (dateMap[dt]._extraCount > 0) {
            for (const k of crossCustomKeys) {
              if (crossAvgKeys.has(k)) dateMap[dt]._extra[k] /= dateMap[dt]._extraCount;
            }
          }
        }
        setCrossFilterData(
          Object.values(dateMap).sort((a, b) => (a.date as string).localeCompare(b.date as string)),
        );
      })
      .catch(() => {
        setCrossFilterData(null);
        setCrossFilterCampaigns(null);
        setCrossFilterAdGroups(null);
        setCrossFilterKeywords(null);
        setCrossFilterMatchTypes(null);
        setCrossFilterCampaignRows(null);
        setCrossFilterRowsByDim({});
      })
      .finally(() => {
        if (!cancelled) setCrossFilterLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters,
    dimSearch,
    dimExclude,
    rangeStart,
    rangeEnd,
    windsorConnected,
    realBarData,
    activeConnector,
  ]);

  // Keep refs in sync so sendAiMsg can read latest values after an async wait
  useEffect(() => {
    isWindsorLoadingRef.current = isWindsorLoading;
  }, [isWindsorLoading]);

  // Mirror the long-running global operations (period change, dimension-bar fetch,
  // cross-filter distribution) into the store so every table can keep its "Updating…"
  // indicator visible for the WHOLE operation — not just its own quick fetch.
  useEffect(() => {
    setCrossFilterBusy(isWindsorLoading || dimensionBarLoading || crossFilterLoading);
  }, [isWindsorLoading, dimensionBarLoading, crossFilterLoading, setCrossFilterBusy]);
  useEffect(() => {
    windsorConnectedRef.current = windsorConnected;
  }, [windsorConnected]);
  useEffect(() => {
    realKpisRef.current = realKpis;
  }, [realKpis]);
  useEffect(() => {
    dynKpisRef.current = dynKpis;
  }, [dynKpis]);
  useEffect(() => {
    realCampaignRowsRef.current = realCampaignRows;
  }, [realCampaignRows]);
  useEffect(() => {
    dataSourceRef.current = dataSource;
  }, [dataSource]);
  useEffect(() => {
    aiSelectionChipsRef.current = aiSelectionChips;
  }, [aiSelectionChips]);
  useEffect(() => {
    crossFilterRowsByDimRef.current = crossFilterRowsByDim;
  }, [crossFilterRowsByDim]);
  useEffect(() => {
    selectedRowsRef.current = selectedRows;
  }, [selectedRows]);

  // NB: insights are NOT auto-generated on open. The panel shows preset questions
  // first; the analysis (colored insight cards) runs only when the user picks one
  // (onAnalyze → loadInsights). This avoids constant background requests / 429s.

  const buildSegData = useCallback(
    (metric: string, segBy: string) => {
      // Honor the Campaign-table filters (dropdown / Type / Status / ROAS / search)
      // via `filtered`; an explicit row selection still takes priority.
      const rows = selectedRows.length > 0 ? selectedRows : filtered;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getVal = (r: any): number => {
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
            // An admin-registered metric — no canonical field, read from the
            // row's `extra` bag (the donuts offer the source's own metrics).
            return r.extra?.[metric] ?? 0;
        }
      };
      if (segBy === "Campaign Type") {
        const typeMap: Record<string, number> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rows.forEach((r: any) => {
          typeMap[r.type] = (typeMap[r.type] || 0) + getVal(r);
        });
        return Object.entries(typeMap)
          .map(([name, value]) => ({ name, value }))
          .filter((x) => x.value > 0)
          .sort((a, b) => b.value - a.value);
      }
      const items = rows
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((r: any) => ({ name: r.name as string, value: getVal(r) }))
        .filter((x: { value: number }) => x.value > 0);
      items.sort((a: { value: number }, b: { value: number }) => b.value - a.value);
      const top = items.slice(0, 9);
      const othersVal = items.slice(9).reduce((s: number, x: { value: number }) => s + x.value, 0);
      if (othersVal > 0) top.push({ name: "Others", value: othersVal });
      return top;
    },
    [selectedRows, filtered],
  );

  // Compute min/max for heatmap columns
  const heatCols = useMemo(() => {
    const keys = [
      "impr",
      "clicks",
      "cpc",
      "ctr",
      "convRate",
      "conv",
      "cpa",
      "revenue",
      "cost",
      "profit",
    ] as const;
    const result: Record<string, { min: number; max: number }> = {};
    keys.forEach((k) => {
      const vals = currentRows.map((r) => r[k] as number);
      result[k] = { min: Math.min(...vals), max: Math.max(...vals) };
    });
    // Admin-registered metrics have no canonical field — their values live in
    // each row's `extra` bag. Without a range here their columns rendered
    // unshaded next to the canonical ones.
    for (const k of Object.keys(getConnector(activeConnector).customMetricFields ?? {})) {
      const vals = currentRows.map((r) => r.extra?.[k] ?? 0);
      result[k] = { min: Math.min(0, ...vals), max: Math.max(1, ...vals) };
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRows, activeConnector, connectorConfigs]);

  const tableTotals = useMemo(() => {
    const rows = filtered;
    const totImpr = rows.reduce((s, r) => s + r.impr, 0);
    const totClicks = rows.reduce((s, r) => s + r.clicks, 0);
    const totConv = rows.reduce((s, r) => s + r.conv, 0);
    const totCost = rows.reduce((s, r) => s + r.cost, 0);
    const totRev = rows.reduce((s, r) => s + r.revenue, 0);
    const totProfit = rows.reduce((s, r) => s + r.profit, 0);
    const avgCpc = totClicks > 0 ? totCost / totClicks : 0;
    const avgCtr = totImpr > 0 ? (totClicks / totImpr) * 100 : 0;
    const avgConvRate = totClicks > 0 ? (totConv / totClicks) * 100 : 0;
    const avgCpa = totConv > 0 ? totCost / totConv : 0;
    const totRoasVal = totCost > 0 ? totRev / totCost : 0;
    const totRoasColor = totRoasVal >= 1.5 ? "green" : totRoasVal >= 1.0 ? "orange" : "red";
    return {
      totImpr,
      totClicks,
      totConv,
      totCost,
      totRev,
      totProfit,
      avgCpc,
      avgCtr,
      avgConvRate,
      avgCpa,
      totRoasVal,
      totRoasColor,
    };
  }, [filtered]);

  return (
    <>
      {(isWindsorLoading || dimensionBarLoading || crossFilterLoading || tableLoadingCount > 0) && (
        <div className="fixed top-0 inset-x-0 z-[100] h-[3px] overflow-hidden bg-emerald-100">
          <div
            className="absolute h-full w-[35%] bg-emerald-500"
            style={{ animation: "loading-bar 1.2s ease-in-out infinite" }}
          />
        </div>
      )}
      <div
        className={`w-full px-4 sm:px-6 pt-6 pb-6 bg-[#f9fafb] ${isMobile ? "" : "transition-[padding] duration-300 ease-out"} ${aiOpen ? "lg:pr-[456px]" : ""}`}
      >
        <div className="max-w-[1600px] @container">
          {/* Header — desktop only; below lg the dashboard layout's mobile top bar
          renders the header, so gating at lg avoids showing both at once
          (which duplicated the top block on phone landscape / tablets). */}
          <div className="hidden lg:flex items-center justify-between mb-5 flex-wrap gap-3">
            <ConnectorSwitcher />
            <div className="flex items-center gap-3">
              <div className="relative">
                <button
                  onClick={() => {
                    if (datePickerOpen) setDatePickerOpen(false);
                    else openDatePicker();
                  }}
                  className="flex items-center gap-2 text-[14px] text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-gray-50 transition"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  {fmtMs(rangeStart)} – {fmtMs(rangeEnd)}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`transition-transform ${datePickerOpen ? "rotate-180" : ""}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {/* Desktop Date Picker Dropdown */}
                {datePickerOpen && (
                  <DatePickerPanel
                    pickerTempStart={pickerTempStart}
                    pickerTempEnd={pickerTempEnd}
                    pickerHover={pickerHover}
                    pickerStep={pickerStep}
                    pickerViewYear={pickerViewYear}
                    pickerViewMonth={pickerViewMonth}
                    setPickerTempStart={setPickerTempStart}
                    setPickerTempEnd={setPickerTempEnd}
                    setPickerHover={setPickerHover}
                    setPickerStep={setPickerStep}
                    setPickerViewYear={(fn) => setPickerViewYear(fn)}
                    setPickerViewMonth={(fn) => setPickerViewMonth(fn)}
                    setDatePickerOpen={setDatePickerOpen}
                    setRangeStart={setRangeStart}
                    setRangeEnd={setRangeEnd}
                    setHiddenSeries={setHiddenSeries}
                    handlePresetClick={handlePresetClick}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Sticky Active Filters — stays visible while scrolling so the user always
          sees (and can manage) the current filtering context.
          • Desktop/Laptop/Tablet: if all chips fit on one row they show inline,
            expanded by default, with a Hide toggle to collapse them. If they would
            wrap to a second row, it switches to the compact "Active Filters (N)
            Show ▾ … Clear All" layout (full list revealed on Show).
          • Mobile: always compact.
          • The Show/Hide toggle sits next to "Active Filters" in compact mode (and
            right after the chips in the inline expanded mode); Clear All stays a
            separate action on the right. */}
          {activeFilterChips.length > 0 &&
            (() => {
              const isCompact = isMobile || !filtersFitOneRow;
              // null override → per-mode default: inline starts expanded, compact collapsed.
              const expanded = filtersExpandedOverride ?? !isCompact;
              const inlineExpanded = !isCompact && expanded;

              const toggleBtn = (
                <button
                  onClick={() => setFiltersExpandedOverride(!expanded)}
                  className="flex items-center gap-1 text-[12px] font-medium text-gray-500 hover:text-gray-700 transition shrink-0"
                >
                  {expanded ? "Hide" : "Show"}
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              );
              const clearBtn = (
                <button
                  onClick={clearAll}
                  className="flex items-center gap-1 text-[12px] font-semibold text-red-500 hover:text-red-600 border border-red-200 rounded-lg px-2.5 py-1 hover:bg-red-50 transition shrink-0"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                  Clear All
                </button>
              );
              const chipEls = activeFilterChips.map((c) => (
                <span
                  key={`${c.key}|${c.value}`}
                  className={`inline-flex items-center gap-1 border text-[12px] rounded-full pl-2.5 pr-1 py-0.5 max-w-full ${
                    c.aggregated
                      ? "bg-emerald-100 border-emerald-300 text-emerald-800 font-semibold"
                      : "bg-emerald-50 border-emerald-200 text-emerald-700 font-medium"
                  }`}
                >
                  <span
                    className="truncate"
                    title={
                      c.aggregated
                        ? `${c.count} ${pluralizeDim(c.label)} selected`
                        : `${c.label}: ${c.value}`
                    }
                  >
                    {c.value}
                  </span>
                  <button
                    onClick={() => {
                      if (c.excluded) setDimExclude(c.key, []);
                      else if (c.aggregated) clearFilter(c.key);
                      else toggleValue(c.key, c.value);
                    }}
                    title={
                      c.excluded
                        ? `Stop excluding ${pluralizeDim(c.label)} (${c.count})`
                        : c.aggregated
                          ? `Clear all ${pluralizeDim(c.label)} (${c.count})`
                          : `Remove ${c.label}: ${c.value}`
                    }
                    className="w-4 h-4 flex items-center justify-center rounded-full text-emerald-400 hover:text-white hover:bg-emerald-400 transition shrink-0"
                  >
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </span>
              ));

              return (
                <div className="sticky top-0 z-30 -mx-1 mb-3">
                  <div className="relative overflow-x-clip bg-white/95 backdrop-blur border border-gray-200 rounded-xl shadow-sm px-3 py-2">
                    {/* Hidden single-line mirror used only to measure the natural one-row
                width (header + toggle + all chips at full width + Clear All). If it
                is wider than the bar, the chips would wrap → compact layout. */}
                    <div
                      ref={filtersMeasureRef}
                      aria-hidden
                      className="absolute top-0 left-3 -z-10 opacity-0 pointer-events-none flex flex-nowrap items-center gap-2 whitespace-nowrap"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth="2.5"
                      >
                        <polyline points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                      </svg>
                      <span className="text-[13px] font-bold">Active Filters</span>
                      <span className="text-[11px] font-semibold px-2 py-0.5">
                        {activeFilterChips.length}
                      </span>
                      <span className="text-[12px] font-medium px-1">Hide ▾</span>
                      <span className="flex flex-nowrap items-center gap-1.5">
                        {activeFilterChips.map((c, i) => (
                          <span
                            key={`m|${i}|${c.key}`}
                            className="inline-flex items-center gap-1 text-[12px] rounded-full pl-2.5 pr-1 py-0.5 font-medium whitespace-nowrap"
                          >
                            {c.value}
                            <span className="w-4 h-4 inline-block" />
                          </span>
                        ))}
                      </span>
                      <span className="text-[12px] font-semibold border px-2.5 py-1">
                        Clear All
                      </span>
                    </div>

                    {/* Visible header row */}
                    <div ref={filtersBarRef} className="flex items-center gap-2 flex-wrap">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth="2.5"
                        className="shrink-0"
                      >
                        <polyline points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                      </svg>
                      <span className="text-[13px] font-bold text-gray-800 shrink-0">
                        Active Filters
                      </span>
                      <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5 shrink-0">
                        {activeFilterChips.length}
                      </span>
                      {/* Toggle next to "Active Filters" — except in inline-expanded mode,
                  where it follows the chips instead. */}
                      {!inlineExpanded && toggleBtn}
                      {/* Inline chips (one row) + trailing toggle */}
                      {inlineExpanded && (
                        <>
                          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                            {chipEls}
                          </div>
                          {toggleBtn}
                        </>
                      )}
                      <div className="ml-auto shrink-0">{clearBtn}</div>
                    </div>

                    {/* Compact mode: full chip list revealed below on Show */}
                    {isCompact && expanded && (
                      <div className="flex flex-wrap gap-1.5 mt-2">{chipEls}</div>
                    )}
                  </div>
                </div>
              );
            })()}
          <div className="overflow-x-auto scrollbar-none -mx-1 px-1 pt-1 pb-3 mb-4">
            {/* 8-in-a-row only when there's room. With the AI panel open the content is
          ~456px narrower, so stay at 4 columns (two rows) to keep the values
          readable instead of squeezing 8 cards and clipping the numbers. */}
            {/* Container-query driven: 8 KPIs stay in one row whenever the available
          width (which already accounts for the open AI panel) genuinely fits
          them; only then does it wrap to two rows of 4. */}
            <div
              className={`grid grid-cols-4 gap-2 sm:gap-3 ${visibleKpis.length > 4 ? "@[960px]:grid-cols-8" : ""}`}
            >
              {visibleKpis.map((k) => {
                // When a secondary cross-filter is active (a Device / Search Term
                // / Time-of-Day selection, e.g. from the optimizer's "Explore in
                // Dashboard"), crossFilterData IS the scoped set — already
                // intersected with any campaign selection. dynKpis, by contrast,
                // sums the selected CAMPAIGNS across every sub-dimension, so it
                // would show the campaign totals while the tables and charts show
                // the filtered subset. Prefer realKpis (crossFilterData) then, so
                // every card matches the rest of the dashboard.
                const crossActive = !!(crossFilterData && crossFilterData.length > 0);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const dyn = crossActive ? undefined : (dynKpis?.[k.idx] as any);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const real = realKpis?.[k.idx] as any;
                const src = dyn ?? real;
                // Sparkline follows the same scope as the value: the selected rows'
                // series when a selection/filter is active, else the account series.
                const spark = dyn?.spark ?? real?.spark ?? [];
                // An admin-chosen Value Format overrides the slot's own formatting —
                // reformat the same raw number instead of the pre-built string.
                const raw = dyn?.raw ?? real?.raw;
                const value =
                  k.format && typeof raw === "number"
                    ? k.format === "currency"
                      ? fmtCurrency(raw)
                      : k.format === "percent"
                        ? fmtPct(raw)
                        : fmtNum(raw)
                    : (src?.value ?? "—");
                return (
                  <KpiCard
                    key={k.label}
                    label={k.label}
                    shortLabel={k.shortLabel}
                    icon={k.icon}
                    iconColor={k.iconColor}
                    value={value}
                    delta={src?.delta ?? "—"}
                    up={src?.up ?? true}
                    spark={spark}
                    desc={k.desc}
                    hoverFmt={real?.hoverFmt ?? k.hoverFmt}
                  />
                );
              })}
            </div>
          </div>

          {/* Chart card. Desktop padding per the Figma spec: 16px top, 24px sides,
          ~0 bottom (the inner blocks carry their own bottom spacing). */}
          <div className="bg-white rounded-2xl border border-gray-200 p-3 sm:px-6 sm:pt-4 sm:pb-0 mb-5 min-w-0">
            {/* Tabs row. Two things must hold at once:
              1) the active tab's 2px underline merges with the bottom divider, and
              2) the AI Analytics button is vertically CENTRED in the row.
            We get both with: the tabs wrapper is `self-stretch` + `items-stretch`, so
            the tab buttons always fill the full row height and their `border-b-2 -mb-px`
            underline lands exactly on the container's `border-b` (no float, regardless
            of the AI button height or overflow-x-auto). The AI button is `self-center`.
            `py-3` keeps the row compact (the card already supplies the 16px top space
            from the Figma spec) while the AI pill still reads as centred. */}
            <div className="flex items-center justify-between gap-3 mb-2 sm:mb-5 min-w-0 border-b border-gray-200 pt-0 pb-0">
              {/* Tab buttons on ALL devices. The buttons fill the row height
              (items-stretch) so their border-b-2 -mb-px underline lands exactly on
              the divider and the label sits vertically centred.
              Mobile spreads the tabs full-width only when there are enough of them
              to actually fill it (Google Ads' four). A source with two or three
              (GA4, Shopify) left-aligns instead — justify-between would otherwise
              pin the first and last to opposite edges with a gap of dead space
              between them, which reads as a layout bug rather than a choice. */}
              <div
                className={`flex items-stretch self-stretch ${visibleTabs.length >= 4 ? "justify-between" : "justify-start"} sm:justify-start gap-1 sm:gap-8 flex-1 overflow-x-clip min-w-0`}
              >
                {visibleTabs.map(({ label: t, idx: i }) => {
                  const tabIcon = TAB_ICONS[i];
                  const active = activeTab === i;
                  return (
                    <button
                      key={t}
                      onClick={() => setActiveTab(i)}
                      className={`flex items-center gap-1.5 sm:gap-2 px-0.5 sm:px-0 pt-2.5 pb-2.5 sm:pt-0 sm:pb-4.5 sm:h-10.5 border-b-2 -mb-px text-[13px] sm:text-[16px] leading-none sm:leading-6 font-medium transition whitespace-nowrap tracking-[-0.2px] cursor-pointer ${
                        active
                          ? "border-[#059669] text-[#047857]"
                          : "border-transparent text-[#4a5565] hover:text-gray-700 hover:border-gray-300"
                      }`}
                    >
                      <span className="shrink-0 flex items-center [&>svg]:size-4 sm:[&>svg]:size-5">
                        {tabIcon}
                      </span>
                      {/* Mobile shortens "Profit & Loss" → "P&L". */}
                      {i === 2 ? (
                        <>
                          <span className="sm:hidden">P&amp;L</span>
                          <span className="hidden sm:inline">{t}</span>
                        </>
                      ) : (
                        t
                      )}
                    </button>
                  );
                })}
              </div>
              {/* Inline AI button — desktop/tablet only (mobile uses the floating AI
              button). Greys out (inactive) while the panel is open; returns to active
              when closed. The outer transparent cell stretches to the full row height
              and `items-center` vertically centres the gradient pill. */}
              <div className="hidden sm:flex items-center self-stretch shrink-0">
                {/* AI button plate — sizes/paddings/radii/gradient transferred 1:1 from
              Figma (node 3:245/3:247): 2px gradient border (rounded-11), 32px-tall
              white button, 12px side / 6px vertical padding, 8px gap, rounded-9,
              14px icon, 14px #364153 text. Raised 8px on desktop to match the Figma
              offset (no raise on mobile, where it sits beside the dropdown). */}
                <div
                  className="p-[2px] rounded-[11px] transition sm:-translate-y-[8px]"
                  style={{
                    background: aiOpen
                      ? "#e5e7eb"
                      : "linear-gradient(90deg, #2b7fff, #ad46ff, #f6339a)",
                  }}
                >
                  <button
                    ref={aiBtnRef}
                    onClick={openAi}
                    disabled={aiOpen}
                    className={`flex items-center gap-2 h-8 px-3 leading-none text-[14px] font-medium rounded-[9px] transition whitespace-nowrap ${
                      aiOpen
                        ? "text-gray-400 bg-gray-50 cursor-default"
                        : "text-[#364153] bg-white hover:bg-gray-50/80"
                    }`}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      className={aiOpen ? "opacity-40" : ""}
                    >
                      <defs>
                        <linearGradient id="ai-grad" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor="#8b5cf6" />
                          <stop offset="100%" stopColor="#ec4899" />
                        </linearGradient>
                      </defs>
                      <path
                        d="M12 1.5C12.5 7.5 16.5 11.5 22.5 12C16.5 12.5 12.5 16.5 12 22.5C11.5 16.5 7.5 12.5 1.5 12C7.5 11.5 11.5 7.5 12 1.5Z"
                        fill={aiOpen ? "#9ca3af" : "url(#ai-grad)"}
                      />
                      <circle cx="18" cy="6" r="1.5" fill={aiOpen ? "#9ca3af" : "url(#ai-grad)"} />
                    </svg>
                    <span>AI Analytics</span>
                    {aiSelectionChips.length > 0 && (
                      <span className="ml-0.5 text-[11px] font-bold text-violet-600">
                        ({aiSelectionChips.reduce((s, c) => s + c.values.length, 0)})
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Tab content with charts */}
            <TabContent
              activeTab={activeTab}
              isMobile={isMobile}
              isLoading={isWindsorLoading || dimensionBarLoading}
              hasRecords={chartHasRecords}
              aggregatedBarData={aggregatedBarData}
              chartSeries={filteredChartSeries}
              chartMetric={chartMetricKey}
              chartMetricLabel={chartMetricLabel}
              chartMetricIsMoney={chartMetricIsMoney}
              chartGroupBy={chartGroupBy}
              chartMetricOpen={chartMetricOpen}
              chartGroupByOpen={chartGroupByOpen}
              hiddenSeries={hiddenSeries}
              othersNames={othersNames}
              rowTypeFilter={effectiveRowTypeFilter}
              renderTotalLabelChart={renderTotalLabelChart}
              CHART_METRICS={chartMetricOptions}
              CHART_GROUPBY={chartGroupByOptions}
              groupByLabel={groupByLabel}
              onChartMetricChange={(m) => {
                setChartMetric(m);
                setHiddenSeries(new Set());
              }}
              onChartGroupByChange={(g) => {
                setChartGroupBy(g);
                setHiddenSeries(new Set());
              }}
              onChartMetricOpenChange={setChartMetricOpen}
              onChartGroupByOpenChange={setChartGroupByOpen}
              onToggleSeries={toggleSeries}
              onClearRowFilter={() => clearFilter("campaign_selected")}
              aggregatedAdPerfData={aggregatedAdPerfData}
              hiddenAdPerf={hiddenAdPerf}
              renderConvLabel={renderConvLabel}
              renderLossTopLabel={renderLossTopLabel}
              onHiddenAdPerfChange={setHiddenAdPerf}
              aggregatedPlData={aggregatedPlData}
              hiddenPL={hiddenPL}
              dates={dates}
              onHiddenPLChange={setHiddenPL}
              buildSegData={buildSegData}
              segDateFrom={effectiveDateFrom}
              segDateTo={effectiveDateTo}
              chartKey={chartKey}
              granularity={granularity}
              granularityOpen={granularityOpen}
              onGranularityChange={setGranularity}
              onGranularityOpenChange={setGranularityOpen}
              timelineOpen={timelineOpen}
              customEvents={timelineEvents}
              autoSourceLabel={getConnector(activeConnector).label}
              onToggleTimeline={() => setTimelineOpen(!timelineOpen)}
              onAddEvent={() => {
                setEditingEventId(null);
                setAddEventOpen(true);
                setEvtType("promotions");
                setEvtStartDate(new Date(rangeEnd).toISOString().split("T")[0]);
                setEvtEndDate("");
                setEvtTitle("");
                setEvtDesc("");
              }}
              onDeleteEvent={handleDeleteEvent}
              onEditEvent={(m) =>
                openEditEvent({
                  id: m.id,
                  category: m.type,
                  type: null,
                  startDate: m.startDate,
                  endDate: m.endDate ?? "",
                  title: m.title,
                  desc: m.desc ?? "",
                } as CustomEvent)
              }
            />
          </div>

          {/* Primary ("hero") table. Built-in default = CampaignTable, bound to
          this connector's own primaryDimension — unchanged from before an
          admin could swap this slot. An admin can instead promote a different
          dimension or an existing Table Widget into this position (purely
          visual — cross-filtering/KPI computation still pivot on the
          connector's actual primaryDimension either way, see
          ConnectorConfig.primaryTableSource in @/lib/connectors). */}
          {primaryTableSource?.type === "dimension" ? (
            <PerformanceTable
              title={
                primaryCustomLabel?.trim() ||
                primaryTableSourceDimensionDef?.label ||
                primaryTableSource.key
              }
              dimensionLabel={primaryTableSourceDimensionDef?.singular ?? primaryTableSource.key}
              dimensionKey={primaryTableSource.key}
              dateFrom={effectiveDateFrom}
              dateTo={effectiveDateTo}
              rangeLabel={`${fmtMs(rangeStart)} – ${fmtMs(rangeEnd)}`}
              isVisible
            />
          ) : primaryTableSource?.type === "widget" && primaryTableWidgetConfig ? (
            <ConfigurableTableWidget
              config={primaryTableWidgetConfig}
              dateFrom={effectiveDateFrom}
              dateTo={effectiveDateTo}
              rangeLabel={`${fmtMs(rangeStart)} – ${fmtMs(rangeEnd)}`}
              isVisible
            />
          ) : (
            <CampaignTable
              filtered={filtered}
              currentRows={currentRows}
              page={page}
              rowsPerPage={rowsPerPage}
              totalPages={totalPages}
              sortCol={sortCol}
              sortDir={sortDir}
              typeFilter={typeFilter}
              types={types}
              namesCollapsed={namesCollapsed}
              expandedNameIdx={expandedNameIdx}
              isMobile={isMobile}
              heatCols={heatCols}
              tableTotals={tableTotals}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              fmtMs={fmtMs}
              onSort={handleSort}
              onTypeFilter={setTypeFilter}
              onPageChange={setPage}
              onRowsPerPageChange={setRowsPerPage}
              onNamesCollapsedChange={setNamesCollapsed}
              onExpandedNameIdxChange={setExpandedNameIdx}
              campaignDropdownOpen={campaignDropdownOpen}
              campaignSearch={campaignSearch}
              onCampaignDropdownOpen={setCampaignDropdownOpen}
              onCampaignSearchChange={setCampaignSearch}
              statusFilter={statusFilter}
              onStatusFilter={setStatusFilter}
              metricFilter={metricFilter}
              onMetricFilter={setMetricFilter}
              crossFilterCampaigns={crossFilterCampaigns}
              primaryLabel={
                primaryCustomLabel?.trim() || getConnector(activeConnector).primaryLabel
              }
              hasCost={getConnector(activeConnector).hasCost}
              metricCols={primaryTableMetricCols}
            />
          )}

          {/* Extended Analytics — 10 dimension tables */}
          <ExtendedAnalytics
            dateFrom={new Date(rangeStart).toISOString().slice(0, 10)}
            dateTo={new Date(rangeEnd).toISOString().slice(0, 10)}
            effectiveDateFrom={effectiveDateFrom}
            effectiveDateTo={effectiveDateTo}
            rangeLabel={`${fmtMs(rangeStart)} – ${fmtMs(rangeEnd)}`}
          />
        </div>

        {/* ── Add Custom Event Modal ── */}
        {addEventOpen && (
          <AddEventModal
            evtType={evtType}
            evtStartDate={evtStartDate}
            evtEndDate={evtEndDate}
            evtTitle={evtTitle}
            evtDesc={evtDesc}
            editing={!!editingEventId}
            onClose={() => {
              setAddEventOpen(false);
              setEditingEventId(null);
            }}
            onSubmit={handleAddEvent}
            onDelete={
              editingEventId
                ? () => {
                    handleDeleteEvent(editingEventId);
                    setAddEventOpen(false);
                    setEditingEventId(null);
                  }
                : undefined
            }
            onTypeChange={setEvtType}
            onStartDateChange={setEvtStartDate}
            onEndDateChange={setEvtEndDate}
            onTitleChange={setEvtTitle}
            onDescChange={setEvtDesc}
          />
        )}

        {/* Floating AI button (chat-widget style). Shown on any device once the inline
          AI button scrolls out of view (the inline button is now rendered on mobile
          too). Hidden while the panel is open. Badge = active selections/filters. */}
        {!aiOpen &&
          !aiBtnVisible &&
          (() => {
            const selCount = aiSelectionChips.reduce((s, c) => s + c.values.length, 0);
            return (
              <button
                onClick={openAi}
                aria-label="Open AI Analytics"
                className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-90 flex items-center gap-2 h-13 sm:h-14 pl-3.5 pr-4 rounded-full text-white font-semibold shadow-xl shadow-violet-300/40 hover:scale-105 active:scale-95 transition animate-in fade-in zoom-in duration-200"
                style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="white" className="shrink-0">
                  <path d="M12 1.5C12.5 7.5 16.5 11.5 22.5 12C16.5 12.5 12.5 16.5 12 22.5C11.5 16.5 7.5 12.5 1.5 12C7.5 11.5 11.5 7.5 12 1.5Z" />
                  <circle cx="18.5" cy="5.5" r="1.4" />
                </svg>
                <span className="text-[15px]">AI{selCount > 0 ? ` (${selCount})` : ""}</span>
              </button>
            );
          })()}

        {/* ── AI Analytics Sidebar ── */}
        <AiSidebar
          aiOpen={aiOpen}
          aiInput={aiInput}
          aiMsgs={aiMsgs}
          aiLoading={aiLoading}
          aiScrollRef={aiScrollRef as React.RefObject<HTMLDivElement>}
          mode={aiMode}
          dateRangeLabel={`${fmtMs(rangeStart)} – ${fmtMs(rangeEnd)}`}
          selectionChips={aiSelectionChips}
          dataIncluded={
            activeConnector === "google_ads"
              ? [
                  "Campaigns",
                  "Ad Groups",
                  "Keywords",
                  "Search Terms",
                  "Devices",
                  "Audiences",
                  "Geography",
                  "Time",
                ]
              : [...getConnector(activeConnector).dimensions.map((d) => d.singular), "Time"]
          }
          insights={aiInsights}
          insightsLoading={aiInsightsLoading}
          suggestedQuestions={aiSuggestedQuestions}
          focusQuestion={aiFocusQuestion}
          onClose={() => setAiOpen(false)}
          onInputChange={setAiInput}
          onSendMsg={sendAiMsg}
          onTogglePin={toggleAiPin}
          onApplyFilter={applyFilterAction}
          onAnalyze={(q, instr) => {
            // The "Analyze …" button relabels itself for the current selection
            // but passed no focus, so both the header and the request always
            // said "full account" — the analysis wasn't told to concentrate on
            // what the user had picked.
            const focus =
              q ?? (aiMode === "selection" ? "Analyze the current selection" : undefined);
            setAiFocusQuestion(focus ?? "Analyze full account");
            loadInsights(focus, instr);
          }}
          currentSessionId={currentSessionId}
          onNewChat={newChat}
          onLoadSession={loadChatSession}
          onDeleteSession={deleteSession}
        />

        {/* ── Mobile Date Picker Modal ── */}
        {datePickerOpen && (
          <MobileDatePicker
            pickerTempStart={pickerTempStart}
            pickerTempEnd={pickerTempEnd}
            pickerHover={pickerHover}
            pickerStep={pickerStep}
            pickerViewYear={pickerViewYear}
            pickerViewMonth={pickerViewMonth}
            setPickerTempStart={setPickerTempStart}
            setPickerTempEnd={setPickerTempEnd}
            setPickerHover={setPickerHover}
            setPickerStep={setPickerStep}
            setPickerViewYear={setPickerViewYear}
            setPickerViewMonth={setPickerViewMonth}
            setDatePickerOpen={setDatePickerOpen}
            setRangeStart={setRangeStart}
            setRangeEnd={setRangeEnd}
            setHiddenSeries={setHiddenSeries}
            handlePresetClick={handlePresetClick}
          />
        )}
      </div>
    </>
  );
}
