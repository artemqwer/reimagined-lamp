"use client";

import { useEffect, useState } from "react";
import PerformanceTable, { type PerformanceTableProps } from "./PerformanceTable";
import { applyMetricColConfig, getDimensionDef, type TableConfigV2 } from "@/lib/connectors";
import { useCrossFilter } from "@/lib/store";

interface Props {
  config: TableConfigV2;
  dateFrom: string;
  dateTo: string;
  rangeLabel: string;
  isVisible: boolean;
}

// An admin-built "table widget" (see TableConfigV2): one table whose grouping
// dimension is switched via tabs (primary + additional dimensions), with its
// own metric columns / cross-filtering / default sort. Reuses PerformanceTable
// as-is for the actual fetch/sort/render — this component only owns the tab
// switcher and translates the config into PerformanceTable's per-instance props.
export default function ConfigurableTableWidget({
  config,
  dateFrom,
  dateTo,
  rangeLabel,
  isVisible,
}: Props) {
  const activeConnector = useCrossFilter((s) => s.activeConnector);
  const dims = [config.primaryDimension, ...config.additionalDimensions];
  const [activeDim, setActiveDim] = useState(config.primaryDimension);

  // A config edit (or connector switch) can leave the active tab pointing at a
  // dimension that's no longer in this widget — fall back to the primary one
  // rather than rendering a blank/mismatched table.
  useEffect(() => {
    if (!dims.includes(activeDim)) setActiveDim(config.primaryDimension);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id, activeConnector]);

  const dimDef = getDimensionDef(activeConnector, activeDim);
  const title = dimDef?.label ?? activeDim;
  const dimensionLabel = dimDef?.singular ?? activeDim;
  const metricCols = applyMetricColConfig(config.metricColumns, activeConnector);
  // TableConfigV2.defaultSort.key is a loosely-typed string (admin config);
  // PerformanceTable's SortCol is a closed union of its own PerfRow keys — this
  // boundary cast is safe because the admin UI only ever offers valid PerfRow
  // metric keys when building defaultSort (see TablesTab's Default Sort picker).
  const defaultSortOverride = (
    config.defaultSort
      ? { key: config.defaultSort.key, direction: config.defaultSort.direction }
      : undefined
  ) as PerformanceTableProps["defaultSortOverride"];

  const tabs = dims.map((key) => ({
    key,
    label: getDimensionDef(activeConnector, key)?.singular ?? key,
  }));

  return (
    <div>
      {tabs.length > 1 && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveDim(t.key)}
              className={`text-[12px] font-medium px-3 py-1.5 rounded-lg border transition ${
                activeDim === t.key
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <PerformanceTable
        key={activeDim}
        title={config.name || title}
        dimensionLabel={dimensionLabel}
        dimensionKey={activeDim}
        dateFrom={dateFrom}
        dateTo={dateTo}
        rangeLabel={rangeLabel}
        isVisible={isVisible}
        metricColsOverride={metricCols}
        crossFilteringEnabled={config.crossFiltering}
        defaultSortOverride={defaultSortOverride}
      />
    </div>
  );
}
