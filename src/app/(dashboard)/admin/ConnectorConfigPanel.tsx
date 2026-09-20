"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  CONNECTORS,
  CONNECTOR_IDS,
  DEFAULT_CONNECTOR,
  connectorTableList,
  connectorMetricCols,
  chartMetricList,
  connectorKpiOptions,
  getConnector,
  getDimensionDef,
  setCustomConnectors,
  applyAdminCustomFields,
  type ConnectorId,
  type ConnectorConfig,
  type ConnectorConfigMap,
  type CustomConnectorRow,
  type ValueFormat,
  type TableConfigV2,
  type CustomConnectorMetricInput,
  type CustomConnectorDimensionInput,
} from "@/lib/connectors";
import CustomConnectorModal from "./CustomConnectorModal";
import TableWidgetsPanel from "./TableWidgetsPanel";
import CustomMetricsPanel from "./CustomMetricsPanel";
import CustomDimensionsPanel from "./CustomDimensionsPanel";
import { THRESHOLD_METRICS, resolveOptimizerThresholds } from "@/lib/optimizerCategories";
import type { ThresholdRule, ThresholdOp } from "@/lib/connectors";

// The comparisons offered per rule, and the metrics the dropdown lists.
const THRESHOLD_OPS: { id: ThresholdOp; label: string }[] = [
  { id: "gte", label: "≥" },
  { id: "lte", label: "≤" },
  { id: "gt", label: ">" },
  { id: "lt", label: "<" },
  { id: "eq", label: "=" },
  { id: "ne", label: "≠" },
];
const THRESHOLD_METRIC_KEYS = Object.keys(THRESHOLD_METRICS);

interface Row {
  key: string;
  defaultLabel: string;
  label: string;
  visible: boolean;
  format?: ValueFormat;
  // Also offer this in the chart dropdowns — the breakdown in "by" (tables
  // list), the metric in the metric dropdown (metric columns list).
  charts?: boolean;
  // Whether the AI Optimizer analyses this table (tables list only).
  optimizer?: boolean;
  // The source's primary ("hero") table — listed so it can be renamed, but it
  // can't be hidden, reordered or dropped from the optimizer (it IS the entity
  // list there), so those controls are suppressed for it.
  primary?: boolean;
  // An optimizer-only breakdown (Google Ads' Day of Week / Time of Day). Not a
  // dashboard table, so it has no visible / Charts controls — only the AI toggle
  // and rename.
  optimizerOnly?: boolean;
}

// Optimizer-only breakdowns, per source: analysed by the AI Optimizer but not
// shown as dashboard tables. Google Ads exposes the two actionable time slices.
const OPTIMIZER_ONLY_TABLES: Partial<Record<ConnectorId, { key: string; label: string }[]>> = {
  google_ads: [
    { key: "day_of_week", label: "Day of Week Performance" },
    { key: "hour", label: "Time of Day Performance" },
  ],
};

const VALUE_FORMATS: { id: ValueFormat; label: string }[] = [
  { id: "number", label: "Number" },
  { id: "currency", label: "Currency" },
  { id: "percent", label: "Percent" },
];

