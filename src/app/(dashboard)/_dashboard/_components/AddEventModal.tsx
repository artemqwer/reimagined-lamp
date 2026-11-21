"use client";

import React, { useEffect, useState } from "react";
import type { EventType } from "../_data/types";
import { EVENT_TYPES, MANUAL_TYPES } from "./Timeline";

interface AddEventModalProps {
  evtType: EventType;
  evtStartDate: string;
  evtEndDate: string;
  evtTitle: string;
  evtDesc: string;
  editing?: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onDelete?: () => void;
  onTypeChange: (v: EventType) => void;
  onStartDateChange: (v: string) => void;
  onEndDateChange: (v: string) => void;
  onTitleChange: (v: string) => void;
  onDescChange: (v: string) => void;
}

/** Escape closes any modal — the first thing people try, and on this one there
 *  was no second way out that didn't involve aiming at a small ✕. */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export default function AddEventModal({
  evtType,
  evtStartDate,
  evtEndDate,
  evtTitle,
  evtDesc,
  editing = false,
  onClose,
  onSubmit,
  onDelete,
  onTypeChange,
  onStartDateChange,
  onEndDateChange,
  onTitleChange,
  onDescChange,
}: AddEventModalProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEscape(onClose);
  // The end date input already carries min={evtStartDate}, which a date picker
  // honours but typing straight into the field does not — a backwards range
  // reached the server and saved.
  const backwards = !!evtEndDate && !!evtStartDate && evtEndDate < evtStartDate;
  return (
    <div className="fixed inset-0 z-[500] flex items-end sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/40 animate-in fade-in duration-200"
        onClick={onClose}
      />
      <div className="relative bg-zinc-900 sm:rounded-2xl shadow-2xl w-full sm:max-w-xl mx-auto flex flex-col animate-in slide-in-from-bottom sm:slide-in-from-top-2 sm:zoom-in-95 duration-300 h-full sm:h-auto sm:max-h-[92svh]">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--brand)"
                strokeWidth="2.5"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div>
              <h3 className="text-[16px] font-bold text-zinc-100">
                {editing ? "Edit Event" : "Add Event"}
              </h3>
              <p className="text-[12px] text-zinc-500">
                Mark a change and track its impact on your metrics
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-zinc-800 text-zinc-500 transition-colors"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-5 overflow-y-auto flex-1">
          {/* Category — only the manual categories (Ads & Holidays are automatic) */}
          <div>
            <p className="text-[12px] font-semibold text-zinc-300 mb-2">Category</p>
            <div className="grid grid-cols-2 gap-2">
              {MANUAL_TYPES.map((t) => {
                const meta = EVENT_TYPES[t];
                const active = evtType === t;
                return (
                  <button
                    key={t}
                    onClick={() => onTypeChange(t)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[13px] font-medium transition-all"
                    style={
                      active
                        ? {
                            borderColor: meta.color,
                            background: meta.bg,
                            color: meta.color,
                            boxShadow: `inset 0 0 0 1px ${meta.color}`,
                          }
                        : { borderColor: "#3F3F46", color: "#4B5563" }
                    }
                  >
                    <span style={{ color: active ? meta.color : "#71717A" }}>{meta.icon}</span>
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#71717A"
                strokeWidth="2"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <p className="text-[12px] font-semibold text-zinc-300">Event Title</p>
            </div>
            <input
              type="text"
              maxLength={80}
              value={evtTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="e.g., Homepage redesign launch"
              className="w-full text-[14px] border border-zinc-800 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50 bg-zinc-900 transition-all placeholder-gray-300"
            />
            <div className="flex justify-end mt-1">
              <p className="text-[10px] font-medium text-zinc-500">{evtTitle.length}/80</p>
            </div>
          </div>

          {/* Date */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#71717A"
                strokeWidth="2"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <p className="text-[12px] font-semibold text-zinc-300">Date Range</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative">
                <p className="text-[11px] text-zinc-500 mb-1 ml-1 font-medium">Start Date</p>
                <input
                  type="date"
                  value={evtStartDate}
                  onChange={(e) => onStartDateChange(e.target.value)}
                  className="w-full text-[14px] border border-zinc-800 rounded-xl px-3 py-2.5 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50 bg-zinc-900 transition-all appearance-none min-h-[44px]"
                />
              </div>
              <div className="relative">
                <p className="text-[11px] text-zinc-500 mb-1 ml-1 font-medium">
                  End Date <span className="opacity-60">(Optional)</span>
                </p>
                <input
                  type="date"
                  value={evtEndDate}
                  min={evtStartDate}
                  onChange={(e) => onEndDateChange(e.target.value)}
                  className="w-full text-[14px] border border-zinc-800 rounded-xl px-3 py-2.5 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50 bg-zinc-900 transition-all appearance-none min-h-[44px]"
                />
              </div>
            </div>
            {backwards && (
              <p className="text-[11px] text-red-600 mt-2 ml-1 font-medium">
                The event would end before it starts. Move the end date later, or clear it.
              </p>
            )}
            <p className="text-[11px] text-zinc-500 mt-2 ml-1">
              Leave end date empty for a single-day or ongoing event
            </p>
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#71717A"
                strokeWidth="2"
              >
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              <p className="text-[12px] font-semibold text-zinc-300">
                Description <span className="font-normal text-zinc-500">(Optional)</span>
              </p>
            </div>
            <textarea
              rows={3}
              value={evtDesc}
              onChange={(e) => onDescChange(e.target.value)}
              placeholder="Add additional details about this event..."
              className="w-full text-[14px] border border-zinc-800 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50 bg-zinc-900 transition-all placeholder-gray-300 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-zinc-800 shrink-0">
          {editing && onDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="py-2.5 px-3 rounded-xl border border-red-500/20 text-[14px] font-medium text-red-600 hover:bg-red-500/10 transition flex items-center gap-1.5"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-zinc-800 text-[14px] font-medium text-zinc-300 hover:bg-zinc-800/60 transition"
          >
            Cancel
          </button>
          <button
            disabled={!evtTitle.trim() || !evtStartDate || backwards}
            onClick={onSubmit}
            className="flex-1 py-2.5 rounded-xl text-[14px] font-semibold transition bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
          >
            {editing ? "Save" : "Add Event"}
          </button>
        </div>

        {/* Delete confirmation (#21) */}
        {confirmDelete && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-5">
            <div
              className="absolute inset-0 bg-black/40 animate-in fade-in duration-150"
              onClick={() => setConfirmDelete(false)}
            />
            <div className="relative card-elevate rounded-2xl shadow-2xl w-full max-w-sm p-5 animate-in zoom-in-95 fade-in duration-200">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#DC2626"
                    strokeWidth="2.5"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </div>
                <h4 className="text-[16px] font-bold text-zinc-100">Delete event?</h4>
              </div>
              <p className="text-[13px] text-zinc-400 leading-relaxed mb-5">
                Are you sure you want to delete
                {evtTitle.trim() ? (
                  <span className="font-semibold text-zinc-300"> “{evtTitle}”</span>
                ) : (
                  " this event"
                )}
                ? This action cannot be undone.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 py-2.5 rounded-xl border border-zinc-800 text-[14px] font-medium text-zinc-300 hover:bg-zinc-800/60 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setConfirmDelete(false);
                    onDelete?.();
                  }}
                  className="flex-1 py-2.5 rounded-xl text-[14px] font-semibold bg-red-600 text-white hover:bg-red-700 transition"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
