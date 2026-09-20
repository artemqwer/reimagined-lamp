/**
 * Admin-added data sources (Admin Panel → "+ New data source") and the
 * KPI-card Value Format override — the two additions layered on top of the
 * built-in connector manifests to satisfy the Data Sources spec without a
 * code deploy.
 */

import {
  CONNECTORS,
  CONNECTOR_IDS,
  BUILT_IN_CONNECTORS,
  buildCustomManifest,
  setCustomConnectors,
  getCustomConnectorIds,
  isConnectorId,
  getConnector,
  getDimensionDef,
  windsorFieldsFor,
  applyKpiConfig,
  onConnectorRegistryChange,
  applyAdminCustomFields,
  aiQueryDimensionsFor,
  connectorMetricCols,
  connectorKpiOptions,
  isAveragedMetric,
  connectorTableList,
  chartDimensionList,
  chartMetricList,
  crossFilterDimensionsFor,
  windsorAccountIdFor,
  safeDimensionKey,
  normalizeAccountId,
  connectorSlug,
  connectorFromSlug,
  type CustomConnectorRow,
} from "@/lib/connectors";
import { dashboardFilterKeysFor, normalizeFilterAction } from "@/lib/aiQuery";

const adsRow: CustomConnectorRow = {
  id: "tiktok_ads",
  label: "TikTok Ads",
  color: "#FF0050",
  windsor_source: "tiktok",
  metric_schema: "ads",
  primary_dimension: {
    key: "campaign",
    label: "Campaign Performance",
    singular: "Campaign",
    windsorField: "campaign",
  },
  dimensions: [
    {
      key: "adgroup",
      label: "Ad Group Performance",
      singular: "Ad Group",
      windsorField: "adgroup_name",
    },
  ],
  ai_dimensions: [],
};

afterEach(() => {
  // These tests mutate the module-level registry — reset it so other tests in
  // this file (and any file sharing the module instance) see only the built-ins.
  setCustomConnectors([]);
  applyAdminCustomFields({});
});

describe("buildCustomManifest", () => {
  it("builds a full manifest from an 'ads' schema row", () => {
    const m = buildCustomManifest(adsRow);
    expect(m.id).toBe("tiktok_ads");
    expect(m.windsorSource).toBe("tiktok");
    expect(m.hasCost).toBe(true);
    expect(m.primaryDimension).toBe("campaign");
    expect(m.dimensions.map((d) => d.key)).toEqual(["campaign", "adgroup"]);
    expect(m.metrics.length).toBeGreaterThan(0);
    expect(m.tabs).toContain("performance");
  });

  it("'analytics' and 'commerce' schemas produce cost-free manifests", () => {
    const analytics = buildCustomManifest({ ...adsRow, id: "x1", metric_schema: "analytics" });
    const commerce = buildCustomManifest({ ...adsRow, id: "x2", metric_schema: "commerce" });
    expect(analytics.hasCost).toBe(false);
    expect(commerce.hasCost).toBe(false);
    expect(analytics.tabs).not.toContain("performance");
    expect(commerce.tabs).toContain("sales");
  });

  it("defaults aiDimensions to every declared dimension when none are given", () => {
    const m = buildCustomManifest(adsRow);
    expect(m.aiDimensions).toEqual(["campaign", "adgroup"]);
  });

  it("throws on an unknown metric schema", () => {
    // @ts-expect-error deliberately invalid input — the admin API validates
    // this before a row ever reaches buildCustomManifest.
    expect(() => buildCustomManifest({ ...adsRow, metric_schema: "nonsense" })).toThrow();
  });
});

describe("setCustomConnectors", () => {
  it("merges a custom row into CONNECTORS / CONNECTOR_IDS / isConnectorId", () => {
    expect(isConnectorId("tiktok_ads")).toBe(false);
    setCustomConnectors([adsRow]);
    expect(isConnectorId("tiktok_ads")).toBe(true);
    expect(CONNECTOR_IDS).toContain("tiktok_ads");
    expect(CONNECTORS.tiktok_ads.label).toBe("TikTok Ads");
    expect(getConnector("tiktok_ads").windsorSource).toBe("tiktok");
    expect(getCustomConnectorIds()).toEqual(["tiktok_ads"]);
  });

  it("never lets a custom row shadow a built-in id", () => {
    setCustomConnectors([{ ...adsRow, id: "google_ads", label: "Fake Google Ads" }]);
    expect(CONNECTORS.google_ads.label).toBe(BUILT_IN_CONNECTORS.google_ads.label);
    expect(getCustomConnectorIds()).toEqual([]);
  });

  it("skips a malformed row instead of crashing the whole registry", () => {
    // @ts-expect-error deliberately invalid schema
    setCustomConnectors([adsRow, { ...adsRow, id: "broken", metric_schema: "nonsense" }]);
    expect(CONNECTOR_IDS).toContain("tiktok_ads");
    expect(CONNECTOR_IDS).not.toContain("broken");
  });

  it("removing a connector falls back gracefully via getConnector", () => {
    setCustomConnectors([adsRow]);
    expect(getConnector("tiktok_ads").id).toBe("tiktok_ads");
    setCustomConnectors([]);
    expect(getConnector("tiktok_ads").id).toBe("google_ads"); // DEFAULT_CONNECTOR fallback
    expect(CONNECTOR_IDS).not.toContain("tiktok_ads");
  });

  it("built-in connectors are unaffected by adding/removing custom ones", () => {
    const before = CONNECTOR_IDS.filter((id) => id in BUILT_IN_CONNECTORS);
    setCustomConnectors([adsRow]);
    setCustomConnectors([]);
    const after = CONNECTOR_IDS.filter((id) => id in BUILT_IN_CONNECTORS);
    expect(after).toEqual(before);
    expect(CONNECTORS.google_ads).toBe(BUILT_IN_CONNECTORS.google_ads);
  });
});