function buildRows(id: ConnectorId, configs: ConnectorConfigMap): Row[] {
  const src = configs[id]?.primaryTableSource;
  const primaryKey = src?.type === "dimension" ? src.key : getConnector(id).primaryDimension;
  const base = connectorTableList(id, primaryKey);
  const cfg = configs[id]?.dimensions ?? [];
  const byKey = new Map(cfg.map((d) => [d.key, d]));
  // The primary table isn't in connectorTableList (it's the hero, shown
  // separately), so add it at the top — rename-only — so it can be relabelled
  // like any other table.
  const primaryDef = getDimensionDef(id, primaryKey);
  const primaryDefault = primaryDef?.singular ?? getConnector(id).primaryLabel;
  const primaryO = byKey.get(primaryKey);
  const primaryRow: Row = {
    key: primaryKey,
    defaultLabel: primaryDefault,
    label: primaryO?.label ?? primaryDefault,
    visible: true,
    primary: true,
  };
  const rest = base
    .map((t, i) => {
      const o = byKey.get(t.key);
      return {
        key: t.key,
        defaultLabel: t.label,
        label: o?.label ?? t.label,
        visible: o ? o.visible !== false : true,
        order: o ? o.order : i,
        charts: o ? o.charts !== false : true,
        optimizer: o ? o.optimizer !== false : true,
      };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ key, defaultLabel, label, visible, charts, optimizer }) => ({
      key,
      defaultLabel,
      label,
      visible,
      charts,
      optimizer,
    }));
  // Optimizer-only breakdowns (e.g. Day of Week / Time of Day) — their own AI
  // toggle + rename, so they're no longer hardcoded on.
  const optimizerRows: Row[] = (OPTIMIZER_ONLY_TABLES[id] ?? []).map((t) => {
    const o = byKey.get(t.key);
    return {
      key: t.key,
      defaultLabel: t.label,
      label: o?.label ?? t.label,
      visible: true,
      optimizer: o ? o.optimizer !== false : true,
      optimizerOnly: true,
    };
  });
  return [primaryRow, ...rest, ...optimizerRows];
}

function buildMetricRows(id: ConnectorId, configs: ConnectorConfigMap): Row[] {
  const cfg = configs[id]?.metrics ?? [];
  const byKey = new Map(cfg.map((m) => [m.key, m]));
  return connectorMetricCols(id)
    .map((t, i) => {
      const o = byKey.get(t.key);
      return {
        key: t.key,
        defaultLabel: t.label,
        label: o?.label ?? t.label,
        visible: o ? o.visible !== false : true,
        order: o ? o.order : i,
        charts: o?.charts,
      };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ key, defaultLabel, label, visible, charts }) => ({
      key,
      defaultLabel,
      label,
      visible,
      charts,
    }));
}

// The top KPI cards. The catalog is every slot the source can compute, so an
// admin can ADD a card that isn't shown by default, not just hide the shipped ones.
function buildKpiRows(id: ConnectorId, configs: ConnectorConfigMap): Row[] {
  const cfg = configs[id]?.kpis ?? [];
  const byKey = new Map(cfg.map((m) => [m.key, m]));
  return connectorKpiOptions(id)
    .map((o, i) => {
      const ov = byKey.get(o.slot);
      return {
        key: o.slot,
        defaultLabel: o.label,
        label: ov?.label ?? o.label,
        visible: ov ? ov.visible !== false : o.defaultVisible,
        order: ov ? ov.order : 100 + i,
        format: ov?.format,
      };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ key, defaultLabel, label, visible, format }) => ({
      key,
      defaultLabel,
      label,
      visible,
      format,
    }));
}

