"use client";

import React, { useState, useEffect } from "react";
import PerformanceTable from "./PerformanceTable";
import TimePerformanceTable from "./TimePerformanceTable";
import ConfigurableTableWidget from "./ConfigurableTableWidget";
import { useCrossFilter } from "@/lib/store";
import { connectorTableList, applyTableConfig, getConnector } from "@/lib/connectors";

interface ExtendedAnalyticsProps {
  dateFrom: string;
  dateTo: string;
  effectiveDateFrom: string;
  effectiveDateTo: string;
  rangeLabel: string;
}

function ComingSoonTable({ title }: { title: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200">
      <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex items-center gap-3">
        <h2 className="text-[15px] sm:text-[17px] font-bold text-gray-900">{title}</h2>
        <span className="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">
          Coming soon
        </span>
      </div>
      <div className="flex items-center justify-center py-10 gap-2 text-gray-400 text-[13px]">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        This dimension will be available in the next update.
      </div>
    </div>
  );
}

export default function ExtendedAnalytics({
  dateFrom,
  dateTo,
  effectiveDateFrom,
  effectiveDateTo,
  rangeLabel,
}: ExtendedAnalyticsProps) {
  const [open, setOpen] = useState(false);
  // Arriving from the AI Optimizer's "Explore in Dashboard" / "Open Detailed
  // Analytics": the user came for exactly these tables and filters, so open the
  // section for them. A one-shot sessionStorage flag set by the optimizer,
  // consumed once here (read in an effect, not initial state, so the server and
  // first client render agree). Normal visits leave it collapsed as before.
  useEffect(() => {
    try {
      if (sessionStorage.getItem("dr_expand_analytics") === "1") {
        sessionStorage.removeItem("dr_expand_analytics");
        setOpen(true);
      }
    } catch {
      /* storage unavailable — the section just stays collapsed */
    }
  }, []);
  const activeConnector = useCrossFilter((s) => s.activeConnector);
  const connectorConfigs = useCrossFilter((s) => s.connectorConfigs);
  const primaryTableSource = connectorConfigs[activeConnector]?.primaryTableSource;
  // Whichever dimension currently renders in the hero slot at the top of the
  // dashboard (see page.tsx) must be excluded here, or it'd show up twice —
  // once as hero, once in this stacked list. Defaults to the manifest's own
  // primaryDimension (unchanged behaviour) unless an admin swapped a
  // different one into that slot.
  const effectivePrimaryKey =
    primaryTableSource?.type === "dimension"
      ? primaryTableSource.key
      : getConnector(activeConnector).primaryDimension;

  // Tables come from the connector's table list, then the admin's global config
  // (visibility / order / labels) is applied — so every user sees what the admin
  // configured for this data source. Empty config = built-in defaults.
  const tables = applyTableConfig(
    connectorTableList(activeConnector, effectivePrimaryKey),
    connectorConfigs[activeConnector]?.dimensions,
  );
  // An admin who has built "table widgets" (TableConfigV2 — own metric columns,
  // cross-filtering, default sort per table) for this connector gets those
  // instead of the built-in stacked list below; a connector nobody has
  // reconfigured this way keeps rendering exactly as before. A widget that's
  // been promoted into the hero slot is excluded here too (it's rendered
  // above instead), same reasoning as the dimension case.
  const tableWidgets = (connectorConfigs[activeConnector]?.tables ?? [])
    .filter((t) => t.enabled)
    .filter((t) => !(primaryTableSource?.type === "widget" && primaryTableSource.widgetId === t.id))
    .sort((a, b) => a.order - b.order);
  const subtitle =
    tableWidgets.length > 0
      ? tableWidgets.map((t) => t.name).join(" • ")
      : tables.map((t) => t.dimensionLabel).join(" • ");

  // A source whose only breakdown IS the one already shown above has nothing
  // left for this section. Rendering the toggle anyway gives a card that opens
  // onto nothing, which reads as broken rather than as "there is nothing here".
  if (tableWidgets.length === 0 && tables.length === 0) return null;

  return (
    <div className="mt-4">
      {/* Toggle — a full bordered, clearly clickable card with an icon (Figma). */}
      <div
        className={`bg-white border rounded-2xl transition mb-3 ${open ? "border-gray-200" : "border-gray-200 hover:border-emerald-300 hover:shadow-sm"}`}
      >
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-3 min-w-0 flex-1 text-left group"
          >
            <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#2563eb"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 3v18h18" />
                <path d="m19 9-5 5-4-4-3 3" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-gray-900 leading-tight">
                Extended Analytics
              </p>
              <p className="text-[12px] text-gray-400 truncate">{subtitle}</p>
            </div>
          </button>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Filter clearing lives only in the global sticky Active Filters bar —
                no duplicate Clear all here. Only the Show / Hide toggle remains. */}
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1 text-[13px] font-semibold text-emerald-600 hover:text-emerald-700 transition shrink-0"
            >
              {open ? "Hide" : "Show"}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Tables */}
      {open && (
        <div className="space-y-4">
          {tableWidgets.length > 0
            ? tableWidgets.map((t) => (
                <ConfigurableTableWidget
                  key={t.id}
                  config={t}
                  dateFrom={effectiveDateFrom}
                  dateTo={effectiveDateTo}
                  rangeLabel={rangeLabel}
                  isVisible={open}
                />
              ))
            : tables.map((t) => {
                if (!t.available) return <ComingSoonTable key={t.key} title={t.label} />;
                if (t.custom === "time") {
                  return (
                    <TimePerformanceTable
                      key={t.key}
                      dateFrom={dateFrom}
                      dateTo={dateTo}
                      rangeLabel={rangeLabel}
                      isVisible={open}
                    />
                  );
                }
                return (
                  <PerformanceTable
                    key={t.key}
                    title={t.label}
                    dimensionLabel={t.dimensionLabel}
                    dimensionKey={t.key}
                    dateFrom={effectiveDateFrom}
                    dateTo={effectiveDateTo}
                    rangeLabel={rangeLabel}
                    isVisible={open}
                  />
                );
              })}
        </div>
      )}
    </div>
  );
}