describe("custom metrics (raw Windsor fields, no canonical formula)", () => {
  const rowWithMetrics: CustomConnectorRow = {
    ...adsRow,
    id: "ga4_custom",
    custom_metrics: [
      { key: "bounce_rate", label: "Bounce Rate", windsorField: "bounceRate", format: "percent" },
      {
        key: "engagement_rate",
        label: "Engagement Rate",
        windsorField: "engagementRate",
        format: "percent",
      },
    ],
  };

  it("appends custom metrics to the manifest's metrics list", () => {
    const m = buildCustomManifest(rowWithMetrics);
    const bounce = m.metrics.find((x) => x.key === "bounce_rate");
    expect(bounce).toBeDefined();
    expect(bounce?.label).toBe("Bounce Rate");
    expect(bounce?.format).toBe("percent");
  });

  it("tracks the raw Windsor field name per custom metric key", () => {
    const m = buildCustomManifest(rowWithMetrics);
    expect(m.customMetricFields).toEqual({
      bounce_rate: "bounceRate",
      engagement_rate: "engagementRate",
    });
  });

  it("folds custom metric fields into windsorMetrics so they're actually requested", () => {
    const m = buildCustomManifest(rowWithMetrics);
    expect(m.windsorMetrics).toContain("bounceRate");
    expect(m.windsorMetrics).toContain("engagementRate");
  });

  it("built-in connectors have no customMetricFields", () => {
    expect(BUILT_IN_CONNECTORS.google_ads.customMetricFields).toBeUndefined();
  });

  it("a connector with no custom_metrics keeps the plain schema windsorMetrics", () => {
    const m = buildCustomManifest(adsRow);
    expect(m.customMetricFields).toBeUndefined();
  });

  it("amazon_ads source overrides the generic ADS metric names Windsor rejects", () => {
    // Windsor's amazon_ads connector 400s on clicks/impressions/spend — its
    // fields are report-namespaced. The override must swap them so the fetch
    // asks for fields that exist. (Root cause of Amazon "No data available".)
    const m = buildCustomManifest({ ...adsRow, id: "amz", windsor_source: "amazon_ads" });
    expect(m.windsorMetrics).toContain("sponsored_products_campaign__clicks");
    expect(m.windsorMetrics).not.toContain("clicks,impressions,spend");
  });

  it("amazon_sp (Seller Central) overrides metrics with the Sales & Traffic report fields", () => {
    const m = buildCustomManifest({ ...adsRow, id: "amzsp", windsor_source: "amazon_sp" });
    expect(m.windsorMetrics).toContain(
      "sales_and_traffic_report_by_date__salesbyasin_unitsordered",
    );
    expect(m.windsorMetrics).not.toContain("clicks,impressions,spend");
  });

  it("amazon_ads derives each dimension's metrics from its OWN report (no cross-report 400)", () => {
    const amz: CustomConnectorRow = {
      ...adsRow,
      id: "amz_ads",
      windsor_source: "amazon_ads",
      primary_dimension: {
        key: "campaign",
        label: "Campaigns",
        singular: "Campaign",
        windsorField: "sponsored_products_campaign__campaign",
      },
      dimensions: [
        {
          key: "targeting",
          label: "Targeting",
          singular: "Target",
          windsorField: "sponsored_products_targeting__targeting",
        },
      ],
    };
    setCustomConnectors([amz]);
    const camp = windsorFieldsFor("amz_ads", "campaign") ?? "";
    expect(camp).toContain("sponsored_products_campaign__clicks");
    // campaign report HAS conversions/sales
    expect(camp).toContain("sponsored_products_campaign__attributedsales14d");

    const tgt = windsorFieldsFor("amz_ads", "targeting") ?? "";
    expect(tgt).toContain("sponsored_products_targeting__clicks");
    // must NOT mix in the campaign report's fields (that's the 400)
    expect(tgt).not.toContain("sponsored_products_campaign");
    // targeting report has no conversion/sales columns → not requested
    expect(tgt).not.toContain("attributedsales14d");
  });

  it("windsorFieldsFor a dimension still includes the custom metric fields", () => {
    setCustomConnectors([rowWithMetrics]);
    const fields = windsorFieldsFor("ga4_custom", "campaign");
    expect(fields).toContain("bounceRate");
    const def = getDimensionDef("ga4_custom", "campaign");
    expect(def).not.toBeNull();
  });

  it("connectorMetricCols() includes the connector's own custom metrics", () => {
    setCustomConnectors([rowWithMetrics]);
    const cols = connectorMetricCols("ga4_custom");
    const bounce = cols.find((c) => c.key === "bounce_rate");
    expect(bounce).toBeDefined();
    expect(bounce?.format).toBe("percent");
  });
});