// Small reorderable / toggleable / renameable list — shared by KPI cards, tables
// and metric columns. Every option a source supports is listed: ticking an
// unticked row is how you ADD it, so there's no separate "add" dialog.
function ConfigList({
  rows,
  setRows,
  keyWidth,
  hint,
  showFormat,
  showChartsToggle,
  showOptimizerToggle,
  chartsEligible,
  chartsToggleTitle = "Offer this breakdown in the Trends / Distribution 'by' dropdowns",
}: {
  rows: Row[];
  setRows: React.Dispatch<React.SetStateAction<Row[]>>;
  keyWidth?: string;
  hint?: string;
  showFormat?: boolean;
  showChartsToggle?: boolean;
  // Also offer an "AI" toggle deciding whether the AI Optimizer analyses this
  // table — so an admin can start it on a few core tables and add the rest.
  showOptimizerToggle?: boolean;
  // Rows the chart has no series for (CTR, CPC, ROAS — no per-entity value per
  // day) can't be plotted whatever the admin ticks, so the toggle is shown
  // disabled rather than silently doing nothing.
  chartsEligible?: (key: string) => boolean;
  chartsToggleTitle?: string;
}) {
  const move = (idx: number, dir: -1 | 1) =>
    setRows((rs) => {
      const next = [...rs];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return rs;
      // The primary row stays pinned at the top: never move it, and never let
      // another row cross above it.
      if (next[idx]?.primary || next[j]?.primary) return rs;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  const toggle = (idx: number) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, visible: !r.visible } : r)));
  const rename = (idx: number, label: string) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, label } : r)));
  const setFormat = (idx: number, format: ValueFormat) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, format } : r)));
  const toggleCharts = (idx: number) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, charts: r.charts === false } : r)));
  const toggleOptimizer = (idx: number) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, optimizer: r.optimizer === false } : r)));
  const hiddenCount = rows.filter((r) => !r.visible).length;
  return (
    <div className="divide-y divide-gray-50">
      {hint && (
        <p className="px-5 pb-2 text-[11px] text-gray-400">
          {hint}
          {hiddenCount > 0 && (
            <>
              {" "}
              — <span className="text-emerald-600 font-medium">
                {hiddenCount} available to add
              </span>{" "}
              (tick to show).
            </>
          )}
        </p>
      )}
      {rows.map((r, i) => (
        <div key={r.key} className="flex flex-wrap items-center gap-2 sm:gap-3 px-4 sm:px-5 py-2.5">
          <div className="flex flex-col">
            <button
              onClick={() => move(i, -1)}
              disabled={i === 0 || r.primary || rows[i - 1]?.primary}
              className="text-gray-300 hover:text-gray-600 disabled:opacity-30 transition leading-none"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
            <button
              onClick={() => move(i, 1)}
              disabled={i === rows.length - 1 || r.primary}
              className="text-gray-300 hover:text-gray-600 disabled:opacity-30 transition leading-none"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
          {r.primary ? (
            <span className="shrink-0 text-[10px] font-bold text-[#047857] bg-[#DBEAFE] rounded px-1.5 py-0.5 uppercase tracking-wide">
              Primary
            </span>
          ) : r.optimizerOnly ? (
            <span className="shrink-0 text-[10px] font-bold text-[#8200DB] bg-[#FAF5FF] rounded px-1.5 py-0.5 uppercase tracking-wide">
              AI only
            </span>
          ) : (
            <input
              type="checkbox"
              checked={r.visible}
              onChange={() => toggle(i)}
              className="rounded shrink-0"
            />
          )}
          <input
            value={r.label}
            onChange={(e) => rename(i, e.target.value)}
            className={`flex-1 min-w-[8rem] text-[13px] border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-400 ${r.visible ? "text-gray-800" : "text-gray-400 line-through"}`}
          />
          <div className="flex items-center gap-2 sm:gap-3 ml-auto shrink-0">
            {!r.primary &&
              !r.optimizerOnly &&
              showChartsToggle &&
              (() => {
                const eligible = chartsEligible ? chartsEligible(r.key) : true;
                const on = eligible && r.visible && r.charts !== false;
                return (
                  <label
                    title={
                      eligible
                        ? chartsToggleTitle
                        : "The chart has no series for this metric, so it can't be plotted"
                    }
                    className={`flex items-center gap-1.5 text-[11px] shrink-0 ${on || (eligible && r.visible) ? "cursor-pointer" : "cursor-not-allowed"} ${r.visible && eligible ? "text-gray-500" : "text-gray-300"}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!r.visible || !eligible}
                      onChange={() => toggleCharts(i)}
                      className="rounded"
                    />
                    Charts
                  </label>
                );
              })()}
            {!r.primary && showOptimizerToggle && (
              <label
                title="Include this table in the AI Optimizer's analysis"
                className={`flex items-center gap-1.5 text-[11px] shrink-0 ${r.visible ? "cursor-pointer text-gray-500" : "cursor-not-allowed text-gray-300"}`}
              >
                <input
                  type="checkbox"
                  checked={r.visible && r.optimizer !== false}
                  disabled={!r.visible}
                  onChange={() => toggleOptimizer(i)}
                  className="rounded"
                />
                AI
              </label>
            )}
            {showFormat && (
              <select
                value={r.format ?? ""}
                onChange={(e) => setFormat(i, e.target.value as ValueFormat)}
                className="text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 outline-none bg-white text-gray-600 cursor-pointer shrink-0"
              >
                <option value="">Default format</option>
                {VALUE_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            )}
            {!r.visible && (
              <button
                onClick={() => toggle(i)}
                className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 shrink-0"
              >
                + Add
              </button>
            )}
            <span
              className={`text-[11px] text-gray-300 font-mono shrink-0 truncate text-right ${keyWidth ?? "w-24"}`}
            >
              {r.key}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Admin editor: per data source, choose which Extended-Analytics tables show, in
// what order, and under what label. Saved globally → applied to every user's
// dashboard (like the AI prompts). Metrics config is planned next.
export default function ConnectorConfigPanel({
  showToast,
}: {
  showToast: (t: "success" | "error", s: string) => void;
}) {
  const [configs, setConfigs] = useState<ConnectorConfigMap>({});
  const [selected, setSelected] = useState<ConnectorId>("google_ads");
  const [rows, setRows] = useState<Row[]>([]);
  const [metricRows, setMetricRows] = useState<Row[]>([]);
  // Which metric columns the chart can actually plot for this source. Passing
  // an unfiltered config through chartMetricList tells us exactly what the
  // dashboard would offer if every column were ticked.
  const chartMetricKeys = useMemo(
    () => new Set(chartMetricList(selected).map((m) => m.key)),
    [selected],
  );
  const [kpiRows, setKpiRows] = useState<Row[]>([]);
  const [tableWidgets, setTableWidgets] = useState<TableConfigV2[]>([]);
  const [customMetrics, setCustomMetrics] = useState<CustomConnectorMetricInput[]>([]);
  const [customDimensions, setCustomDimensions] = useState<CustomConnectorDimensionInput[]>([]);
  const [primaryTableSource, setPrimaryTableSource] =
    useState<ConnectorConfig["primaryTableSource"]>(undefined);
  // Which of the two cross-source pages this source carries. Undefined = both,
  // so an untouched source behaves exactly as it did before this existed.
  const [features, setFeatures] = useState<ConnectorConfig["features"]>(undefined);
  const [optimizerInstructions, setOptimizerInstructions] = useState("");
  // The AI Optimization Threshold rules for the selected source (ANDed).
  const [optimizerThresholds, setOptimizerThresholds] = useState<ThresholdRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [setupError, setSetupError] = useState(false);
  const [customRows, setCustomRows] = useState<CustomConnectorRow[]>([]);
  const [editingCustom, setEditingCustom] = useState<CustomConnectorRow | "new" | null>(null);

  const loadCustomConnectors = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/custom-connectors");
      const j = await r.json();
      const list: CustomConnectorRow[] = j?.connectors ?? [];
      setCustomRows(list);
      setCustomConnectors(list); // refresh the live registry so new pills show immediately
    } catch {
      /* ignore — panel still works with just the built-ins */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/connector-config");
      const j = await r.json();
      const cfgs: ConnectorConfigMap = j?.configs ?? {};
      // Keeps this tab's own live CONNECTORS registry in sync — without this,
      // a built-in connector's already-saved custom metrics/dimensions never
      // show up as pickable KPI card / metric column / dimension options
      // here unless the dashboard happened to load first in this session.
      applyAdminCustomFields(cfgs);
      setConfigs(cfgs);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadCustomConnectors();
  }, [load, loadCustomConnectors]);
  // A deleted (or not-yet-loaded) custom connector can leave `selected` pointing
  // at an id that no longer exists in the live registry — fall back rather than
  // render a blank editor.
  useEffect(() => {
    if (!(selected in CONNECTORS)) setSelected(DEFAULT_CONNECTOR);
  }, [selected, customRows]);
  useEffect(() => {
    setRows(buildRows(selected, configs));
    setMetricRows(buildMetricRows(selected, configs));
    setKpiRows(buildKpiRows(selected, configs));
    setTableWidgets(configs[selected]?.tables ?? []);
    setCustomMetrics(configs[selected]?.customMetrics ?? []);
    setCustomDimensions(configs[selected]?.customDimensions ?? []);
    setPrimaryTableSource(configs[selected]?.primaryTableSource);
    setFeatures(configs[selected]?.features);
    setOptimizerInstructions(configs[selected]?.optimizerInstructions ?? "");
    setOptimizerThresholds(
      resolveOptimizerThresholds(configs[selected], getConnector(selected).hasCost),
    );
  }, [selected, configs]);

  const toConfigRows = (rs: Row[]) =>
    rs.map((r, i) => ({
      key: r.key,
      visible: r.visible,
      order: i,
      ...(r.label.trim() && r.label.trim() !== r.defaultLabel ? { label: r.label.trim() } : {}),
      ...(r.format ? { format: r.format } : {}),
      ...(r.charts === false ? { charts: false } : {}),
      ...(r.optimizer === false ? { optimizer: false } : {}),
    }));

  const save = async () => {
    setSaving(true);
    try {
      const config = {
        dimensions: toConfigRows(rows),
        metrics: toConfigRows(metricRows),
        kpis: toConfigRows(kpiRows),
        tables: tableWidgets,
        customMetrics: customMetrics.filter((m) => m.key && m.label && m.windsorField),
        customDimensions: customDimensions.filter(
          (d) => d.key && d.label && d.singular && d.windsorField,
        ),
        primaryTableSource,
        features,
        ...(optimizerInstructions.trim()
          ? { optimizerInstructions: optimizerInstructions.trim() }
          : {}),
        ...(optimizerThresholds.length
          ? {
              optimizerThresholds: optimizerThresholds.filter(
                (r) => THRESHOLD_METRICS[r.metric] && Number.isFinite(r.value),
              ),
            }
          : {}),
      };
      const r = await fetch("/api/connector-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connector: selected, config }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (r.status === 503) setSetupError(true);
        showToast("error", j.error || "Could not save");
        return;
      }
      const nextConfigs = { ...configs, [selected]: config };
      // Same reason as in load(): so a just-added custom metric/dimension
      // shows up immediately in the KPI cards / metric columns / dimension
      // pickers below, without needing a full page reload.
      applyAdminCustomFields(nextConfigs);
      setConfigs(nextConfigs);
      showToast("success", `${CONNECTORS[selected].label} configuration saved`);
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => {
    const empty = { ...configs, [selected]: undefined };
    setRows(buildRows(selected, empty));
    setMetricRows(buildMetricRows(selected, empty));
    setKpiRows(buildKpiRows(selected, empty));
    setTableWidgets([]);
    setCustomMetrics([]);
    setCustomDimensions([]);
    setPrimaryTableSource(undefined);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100">
        <p className="text-[14px] font-bold text-gray-800">Data source configuration</p>
        <p className="text-[12px] text-gray-400">
          Choose which KPI cards, tables &amp; metric columns appear in each data source, their
          order and labels — applied to every user&apos;s dashboard. Unchecked entries are hidden;
          check one to add it.
        </p>
      </div>

      {/* Connector picker */}
      <div className="flex items-center gap-2 flex-wrap px-5 py-3 border-b border-gray-50">
        {CONNECTOR_IDS.map((id) => {
          const c = CONNECTORS[id];
          const isSel = id === selected;
          const customRow = customRows.find((r) => r.id === id);
          return (
            <div key={id} className="flex items-center gap-0.5">
              <button
                onClick={() => setSelected(id)}
                className={`flex items-center gap-2 text-[13px] font-medium px-3 py-1.5 rounded-lg border transition ${isSel ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                {c.label}
                {customRow && (
                  <span className="text-[9px] font-semibold text-gray-400 bg-gray-100 rounded px-1 py-0.5">
                    Custom
                  </span>
                )}
              </button>
              {customRow && (
                <button
                  onClick={() => setEditingCustom(customRow)}
                  title="Edit data source"
                  className="w-6 h-6 flex items-center justify-center text-gray-300 hover:text-gray-600 transition shrink-0"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
        <button
          onClick={() => setEditingCustom("new")}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600 border border-dashed border-emerald-200 rounded-lg px-3 py-1.5 hover:bg-emerald-50 transition"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New data source
        </button>
      </div>

      {editingCustom && (
        <CustomConnectorModal
          initial={editingCustom === "new" ? null : editingCustom}
          onClose={() => setEditingCustom(null)}
          onSaved={loadCustomConnectors}
          showToast={showToast}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-gray-400 text-[14px]">
          <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      ) : (
        <>
          {setupError && (
            <div className="mx-5 mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-[12px] text-amber-700">
              The <code className="bg-amber-100 px-1 rounded">connector_config</code> table
              isn&apos;t set up yet. Create it in Supabase:
              <code className="block mt-1 bg-white/70 rounded p-2 text-[11px]">
                create table connector_config (connector text primary key, config jsonb, updated_at
                timestamptz default now());
              </code>
            </div>
          )}

          <p className="px-5 pt-4 pb-1 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
            KPI cards (top of dashboard)
          </p>
          <ConfigList
            rows={kpiRows}
            setRows={setKpiRows}
            keyWidth="w-24"
            hint="Every card this source can calculate"
            showFormat
          />

          <p className="px-5 pt-5 pb-1 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-t border-gray-100">
            Pages this source carries
          </p>
          <div className="px-5 pb-3">
            <p className="text-[11px] text-gray-400 mb-2">
              Goals and optimization advice suit an ad platform and much less a source with no
              budget to pace or bid to change. Unticking one hides it from the sidebar for this
              source; the page itself says so if anyone reaches it by URL.
            </p>
            <div className="flex flex-wrap gap-4">
              {(
                [
                  ["smartGoals", "Smart Goals"],
                  ["optimizer", "AI Optimizer"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-[13px] text-gray-700">
                  <input
                    type="checkbox"
                    checked={features?.[key] !== false}
                    onChange={(e) =>
                      setFeatures((f) => ({ ...f, [key]: e.target.checked ? undefined : false }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {features?.optimizer !== false && (
            <>
              <p className="px-5 pt-5 pb-1 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-t border-gray-100">
                AI Optimizer instructions
              </p>
              <div className="px-5 pb-3">
                <p className="text-[11px] text-gray-400 mb-2">
                  Extra guidance for how this source&apos;s recommendations are worded — what to
                  emphasise, the tone, what to call out first. The findings and every number stay
                  computed; this only shapes the phrasing. Leave blank for the default.
                </p>
                <textarea
                  value={optimizerInstructions}
                  onChange={(e) => setOptimizerInstructions(e.target.value)}
                  rows={4}
                  placeholder="e.g. Lead with wasted spend on search terms and suggest negative keywords. Be direct and concise."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-emerald-400 bg-white resize-y"
                />

                <p className="text-[11px] font-semibold text-gray-500 mt-4 mb-1">
                  AI Optimization Thresholds
                </p>
                <p className="text-[11px] text-gray-400 mb-2">
                  A row (campaign, ad group, search term, device…) is analysed only when it meets{" "}
                  <span className="font-semibold">every</span> rule below. Rows that fail any rule
                  never produce a recommendation. Default: Clicks ≥ 200
                  {getConnector(selected).hasCost ? " AND Ad Profit < 0" : ""}.
                </p>
                <div className="space-y-2">
                  {optimizerThresholds.map((rule, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        value={rule.metric}
                        onChange={(e) =>
                          setOptimizerThresholds((rs) =>
                            rs.map((r, j) => (j === i ? { ...r, metric: e.target.value } : r)),
                          )
                        }
                        className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-[12px] text-gray-700 bg-white outline-none focus:border-emerald-400 cursor-pointer"
                      >
                        {THRESHOLD_METRIC_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {THRESHOLD_METRICS[k].label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={rule.op}
                        onChange={(e) =>
                          setOptimizerThresholds((rs) =>
                            rs.map((r, j) =>
                              j === i ? { ...r, op: e.target.value as ThresholdOp } : r,
                            ),
                          )
                        }
                        className="w-14 border border-gray-200 rounded-lg px-2 py-1.5 text-[13px] text-gray-700 bg-white outline-none focus:border-emerald-400 cursor-pointer text-center"
                      >
                        {THRESHOLD_OPS.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={rule.value}
                        onChange={(e) =>
                          setOptimizerThresholds((rs) =>
                            rs.map((r, j) =>
                              j === i ? { ...r, value: Number(e.target.value) } : r,
                            ),
                          )
                        }
                        className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-[13px] text-gray-700 bg-white outline-none focus:border-emerald-400"
                      />
                      <button
                        type="button"
                        onClick={() => setOptimizerThresholds((rs) => rs.filter((_, j) => j !== i))}
                        title="Remove rule"
                        className="shrink-0 text-gray-400 hover:text-red-500 px-1.5 py-1"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setOptimizerThresholds((rs) => [
                        ...rs,
                        { metric: "clicks", op: "gte", value: 0 },
                      ])
                    }
                    className="text-[12px] font-medium text-emerald-600 hover:text-emerald-700"
                  >
                    + Add rule
                  </button>
                </div>
              </div>
            </>
          )}

          <p className="px-5 pt-5 pb-1 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-t border-gray-100">
            Primary table (top of dashboard)
          </p>
          <div className="px-5 pb-3">
            <p className="text-[11px] text-gray-400 mb-1.5">
              Which table renders first, above Extended Analytics. Purely visual — cross-filtering
              still works the same way underneath regardless of what&apos;s shown here.
            </p>
            <select
              value={
                !primaryTableSource
                  ? ""
                  : primaryTableSource.type === "dimension"
                    ? `dim:${primaryTableSource.key}`
                    : `widget:${primaryTableSource.widgetId}`
              }
              onChange={(e) => {
                const v = e.target.value;
                if (!v) setPrimaryTableSource(undefined);
                else if (v.startsWith("dim:"))
                  setPrimaryTableSource({ type: "dimension", key: v.slice(4) });
                else if (v.startsWith("widget:"))
                  setPrimaryTableSource({ type: "widget", widgetId: v.slice(7) });
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-emerald-400 bg-white cursor-pointer"
            >
              <option value="">Default ({CONNECTORS[selected].primaryLabel} Performance)</option>
              {CONNECTORS[selected].dimensions
                .filter((d) => d.key !== CONNECTORS[selected].primaryDimension)
                .map((d) => (
                  <option key={d.key} value={`dim:${d.key}`}>
                    {d.label}
                  </option>
                ))}
              {tableWidgets.map((t) => (
                <option key={t.id} value={`widget:${t.id}`}>
                  {t.name} (Table Widget)
                </option>
              ))}
            </select>
          </div>

          <p className="px-5 pt-5 pb-1 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-t border-gray-100">
            Tables
          </p>
          <ConfigList
            rows={rows}
            setRows={setRows}
            hint="Every breakdown table this source has. 'Charts' keeps it in the tables but drops it from the Trends / Distribution 'by' dropdowns; 'AI' keeps it in the tables but drops it from the AI Optimizer's analysis."
            showChartsToggle
            showOptimizerToggle
          />

          <p className="px-5 pt-5 pb-1 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-t border-gray-100">
            Metric columns
          </p>
          <ConfigList
            rows={metricRows}
            setRows={setMetricRows}
            keyWidth="w-16"
            hint="Every metric column the tables can show. Untick 'Charts' to keep a column but drop it from the Trends / Distribution metric dropdown"
            showChartsToggle
            chartsToggleTitle="Offer this metric in the Trends / Distribution metric dropdown"
            chartsEligible={(key) => chartMetricKeys.has(key)}
          />

          <TableWidgetsPanel
            connectorId={selected}
            tables={tableWidgets}
            onChange={setTableWidgets}
          />

          <CustomMetricsPanel
            connectorId={selected}
            metrics={customMetrics}
            onChange={setCustomMetrics}
          />

          <CustomDimensionsPanel
            connectorId={selected}
            dimensions={customDimensions}
            onChange={setCustomDimensions}
          />

          <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-gray-100">
            <button
              onClick={resetDefaults}
              className="text-[12px] text-gray-400 hover:text-gray-700 transition"
            >
              Reset to defaults
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold px-4 py-2 rounded-xl transition disabled:opacity-50"
            >
              {saving && (
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              Save configuration
            </button>
          </div>
        </>
      )}
    </div>
  );
}
