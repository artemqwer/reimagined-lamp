import { toBqRow, rowsFromQueryResponse, type SyncKey } from "@/lib/bigquery";
import type { WindsorRow } from "@/app/api/windsor/route";

const key: SyncKey = {
  accountId: "217-791-9789",
  connector: "meta_ads",
  groupBy: "campaign",
  dateFrom: "2026-08-01",
  dateTo: "2026-08-31",
};

const row: WindsorRow = {
  date: null,
  campaign: "Brand — Search",
  pivot: "Brand — Search",
  campaign_type: "SEARCH",
  campaign_status: "ENABLED",
  ad_group: null,
  keyword_text: null,
  match_type: null,
  dimension: "Brand — Search",
  clicks: 1234,
  impressions: 56789,
  spend: 987.65,
  conversions: 42,
  conversion_value: 3210.5,
};

// A BigQuery `queries` response echoes every value as a string under
// { schema.fields[].name, rows[].f[].v }. Build one from a written row so the
// test exercises the exact contract the reader parses.
function fakeQueryResponse(written: Record<string, unknown>) {
  const cols = [
    "date",
    "campaign",
    "campaign_type",
    "campaign_status",
    "ad_group",
    "keyword_text",
    "match_type",
    "pivot",
    "dimension",
    "clicks",
    "impressions",
    "spend",
    "conversions",
    "conversion_value",
    "extra",
  ];
  return {
    schema: { fields: cols.map((name) => ({ name })) },
    rows: [{ f: cols.map((c) => ({ v: written[c] === null ? null : String(written[c]) })) }],
  };
}

describe("BigQuery row mappers", () => {
  it("toBqRow tags a WindsorRow with the isolation key + metrics", () => {
    const b = toBqRow(key, row, "2026-09-15T10:00:00Z");
    expect(b.account_id).toBe("217-791-9789");
    expect(b.connector).toBe("meta_ads");
    expect(b.group_by).toBe("campaign");
    expect(b.date_from).toBe("2026-08-01");
    expect(b.campaign).toBe("Brand — Search");
    expect(b.spend).toBe(987.65);
    expect(b.synced_at).toBe("2026-09-15T10:00:00Z");
  });

  it("rowsFromQueryResponse coerces numbers and preserves nulls", () => {
    const written = toBqRow(key, row, "2026-09-15T10:00:00Z");
    const [out] = rowsFromQueryResponse(fakeQueryResponse(written));
    // numbers come back as numbers, not strings
    expect(out.clicks).toBe(1234);
    expect(out.spend).toBeCloseTo(987.65);
    expect(out.conversion_value).toBeCloseTo(3210.5);
    // a null column stays null (not the string "null")
    expect(out.date).toBeNull();
    expect(out.ad_group).toBeNull();
    // strings survive
    expect(out.campaign).toBe("Brand — Search");
    expect(out.dimension).toBe("Brand — Search");
    expect(out.campaign_status).toBe("ENABLED");
  });

  it("round-trips the data fields of a WindsorRow", () => {
    const written = toBqRow(key, row, "2026-09-15T10:00:00Z");
    const [out] = rowsFromQueryResponse(fakeQueryResponse(written));
    const { extra: _e, ...core } = row;
    expect(out).toEqual(core);
  });

  it("round-trips admin custom metrics (extra) as JSON", () => {
    const withExtra: WindsorRow = { ...row, extra: { spons_clicks: 942, spons_sales: 1340.5 } };
    const written = toBqRow(key, withExtra, "2026-09-15T10:00:00Z");
    expect(typeof written.extra).toBe("string"); // stored as a JSON string
    const [out] = rowsFromQueryResponse(fakeQueryResponse(written));
    expect(out.extra).toEqual({ spons_clicks: 942, spons_sales: 1340.5 });
  });

  it("a row with no custom metrics stores extra as null and reads back undefined", () => {
    const written = toBqRow(key, row, "2026-09-15T10:00:00Z");
    expect(written.extra).toBeNull();
    const [out] = rowsFromQueryResponse(fakeQueryResponse(written));
    expect(out.extra).toBeUndefined(); // lets the caller detect a pre-extra cache row
  });

  it("empty query response → []", () => {
    expect(rowsFromQueryResponse({ schema: { fields: [] }, rows: [] })).toEqual([]);
  });
});
