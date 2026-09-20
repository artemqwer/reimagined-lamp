// The 6 timeline categories from the spec.
//  Automatic: holidays (system calendar), ads (Google Ads Change History).
//  Manual:    promotions, website, products, custom.
export type EventType = "holidays" | "promotions" | "website" | "products" | "ads" | "custom";

export type EventSource = "Manual" | "Google Ads" | "Holidays" | "System";

export interface CustomEvent {
  id: string;
  // Stored category. Legacy rows may carry old values ("Events"/"Ads"/"Website")
  // — normalizeType() in Timeline maps those onto EventType.
  category: EventType | string;
  // Repurposed to hold "Created By" (author name) for manual events.
  type: string | null;
  startDate: string;
  endDate: string;
  title: string;
  desc: string;
}

// Unified marker rendered on the timeline lane.
export interface TimelineMarker {
  id: string;
  type: EventType;
  title: string;
  startDate: string;
  endDate?: string;
  desc?: string;
  source: EventSource;
  createdBy: string;
  ongoing: boolean; // has a start but no end → still active
  deletable: boolean; // only manual, stored events
  anomaly?: boolean; // a KPI anomaly the detector found → warning icon, not a category mark
}
