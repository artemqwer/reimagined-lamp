"use client";

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { CustomEvent, EventType, EventSource, TimelineMarker } from "../_data/types";
import { holidaysBetween } from "@/lib/holidays";

// ─── Category config (spec: 6 categories, saturated distinct colours + icons) ─

interface TypeMeta {
  label: string;
  color: string;
  bg: string;
  auto: boolean;
  icon: React.ReactNode;
}

// Colours & icons mirror the Figma design (Tailwind v4 -600 stroke / -50 chip bg).
export const EVENT_TYPES: Record<EventType, TypeMeta> = {
  holidays: {
    label: "Holidays",
    color: "#059669",
    bg: "#EFF6FF",
    auto: true,
    icon: (
      <svg
        width="12"
        height="12"
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
    ),
  },
  promotions: {
    label: "Promotions",
    color: "#F54900",
    bg: "#FFF7ED",
    auto: false,
    icon: (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <line x1="19" y1="5" x2="5" y2="19" />
        <circle cx="6.5" cy="6.5" r="2.5" />
        <circle cx="17.5" cy="17.5" r="2.5" />
      </svg>
    ),
  },
  website: {
    label: "Website",
    color: "#E60076",
    bg: "#FDF2F8",
    auto: false,
    icon: (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  products: {
    label: "Products",
    color: "#0084D1",
    bg: "#F0F9FF",
    auto: false,
    icon: (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
  ads: {
    label: "Ads",
    color: "#7F22FE",
    bg: "#F5F3FF",
    auto: true,
    // Exclamation-in-circle, the same alert glyph the timeline uses for anomalies
    // (ANOMALY_META) — not the old star and not a megaphone: this marks changes /
    // things to look at, so it should read as an alert.
    icon: (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12.5" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
  custom: {
    label: "Custom Events",
    color: "#9810FA",
    bg: "#FAF5FF",
    auto: false,
    icon: (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
      </svg>
    ),
  },
};

// Order shown in the filter bar.
export const CATEGORY_ORDER: EventType[] = [
  "holidays",
  "promotions",
  "website",
  "products",
  "ads",
  "custom",
];
// Categories the user can create manually (Ads & Holidays are automatic).
export const MANUAL_TYPES: EventType[] = ["promotions", "website", "products", "custom"];

const SOURCE_BY_TYPE: Record<EventType, EventSource> = {
  holidays: "Holidays",
  ads: "Google Ads",
  promotions: "Manual",
  website: "Manual",
  products: "Manual",
  custom: "Manual",
};

// Map legacy stored category values onto the new taxonomy.
export function normalizeType(category: string | null | undefined): EventType {
  switch ((category ?? "").toLowerCase()) {
    case "holidays":
    case "holiday":
      return "holidays";
    case "promotions":
    case "promotion":
    case "sale/promotion":
      return "promotions";
    case "website":
    case "website changes":
      return "website";
    case "products":
    case "product":
      return "products";
    case "ads":
    case "ads updates":
    case "campaign":
    case "events":
      return "ads";
    default:
      return "custom";
  }
}

// ─── US holiday calendar (auto "Holidays" events) ────────────────────────────
// The calendar itself lives in lib/holidays.ts — Smart Goals marks the same
// holidays, and a shopping calendar that disagreed between two screens would be
// worse than none. This only maps it into this timeline's event shape.

export function generateHolidays(startMs: number, endMs: number): CustomEvent[] {
  if (!isFinite(startMs) || !isFinite(endMs) || endMs < startMs) return [];
  const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  // A day either side, matching the tolerance this had before.
  return holidaysBetween(toIso(startMs - 864e5), toIso(endMs + 864e5)).map((h) => ({
    id: `holiday-${h.date.slice(0, 4)}-${h.key}`,
    category: "holidays",
    type: "Holidays",
    startDate: h.date,
    endDate: "",
    title: h.title,
    desc: "",
  }));
}

// ─── Year-agnostic date → column matching ────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function parseMD(label: string): { m: number; d: number } | null {
  if (!label) return null;
  const isoMatch = label.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return { m: parseInt(isoMatch[2], 10) - 1, d: parseInt(isoMatch[3], 10) };
  const mt = label.trim().match(/([A-Za-z]{3,})\s+(\d{1,2})/);
  if (!mt) return null;
  const m = MONTHS.indexOf(mt[1].slice(0, 3).toLowerCase());
  return m < 0 ? null : { m, d: parseInt(mt[2], 10) };
}
const ord = (m: number, d: number) => m * 31 + d;

// Does a single date land in the column labelled `columnStr`?
function dateInColumn(columnStr: string, isoDate: string, granularity: string): boolean {
  if (!isoDate) return false;
  const sd = new Date(isoDate);
  if (isNaN(sd.getTime())) return false;
  const em = sd.getUTCMonth(),
    ed = sd.getUTCDate(),
    ey = sd.getUTCFullYear();

  if (granularity === "months") {
    const lab = columnStr.trim(); // "May" or "May 2022"
    const sameMonth =
      new Date(isoDate)
        .toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
        .toLowerCase() === lab.slice(0, 3).toLowerCase();
    const yr = lab.match(/\b(20\d{2})\b/);
    return sameMonth && (!yr || parseInt(yr[1]) === ey);
  }
  if (granularity === "weeks") {
    const parts = columnStr.split(/[–-]/);
    if (parts.length < 2) return false;
    const a = parseMD(parts[0]),
      b = parseMD(parts[1]);
    if (!a || !b) return false;
    const e = ord(em, ed),
      s = ord(a.m, a.d),
      en = ord(b.m, b.d);
    return en >= s ? e >= s && e <= en : e >= s || e <= en;
  }
  const c = parseMD(columnStr);
  return !!c && c.m === em && c.d === ed;
}

// A single/ongoing event marks its start column; a date-range event marks
// EVERY column it spans (each day, or each week/month when grouped).
function eventInColumn(columnStr: string, ev: CustomEvent, granularity: string): boolean {
  const sd = new Date(ev.startDate),
    ed = new Date(ev.endDate);
  const hasRange = ev.endDate && ev.endDate !== ev.startDate && !isNaN(ed.getTime()) && ed > sd;
  if (!hasRange) return dateInColumn(columnStr, ev.startDate, granularity);
  if (
    dateInColumn(columnStr, ev.startDate, granularity) ||
    dateInColumn(columnStr, ev.endDate, granularity)
  )
    return true;
  const s = ord(sd.getUTCMonth(), sd.getUTCDate()),
    e = ord(ed.getUTCMonth(), ed.getUTCDate());
  if (granularity === "days") {
    const c = parseMD(columnStr);
    return !!c && ord(c.m, c.d) >= s && ord(c.m, c.d) <= e;
  }
  if (granularity === "weeks") {
    const a = parseMD(columnStr.split(/[–-]/)[0]);
    return !!a && ord(a.m, a.d) >= s && ord(a.m, a.d) <= e;
  }
  if (granularity === "months") {
    const cm = MONTHS.indexOf(columnStr.trim().slice(0, 3).toLowerCase());
    return cm >= 0 && cm >= sd.getUTCMonth() && cm <= ed.getUTCMonth();
  }
  return false;
}

function toMarker(ev: CustomEvent, autoSourceLabel?: string): TimelineMarker {
  const type = normalizeType(ev.category);
  const source = SOURCE_BY_TYPE[type];
  // The platform events on a GA4 timeline did not come from Google Ads. The
  // label follows whichever source the timeline is showing.
  const authored = type === "ads" ? (autoSourceLabel ?? source) : source;
  const auto = type === "holidays" || type === "ads";
  // The detector's anomalies ride the "ads" category but should read as
  // warnings, not as ads events — identified by the id the detector stamps.
  const anomaly = (ev.id ?? "").startsWith("anomaly-");
  return {
    id: ev.id,
    type,
    title: ev.title,
    startDate: ev.startDate,
    endDate: ev.endDate || undefined,
    desc: ev.desc || undefined,
    source,
    createdBy: anomaly ? "Detected" : auto ? authored : ev.type || "—",
    ongoing: !ev.endDate && !auto,
    deletable: !auto,
    anomaly,
  };
}

// A KPI anomaly's chrome — an amber warning, distinct from every event category
// so it reads at a glance as "something to look at", not a starred highlight.
const ANOMALY_META: TypeMeta = {
  label: "Anomaly",
  color: "#D97706",
  bg: "#FFFBEB",
  auto: true,
  icon: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12.5" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
};

/** The icon/colour a marker draws with — the warning chrome for an anomaly,
 *  otherwise its event category's. */
function markerMeta(m: TimelineMarker): TypeMeta {
  return m.anomaly ? ANOMALY_META : EVENT_TYPES[m.type];
}

function formatTimelineDateLabel(d: string): string {
  if (!d) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return d.slice(8).replace(/^0/, "");
  }
  if (/^\d{4}-\d{2}$/.test(d)) {
    const m = parseInt(d.slice(5, 7), 10);
    const months = [
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
    return months[m - 1] ?? d;
  }
  return d;
}

// ─── Column model ─────────────────────────────────────────────────────────────

interface TimelineColumn {
  date: string;
  markers: TimelineMarker[];
}

function buildColumns(
  dates: string[],
  events: CustomEvent[],
  granularity: string,
  hidden: Set<EventType>,
  autoSourceLabel?: string,
): TimelineColumn[] {
  const visible = events.filter((e) => !hidden.has(normalizeType(e.category)));
  return dates.map((date) => ({
    date,
    markers: visible
      .filter((e) => eventInColumn(date, e, granularity))
      .map((e) => toMarker(e, autoSourceLabel)),
  }));
}

// True when at least one event lands in the visible range — used by the parent to
// auto-expand the collapsed timeline when there is something to show.
export function hasVisibleEvents(
  dates: string[],
  events: CustomEvent[],
  granularity: string,
): boolean {
  return events.some((e) => dates.some((d) => eventInColumn(d, e, granularity)));
}

// Per-category counts over the visible range (each event once).
function categoryCounts(
  dates: string[],
  events: CustomEvent[],
  granularity: string,
): Record<EventType, number> {
  const counts = {
    holidays: 0,
    promotions: 0,
    website: 0,
    products: 0,
    ads: 0,
    custom: 0,
  } as Record<EventType, number>;
  events.forEach((e) => {
    if (dates.some((d) => eventInColumn(d, e, granularity))) counts[normalizeType(e.category)]++;
  });
  return counts;
}

// ─── Tooltip popover (hover + click) ─────────────────────────────────────────

interface PopoverState {
  markers: TimelineMarker[];
  x: number;
  y: number;
  pinned: boolean;
}

function fmtDate(isoStr?: string) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  return isNaN(d.getTime())
    ? isoStr
    : d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
}

function Popover({
  state,
  onClose,
  onEdit,
}: {
  state: PopoverState;
  onClose: () => void;
  onEdit?: (m: TimelineMarker) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: state.x, top: state.y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = state.x - r.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
    let top = state.y - r.height - 12;
    if (top < 8) top = state.y + 18;
    setPos({ left, top });
  }, [state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // Close on page scroll, but NOT when scrolling inside the popover itself (#6)
    // so a long list of events can be scrolled while the block stays open.
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <>
      {state.pinned && <div className="fixed inset-0 z-[998]" onClick={onClose} />}
      <div
        ref={ref}
        style={{ left: pos.left, top: pos.top }}
        className="fixed z-[999] w-64 max-h-[60vh] overflow-y-auto bg-gray-900 text-white rounded-xl shadow-2xl p-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        {state.markers.map((m) => {
          const meta = markerMeta(m);
          const range = m.endDate
            ? `${fmtDate(m.startDate)} – ${fmtDate(m.endDate)}`
            : fmtDate(m.startDate);
          return (
            <div key={m.id} className="px-1.5 py-1.5 border-b border-white/10 last:border-0">
              <div className="flex items-start gap-2">
                <span
                  className="mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: meta.color, color: "#fff" }}
                >
                  <span className="scale-[0.6]">{meta.icon}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium" style={{ color: meta.color }}>
                    {meta.label}
                  </p>
                  <p className="text-[12px] font-semibold leading-tight">{m.title}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {range}
                    {m.ongoing && (
                      <span className="ml-1 text-emerald-400 font-medium">• Ongoing</span>
                    )}
                  </p>
                  {m.desc && (
                    <p className="text-[11px] text-gray-200 mt-1 leading-snug">{m.desc}</p>
                  )}
                  <p className="text-[10px] text-gray-500 mt-1">Created by: {m.createdBy}</p>
                </div>
                {m.deletable && state.pinned && onEdit && (
                  <button
                    onClick={() => onEdit(m)}
                    title="Edit event"
                    className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition"
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>,
    document.body,
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface TimelineProps {
  dates: string[];
  timelineOpen: boolean;
  customEvents: CustomEvent[];
  /** What to call the source behind auto "platform" events (default Google Ads). */
  autoSourceLabel?: string;
  /**
   * Line up with a chart drawn above, rather than standing on its own.
   *
   * Two things have to match for a date here to sit under the same date there.
   * The insets are the chart's own plot area — its y-axis gutter and margins —
   * and `points` says the chart puts its first and last value ON the edges of
   * that area (a line or area chart) rather than in the middle of a band (a
   * bar chart), which is a half-column difference that grows across a month.
   */
  chartAlign?: { left: number; right: number };
  granularity?: "days" | "weeks" | "months";
  onToggle?: () => void;
  onAddEvent?: () => void;
  onDeleteEvent?: (id: string) => void;
  onEditEvent?: (m: TimelineMarker) => void;
  isMobile?: boolean;
}

export default function Timeline({
  dates,
  timelineOpen,
  customEvents,
  autoSourceLabel,
  chartAlign,
  granularity = "days",
  onToggle,
  onAddEvent,
  onDeleteEvent,
  onEditEvent,
  isMobile = false,
}: TimelineProps) {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [hidden, setHidden] = useState<Set<EventType>>(new Set());
  // Category hover tooltip — rendered via a portal so it isn't clipped by the
  // chart's overflow-x-auto wrapper (which also hides vertical overflow).
  const [catTip, setCatTip] = useState<{ type: EventType; x: number; y: number } | null>(null);

  // Mobile shows the timeline only when there are ≤31 columns after grouping;
  // more than that is too cramped, so prompt to rotate (the chart is scrollable
  // there anyway). Tablet/desktop always show it in full.
  const compact = isMobile;
  if (isMobile && dates.length > 31) {
    return (
      <div className="mt-1 border-t border-gray-100 pt-3 pb-2 flex items-center justify-center gap-2 text-gray-400">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M16.48 3.66a2 2 0 0 1 0 2.83L6.49 16.48a2 2 0 0 1-2.83 0l-.14-.14a2 2 0 0 1 0-2.83L13.51 3.52a2 2 0 0 1 2.83 0z" />
          <path d="M2 12a10 10 0 0 0 18 6" />
          <polyline points="20 13 20 18 15 18" />
        </svg>
        <span className="text-[12px]">Rotate your phone to view the Event Timeline</span>
      </div>
    );
  }

  const counts = categoryCounts(dates, customEvents, granularity);
  const cols = buildColumns(dates, customEvents, granularity, hidden, autoSourceLabel);
  const total = CATEGORY_ORDER.reduce((n, c) => n + counts[c], 0);

  const toggleCat = (t: EventType) =>
    setHidden((prev) => {
      const n = new Set(prev);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });

  // Click-only — no hover state churn (a hover-driven portal popover can steal
  // the pointer and flicker open/close, freezing the tab).
  const openPopover = (e: React.MouseEvent, markers: TimelineMarker[]) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopover({ markers, x: r.left + r.width / 2, y: r.top, pinned: true });
  };

  return (
    <div className="mt-3 border-t border-gray-100 pt-4 pb-3">
      {/* Header — Figma spec: title 14px/Regular #101828, subtitle 12px #6a7282,
          gradient count pill, 28px squircle category icons, a vertical divider,
          then the Add Event button. */}
      <div
        className={`flex items-center justify-between gap-3 flex-wrap pr-[10px] ${compact ? "pl-1" : "pl-[50px]"} ${timelineOpen ? "mb-2" : ""}`}
      >
        {/* Entire header block toggles the timeline (one big click target). */}
        <div
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle?.();
            }
          }}
          className="flex items-start gap-2 cursor-pointer select-none group"
        >
          <span className="text-gray-400 group-hover:text-gray-600 mt-0.5 transition-colors">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform duration-200 ${timelineOpen ? "" : "-rotate-90"}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-normal text-[#101828] leading-[20px] tracking-[-0.15px]">
                Event Timeline
              </span>
              {/* Count badge ALWAYS shown — including 0 — so the user immediately sees
                  there are no events for the current period (spec: "Event Timeline (0)"). */}
              <span
                className={`text-[12px] font-semibold rounded-lg px-2 h-[22px] inline-flex items-center leading-none ${
                  total > 0
                    ? "text-[#047857] bg-linear-to-r from-[#eff6ff] to-[#eef2ff] border border-[#bedbff]"
                    : "text-gray-400 bg-gray-50 border border-gray-200"
                }`}
              >
                {total}
              </span>
              {!compact && (
                <span
                  className="text-gray-400"
                  title="Holidays & Ads are automatic; add promotions, website, product & custom events yourself"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </span>
              )}
            </div>
            {/* Subtitle hidden on mobile (#2) — Figma: 12px #6a7282 */}
            {!compact && (
              <p className="text-[12px] text-[#6a7282] mt-0.5">
                Holidays, promotions, website, products, and Ads changes
              </p>
            )}
          </div>
        </div>
        {/* Right cluster — category indicators + Add Event. Shown in both the
            open and collapsed states (matches Figma closed-timeline layout). */}
        <div className="flex items-center gap-3">
          {/* Category filters — 28px squircle icon buttons with count badges (hidden on mobile) */}
          {!compact && (
            <div className="flex items-center gap-1.5">
              {CATEGORY_ORDER.map((t) => {
                const meta = EVENT_TYPES[t];
                const off = hidden.has(t);
                const c = counts[t];
                return (
                  <div key={t} className="relative">
                    <button
                      onClick={() => toggleCat(t)}
                      onMouseEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setCatTip({ type: t, x: r.left + r.width / 2, y: r.bottom + 8 });
                      }}
                      onMouseLeave={() => setCatTip((cur) => (cur?.type === t ? null : cur))}
                      className={`relative w-7 h-7 rounded-[10px] shadow-sm flex items-center justify-center transition cursor-pointer ${off ? "opacity-40" : "hover:scale-105"}`}
                      style={{ background: meta.bg, color: meta.color }}
                    >
                      {meta.icon}
                      {c > 0 && (
                        <span
                          className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-white text-[9px] font-bold flex items-center justify-center ring-1"
                          style={{ color: meta.color, borderColor: meta.color }}
                        >
                          {c}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {/* Vertical divider between the category icons and Add Event (Figma) */}
          {!compact && <div className="bg-[#d1d5dc] h-6 w-px shrink-0" />}
          <button
            onClick={onAddEvent}
            className="text-[12px] font-medium text-[#364153] border border-[#d1d5dc] rounded-lg px-[11px] py-[7px] hover:bg-gray-50 flex items-center gap-1.5 whitespace-nowrap"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Event
          </button>
        </div>
      </div>

      {timelineOpen && (
        <div
          className="relative"
          style={{
            paddingLeft: `${chartAlign?.left ?? 50}px`,
            paddingRight: `${chartAlign?.right ?? 10}px`,
          }}
        >
          {/* Date row — aligned to the chart columns. Thin out labels when there
              are many columns so they never overlap (like the chart X axis).
              Hidden on mobile to save space. */}
          {!compact &&
            (() => {
              // Aligned to a chart: every date, at the fraction of the width
              // the chart plots it at. A line chart puts its first and last
              // value ON the edges of the plot area, so date i sits at
              // i/(n-1) — half a column away from where a flex row of equal
              // cells would put it, which is a drift you can see by the end of
              // a month. Standing alone, the old evenly-spread row and its
              // thinning are kept.
              if (chartAlign)
                return (
                  <div className="relative h-4 mb-1">
                    {dates.map((d, i) => (
                      <div
                        key={i}
                        className={`absolute top-0 text-[10px] whitespace-nowrap -translate-x-1/2 ${cols[i]?.markers.length ? "text-gray-700 font-semibold" : "text-gray-300"}`}
                        style={{
                          left: `${dates.length > 1 ? (i / (dates.length - 1)) * 100 : 50}%`,
                        }}
                      >
                        {formatTimelineDateLabel(d)}
                      </div>
                    ))}
                  </div>
                );
              const step = Math.max(1, Math.ceil(dates.length / 14));
              return (
                <div className="flex justify-between mb-1">
                  {dates.map((d, i) => {
                    const show = i % step === 0;
                    return (
                      <div
                        key={i}
                        className={`flex-1 text-center text-[10px] min-w-0 px-0.5 whitespace-nowrap ${cols[i]?.markers.length ? "text-gray-700 font-semibold" : "text-gray-300"}`}
                      >
                        {show ? formatTimelineDateLabel(d) : ""}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

          <div className="flex items-start py-1.5 relative">
            <div
              className={`absolute right-0 top-[19px] border-t border-dashed border-gray-100 z-0 ${chartAlign ? "left-0" : "left-[45px]"}`}
            />
            <div
              className={`flex-1 relative z-10 min-w-0 ${chartAlign ? "min-h-[34px]" : "flex justify-between items-start"}`}
            >
              {(() => {
                // Wide layout (few columns) → show individual big icons; narrow
                // (many columns) → collapse a day's events into one count circle.
                const wide = dates.length <= 14;
                return cols.map((col, i) => {
                  const n = col.markers.length;
                  // Same x as the chart's point for this date when aligned to
                  // one; an equal share of the row when standing alone.
                  const at = dates.length > 1 ? (i / (dates.length - 1)) * 100 : 50;
                  return (
                    <div
                      key={i}
                      className={
                        chartAlign
                          ? "absolute top-0 flex flex-col items-center -translate-x-1/2"
                          : "flex-1 flex flex-col items-center min-w-0 w-0"
                      }
                      style={chartAlign ? { left: `${at}%` } : undefined}
                    >
                      {n === 0 ? (
                        <span className="w-[3px] h-[3px] rounded-full bg-gray-100 mt-[17px]" />
                      ) : (
                        <button
                          onClick={(e) => openPopover(e, col.markers)}
                          className="flex items-center justify-center cursor-pointer group"
                          title={col.markers.map((m) => m.title).join(", ")}
                        >
                          {n === 1 ? (
                            (() => {
                              const m = col.markers[0];
                              const meta = markerMeta(m);
                              return (
                                <span
                                  className={`relative rounded-full flex items-center justify-center ring-2 ring-white shadow-sm transition-transform group-hover:scale-110 ${compact ? "w-[22px] h-[22px]" : "w-[30px] h-[30px]"}`}
                                  style={{ background: meta.bg, color: meta.color }}
                                >
                                  <span className={compact ? "scale-125" : "scale-[1.6]"}>
                                    {meta.icon}
                                  </span>
                                  {m.ongoing && (
                                    <span className="absolute -right-0.5 -bottom-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-white" />
                                  )}
                                </span>
                              );
                            })()
                          ) : wide ? (
                            <div className="flex items-center justify-center gap-0.5 flex-wrap max-w-[64px]">
                              {col.markers.slice(0, compact ? 2 : 3).map((m) => {
                                const meta = markerMeta(m);
                                return (
                                  <span
                                    key={m.id}
                                    className={`rounded-full flex items-center justify-center ring-2 ring-white shadow-sm transition-transform group-hover:scale-110 ${compact ? "w-[22px] h-[22px]" : "w-[28px] h-[28px]"}`}
                                    style={{ background: meta.bg, color: meta.color }}
                                  >
                                    <span className={compact ? "scale-100" : "scale-[1.3]"}>
                                      {meta.icon}
                                    </span>
                                  </span>
                                );
                              })}
                              {n > (compact ? 2 : 3) && (
                                <span
                                  className={`rounded-full flex items-center justify-center font-bold text-white ring-2 ring-white shadow-sm bg-gray-500 ${compact ? "w-[22px] h-[22px] text-[10px]" : "w-[28px] h-[28px] text-[11px]"}`}
                                >
                                  +{n - (compact ? 2 : 3)}
                                </span>
                              )}
                            </div>
                          ) : (
                            (() => {
                              const types = new Set(col.markers.map((m) => m.type));
                              const bg =
                                types.size === 1 ? markerMeta(col.markers[0]).color : "#4B5563";
                              return (
                                <span
                                  className={`rounded-full flex items-center justify-center font-bold text-white ring-2 ring-white shadow-sm transition-transform group-hover:scale-110 ${compact ? "w-[22px] h-[22px] text-[11px]" : "w-[30px] h-[30px] text-[12px]"}`}
                                  style={{ background: bg }}
                                >
                                  {n}
                                </span>
                              );
                            })()
                          )}
                        </button>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {total === 0 && (
            <p className="text-[11px] text-gray-400 text-center mt-1">
              No events in this period. Click{" "}
              <span className="font-medium text-gray-500">Add Event</span> to mark a change.
              Holidays are added automatically.
            </p>
          )}
        </div>
      )}

      {/* Category legend removed (#9) — counts are shown on the icon badges and
          on hover via the styled tooltip above. */}

      {popover && (
        <Popover
          state={popover}
          onClose={() => setPopover(null)}
          onEdit={
            onEditEvent
              ? (m) => {
                  setPopover(null);
                  onEditEvent(m);
                }
              : undefined
          }
        />
      )}

      {/* Category hover tooltip — portal to body so the chart's overflow never
          clips it (the issue when the timeline is collapsed). */}
      {catTip &&
        createPortal(
          (() => {
            const meta = EVENT_TYPES[catTip.type];
            const c = counts[catTip.type];
            const off = hidden.has(catTip.type);
            return (
              <div
                className="fixed z-[200] -translate-x-1/2 pointer-events-none"
                style={{ left: catTip.x, top: catTip.y }}
              >
                <div className="bg-gray-900 text-white rounded-lg px-2.5 py-1.5 shadow-lg whitespace-nowrap">
                  <div className="text-[11px] font-semibold flex items-center gap-1.5">
                    <span style={{ color: meta.color }}>{meta.icon}</span>
                    {meta.label}
                    <span className="text-gray-400 font-bold">{c}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 leading-tight">
                    {off ? "Click to show" : "Click to hide"} · {c} {c === 1 ? "event" : "events"}
                  </div>
                </div>
              </div>
            );
          })(),
          document.body,
        )}
    </div>
  );
}
