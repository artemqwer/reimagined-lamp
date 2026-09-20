"use client";

import React from "react";

// ─── Icons ───────────────────────────────────────────────────────────────────

export const I = {
  click: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 4 7.07 17 2.51-7.39L21 11.07z" />
    </svg>
  ),
  bar: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  ),
  percent: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  ),
  cart: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  ),
  target: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  ),
  dollar: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  trending: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  refresh: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  ),
  sparkle: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L14.39 8.26L21 9.27L16 14.14L17.18 21.02L12 17.77L6.82 21.02L8 14.14L3 9.27L9.61 8.26L12 2Z" />
    </svg>
  ),
  profit: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
};

// ─── Types ────────────────────────────────────────────────────────────────────

// The chart "by" options. Google Ads' own set is enumerated here; every other
// source contributes its manifest dimensions' labels at runtime, so this is a
// string rather than a closed union.
export type ChartGroupBy = string;
export const GOOGLE_CHART_GROUPBY = [
  "Campaign",
  "Campaign Type",
  "Keyword",
  "Match Type",
  "Search Term",
  "Device",
  "Network",
  "State",
] as const;
export const GROUPBY_TO_DIM: Partial<Record<ChartGroupBy, string>> = {
  "Match Type": "match_type",
  Device: "device",
  Network: "network",
};
export type SortDir = "asc" | "desc" | null;
export type SortKey = keyof (typeof campaignRows)[number];
export type DateAction = { start: string; end: string; label: string };
// A one-click "Show on dashboard" suggestion the AI attaches to an answer: it
// applies cross-filters (and optionally a date range) to the live dashboard.
export type FilterAction = {
  label: string;
  // Each filter targets one dimension. Use `values` for an explicit set, or
  // `search` for a "contains" filter (the client resolves it to ALL matching
  // values via the data API — same as the table's search box).
  filters?: { dimension: string; values?: string[]; search?: string }[];
  date_from?: string;
  date_to?: string;
};
export type AiMessage = {
  id: number;
  role: "assistant" | "user";
  text: string;
  time: string;
  suggestions?: string[];
  pinned: boolean;
  dateAction?: DateAction;
  filterAction?: FilterAction;
  actions?: string[];
};
// Matches the Core Analyst master prompt Output Structure.
export type AiConfidence = "High" | "Medium" | "Low";
export type AiInsight = {
  insight: string; // what was discovered
  details?: string; // full free-form analysis (numbers/breakdown) — chat-level depth
  whyItMatters?: string; // business significance
  rootCause?: string; // most likely explanation
  action: string[]; // recommended next steps
  impact?: string; // estimated business impact (only with evidence)
  confidence?: AiConfidence; // High / Medium / Low
  filterAction?: FilterAction; // "View on dashboard" — applies the exact filters behind this insight
};
export type AiSelectionChip = { dimension: string; values: string[] };
export interface ChatSession {
  id: string;
  title: string;
  messages: AiMessage[];
  insights: AiInsight[];
  created_at: string;
  updated_at: string;
}
export type AdPerfItem = {
  date: string;
  _iso?: string;
  convValue: number;
  cost: number;
  profit: number;
  clicks: number;
  conv: number;
  roas: number;
  costBar: number;
  profitBar: number;
  lossBar: number;
};
export type PlItem = { date: string; _iso?: string; dailyProfit: number; cumulative: number };

// ─── Mock data ───────────────────────────────────────────────────────────────

const _today = new Date();
_today.setUTCHours(0, 0, 0, 0);
export const END_MS_NOW = _today.getTime();

export const SPARK_DATES = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(END_MS_NOW);
  d.setUTCDate(d.getUTCDate() - (13 - i));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
});

export const sparkData = (up: boolean, seed = 1) =>
  Array.from({ length: 14 }, (_, i) => ({
    v: up
      ? 30 + Math.sin(i * 0.7 + seed) * 8 + i * 2.5
      : 60 - Math.sin(i * 0.7 + seed) * 8 - i * 1.5,
    date: SPARK_DATES[i],
  }));