describe("custom metrics on BUILT-IN connectors (via connector_config)", () => {
  it("adds a custom metric to a built-in connector's manifest", () => {
    applyAdminCustomFields({
      ga4: {
        customMetrics: [
          {
            key: "bounce_rate",
            label: "Bounce Rate",
            windsorField: "bounceRate",
            format: "percent",
          },
        ],
      },
    });
    const m = getConnector("ga4");
    expect(m.metrics.find((x) => x.key === "bounce_rate")?.label).toBe("Bounce Rate");
    expect(m.customMetricFields).toEqual({ bounce_rate: "bounceRate" });
    expect(m.windsorMetrics).toContain("bounceRate");
  });

  it("folds the custom field into every dimension's windsorFields so it's actually fetched", () => {
    applyAdminCustomFields({
      ga4: {
        customMetrics: [
          {
            key: "bounce_rate",
            label: "Bounce Rate",
            windsorField: "bounceRate",
            format: "percent",
          },
        ],
      },
    });
    const fields = windsorFieldsFor("ga4", "channel");
    expect(fields).toContain("bounceRate");
  });

  it("leaves connectors with no configured custom metrics untouched", () => {
    applyAdminCustomFields({ ga4: { customMetrics: [] } });
    expect(getConnector("google_ads")).toBe(BUILT_IN_CONNECTORS.google_ads);
  });

  it("re-applying with an empty config resets a connector back to its built-in shape", () => {
    applyAdminCustomFields({
      ga4: {
        customMetrics: [
          {
            key: "bounce_rate",
            label: "Bounce Rate",
            windsorField: "bounceRate",
            format: "percent",
          },
        ],
      },
    });
    expect(getConnector("ga4").metrics.some((m) => m.key === "bounce_rate")).toBe(true);
    applyAdminCustomFields({});
    expect(getConnector("ga4").metrics.some((m) => m.key === "bounce_rate")).toBe(false);
    expect(getConnector("ga4").customMetricFields).toBeUndefined();
  });

  it("coexists with admin-added custom connectors in the same registry", () => {
    applyAdminCustomFields({
      ga4: {
        customMetrics: [
          {
            key: "bounce_rate",
            label: "Bounce Rate",
            windsorField: "bounceRate",
            format: "percent",
          },
        ],
      },
    });
    setCustomConnectors([adsRow]);
    expect(CONNECTOR_IDS).toContain("tiktok_ads");
    expect(getConnector("ga4").customMetricFields).toEqual({ bounce_rate: "bounceRate" });
    expect(CONNECTORS.google_ads).toBe(BUILT_IN_CONNECTORS.google_ads);
  });
});

describe("custom dimensions on BUILT-IN connectors (via connector_config)", () => {
  it("appends a custom dimension to a built-in connector's manifest", () => {
    applyAdminCustomFields({
      ga4: {
        customDimensions: [
          {
            key: "browser",
            label: "Browser Performance",
            singular: "Browser",
            windsorField: "browser",
          },
        ],
      },
    });
    const m = getConnector("ga4");
    expect(m.dimensions.some((d) => d.key === "browser")).toBe(true);
    const def = getDimensionDef("ga4", "browser");
    expect(def?.singular).toBe("Browser");
  });

  it("folds the connector's windsorMetrics (incl. any custom metric fields) into the new dimension", () => {
    applyAdminCustomFields({
      ga4: {
        customMetrics: [
          {
            key: "bounce_rate",
            label: "Bounce Rate",
            windsorField: "bounceRate",
            format: "percent",
          },
        ],
        customDimensions: [
          {
            key: "browser",
            label: "Browser Performance",
            singular: "Browser",
            windsorField: "browser",
          },
        ],
      },
    });
    const fields = windsorFieldsFor("ga4", "browser");
    expect(fields).toContain("bounceRate");
    expect(fields).toContain("browser");
  });

  it("leaves connectors with no configured custom dimensions untouched", () => {
    applyAdminCustomFields({ ga4: { customDimensions: [] } });
    expect(getConnector("google_ads")).toBe(BUILT_IN_CONNECTORS.google_ads);
  });

  it("re-applying with an empty config resets a connector back to its built-in shape", () => {
    applyAdminCustomFields({
      ga4: {
        customDimensions: [
          {
            key: "browser",
            label: "Browser Performance",
            singular: "Browser",
            windsorField: "browser",
          },
        ],
      },
    });
    expect(getConnector("ga4").dimensions.some((d) => d.key === "browser")).toBe(true);
    applyAdminCustomFields({});
    expect(getConnector("ga4").dimensions.some((d) => d.key === "browser")).toBe(false);
  });

  it("a new custom dimension shows up via connectorTableList (the admin Tables config + Table Widgets picker)", () => {
    applyAdminCustomFields({
      ga4: {
        customDimensions: [
          {
            key: "browser",
            label: "Browser Performance",
            singular: "Browser",
            windsorField: "browser",
          },
        ],
      },
    });
    expect(connectorTableList("ga4").some((t) => t.key === "browser")).toBe(true);
  });

  it("an admin-added dimension also gets the cross-filter pivot field, with no per-source wiring", () => {
    applyAdminCustomFields({
      ga4: {
        customDimensions: [
          {
            key: "browser",
            label: "Browser Performance",
            singular: "Browser",
            windsorField: "browser",
          },
        ],
      },
    });
    const fields = windsorFieldsFor("ga4", "browser");
    expect(fields).toContain("default_channel_group");
    expect(windsorFieldsFor("ga4", "date,browser")).toContain("default_channel_group");
  });
});

