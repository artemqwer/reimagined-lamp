import { create } from "zustand";
import {
  DEFAULT_CONNECTOR,
  isConnectorId,
  connectorFromSlug,
  applyAdminCustomFields,
  type ConnectorId,
  type ConnectorConfigMap,
  onConnectorRegistryChange,
} from "./connectors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RowArray = any[] | null;

const CONNECTOR_LS_KEY = "activeConnector";
function initialConnector(): ConnectorId {
  if (typeof window === "undefined") return DEFAULT_CONNECTOR;
  // The URL wins: each source has its own dashboard path, so a pasted or
  // reloaded link must open that source rather than whichever one was last
  // used. localStorage is only the fallback for pages that name no source.
  const fromUrl = connectorFromSlug(window.location.pathname.split("/")[1] ?? "");
  if (fromUrl) return fromUrl;
  const v = window.localStorage.getItem(CONNECTOR_LS_KEY);
  return isConnectorId(v) ? v : DEFAULT_CONNECTOR;
}

interface CrossFilterState {
  // Which connected data source (Google Ads / Meta / GA4 / Shopify) the dashboard
  // is currently showing. Persisted to localStorage so it survives reloads.
  activeConnector: ConnectorId;
  setActiveConnector: (id: ConnectorId) => void;
  // Admin-defined, global per-connector overrides (which tables/metrics show, order,
  // labels) loaded from /api/connector-config. Empty = built-in manifest defaults.
  connectorConfigs: ConnectorConfigMap;
  setConnectorConfigs: (v: ConnectorConfigMap) => void;
  // Bumped whenever admin-added sources are loaded into the connector
  // registry. The registry is a plain module-level object, so nothing in React
  // re-renders on its own when it grows — anything deriving a list from it
  // (the Sidebar's platform list) reads this to recompute.
  connectorsVersion: number;
  bumpConnectorsVersion: () => void;
  filters: Record<string, string[]>;
  // Per-dimension "contains" search (e.g. set by the AI's show_on_dashboard with
  // a search filter). The matching PerformanceTable uses it as its search so it
  // lists ONLY the found rows — without pushing thousands of values into a URL.
  dimSearch: Record<string, string>;
  // Per-dimension explicit INCLUDE set — narrows that dimension's own table to
  // exactly these values (like picking them in its dropdown). Set by the AI's
  // show_on_dashboard so the source table shows ONLY the analysed rows instead of
  // merely highlighting them. Distinct from `filters` (highlight + cross-filter).
  dimInclude: Record<string, string[]>;
  // Per-dimension EXCLUDE set — the rows unticked from the dropdown's default
  // "everything" state. The dimension's own table drops them via filter_exclude;
  // this shared copy lets the Active Filters bar show them and the cross-filter
  // engine drop them from KPIs / charts / the other tables too.
  dimExclude: Record<string, string[]>;
  tableLoadingCount: number;
  // True while the (often long, 10-40s) cross-filter distribution runs in the
  // background. Tables read it so the "Updating…" indicator stays visible for the
  // WHOLE operation — not just their own quick fetch — and never looks "done" early.
  crossFilterBusy: boolean;
  crossFilterCampaigns: string[] | null;
  crossFilterAdGroups: string[] | null;
  crossFilterKeywords: string[] | null;
  crossFilterMatchTypes: string[] | null;
  // Distributed metric overrides keyed by dimension. When the cross-filter is
  // active, these rows replace the API result for the matching PerformanceTable.
  crossFilterRowsByDim: Record<string, RowArray>;
  // Bumped by clearAll so tables can reset their LOCAL filter state (dropdown
  // selection, status / ROAS pills, search) — not just the shared store.
  clearSignal: number;
  setFilter: (key: string, values: string[]) => void;
  toggleValue: (key: string, value: string) => void;
  selectSingle: (key: string, value: string) => void;
  clearFilter: (key: string) => void;
  setDimSearch: (key: string, value: string) => void;
  setDimInclude: (key: string, values: string[]) => void;
  setDimExclude: (key: string, values: string[]) => void;
  clearAll: () => void;
  incTableLoading: () => void;
  decTableLoading: () => void;
  setCrossFilterBusy: (v: boolean) => void;
  setCrossFilterCampaigns: (v: string[] | null) => void;
  setCrossFilterAdGroups: (v: string[] | null) => void;
  setCrossFilterKeywords: (v: string[] | null) => void;
  setCrossFilterMatchTypes: (v: string[] | null) => void;
  setCrossFilterRowsByDim: (v: Record<string, RowArray>) => void;
}

