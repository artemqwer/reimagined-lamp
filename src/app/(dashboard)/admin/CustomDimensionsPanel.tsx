"use client";

import { useState } from "react";
import { CONNECTORS, type ConnectorId, type CustomConnectorDimensionInput } from "@/lib/connectors";
import {
  DimensionRow,
  WindsorFieldPicker,
  emptyDim,
  type WindsorFieldOption,
} from "./CustomConnectorModal";

// Lets an admin register an extra Windsor field as a dimension on a BUILT-IN
// connector — the same idea CustomConnectorModal already offers when creating
// (or editing) a custom data source, just layered onto
// google_ads/meta_ads/ga4/shopify instead of built from scratch. Saved as
// part of that connector's connector_config row (see
// ConnectorConfig.customDimensions / applyAdminCustomFields in connectors.ts).
export default function CustomDimensionsPanel({
  connectorId,
  dimensions,
  onChange,
}: {
  connectorId: ConnectorId;
  dimensions: CustomConnectorDimensionInput[];
  onChange: (d: CustomConnectorDimensionInput[]) => void;
}) {
  const [loadingFields, setLoadingFields] = useState(false);
  const [fieldsError, setFieldsError] = useState("");
  const [windsorDimOpts, setWindsorDimOpts] = useState<WindsorFieldOption[]>([]);

  const windsorSource = CONNECTORS[connectorId]?.windsorSource ?? "";
  const addedKeys = new Set(dimensions.map((d) => d.key));

  const loadWindsorFields = async () => {
    setLoadingFields(true);
    setFieldsError("");
    try {
      const res = await fetch(
        `/api/admin/windsor-fields?connector=${encodeURIComponent(windsorSource)}`,
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not load fields");
      setWindsorDimOpts(j.dimensions ?? []);
      if ((j.dimensions?.length ?? 0) === 0) {
        setFieldsError("Windsor returned no dimension fields for this connector.");
      }
    } catch (e) {
      setFieldsError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoadingFields(false);
    }
  };

  return (
    <div>
      <div className="px-5 pt-5 pb-1 border-t border-gray-100 flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
          Custom dimensions
        </p>
        <button
          onClick={loadWindsorFields}
          disabled={loadingFields}
          className="text-[11px] font-semibold text-emerald-600 border border-emerald-200 rounded-lg px-2.5 py-1 hover:bg-emerald-50 transition disabled:opacity-50 whitespace-nowrap"
        >
          {loadingFields ? "Loading…" : `Load fields from Windsor (${windsorSource})`}
        </button>
      </div>
      <p className="px-5 pb-2 text-[11px] text-gray-400">
        Extra breakdowns this source can group by — shown wherever this source&apos;s Table Widgets
        let you add a dimension tab.
      </p>
      {fieldsError && <p className="px-5 pb-2 text-[11px] text-red-500">{fieldsError}</p>}

      {windsorDimOpts.length > 0 && (
        <div className="px-5 pb-3">
          <WindsorFieldPicker
            title="Available dimensions from Windsor"
            options={windsorDimOpts}
            addedKeys={addedKeys}
            onAdd={(o) =>
              onChange([
                ...dimensions,
                { key: o.key, label: o.label, singular: o.label, windsorField: o.key },
              ])
            }
          />
        </div>
      )}

      <div className="px-5 pb-3 space-y-1.5">
        {dimensions.map((d, i) => (
          <DimensionRow
            key={i}
            d={d}
            onChange={(next) => onChange(dimensions.map((r, j) => (j === i ? next : r)))}
            onRemove={() => onChange(dimensions.filter((_, j) => j !== i))}
          />
        ))}
        <button
          type="button"
          onClick={() => onChange([...dimensions, { ...emptyDim }])}
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
    </div>
  );
}