// The canonical KPI set. `slot` identifies each card so a connector's manifest can
// pick WHICH of them it shows and relabel them (GA4 calls the traffic slot
// "Sessions", Shopify calls it "Items Sold"). Order here = Google Ads' order.
export const kpis = [
  {
    slot: "clicks",
    label: "Clicks",
    shortLabel: "Clicks",
    icon: I.click,
    iconColor: "#7c3aed",
    value: "1.40K",
    delta: "+8.3%",
    up: true,
    desc: "Total ad clicks in the selected period",
    hoverFmt: (v: number) => `${(v * 0.0083 + 0.95).toFixed(2)}K`,
  },
  {
    slot: "convRate",
    label: "Conv. Rate",
    shortLabel: "CVR",
    icon: I.percent,
    iconColor: "#e11d48",
    value: "2.47%",
    delta: "-1.8%",
    up: false,
    desc: "% of clicks that result in a conversion",
    hoverFmt: (v: number) => `${(v * 0.032).toFixed(2)}%`,
  },
  {
    slot: "conversions",
    label: "Orders",
    shortLabel: "Orders",
    icon: I.cart,
    iconColor: "#16a34a",
    value: "34.63K",
    delta: "+15.7%",
    up: true,
    desc: "Total completed orders attributed to ads",
    hoverFmt: (v: number) => `${(v * 0.12 + 27).toFixed(2)}K`,
  },
  {
    slot: "cpa",
    label: "CPA ($)",
    shortLabel: "CPA",
    icon: I.target,
    iconColor: "#7c3aed",
    value: "20.42",
    delta: "-8.2%",
    up: false,
    desc: "Average cost per conversion/acquisition",
    hoverFmt: (v: number) => `$${(63 - v * 0.69).toFixed(2)}`,
  },
  {
    slot: "cost",
    label: "Cost ($)",
    shortLabel: "Cost",
    icon: I.dollar,
    iconColor: "#16a34a",
    value: "701.18K",
    delta: "+6.4%",
    up: true,
    desc: "Total advertising spend in the period",
    hoverFmt: (v: number) => `$${(v * 2 + 590).toFixed(0)}K`,
  },
  {
    slot: "revenue",
    label: "Revenue",
    shortLabel: "Revenue",
    icon: I.dollar,
    iconColor: "#16a34a",
    value: "1.25K",
    delta: "+18.2%",
    up: true,
    desc: "Total revenue generated from ad-driven sales",
    hoverFmt: (v: number) => `${(v * 0.006 + 0.92).toFixed(2)}K`,
  },
  {
    slot: "roas",
    label: "ROAS",
    shortLabel: "ROAS",
    icon: I.bar,
    iconColor: "#16a34a",
    value: "1.76",
    delta: "-12.1%",
    up: false,
    desc: "Return on ad spend — revenue divided by cost",
    hoverFmt: (v: number) => `${(2.3 - v * 0.012).toFixed(2)}x`,
  },
  {
    slot: "profit",
    label: "Ad Profit ($)",
    shortLabel: "Profit",
    icon: I.trending,
    iconColor: "#16a34a",
    value: "538.48K",
    delta: "+22.8%",
    up: true,
    desc: "Revenue minus total advertising costs",
    hoverFmt: (v: number) => `$${(v * 1.9 + 413).toFixed(0)}K`,
  },
  // Cost-free sources (Shopify) show average order value instead of the ad metrics.
  {
    slot: "aov",
    label: "AOV",
    shortLabel: "AOV",
    icon: I.cart,
    iconColor: "#16a34a",
    value: "36.10",
    delta: "+2.1%",
    up: true,
    desc: "Average order value — revenue divided by orders",
    hoverFmt: (v: number) => `$${v.toFixed(2)}`,
  },
];

