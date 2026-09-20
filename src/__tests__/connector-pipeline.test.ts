/**
 * Data-extraction pipeline, connector by connector.
 *
 * The dashboard asks for `<dim>` / `date,<dim>`; the manifest turns that into the
 * Windsor `fields` string, and the response's native column is read back as the
 * row's dimension. A hole anywhere here silently collapses a whole source into
 * "Unknown" rows, so every connector × every dimension is checked.
 */

import {
  CONNECTORS,
  CONNECTOR_IDS,
  KPI_SLOTS,
  getConnector,
  getDimensionDef,
  windsorFieldsFor,
  readDimensionValue,
} from "@/lib/connectors";

const NON_GOOGLE = CONNECTOR_IDS.filter((id) => id !== "google_ads");

describe("manifest integrity", () => {
  it.each(CONNECTOR_IDS)("%s: primary dimension is a real dimension", (id) => {
    const c = CONNECTORS[id];
    const def = getDimensionDef(id, c.primaryDimension);
    expect(def).not.toBeNull();
  });

  it.each(CONNECTOR_IDS)("%s: declares metrics, tabs and a label", (id) => {
    const c = CONNECTORS[id];
    expect(c.metrics.length).toBeGreaterThan(0);
    expect(c.tabs.length).toBeGreaterThan(0);
    expect(c.primaryLabel).toBeTruthy();
  });

  it("only cost-bearing connectors expose the P&L tab", () => {
    for (const id of CONNECTOR_IDS) {
      const c = CONNECTORS[id];
      if (!c.hasCost) expect(c.tabs).not.toContain("pl");
    }
  });

  it("every dimension key is unique within its connector", () => {
    for (const id of CONNECTOR_IDS) {
      const keys = CONNECTORS[id].dimensions.map((d) => d.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("group_by → Windsor fields", () => {
  it.each(NON_GOOGLE)("%s: every dimension resolves fields (plain + date)", (id) => {
    for (const d of CONNECTORS[id].dimensions) {
      const plain = windsorFieldsFor(id, d.key);
      const dated = windsorFieldsFor(id, `date,${d.key}`);

      expect(plain).toBeTruthy();
      expect(dated).toBeTruthy();
      // The dated variant must actually request the date column, otherwise the
      // Trends chart has nothing to bucket by.
      expect(dated!.split(",")).toContain("date");
      // Both must carry the source column the value is read back from.
      expect(plain!.split(",")).toEqual(expect.arrayContaining([d.valueKeys[0]]));
    }
  });

  it("unknown connector/dimension yields null so the caller keeps its default", () => {
    expect(windsorFieldsFor("shopify", "not_a_dimension")).toBeNull();
    expect(windsorFieldsFor("nope", "product")).toBeNull();
  });

  it("Meta requests its own purchase fields, never Google Ads' conversion names", () => {
    // Meta has no `conversions` / `conversion_value` fields — every table 400'd
    // ("some of the fields you have selected are not valid"). No Meta table may
    // ever ask for those Google names.
    for (const d of CONNECTORS.meta_ads.dimensions) {
      const cols = windsorFieldsFor("meta_ads", d.key)!.split(",");
      expect(cols).not.toContain("conversions");
      expect(cols).not.toContain("conversion_value");
    }
    // Entity breakdowns carry the omni purchase count + value…
    for (const key of ["campaign", "adset", "ad"]) {
      const cols = windsorFieldsFor("meta_ads", key)!.split(",");
      expect(cols).toContain("actions_omni_purchase");
      expect(cols).toContain("action_values_omni_purchase");
    }
    // …but delivery breakdowns must NOT use omni (Facebook 400s: "incompatible
    // with 'omni' and 'ranking' fields"). They use the plain pixel-purchase
    // action instead, which survives a delivery breakdown and still carries
    // conversions + value.
    for (const key of ["placement", "platform", "country", "device"]) {
      const cols = windsorFieldsFor("meta_ads", key)!.split(",");
      expect(cols).not.toContain("actions_omni_purchase");
      expect(cols).not.toContain("action_values_omni_purchase");
      expect(cols).toContain("actions_offsite_conversion_fb_pixel_purchase");
      expect(cols).toContain("action_values_offsite_conversion_fb_pixel_purchase");
    }
    // The placement breakdown uses `platform_position`, not the invalid `placement`.
    expect(windsorFieldsFor("meta_ads", "placement")!.split(",")).toContain("platform_position");
  });
});

describe("response → dimension value", () => {
  it.each(NON_GOOGLE)("%s: reads each dimension from its native column", (id) => {
    for (const d of CONNECTORS[id].dimensions) {
      // Windsor answers with the connector's own column name.
      const row = { [d.valueKeys[0]]: "Row Value" };
      expect(readDimensionValue(id, d.key, row)).toBe("Row Value");
      expect(readDimensionValue(id, `date,${d.key}`, row)).toBe("Row Value");
    }
  });

  it("falls back through alternate column names", () => {
    // Shopify products come back as product_title, but `product` is accepted too.
    expect(readDimensionValue("shopify", "product", { product: "Mug" })).toBe("Mug");
    expect(readDimensionValue("ga4", "channel", { channel: "Direct" })).toBe("Direct");
  });

  it("never returns an empty label", () => {
    expect(readDimensionValue("shopify", "product", { product_title: "" })).toBe("Unknown");
    expect(readDimensionValue("shopify", "product", {})).toBe("Unknown");
  });
});

describe("KPI cards per connector", () => {
  const COST_SLOTS = ["cost", "cpa", "roas", "profit"];

  it("Google Ads keeps its original eight cards, in order", () => {
    expect(CONNECTORS.google_ads.kpiCards.map((c) => c.slot)).toEqual([
      "clicks",
      "convRate",
      "conversions",
      "cpa",
      "cost",
      "revenue",
      "roas",
      "profit",
    ]);
    // No relabelling — the Google Ads dashboard must look exactly as before.
    expect(CONNECTORS.google_ads.kpiCards.every((c) => !c.label)).toBe(true);
  });

  it("cost-free sources show no ad-spend cards", () => {
    for (const id of CONNECTOR_IDS) {
      const c = CONNECTORS[id];
      if (c.hasCost) continue;
      const slots = c.kpiCards.map((k) => k.slot);
      for (const cost of COST_SLOTS) expect(slots).not.toContain(cost);
    }
  });

  it("Shopify leads with Orders / Total Sales / AOV", () => {
    const cards = CONNECTORS.shopify.kpiCards;
    // AOV needs no rename — it carries the canonical card's own label.
    expect(cards.map((c) => c.slot)).toEqual(["conversions", "revenue", "aov", "clicks"]);
    expect(cards.find((c) => c.slot === "conversions")?.label).toBe("Orders");
    expect(cards.find((c) => c.slot === "revenue")?.label).toBe("Total Sales");
  });

  it("GA4 renames the traffic card to Sessions", () => {
    const traffic = CONNECTORS.ga4.kpiCards.find((c) => c.slot === "clicks");
    expect(traffic?.label).toBe("Sessions");
  });

  it.each(CONNECTOR_IDS)("%s: every card names a known slot", (id) => {
    for (const card of CONNECTORS[id].kpiCards) {
      expect(KPI_SLOTS).toContain(card.slot);
    }
  });
});

describe("tabs per connector", () => {
  it("Google Ads keeps all four ad tabs", () => {
    expect(CONNECTORS.google_ads.tabs).toEqual(["trends", "performance", "pl", "distribution"]);
  });

  it("cost-free sources hide Performance and P&L", () => {
    for (const id of CONNECTOR_IDS) {
      const c = CONNECTORS[id];
      if (c.hasCost) continue;
      expect(c.tabs).not.toContain("performance");
      expect(c.tabs).not.toContain("pl");
    }
  });

  it("Shopify swaps the ad tabs for Sales", () => {
    expect(CONNECTORS.shopify.tabs).toEqual(["trends", "sales", "distribution"]);
  });

  it("only Shopify has a Sales tab", () => {
    for (const id of CONNECTOR_IDS) {
      if (id === "shopify") continue;
      expect(CONNECTORS[id].tabs).not.toContain("sales");
    }
  });

  it("every connector keeps Trends as its first tab", () => {
    for (const id of CONNECTOR_IDS) expect(CONNECTORS[id].tabs[0]).toBe("trends");
  });
});

describe("connector lookup", () => {
  it("falls back to Google Ads for an unknown id", () => {
    expect(getConnector("garbage").id).toBe("google_ads");
    expect(getConnector(null).id).toBe("google_ads");
  });
});

describe("cross-filter pivot field (withCrossFilterPivot)", () => {
  // Applied centrally, so this must hold for EVERY connector — including any
  // added later, in code or from the Admin Panel. That universality is the
  // point: a new source is cross-filterable with no per-source wiring.
  it.each(CONNECTOR_IDS)(
    "%s: every non-primary dimension's fetch carries the primary's own field",
    (id) => {
      const c = CONNECTORS[id];
      const primaryField = c.dimensions
        .find((d) => d.key === c.primaryDimension)!
        .windsorFields.split(",")[0];
      for (const d of c.dimensions) {
        if (d.key === c.primaryDimension) continue;
        expect(d.windsorFields.split(",")).toContain(primaryField);
        expect(d.windsorDateFields.split(",")).toContain(primaryField);
      }
    },
  );

  it.each(CONNECTOR_IDS)("%s: the pivot field is never duplicated", (id) => {
    const c = CONNECTORS[id];
    const primaryField = c.dimensions
      .find((d) => d.key === c.primaryDimension)!
      .windsorFields.split(",")[0];
    for (const d of c.dimensions) {
      expect(d.windsorFields.split(",").filter((f) => f === primaryField).length).toBe(1);
      expect(d.windsorDateFields.split(",").filter((f) => f === primaryField).length).toBe(1);
    }
  });

  it("windsorFieldsFor reflects the folded-in pivot field for a secondary dimension", () => {
    expect(windsorFieldsFor("ga4", "device")).toContain("default_channel_group");
    expect(windsorFieldsFor("ga4", "date,device")).toContain("default_channel_group");
    expect(windsorFieldsFor("shopify", "country")).toContain("line_item__title");
  });
});
