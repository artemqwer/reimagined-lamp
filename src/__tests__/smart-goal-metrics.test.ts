/**
 * What a goal can be set on, per data source.
 *
 * The point of this layer is that nothing is written per source: the catalogue
 * comes from the connector registry, so a source added through the admin panel
 * carries goals without anyone editing this feature. These tests hold that
 * line — including for a source invented here that the code has never seen.
 */

import {
  goalMetricsFor,
  metricValue,
  derivedTarget,
  sourceSupportsGoals,
  NET_PROFIT,
} from "@/lib/smartGoalMetrics";
import {
  BUILT_IN_CONNECTORS,
  setCustomConnectors,
  applyAdminCustomFields,
  type CustomConnectorRow,
} from "@/lib/connectors";

afterEach(() => {
  setCustomConnectors([]);
  applyAdminCustomFields({});
});

describe("the catalogue comes from the source", () => {
  it("gives Google Ads its cost-aware metrics", () => {
    const keys = goalMetricsFor("google_ads").map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(["revenue", "cost", "roasVal", "profit", "conv"]));
  });

  it("gives a source with no ad spend no cost-derived goals", () => {
    // GA4 has no spend, so ROAS, CPC and profit would all read zero — the
    // registry drops them and so does the goal catalogue.
    const keys = goalMetricsFor("ga4").map((m) => m.key);
    expect(keys).toContain("revenue");
    expect(keys).not.toContain("cost");
    expect(keys).not.toContain("roasVal");
    expect(keys).not.toContain("cpc");
  });

  it("offers Net Profit only where both revenue and spend exist", () => {
    expect(goalMetricsFor("google_ads").map((m) => m.key)).toContain(NET_PROFIT.key);
    expect(goalMetricsFor("ga4").map((m) => m.key)).not.toContain(NET_PROFIT.key);
  });

  it("marks a goal derivable only when the source has everything it needs", () => {
    const ads = goalMetricsFor("google_ads");
    expect(ads.find((m) => m.key === "roasVal")?.derivedFrom).toEqual(["revenue", "cost"]);
    // Nothing to derive from without spend.
    expect(goalMetricsFor("ga4").find((m) => m.key === "roasVal")).toBeUndefined();
  });

  it("follows the admin's order and visibility", () => {
    const cfg = [
      { key: "revenue", visible: true, order: 0 },
      { key: "clicks", visible: false, order: 1 },
    ];
    const keys = goalMetricsFor("google_ads", cfg).map((m) => m.key);
    expect(keys[0]).toBe("revenue");
    expect(keys).not.toContain("clicks");
  });

  it("says a source can carry goals", () => {
    for (const id of Object.keys(BUILT_IN_CONNECTORS)) expect(sourceSupportsGoals(id)).toBe(true);
  });
});

describe("a source the code has never seen", () => {
  // The whole reason the catalogue is derived: this connector is invented here,
  // with a metric nobody anticipated, and goals work on it unchanged.
  const invented: CustomConnectorRow = {
    id: "invented_src",
    label: "Invented",
    color: "#000",
    windsor_source: "invented",
    metric_schema: "ads",
    primary_dimension: { key: "thing", label: "Things", singular: "Thing", windsorField: "thing" },
    dimensions: [],
    ai_dimensions: [],
    custom_metrics: [
      { key: "signups", label: "Signups", format: "number", windsorField: "signups" },
      { key: "bounce", label: "Bounce rate", format: "percent", windsorField: "bounce" },
    ],
  };

  beforeEach(() => setCustomConnectors([invented]));

  it("can carry goals on the metrics its admin registered", () => {
    const keys = goalMetricsFor("invented_src").map((m) => m.key);
    expect(keys).toContain("signups");
    expect(keys).toContain("bounce");
  });

  it("treats a rate as an average and a count as cumulative", () => {
    // Which decides whether the goal gets a pace line at all.
    const defs = goalMetricsFor("invented_src");
    expect(defs.find((m) => m.key === "bounce")?.accumulation).toBe("average");
    expect(defs.find((m) => m.key === "signups")?.accumulation).toBe("cumulative");
  });

  it("reads its value from the row's own bag", () => {
    const totals = {
      clicks: 0,
      impressions: 0,
      cost: 0,
      conversions: 0,
      revenue: 0,
      extra: { signups: 42 },
    };
    expect(metricValue("signups", totals, 40)).toBe(42);
    // A metric with no data yet is zero rather than a crash.
    expect(metricValue("nothing_here", totals, 40)).toBe(0);
  });
});

describe("metric values are the dashboard's own formulas", () => {
  const totals = {
    clicks: 100,
    impressions: 5_000,
    cost: 250,
    conversions: 20,
    revenue: 1_000,
    extra: {},
  };

  it.each([
    ["revenue", 1_000],
    ["cost", 250],
    ["clicks", 100],
    ["impr", 5_000],
    ["conv", 20],
    ["profit", 750],
    ["roasVal", 4],
    ["ctr", 2],
    ["convRate", 20],
    ["cpc", 2.5],
    ["cpa", 12.5],
  ])("%s reads %p", (key, expected) => {
    expect(metricValue(key as string, totals, 40)).toBeCloseTo(expected as number);
  });

  it("takes the margin into account for net profit", () => {
    expect(metricValue("net_profit", totals, 40)).toBe(1_000 * 0.4 - 250);
  });

  it("divides by zero nowhere", () => {
    const empty = { clicks: 0, impressions: 0, cost: 0, conversions: 0, revenue: 0, extra: {} };
    for (const key of ["roasVal", "ctr", "convRate", "cpc", "cpa"])
      expect(metricValue(key, empty, 40)).toBe(0);
  });
});

describe("directions", () => {
  it("knows spending less is better and earning more is better", () => {
    const ads = goalMetricsFor("google_ads");
    const dir = (k: string) => ads.find((m) => m.key === k)?.direction;
    expect(dir("cost")).toBe("lower");
    expect(dir("cpc")).toBe("lower");
    expect(dir("cpa")).toBe("lower");
    expect(dir("revenue")).toBe("higher");
    expect(dir("roasVal")).toBe("higher");
  });
});

describe("derived targets", () => {
  it("computes from the source's own revenue and cost goals", () => {
    const inputs = { revenue: 10_000, cost: 2_000, marginPct: 40 };
    expect(derivedTarget("roasVal", inputs)).toBe(5);
    expect(derivedTarget("profit", inputs)).toBe(8_000);
    expect(derivedTarget("net_profit", inputs)).toBe(2_000);
  });

  it("declines rather than inventing one", () => {
    expect(derivedTarget("roasVal", { revenue: null, cost: 2_000, marginPct: 40 })).toBeNull();
    expect(derivedTarget("roasVal", { revenue: 10_000, cost: 0, marginPct: 40 })).toBeNull();
    expect(derivedTarget("clicks", { revenue: 10_000, cost: 2_000, marginPct: 40 })).toBeNull();
  });
});