export const CAMPAIGNS = [
  "Search - Men T-Shirts",
  "Search - Men Shirts",
  "PMax - Women Clothing",
  "Search - Men Jeans",
  "Display - Retargeting",
  "PMax - Summer Collection",
  "PMax - Men Pants",
  "Search - Men Jackets",
  "Search - Men Sneakers",
  "Shopping - Winter Clearance",
];
export const COLORS = [
  "#F472B6",
  "#FB923C",
  "#FACC15",
  "#4ADE80",
  "#A78BFA",
  "#60A5FA",
  "#10b981",
  "#10b981",
  "#f59e0b",
  "#6366f1",
];

export const CAMPAIGN_TYPE_MAP: Record<string, string> = {
  "Search - Men T-Shirts": "Search",
  "Search - Men Shirts": "Search",
  "PMax - Women Clothing": "PMax",
  "Search - Men Jeans": "Search",
  "Display - Retargeting": "Display",
  "PMax - Summer Collection": "PMax",
  "PMax - Men Pants": "PMax",
  "Search - Men Jackets": "Search",
  "Search - Men Sneakers": "Search",
  "Shopping - Winter Clearance": "Shopping",
};
export const TYPES = [
  "Search",
  "Shopping",
  "PMax",
  "Display",
  "Video",
  "Demand Gen",
  "App",
  "Smart",
  "Local",
  "Other",
];
export const TYPE_COLORS_MAP: Record<string, string> = {
  Search: "#60A5FA",
  Shopping: "#FACC15",
  PMax: "#A78BFA",
  Display: "#F472B6",
  Video: "#FB7185",
  "Demand Gen": "#34D399",
  App: "#22D3EE",
  Smart: "#FBBF24",
  Local: "#A3E635",
  Other: "#9CA3AF",
};

// Map a Google Ads advertising_channel_type enum (or Windsor string) to a short
// display label. Returns null when the value is empty/unknown so callers can fall
// back to a heuristic.
export function normalizeChannelType(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (!s || s === "UNKNOWN" || s === "UNSPECIFIED") return null;
  if (s.includes("PERFORMANCE_MAX") || s === "PMAX") return "PMax";
  if (s.includes("SHOPPING")) return "Shopping";
  if (s.includes("DISPLAY")) return "Display";
  if (s.includes("DEMAND_GEN") || s.includes("DISCOVERY")) return "Demand Gen";
  if (s.includes("VIDEO")) return "Video";
  if (s.includes("APP") || s.includes("MULTI_CHANNEL")) return "App";
  if (s.includes("SMART")) return "Smart";
  if (s.includes("LOCAL")) return "Local";
  if (s.includes("SEARCH")) return "Search";
  return "Other";
}

// "Match Type" intentionally excluded from the Trends "By" dropdown (limited value
// here; analysed in the detailed Match Type report instead).
export const CHART_GROUPBY: ChartGroupBy[] = ["Campaign", "Campaign Type", "Device", "Network"];

// Per-day share distribution (cycling for any period length)
export const shareMatrix: number[][] = [
  [0.08, 0.12, 0.07, 0.12, 0.08, 0.13, 0.1, 0.08, 0.1, 0.12],
  [0.09, 0.11, 0.08, 0.11, 0.09, 0.12, 0.11, 0.07, 0.11, 0.11],
  [0.08, 0.13, 0.07, 0.13, 0.07, 0.11, 0.12, 0.09, 0.09, 0.11],
  [0.07, 0.12, 0.09, 0.12, 0.1, 0.1, 0.11, 0.1, 0.1, 0.09],
  [0.08, 0.11, 0.08, 0.14, 0.08, 0.12, 0.09, 0.11, 0.1, 0.09],
  [0.09, 0.12, 0.07, 0.13, 0.08, 0.11, 0.1, 0.12, 0.09, 0.09],
  [0.07, 0.15, 0.08, 0.12, 0.06, 0.12, 0.08, 0.13, 0.08, 0.11],
  [0.08, 0.13, 0.07, 0.13, 0.09, 0.1, 0.11, 0.1, 0.1, 0.09],
  [0.09, 0.11, 0.08, 0.11, 0.08, 0.13, 0.1, 0.12, 0.08, 0.1],
  [0.08, 0.14, 0.07, 0.12, 0.07, 0.12, 0.09, 0.13, 0.09, 0.09],
  [0.07, 0.12, 0.09, 0.13, 0.1, 0.09, 0.11, 0.12, 0.08, 0.09],
  [0.08, 0.13, 0.08, 0.12, 0.08, 0.11, 0.1, 0.12, 0.09, 0.09],
  [0.09, 0.11, 0.07, 0.14, 0.09, 0.1, 0.11, 0.13, 0.08, 0.08],
  [0.08, 0.12, 0.08, 0.13, 0.08, 0.11, 0.1, 0.12, 0.09, 0.09],
];

