"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCrossFilter } from "@/lib/store";
import {
  CONNECTORS,
  connectorTableList,
  connectorSlug,
  getConnector,
  getDimensionDef,
} from "@/lib/connectors";
import type { Recommendation } from "@/lib/optimizerCategories";
import { goalMetricsFor } from "@/lib/smartGoalMetrics";
import {
  isPeriod,
  lastNDaysRange,
  periodFor,
  periodRange,
  resolveAiFocus,
  type SmartGoalsSettings,
} from "@/lib/smartGoals";
import {
  analyseAccount,
  categoryIcon,
  describeThresholds,
  resolveOptimizerThresholds,
  entitiesFromPerfRows,
  entitiesFromWindsorRows,
  formatImpact,
  summariseEntities,
  type CategoryInput,
  type Priority,
} from "@/lib/optimizerCategories";
import { dimApiBase, rowsApiBase } from "@/lib/dataSource";
import { normalizeChannelType } from "@/app/(dashboard)/_dashboard/_data/constants";
import type { EntityRow } from "@/lib/aiOptimizer";
import PageSourceTabs from "@/components/PageSourceTabs";
import { StatusIndicator } from "@/app/(dashboard)/_dashboard/_components/StatusIndicator";
import HealthRadar, { bandFor } from "./_components/HealthRadar";
import RecommendationCard from "./_components/RecommendationCard";
import HelpTip from "@/app/(dashboard)/smart-goals/_components/HelpTip";

// AI Optimizer — the whole account, one breakdown at a time.
//
// Every table the source exposes is fetched and analysed, so the answer to
// "where is this account losing ground" isn't limited to campaigns: it can be a
// search term, an hour of the day, a device. What it is measured against is the
// goal's AI focus, so the recommendations serve the target that was actually
// set rather than a generic idea of good.

type Tab = "open" | "completed" | "dismissed";

// Everything needed to reopen the dashboard on a recommendation's own data.
type ExploreCtx = {
  rangeStart: number;
  rangeEnd: number;
  filters: Record<string, string[]>;
  slug: string;
};
// The frozen analysis stored WITH a completed/dismissed mark, so the history
// tabs show exactly what was recommended at the time — not a rebuild from data
// that has since moved.
type RecSnapshot = {
  rec: Recommendation;
  impactLabel: string;
  impactFormat: "money" | "number";
  analysisPeriod: { from: string; to: string };
  explore: ExploreCtx;
};
type Mark = { state: "completed" | "dismissed"; at: string; snapshot?: RecSnapshot };

/** "Aug 10, 2026, 11:29 PM" — when it was marked, in the reader's own zone. */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/**
 * How a source's own status word should read on screen.
 *
 * Returns null for a status nobody reported: the badge and the dot are both
 * claims about the entity, and "Active" printed over a paused campaign is a
 * wrong one. Better to show nothing than to invent a state.
 */
function statusOf(raw: string | undefined): { label: string; fg: string; bg: string } | null {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return null;
  // Same scheme as the dashboard tables: active green, paused grey, removed red.
  if (s === "ENABLED" || s === "ACTIVE") return { label: "Active", fg: "#008236", bg: "#DCFCE7" };
  if (s === "PAUSED") return { label: "Paused", fg: "#4A5565", bg: "#F3F4F6" };
  if (s === "REMOVED") return { label: "Removed", fg: "#DC2626", bg: "#FEE2E2" };
  // A word this app hasn't seen — show it rather than swallow it.
  return { label: s.charAt(0) + s.slice(1).toLowerCase(), fg: "#6A7282", bg: "#F3F4F6" };
}

type StatusDot = "green" | "yellow" | "red" | "gray";

/** The status dot's colour, matching the dashboard tables' campaignStatusColor
 *  EXACTLY: the real serving status when the source reports it, a spend-based
 *  guess (spend > 0 → active) when it doesn't. Without the spend fallback an
 *  active campaign whose account doesn't expose campaign_status showed a grey
 *  "paused" dot in the optimizer while the dashboard correctly showed it green. */
function statusDotFor(status: unknown, spend: number): StatusDot {
  const s = String(status ?? "")
    .trim()
    .toUpperCase();
  if (s.includes("REMOV")) return "red";
  if (s.includes("PAUSE")) return "yellow"; // rendered as a grey dot
  if (s.includes("ENABLE") || s.includes("ACTIV") || s === "SERVING") return "green";
  return spend > 0 ? "green" : "gray";
}

/** The text badge for a resolved status-dot colour, so the open-entity header
 *  reads the SAME status as its row in the list (both off statusColors). */
function statusBadgeFor(c: StatusDot): { label: string; fg: string; bg: string } | null {
  if (c === "green") return { label: "Active", fg: "#008236", bg: "#DCFCE7" };
  if (c === "yellow") return { label: "Paused", fg: "#4A5565", bg: "#F3F4F6" };
  if (c === "red") return { label: "Removed", fg: "#DC2626", bg: "#FEE2E2" };
  return null;
}

const PRIORITY_PILL: Record<Priority, string> = {
  high: "bg-red-50 text-red-600 border-red-100",
  medium: "bg-amber-50 text-amber-600 border-amber-100",
  low: "bg-gray-50 text-gray-400 border-gray-200",
};