describe("cross-filter pivot is universal — a NEW source needs no code", () => {
  it("an admin-added data source gets the pivot field on every non-primary dimension", () => {
    // The whole point: this row was typed into the Admin Panel, not shipped
    // in code, and is cross-filterable anyway.
    const m = buildCustomManifest(adsRow);
    const pivotField = m.dimensions
      .find((d) => d.key === m.primaryDimension)!
      .windsorFields.split(",")[0];
    expect(pivotField).toBe("campaign");
    for (const d of m.dimensions) {
      if (d.key === m.primaryDimension) continue;
      expect(d.windsorFields.split(",")).toContain(pivotField);
      expect(d.windsorDateFields.split(",")).toContain(pivotField);
    }
  });

  it("resolves through the live registry too (windsorFieldsFor on a custom source)", () => {
    setCustomConnectors([adsRow]);
    expect(windsorFieldsFor("tiktok_ads", "adgroup")).toContain("campaign");
    expect(windsorFieldsFor("tiktok_ads", "date,adgroup")).toContain("campaign");
  });

  it("a custom source with custom metrics keeps both the metric fields and the pivot", () => {
    const m = buildCustomManifest({
      ...adsRow,
      id: "with_metrics",
      custom_metrics: [
        { key: "bounce_rate", label: "Bounce Rate", windsorField: "bounceRate", format: "percent" },
      ],
    });
    const adgroup = m.dimensions.find((d) => d.key === "adgroup")!;
    expect(adgroup.windsorFields).toContain("bounceRate");
    expect(adgroup.windsorFields).toContain("campaign");
  });

  it("a single-dimension custom source is a no-op (nothing to join to)", () => {
    const m = buildCustomManifest({ ...adsRow, id: "solo", dimensions: [] });
    expect(m.dimensions).toHaveLength(1);
    expect(m.dimensions[0].key).toBe("campaign");
  });
});

describe("connectorTableList with an effective primary key override (hero-table swap)", () => {
  it("google_ads: with no override, behaves exactly as before (campaign excluded, never listed)", () => {
    const list = connectorTableList("google_ads");
    expect(list.some((t) => t.key === "campaign")).toBe(false);
    expect(list.some((t) => t.key === "device")).toBe(true);
  });

  it("google_ads: swapping to a different dimension excludes IT instead, and re-includes campaign", () => {
    const list = connectorTableList("google_ads", "device");
    expect(list.some((t) => t.key === "device")).toBe(false);
    expect(list.some((t) => t.key === "campaign")).toBe(true);
  });

  it("non-google_ads connectors: with no override, behaves exactly as before", () => {
    const list = connectorTableList("ga4");
    expect(list.some((t) => t.key === "channel")).toBe(false);
    expect(list.some((t) => t.key === "source_medium")).toBe(true);
  });

  it("non-google_ads connectors: swapping to a different dimension excludes IT instead, and re-includes the manifest's primary", () => {
    const list = connectorTableList("ga4", "source_medium");
    expect(list.some((t) => t.key === "source_medium")).toBe(false);
    expect(list.some((t) => t.key === "channel")).toBe(true);
  });
});

describe("KPI card Value Format override", () => {
  it("passes format through when set", () => {
    const cfg = applyKpiConfig("google_ads", [
      { key: "cost", visible: true, order: 0, format: "number" },
    ]);
    expect(cfg.find((c) => c.slot === "cost")?.format).toBe("number");
  });

  it("is undefined when no override is configured", () => {
    const cfg = applyKpiConfig("google_ads", undefined);
    expect(cfg.every((c) => c.format === undefined)).toBe(true);
  });

  it("other cards in the same config keep no format unless they set one", () => {
    const cfg = applyKpiConfig("google_ads", [
      { key: "cost", visible: true, order: 0, format: "number" },
      { key: "revenue", visible: true, order: 1 },
    ]);
    expect(cfg.find((c) => c.slot === "revenue")?.format).toBeUndefined();
  });
});

describe("admin-added dimensions are offered to the AI", () => {
  it("an admin-added dimension joins the connector's aiDimensions", () => {
    expect(aiQueryDimensionsFor("ga4")).not.toContain("devicecategory");
    applyAdminCustomFields({
      ga4: {
        customDimensions: [
          {
            key: "devicecategory",
            label: "Device category",
            singular: "Device category",
            windsorField: "devicecategory",
          },
        ],
      },
    });
    expect(aiQueryDimensionsFor("ga4")).toContain("devicecategory");
  });

  it("the built-in dimensions are still offered alongside it", () => {
    applyAdminCustomFields({
      ga4: {
        customDimensions: [
          {
            key: "day_of_week_name",
            label: "Day of week name",
            singular: "Day of week name",
            windsorField: "day_of_week_name",
          },
        ],
      },
    });
    const dims = aiQueryDimensionsFor("ga4");
    expect(dims).toContain("day_of_week_name");
    expect(dims).toContain("channel");
    expect(dims).toContain("device");
  });

  it("a custom connector's own dimensions are offered too", () => {
    setCustomConnectors([adsRow]);
    expect(aiQueryDimensionsFor("tiktok_ads")).toEqual(
      expect.arrayContaining(["campaign", "adgroup"]),
    );
  });
});

describe("chartDimensionList (chart 'by' dropdown options)", () => {
  it("mirrors the visible tables when nothing is excluded", () => {
    const tables = connectorTableList("ga4").map((t) => t.key);
    expect(chartDimensionList("ga4", undefined).map((t) => t.key)).toEqual(tables);
  });

  it("drops a dimension the admin excluded from charts, keeping it as a table", () => {
    const dims = [{ key: "device", visible: true, order: 0, charts: false }];
    expect(connectorTableList("ga4").some((t) => t.key === "device")).toBe(true);
    expect(chartDimensionList("ga4", dims).some((t) => t.key === "device")).toBe(false);
  });

  it("a hidden table is absent from charts regardless of the flag", () => {
    const dims = [{ key: "device", visible: false, order: 0, charts: true }];
    expect(chartDimensionList("ga4", dims).some((t) => t.key === "device")).toBe(false);
  });

  it("charts:true (or absent) keeps the dimension offered", () => {
    const dims = [{ key: "device", visible: true, order: 0, charts: true }];
    expect(chartDimensionList("ga4", dims).some((t) => t.key === "device")).toBe(true);
  });
});

