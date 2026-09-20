import type { WindsorRow } from "@/app/api/windsor/route";

// Demo dataset for the dashboard, served by /api/windsor when the `mf_demo`
// cookie is set (toggled from the admin "Mock data" switch). Lets the whole
// dashboard — KPIs, time series, breakdown tables — render populated for a
// presentation while real Windsor/GA4 data is still aggregating. Values are
// deterministic per (segment, day) so charts stay stable across refetches.

const DIM_VALUES: Record<string, string[]> = {
  channel: ["Organic Search", "Paid Search", "Direct", "Social", "Email", "Referral", "Display"],
  campaign: ["Brand Search", "Prospecting", "Retargeting", "Shopping", "Video", "Discovery"],
  campaign_type: ["Search", "Display", "Shopping", "Video", "Performance Max"],
  device: ["Desktop", "Mobile", "Tablet"],
  country: ["Ukraine", "United States", "Germany", "Poland", "United Kingdom", "Canada"],
  source: ["google", "(direct)", "facebook", "newsletter", "bing", "instagram"],
  ad_group: ["Core Terms", "Competitor", "Long-tail", "Retargeting", "Lookalike"],
  keyword: ["running shoes", "trail shoes", "marathon gear", "sneakers sale", "sport socks"],
  match_type: ["Exact", "Phrase", "Broad"],
  network: ["Search", "Search Partners", "Display", "YouTube"],
  search_term: ["best running shoes", "cheap sneakers", "trail shoes review", "marathon kit"],
};
const GENERIC = ["Segment A", "Segment B", "Segment C", "Segment D", "Segment E"];

// Stable 0..1 hash so the same segment/day always yields the same numbers.
function h(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return (x >>> 0) / 4294967295;
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  for (let i = 0; d <= end && i < 400; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function mockWindsorRows(groupBy: string, from: string, to: string): WindsorRow[] {
  const parts = String(groupBy)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const hasDate = parts.includes("date");
  const dimKey = parts.find((p) => p !== "date");
  const values: (string | null)[] = dimKey ? (DIM_VALUES[dimKey] ?? GENERIC) : [null];
  const dates: (string | null)[] = hasDate ? eachDay(from, to) : [null];

  const rows: WindsorRow[] = [];
  values.forEach((val, vi) => {
    const weight = 1 - vi * (0.55 / Math.max(1, values.length)); // top segments get more
    dates.forEach((day) => {
      const seed = `${val ?? "all"}|${day ?? "total"}`;
      const r = h(seed);
      const r2 = h(seed + "~");
      const impressions = Math.round((4000 + r * 14000) * weight);
      const clicks = Math.round(impressions * (0.02 + r2 * 0.05));
      const spend = Math.round(clicks * (0.4 + r * 1.6) * 100) / 100;
      const conversions = Math.round(clicks * (0.03 + r2 * 0.06));
      const conversion_value = Math.round(conversions * (25 + r * 90) * 100) / 100;
      const dim = (val ?? day ?? "Total") as string;
      rows.push({
        date: day,
        campaign: parts.includes("campaign") ? (val ?? "All campaigns") : null,
        pivot: dim,
        campaign_type: dimKey === "campaign_type" ? val : null,
        campaign_status: null,
        ad_group: dimKey === "ad_group" ? val : null,
        keyword_text: dimKey === "keyword" ? val : null,
        match_type: dimKey === "match_type" ? val : null,
        dimension: dim,
        clicks,
        impressions,
        spend,
        conversions,
        conversion_value,
      });
    });
  });
  return rows;
}
