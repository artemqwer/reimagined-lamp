"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activeGoals,
  effectiveTarget,
  emptySettings,
  goalStatus,
  healthSummary,
  lastNDaysRange,
  periodFor,
  periodKind,
  periodPositionText,
  periodProgress,
  periodRange,
  resolveAiFocus,
  type SmartGoalsSettings,
} from "@/lib/smartGoals";
import { goalMetricsFor, metricValue } from "@/lib/smartGoalMetrics";
import {
  bucketize,
  forecastFor,
  goalSeries,
  periodBuckets,
  totalsOf,
  type DailyRow,
} from "@/lib/smartGoalsData";
import { CONNECTORS, connectorTableList, getConnector } from "@/lib/connectors";
import { useCrossFilter } from "@/lib/store";
import type { TimelineEvent } from "@/lib/smartGoalEvents";
import { detectAnomalies } from "@/lib/smartGoalAnomalies";
import { holidaysBetween } from "@/lib/holidays";
import GoalSettingsModal from "./_components/GoalSettingsModal";
import AchievementCenter from "./_components/AchievementCenter";
import GoalProgressChart, { CHART_INSET } from "./_components/GoalProgressChart";
import AddCustomEventModal, { type EditableEvent } from "./_components/AddCustomEventModal";
import ForecastPanel from "./_components/ForecastPanel";
import Timeline from "@/app/(dashboard)/_dashboard/_components/Timeline";
import type { CustomEvent } from "@/app/(dashboard)/_dashboard/_data/types";
import { findOpportunities, type EntityRow } from "@/lib/aiOptimizer";
import { formatPeriod } from "./_components/format";

// What the page remembers between visits. Re-picking the source, the period and
// the granularity on every load is exactly the busywork this page exists to
// remove.
const STORE_PREFIX = "smartGoals.";
const readStored = (key: string): string | null => {
  try {
    return window.localStorage.getItem(STORE_PREFIX + key);
  } catch {
    return null;
  }
};
const writeStored = (key: string, value: string) => {
  try {
    window.localStorage.setItem(STORE_PREFIX + key, value);
  } catch {
    /* storage unavailable — the page just won't remember, which is survivable */
  }
};
/** A stored period is only used if it still parses. A value left by an older
 *  build would otherwise throw on the first render and take the page with it. */
const storedPeriod = (key: string, kind: "month" | "year"): string | null => {
  const v = readStored(key);
  try {
    return v && periodKind(v) === kind ? v : null;
  } catch {
    return null;
  }
};
import PeriodPicker from "./_components/PeriodPicker";
import HelpTip from "./_components/HelpTip";
import PageSourceTabs from "@/components/PageSourceTabs";

// Smart Goals — the goal layer over the Google Ads account.
//
// Everything on this page is a view of three things: the goals configured for
// the selected period, the account's actual daily numbers for it, and where in
// the period we are. The rules live in lib/smartGoals.ts; this wires them to
// the data and the screen.

type Granularity = "daily" | "monthly";

/**
 * What to say when the targets on screen were not typed for this period.
 *
 * Silence would be worse than wrong here: a rolled-up year looks exactly like
 * a year somebody committed to, and the difference matters when the numbers
 * are being judged against.
 */
const GOAL_SOURCE_NOTE: Record<string, string> = {
  rolled_up: "From your monthly goals",
  split: "From your yearly goals",
  carried: "Carried over",
};

const GOAL_SOURCE_HELP: Record<string, string> = {
  rolled_up:
    "You have not set goals for this year, so these come from the months you did plan: a monthly target carried across twelve months, and a rate left as it is — a 4x month is a 4x year, not 48x.",
  split:
    "You have not set goals for this month, so these are its share of the year you planned: a yearly target split twelve ways, and a rate left as it is.",
  carried:
    "You have not set goals for this period, so these are the ones from the period before it.",
};

