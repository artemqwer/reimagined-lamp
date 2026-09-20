import { rowsApiBase } from "./dataSource";

export interface WindsorDataRow {
  date?: string;
  campaign?: string;
  // The connector's primary-entity value for this row, resolved server-side
  // (see /api/windsor). The cross-filter engine joins dimensions through it.
  pivot?: string;
  clicks: number;
  impressions: number;
  spend: number;
  conversions: number;
  conversion_value: number;
  // Admin-registered custom metrics (raw Windsor fields, no canonical formula)
  // — see ConnectorManifest.customMetricFields in @/lib/connectors.
  extra?: Record<string, number>;
  [key: string]: unknown;
}

// group_by is a connector dimension or `date,<dimension>` — a plain string so any
// connector's primary entity (campaign / product / channel …) works.
export type WindsorGroupBy = string;

export async function fetchWindsorData(
  dateFrom: string,
  dateTo: string,
  groupBy: WindsorGroupBy = "date",
  viewAs?: string | null,
  connector?: string,
): Promise<{ data: WindsorDataRow[]; error?: string; source?: string }> {
  const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, group_by: groupBy });
  if (viewAs) params.set("view_as", viewAs);
  if (connector && connector !== "google_ads") params.set("connector", connector);
  const res = await fetch(`${rowsApiBase()}?${params}`);
  const json = await res.json();

  if (!res.ok) {
    return { data: [], error: json.error ?? `HTTP ${res.status}` };
  }

  const rows: WindsorDataRow[] = Array.isArray(json?.data) ? json.data : [];
  return { data: rows, source: json.source };
}