describe("windsorAccountIdFor", () => {
  const meta = {
    windsor_account_id: "111-111-1111",
    windsor_accounts: {
      googleanalytics4: { account_id: "GA4-999" },
      shopify: { account_id: "SHOP-777" },
    },
  };

  it("uses the binding for that source", () => {
    expect(windsorAccountIdFor(meta, "ga4")).toBe("GA4-999");
    expect(windsorAccountIdFor(meta, "shopify")).toBe("SHOP-777");
  });

  it("google_ads falls back to the legacy single account id", () => {
    expect(windsorAccountIdFor(meta, "google_ads")).toBe("111-111-1111");
  });

  it("never lends another source the legacy Google Ads account", () => {
    // Scoping a GA4 fetch to a Google Ads account matches no rows at all, so
    // an unbound source must resolve to undefined rather than borrow it.
    expect(windsorAccountIdFor({ windsor_account_id: "111-111-1111" }, "ga4")).toBeUndefined();
  });

  it("returns undefined when nothing is bound", () => {
    expect(windsorAccountIdFor({}, "ga4")).toBeUndefined();
    expect(windsorAccountIdFor(null, "google_ads")).toBeUndefined();
  });
});

describe("dashboardFilterKeysFor (AI 'Show on dashboard' link)", () => {
  it("offers the connector's own breakdowns, not Google Ads'", () => {
    const keys = dashboardFilterKeysFor("ga4");
    expect(keys).toEqual(expect.arrayContaining(["channel", "source_medium", "event"]));
    expect(keys).not.toContain("ad_group");
    expect(keys).not.toContain("match_type");
  });

  it("includes admin-added dimensions", () => {
    applyAdminCustomFields({
      ga4: {
        customDimensions: [
          {
            key: "day_of_week_name",
            label: "Day of week name",
            singular: "Day of week name",
            windsorField: "day_of_week_name",
          },
        ],
      },
    });
    expect(dashboardFilterKeysFor("ga4")).toContain("day_of_week_name");
  });

  it("always keeps the primary table's own two filter keys", () => {
    for (const id of ["google_ads", "ga4", "shopify"]) {
      expect(dashboardFilterKeysFor(id)).toEqual(
        expect.arrayContaining(["campaign_name", "campaign_selected"]),
      );
    }
  });

  it("normalizeFilterAction drops a dimension the source doesn't have", () => {
    const action = normalizeFilterAction(
      { label: "x", filters: [{ dimension: "ad_group", values: ["a"] }] },
      "ga4",
    );
    expect(action?.filters ?? []).toHaveLength(0);
  });

  it("normalizeFilterAction keeps one it does have", () => {
    const action = normalizeFilterAction(
      { label: "x", filters: [{ dimension: "source_medium", values: ["google / cpc"] }] },
      "ga4",
    );
    expect(action?.filters?.[0]?.dimension).toBe("source_medium");
  });
});

describe("reserved cross-filter keys", () => {
  it("renames a dimension that would claim the primary table's own keys", () => {
    expect(safeDimensionKey("campaign_name")).toBe("campaign_name_dim");
    expect(safeDimensionKey("campaign_selected")).toBe("campaign_selected_dim");
  });

  it("leaves every other key alone", () => {
    for (const k of ["device", "channel", "day_of_week_name", "transactionid"])
      expect(safeDimensionKey(k)).toBe(k);
  });

  it("an admin-added dimension can never collide with them", () => {
    // Selecting a row in such a table used to be read as a selection of the
    // PRIMARY entity, whose values these aren't — so every table and chart
    // filtered down to nothing.
    applyAdminCustomFields({
      ga4: {
        customDimensions: [
          {
            key: "campaign_name",
            label: "Campaign name",
            singular: "Campaign name",
            windsorField: "campaign_name",
          },
        ],
      },
    });
    const keys = getConnector("ga4").dimensions.map((d) => d.key);
    expect(keys).toContain("campaign_name_dim");
    expect(keys).not.toContain("campaign_name");
  });

  it("the renamed dimension still reads its own Windsor field", () => {
    applyAdminCustomFields({
      ga4: {
        customDimensions: [
          {
            key: "campaign_name",
            label: "Campaign name",
            singular: "Campaign name",
            windsorField: "campaign_name",
          },
        ],
      },
    });
    expect(windsorFieldsFor("ga4", "campaign_name_dim")).toContain("campaign_name");
  });
});

describe("normalizeAccountId", () => {
  it("compares Google Ads' two shapes as equal", () => {
    expect(normalizeAccountId("217-791-9789")).toBe(normalizeAccountId("2177919789"));
  });

  it("matches Windsor's two shapes of a Search Console property", () => {
    // The account list reports "sc-domain:example.com"; the data rows report
    // the bare host. Same account, so the assigned id must match the rows.
    expect(normalizeAccountId("sc-domain:wonderique.com")).toBe(
      normalizeAccountId("wonderique.com"),
    );
    expect(normalizeAccountId("https://example.com/")).toBe(normalizeAccountId("example.com"));
    expect(normalizeAccountId("www.example.com")).toBe(normalizeAccountId("example.com"));
  });

  it("two different properties never collide", () => {
    expect(normalizeAccountId("sc-domain:a.com")).not.toBe(normalizeAccountId("sc-domain:b.com"));
    expect(normalizeAccountId("sc-domain:a.com")).not.toBe(normalizeAccountId("b.com"));
  });

  it("handles blank input", () => {
    expect(normalizeAccountId("")).toBe("");
    expect(normalizeAccountId(null)).toBe("");
  });
});

