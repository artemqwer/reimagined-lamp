"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  periodKind,
  previousPeriod,
  periodFor,
  switchPeriodKind,
  type PeriodKind,
} from "@/lib/smartGoals";
import { formatPeriod } from "./format";

// Choosing the period, in the same window the dashboard's date picker uses.
//
// It is not the same picker, though, and deliberately: a goal is set on a month
// or on a year, so a day-range calendar would offer ranges no goal can be set
// on ("3 Mar – 17 Apr"). The window instead offers exactly the two shapes that
// exist, which is also the granularity — a month is read day by day, a year
// month by month. Two controls for one choice was one too many.
//
// Every year back to a decade ago is reachable, and two ahead for planning.

const MONTHS_SHORT = [
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

/** The next period in the same shape — the counterpart of previousPeriod. */
export function nextPeriod(period: string): string {
  if (periodKind(period) === "year") return String(Number(period) + 1);
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Years offered: a decade back for history, two ahead for planning. Whichever
 *  year is open is always included, so a period reached by the arrows can't
 *  fall out of its own picker. */
export function yearOptions(period: string): number[] {
  const now = new Date().getUTCFullYear();
  const years = new Set<number>();
  for (let y = now - 10; y <= now + 2; y++) years.add(y);
  years.add(Number(period.slice(0, 4)));
  // Ascending — earliest first — so the grid reads left-to-right, top-to-bottom
  // from past to future, the way a calendar year list is expected to run.
  return [...years].sort((a, b) => a - b);
}

/** The quick jumps, as periods. Named the way someone asks for them. */
function presets(): { label: string; period: string }[] {
  const now = new Date();
  const y = now.getUTCFullYear();
  const thisMonth = periodFor(now, "month");
  return [
    { label: "This month", period: thisMonth },
    { label: "Last month", period: previousPeriod(thisMonth) },
    { label: "Same month last year", period: `${y - 1}${thisMonth.slice(4)}` },
    { label: "This year", period: String(y) },
    { label: "Last year", period: String(y - 1) },
    { label: "Next year", period: String(y + 1) },
  ];
}

export default function PeriodPicker({
  period,
  rememberedMonth,
  onChange,
}: {
  period: string;
  /** The month last looked at, so switching back to months returns to it
   *  rather than to January. */
  rememberedMonth: string;
  /** Both the period and, implicitly, its kind — the page reads the shape. */
  onChange: (period: string) => void;
}) {
  const kind = periodKind(period);
  const [open, setOpen] = useState(false);
  // The year being browsed inside the window, which is not yet the choice —
  // stepping through years to look around shouldn't reload the page behind it.
  const [viewYear, setViewYear] = useState(Number(period.slice(0, 4)));
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // The window is drawn on the body rather than inside this element, because
  // the settings modal that also uses this picker scrolls its own content —
  // an absolutely positioned panel would be clipped by it.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(520, window.innerWidth - 32);
    // Kept on screen: nudged left when it would run past the right edge, and
    // flipped above the trigger when there isn't room below.
    const left = Math.max(16, Math.min(r.left, window.innerWidth - width - 16));
    const below = window.innerHeight - r.bottom;
    const top = below < 360 && r.top > below ? Math.max(8, r.top - 8 - 360) : r.bottom + 8;
    setAt({ top, left });
  }, []);

  // Reopening shows the period actually selected, not wherever browsing was
  // left off last time — and the window is measured against the trigger as it
  // opens, while the trigger is certainly on screen.
  const openPanel = () => {
    setViewYear(Number(period.slice(0, 4)));
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // The panel lives on the body now, so it is outside wrapRef.
      if (!wrapRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  const pick = (p: string) => {
    onChange(p);
    setOpen(false);
  };

  const arrow =
    "w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-gray-700 hover:border-gray-300 transition";
  const years = yearOptions(period);
  // yearOptions is ascending now, so the ends flipped.
  const minYear = years[0];
  const maxYear = years[years.length - 1];

  const tab = (to: PeriodKind, label: string, hint: string) => (
    <button
      key={to}
      // Switching shape keeps where you were: the year shown, and the month
      // last looked at within it.
      onClick={() => pick(switchPeriodKind(to, String(viewYear), rememberedMonth))}
      className={`flex-1 rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
        kind === to ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
      }`}
    >
      {label}
      <span className="block text-[10px] font-normal text-gray-400">{hint}</span>
    </button>
  );

  return (
    <div className="relative" ref={wrapRef}>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onChange(previousPeriod(period))}
          aria-label="Previous period"
          className={arrow}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <button
          ref={triggerRef}
          onClick={() => (open ? setOpen(false) : openPanel())}
          aria-expanded={open}
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
          {formatPeriod(period)}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <button
          onClick={() => onChange(nextPeriod(period))}
          aria-label="Next period"
          className={arrow}
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
      </div>

      {open &&
        at &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: at.top, left: at.left }}
            className="fixed z-[400] w-[min(520px,calc(100vw-2rem))] bg-white border border-gray-100 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 origin-top-left"
          >
            <div className="flex flex-col sm:flex-row">
              {/* Quick jumps */}
              <div className="sm:w-[170px] border-b sm:border-b-0 sm:border-r border-gray-100 p-2 bg-gray-50/30 flex sm:block gap-1 overflow-x-auto">
                {presets().map((p) => (
                  <button
                    key={p.label}
                    onClick={() => pick(p.period)}
                    className={`w-full whitespace-nowrap text-left px-3 py-2 text-[13px] rounded-lg transition-colors ${
                      p.period === period
                        ? "bg-white text-emerald-600 font-semibold"
                        : "text-gray-600 hover:bg-white hover:text-emerald-600"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="flex-1 p-4">
                {/* Which shape the period has — and so how the chart reads it. */}
                <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg p-0.5 mb-4">
                  {tab("month", "Month", "day by day")}
                  {tab("year", "Year", "month by month")}
                </div>

                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => setViewYear((y) => Math.max(minYear, y - 1))}
                    disabled={viewYear <= minYear}
                    aria-label="Previous year"
                    className={`${arrow} disabled:opacity-30`}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <span className="text-[15px] font-bold text-gray-800">{viewYear}</span>
                  <button
                    onClick={() => setViewYear((y) => Math.min(maxYear, y + 1))}
                    disabled={viewYear >= maxYear}
                    aria-label="Next year"
                    className={`${arrow} disabled:opacity-30`}
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
                </div>

                {kind === "month" ? (
                  <div className="grid grid-cols-3 gap-1.5">
                    {MONTHS_SHORT.map((mn, i) => {
                      const p = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
                      return (
                        <button
                          key={mn}
                          onClick={() => pick(p)}
                          className={`py-2 rounded-xl text-[13px] font-medium transition ${
                            p === period
                              ? "bg-emerald-600 text-white"
                              : "text-gray-700 hover:bg-emerald-50 hover:text-emerald-600"
                          }`}
                        >
                          {mn}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {years.map((y) => (
                      <button
                        key={y}
                        onClick={() => pick(String(y))}
                        className={`py-2 rounded-xl text-[13px] font-medium transition ${
                          String(y) === period
                            ? "bg-emerald-600 text-white"
                            : "text-gray-700 hover:bg-emerald-50 hover:text-emerald-600"
                        }`}
                      >
                        {y}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      <span className="sr-only">{formatPeriod(period)}</span>
    </div>
  );
}
