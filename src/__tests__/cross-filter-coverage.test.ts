import { readFileSync } from "fs";
import { join } from "path";
/**
 * Guards the two invariants that make a selection in one table reach the
 * others. Both were broken by omission — a hand-written list that didn't keep
 * up with the tables, and one breakdown that didn't request the field the join
 * needs — and both failed silently: the table kept rendering, just with
 * account-wide numbers. These assert the rule rather than the current list, so
 * adding a breakdown can't quietly leave it out again.
 */

jest.mock("@supabase/ssr", () => ({ createServerClient: jest.fn() }));
jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/supabase-admin", () => ({ adminClient: jest.fn() }));

import {
  BUILT_IN_CONNECTORS,
  connectorTableList,
  crossFilterDimensionsFor,
  getConnector,
  CONNECTOR_IDS,
  CONNECTORS,
  setCustomConnectors,
  type CustomConnectorRow,
} from "@/lib/connectors";
import { GOOGLE_ADS_GROUP_BY_FIELDS, GOOGLE_ADS_PIVOT_FIELD } from "@/app/api/windsor/route";

describe("every breakdown a source shows takes part in the cross-filter", () => {
  const tableKeys = (id: string) =>
    connectorTableList(id)
      .filter((t) => t.available && !t.custom)
      .map((t) => t.key);

  for (const id of Object.keys(BUILT_IN_CONNECTORS)) {
    it(`${id}: no table is left out of the redistribution`, () => {
      const dims = crossFilterDimensionsFor(id);
      for (const key of tableKeys(id)) expect(dims).toContain(key);
    });

    it(`${id}: the primary entity drives it and isn't redistributed`, () => {
      expect(crossFilterDimensionsFor(id)).not.toContain(getConnector(id).primaryDimension);
    });
  }

  it("an admin-added source is covered without anyone listing it", () => {
    const row: CustomConnectorRow = {
      id: "invented_source",
      label: "Invented",
      color: "#000",
      windsor_source: "invented",
      metric_schema: "ads",
      primary_dimension: {
        key: "thing",
        label: "Things",
        singular: "Thing",
        windsorField: "thing",
      },
      dimensions: [{ key: "widget", label: "Widgets", singular: "Widget", windsorField: "widget" }],
      ai_dimensions: [],
    };
    setCustomConnectors([row]);
    expect(crossFilterDimensionsFor("invented_source")).toEqual(["widget"]);
    setCustomConnectors([]);
  });
});

describe("every Google Ads breakdown requests the field the join needs", () => {
  const entries = Object.entries(GOOGLE_ADS_GROUP_BY_FIELDS);

  it("has breakdowns to check", () => {
    expect(entries.length).toBeGreaterThan(10);
  });

  it.each(entries.filter(([g]) => g !== "date"))("%s carries the pivot", (_groupBy, fields) => {
    expect(fields.split(",")).toContain(GOOGLE_ADS_PIVOT_FIELD);
  });

  it("leaves the account-wide daily series alone — it has no breakdown to scope", () => {
    expect(GOOGLE_ADS_GROUP_BY_FIELDS.date.split(",")).not.toContain(GOOGLE_ADS_PIVOT_FIELD);
  });

  it("keeps date first, so the date-bucketed shapes still read date-first", () => {
    for (const [groupBy, fields] of entries) {
      if (groupBy.startsWith("date,")) expect(fields.split(",")[0]).toBe("date");
    }
  });
});

describe("which Windsor endpoint a source reads from", () => {
  // Google Ads used to read from `/all`, the endpoint that merges every source
  // wired into the Windsor account. That made it hostage to the others:
  // connecting Search Console, which only keeps 16 months, made `/all` reject
  // any longer range and the whole Google Ads dashboard went blank — every
  // breakdown at once, with nothing about Google Ads having changed.
  const route = readFileSync(join(process.cwd(), "src/app/api/windsor/route.ts"), "utf8");

  it("reads from the source's own endpoint, never the merged one", () => {
    const line = route.split("\n").find((l) => l.includes("const endpoint ="));
    expect(line).toBeDefined();
    expect(line).toContain("windsorSource");
    // No conditional falling back to the blended endpoint.
    expect(line).not.toMatch(/["']all["']/);
  });

  it("every source declares an endpoint of its own to read from", () => {
    // The rule only holds if there is always one to use.
    for (const id of CONNECTOR_IDS) {
      expect(typeof CONNECTORS[id].windsorSource).toBe("string");
      expect(CONNECTORS[id].windsorSource.length).toBeGreaterThan(0);
      expect(CONNECTORS[id].windsorSource).not.toBe("all");
    }
  });
});