// ─── Period presets & data generation ────────────────────────────────────────

export const PERIOD_PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 14 days", days: 14 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 60 days", days: 60 },
  { label: "Last 90 days", days: 90 },
];

export const END_MS = END_MS_NOW;
export const DAY_MS = 86400000;

export const fmtMs = (ts: number) =>
  new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export const TYPE_TO_GROUPS: Record<string, string[]> = {
  Search: ["Search"],
  PMax: ["PMax"],
  Shopping: ["Shopping"],
  Display: ["Remarketing"],
};

// ─── Timeline data (static — event log independent of period) ────────────────

export const tlEventItems = [
  { date: "Mar 30", bg: "bg-orange-100", icon: "🎉" },
  { date: "Apr 1", bg: "bg-emerald-100", icon: "📅" },
  { date: "Apr 2", bg: "bg-red-100", icon: "🎂" },
  { date: "Apr 4", bg: "bg-green-100", icon: "🛍️" },
  { date: "Apr 5", bg: "bg-purple-100", icon: "⭐" },
  { date: "Apr 8", bg: "bg-pink-100", icon: "🎂" },
  { date: "Apr 10", bg: "bg-emerald-100", icon: "📅" },
  { date: "Apr 11", bg: "bg-orange-100", icon: "🎉" },
];

export const tlAdItems = [
  { date: "Mar 30", bg: "bg-emerald-100", count: 5 },
  { date: "Mar 31", bg: "bg-orange-100", count: 5 },
  { date: "Apr 1", bg: "bg-green-100", count: 6 },
  { date: "Apr 2", bg: "bg-red-100", count: 5 },
  { date: "Apr 3", bg: "bg-purple-100", count: 5 },
  { date: "Apr 4", bg: "bg-emerald-100", count: 8 },
  { date: "Apr 5", bg: "bg-orange-100", count: 5 },
  { date: "Apr 6", bg: "bg-green-100", count: 6 },
  { date: "Apr 7", bg: "bg-red-100", count: 3 },
  { date: "Apr 8", bg: "bg-purple-100", count: 3 },
  { date: "Apr 9", bg: "bg-emerald-100", count: 5 },
  { date: "Apr 10", bg: "bg-orange-100", count: 6 },
  { date: "Apr 11", bg: "bg-red-100", count: 3 },
  { date: "Apr 12", bg: "bg-green-100", count: 4 },
];

export const tlWebItems = [
  { date: "Mar 31", bg: "bg-teal-100", icon: "🌐" },
  { date: "Apr 1", bg: "bg-emerald-100", icon: "🔧" },
  { date: "Apr 3", bg: "bg-orange-100", icon: "💻" },
  { date: "Apr 5", bg: "bg-teal-100", icon: "🌐" },
  { date: "Apr 7", bg: "bg-sky-100", icon: "🌐" },
  { date: "Apr 9", bg: "bg-pink-100", icon: "🔗" },
  { date: "Apr 10", bg: "bg-teal-100", icon: "💻" },
  { date: "Apr 11", bg: "bg-red-100", icon: "🌐" },
  { date: "Apr 12", bg: "bg-purple-100", icon: "📊" },
];

