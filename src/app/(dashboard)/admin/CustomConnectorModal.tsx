"use client";

import { useState } from "react";
import type {
  CustomConnectorRow,
  CustomConnectorDimensionInput,
  CustomConnectorMetricInput,
  MetricSchema,
  MetricFormat,
} from "@/lib/connectors";

const inputCls =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-emerald-400";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-medium text-gray-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

const COLOR_PRESETS = [
  "#4285F4",
  "#0866FF",
  "#E8710A",
  "#95BF47",
  "#FF0050",
  "#0A66C2",
  "#00A4EF",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
];

const METRIC_SCHEMAS: { id: MetricSchema; label: string; hint: string }[] = [
  {
    id: "ads",
    label: "Ads",
    hint: "Has spend — enables Cost, ROAS, CPA, Profit and the Performance/P&L tabs.",
  },
  {
    id: "analytics",
    label: "Analytics",
    hint: "No spend — Sessions, Users, Conversions, Revenue (like GA4).",
  },
  {
    id: "commerce",
    label: "Commerce",
    hint: "No spend — Orders, Total Sales, Items Sold, AOV (like Shopify).",
  },
];

const FORMATS: { id: MetricFormat; label: string }[] = [
  { id: "number", label: "Number" },
  { id: "money", label: "Currency" },
  { id: "percent", label: "Percent" },
  { id: "ratio", label: "Ratio" },
];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

const emptyDim: CustomConnectorDimensionInput = {
  key: "",
  label: "",
  singular: "",
  windsorField: "",
};
export { emptyDim };
const emptyMetric: CustomConnectorMetricInput = {
  key: "",
  label: "",
  windsorField: "",
  format: "number",
};

// How a metric combines across rows and days. "Average position" is the case
// that forced this to be explicit: it's a plain number, so guessing from the
// format would sum it — and a summed position is meaningless.
const AGGREGATIONS: { id: "sum" | "avg"; label: string }[] = [
  { id: "sum", label: "Sum" },
  { id: "avg", label: "Average" },
];

export interface WindsorFieldOption {
  key: string;
  label: string;
  format?: MetricFormat;
  description?: string;
}