export const useCrossFilter = create<CrossFilterState>((set, get) => ({
  activeConnector: initialConnector(),
  setActiveConnector: (id) => {
    if (typeof window !== "undefined") window.localStorage.setItem(CONNECTOR_LS_KEY, id);
    // Switching source invalidates every active filter/selection built on the old
    // one, so reset the cross-filter state alongside the connector change.
    set((s) => ({
      activeConnector: id,
      filters: {},
      dimSearch: {},
      dimInclude: {},
      dimExclude: {},
      clearSignal: s.clearSignal + 1,
    }));
  },
  connectorConfigs: {},
  // Keeps the client's own live connector registry (CONNECTORS) in sync too —
  // built-in connectors' admin-registered custom metrics/dimensions (raw
  // Windsor fields) live in this same config and need folding into the
  // manifest wherever connectorMetricCols()/getConnector() reads it, not just
  // this store.
  setConnectorConfigs: (v) => {
    applyAdminCustomFields(v);
    set({ connectorConfigs: v });
  },
  connectorsVersion: 0,
  bumpConnectorsVersion: () => set((s) => ({ connectorsVersion: s.connectorsVersion + 1 })),
  filters: {},
  dimSearch: {},
  dimInclude: {},
  dimExclude: {},
  tableLoadingCount: 0,
  crossFilterBusy: false,
  crossFilterCampaigns: null,
  crossFilterAdGroups: null,
  crossFilterKeywords: null,
  crossFilterMatchTypes: null,
  crossFilterRowsByDim: {},
  clearSignal: 0,

  setFilter: (key, values) => set((s) => ({ filters: { ...s.filters, [key]: values } })),

  toggleValue: (key, value) => {
    const current = get().filters[key] ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    if (next.length === 0) {
      set((s) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [key]: _removed, ...rest } = s.filters;
        return { filters: rest };
      });
    } else {
      set((s) => ({ filters: { ...s.filters, [key]: next } }));
    }
  },

  selectSingle: (key, value) => set((s) => ({ filters: { ...s.filters, [key]: [value] } })),

  clearFilter: (key) =>
    set((s) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [key]: _removed, ...rest } = s.filters;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [key]: _ds, ...restSearch } = s.dimSearch;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [key]: _di, ...restInclude } = s.dimInclude;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [key]: _de, ...restExclude } = s.dimExclude;
      return {
        filters: rest,
        dimSearch: restSearch,
        dimInclude: restInclude,
        dimExclude: restExclude,
      };
    }),

  setDimSearch: (key, value) =>
    set((s) => {
      if (!value) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [key]: _removed, ...rest } = s.dimSearch;
        return { dimSearch: rest };
      }
      return { dimSearch: { ...s.dimSearch, [key]: value } };
    }),

  setDimInclude: (key, values) =>
    set((s) => {
      if (!values || values.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [key]: _removed, ...rest } = s.dimInclude;
        return { dimInclude: rest };
      }
      return { dimInclude: { ...s.dimInclude, [key]: values } };
    }),

  setDimExclude: (key, values) =>
    set((s) => {
      if (!values || values.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [key]: _removed, ...rest } = s.dimExclude;
        return { dimExclude: rest };
      }
      return { dimExclude: { ...s.dimExclude, [key]: values } };
    }),

  clearAll: () =>
    set((s) => ({
      filters: {},
      dimSearch: {},
      dimInclude: {},
      dimExclude: {},
      clearSignal: s.clearSignal + 1,
    })),

  incTableLoading: () => set((s) => ({ tableLoadingCount: s.tableLoadingCount + 1 })),
  decTableLoading: () => set((s) => ({ tableLoadingCount: Math.max(0, s.tableLoadingCount - 1) })),
  setCrossFilterBusy: (v) => set({ crossFilterBusy: v }),
  setCrossFilterCampaigns: (v) => set({ crossFilterCampaigns: v }),
  setCrossFilterAdGroups: (v) => set({ crossFilterAdGroups: v }),
  setCrossFilterKeywords: (v) => set({ crossFilterKeywords: v }),
  setCrossFilterMatchTypes: (v) => set({ crossFilterMatchTypes: v }),
  setCrossFilterRowsByDim: (v) => set({ crossFilterRowsByDim: v }),
}));

// The registry changing is what makes a derived list stale, so the version this
// store hands out is driven by the registry itself rather than by whoever
// happened to load it.
onConnectorRegistryChange(() => {
  useCrossFilter.getState().bumpConnectorsVersion();
});