// ─── Segments data ───────────────────────────────────────────────────────────

export const SEG_COLORS = [
  "#10b981",
  "#10b981",
  "#f59e0b",
  "#6366f1",
  "#f43f5e",
  "#06b6d4",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

export const segRevenue = [
  { name: "PMax - Men Jackets", value: 236600 },
  { name: "Shopping - Women Sneakers", value: 231610 },
  { name: "PMax - Premium Brands", value: 207270 },
  { name: "PMax - Women Dresses", value: 199760 },
  { name: "PMax - Accessories", value: 184270 },
  { name: "Search - Men Hoodies", value: 178090 },
  { name: "Search - Men T-Shirts", value: 167620 },
  { name: "PMax - Sportswear", value: 142660 },
  { name: "Display - Summer Sale", value: 135290 },
  { name: "Others", value: 1070000 },
];

export const segAdProfit = [
  { name: "Shopping - Women Sneakers", value: 126110 },
  { name: "PMax - Premium Brands", value: 112690 },
  { name: "PMax - Women Dresses", value: 99880 },
  { name: "Search - Men T-Shirts", value: 99450 },
  { name: "PMax - Men Jackets", value: 88720 },
  { name: "Search - Men Hoodies", value: 73330 },
  { name: "Search - Women Jeans", value: 65430 },
  { name: "PMax - Accessories", value: 65420 },
  { name: "PMax - Sportswear", value: 58390 },
  { name: "Others", value: 377020 },
];

export const segConversions = [
  { name: "Search - Men Boots", value: 5400 },
  { name: "Search - Men Shirts", value: 4760 },
  { name: "Search - Men Suits", value: 4690 },
  { name: "Search - Men Jackets", value: 3700 },
  { name: "Shopping - Men Outerwear", value: 3430 },
  { name: "Search - Women Skirts", value: 3400 },
  { name: "PMax - Men Clothing", value: 2960 },
  { name: "Search - Men Jeans", value: 2950 },
  { name: "Search - Men Tops", value: 2930 },
  { name: "Others", value: 37500 },
];

export const campaignRows = [
  {
    status: "gray",
    name: "Search - Men T-Shirts",
    type: "Search",
    roas: "160.00%",
    roasColor: "green",
    impr: 886714,
    clicks: 75539,
    cpc: 0.25,
    ctr: 8.55,
    convRate: 0.74,
    conv: 563,
    cpa: 33.1,
    revenue: 87.65,
    cost: 18.64,
    profit: 69.01,
    roasVal: 470,
  },
  {
    status: "green",
    name: "Search - Men Shirts",
    type: "Search",
    roas: "94.00%",
    roasColor: "red",
    impr: 1562745,
    clicks: 75079,
    cpc: 1.05,
    ctr: 4.81,
    convRate: 2.15,
    conv: 1617,
    cpa: 48.6,
    revenue: 32.89,
    cost: 78.52,
    profit: -45.63,
    roasVal: 42,
  },
  {
    status: "gray",
    name: "PMax - Women Clothing",
    type: "PMax",
    roas: "117.00%",
    roasColor: "red",
    impr: 1894617,
    clicks: 73585,
    cpc: 0.81,
    ctr: 3.88,
    convRate: 0.31,
    conv: 227,
    cpa: 262.7,
    revenue: 29.43,
    cost: 59.64,
    profit: -30.21,
    roasVal: 49,
  },
  {
    status: "green",
    name: "Search - Men Jeans",
    type: "Search",
    roas: "160.00%",
    roasColor: "green",
    impr: 1907150,
    clicks: 66455,
    cpc: 0.49,
    ctr: 3.48,
    convRate: 1.49,
    conv: 993,
    cpa: 32.9,
    revenue: 16.69,
    cost: 32.32,
    profit: -15.63,
    roasVal: 52,
  },
  {
    status: "gray",
    name: "Display - Retargeting",
    type: "Display",
    roas: "196.00%",
    roasColor: "green",
    impr: 1549087,
    clicks: 65290,
    cpc: 1.45,
    ctr: 4.21,
    convRate: 1.55,
    conv: 1014,
    cpa: 93.3,
    revenue: 22.79,
    cost: 94.57,
    profit: -71.78,
    roasVal: 24,
  },
  {
    status: "gray",
    name: "PMax - Summer Collection",
    type: "PMax",
    roas: "null",
    roasColor: "gray",
    impr: 615426,
    clicks: 65273,
    cpc: 0.87,
    ctr: 10.61,
    convRate: 1.62,
    conv: 1058,
    cpa: 53.6,
    revenue: 28.17,
    cost: 56.66,
    profit: -28.48,
    roasVal: 50,
  },
  {
    status: "green",
    name: "PMax - Men Pants",
    type: "PMax",
    roas: "140.00%",
    roasColor: "orange",
    impr: 2166739,
    clicks: 63929,
    cpc: 1.5,
    ctr: 4.16,
    convRate: 1.72,
    conv: 1096,
    cpa: 31.8,
    revenue: 34.86,
    cost: 95.94,
    profit: -61.08,
    roasVal: 36,
  },
  {
    status: "green",
    name: "Search - Men Jackets",
    type: "Search",
    roas: "109.00%",
    roasColor: "red",
    impr: 2079414,
    clicks: 62116,
    cpc: 1.8,
    ctr: 2.99,
    convRate: 1.73,
    conv: 1072,
    cpa: 59.2,
    revenue: 63.47,
    cost: 111.73,
    profit: -48.27,
    roasVal: 57,
  },
  {
    status: "gray",
    name: "Search - Men Sneakers",
    type: "Search",
    roas: "167.00%",
    roasColor: "green",
    impr: 1589954,
    clicks: 60281,
    cpc: 1.74,
    ctr: 3.79,
    convRate: 2.14,
    conv: 1289,
    cpa: 81.6,
    revenue: 59.02,
    cost: 104.97,
    profit: -45.95,
    roasVal: 56,
  },
  {
    status: "green",
    name: "Shopping - Winter Clearance",
    type: "Shopping",
    roas: "100.00%",
    roasColor: "green",
    impr: 1127851,
    clicks: 60175,
    cpc: 0.42,
    ctr: 5.34,
    convRate: 0.27,
    conv: 164,
    cpa: 155.4,
    revenue: 53.61,
    cost: 25.49,
    profit: 28.13,
    roasVal: 210,
  },
];

// Desktop / laptop / tablet tab labels. Mobile overrides only "Profit & Loss" → "P&L"
// (see the mobile <select> in the dashboard). Order/indices must stay fixed —
// activeTab logic is index-based.
export const tabs = ["Trends", "Performance", "Profit & Loss", "Distribution", "Sales"];

// Which canonical tab index each manifest tab key renders. A connector lists the
// keys it supports (GA4 has no ad spend, so no Performance / P&L); the index is
// what `activeTab` and TabContent switch on, so it must never be reordered.
export const TAB_INDEX: Record<string, number> = {
  trends: 0,
  performance: 1,
  pl: 2,
  distribution: 3,
  sales: 4,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Format a raw count (impressions, clicks, conversions) with compact K/M for thousands+.
export const fmtNum = (n: number): string => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(2)}K`;
  // Sub-1 fractional values (from cross-filter distribution) keep two decimals
  if (abs > 0 && abs < 1) return `${sign}${abs.toFixed(2)}`;
  return `${sign}${Math.round(abs)}`;
};

// Format a value that lives in "K" units (i.e. raw / 1000):
//   raw <    1,000  →  full number, no suffix  (e.g. 999, 125.50)
//   raw <  1,000,000 →  X.XXK                  (e.g. 1.00K, 12.50K)
//   raw >= 1,000,000 →  X.XXM                  (e.g. 1.25M)
// Returns the magnitude only — callers prefix with "$" / "-$" as needed.
export const fmtK = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1000) return `${(abs / 1000).toFixed(2)}M`;
  if (abs >= 1) return `${abs.toFixed(2)}K`;
  return `${(abs * 1000).toFixed(2)}`;
};

export const fmtPct = (n: number) => `${n.toFixed(2)}%`;

// Format a raw currency value (e.g. $123.45) with compact K/M for thousands+.
export const fmtCurrency = (n: number): string => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
};

// Adaptive number formatting for CHART axes / tooltips / labels. Takes a RAW value:
//   < 1,000        → the full number (10, 35, 120, 850, 76.91) — no "K"
//   1,000 … <1M    → 1.2K, 15.8K, 235K   (integer once ≥100K to stay compact)
//   ≥ 1,000,000    → 1.3M, 235M
// Keeps small values readable instead of "0.01K" / "0.04K".
export function fmtChartNum(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}${m >= 100 ? Math.round(m) : +m.toFixed(1)}M`;
  }
  if (abs >= 1000) {
    const k = abs / 1000;
    return `${sign}${k >= 100 ? Math.round(k) : +k.toFixed(1)}K`;
  }
  return `${sign}${+abs.toFixed(2)}`;
}
// Same, prefixed with "$" (or "-$" for negatives).
export function fmtChartMoney(v: number): string {
  return `${v < 0 ? "-$" : "$"}${fmtChartNum(Math.abs(v))}`;
}