export function DimensionRow({
  d,
  onChange,
  onRemove,
  keyLocked,
}: {
  d: CustomConnectorDimensionInput;
  onChange: (d: CustomConnectorDimensionInput) => void;
  onRemove?: () => void;
  keyLocked?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-1.5 items-center">
      <input
        value={d.key}
        onChange={(e) => onChange({ ...d, key: slugify(e.target.value) })}
        placeholder="key"
        disabled={keyLocked}
        className={inputCls + " font-mono text-[11px] disabled:bg-gray-50 disabled:text-gray-400"}
      />
      <input
        value={d.label}
        onChange={(e) => onChange({ ...d, label: e.target.value })}
        placeholder="Table label"
        className={inputCls}
      />
      <input
        value={d.singular}
        onChange={(e) => onChange({ ...d, singular: e.target.value })}
        placeholder="Singular"
        className={inputCls}
      />
      <input
        value={d.windsorField}
        onChange={(e) => onChange({ ...d, windsorField: e.target.value })}
        placeholder="Windsor field"
        className={inputCls + " font-mono text-[11px]"}
      />
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="w-7 h-7 flex items-center justify-center text-gray-300 hover:text-red-400 transition shrink-0"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

export { emptyMetric };

export function MetricRow({
  m,
  onChange,
  onRemove,
}: {
  m: CustomConnectorMetricInput;
  onChange: (m: CustomConnectorMetricInput) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_100px_100px_auto] gap-1.5 items-center">
      <input
        value={m.key}
        onChange={(e) => onChange({ ...m, key: slugify(e.target.value) })}
        placeholder="key"
        className={inputCls + " font-mono text-[11px]"}
      />
      <input
        value={m.label}
        onChange={(e) => onChange({ ...m, label: e.target.value })}
        placeholder="Label"
        className={inputCls}
      />
      <input
        value={m.windsorField}
        onChange={(e) => onChange({ ...m, windsorField: e.target.value })}
        placeholder="Windsor field"
        className={inputCls + " font-mono text-[11px]"}
      />
      <select
        value={m.format}
        onChange={(e) => onChange({ ...m, format: e.target.value as MetricFormat })}
        className={inputCls + " bg-white cursor-pointer text-[12px]"}
      >
        {FORMATS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        title="How this metric combines across rows and days"
        value={m.aggregation ?? (m.format === "percent" || m.format === "ratio" ? "avg" : "sum")}
        onChange={(e) => onChange({ ...m, aggregation: e.target.value as "sum" | "avg" })}
        className={inputCls + " bg-white cursor-pointer text-[12px]"}
      >
        {AGGREGATIONS.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onRemove}
        className="w-7 h-7 flex items-center justify-center text-gray-300 hover:text-red-400 transition shrink-0"
      >
        <svg
          width="13"
          height="13"
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
  );
}

// Searchable list of fields fetched live from Windsor.ai (connectors.windsor.ai/
// <slug>/fields) — lets the admin pick from what the platform ACTUALLY exposes
// instead of typing a field name blind. A platform can have hundreds of fields.
export function WindsorFieldPicker({
  title,
  options,
  addedKeys,
  onAdd,
}: {
  title: string;
  options: WindsorFieldOption[];
  addedKeys: Set<string>;
  onAdd: (o: WindsorFieldOption) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = options.filter(
    (o) =>
      !addedKeys.has(o.key) &&
      (o.label.toLowerCase().includes(search.toLowerCase()) ||
        o.key.toLowerCase().includes(search.toLowerCase())),
  );
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-2.5 py-1.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
        <span className="text-[11px] font-semibold text-gray-500 shrink-0">{title}</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="flex-1 text-[11px] bg-white border border-gray-200 rounded px-2 py-1 outline-none focus:border-emerald-400"
        />
        <span className="text-[10px] text-gray-400 shrink-0">{filtered.length}</span>
      </div>
      <div className="max-h-40 overflow-y-auto divide-y divide-gray-50">
        {filtered.length === 0 && (
          <p className="px-2.5 py-3 text-[11px] text-gray-400 text-center">
            {options.length === 0 ? "Load fields to see options" : "No matches"}
          </p>
        )}
        {filtered.slice(0, 200).map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onAdd(o)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 hover:bg-emerald-50/50 text-left"
          >
            <span className="min-w-0">
              <span className="text-[12px] text-gray-700 truncate block">{o.label}</span>
              <span className="text-[10px] text-gray-400 font-mono truncate block">{o.key}</span>
            </span>
            <span className="text-[11px] font-semibold text-emerald-600 shrink-0">+</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CustomConnectorModal({
  initial,
  onClose,
  onSaved,
  showToast,
}: {
  initial: CustomConnectorRow | null;
  onClose: () => void;
  onSaved: () => void;
  showToast: (t: "success" | "error", s: string) => void;
}) {
  const isNew = !initial;
  const [label, setLabel] = useState(initial?.label ?? "");
  const [id, setId] = useState(initial?.id ?? "");
  const [idTouched, setIdTouched] = useState(!isNew);
  const [color, setColor] = useState(initial?.color ?? COLOR_PRESETS[0]);
  const [windsorSource, setWindsorSource] = useState(initial?.windsor_source ?? "");
  const [metricSchema, setMetricSchema] = useState<MetricSchema>(initial?.metric_schema ?? "ads");
  const [primary, setPrimary] = useState<CustomConnectorDimensionInput>(
    initial?.primary_dimension ?? { ...emptyDim },
  );
  const [dimensions, setDimensions] = useState<CustomConnectorDimensionInput[]>(
    initial?.dimensions ?? [],
  );
  const [customMetrics, setCustomMetrics] = useState<CustomConnectorMetricInput[]>(
    initial?.custom_metrics ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState("");

  const [loadingFields, setLoadingFields] = useState(false);
  const [fieldsError, setFieldsError] = useState("");
  const [windsorMetricOpts, setWindsorMetricOpts] = useState<WindsorFieldOption[]>([]);
  const [windsorDimOpts, setWindsorDimOpts] = useState<WindsorFieldOption[]>([]);

  const onLabelChange = (v: string) => {
    setLabel(v);
    if (!idTouched) setId(slugify(v));
  };

  const loadWindsorFields = async () => {
    if (!windsorSource.trim()) return setFieldsError("Enter the Windsor source slug first");
    setLoadingFields(true);
    setFieldsError("");
    try {
      const res = await fetch(
        `/api/admin/windsor-fields?connector=${encodeURIComponent(windsorSource.trim())}`,
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not load fields");
      setWindsorMetricOpts(j.metrics ?? []);
      setWindsorDimOpts(j.dimensions ?? []);
      if ((j.metrics?.length ?? 0) + (j.dimensions?.length ?? 0) === 0) {
        setFieldsError("Windsor returned no fields for this slug — check the spelling.");
      }
    } catch (e) {
      setFieldsError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoadingFields(false);
    }
  };

  const addedDimKeys = new Set([primary.key, ...dimensions.map((d) => d.key)].filter(Boolean));
  const addedMetricKeys = new Set(customMetrics.map((m) => m.key));

  const save = async () => {
    setError("");
    if (!label.trim()) return setError("Label is required");
    if (!id.trim()) return setError("Id is required");
    if (!windsorSource.trim()) return setError("Windsor source slug is required");
    if (!primary.key || !primary.label || !primary.singular || !primary.windsorField)
      return setError("Primary dimension needs key, label, singular and Windsor field");

    setBusy(true);
    try {
      const res = await fetch("/api/admin/custom-connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: id.trim(),
          label: label.trim(),
          color,
          windsor_source: windsorSource.trim(),
          metric_schema: metricSchema,
          primary_dimension: primary,
          dimensions: dimensions.filter((d) => d.key && d.label && d.singular && d.windsorField),
          ai_dimensions: [],
          custom_metrics: customMetrics.filter((m) => m.key && m.label && m.windsorField),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Save failed");
      showToast("success", isNew ? "Data source created" : "Data source saved");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!initial) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/custom-connectors/${initial.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Delete failed");
      showToast("success", "Data source deleted");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl p-6 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[16px] font-bold text-gray-900">
            {isNew ? "New Data Source" : `Edit ${initial!.label}`}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 transition"
          >
            <svg
              width="14"
              height="14"
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

        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Label">
              <input
                value={label}
                onChange={(e) => onLabelChange(e.target.value)}
                placeholder="e.g. TikTok Ads"
                className={inputCls}
              />
            </Field>
            <Field label="Id (slug)">
              <input
                value={id}
                onChange={(e) => {
                  setIdTouched(true);
                  setId(slugify(e.target.value));
                }}
                disabled={!isNew}
                className={inputCls + " font-mono disabled:bg-gray-50 disabled:text-gray-400"}
              />
            </Field>
          </div>

          <Field label="Color">
            <div className="flex items-center gap-2 flex-wrap">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition ${color === c ? "border-gray-800" : "border-transparent"}`}
                  style={{ background: c }}
                />
              ))}
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className={inputCls + " font-mono w-28 !py-1"}
              />
            </div>
          </Field>

          <Field label="Metric schema">
            <p className="text-[11px] text-gray-400 mb-1.5">
              Starting point only — decides which built-in KPI cards/tabs (Cost, ROAS…) this source
              gets. It doesn&apos;t limit which metrics you can add below.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {METRIC_SCHEMAS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setMetricSchema(s.id)}
                  className={`text-left border rounded-lg px-3 py-2 transition ${metricSchema === s.id ? "border-emerald-300 bg-emerald-50" : "border-gray-200 hover:bg-gray-50"}`}
                >
                  <p className="text-[13px] font-semibold text-gray-800">{s.label}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{s.hint}</p>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Windsor source slug">
            <div className="flex gap-2">
              <input
                value={windsorSource}
                onChange={(e) => setWindsorSource(e.target.value.trim())}
                placeholder="e.g. googleanalytics4"
                className={inputCls + " font-mono flex-1"}
              />
              <button
                type="button"
                onClick={loadWindsorFields}
                disabled={loadingFields}
                className="shrink-0 text-[12px] font-semibold text-emerald-600 border border-emerald-200 rounded-lg px-3 py-2 hover:bg-emerald-50 transition disabled:opacity-50 whitespace-nowrap"
              >
                {loadingFields ? "Loading…" : "Load fields from Windsor"}
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              The platform slug from connectors.windsor.ai/&lt;slug&gt;. &ldquo;Load fields&rdquo;
              pulls the real list of dimensions/metrics that platform exposes — pick from it below
              instead of typing field names blind.
            </p>
            {fieldsError && <p className="text-[11px] text-red-500 mt-1">{fieldsError}</p>}
          </Field>

          {(windsorMetricOpts.length > 0 || windsorDimOpts.length > 0) && (
            <Field label="Available fields (from Windsor)">
              <div className="grid grid-cols-2 gap-2">
                <WindsorFieldPicker
                  title="Dimensions"
                  options={windsorDimOpts}
                  addedKeys={addedDimKeys}
                  onAdd={(o) =>
                    setDimensions((rs) => [
                      ...rs,
                      { key: o.key, label: o.label, singular: o.label, windsorField: o.key },
                    ])
                  }
                />
                <WindsorFieldPicker
                  title="Metrics"
                  options={windsorMetricOpts}
                  addedKeys={addedMetricKeys}
                  onAdd={(o) =>
                    setCustomMetrics((rs) => [
                      ...rs,
                      {
                        key: o.key,
                        label: o.label,
                        windsorField: o.key,
                        format: o.format ?? "number",
                      },
                    ])
                  }
                />
              </div>
            </Field>
          )}

          <Field label="Primary dimension">
            <p className="text-[11px] text-gray-400 mb-1.5">
              The main table this source&apos;s dashboard is built around (e.g. Campaign, Product).
            </p>
            <DimensionRow d={primary} onChange={setPrimary} />
          </Field>

          <Field label="Additional dimensions (optional)">
            <div className="space-y-1.5">
              {dimensions.map((d, i) => (
                <DimensionRow
                  key={i}
                  d={d}
                  onChange={(next) => setDimensions((rs) => rs.map((r, j) => (j === i ? next : r)))}
                  onRemove={() => setDimensions((rs) => rs.filter((_, j) => j !== i))}
                />
              ))}
              <button
                type="button"
                onClick={() => setDimensions((rs) => [...rs, { ...emptyDim }])}
                className="flex items-center gap-1.5 text-[12px] text-emerald-600 hover:text-emerald-700 border border-dashed border-emerald-200 rounded-lg px-3 py-1.5 w-full justify-center hover:bg-emerald-50 transition"
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
                Add dimension
              </button>
            </div>
          </Field>

          <Field label="Custom metrics (optional)">
            <p className="text-[11px] text-gray-400 mb-1.5">
              Raw Windsor fields with no formula (e.g. GA4&apos;s bounceRate) — read straight from
              the response and shown wherever this source&apos;s Table Widgets let you pick a metric
              column.
            </p>
            <div className="space-y-1.5">
              {customMetrics.map((m, i) => (
                <MetricRow
                  key={i}
                  m={m}
                  onChange={(next) =>
                    setCustomMetrics((rs) => rs.map((r, j) => (j === i ? next : r)))
                  }
                  onRemove={() => setCustomMetrics((rs) => rs.filter((_, j) => j !== i))}
                />
              ))}
              <button
                type="button"
                onClick={() => setCustomMetrics((rs) => [...rs, { ...emptyMetric }])}
                className="flex items-center gap-1.5 text-[12px] text-emerald-600 hover:text-emerald-700 border border-dashed border-emerald-200 rounded-lg px-3 py-1.5 w-full justify-center hover:bg-emerald-50 transition"
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
                Add metric
              </button>
            </div>
          </Field>
        </div>

        {error && <p className="text-[12px] text-red-500 mt-3">{error}</p>}

        <div className="flex gap-2 mt-5">
          {!isNew &&
            (confirmDel ? (
              <button
                onClick={del}
                disabled={busy}
                className="text-[13px] font-medium bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-xl transition disabled:opacity-50"
              >
                Confirm delete
              </button>
            ) : (
              <button
                onClick={() => setConfirmDel(true)}
                className="text-[13px] font-medium border border-red-200 text-red-600 px-3 py-2 rounded-xl hover:bg-red-50 transition"
              >
                Delete
              </button>
            ))}
          <button
            onClick={onClose}
            className="flex-1 text-[13px] font-medium border border-gray-200 text-gray-600 py-2 rounded-xl hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 text-[13px] font-medium bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-xl transition disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
