"use client";

import React, { useState, useRef, useEffect } from "react";
import CalMonth from "./CalMonth";
import { END_MS } from "../_data/constants";

interface DatePickerPanelProps {
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
  setPickerViewYear: (fn: (v: number) => number) => void;
  setPickerViewMonth: (fn: (v: number) => number) => void;
  setDatePickerOpen: (v: boolean) => void;
  setRangeStart: (v: number) => void;
  setRangeEnd: (v: number) => void;
  setHiddenSeries: (v: Set<string>) => void;
  handlePresetClick: (label: string) => void;
}

export default function DatePickerPanel({
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
}: DatePickerPanelProps) {
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

  // Render a large CONTINUOUS month window that always covers BOTH the selected
  // period and today, so the user can freely scroll forward to the current month
  // (and far back through history) regardless of how old the selected range is.
  const focusedAbs = pickerViewYear * 12 + pickerViewMonth;
  const nowAbs = NOW_YEAR * 12 + NOW_MONTH;
  const startAbs = Math.min(nowAbs, focusedAbs) - 120; // ≥10 years of history
  const endAbs = Math.max(nowAbs, focusedAbs) + 3; // a few months ahead
  const monthAbsList = Array.from({ length: endAbs - startAbs + 1 }, (_, i) => startAbs + i);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const focusMonthRef = useRef<HTMLDivElement | null>(null);
  // Scroll the focused month into view — on open AND whenever the user navigates
  // (prev/next buttons or the month/year jump). Scroll ONLY the inner container,
  // never the page (scrollIntoView would bubble up and jump the dashboard).
  useEffect(() => {
    const sc = scrollRef.current;
    const el = focusMonthRef.current;
    if (sc && el) sc.scrollTop = el.offsetTop - sc.offsetTop;
  }, [pickerViewYear, pickerViewMonth]);

  return (
    <div className="hidden sm:block absolute right-0 top-full mt-2 w-[580px] bg-white border border-gray-100 rounded-2xl shadow-2xl z-[300] overflow-hidden animate-in fade-in zoom-in duration-200 origin-top-right">
      <div className="flex h-[580px]">
        {/* Sidebar */}
        <div className="w-[190px] border-r border-gray-100 py-4 flex flex-col bg-gray-50/30">
          <div className="flex-1 overflow-y-auto scrollbar-none px-2 space-y-0.5">
            {[
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
            ].map((label) => {
              return (
                <button
                  key={label}
                  onClick={() => handlePresetClick(label)}
                  className="w-full text-left px-4 py-2 text-[13px] rounded-lg transition-colors text-gray-600 hover:bg-white hover:text-emerald-600"
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col bg-white relative">
          {/* Date Inputs */}
          <div className="px-4 py-5 flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                Start date*
              </label>
              <input
                type="date"
                value={pickerTempStart ? new Date(pickerTempStart).toISOString().split("T")[0] : ""}
                max={
                  pickerTempEnd ? new Date(pickerTempEnd).toISOString().split("T")[0] : undefined
                }
                onChange={(e) => {
                  if (!e.target.value) return;
                  const [y, m, d] = e.target.value.split("-").map(Number);
                  const ts = Date.UTC(y, m - 1, d);
                  setPickerTempStart(ts);
                  if (pickerTempEnd && ts > pickerTempEnd) setPickerTempEnd(null);
                  setPickerStep(1);
                  setPickerViewYear(() => y);
                  setPickerViewMonth(() => m - 1);
                }}
                className="w-full h-9 border border-gray-200 rounded-lg px-3 text-[13px] bg-white outline-none focus:border-emerald-400 cursor-text"
              />
            </div>
            <div className="pt-4 text-gray-300">—</div>
            <div className="flex-1">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                End date*
              </label>
              <input
                type="date"
                value={pickerTempEnd ? new Date(pickerTempEnd).toISOString().split("T")[0] : ""}
                min={
                  pickerTempStart
                    ? new Date(pickerTempStart).toISOString().split("T")[0]
                    : undefined
                }
                onChange={(e) => {
                  if (!e.target.value) return;
                  const [y, m, d] = e.target.value.split("-").map(Number);
                  const ts = Date.UTC(y, m - 1, d);
                  setPickerTempEnd(ts);
                  setPickerStep(0);
                }}
                className="w-full h-9 border border-gray-200 rounded-lg px-3 text-[13px] bg-white outline-none focus:border-emerald-400 cursor-text"
              />
            </div>
          </div>

          {/* Navigation Controls */}
          <div className="px-4 py-2 flex items-center justify-between border-y border-gray-100 bg-gray-50/50">
            <button
              onClick={(e) => {
                e.preventDefault();
                if (pickerViewMonth === 0) {
                  setPickerViewMonth(() => 11);
                  setPickerViewYear((v) => v - 1);
                } else setPickerViewMonth((v) => v - 1);
              }}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition shadow-sm text-gray-500 group"
              title="Previous Month"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="group-hover:-translate-x-0.5 transition-transform"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                setPickerViewYear(() => NOW_YEAR);
                setPickerViewMonth(() => NOW_MONTH);
              }}
              className="text-[10px] font-bold text-gray-400 hover:text-emerald-600 uppercase tracking-widest transition"
              title="Jump to current month"
            >
              Today
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                if (pickerViewMonth === 11) {
                  setPickerViewMonth(() => 0);
                  setPickerViewYear((v) => v + 1);
                } else setPickerViewMonth((v) => v + 1);
              }}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition shadow-sm text-gray-500 group"
              title="Next Month"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="group-hover:translate-x-0.5 transition-transform"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {/* Calendar Area */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-2 space-y-8 scrollbar-thin"
          >
            {monthAbsList.map((abs) => {
              const m = ((abs % 12) + 12) % 12;
              const y = Math.floor(abs / 12);
              return (
                <div
                  key={abs}
                  ref={abs === focusedAbs ? focusMonthRef : undefined}
                  className="pb-4 scroll-mt-2"
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

          {/* Year-Month Picker Overlay */}
          {yMPickerOpen && (
            <div className="absolute inset-0 z-20 bg-white flex flex-col p-5">
              <div className="flex items-center justify-between mb-5">
                <button
                  onClick={() => setYMPickerYear((y) => Math.max(2000, y - 1))}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 transition text-gray-500"
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
                <span className="text-[16px] font-bold text-gray-800">{yMPickerYear}</span>
                <button
                  onClick={() => setYMPickerYear((y) => Math.min(NOW_YEAR, y + 1))}
                  disabled={yMPickerYear >= NOW_YEAR}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 transition text-gray-500 disabled:opacity-30"
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
              <div className="grid grid-cols-3 gap-2">
                {MNAMES_SHORT.map((mn, idx) => {
                  const isFuture = yMPickerYear === NOW_YEAR && idx > NOW_MONTH;
                  const isActive = yMPickerYear === pickerViewYear && idx === pickerViewMonth;
                  return (
                    <button
                      key={idx}
                      disabled={isFuture}
                      onClick={() => {
                        setPickerViewYear(() => yMPickerYear);
                        setPickerViewMonth(() => idx);
                        setYMPickerOpen(false);
                      }}
                      className={`py-2.5 rounded-xl text-[13px] font-medium transition ${
                        isActive
                          ? "bg-emerald-600 text-white"
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
                className="mt-auto pt-5 text-[13px] text-gray-400 hover:text-gray-600 transition self-center"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Action Buttons */}
          <div className="px-4 py-4 border-t border-gray-100 flex justify-end gap-3 bg-white">
            <button
              onClick={() => setDatePickerOpen(false)}
              className="px-6 py-2 text-[14px] font-semibold text-gray-600 hover:bg-gray-50 rounded-xl transition"
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
                  // Keep active cross-filters when only the period changes —
                  // the dashboard rebuilds for the new range with the same selection.
                }
              }}
              className="px-8 py-2 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 disabled:bg-gray-100 disabled:text-gray-400 transition shadow-lg shadow-emerald-100"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