export default function AiOptimizerPage() {
  const params = useSearchParams();
  const activeConnector = useCrossFilter((s) => s.activeConnector);
  const connectorConfigs = useCrossFilter((s) => s.connectorConfigs);
  const connectorsVersion = useCrossFilter((s) => s.connectorsVersion);
  const setFilter = useCrossFilter((s) => s.setFilter);
  const clearAll = useCrossFilter((s) => s.clearAll);
  const router = useRouter();

  // Two different spans, deliberately.
  //
  // `period` is the calendar month a goal belongs to — it is what the AI focus
  // and the completed/dismissed marks are keyed by, and it must stay a month.
  //
  // The ANALYSIS window is the last 90 days unless a period was asked for by
  // name. Arriving on the 2nd of the month, a month-to-date window had two
  // days of data deciding every recommendation on the page; ninety days is
  // long enough for the slower signals to say something. Following a link from
  // a specific month still analyses that month.
  // A period that doesn't parse is ignored, not fatal. periodRange throws on
  // one, and thrown from a render that took the whole page down to the error
  // boundary — a stale bookmark or a hand-edited link was enough.
  const rawPeriod = params.get("period");
  const periodParam = rawPeriod && isPeriod(rawPeriod) ? rawPeriod : null;
  const period = periodParam ?? periodFor(new Date(), "month");
  // Absent = the account, every entity listed. Present = that one entity, with
  // every breakdown scoped to it.
  const openEntity = params.get("entity");
  const range = useMemo(
    () => (periodParam ? periodRange(periodParam) : lastNDaysRange(90, new Date())),
    [periodParam],
  );
  // Carried on the page's own links so opening a campaign keeps the window it
  // was opened from, rather than silently pinning a 90-day view to a month.
  const periodQS = periodParam ? `?period=${encodeURIComponent(periodParam)}` : "";
  const dateFrom = range.start.toISOString().slice(0, 10);
  const dateTo = new Date(range.endExclusive.getTime() - 86_400_000).toISOString().slice(0, 10);
  // "View as Client": every data fetch here carries the same view_as the
  // dashboard uses, so the optimizer analyses the CLIENT's account. Stable for
  // the session (set on the admin page before navigating in).
  const viewAs = useMemo(
    () => (typeof window !== "undefined" ? sessionStorage.getItem("dr_view_as") : null),
    [],
  );
  const viewAsQS = viewAs ? `&view_as=${encodeURIComponent(viewAs)}` : "";

  // ENABLED / PAUSED / REMOVED per entity, straight from the source. The badge
  // beside the name used to be the literal word "Active" for everything, so a
  // paused campaign looked like it was running.
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  // The resolved status-dot colour per entity, from the primary /api/windsor rows
  // (campaign_status + spend fallback) — the same basis the dashboard uses, so the
  // two never disagree. The raw `statuses` word above still drives the text label.
  const [statusColors, setStatusColors] = useState<Record<string, StatusDot>>({});
  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (activeConnector !== "google_ads") qs.set("connector", activeConnector);
    if (openEntity) qs.set("campaign", openEntity);
    if (viewAs) qs.set("view_as", viewAs);
    fetch(`/api/optimizer/health?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        if (j?.statuses) setStatuses(j.statuses as Record<string, string>);
      })
      .catch(() => {
        /* no statuses — the dot and badge simply aren't drawn */
      });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, activeConnector, openEntity]);

  // How many days in the window actually carry data — the denominator for the
  // monthly normalisation. NOT the window length: a new account with 25 days of
  // history in a 90-day window must divide by 25, or its monthly figure reads a
  // third of what it should. Counted from the platform's own daily rows.
  const [availableDays, setAvailableDays] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const qs =
      activeConnector === "google_ads" ? "" : `&connector=${encodeURIComponent(activeConnector)}`;
    fetch(`${rowsApiBase()}?date_from=${dateFrom}&date_to=${dateTo}&group_by=date${qs}${viewAsQS}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows: any[] = Array.isArray(j?.data) ? j.data : [];
        const active = rows.filter(
          (r) =>
            (Number(r.spend) || 0) > 0 ||
            (Number(r.clicks) || 0) > 0 ||
            (Number(r.conversions) || 0) > 0 ||
            (Number(r.conversion_value) || 0) > 0,
        ).length;
        setAvailableDays(active > 0 ? Math.min(90, active) : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, activeConnector]);

  // Switching Data Source from inside an entity must land on the new source's
  // OVERVIEW — the campaign (or ad group) being viewed belongs to the old source
  // and may not exist in the new one. The top tabs change the active connector;
  // when they do while an entity is open, drop the entity from the URL.
  const entityConnectorRef = useRef(activeConnector);
  useEffect(() => {
    if (openEntity && entityConnectorRef.current !== activeConnector) {
      router.replace(`/ai-optimizer${periodQS}`);
    }
    entityConnectorRef.current = activeConnector;
  }, [activeConnector, openEntity, periodQS, router]);

  const metrics = useMemo(
    () => goalMetricsFor(activeConnector, connectorConfigs[activeConnector]?.metrics),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeConnector, connectorConfigs, connectorsVersion],
  );

  // Every breakdown this source has — its primary entity plus the tables whose
  // AI toggle is on (dashboard visibility is not consulted; see `analysed`).
  // Read from the registry, so a source added through the constructor is
  // analysed by whatever it groups by.
  const breakdowns = useMemo(() => {
    const c = getConnector(activeConnector);
    // Table names come from the SAME admin config the dashboard's Extended
    // Analytics reads (connectorConfigs[...].dimensions), so a renamed table
    // (Ad Groups, Search Terms, …) reads the same in the radar, the categories
    // and everywhere else here. Relabel only — every breakdown still gets
    // analysed, regardless of the dashboard's hide/order choices.
    const dimCfg = new Map(
      (connectorConfigs[activeConnector]?.dimensions ?? []).map((d) => [d.key, d]),
    );
    // The primary entity follows the admin's "Primary Table" choice (Data
    // Sources), the same as the dashboard's hero — not the manifest default. So
    // repointing it (e.g. Search Query → Page Path) moves the badge, the radar's
    // centre, the entity list and the analysis here onto the same entity, with
    // no table hardcoded.
    const pts = connectorConfigs[activeConnector]?.primaryTableSource;
    const primaryKey = pts?.type === "dimension" ? pts.key : c.primaryDimension;
    const primaryDef = getDimensionDef(activeConnector, primaryKey);
    const primarySingular = primaryDef?.singular ?? c.primaryLabel;
    const primaryLabel = dimCfg.get(primaryKey)?.label?.trim() || primarySingular;
    const primary = { key: primaryKey, label: primaryLabel, singular: primarySingular };
    // A table is analysed when its own "AI" toggle is on (optimizer !== false).
    // The dashboard-visibility toggle is deliberately NOT consulted: hiding a
    // noisy table (Search Terms is the usual one) from the dashboard's Extended
    // Analytics must not silently drop it from the AI Optimizer — the AI toggle
    // is the single control for optimizer participation, matching the
    // optimizer-only breakdowns (Day of Week / Time of Day) which already key off
    // that toggle alone.
    const analysed = (key: string) => dimCfg.get(key)?.optimizer !== false;
    const rest = connectorTableList(activeConnector, primaryKey)
      .filter((t) => t.available && !t.custom && analysed(t.key))
      .map((t) => ({
        key: t.key,
        label: dimCfg.get(t.key)?.label?.trim() || t.label,
        singular: t.dimensionLabel,
      }));
    // Day of Week and Time of Day — the two actionable slices of the Time table.
    // They're their OWN entries in Data Sources now (see buildRows), so each has
    // its own on/off (AI toggle) and label; the optimizer honours those the same
    // as any other table. No longer hardcoded, no longer tied to the combined
    // "Time" widget.
    const timeBreakdowns =
      activeConnector === "google_ads"
        ? ([
            { key: "day_of_week", def: "Day of Week Performance", singular: "Day" },
            { key: "hour", def: "Time of Day Performance", singular: "Hour" },
          ]
            .filter((t) => analysed(t.key))
            .map((t) => ({
              key: t.key,
              label: dimCfg.get(t.key)?.label?.trim() || t.def,
              singular: t.singular,
            })) as { key: string; label: string; singular: string }[])
        : [];
    return [primary, ...rest, ...timeBreakdowns];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnector, connectorConfigs, connectorsVersion]);
  const primaryDim = breakdowns[0]?.key;

  // Open this recommendation's own data on the full dashboard: same source, same
  // period, and the same scope it was drawn from (the open entity, plus the
  // recommendation's own dimension + value). The dashboard reads the period from
  // sessionStorage on mount, and shares the cross-filter store for the rest.
  const openAnalytics = useCallback(
    (rec: Recommendation) => {
      try {
        sessionStorage.setItem("dr_range_start", String(range.start.getTime()));
        sessionStorage.setItem("dr_range_end", String(range.endExclusive.getTime() - 86_400_000));
        // Open the dashboard's Extended Analytics on arrival — the user came for
        // exactly these tables and filters.
        sessionStorage.setItem("dr_expand_analytics", "1");
        // Over the optimizer's ~90-day window, Profit & Loss weekly shows where
        // the metric is being lost best — open straight into it.
        sessionStorage.setItem("dr_open_tab", "pl");
        sessionStorage.setItem("dr_granularity", "weeks");
      } catch {
        /* private mode — the dashboard just opens on its default range */
      }
      clearAll();
      // The campaign in focus (when the detail view is open), then the finding's
      // own level and value. The primary dimension maps to the campaign selection
      // key the dashboard's tables read.
      if (openEntity) setFilter("campaign_selected", [openEntity]);
      // A consolidated recommendation (Time of Day) filters to every entity it
      // covers, not just one, so the dashboard opens on the whole set.
      const recValues = rec.entities?.length ? rec.entities : rec.entity ? [rec.entity] : [];
      if (recValues.length) {
        const key = rec.category === primaryDim ? "campaign_selected" : rec.category;
        setFilter(key, recValues);
      }
      router.push(`/${connectorSlug(activeConnector)}`);
    },
    [range, clearAll, openEntity, setFilter, primaryDim, router, activeConnector],
  );

  const [settings, setSettings] = useState<SmartGoalsSettings | null>(null);
  const [categories, setCategories] = useState<CategoryInput[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("open");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // Picking a category filters the recommendations, but on a phone that block is
  // below the fold — nothing visibly happened, so the tap read as dead. Scroll
  // to it on mobile only; desktop shows both side by side and shouldn't move.
  const recsRef = useRef<HTMLDivElement | null>(null);
  const selectCategory = useCallback((key: string | null) => {
    setSelectedCategory(key);
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      requestAnimationFrame(() =>
        recsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  }, []);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  // False when the migration hasn't been run: marking still works for this
  // visit, it just won't outlive it. Said plainly rather than silently lost.
  const [marksStored, setMarksStored] = useState(true);
  // The model's wording, keyed by recommendation id. Empty until it answers —
  // the computed text stands in the meantime, so the page is useful at once.
  const [worded, setWorded] = useState<
    Record<string, { title: string; detail: string; action: string }>
  >({});
  const [phrasing, setPhrasing] = useState(false);
  // When the shown wording was last produced by the daily refresh, and whether
  // this exact set of findings is still waiting for it (shown as the computed
  // text until then). Drives the "Last analyzed" line.
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(null);
  const [analysisPending, setAnalysisPending] = useState(false);
  // The primary entity's own sub-label, keyed by name — Google Ads' channel
  // type ("Search", "Shopping", "Demand Gen"). Only Google Ads reports one, so
  // a source without it simply has no entry and the badge isn't drawn.
  const [entityTypes, setEntityTypes] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch(
      `/api/smart-goals?period=${encodeURIComponent(period)}&connector=${encodeURIComponent(activeConnector)}${viewAsQS}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setSettings(j?.settings ?? null))
      .catch(() => setSettings(null));
  }, [period, activeConnector]);

  // The tables are read a few at a time.
  //
  // All at once, ten of them raced to refresh the same access token: one won
  // and the rest came back 401, so most of the account went unanalysed. One at
  // a time fixed that and cost nine seconds — the upstream calls run 40ms to
  // 2.3s each, so in sequence the page waits for their sum.
  //
  // The refresh itself is fixed now (the routes persist the new cookies), so
  // the reason for going strictly one at a time is gone. A small window keeps
  // the fix's benefit — nothing like ten simultaneous logins-worth of pressure
  // — while the wait becomes roughly the slowest few rather than all of them.
  const LANES = 4;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const connectorQS =
      activeConnector === "google_ads" ? "" : `&connector=${encodeURIComponent(activeConnector)}`;

    // The primary breakdown (index 0 — campaigns, for Google Ads) reads from
    // /api/windsor, not /api/data: that endpoint only ever validated the
    // SECONDARY tables (ad_group, device, search_term…), never the primary
    // entity, because the dashboard's own primary table has always read it
    // from /api/windsor too. Asking /api/data for it returned zero rows every
    // time — the campaign list was empty regardless of the account.
    // When a campaign is open, each secondary breakdown's account-wide rows,
    // keyed by breakdown, so its scoped slice is judged against the account's
    // rate rather than the campaign's own (see findOpportunities' benchmark).
    const benchByKey = new Map<string, EntityRow[]>();
    const read = async (key: string, isPrimary: boolean): Promise<EntityRow[] | null> => {
      const scope = openEntity ? `&filter_campaign=${encodeURIComponent(openEntity)}` : "";
      if (isPrimary) {
        const res = await fetch(
          `${rowsApiBase()}?date_from=${dateFrom}&date_to=${dateTo}&group_by=${encodeURIComponent(key)}${connectorQS}${scope}${viewAsQS}`,
        );
        if (!res.ok) return null;
        const json = await res.json();
        // /api/windsor has no filter_campaign — only /api/data does — so with
        // one campaign open the primary breakdown still came back with every
        // campaign in the account, and the page showed recommendations about
        // campaigns you were not looking at. The primary dimension IS the
        // campaign, so narrowing it here is exact.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw: any[] = (Array.isArray(json?.data) ? json.data : []).filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (r: any) =>
            !openEntity || String(r?.dimension ?? r?.campaign ?? "").trim() === openEntity,
        );
        const types: Record<string, string> = {};
        // Status dot resolved from THESE rows, exactly like the dashboard tables:
        // Windsor's campaign_status when present, a spend-based guess when it
        // isn't (spend > 0 → active/green). The separate health endpoint returned
        // nothing for some accounts, so an active campaign fell back to a grey
        // "paused" dot even while the dashboard showed it green.
        const colorMap: Record<string, StatusDot> = {};
        for (const r of raw) {
          const name = String(r?.dimension ?? r?.campaign ?? "").trim();
          const t = normalizeChannelType(r?.campaign_type);
          if (name && t) types[name] = t;
          if (name)
            colorMap[name] = statusDotFor(r?.campaign_status ?? r?.status, Number(r?.spend) || 0);
        }
        if (!cancelled) {
          setEntityTypes(types);
          if (Object.keys(colorMap).length) setStatusColors((prev) => ({ ...prev, ...colorMap }));
        }
        return entitiesFromWindsorRows(raw);
      }
      const res = await fetch(
        `${dimApiBase()}/${encodeURIComponent(key)}?date_from=${dateFrom}&date_to=${dateTo}&page=1&limit=2000&sort=cost&sort_dir=desc${connectorQS}${scope}${viewAsQS}`,
      );
      if (!res.ok) return null;
      const json = await res.json();
      // A campaign is open: also read this breakdown across the whole account,
      // as the benchmark its scoped rows are judged against. Best-effort — with
      // no benchmark the analysis simply falls back to the campaign's own rate.
      if (openEntity) {
        try {
          const bres = await fetch(
            `${dimApiBase()}/${encodeURIComponent(key)}?date_from=${dateFrom}&date_to=${dateTo}&page=1&limit=2000&sort=cost&sort_dir=desc${connectorQS}${viewAsQS}`,
          );
          if (bres.ok) {
            const bjson = await bres.json();
            benchByKey.set(key, entitiesFromPerfRows(bjson?.data ?? []));
          }
        } catch {
          /* no benchmark — analysis judges the campaign against itself */
        }
      }
      return entitiesFromPerfRows(json?.data ?? []);
    };

    (async () => {
      // Results keep the breakdowns' own order however they finish, so the
      // sidebar doesn't reshuffle as the slower tables land.
      const out: (CategoryInput | null)[] = breakdowns.map(() => null);
      let failed = 0;
      let next = 0;

      const lane = async () => {
        while (!cancelled) {
          const i = next++;
          if (i >= breakdowns.length) return;
          const b = breakdowns[i];
          let rows: EntityRow[] | null = null;
          for (let attempt = 0; attempt < 2 && rows === null; attempt++) {
            try {
              rows = await read(b.key, i === 0);
            } catch {
              rows = null;
            }
          }
          if (rows === null) failed++;
          out[i] = {
            ...b,
            rows: rows ?? [],
            benchmarkRows: i === 0 ? undefined : benchByKey.get(b.key),
          };
          // Render what has arrived rather than waiting for the slowest table.
          if (!cancelled) setCategories(out.filter((c): c is CategoryInput => c !== null));
        }
      };

      await Promise.all(Array.from({ length: Math.min(LANES, breakdowns.length) }, lane));
      if (cancelled) return;
      const done = out.filter((c): c is CategoryInput => c !== null);
      if (done.every((c) => c.rows.length === 0))
        setLoadError(
          failed > 0
            ? "Could not read this source's tables. Try again in a moment."
            : "No data came back for this period from any of this source's tables.",
        );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [breakdowns, dateFrom, dateTo, activeConnector, openEntity]);

  const focusKey = settings ? resolveAiFocus(settings) : null;
  const focus = metrics.find((m) => m.key === focusKey) ?? metrics[0];
  const hasCost = metrics.some((m) => m.key === "cost");

  /** One line per campaign — what the landing view is. */
  // The Data Source's AI Optimization Threshold: rows below it aren't analysed.
  const thresholds = useMemo(
    () => resolveOptimizerThresholds(connectorConfigs[activeConnector], hasCost),
    [connectorConfigs, activeConnector, hasCost],
  );

  const entityList = useMemo(() => {
    if (openEntity || !categories || !focus) return null;
    const primary = categories[0];
    if (!primary || primary.rows.length === 0) return null;
    return summariseEntities({
      rows: primary.rows,
      focus,
      marginPct: settings?.marginPct ?? 40,
      hasCost,
      thresholds,
    });
  }, [openEntity, categories, focus, settings, hasCost, thresholds]);
  const [search, setSearch] = useState("");

  const analysis = useMemo(() => {
    if (!categories || !focus) return null;
    return analyseAccount({
      categories,
      focus,
      marginPct: settings?.marginPct ?? 40,
      hasCost,
      thresholds,
    });
  }, [categories, focus, settings, hasCost, thresholds]);

  // The entity list and the detail page must agree: a campaign can look 100%
  // healthy in the list (nothing wrong at the campaign level) yet have real
  // findings once opened (an ad group or search term inside it). So the list's
  // score / count / impact are recomputed with the SAME deep analysis the detail
  // runs — per campaign, across its own sub-breakdowns.
  //
  // Done in ONE pass, not one fetch per campaign: each sub-breakdown is read as
  // date,<dim> (every row carries its campaign), then split per campaign — the
  // same totals a filter_campaign fetch gives the detail. Keyed by the primary
  // entity name → { score, count, impact }.
  const [deepEntities, setDeepEntities] = useState<
    Record<string, { score: number; count: number; impact: number }>
  >({});
  // The deep pass keeps changing the campaigns' numbers after the page first
  // paints; this flag drives the top progress bar so it's clear the analysis is
  // still running and hasn't just stalled.
  const [deepLoading, setDeepLoading] = useState(false);
  useEffect(() => {
    // Wait until every breakdown has loaded, or this re-fires on each partial
    // categories update mid-load.
    if (
      loading ||
      openEntity ||
      !categories ||
      !focus ||
      !entityList ||
      entityList.entities.length === 0
    ) {
      setDeepEntities({});
      setDeepLoading(false);
      return;
    }
    let cancelled = false;
    setDeepEntities({});
    setDeepLoading(true);
    const connectorQS =
      activeConnector === "google_ads" ? "" : `&connector=${encodeURIComponent(activeConnector)}`;
    const secondary = breakdowns.slice(1); // the sub-tables analysed within a campaign
    const primaryRows = new Map(categories[0]?.rows.map((r) => [r.name, r]) ?? []);
    // The account-wide rows for each breakdown, to judge one campaign's slice
    // against the whole account rather than against itself — so a campaign with
    // two search terms is measured against the account's rate, and a real
    // finding isn't lost just because its campaign is small.
    const accountRowsByKey = new Map(categories.map((c) => [c.key, c.rows]));
    const margin = settings?.marginPct ?? 40;
    // Bound the work: the highest-impact campaigns first (the list is sorted by
    // it), deep-analyse the top ones. The rest keep their shallow figure.
    // Only the qualified campaigns get the deep per-campaign pass — the "not
    // enough data" ones aren't analysed at all.
    const names = entityList.entities
      .filter((e) => e.qualified)
      .slice(0, 30)
      .map((e) => e.name);

    // One campaign, analysed EXACTLY the way its detail page is — its own
    // breakdowns fetched with filter_campaign — so the list and the detail can't
    // disagree, and every campaign that has findings shows them.
    const analyseCampaign = async (
      name: string,
    ): Promise<{ score: number; count: number; impact: number } | null> => {
      const scope = `&filter_campaign=${encodeURIComponent(name)}`;
      const cats: CategoryInput[] = [];
      const pr = primaryRows.get(name);
      if (pr)
        cats.push({
          key: breakdowns[0].key,
          label: breakdowns[0].label,
          singular: breakdowns[0].singular,
          rows: [pr],
        });
      // Deep-analysing every campaign fires a burst of scoped reads; the later
      // ones get throttled and come back non-200. A single failure used to read
      // as "this campaign has no sub-findings" and overwrite its shallow figure
      // with a false 100%. So: retry each read once, and track whether ANY
      // secondary read actually answered — if none did, this campaign wasn't
      // analysed and we must keep its shallow figure instead of zeroing it.
      let anyRead = false;
      const fetched = await Promise.all(
        secondary.map(async (b) => {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const res = await fetch(
                `${dimApiBase()}/${encodeURIComponent(b.key)}?date_from=${dateFrom}&date_to=${dateTo}&page=1&limit=2000&sort=cost&sort_dir=desc${connectorQS}${scope}${viewAsQS}`,
              );
              if (!res.ok) continue;
              anyRead = true;
              const json = await res.json();
              const rows = entitiesFromPerfRows(json?.data ?? []);
              return rows.length
                ? ({
                    key: b.key,
                    label: b.label,
                    singular: b.singular,
                    rows,
                    benchmarkRows: accountRowsByKey.get(b.key),
                  } as CategoryInput)
                : null;
            } catch {
              /* retry once, then give up on this breakdown */
            }
          }
          return null;
        }),
      );
      // Nothing came back from any sub-table (all throttled/failed) — leave the
      // shallow figure in place rather than falsely collapsing to 100%.
      if (secondary.length > 0 && !anyRead) return null;
      for (const c of fetched) if (c) cats.push(c);
      const a = analyseAccount({ categories: cats, focus, marginPct: margin, hasCost, thresholds });
      return { score: a.overallScore, count: a.recommendations.length, impact: a.totalImpact };
    };

    (async () => {
      let next = 0;
      const lane = async () => {
        while (!cancelled) {
          const i = next++;
          if (i >= names.length) return;
          const name = names[i];
          try {
            const d = await analyseCampaign(name);
            // Land each campaign as it finishes, so the list fills in
            // progressively rather than all at once at the end. null = its
            // sub-tables couldn't be read; keep the shallow figure.
            if (d && !cancelled) setDeepEntities((prev) => ({ ...prev, [name]: d }));
          } catch {
            /* leave this campaign on its shallow figure */
          }
        }
      };
      await Promise.all(Array.from({ length: 4 }, lane));
      if (!cancelled) setDeepLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    loading,
    openEntity,
    entityList,
    categories,
    focus,
    breakdowns,
    dateFrom,
    dateTo,
    activeConnector,
    hasCost,
    settings,
    thresholds,
  ]);

  // What was marked before, for this source and period.
  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/optimizer-marks?connector=${encodeURIComponent(activeConnector)}&period=${encodeURIComponent(period)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        setMarks(
          Object.fromEntries(
            Object.entries(j.marks ?? {}).map(([id, m]) => {
              const v = m as { state: Mark["state"]; at: string; snapshot?: RecSnapshot };
              return [id, { state: v.state, at: whenLabel(v.at), snapshot: v.snapshot }];
            }),
          ),
        );
        setMarksStored(j.stored !== false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeConnector, period]);

  /**
   * Mark one, or put it back.
   *
   * Applied on screen first and sent afterwards: the button has to feel like a
   * button. If the write fails the card comes back rather than sitting there
   * looking dealt with — a dismissed recommendation that quietly returns
   * tomorrow is worse than one that never left.
   */
  const mark = useCallback(
    (id: string, state: Mark["state"] | null, snapshot?: RecSnapshot) => {
      const before = marks;
      setMarks((prev) => {
        const next = { ...prev };
        if (state === null) delete next[id];
        else next[id] = { state, at: whenLabel(new Date().toISOString()), snapshot };
        return next;
      });
      const undo = () => setMarks(before);
      const req =
        state === null
          ? fetch(
              `/api/optimizer-marks?connector=${encodeURIComponent(activeConnector)}&period=${encodeURIComponent(period)}&id=${encodeURIComponent(id)}`,
              { method: "DELETE" },
            )
          : fetch("/api/optimizer-marks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ connector: activeConnector, period, id, state, snapshot }),
            });
      req
        .then(async (r) => {
          if (!r.ok) return undo();
          const j = await r.json().catch(() => null);
          if (j && j.stored === false) setMarksStored(false);
        })
        .catch(undo);
    },
    [marks, activeConnector, period],
  );

  // Only the text goes to the model, and only what it sends back as text is
  // used. Impacts, priorities, actions and every figure in the evidence table
  // stay exactly as computed — a model asked to rewrite a sentence cannot
  // invent a dollar amount that was never in it.
  const wordable = useMemo(
    () =>
      (analysis?.recommendations ?? []).slice(0, 12).map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        detail: r.detail,
        action: r.action,
      })),
    [analysis],
  );
  const wordableIds = wordable.map((r) => r.id).join("|");
  useEffect(() => {
    if (wordable.length === 0) return;
    let cancelled = false;
    setPhrasing(true);
    fetch("/api/ai-optimizer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        opportunities: wordable,
        goalLabel: focus?.label ?? "revenue",
        connector: activeConnector,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.items) return;
        setWorded(
          Object.fromEntries(
            (j.items as { id: string; title: string; detail: string; action: string }[]).map(
              (i) => [i.id, { title: i.title, detail: i.detail, action: i.action }],
            ),
          ),
        );
        setAnalyzedAt(typeof j.analyzedAt === "string" ? j.analyzedAt : null);
        setAnalysisPending(j.pending === true);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPhrasing(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-phrases when the findings change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordableIds, focus?.label]);

  const shown = useMemo(() => {
    const all = analysis?.recommendations ?? [];
    const byTab = all.filter((r) => {
      const m = marks[r.id];
      if (tab === "open") return !m;
      return m?.state === (tab === "completed" ? "completed" : "dismissed");
    });
    return selectedCategory ? byTab.filter((r) => r.category === selectedCategory) : byTab;
  }, [analysis, marks, tab, selectedCategory]);

  const openCount = (analysis?.recommendations ?? []).filter((r) => !marks[r.id]).length;
  const completedCount = Object.values(marks).filter((m) => m.state === "completed").length;
  const dismissedCount = Object.values(marks).filter((m) => m.state === "dismissed").length;

  // The dashboard scope a recommendation was drawn from — same values
  // openAnalytics uses, captured so a snapshot can reopen it later.
  const buildExplore = useCallback(
    (rec: Recommendation): ExploreCtx => {
      const filters: Record<string, string[]> = {};
      if (openEntity) filters["campaign_selected"] = [openEntity];
      const recValues = rec.entities?.length ? rec.entities : rec.entity ? [rec.entity] : [];
      if (recValues.length) {
        const key = rec.category === primaryDim ? "campaign_selected" : rec.category;
        filters[key] = [...(filters[key] ?? []), ...recValues];
      }
      return {
        rangeStart: range.start.getTime(),
        rangeEnd: range.endExclusive.getTime() - 86_400_000,
        filters,
        slug: connectorSlug(activeConnector),
      };
    },
    [openEntity, primaryDim, range, activeConnector],
  );

  // Freeze a recommendation exactly as shown (its model wording included) plus
  // the analysis period and the way back to the dashboard, to store with a mark.
  const buildSnapshot = useCallback(
    (rec: Recommendation): RecSnapshot => {
      const w = worded[rec.id];
      return {
        rec: w ? { ...rec, ...w } : rec,
        impactLabel: analysis?.impactMetricLabel ?? "revenue",
        impactFormat: analysis?.impactFormat === "number" ? "number" : "money",
        analysisPeriod: { from: dateFrom, to: dateTo },
        explore: buildExplore(rec),
      };
    },
    [worded, analysis, dateFrom, dateTo, buildExplore],
  );

  // Reopen the dashboard on a stored snapshot's own period, filters and source.
  const exploreSnapshot = useCallback(
    (ex: ExploreCtx) => {
      try {
        sessionStorage.setItem("dr_range_start", String(ex.rangeStart));
        sessionStorage.setItem("dr_range_end", String(ex.rangeEnd));
        // Open Extended Analytics on arrival, so the snapshot's tables + filters
        // are visible without another click.
        sessionStorage.setItem("dr_expand_analytics", "1");
        sessionStorage.setItem("dr_open_tab", "pl");
        sessionStorage.setItem("dr_granularity", "weeks");
      } catch {
        /* private mode — the dashboard just opens on its default range */
      }
      clearAll();
      for (const [key, values] of Object.entries(ex.filters)) setFilter(key, values);
      router.push(`/${ex.slug}`);
    },
    [clearAll, setFilter, router],
  );

  // The Completed / Dismissed tabs are HISTORY: they render the frozen snapshot
  // stored with each mark, never a rebuild from current data. An older mark with
  // no snapshot falls back to the live recommendation if it still exists.
  const history = useMemo(() => {
    if (tab === "open") return [];
    const want: Mark["state"] = tab === "completed" ? "completed" : "dismissed";
    const live = new Map((analysis?.recommendations ?? []).map((r) => [r.id, r]));
    return Object.entries(marks)
      .filter(([, m]) => m.state === want)
      .map(([id, m]) => ({ id, at: m.at, snapshot: m.snapshot, live: live.get(id) }))
      .filter((it) => it.snapshot || it.live)
      .filter((it) => {
        if (!selectedCategory) return true;
        return (it.snapshot?.rec.category ?? it.live?.category) === selectedCategory;
      });
  }, [tab, marks, analysis, selectedCategory]);

  const score = analysis?.overallScore ?? 100;
  const band = bandFor(score);

  // Monthly potential impact in the AI-Focus metric — the total the optimizer
  // found (for the account, or the open entity), normalised to a month:
  //   monthly = total ÷ days of data × 30
  // Divided by the days that actually carry data, so a 25-day-old account and a
  // full 90-day one both read a true monthly figure. Cumulative metrics (money /
  // counts) scale; an average (ROAS, conv rate) is already a rate, shown as-is.
  const denomDays =
    availableDays ??
    Math.max(1, Math.round((range.endExclusive.getTime() - range.start.getTime()) / 86_400_000));
  const impactIsCumulative =
    analysis?.impactFormat === "money" || analysis?.impactFormat === "number";
  const monthlyImpact = analysis
    ? impactIsCumulative
      ? (analysis.totalImpact / denomDays) * 30
      : analysis.totalImpact
    : 0;

  // One Potential-Impact format everywhere — the monthly figure, "+$46 / mo.".
  // Money/count impacts are normalised and get the suffix; an average (ROAS,
  // conv rate) is shown as-is. Used by every campaign row, list and mobile.
  const listImpactIsCumulative =
    entityList?.impactFormat === "money" || entityList?.impactFormat === "number";
  const impactPerMonth = (impact: number): string => {
    const v = listImpactIsCumulative ? (impact / denomDays) * 30 : impact;
    return `+${formatImpact(v, entityList?.impactMetric ?? "revenue")}${
      listImpactIsCumulative ? " / mo." : ""
    }`;
  };
  // Two shapes, side by side, because they answer two different questions and
  // one was overwriting the other: the left one is how the account is SET UP
  // (budgets, bidding, ad strength, assets), the right one is how its tables
  // PERFORMED. Whichever page this appears on, both are scoped the same way —
  // the whole account on the list, one entity once one is open.
  // One radar, on the tables.
  //
  // There were two: how the account is SET UP beside how its tables PERFORMED.
  // The setup half is gone at the client's call — those fields differ per
  // platform, none of them appear in the approved tables, and a score nobody
  // can check against something on screen is a score nobody should trust. The
  // tables are agreed when a source is set up, so this one stands on them.
  const radarPair = (
    <div>
      <p className="text-[14px] font-semibold text-[#101828] mb-3">
        {openEntity ? "Campaign health by area" : "Account health by area"}
      </p>
      {analysis ? (
        <HealthRadar categories={analysis.categories} />
      ) : (
        <div className="h-[260px] bg-gray-50 rounded-xl animate-pulse" />
      )}
    </div>
  );

  const sourceLabel = CONNECTORS[activeConnector]?.label ?? activeConnector;
  const primaryLabel = breakdowns[0]?.label ?? "Entities";
  const primaryNoun = primaryLabel.toLowerCase();

  return (
    <div className="p-4 sm:p-6 max-w-[1600px]">
      {/* Top progress bar, the same one the dashboard uses — while the tables
          are loading or the deep per-campaign pass is still refining the
          numbers, so it's clear the analysis is still running. */}
      {(loading || deepLoading) && (
        <div className="fixed top-0 inset-x-0 z-[100] h-[3px] overflow-hidden bg-violet-100">
          <div
            className="absolute h-full w-[35%] bg-[#8200DB]"
            style={{ animation: "loading-bar 1.2s ease-in-out infinite" }}
          />
        </div>
      )}
      {/* One section: the platform tabs, what is being analysed, and the shape
          of it. They answer one question between them, so they share a card
          rather than stacking as three. */}
      <PageSourceTabs title="AI Optimizer" feature="optimizer">
        {openEntity && (
          // A plain anchor, not next/link: this must return to the list whether
          // the entity page was reached by clicking through or by a browser
          // refresh / direct URL. A hard navigation to /ai-optimizer clears the
          // ?entity param and cannot depend on any client router state that a
          // refresh throws away.
          <a
            href={`/ai-optimizer${periodQS}`}
            className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-700 transition mb-3"
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
            {`Back to all ${primaryNoun}`}
          </a>
        )}
        {/* What is being analysed, and how healthy it looks overall. No card of
            its own — it is a row of the section, divided from the radar under
            it rather than floating beside it. */}
        <div className="py-1 pb-4 mb-4 border-b border-gray-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[22px] sm:text-[24px] font-bold text-[#101828] truncate">
                {openEntity ?? sourceLabel}
              </h1>
              {(() => {
                // The account header has no status of its own; only an open
                // entity does. Resolved from statusColors (campaign_status +
                // spend) so the header matches the entity's row in the list —
                // a campaign active there can't read "Paused" here. Grey =
                // unknown → no badge, which is better than a guess.
                const st = openEntity ? statusBadgeFor(statusColors[openEntity] ?? "gray") : null;
                if (!st) return null;
                return (
                  <span
                    className="text-[12px] font-semibold rounded-lg px-2.5 py-0.5"
                    style={{ color: st.fg, background: st.bg }}
                  >
                    {st.label}
                  </span>
                );
              })()}
              {/* The open entity's own type when the source reports one
                  ("Demand Gen"). On the account overview there is no entity, and
                  the old "Campaign" badge there is replaced by Potential Impact
                  below — so the type badge only shows for an open entity. */}
              {openEntity && entityTypes[openEntity] && (
                <span className="text-[12px] font-semibold text-[#047857] bg-[#DBEAFE] rounded-lg px-2.5 py-0.5">
                  {entityTypes[openEntity]}
                </span>
              )}
              {/* Potential Impact in the AI-Focus metric, averaged to a month —
                  the total for everything the optimizer found (the account on the
                  overview, one entity when opened), so the headline potential is
                  visible at a glance. */}
              {analysis && monthlyImpact > 0 && (
                <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#008236] bg-[#F0FDF4] border border-[#B9F8CF] rounded-lg px-2.5 py-0.5">
                  +{formatImpact(monthlyImpact, analysis.impactMetric)}{" "}
                  {analysis.impactMetricLabel.toLowerCase()}
                  {impactIsCumulative ? " / month" : ""}
                  <HelpTip title="Potential Impact">
                    Estimated monthly impact based on the AI Focus metric set in Smart Goals.
                    Calculated using the last 90 days of available platform data. Estimate only —
                    review recommendations before applying.
                  </HelpTip>
                </span>
              )}
            </div>
            <p className="text-[13px] text-[#8200DB] font-semibold mt-2">
              {openCount} optimizations available —{" "}
              <span className="text-[#C10007]">{analysis?.counts.high ?? 0} High</span>,{" "}
              <span className="text-[#059669]">{analysis?.counts.medium ?? 0} Medium</span>,{" "}
              <span className="text-[#4A5565]">{analysis?.counts.low ?? 0} Low</span> priority.{" "}
              <span className="text-[#6A7282] font-normal">
                Analysis period: {dateFrom} to {dateTo}
              </span>
            </p>
            {/* When the AI wording last ran, and how often it refreshes. The
                findings themselves are always current; only their AI phrasing is
                produced once a day by the refresh job, so opening the page never
                triggers a new AI run. */}
            <p className="text-[12px] text-[#6A7282] mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span>
                {analyzedAt ? (
                  <>
                    Last analyzed:{" "}
                    <span className="font-semibold text-[#4A5565]">{whenLabel(analyzedAt)}</span>
                  </>
                ) : analysisPending ? (
                  "AI recommendations refresh overnight — showing the latest computed results."
                ) : (
                  "Showing the latest computed results."
                )}
              </span>
              <span className="text-[#99A1AF]">
                AI recommendations are automatically updated once per day.
              </span>
            </p>
          </div>

          <div
            className={`shrink-0 rounded-xl border p-3.5 min-w-[240px] ${
              score >= 80 ? "bg-[#ECFDF5] border-[#A4F4CF]" : "bg-[#FEF2F2] border-[#FFC9C9]"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold text-[#4A5565]">
                  Overall Optimization Score
                </p>
                <p className="text-[12px] text-[#6A7282]">Campaign health status</p>
              </div>
              <div className="text-right">
                <span
                  className="text-[28px] sm:text-[30px] font-bold block leading-none"
                  style={{ color: band.color }}
                >
                  {score}%
                </span>
                <span
                  className="text-[11px] font-bold uppercase block mt-0.5"
                  style={{ color: band.color }}
                >
                  {band.label.split(":")[1]?.trim()}
                </span>
              </div>
            </div>
            <div className="h-2 bg-gray-200 rounded-full mt-2.5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${score}%`, background: band.color }}
              />
            </div>
          </div>
        </div>

        {radarPair}
      </PageSourceTabs>

      {/* The account first, one line per entity — a campaign at 20% with six
          figures behind it is the one to open, and no single account-wide
          number can say which that is. */}
      {!openEntity && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-gray-100">
              <p className="text-[16px] font-semibold text-[#101828]">
                {primaryLabel} ({entityList?.entities.length ?? 0})
              </p>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${primaryNoun}…`}
                className="w-full sm:w-64 border border-gray-200 rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-emerald-400"
              />
            </div>

            {/* Table Header */}
            <div className="hidden sm:grid grid-cols-[1fr_130px_120px_160px_24px] gap-4 px-5 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wider text-[#99A1AF]">
              <div>{primaryNoun.toUpperCase()}</div>
              <div className="text-center">SCORE</div>
              <div className="text-center">OPTIMIZATIONS</div>
              <div className="text-right">POTENTIAL IMPACT</div>
              <div />
            </div>

            {loading && (
              <div className="p-10 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!loading && loadError && (
              <p className="px-5 py-8 text-[13px] text-gray-500 text-center">{loadError}</p>
            )}

            {!loading &&
              (entityList?.entities ?? [])
                .filter((e) => e.name.toLowerCase().includes(search.trim().toLowerCase()))
                // Biggest potential impact first, whichever campaign it is —
                // the deep figure once it's landed, the shallow one until then.
                .slice()
                // Order: analysed campaigns first, "not enough data" last; within
                // the analysed group ACTIVE campaigns on top, then paused/other —
                // each ranked by potential impact (deep figure once it's landed,
                // shallow until then). Status comes from statusColors, so a
                // campaign reads the same here as its dot.
                .sort((a, bb) => {
                  if (a.qualified !== bb.qualified) return a.qualified ? -1 : 1;
                  const rank = (n: string) => (statusColors[n] === "green" ? 0 : 1);
                  const rd = rank(a.name) - rank(bb.name);
                  if (rd !== 0) return rd;
                  return (
                    (deepEntities[bb.name]?.impact ?? bb.impact) -
                    (deepEntities[a.name]?.impact ?? a.impact)
                  );
                })
                .map((e) => {
                  // The deep per-campaign figures once they've landed; the
                  // shallow campaign-level ones until then.
                  const eff = deepEntities[e.name] ?? e;
                  // Below the source's AI Optimization Threshold: shown, but not
                  // yet analysed — "Not enough data" / 0 / Pending.
                  const notEnough = !e.qualified;
                  const statusColor = statusColors[e.name] ?? "gray";
                  const statusLabel =
                    statusOf(statuses[e.name])?.label ??
                    (statusColor === "green" ? "Active" : "Status not reported");
                  const notEnoughBadge = (
                    <span className="inline-block text-[11px] font-semibold text-[#A16207] bg-[#FEF9C3] border border-[#FEF08A] rounded-md px-2 py-0.5">
                      Not enough data
                    </span>
                  );
                  const optBadge = notEnough ? (
                    <span className="text-[12px] text-gray-400">0</span>
                  ) : eff.count > 0 ? (
                    <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#8200DB] bg-[#FAF5FF] border border-[#E9D4FF] rounded-lg px-2 py-0.5">
                      ✨ {eff.count}
                    </span>
                  ) : (
                    <span className="text-[12px] text-gray-400">—</span>
                  );
                  const pending = <span className="text-[12px] text-gray-400 italic">Pending</span>;
                  return (
                    <Link
                      key={e.name}
                      href={`/ai-optimizer?${periodQS ? `period=${encodeURIComponent(periodParam!)}&` : ""}entity=${encodeURIComponent(e.name)}`}
                      className="block px-4 sm:px-5 py-2.5 sm:py-3.5 border-t border-gray-100 hover:bg-gray-50/80 transition"
                    >
                      {/* Mobile: one compact card — name + arrow, then a single
                          stats line. No progress bar, no separate Profit block. */}
                      <div className="sm:hidden">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <StatusIndicator status={statusColor} title={statusLabel} />
                            <span className="text-[14px] font-semibold text-[#101828] truncate">
                              {e.name}
                            </span>
                          </div>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            className="text-gray-300 shrink-0"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </div>
                        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-1.5 text-[12px] text-[#99A1AF]">
                          <span className="flex items-center gap-1">
                            Score:{" "}
                            {notEnough ? (
                              notEnoughBadge
                            ) : (
                              <b className="font-bold" style={{ color: bandFor(eff.score).color }}>
                                {eff.score}%
                              </b>
                            )}
                          </span>
                          <span className="flex items-center gap-1">Optimizations: {optBadge}</span>
                          <span className="flex items-center gap-1">
                            Potential impact:{" "}
                            {notEnough ? (
                              pending
                            ) : eff.impact > 0 ? (
                              <b className="font-bold text-[#7008E7]">
                                {impactPerMonth(eff.impact)}
                              </b>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Desktop: the table row. */}
                      <div className="hidden sm:grid grid-cols-[1fr_130px_120px_160px_24px] gap-4 items-center">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <StatusIndicator status={statusColor} title={statusLabel} />
                          <div className="min-w-0 flex-1">
                            <span className="block text-[14px] font-medium text-[#101828] truncate">
                              {e.name}
                            </span>
                            <span className="block text-[12px] text-[#99A1AF]">
                              {entityTypes[e.name] ?? `${Math.round(e.share * 100)}% of account`}
                            </span>
                          </div>
                        </div>

                        <div className="text-center">
                          {notEnough ? (
                            notEnoughBadge
                          ) : (
                            <>
                              <span
                                className="text-[16px] font-bold"
                                style={{ color: bandFor(eff.score).color }}
                              >
                                {eff.score}%
                              </span>
                              <div className="h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${eff.score}%`,
                                    background: bandFor(eff.score).color,
                                  }}
                                />
                              </div>
                            </>
                          )}
                        </div>

                        <div className="text-center">{optBadge}</div>

                        <div className="text-right">
                          {notEnough ? (
                            pending
                          ) : eff.impact > 0 ? (
                            <span className="text-[14px] font-bold text-[#7008E7]">
                              {impactPerMonth(eff.impact)}
                            </span>
                          ) : (
                            <span className="text-[12px] text-gray-400">—</span>
                          )}
                        </div>

                        <div className="flex justify-end text-gray-300">
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
                        </div>
                      </div>
                    </Link>
                  );
                })}

            {/* What the "Not enough data" state means, and the exact threshold in
                force — read from the source's settings, never hardcoded. */}
            {!loading && (entityList?.entities.length ?? 0) > 0 && (
              <div className="px-4 sm:px-5 py-3 border-t border-gray-100 text-[11px] text-gray-400 leading-relaxed space-y-0.5">
                <p>
                  {primaryLabel} marked{" "}
                  <span className="font-semibold text-[#A16207]">Not enough data</span>
                  {" don’t yet meet the current AI Optimization Threshold."}
                </p>
                {thresholds.length > 0 && (
                  <p>
                    Current threshold (last 90 days):{" "}
                    <span className="text-gray-500">{describeThresholds(thresholds)}</span>.
                  </p>
                )}
                <p>{primaryLabel} with no data during the last 90 days are not displayed.</p>
                <p>Collect more data to unlock AI analysis and recommendations.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {openEntity && (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Categories — the full list matching Figma */}
          <aside className="lg:w-[270px] shrink-0">
            <div className="bg-white rounded-2xl border border-gray-200 p-3 lg:sticky lg:top-4">
              <p className="px-2.5 py-1.5 text-[11px] font-semibold text-[#6A7282] uppercase tracking-wider">
                OPTIMIZATION CATEGORIES
              </p>
              <button
                onClick={() => selectCategory(null)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-[13px] transition ${
                  selectedCategory === null
                    ? "bg-[#FAF5FF] text-[#8200DB] font-semibold border border-[#AD46FF]"
                    : "text-[#101828] hover:bg-gray-50 border border-transparent"
                }`}
              >
                <span className="flex items-center gap-2 font-medium">
                  <span>✨</span> All Recommendations
                </span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F3E8FF] text-[#8200DB]">
                  {openCount}
                </span>
              </button>
              {/* The two groups and their headings are Figma's; the categories
                  under them are not — the mockup names Google-Ads-only concepts
                  like Extensions, Bidding, and Landing Pages, none of which any
                  data source here can compute (they live in campaign settings,
                  not in Windsor's metrics). Listing them anyway and marking
                  every one "✓ done" for lack of a match would have been a lie
                  dressed as completeness — worse than a shorter, honest list.
                  What's real: every breakdown the SOURCE actually has, sorted
                  by whichever kind of work its own findings are mostly about
                  (see optimizerCategories.ts's categoryGroup). */}
              <div className="mt-3 space-y-4">
                {[
                  {
                    group: "cost_saving" as const,
                    heading: "💰 COST SAVING & REMOVAL",
                    headingColor: "text-[#C10007]",
                    hint: "Reduce spend on underperforming areas",
                  },
                  {
                    group: "growth" as const,
                    heading: "⚙️ SETTINGS & IMPROVEMENTS",
                    headingColor: "text-[#059669]",
                    hint: "Optimize setup and configuration",
                  },
                ].map((sec) => {
                  const cats = (analysis?.categories ?? []).filter(
                    (c) => c.group === sec.group && c.quietReason !== "no_rows",
                  );
                  if (cats.length === 0) return null;
                  return (
                    <div key={sec.group}>
                      <p
                        className={`px-2.5 text-[10px] font-bold uppercase tracking-wider ${sec.headingColor}`}
                      >
                        {sec.heading}
                      </p>
                      <p className="px-2.5 pb-1 text-[10px] text-[#6A7282]">{sec.hint}</p>
                      <div className="space-y-0.5">
                        {cats.map((c) => {
                          const isSel = selectedCategory === c.key;
                          return (
                            <button
                              key={c.key}
                              onClick={() => selectCategory(c.key)}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[10px] border transition ${
                                isSel
                                  ? "bg-[#FAF5FF] border-[#AD46FF]"
                                  : "bg-[#F9FAFB] border-[#F3F4F6] hover:bg-gray-100/70"
                              }`}
                            >
                              <span aria-hidden className="text-[16px] leading-6 shrink-0">
                                {categoryIcon(c.key, c.label)}
                              </span>
                              <span
                                className={`flex-1 truncate text-left text-[14px] ${
                                  isSel
                                    ? "text-[#8200DB] font-semibold"
                                    : "text-[#101828] font-medium"
                                }`}
                              >
                                {c.label}
                              </span>
                              {c.count > 0 ? (
                                <span className="flex items-center gap-1.5 shrink-0">
                                  <span
                                    className={`text-[9px] font-bold uppercase border rounded px-1 py-0.5 ${PRIORITY_PILL[c.priority]}`}
                                  >
                                    {c.priority}
                                  </span>
                                  <span className="text-[11px] text-gray-500 font-semibold">
                                    {c.count}
                                  </span>
                                </span>
                              ) : (
                                <span className="w-4 h-4 rounded-full border border-[#00A63E] text-[#00A63E] flex items-center justify-center text-[10px] font-bold shrink-0">
                                  ✓
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>

          <div ref={recsRef} className="flex-1 min-w-0 space-y-4 scroll-mt-4">
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              {/* overflow-y-hidden: iOS Safari computes overflow-y to auto once
                  overflow-x is auto, which let the strip scroll vertically inside
                  too. Pinning it to hidden keeps the scroll sideways only. */}
              <div className="flex items-center gap-6 px-4 sm:px-5 border-b border-gray-200 overflow-x-auto overflow-y-hidden scrollbar-none">
                {(
                  [
                    ["open", "Recommendations", openCount],
                    ["completed", "Completed", completedCount],
                    ["dismissed", "Dismissed", dismissedCount],
                  ] as const
                ).map(([id, label, n]) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`shrink-0 flex items-center gap-2 py-3 text-[14px] font-semibold border-b-2 -mb-px whitespace-nowrap transition ${
                      tab === id
                        ? "border-[#8200DB] text-[#8200DB]"
                        : "border-transparent text-gray-400 hover:text-gray-600"
                    }`}
                  >
                    {label}
                    <span
                      className={`text-[12px] font-semibold rounded-full px-2 py-0.5 ${
                        tab === id ? "bg-[#F3E8FF] text-[#8200DB]" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {n}
                    </span>
                  </button>
                ))}
                {phrasing && (
                  <span className="ml-auto py-2.5 text-[11px] text-gray-400 whitespace-nowrap">
                    Writing them up…
                  </span>
                )}
              </div>

              {loading && (
                <div className="p-10 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              {!loading && loadError && (
                <p className="px-5 py-8 text-[13px] text-gray-500 text-center">{loadError}</p>
              )}

              {!marksStored && (
                <p className="px-4 sm:px-5 py-2 text-[12px] text-amber-700 bg-amber-50 border-b border-amber-100">
                  Dismissed and completed items are only remembered for this visit — run
                  supabase/optimizer_marks.sql to keep them.
                </p>
              )}

              {!loading &&
                !loadError &&
                (tab === "open" ? shown.length === 0 : history.length === 0) && (
                  <p className="px-5 py-8 text-[13px] text-gray-500 text-center">
                    {tab === "open"
                      ? "Nothing left to act on here."
                      : `Nothing ${tab} yet — the buttons on each recommendation put them here.`}
                  </p>
                )}

              {tab !== "open" && history.length > 0 && (
                <div className="px-4 sm:px-5 pt-4 pb-1">
                  <h3 className="text-[16px] font-semibold text-[#101828]">
                    {tab === "completed"
                      ? "Completed Recommendations"
                      : "Dismissed Recommendations"}
                  </h3>
                </div>
              )}

              {/* Open tab: the live recommendations, actionable. */}
              {!loading &&
                tab === "open" &&
                shown.map((rec) => (
                  <RecommendationCard
                    key={rec.id}
                    rec={worded[rec.id] ? { ...rec, ...worded[rec.id] } : rec}
                    impactLabel={analysis?.impactMetricLabel ?? "revenue"}
                    impactFormat={analysis?.impactFormat === "number" ? "number" : "money"}
                    denomDays={denomDays}
                    state={marks[rec.id]?.state}
                    stateAt={marks[rec.id]?.at}
                    onDismiss={() => mark(rec.id, "dismissed", buildSnapshot(rec))}
                    onComplete={() => mark(rec.id, "completed", buildSnapshot(rec))}
                    onRestore={() => mark(rec.id, null)}
                    onOpenAnalytics={() => openAnalytics(rec)}
                  />
                ))}

              {/* Completed / Dismissed tabs: the frozen snapshot stored with each
                  mark — a history of what was recommended, not a rebuild. */}
              {!loading &&
                tab !== "open" &&
                history.map((it) => {
                  const rec = it.snapshot?.rec ?? it.live!;
                  const explore = it.snapshot?.explore;
                  return (
                    <RecommendationCard
                      key={it.id}
                      rec={rec}
                      impactLabel={
                        it.snapshot?.impactLabel ?? analysis?.impactMetricLabel ?? "revenue"
                      }
                      impactFormat={
                        it.snapshot?.impactFormat ??
                        (analysis?.impactFormat === "number" ? "number" : "money")
                      }
                      state={tab === "completed" ? "completed" : "dismissed"}
                      stateAt={it.at}
                      analysisPeriod={it.snapshot?.analysisPeriod}
                      onDismiss={() => mark(it.id, "dismissed")}
                      onComplete={() => mark(it.id, "completed")}
                      onRestore={() => mark(it.id, null)}
                      onExplore={
                        explore
                          ? () => exploreSnapshot(explore)
                          : it.live
                            ? () => openAnalytics(it.live!)
                            : undefined
                      }
                    />
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