// Heatmap color scale: value between min/max → intensity 0..1
export function heatmapBg(
  value: number,
  min: number,
  max: number,
  color: "blue" | "green" | "red",
): string {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const alpha = 0.08 + t * 0.35;
  if (color === "blue") return `rgba(59, 130, 246, ${alpha})`;
  if (color === "green") return `rgba(34, 197, 94, ${alpha})`;
  return `rgba(239, 68, 68, ${alpha})`;
}

// ─── AI Assistant helpers ─────────────────────────────────────────────────────

export function parseBold(line: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let rest = line;
  let k = 0;
  while (rest.length > 0) {
    const s = rest.indexOf("**");
    if (s === -1) {
      nodes.push(rest);
      break;
    }
    if (s > 0) nodes.push(rest.slice(0, s));
    rest = rest.slice(s + 2);
    const e = rest.indexOf("**");
    if (e === -1) {
      nodes.push("**" + rest);
      break;
    }
    nodes.push(<strong key={k++}>{rest.slice(0, e)}</strong>);
    rest = rest.slice(e + 2);
  }
  return nodes;
}

export function renderAiText(text: string) {
  return String(text ?? "")
    .split("\n")
    .map((line, i) =>
      line ? (
        <p key={i} className="leading-relaxed">
          {parseBold(line)}
        </p>
      ) : (
        <span key={i} className="block h-2" />
      ),
    );
}

export const AI_METRICS = [
  { label: "Impr.", value: "1.73M" },
  { label: "Clicks", value: "144,022" },
  { label: "CPC", value: "$1.47" },
  { label: "CTR", value: "8.3%" },
  { label: "Conv. rate", value: "5.5%" },
  { label: "Conv.", value: "7,888" },
  { label: "CPA", value: "$26.87" },
  { label: "Revenue", value: "$759.69K" },
  { label: "Cost", value: "$211.96K" },
  { label: "Profit (ads)", value: "$547.73K", hi: "text-green-600" },
  { label: "ROAS", value: "3.58", hi: "text-emerald-600" },
];

export const AI_QUICK = [
  {
    label: "Find Issues",
    icon: (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
    ),
  },
  {
    label: "Improve ROAS",
    icon: (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      </svg>
    ),
  },
  {
    label: "Cut Costs",
    icon: (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    label: "Boost Performance",
    icon: (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
];
