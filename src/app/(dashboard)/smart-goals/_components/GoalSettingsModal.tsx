"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  activeGoals,
  effectiveTarget,
  emptySettings,
  goalRowsFor,
  isPeriodCompleted,
  type GoalConfig,
  type SettingsValidation,
  type SmartGoalsSettings,
  validateSettings,
} from "@/lib/smartGoals";
import type { GoalMetricDef } from "@/lib/smartGoalMetrics";
import { formatGoalValue, formatPeriod } from "./format";
import PeriodPicker from "./PeriodPicker";
import { COLOR_PALETTE } from "./AchievementCenter";

// Goal Settings — the modal every other part of Smart Goals reads from.
//
// One row per preset metric: on/off, a target that is either typed in or
// derived ("Auto"), and a radio picking the single goal the AI focuses on.
// Saving is blocked while anything is invalid, and the offending rows say why
// rather than just refusing.

function GoalRow({
  goal,
  def,
  draft,
  metrics,
  validation,
  focus,
  patchGoal,
  setDraft,
  onMove,
  isFirst,
  isLast,
}: {
  goal: GoalConfig;
  def: GoalMetricDef;
  draft: SmartGoalsSettings;
  metrics: GoalMetricDef[];
  validation: SettingsValidation;
  focus: string | null;
  patchGoal: (metric: string, patch: Partial<GoalConfig>) => void;
  setDraft: React.Dispatch<React.SetStateAction<SmartGoalsSettings>>;
  /** Move this goal up (-1) or down (+1) in the display order. */
  onMove: (dir: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const derived = !!def.derivedFrom;
  const auto = derived && goal.auto;
  const computed = effectiveTarget(goal, draft, metrics);
  const error = validation.errors[goal.metric];
  const currentColor = goal.color ?? COLOR_PALETTE[0];
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2.5 sm:gap-3">
        {/* Reorder controls — set the display order without dragging, which is
            awkward on a phone. The order is the card order on the Smart Goals
            page and is independent of the dashboards. */}
        <div className="flex flex-col shrink-0 -my-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={isFirst}
            aria-label={`Move ${def.label} up`}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-25 disabled:hover:text-gray-400 leading-none"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            >
              <polyline points="6 15 12 9 18 15" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={isLast}
            aria-label={`Move ${def.label} down`}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-25 disabled:hover:text-gray-400 leading-none"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
        <input
          type="checkbox"
          checked={goal.enabled}
          onChange={() => patchGoal(goal.metric, { enabled: !goal.enabled })}
          className="rounded shrink-0 cursor-pointer accent-emerald-600"
          aria-label={`Track ${def.label}`}
        />

        {/* Color Picker Button & Popover */}
        <div className="relative shrink-0">
          <button
            type="button"
            disabled={!goal.enabled}
            onClick={() => setPickerOpen((v) => !v)}
            style={{ backgroundColor: currentColor }}
            className="w-4 h-4 rounded sm:rounded-md border border-black/10 transition disabled:opacity-40"
            title="Pick color"
          />
          {pickerOpen && goal.enabled && (
            <div className="absolute left-0 top-6 z-50 bg-white border border-gray-200 rounded-lg p-2 shadow-lg flex gap-1.5">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  style={{ backgroundColor: c }}
                  onClick={() => {
                    patchGoal(goal.metric, { color: c });
                    setPickerOpen(false);
                  }}
                  className={`w-5 h-5 rounded-md border ${
                    currentColor === c ? "ring-2 ring-emerald-500 border-white" : "border-black/10"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        <span
          className={`text-[13px] font-medium w-24 sm:w-28 shrink-0 ${goal.enabled ? "text-gray-800" : "text-gray-400"}`}
        >
          {def.label}
        </span>

        {/* Target — typed in, or derived and shown read-only. */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {auto ? (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-0.5 shrink-0">
                Auto
              </span>
              <span className="text-[13px] text-gray-600 tabular-nums truncate">
                {formatGoalValue(computed, def.format)}
              </span>
            </div>
          ) : (
            <input
              type="number"
              inputMode="decimal"
              value={goal.target ?? ""}
              disabled={!goal.enabled}
              onChange={(e) =>
                patchGoal(goal.metric, {
                  target: e.target.value === "" ? null : Number(e.target.value),
                })
              }
              placeholder={def.format === "ratio" ? "3.5" : "10000"}
              className={`w-32 bg-white border rounded-lg px-2.5 py-1.5 text-[13px] tabular-nums focus:outline-none transition ${
                error
                  ? "border-red-300 focus:border-red-400"
                  : "border-gray-200 focus:border-emerald-400"
              } ${!goal.enabled ? "opacity-50" : ""}`}
            />
          )}
          {derived && (
            <button
              type="button"
              disabled={!goal.enabled}
              onClick={() => patchGoal(goal.metric, { auto: !goal.auto })}
              className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-40 shrink-0"
            >
              {auto ? "Set manually" : "Use Auto"}
            </button>
          )}
        </div>

        <input
          type="radio"
          name="ai-focus"
          checked={focus === goal.metric}
          disabled={!goal.enabled}
          onChange={() => setDraft((d) => ({ ...d, aiFocus: goal.metric }))}
          className="shrink-0 cursor-pointer accent-emerald-600"
          aria-label={`Make ${def.label} the AI focus`}
        />
      </div>
      {error && <p className="text-[11px] text-red-500 mt-1 ml-7">{error}</p>}
    </div>
  );
}

export default function GoalSettingsModal({
  period,
  connector,
  metrics,
  initial,
  onPeriodChange,
  rememberedMonth,
  onSave,
  onClose,
  saving,
  saveError,
}: {
  period: string;
  connector: string;
  /** The metrics THIS source has — the list of goals it can carry. */
  metrics: GoalMetricDef[];
  /** Existing settings, or null when this period has none yet. */
  initial: SmartGoalsSettings | null;
  onPeriodChange: (period: string) => void;
  /** Passed to the picker so switching to months returns to the one last
   *  looked at rather than to January. */
  rememberedMonth: string;
  onSave: (settings: SmartGoalsSettings) => void;
  onClose: () => void;
  saving: boolean;
  saveError: string | null;
}) {
  const [draft, setDraft] = useState<SmartGoalsSettings>(
    () => initial ?? emptySettings(period, connector, metrics),
  );
  // A finished period can still be given goals. Not to plan it — that ship has
  // sailed — but to measure it: "we should have been aiming at this" is how you
  // find out whether a past year was actually any good, and it is the only way
  // to compare one against another. Blocking it left whole years unusable.
  const past = isPeriodCompleted(period, new Date());
  const validation = useMemo(() => validateSettings(draft, metrics), [draft, metrics]);
  // The AI focus falls back to the first enabled goal; showing that fallback
  // selected is more honest than showing nothing chosen.
  const focus = draft.aiFocus ?? activeGoals(draft)[0]?.metric ?? null;

  const patchGoal = (metric: string, patch: Partial<GoalConfig>) =>
    setDraft((d) => {
      // A metric with no stored goal yet is added on first touch, so switching
      // on something the source gained later just works.
      if (!d.goals.some((g) => g.metric === metric)) {
        const def = metrics.find((m) => m.key === metric);
        return {
          ...d,
          goals: [
            ...d.goals,
            {
              metric,
              enabled: false,
              order: d.goals.length,
              target: null,
              auto: !!def?.derivedFrom,
              ...patch,
            },
          ],
        };
      }
      return { ...d, goals: d.goals.map((g) => (g.metric === metric ? { ...g, ...patch } : g)) };
    });

  const rows = goalRowsFor(draft, metrics);

  // Move a goal up/down in the display order. Works off the current displayed
  // sequence and renumbers every row by its new position, so the order sticks
  // whether or not each metric had a saved goal yet. Purely the goals' own
  // order — dashboards are untouched.
  const moveGoal = (metric: string, dir: -1 | 1) =>
    setDraft((d) => {
      const ordered = goalRowsFor(d, metrics);
      const idx = ordered.findIndex((g) => g.metric === metric);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= ordered.length) return d;
      const arr = [...ordered];
      [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
      return { ...d, goals: arr.map((g, i) => ({ ...g, order: i })) };
    });

  // Escape closes it, like the backdrop already does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-6 overflow-y-auto">
      <div className="fixed inset-0 bg-gray-900/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-xl border border-gray-200 my-0 sm:my-8 max-h-[90vh] sm:max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold text-gray-900">Goal settings</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">
              Pick the goals to track for {formatPeriod(period)} and what counts as success.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 shrink-0"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-4 sm:px-5 py-4 space-y-5 flex-1 overflow-y-auto">
          {/* Goals */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                Goals
              </p>
              <p className="text-[11px] text-gray-400">AI focus</p>
            </div>
            <div className="border border-gray-200 rounded-xl divide-y divide-gray-100">
              {rows.map((goal, i) => {
                const def = metrics.find((m) => m.key === goal.metric)!;
                return (
                  <GoalRow
                    key={goal.metric}
                    goal={goal}
                    def={def}
                    draft={draft}
                    metrics={metrics}
                    validation={validation}
                    focus={focus}
                    patchGoal={patchGoal}
                    setDraft={setDraft}
                    onMove={(dir) => moveGoal(goal.metric, dir)}
                    isFirst={i === 0}
                    isLast={i === rows.length - 1}
                  />
                );
              })}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              The AI focus is the one goal recommendations are built around. Leave it unset and the
              first goal is used.
            </p>
          </div>

          {/* Margin + timeline preference */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Average product margin
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={draft.marginPct}

                  onChange={(e) => setDraft((d) => ({ ...d, marginPct: Number(e.target.value) }))}
                  className="w-24 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px] tabular-nums focus:outline-none focus:border-emerald-400"
                />
                <span className="text-[13px] text-gray-500">%</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Turns revenue into gross profit — that&apos;s what makes Net Profit computable.
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Event timeline
              </p>
              <label className="flex items-center gap-2 text-[13px] text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.alwaysShowTimeline}

                  onChange={() =>
                    setDraft((d) => ({ ...d, alwaysShowTimeline: !d.alwaysShowTimeline }))
                  }
                  className="rounded accent-emerald-600"
                />
                Always show the timeline expanded
              </label>
            </div>
          </div>

          {validation.formErrors.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {validation.formErrors.map((e) => (
                <p key={e} className="text-[12px] text-amber-700">
                  {e}
                </p>
              ))}
            </div>
          )}
          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-[12px] text-red-600">{saveError}</p>
            </div>
          )}
        </div>

        {/* Footer — sticky at the bottom on mobile */}
        <div className="px-4 sm:px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-3.5 py-2 text-[13px] font-medium text-gray-600 hover:text-gray-800 transition"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            disabled={!validation.canSave || saving}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