describe("a custom metric named like a canonical one replaces it, never duplicates", () => {
  // Exactly the Search Console setup: the admin registers clicks / impressions
  // / ctr, which are ordinary Windsor field names AND canonical metric keys.
  const gsc: CustomConnectorRow = {
    id: "searchconsole",
    label: "Google Search Console",
    color: "#4285F4",
    windsor_source: "searchconsole",
    metric_schema: "analytics",
    primary_dimension: {
      key: "query",
      label: "Search Query",
      singular: "Search Query",
      windsorField: "query",
    },
    dimensions: [],
    ai_dimensions: [],
    custom_metrics: [
      { key: "clicks", label: "Clicks", windsorField: "clicks", format: "number" },
      { key: "impressions", label: "Impressions", windsorField: "impressions", format: "number" },
      { key: "ctr", label: "CTR", windsorField: "ctr", format: "percent" },
    ],
  };

  it("the manifest lists each metric key once", () => {
    const keys = buildCustomManifest(gsc).metrics.map((m) => m.key);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("the admin's label wins over the canonical one", () => {
    const m = buildCustomManifest(gsc).metrics.find((x) => x.key === "clicks");
    expect(m?.label).toBe("Clicks");
  });

  it("KPI card options contain no duplicate slot", () => {
    setCustomConnectors([gsc]);
    const slots = connectorKpiOptions("searchconsole").map((o) => o.slot);
    expect(slots.length).toBe(new Set(slots).size);
  });

  it("metric columns contain no duplicate key", () => {
    setCustomConnectors([gsc]);
    const keys = connectorMetricCols("searchconsole").map((c) => c.key);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("a genuinely new custom metric is still added", () => {
    setCustomConnectors([
      {
        ...gsc,
        custom_metrics: [
          { key: "position", label: "Avg position", windsorField: "position", format: "number" },
        ],
      },
    ]);
    expect(connectorMetricCols("searchconsole").some((c) => c.key === "position")).toBe(true);
  });
});

describe("metric aggregation is the admin's choice, not a guess from the format", () => {
  const withPosition = (aggregation?: "sum" | "avg"): CustomConnectorRow => ({
    id: "gsc2",
    label: "GSC",
    color: "#4285F4",
    windsor_source: "searchconsole",
    metric_schema: "analytics",
    primary_dimension: { key: "query", label: "Q", singular: "Q", windsorField: "query" },
    dimensions: [],
    ai_dimensions: [],
    custom_metrics: [
      {
        key: "avg_position",
        label: "Average SERP position",
        windsorField: "position",
        format: "number",
        ...(aggregation ? { aggregation } : {}),
      },
      { key: "impr2", label: "Impressions", windsorField: "impressions", format: "number" },
    ],
  });

  it("an explicit avg wins over the number format", () => {
    setCustomConnectors([withPosition("avg")]);
    expect(isAveragedMetric("gsc2", "avg_position")).toBe(true);
  });

  it("without a choice it still falls back to the format", () => {
    setCustomConnectors([withPosition()]);
    // A plain number defaults to summing, which is exactly why the position
    // needed an explicit setting.
    expect(isAveragedMetric("gsc2", "avg_position")).toBe(false);
  });

  it("an explicit sum wins over a percent format", () => {
    setCustomConnectors([
      {
        ...withPosition(),
        custom_metrics: [
          { key: "odd", label: "Odd", windsorField: "x", format: "percent", aggregation: "sum" },
        ],
      },
    ]);
    expect(isAveragedMetric("gsc2", "odd")).toBe(false);
  });

  it("other metrics are unaffected", () => {
    setCustomConnectors([withPosition("avg")]);
    expect(isAveragedMetric("gsc2", "impr2")).toBe(false);
  });
});

// The Admin Panel offers Custom metrics / Custom dimensions for EVERY source in
// the list, admin-added ones included. Those were saved and echoed back in the
// panel but skipped when the registry was rebuilt, so for an admin-added source
// they never reached the dashboard: a metric marked Average still summed, newly
// registered metrics were missing from the KPI-card and metric-column pickers,
// and extra dimensions produced no breakdown tables. Reproduces the exact
// Search Console setup that surfaced it.
describe("admin config on an admin-added source", () => {
  const scRow: CustomConnectorRow = {
    id: "searchconsole",
    label: "Google Search Console",
    color: "#4285F4",
    windsor_source: "searchconsole",
    metric_schema: "ads",
    primary_dimension: {
      key: "query",
      label: "Search Query Performance",
      singular: "Search Query",
      windsorField: "query",
    },
    dimensions: [],
    ai_dimensions: [],
    // Registered at creation time, WITHOUT an explicit aggregation.
    custom_metrics: [
      {
        key: "position_page",
        label: "Average SERP position",
        format: "number",
        windsorField: "position_page",
      },
    ],
  };
  // What the admin later configured for it in the panel.
  const cfg = {
    searchconsole: {
      customMetrics: [
        {
          key: "position_page",
          label: "Average SERP position",
          format: "number" as const,
          aggregation: "avg" as const,
          windsorField: "position_page",
        },
        { key: "errors", label: "Errors", format: "number" as const, windsorField: "errors" },
      ],
      customDimensions: [
        { key: "device", label: "Device", singular: "Device", windsorField: "device" },
        // The primary dimension re-picked from the Windsor field list.
        { key: "query", label: "Search Query", singular: "Search Query", windsorField: "query" },
      ],
    },
  };

  beforeEach(() => {
    setCustomConnectors([scRow]);
    applyAdminCustomFields(cfg);
  });

  it("honours the admin's Average aggregation over the creation-time default", () => {
    expect(isAveragedMetric("searchconsole", "position_page")).toBe(true);
  });

  it("still sums a metric left on the default", () => {
    expect(isAveragedMetric("searchconsole", "errors")).toBe(false);
  });

  it("offers newly registered metrics as metric columns and KPI cards", () => {
    expect(connectorMetricCols("searchconsole").map((m) => m.key)).toContain("errors");
    expect(connectorKpiOptions("searchconsole").map((k) => k.slot)).toContain("errors");
  });

  it("requests the new field from Windsor", () => {
    expect(getConnector("searchconsole").windsorMetrics).toContain("errors");
    expect(getConnector("searchconsole").customMetricFields?.errors).toBe("errors");
  });

  it("turns an added dimension into a breakdown table", () => {
    expect(connectorTableList("searchconsole").map((t) => t.key)).toContain("device");
  });

  it("does not duplicate the primary dimension when it is re-picked", () => {
    const keys = getConnector("searchconsole").dimensions.map((d) => d.key);
    expect(keys.filter((k) => k === "query")).toHaveLength(1);
  });

  it("keeps the layering when the two loads arrive in the other order", () => {
    // The config fetch and the custom-connector fetch race; neither order may
    // drop the layer.
    setCustomConnectors([]);
    applyAdminCustomFields({});
    applyAdminCustomFields(cfg);
    setCustomConnectors([scRow]);
    expect(isAveragedMetric("searchconsole", "position_page")).toBe(true);
    expect(connectorTableList("searchconsole").map((t) => t.key)).toContain("device");
  });

  it("re-applying config does not stack duplicate metrics onto the manifest", () => {
    applyAdminCustomFields(cfg);
    applyAdminCustomFields(cfg);
    const keys = getConnector("searchconsole").metrics.map((m) => m.key);
    expect(keys.filter((k) => k === "errors")).toHaveLength(1);
    expect(
      getConnector("searchconsole")
        .windsorMetrics.split(",")
        .filter((f) => f === "errors"),
    ).toHaveLength(1);
  });

  it("leaves a source with no admin config untouched", () => {
    expect(getConnector("ga4")).toBe(BUILT_IN_CONNECTORS.ga4);
  });
});

// The chart's metric dropdown used to be a fixed Google-Ads list
// (Revenue / Conversions / Traffic), so another source was offered metrics it
// doesn't have — and shown "No revenue during the selected period" — while its
// own metrics were unreachable.
describe("chartMetricList", () => {
  it("offers the source's own metrics, not a fixed Google-Ads set", () => {
    applyAdminCustomFields({
      ga4: {
        customMetrics: [
          {
            key: "bounceRate",
            label: "Bounce rate",
            format: "percent",
            windsorField: "bounceRate",
          },
        ],
      },
    });
    expect(chartMetricList("ga4").map((m) => m.key)).toContain("bounceRate");
  });

  it("drops metrics the chart has no series for", () => {
    // No per-entity, per-day value exists for these, so plotting them would
    // draw a flat zero line.
    const keys = chartMetricList("google_ads").map((m) => m.key);
    expect(keys).toContain("revenue");
    expect(keys).not.toContain("ctr");
    expect(keys).not.toContain("roasVal");
  });

  it("omits cost-derived metrics on a source with no spend", () => {
    const keys = chartMetricList("ga4").map((m) => m.key);
    expect(keys).not.toContain("cost");
    expect(keys).not.toContain("profit");
  });

  it("respects the admin's visibility and Charts toggle", () => {
    const cfg = [
      { key: "revenue", visible: true, order: 0 },
      { key: "conv", visible: true, order: 1, charts: false },
      { key: "clicks", visible: false, order: 2 },
    ];
    const keys = chartMetricList("google_ads", cfg).map((m) => m.key);
    expect(keys).toContain("revenue");
    expect(keys).not.toContain("conv"); // kept as a column, dropped from charts
    expect(keys).not.toContain("clicks"); // hidden column
  });

  it("carries a format so the axis and tooltip know how to render", () => {
    const byKey = new Map(chartMetricList("google_ads").map((m) => [m.key, m.format]));
    expect(byKey.get("revenue")).toBe("money");
    expect(byKey.get("clicks")).toBe("number");
  });
});

it("asks Windsor for a field once even when it is registered twice", () => {
  // The same metric registered at source-creation time AND again in the
  // source's config used to be appended to the field string twice.
  setCustomConnectors([
    {
      ...adsRow,
      id: "dupe_src",
      custom_metrics: [
        { key: "position_page", label: "Pos", format: "number", windsorField: "position_page" },
      ],
    },
  ]);
  applyAdminCustomFields({
    dupe_src: {
      customMetrics: [
        { key: "position_page", label: "Pos", format: "number", windsorField: "position_page" },
      ],
    },
  });
  const fields = getConnector("dupe_src").windsorMetrics.split(",");
  expect(fields.filter((f) => f === "position_page")).toHaveLength(1);
});

// The chart's "by" dropdown is built from the admin's Tables config for every
// source. Google Ads used to keep a hand-picked four, so its Charts checkboxes
// did nothing there.
describe("chartDimensionList on Google Ads", () => {
  it("offers the configured breakdowns, not a fixed four", () => {
    const labels = chartDimensionList("google_ads").map((t) => t.dimensionLabel);
    expect(labels).toEqual(expect.arrayContaining(["Ad Group", "Search Term", "Device"]));
  });

  it("drops a breakdown the admin unticked for charts", () => {
    const labels = chartDimensionList("google_ads", [
      { key: "device", visible: true, order: 0, charts: false },
    ]).map((t) => t.dimensionLabel);
    expect(labels).not.toContain("Device");
    expect(labels).toContain("Ad Group");
  });

  it("never offers the Time table — the chart is already a time series", () => {
    expect(chartDimensionList("google_ads").map((t) => t.key)).not.toContain("time");
  });

  it("never offers a breakdown with no data behind it", () => {
    expect(chartDimensionList("google_ads").every((t) => t.available)).toBe(true);
  });
});

// Each source has its own dashboard URL, so a link can point at one and a
// reload keeps it. The slug is matched against the live registry, so an
// admin-added source is routable without a code change.
describe("dashboard URLs", () => {
  it("keeps Google Ads on the path it has always had", () => {
    expect(connectorSlug("google_ads")).toBe("google-ads");
    expect(connectorFromSlug("google-ads")).toBe("google_ads");
  });

  it("round-trips every built-in source", () => {
    for (const id of Object.keys(BUILT_IN_CONNECTORS)) {
      expect(connectorFromSlug(connectorSlug(id))).toBe(id);
    }
  });

  it("routes an admin-added source too", () => {
    setCustomConnectors([{ ...adsRow, id: "searchconsole" }]);
    expect(connectorSlug("searchconsole")).toBe("searchconsole");
    expect(connectorFromSlug("searchconsole")).toBe("searchconsole");
  });

  it("rejects a slug that names no source", () => {
    expect(connectorFromSlug("admin")).toBeNull();
    expect(connectorFromSlug("profile")).toBeNull();
    expect(connectorFromSlug("")).toBeNull();
    expect(connectorFromSlug("nope")).toBeNull();
  });

  it("is case-insensitive, so a pasted link still resolves", () => {
    expect(connectorFromSlug("Google-Ads")).toBe("google_ads");
  });
});

// Selecting a row anywhere redistributes the selection across every other
// breakdown. Google Ads carried a hand-written list of those dimensions that
// silently omitted three of its own tables, so Search terms, Campaign type and
// Ad ignored every selection and kept showing whole-account totals.
describe("crossFilterDimensionsFor", () => {
  it("covers every table Google Ads renders", () => {
    const dims = crossFilterDimensionsFor("google_ads");
    for (const key of connectorTableList("google_ads")
      .filter((t) => t.available && !t.custom)
      .map((t) => t.key)) {
      expect(dims).toContain(key);
    }
  });

  it("names the three that used to be missing", () => {
    const dims = crossFilterDimensionsFor("google_ads");
    expect(dims).toEqual(expect.arrayContaining(["search_term", "campaign_type", "ad"]));
  });

  it("keeps the time buckets, which have no table of their own", () => {
    expect(crossFilterDimensionsFor("google_ads")).toEqual(
      expect.arrayContaining(["day_of_week", "hour", "week", "month", "quarter", "year"]),
    );
  });

  it("never includes the primary entity — it drives the redistribution", () => {
    for (const id of Object.keys(BUILT_IN_CONNECTORS)) {
      expect(crossFilterDimensionsFor(id)).not.toContain(getConnector(id).primaryDimension);
    }
  });

  it("covers every table of a source with no hand-written list at all", () => {
    const dims = crossFilterDimensionsFor("ga4");
    for (const key of connectorTableList("ga4").map((t) => t.key)) expect(dims).toContain(key);
  });

  it("covers an admin-added source's tables too", () => {
    setCustomConnectors([scRowForCross]);
    expect(crossFilterDimensionsFor("sc_cross")).toContain("device");
  });
});

const scRowForCross: CustomConnectorRow = {
  ...adsRow,
  id: "sc_cross",
  dimensions: [{ key: "device", label: "Device", singular: "Device", windsorField: "device" }],
};

describe("telling the app the registry changed", () => {
  // The sidebar derives its platform list from the registry, which is a plain
  // module object nothing re-renders on. Leaving the announcement to each
  // caller meant the data-sources page loaded the admin's sources, rendered
  // them, and never said so — the sidebar beside it kept showing the built-ins
  // while the page listed a connected source.
  const row: CustomConnectorRow = {
    id: "searchconsole",
    label: "Google Search Console",
    color: "#4285f4",
    windsor_source: "searchconsole",
    metric_schema: "analytics",
    primary_dimension: { key: "page", label: "Pages", singular: "Page", windsorField: "page" },
    dimensions: [{ key: "page", label: "Pages", singular: "Page", windsorField: "page" }],
    ai_dimensions: [],
    custom_metrics: [],
  };

  it("announces a source arriving", () => {
    const seen: number[] = [];
    const off = onConnectorRegistryChange(() => seen.push(CONNECTOR_IDS.length));
    setCustomConnectors([row]);
    off();
    expect(seen).toHaveLength(1);
    // Announced AFTER the registry grew, or a listener reading it would see
    // the list it was told had changed.
    expect(CONNECTOR_IDS).toContain("searchconsole");
    expect(seen[0]).toBe(CONNECTOR_IDS.length);
  });

  it("announces an admin's metrics landing on a source", () => {
    const seen = jest.fn();
    const off = onConnectorRegistryChange(seen);
    applyAdminCustomFields({});
    off();
    expect(seen).toHaveBeenCalled();
  });

  it("stops announcing once a listener unsubscribes", () => {
    const seen = jest.fn();
    onConnectorRegistryChange(seen)();
    setCustomConnectors([row]);
    expect(seen).not.toHaveBeenCalled();
  });
});
