"use client";

import React, { useState, useRef, useEffect } from "react";
import CalMonth from "./CalMonth";
import { END_MS } from "../_data/constants";

// Same preset list/order as the desktop date picker (#20)
const MOBILE_PRESETS = [
  "Today",
  "Yesterday",
  "Last 7 days",
  "Last 14 days",
  "Last 30 days",
  "This week (Sun - Today)",
  "This week (Mon - Today)",
  "Last week (Sun - Sat)",
  "Last week (Mon - Sun)",
  "This month",
  "Last month",
  "This year",
  "All time",
];

interface MobileDatePickerProps {
  pickerTempStart: number | null;
  pickerTempEnd: number | null;
  pickerHover: number | null;
  pickerStep: 0 | 1;
  pickerViewYear: number;
  pickerViewMonth: number;
  setPickerTempStart: (v: number | null) => void;
  setPickerTempEnd: (v: number | null) => void;
  setPickerHover: (v: number | null) => void;
  setPickerStep: (v: 0 | 1) => void;
  setPickerViewYear: (v: number) => void;
  setPickerViewMonth: (v: number) => void;
  setDatePickerOpen: (v: boolean) => void;
  setRangeStart: (v: number) => void;
  setRangeEnd: (v: number) => void;
  setHiddenSeries: (v: Set<string>) => void;
  handlePresetClick: (label: string) => void;
}

