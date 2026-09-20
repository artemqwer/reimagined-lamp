/**
 * The AI is offered a different tool per source. It must never be able to pick a
 * breakdown the source doesn't have, nor sort by a metric it doesn't carry — that
 * is what stopped a Shopify question falling through to Google Ads' schema.
 */

import { queryDataToolFor, sortKeysFor } from "@/lib/aiQuery";
import { aiQueryDimensionsFor, CONNECTORS, CONNECTOR_IDS } from "@/lib/connectors";

describe("queryable dimensions", () => {
  it.each(CONNECTOR_IDS)("%s: only offers dimensions it can actually resolve", (id) => {
    const resolvable = new Set(CONNECTORS[id].dimensions.map((d) => d.key));
    for (const dim of aiQueryDimensionsFor(id)) {
      if (dim === "date") continue; // always available
      expect(resolvable.has(dim)).toBe(true);
    }
  });

  it("every source can be broken down by date", () => {
    for (const id of CONNECTOR_IDS) expect(aiQueryDimensionsFor(id)).toContain("date");
  });

  it("Shopify offers products, not campaigns", () => {
    const dims = aiQueryDimensionsFor("shopify");
    expect(dims).toContain("product");
    expect(dims).not.toContain("campaign");
    expect(dims).not.toContain("keyword");
  });

  it("GA4 offers channels, not ad groups", () => {
    const dims = aiQueryDimensionsFor("ga4");
    expect(dims).toContain("channel");
    expect(dims).not.toContain("ad_group");
  });
});

describe("sort keys", () => {
  it("cost-free sources cannot sort by cost / ROAS / CPA / profit", () => {
    for (const id of CONNECTOR_IDS) {
      if (CONNECTORS[id].hasCost) continue;
      const keys = sortKeysFor(id);
      for (const banned of ["cost", "roas", "cpa", "profit"]) expect(keys).not.toContain(banned);
    }
  });

  it("ad platforms keep cost-based sorting", () => {
    expect(sortKeysFor("google_ads")).toEqual(expect.arrayContaining(["cost", "roas", "profit"]));
  });
});

describe("tool description", () => {
  it("Google Ads keeps its original tool untouched", () => {
    const t = queryDataToolFor("google_ads");
    expect(t.description).toContain("Google Ads");
    // The campaign scoping param only exists on the Google Ads tool.
    expect(t.parameters.properties).toHaveProperty("campaign");
  });

  it("tells a cost-free source that spend does not exist", () => {
    for (const id of ["ga4", "shopify"] as const) {
      const t = queryDataToolFor(id);
      expect(t.description).toContain("NO ad spend");
      expect(t.description).toContain(CONNECTORS[id].label);
    }
  });

  it("names the source, not Google Ads", () => {
    expect(queryDataToolFor("shopify").description).toContain("Shopify");
    expect(queryDataToolFor("meta_ads").description).toContain("Meta Ads");
  });
});
