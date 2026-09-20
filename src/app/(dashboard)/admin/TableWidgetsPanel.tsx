"use client";

import { useState } from "react";
import {
  CONNECTORS,
  connectorMetricCols,
  type ConnectorId,
  type TableConfigV2,
  type MetricConfigOverride,
} from "@/lib/connectors";

const inputCls =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-emerald-400";

let nextId = 0;
const makeId = () => `tbl_${Date.now()}_${nextId++}`;

function emptyTable(connectorId: ConnectorId): TableConfigV2 {
  const dims = CONNECTORS[connectorId].dimensions;
  return {
    id: makeId(),
    name: "New Table",
    enabled: true,
    order: 0,
    primaryDimension: dims[0]?.key ?? "",
    additionalDimensions: [],
    metricColumns: [],
    crossFiltering: true,
    defaultSort: null,
  };
}

// One table widget's full configuration: name, primary/additional dimensions,
// its own metric columns, cross-filtering, default sort. Mirrors the reorder/
// toggle interaction ConnectorConfigPanel's ConfigList already uses elsewhere.
function TableEditor({
  connectorId,
  table,
  onChange,
}: {
  connectorId: ConnectorId;
  table: TableConfigV2;
  onChange: (t: TableConfigV2) => void;
}) {
  const dims = CONNECTORS[connectorId].dimensions;
  const metricCatalog = connectorMetricCols(connectorId);
  const usedDims = new Set([table.primaryDimension, ...table.additionalDimensions]);
  const availableDims = dims.filter((d) => !usedDims.has(d.key));

  const metricByKey = new Map(table.metricColumns.map((m) => [m.key, m]));
  const metricRows = metricCatalog
    .map((m, i) => {
      const o = metricByKey.get(m.key);
      return { key: m.key, label: o?.label ?? m.label, visible: !!o, order: o?.order ?? 100 + i };
    })
    .sort((a, b) => a.order - b.order);

  const setMetricRows = (rows: typeof metricRows) => {
    const cols: MetricConfigOverride[] = rows
      .filter((r) => r.visible)
      .map((r, i) => ({ key: r.key, visible: true, order: i, label: r.label }));
    onChange({ ...table, metricColumns: cols });
  };
  const toggleMetric = (key: string) => {
    const idx = metricRows.findIndex((r) => r.key === key);
    const next = [...metricRows];
    next[idx] = { ...next[idx], visible: !next[idx].visible };
    setMetricRows(next);
  };
  const moveMetric = (idx: number, dir: -1 | 1) => {
    const visibleOnly = metricRows.filter((r) => r.visible);
    const j = idx + dir;
    if (j < 0 || j >= visibleOnly.length) return;
    [visibleOnly[idx], visibleOnly[j]] = [visibleOnly[j], visibleOnly[idx]];
    const cols: MetricConfigOverride[] = visibleOnly.map((r, i) => ({
      key: r.key,
      visible: true,
      order: i,
      label: r.label,
    }));
    onChange({ ...table, metricColumns: cols });
  };

  const visibleMetricRows = metricRows.filter((r) => r.visible);
  const hiddenMetricRows = metricRows.filter((r) => !r.visible);

  return (
    <div className="px-5 py-4 space-y-3.5 bg-gray-50/50 border-t border-gray-100">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[12px] font-medium text-gray-500 block mb-1">Table Name</label>
          <input
            value={table.name}
            onChange={(e) => onChange({ ...table, name: e.target.value })}
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-[12px] font-medium text-gray-500 block mb-1">
            Primary Dimension
          </label>
          <select
            value={table.primaryDimension}
            onChange={(e) => onChange({ ...table, primaryDimension: e.target.value })}
            className={inputCls + " bg-white cursor-pointer"}
          >
            {dims.map((d) => (
              <option key={d.key} value={d.key}>
                {d.singular}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-[12px] font-medium text-gray-500 block mb-1">
          Additional Dimensions{" "}
          <span className="text-gray-400 font-normal">(shown as tabs above the table)</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {table.additionalDimensions.map((key) => {
            const d = dims.find((x) => x.key === key);
            return (
              <span
                key={key}
                className="flex items-center gap-1 text-[12px] bg-white border border-gray-200 rounded-lg px-2 py-1"
              >
                {d?.singular ?? key}
                <button
                  onClick={() =>
                    onChange({
                      ...table,
                      additionalDimensions: table.additionalDimensions.filter((k) => k !== key),
                    })
                  }
                  className="text-gray-300 hover:text-red-400"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </span>
            );
          })}
          {availableDims.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value)
                  onChange({
                    ...table,
                    additionalDimensions: [...table.additionalDimensions, e.target.value],
                  });
              }}
              className="text-[12px] border border-dashed border-emerald-200 text-emerald-600 rounded-lg px-2 py-1 bg-white cursor-pointer"
            >
              <option value="">+ Add dimension</option>
              {availableDims.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.singular}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div>
        <label className="text-[12px] font-medium text-gray-500 block mb-1.5">Metric Columns</label>
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-50">
          {visibleMetricRows.length === 0 && (
            <p className="px-3 py-3 text-[12px] text-gray-400">No columns yet — add one below.</p>
          )}
          {visibleMetricRows.map((r, i) => (
            <div key={r.key} className="flex items-center gap-2 px-3 py-2">
              <div className="flex flex-col">
                <button
                  onClick={() => moveMetric(i, -1)}
                  disabled={i === 0}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-30 leading-none"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </button>
                <button
                  onClick={() => moveMetric(i, 1)}
                  disabled={i === visibleMetricRows.length - 1}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-30 leading-none"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
              <span className="flex-1 text-[13px] text-gray-700">{r.label}</span>
              <button
                onClick={() => toggleMetric(r.key)}
                className="text-[11px] text-gray-400 hover:text-red-500"
              >
                Remove
              </button>
            </div>
          ))}
          {hiddenMetricRows.length > 0 && (
            <div className="px-3 py-2 flex items-center gap-1.5 flex-wrap">
              {hiddenMetricRows.map((r) => (
                <button
                  key={r.key}
                  onClick={() => toggleMetric(r.key)}
                  className="text-[11px] font-medium text-emerald-600 border border-dashed border-emerald-200 rounded-lg px-2 py-1 hover:bg-emerald-50"
                >
                  + {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 items-end">
        <button
          type="button"
          onClick={() => onChange({ ...table, crossFiltering: !table.crossFiltering })}
          className="flex items-center justify-between gap-3 border border-gray-200 rounded-lg px-3 py-2 hover:bg-white transition bg-white"
        >
          <span className="text-[13px] font-medium text-gray-700">Cross-filtering</span>
          <span
            className={`w-9 h-5 rounded-full p-0.5 transition shrink-0 ${table.crossFiltering ? "bg-emerald-600" : "bg-gray-200"}`}
          >
            <span
              className={`block w-4 h-4 rounded-full bg-white transition-transform ${table.crossFiltering ? "translate-x-4" : ""}`}
            />
          </span>
        </button>
        <div>
          <label className="text-[12px] font-medium text-gray-500 block mb-1">Default Sort</label>
          <div className="flex gap-1.5">
            <select
              value={table.defaultSort?.key ?? ""}
              onChange={(e) => {
                const key = e.target.value;
                onChange({
                  ...table,
                  defaultSort: key
                    ? { key, direction: table.defaultSort?.direction ?? "desc" }
                    : null,
                });
              }}
              className={inputCls + " bg-white cursor-pointer flex-1"}
            >
              <option value="">Table default</option>
              {visibleMetricRows.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            <select
              value={table.defaultSort?.direction ?? "desc"}
              disabled={!table.defaultSort}
              onChange={(e) =>
                onChange({
                  ...table,
                  defaultSort: table.defaultSort
                    ? { ...table.defaultSort, direction: e.target.value as "asc" | "desc" }
                    : null,
                })
              }
              className={inputCls + " bg-white cursor-pointer w-28 disabled:opacity-40"}
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TableWidgetsPanel({
  connectorId,
  tables,
  onChange,
}: {
  connectorId: ConnectorId;
  tables: TableConfigV2[];
  onChange: (t: TableConfigV2[]) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sorted = [...tables].sort((a, b) => a.order - b.order);

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= sorted.length) return;
    const next = [...sorted];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next.map((t, i) => ({ ...t, order: i })));
  };
  const toggle = (id: string) =>
    onChange(tables.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)));
  const rename = (id: string, name: string) =>
    onChange(tables.map((t) => (t.id === id ? { ...t, name } : t)));
  const update = (id: string, patch: TableConfigV2) =>
    onChange(tables.map((t) => (t.id === id ? patch : t)));
  const remove = (id: string) => {
    onChange(tables.filter((t) => t.id !== id));
    if (expanded === id) setExpanded(null);
  };
  const add = () => {
    const t = emptyTable(connectorId);
    onChange([...tables, { ...t, order: tables.length }]);
    setExpanded(t.id);
  };

  return (
    <div>
      <p className="px-5 pt-5 pb-1 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-t border-gray-100">
        Table Widgets
      </p>
      <p className="px-5 pb-2 text-[11px] text-gray-400">
        Independent tables with their own dimension tabs, metric columns, cross-filtering and
        default sort. When any exist for this source, they replace the built-in Extended Analytics
        list above on the user dashboard.
      </p>
      <div className="divide-y divide-gray-50">
        {sorted.length === 0 && (
          <p className="px-5 py-4 text-[12px] text-gray-400">
            No table widgets yet — the dashboard uses the built-in Tables list above.
          </p>
        )}
        {sorted.map((t, i) => (
          <div key={t.id}>
            <div className="flex items-center gap-3 px-5 py-2.5">
              <div className="flex flex-col">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-30 leading-none"
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
                  disabled={i === sorted.length - 1}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-30 leading-none"
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
              <input
                type="checkbox"
                checked={t.enabled}
                onChange={() => toggle(t.id)}
                className="rounded shrink-0"
              />
              <button
                onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                className="flex-1 text-left"
              >
                <input
                  value={t.name}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => rename(t.id, e.target.value)}
                  className={`w-full text-[13px] border border-transparent hover:border-gray-200 focus:border-emerald-400 rounded-lg px-2 py-1 outline-none ${t.enabled ? "text-gray-800" : "text-gray-400 line-through"}`}
                />
              </button>
              <button
                onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 shrink-0"
              >
                {expanded === t.id ? "Close" : "Configure"}
              </button>
              <button
                onClick={() => remove(t.id)}
                className="text-gray-300 hover:text-red-400 shrink-0"
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
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6M14 11v6" />
                </svg>
              </button>
            </div>
            {expanded === t.id && (
              <TableEditor
                connectorId={connectorId}
                table={t}
                onChange={(next) => update(t.id, next)}
              />
            )}
          </div>
        ))}
      </div>
      <div className="px-5 py-3.5">
        <button
          onClick={add}
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
          Add Table
        </button>
      </div>
    </div>
  );
}