export default function SmartGoalsPage() {
  // Goals belong to a source: each has its own metrics, so a revenue target for
  // Google Ads says nothing about GA4. The page follows whichever source is
  // selected, the same one the rest of the dashboard is showing.
  const activeConnector = useCrossFilter((s) => s.activeConnector);
  const connectorConfigs = useCrossFilter((s) => s.connectorConfigs);
  const connectorsVersion = useCrossFilter((s) => s.connectorsVersion);
  const metrics = useMemo(
    () => goalMetricsFor(activeConnector, connectorConfigs[activeConnector]?.metrics),
    // connectorsVersion: admin-added sources reach the registry asynchronously,
    // and their metrics arrive with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeConnector, connectorConfigs, connectorsVersion],
  );
  const metricOf = useCallback((key: string) => metrics.find((m) => m.key === key), [metrics]);

  // Granularity and the period it applies to are remembered, here and across
  // reloads. Switching to Monthly and back used to rebuild the month from the
  // year alone, which always came back as January — so anyone who glanced at
  // the yearly view lost the month they were working on and had to find it
  // again.
  // Defaults first, then whatever was remembered — read in an effect rather
  // than in the initial state, so the server and the first client render agree
  // and React doesn't report a hydration mismatch.
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [monthPeriod, setMonthPeriod] = useState(() => periodFor(new Date(), "month"));
  const [yearPeriod, setYearPeriod] = useState(() => periodFor(new Date(), "year"));
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const g = readStored("granularity");
    if (g === "daily" || g === "monthly") setGranularity(g);
    const m = storedPeriod("monthPeriod", "month");
    if (m) setMonthPeriod(m);
    const y = storedPeriod("yearPeriod", "year");
    if (y) setYearPeriod(y);
    setRestored(true);
  }, []);
  const period = granularity === "daily" ? monthPeriod : yearPeriod;
  /**
   * The period picked, whichever shape it has.
   *
   * The shape is the granularity — a month is read day by day, a year month by
   * month — so one choice sets both. Picking a month also moves the remembered
   * year to it, so the two never drift apart.
   */
  const setPeriod = useCallback((next: string) => {
    if (periodKind(next) === "year") {
      setYearPeriod(next);
      setGranularity("monthly");
    } else {
      setMonthPeriod(next);
      setYearPeriod(next.slice(0, 4));
      setGranularity("daily");
    }
  }, []);

  useEffect(() => {
    // Only once the remembered values have been read, or the defaults would
    // overwrite them on the way in.
    if (!restored) return;
    writeStored("granularity", granularity);
    writeStored("monthPeriod", monthPeriod);
    writeStored("yearPeriod", yearPeriod);
  }, [restored, granularity, monthPeriod, yearPeriod]);

  const [settings, setSettings] = useState<SmartGoalsSettings | null>(null);
  // Where the goals on screen came from. Numbers the user did not type here
  // have to say so, or a rolled-up year reads as a commitment they made.
  const [goalSource, setGoalSource] = useState<string>("empty");
  const [settingsLoading, setSettingsLoading] = useState(true);
  // Distinguished from "no goals yet": a failed load that rendered the empty
  // state would tell someone their goals don't exist, and the CTA there would
  // then overwrite them.
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [rows, setRows] = useState<DailyRow[] | null>(null);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [manualEvents, setManualEvents] = useState<TimelineEvent[]>([]);
  // The source's primary entities for the period — campaigns, channels,
  // queries — which is what the optimizer compares against each other.
  const [entityRows, setEntityRows] = useState<EntityRow[] | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  // Set when a timeline event is being edited (null = the modal creates a new
  // one). Same edit/delete flow the dashboard timeline uses.
  const [editEvent, setEditEvent] = useState<EditableEvent | null>(null);
  // Clicking an event's Edit in the timeline opens the same modal, pre-filled.
  const openEditEvent = useCallback(
    (m: {
      id: string;
      type: string;
      startDate: string;
      endDate?: string;
      title: string;
      desc?: string;
    }) => {
      setEditEvent({
        id: m.id,
        category: m.type,
        startDate: m.startDate,
        endDate: m.endDate ?? "",
        title: m.title,
        desc: m.desc ?? "",
      });
      setEventModalOpen(true);
    },
    [],
  );
  const openAddEvent = useCallback(() => {
    setEditEvent(null);
    setEventModalOpen(true);
  }, []);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);

  // The goal settings carry a "keep the timeline expanded" switch; honour it as
  // the default open state whenever the settings (re)load. The user can still
  // collapse it by hand afterwards — this only sets where it starts.
  useEffect(() => {
    if (settings) setTimelineOpen(settings.alwaysShowTimeline);
  }, [settings?.alwaysShowTimeline]); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteEvent = useCallback(
    (id: string) => {
      // Gone from the lane at once; put back if the delete didn't take.
      const before = manualEvents;
      setManualEvents((prev) => prev.filter((e) => e.id !== id));
      fetch(`/api/custom-events/${encodeURIComponent(id)}`, { method: "DELETE" })
        .then((r) => {
          if (!r.ok) setManualEvents(before);
        })
        .catch(() => setManualEvents(before));
    },
    [manualEvents],
  );

  const now = useMemo(() => new Date(), []);
  const progress = useMemo(() => periodProgress(period, now), [period, now]);
  const range = useMemo(() => periodRange(period), [period]);
  const dateFrom = range.start.toISOString().slice(0, 10);
  const dateTo = new Date(range.endExclusive.getTime() - 86_400_000).toISOString().slice(0, 10);
  // "View as Client": read this client's goals + actuals (set on the admin page).
  const viewAs = useMemo(
    () => (typeof window !== "undefined" ? sessionStorage.getItem("dr_view_as") : null),
    [],
  );
  const viewAsQS = viewAs ? `&view_as=${encodeURIComponent(viewAs)}` : "";

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const res = await fetch(
        `/api/smart-goals?period=${encodeURIComponent(period)}&connector=${encodeURIComponent(activeConnector)}${viewAsQS}`,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Could not load goals (${res.status})`);
      setSettings(json.settings ?? null);
      setGoalSource(json.source ?? "empty");
    } catch (e) {
      setSettings(null);
      setGoalSource("empty");
      setSettingsError(e instanceof Error ? e.message : "Could not load goals");
    } finally {
      setSettingsLoading(false);
    }
  }, [period, activeConnector]);

  // The dashboard's events, not a separate set: one timeline means one store.
  // /api/custom-events returns them all, so the period filter happens here.
  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/custom-events");
      const json = await res.json().catch(() => ({}));
      const all = res.ok ? (json.events ?? json ?? []) : [];
      setManualEvents(
        (Array.isArray(all) ? all : [])
          .filter(
            (e) => (e.startDate ?? "") <= dateTo && (e.endDate || e.startDate || "") >= dateFrom,
          )
          .map((e) => ({
            id: String(e.id),
            category: e.category,
            type: e.type ?? "",
            startDate: e.startDate,
            endDate: e.endDate ?? null,
            title: e.title,
            description: e.desc ?? null,
            source: "manual",
          })) as TimelineEvent[],
      );
    } catch {
      setManualEvents([]);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // The account's daily numbers for the period — the same endpoint the
  // campaigns dashboard reads, grouped by date.
  useEffect(() => {
    let cancelled = false;
    setRowsLoading(true);
    // The source's own daily rows — including whatever metrics an admin
    // registered for it, which arrive in each row's `extra`.
    const connectorQS =
      activeConnector === "google_ads" ? "" : `&connector=${encodeURIComponent(activeConnector)}`;
    fetch(
      `/api/windsor?date_from=${dateFrom}&date_to=${dateTo}&group_by=date${connectorQS}${viewAsQS}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        setRows(Array.isArray(json?.data) ? json.data : []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setRowsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, activeConnector]);

  // Every breakdown this source has: its primary entity plus the tables the
  // admin left visible. Read from the same registry the dashboard's tables use.
  const breakdowns = useMemo(() => {
    const c = getConnector(activeConnector);
    const primary = { key: c.primaryDimension, label: c.primaryLabel };
    const rest = connectorTableList(activeConnector, c.primaryDimension)
      .filter((t) => t.available && !t.custom)
      .map((t) => ({ key: t.key, label: t.dimensionLabel }));
    return [primary, ...rest];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnector, connectorConfigs, connectorsVersion]);

  // The summary on this page is about the source's primary entity; the full
  // analysis on its own page is what walks every breakdown.
  const activeBreakdown = breakdowns[0]?.key;

  // The same period, grouped by whichever breakdown is being analysed.
  useEffect(() => {
    let cancelled = false;
    setEntityRows(null);
    const primary = activeBreakdown ?? getConnector(activeConnector).primaryDimension;
    const connectorQS =
      activeConnector === "google_ads" ? "" : `&connector=${encodeURIComponent(activeConnector)}`;
    fetch(
      `/api/windsor?date_from=${dateFrom}&date_to=${dateTo}&group_by=${encodeURIComponent(primary)}${connectorQS}${viewAsQS}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows: any[] = Array.isArray(json?.data) ? json.data : [];
        setEntityRows(
          rows.map((r) => ({
            name: String(r.dimension ?? "Unknown"),
            totals: {
              clicks: Number(r.clicks) || 0,
              impressions: Number(r.impressions) || 0,
              cost: Number(r.spend) || 0,
              conversions: Number(r.conversions) || 0,
              revenue: Number(r.conversion_value) || 0,
              extra: (r.extra as Record<string, number>) ?? {},
            },
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setEntityRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, activeConnector, activeBreakdown]);

  const buckets = useMemo(() => bucketize(period, rows ?? [], progress), [period, rows, progress]);
  const totals = useMemo(() => totalsOf(buckets.filter((b) => b.elapsed)), [buckets]);

  // Goals on metrics this source no longer has are dropped rather than
  // rendered: an admin can retire a metric, and a card nobody can compute is
  // worse than no card.
  const goals = useMemo(
    () => (settings ? activeGoals(settings).filter((g) => metricOf(g.metric)) : []),
    [settings, metricOf],
  );
  const targets = useMemo(() => {
    const out: Record<string, number | null> = {};
    if (settings) for (const g of goals) out[g.metric] = effectiveTarget(g, settings, metrics);
    return out;
  }, [goals, settings, metrics]);

  const statuses = useMemo(() => {
    if (!settings) return [];
    return goals
      .map((g) => {
        const def = metricOf(g.metric);
        const target = targets[g.metric];
        if (!def || target === null || target === undefined) return null;
        return goalStatus({
          def,
          actual: metricValue(g.metric, totals, settings.marginPct),
          target,
          progress,
        });
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }, [goals, targets, totals, settings, progress, metricOf]);

  const health = useMemo(
    () => healthSummary(statuses, progress.completed),
    [statuses, progress.completed],
  );
  // Shared by the top chip and the achievement badge — an active period only,
  // since "days left" says nothing once it's over or hasn't started.
  const daysLeftLabel =
    !progress.completed && !progress.future
      ? `${progress.bucketsRemaining} ${granularity === "daily" ? "days" : "months"} left`
      : "";

  const chartRef = useRef<HTMLDivElement>(null);
  const handleSelectMetric = (metric: string) => {
    setSelected(metric);
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      chartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // The chart follows the selected card, defaulting to whatever the AI is
  // focused on — the goal the account is actually being run for.
  const focus = settings ? resolveAiFocus(settings) : null;
  const charted = selected && goals.some((g) => g.metric === selected) ? selected : focus;
  const chartedDef = charted ? metricOf(charted) : undefined;
  const chartSeries = useMemo(
    () =>
      chartedDef && settings
        ? goalSeries(chartedDef, buckets, targets[chartedDef.key] ?? null, settings.marginPct)
        : [],
    [chartedDef, buckets, targets, settings],
  );

  const forecasts = useMemo(() => {
    if (!settings || progress.completed) return [];
    return goals
      .map((g) => {
        const def = metricOf(g.metric);
        return def ? forecastFor(def, buckets, settings.marginPct, progress) : null;
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
  }, [goals, buckets, settings, progress, metricOf]);

  // The AI Optimizer summary shown under the forecast is about the account's
  // CURRENT state, not this calendar period — so it uses the same window the AI
  // Optimizer page does (its default 90 days), and is shown only for a current
  // period (this month, this year), never a past or future one. Same numbers a
  // user sees on the optimizer itself, in both month and year views.
  const isCurrentPeriod = !progress.completed && !progress.future;
  const [optimizerRows, setOptimizerRows] = useState<EntityRow[] | null>(null);
  useEffect(() => {
    if (!isCurrentPeriod) {
      setOptimizerRows(null);
      return;
    }
    let cancelled = false;
    // Don't blank the rows before the refetch lands — that made the AI Optimizer
    // summary block flicker out and back on every source/breakdown change. Keep
    // the last data on screen until the new data replaces it.
    const primary = activeBreakdown ?? getConnector(activeConnector).primaryDimension;
    const connectorQS =
      activeConnector === "google_ads" ? "" : `&connector=${encodeURIComponent(activeConnector)}`;
    const win = lastNDaysRange(90, now);
    const from = win.start.toISOString().slice(0, 10);
    const to = new Date(win.endExclusive.getTime() - 86_400_000).toISOString().slice(0, 10);
    fetch(
      `/api/windsor?date_from=${from}&date_to=${to}&group_by=${encodeURIComponent(primary)}${connectorQS}${viewAsQS}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rowsRaw: any[] = Array.isArray(json?.data) ? json.data : [];
        setOptimizerRows(
          rowsRaw.map((r) => ({
            name: String(r.dimension ?? "Unknown"),
            totals: {
              clicks: Number(r.clicks) || 0,
              impressions: Number(r.impressions) || 0,
              cost: Number(r.spend) || 0,
              conversions: Number(r.conversions) || 0,
              revenue: Number(r.conversion_value) || 0,
              extra: (r.extra as Record<string, number>) ?? {},
            },
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setOptimizerRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isCurrentPeriod, activeConnector, activeBreakdown, now]);

  const optimizer = useMemo(() => {
    const focusDef = focus ? metricOf(focus) : undefined;
    if (!focusDef || !settings || !isCurrentPeriod) return null;
    // Analyse every campaign, exactly like the optimizer page does now (the
    // threshold gates only the optimizer's campaign LIST, not the analysis) — so
    // this summary's count matches what the optimizer shows.
    const hasCost = getConnector(activeConnector).hasCost;
    return findOpportunities({
      rows: optimizerRows ?? [],
      focus: focusDef,
      marginPct: settings.marginPct,
      hasCost,
    });
  }, [optimizerRows, focus, metricOf, settings, activeConnector, isCurrentPeriod]);

  const save = async (next: SmartGoalsSettings) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/smart-goals${viewAsQS ? `?${viewAsQS.slice(1)}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not save the goals");
      setSettings(json.settings ?? next);
      // Saved here, so they are this period's own now — whatever they were
      // derived from before, the badge must stop claiming it.
      setGoalSource("own");
      setModalOpen(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save the goals");
    } finally {
      setSaving(false);
    }
  };

  const reorder = (from: string, to: string) => {
    if (!settings) return;
    const ordered = [...settings.goals].sort((a, b) => a.order - b.order);
    const fromIdx = ordered.findIndex((g) => g.metric === from);
    const toIdx = ordered.findIndex((g) => g.metric === to);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    const next = { ...settings, goals: ordered.map((g, i) => ({ ...g, order: i })) };
    setSettings(next);
    // Persisted immediately: a card order that survives a reload is the whole
    // point of being able to drag them.
    void save(next);
  };

  /** Retarget a goal from its card, without opening the settings modal. */
  const retarget = (metric: string, target: number) => {
    if (!settings) return;
    const next = {
      ...settings,
      goals: settings.goals.map((g) => (g.metric === metric ? { ...g, target, auto: false } : g)),
    };
    setSettings(next);
    void save(next);
  };

  const days = useMemo(() => periodBuckets(period), [period]);

  // The timeline is three sources at once: what the user recorded, the shopping
  // calendar, and the days the data itself flags. Merged here rather than in the
  // component so the component stays a renderer.
  const events = useMemo(() => {
    const holidays: TimelineEvent[] = holidaysBetween(dateFrom, dateTo).map((h) => ({
      id: `holiday-${h.date}-${h.key}`,
      category: "events",
      type: "holiday",
      startDate: h.date,
      endDate: null,
      title: h.title,
      source: "holiday",
    }));
    return [...manualEvents, ...holidays, ...detectAnomalies(buckets)];
  }, [manualEvents, dateFrom, dateTo, buckets]);

  /**
   * The same events, in the shape the shared timeline reads.
   *
   * Smart Goals kept its own timeline and its own event shape, so the same
   * promotion looked like two different things depending on which page you were
   * on. The component is now the dashboard's; only this mapping lives here —
   * and it carries all three sources, including the days the data itself
   * flagged, which a straight swap would have dropped.
   */
  const timelineEvents = useMemo<CustomEvent[]>(
    () =>
      events.map((e) => ({
        id: e.id,
        // The shared timeline picks the event icon from this category
        // (normalizeType). A holiday's own category ("events") resolved to the
        // ads/star mark, so it showed a star here while the dashboard showed a
        // calendar — hand the timeline "holidays" for holiday-sourced events so
        // both screens draw the same calendar icon.
        category: e.source === "holiday" ? "holidays" : e.category,
        type: e.type ?? null,
        startDate: e.startDate,
        // The shared shape has no "single day": a one-day event ends the day it
        // starts.
        endDate: e.endDate ?? e.startDate,
        title: e.title,
        desc: e.description ?? "",
      })),
    [events],
  );
  const loading = settingsLoading || rowsLoading;
  // A finished period's goals are a record of what was planned, not something
  // still being decided. Every way into the settings modal reads this — a
  // disabled header button with three other doors still open would be worse
  // than not disabling it at all.
  const editable = !progress.completed;

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1600px]">
      {/* The section's name and controls on the page itself, then one card
          holding the platform tabs and the achievement centre together. */}
      <PageSourceTabs
        title="Smart Goals"
        feature="smartGoals"
        actions={
          <>
            <PeriodPicker period={period} rememberedMonth={monthPeriod} onChange={setPeriod} />
            {/* Hidden on a phone: next to the period picker and the Edit goals
                button it pushed Edit goals onto a second line. The same
                days-left figure is on the achievement badge below, so nothing
                is lost. Kept from sm up, where there's room. */}
            <span className="hidden sm:inline-flex items-center text-[12px] text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1">
              {progress.completed
                ? "Period complete"
                : progress.future
                  ? "Not started yet"
                  : daysLeftLabel}
            </span>
            {settings && GOAL_SOURCE_NOTE[goalSource] && (
              <span className="inline-flex items-center gap-1 text-[12px] text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1">
                {GOAL_SOURCE_NOTE[goalSource] ?? ""}
                <HelpTip title="Where these targets came from">
                  {GOAL_SOURCE_HELP[goalSource] ?? ""} Editing them here saves a set of goals for
                  this period alone, which then takes over.
                </HelpTip>
              </span>
            )}
            {settings && (
              <button
                onClick={() => editable && setModalOpen(true)}
                disabled={!editable}
                title={
                  editable
                    ? undefined
                    : "Goals cannot be changed for completed periods. Only the current active period can be edited."
                }
                className="px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 transition disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-200"
              >
                Edit goals
              </button>
            )}
          </>
        }
      >
        {/* The achievement centre lives inside the section's card, under the
            platform tabs — one block, rather than a header panel and a second
            panel that happen to be adjacent. */}
        {!loading && !settingsError && settings && statuses.length > 0 && (
          <AchievementCenter
            health={health}
            statuses={statuses}
            metrics={metrics}
            goalsConfig={settings.goals}
            aiFocus={focus}
            selected={charted}
            completed={progress.completed}
            onSelect={handleSelectMetric}
            onReorder={reorder}
            positionText={periodPositionText(progress)}
            daysLeftLabel={daysLeftLabel}
            marginNote={`${Math.round(settings.marginPct)}% margin`}
            bare
          />
        )}
      </PageSourceTabs>

      {loading && (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* The load failed. Deliberately NOT the empty state: that would claim
          the goals don't exist and offer to replace them. */}
      {!loading && settingsError && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <p className="text-[15px] font-bold text-gray-900 mb-1">Couldn&apos;t load your goals</p>
          <p className="text-[13px] text-gray-500 mb-4">{settingsError}</p>
          <button
            onClick={loadSettings}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 transition"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty state — no goals for this period. Nothing else can be shown
          without them: there is no progress to track and no basis for advice. */}
      {!loading && !settingsError && !settings && (
        <div className="bg-white rounded-2xl border border-gray-200 px-5 py-8 sm:p-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#2563eb"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="6" />
              <circle cx="12" cy="12" r="2" />
            </svg>
          </div>
          <h2 className="text-[17px] font-bold text-gray-900 mb-1">No goals set</h2>
          <p className="text-[13px] text-gray-500 max-w-md mx-auto mb-4">
            Set your targets for {formatPeriod(period)} to start tracking progress and get
            recommendations.
          </p>
          {editable ? (
            <button
              onClick={() => setModalOpen(true)}
              className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 transition"
            >
              Set goals for {formatPeriod(period)}
            </button>
          ) : (
            <p className="text-[13px] text-gray-400">
              {formatPeriod(period)} is over, so its goals can no longer be set.
            </p>
          )}
          {/* The source's own metrics, not a fixed list. GA4 has no Budget or
              ROAS, and promising them here sends someone looking for a row that
              can't exist.
              As chips rather than a sentence: on a phone the list ran to three
              lines of grey prose that read as filler, where the same names in a
              row are scannable and say plainly that these are the things a goal
              can be set on. */}
          {metrics.length > 0 ? (
            <div className="mt-5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                {CONNECTORS[activeConnector]?.label ?? activeConnector} can track
              </p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {metrics.slice(0, 8).map((m) => (
                  <span
                    key={m.key}
                    className="text-[12px] text-gray-600 bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1"
                  >
                    {m.label}
                  </span>
                ))}
                {metrics.length > 8 && (
                  <span className="text-[12px] text-gray-400 px-1 py-1">
                    +{metrics.length - 8} more
                  </span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-gray-400 mt-3">
              This source has no metrics to set goals on yet.
            </p>
          )}
        </div>
      )}

      {!loading && !settingsError && settings && statuses.length > 0 && (
        <>
          {/* The chart and the timeline share one card — the spec draws the
              collapsed timeline as the chart's own bottom row, not a separate
              block, so an event and the line it sits under read as one thing. */}
          <div ref={chartRef} className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5">
            {chartedDef && (
              <GoalProgressChart
                def={chartedDef}
                points={chartSeries}
                target={targets[chartedDef.key] ?? null}
                daily={granularity === "daily"}
                hoverKey={hoverKey}
                onHoverKey={setHoverKey}
                accent={settings.goals.find((g) => g.metric === chartedDef.key)?.color ?? "#10b981"}
                bare
              />
            )}

            {/* The same timeline every source uses, so an event reads the same
                here as it does on the dashboard — one lane, one style. Two
                instances, not one with a prop the caller forgot: the dashboard
                itself never renders Timeline without picking a side, because
                the compact layout (no category icons, no divider) is a
                different arrangement of the SAME row, not a smaller version of
                the wide one — squeezed into a phone width, the wide one wraps
                and the Add Event button drifts off onto its own line. */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="sm:hidden">
                <Timeline
                  dates={days}
                  timelineOpen={timelineOpen}
                  customEvents={timelineEvents}
                  autoSourceLabel={CONNECTORS[activeConnector]?.label}
                  granularity={granularity === "daily" ? "days" : "months"}
                  onToggle={() => setTimelineOpen((v) => !v)}
                  onAddEvent={openAddEvent}
                  onDeleteEvent={deleteEvent}
                  onEditEvent={openEditEvent}
                  isMobile
                />
              </div>
              <div className="hidden sm:block">
                <Timeline
                  dates={days}
                  timelineOpen={timelineOpen}
                  customEvents={timelineEvents}
                  autoSourceLabel={CONNECTORS[activeConnector]?.label}
                  granularity={granularity === "daily" ? "days" : "months"}
                  onToggle={() => setTimelineOpen((v) => !v)}
                  onAddEvent={openAddEvent}
                  onDeleteEvent={deleteEvent}
                  onEditEvent={openEditEvent}
                  // Share the chart's plot area, so a date here lands under the
                  // same date there.
                  chartAlign={{ left: CHART_INSET.left, right: CHART_INSET.right }}
                  isMobile={false}
                />
              </div>
            </div>
          </div>

          {/* An active period gets a projection; a finished one gets what it
              came to. Showing nothing for the finished case read as the
              forecast being broken. */}
          <ForecastPanel
            forecasts={forecasts}
            targets={targets}
            metrics={metrics}
            optimizer={optimizer}
            impactFormat={metricOf(optimizer?.impactMetric ?? "")?.format ?? "money"}
            // The source's own word for what the optimizer compared, so a
            // GA4 account doesn't read "campaigns".
            entityNoun={(
              breakdowns.find((b) => b.key === activeBreakdown)?.label ?? "entities"
            ).toLowerCase()}
            daily={granularity === "daily"}
            outcomes={
              progress.completed
                ? statuses.map((st) => ({
                    metric: st.metric,
                    actual: st.actual,
                    target: st.target,
                  }))
                : undefined
            }
            loading={rowsLoading}
          />
        </>
      )}

      {/* Goals exist but none can be evaluated — every enabled goal is on Auto
          with nothing to derive from. */}
      {!loading && !settingsError && settings && statuses.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <p className="text-[13px] text-gray-500 mb-3">
            The goals for {formatPeriod(period)} don&apos;t have usable targets yet.
          </p>
          {editable && (
            <button
              onClick={() => setModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 transition"
            >
              Open goal settings
            </button>
          )}
        </div>
      )}

      {modalOpen && (
        <GoalSettingsModal
          period={period}
          connector={activeConnector}
          metrics={metrics}
          initial={settings ?? emptySettings(period, activeConnector, metrics)}
          onPeriodChange={setPeriod}
          rememberedMonth={monthPeriod}
          onSave={save}
          onClose={() => {
            setModalOpen(false);
            setSaveError(null);
          }}
          saving={saving}
          saveError={saveError}
        />
      )}

      {eventModalOpen && (
        <AddCustomEventModal
          defaultDate={
            // Somewhere inside the period, and today when that's inside it.
            !progress.completed && !progress.future ? now.toISOString().slice(0, 10) : dateFrom
          }
          editEvent={editEvent}
          onClose={() => {
            setEventModalOpen(false);
            setEditEvent(null);
          }}
          onCreated={loadEvents}
          onDeleted={loadEvents}
        />
      )}
    </div>
  );
}