export default function MobileDatePicker({
  pickerTempStart,
  pickerTempEnd,
  pickerHover,
  pickerStep,
  pickerViewYear,
  pickerViewMonth,
  setPickerTempStart,
  setPickerTempEnd,
  setPickerHover,
  setPickerStep,
  setPickerViewYear,
  setPickerViewMonth,
  setDatePickerOpen,
  setRangeStart,
  setRangeEnd,
  setHiddenSeries,
  handlePresetClick,
}: MobileDatePickerProps) {
  const [yMPickerOpen, setYMPickerOpen] = useState(false);
  const [yMPickerYear, setYMPickerYear] = useState(pickerViewYear);
  const MNAMES_SHORT = [
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
  const NOW_YEAR = new Date().getFullYear();
  const NOW_MONTH = new Date().getMonth();
  const curM = pickerViewMonth % 12;
  const curY = pickerViewYear + Math.floor(pickerViewMonth / 12);

  // Continuous month window covering both the selected period and today, so the
  // user can smoothly scroll/swipe through months (modern mobile date-picker UX)
  // instead of tapping prev/next repeatedly.
  const focusedAbs = curY * 12 + curM;
  const nowAbs = NOW_YEAR * 12 + NOW_MONTH;
  const startAbs = Math.min(nowAbs, focusedAbs) - 120;
  const endAbs = Math.max(nowAbs, focusedAbs) + 3;
  const monthAbsList = Array.from({ length: endAbs - startAbs + 1 }, (_, i) => startAbs + i);

  // Lock the page behind the full-screen modal so it can't scroll under it (the
  // component is mounted only while open, so mount/unmount is open/close).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const navHeaderRef = useRef<HTMLDivElement | null>(null);
  const focusMonthRef = useRef<HTMLDivElement | null>(null);
  // Scroll the focused month into view on open and on prev/next/jump. Offsets by
  // the sticky nav header so the month isn't hidden under it.
  useEffect(() => {
    if (yMPickerOpen) return;
    const sc = scrollRef.current;
    const el = focusMonthRef.current;
    if (!sc || !el) return;
    const headerH = navHeaderRef.current?.offsetHeight ?? 0;
    sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - headerH - 8;
  }, [pickerViewYear, pickerViewMonth, yMPickerOpen]);

  return (
    // Full-screen modal on mobile: covers the whole app, full height, its own
    // white ground, and the page behind is scroll-locked (see the effect above)
    // so nothing shows through or scrolls under it.
    <div
      className="sm:hidden fixed inset-0 z-[200] flex flex-col bg-white"
      onMouseLeave={() => setPickerHover(null)}
    >
      <div className="flex flex-col flex-1 min-h-0 w-full">
        {/* Header — title + close, so a full-screen sheet has a clear way out. */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
          <span className="text-[15px] font-semibold text-gray-800">Select dates</span>
          <button
            onClick={() => setDatePickerOpen(false)}
            aria-label="Close"
            className="w-9 h-9 -mr-1.5 flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 transition"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        {/* Quick Select — pinned at the top (OUTSIDE the scroll area) so the fast
            presets are visible immediately on open, before the month calendar, and
            aren't scrolled away by the auto-scroll-to-focused-month. */}
        {/* Heading dropped on mobile — even trimmed it clipped against the sheet
            edge and read as a defect. Instead the preset row sits vertically
            centred with even padding top and bottom, so it reads as deliberate. */}
        <div className="w-full border-b border-gray-100 bg-gray-50/50 shrink-0 overflow-hidden flex items-center min-h-[52px]">
          <div className="flex overflow-x-auto scrollbar-none px-2 w-full">
            {MOBILE_PRESETS.map((label) => (
              <button
                key={label}
                onClick={() => handlePresetClick(label)}
                className="whitespace-nowrap text-left px-4 py-2 text-[13px] transition-all text-gray-600 hover:bg-white hover:text-emerald-600"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
          {/* Calendars + Content */}
          <div className="flex flex-col min-w-0">
            {yMPickerOpen ? (
              /* Year-Month Picker */
              <div className="flex flex-col px-6 py-5">
                <div className="flex items-center justify-between mb-6">
                  <button
                    onClick={() => setYMPickerYear((y) => Math.max(2000, y - 1))}
                    className="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 hover:bg-gray-100 transition text-gray-500"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <span className="text-[18px] font-bold text-gray-800">{yMPickerYear}</span>
                  <button
                    onClick={() => setYMPickerYear((y) => Math.min(NOW_YEAR, y + 1))}
                    disabled={yMPickerYear >= NOW_YEAR}
                    className="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 hover:bg-gray-100 transition text-gray-500 disabled:opacity-30"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {MNAMES_SHORT.map((mn, idx) => {
                    const isFuture = yMPickerYear === NOW_YEAR && idx > NOW_MONTH;
                    const isActive = yMPickerYear === curY && idx === curM;
                    return (
                      <button
                        key={idx}
                        disabled={isFuture}
                        onClick={() => {
                          setPickerViewYear(yMPickerYear);
                          setPickerViewMonth(idx);
                          setYMPickerOpen(false);
                        }}
                        className={`py-3 rounded-2xl text-[14px] font-medium transition ${
                          isActive
                            ? "bg-emerald-600 text-white shadow-md shadow-emerald-200"
                            : isFuture
                              ? "text-gray-200 cursor-not-allowed"
                              : "text-gray-700 hover:bg-emerald-50 hover:text-emerald-600"
                        }`}
                      >
                        {mn}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setYMPickerOpen(false)}
                  className="mt-6 text-[14px] text-gray-400 hover:text-gray-600 transition self-center"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                {/* Month-name header + prev/next arrows removed on mobile: Quick Select
                    sits at the top and month navigation is by vertical scroll. Jumping
                    to a specific month/year stays available via each month's own header
                    (CalMonth onHeaderClick → year-month picker). */}

                {/* Continuous month list — swipe / scroll freely between months. */}
                <div className="flex flex-col gap-8 px-6 py-4 items-center">
                  {monthAbsList.map((abs) => {
                    const m = ((abs % 12) + 12) % 12;
                    const y = Math.floor(abs / 12);
                    return (
                      <div
                        key={abs}
                        ref={abs === focusedAbs ? focusMonthRef : undefined}
                        className="w-full flex justify-center scroll-mt-2"
                      >
                        <CalMonth
                          year={y}
                          month={m}
                          tempStart={pickerTempStart}
                          tempEnd={pickerTempEnd}
                          hover={pickerHover}
                          step={pickerStep}
                          maxMs={END_MS}
                          onHeaderClick={() => {
                            setYMPickerYear(y);
                            setYMPickerOpen(true);
                          }}
                          onDayClick={(ts) => {
                            if (pickerStep === 0) {
                              setPickerTempStart(ts);
                              setPickerTempEnd(null);
                              setPickerStep(1);
                            } else {
                              if (pickerTempStart !== null && ts < pickerTempStart) {
                                setPickerTempEnd(pickerTempStart);
                                setPickerTempStart(ts);
                              } else {
                                setPickerTempEnd(ts);
                              }
                              setPickerStep(0);
                            }
                          }}
                          onDayHover={setPickerHover}
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer — завжди зафіксований знизу */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 shrink-0 bg-white">
          <button
            onClick={() => setDatePickerOpen(false)}
            className="flex-1 py-3 text-[14px] font-bold text-gray-600 hover:bg-gray-50 rounded-2xl transition-all border border-gray-200"
          >
            Cancel
          </button>
          <button
            disabled={!pickerTempStart || !pickerTempEnd}
            onClick={() => {
              if (pickerTempStart && pickerTempEnd) {
                setRangeStart(pickerTempStart);
                setRangeEnd(pickerTempEnd);
                setDatePickerOpen(false);
                setHiddenSeries(new Set());
                // Keep active cross-filters when only the period changes.
              }
            }}
            className="flex-1 py-3 text-[14px] bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 disabled:bg-gray-100 disabled:text-gray-400 transition-all"
          >
            Apply Period
          </button>
        </div>
      </div>
    </div>
  );
}
