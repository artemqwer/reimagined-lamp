// ─────────────────────────────────────────────────────────────────────────────
// Smart Goals — the event taxonomy its timeline uses.
//
// Three categories, each with its own set of types. This is deliberately NOT
// the taxonomy the campaigns dashboard's timeline uses: that one groups by
// where an event came from (holidays / promotions / website / products / ads),
// this one groups by what part of the business changed, which is what makes a
// swing in a goal explainable. They are kept apart rather than merged so
// neither timeline is ever handed a category it has no meaning for.
// ─────────────────────────────────────────────────────────────────────────────

export type EventCategory = "events" | "ads" | "website";

/** Where an event came from. Manual ones are typed in; the rest arrive from an
 *  API and can't be edited. */
export type EventSource = "manual" | "google_ads" | "holiday" | "anomaly";

export interface EventCategoryDef {
  key: EventCategory;
  label: string;
  /** Track colour on the timeline, and the chip colour in the header. */
  color: string;
  bg: string;
  types: { key: string; label: string; detected?: boolean }[];
}

export const EVENT_CATEGORIES: EventCategoryDef[] = [
  {
    key: "events",
    label: "Events",
    color: "#7F22FE",
    bg: "#F5F3FF",
    types: [
      { key: "holiday", label: "Holiday" },
      { key: "special_event", label: "Special event" },
      { key: "seasonal", label: "Seasonal" },
      { key: "sale", label: "Sale / Promotion" },
      { key: "flash_sale", label: "Flash sale" },
      { key: "clearance", label: "Stock clearance" },
    ],
  },
  {
    key: "ads",
    label: "Ads",
    color: "#0084D1",
    bg: "#F0F9FF",
    types: [
      { key: "bid_change", label: "Bid change" },
      { key: "strategy_change", label: "Strategy change" },
      { key: "negative_keywords", label: "Negative keywords" },
      { key: "budget_change", label: "Budget change" },
      { key: "ad_copy", label: "Ad copy" },
      { key: "targeting", label: "Targeting" },
      { key: "settings", label: "Settings" },
      { key: "google_ads_issue", label: "Google Ads issue" },
      // Detected rather than entered — see smartGoalAnomalies.ts. Listed here
      // so the timeline can label them like anything else; they are not offered
      // in the "add event" modal, which only lists what a person can record.
      { key: "metric_spike", label: "KPI spike", detected: true },
      { key: "metric_drop", label: "KPI drop", detected: true },
      // Older detected types, kept so any stored/legacy reference still resolves.
      { key: "spend_spike", label: "Spend spike", detected: true },
      { key: "spend_drop", label: "Spend drop", detected: true },
      { key: "revenue_drop", label: "Revenue drop", detected: true },
    ],
  },
  {
    key: "website",
    label: "Website",
    color: "#E60076",
    bg: "#FDF2F8",
    types: [
      { key: "site_design", label: "Site design" },
      { key: "new_feature", label: "New feature" },
      { key: "promo", label: "Promotion / Sale" },
      { key: "price_change", label: "Price change" },
      { key: "product_launch", label: "Product launch" },
      { key: "shipping_policy", label: "Shipping policy" },
      { key: "ux_improvement", label: "UX improvement" },
      { key: "shopify_outage", label: "Shopify outage" },
      { key: "payment_issue", label: "Payment issue" },
    ],
  },
];

export const EVENT_CATEGORY_KEYS = EVENT_CATEGORIES.map((c) => c.key);

export function eventCategory(key: EventCategory): EventCategoryDef {
  const def = EVENT_CATEGORIES.find((c) => c.key === key);
  if (!def) throw new Error(`Unknown event category: ${key}`);
  return def;
}

/** Whether a type is one a PERSON can record. Detected types are excluded: they
 *  are produced by the anomaly detector, and accepting one over the API would
 *  let a hand-written event masquerade as something the system found. */
export function isEventType(category: EventCategory, type: string): boolean {
  return EVENT_CATEGORIES.some(
    (c) => c.key === category && c.types.some((t) => t.key === type && !t.detected),
  );
}

/** The types the "add event" modal offers for a category — everything a person
 *  can record, which is every type that isn't detected. */
export function manualEventTypes(category: EventCategory) {
  return eventCategory(category).types.filter((t) => !t.detected);
}

export function eventTypeLabel(category: EventCategory, type: string): string {
  return (
    EVENT_CATEGORIES.find((c) => c.key === category)?.types.find((t) => t.key === type)?.label ??
    type
  );
}

export interface TimelineEvent {
  id: string;
  category: EventCategory;
  type: string;
  /** ISO dates. `endDate` null = a single day. */
  startDate: string;
  endDate: string | null;
  title: string;
  description?: string | null;
  source: EventSource;
}

/** The days a timeline event covers, clamped to the period being shown — a
 *  multi-day event that starts before the month still belongs on it, but only
 *  from the first day the chart actually draws. */
export function eventDays(event: TimelineEvent, periodDays: string[]): string[] {
  const first = periodDays[0];
  const last = periodDays[periodDays.length - 1];
  if (!first || !last) return [];
  const from = event.startDate > first ? event.startDate : first;
  const to = (event.endDate ?? event.startDate) < last ? (event.endDate ?? event.startDate) : last;
  if (from > to) return [];
  return periodDays.filter((d) => d >= from && d <= to);
}

/** How many events each category has in the period — the counts the collapsed
 *  header shows on its chips. */
export function categoryCounts(events: TimelineEvent[]): Record<EventCategory, number> {
  const counts = { events: 0, ads: 0, website: 0 } as Record<EventCategory, number>;
  for (const e of events) if (e.category in counts) counts[e.category] += 1;
  return counts;
}
