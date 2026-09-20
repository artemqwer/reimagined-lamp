import { checkDateRange, checkConnector, MAX_RANGE_DAYS } from "@/lib/requestGuards";
import { isPeriod } from "@/lib/smartGoals";

// These decide, at the route boundary, what used to be decided upstream — and
// answered with a 500 carrying Windsor's or Postgres's own words.

describe("checkDateRange", () => {
  it("accepts an ordinary range", () => {
    const r = checkDateRange("2026-08-01", "2026-08-13");
    expect(r.ok).toBe(true);
  });

  it("names a missing date rather than passing null upstream", () => {
    expect(checkDateRange(null, "2026-08-13")).toEqual({
      ok: false,
      error: "Missing date_from or date_to",
    });
  });

  it("rejects something that isn't a date", () => {
    // This used to reach Windsor and come back as a 500 quoting its parser.
    const r = checkDateRange("banana", "2026-08-13");
    expect(r).toEqual({ ok: false, error: "Dates must be written as YYYY-MM-DD." });
  });

  it("rejects a reversed range", () => {
    const r = checkDateRange("2026-12-01", "2026-01-01");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/start date is after the end date/i);
  });

  it("rejects a range no source will serve, instead of waiting 90 seconds for it", () => {
    const r = checkDateRange("2000-01-01", "2026-08-13");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(new RegExp(String(MAX_RANGE_DAYS)));
  });

  it("allows a range exactly at the ceiling", () => {
    const start = new Date(Date.UTC(2026, 0, 1));
    const end = new Date(start.getTime() + (MAX_RANGE_DAYS - 1) * 86_400_000);
    expect(
      checkDateRange(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)).ok,
    ).toBe(true);
  });

  it("allows a single day", () => {
    expect(checkDateRange("2026-08-13", "2026-08-13").ok).toBe(true);
  });
});

describe("checkConnector", () => {
  it("accepts a source the registry knows", () => {
    expect(checkConnector("google_ads")).toEqual({ ok: true });
  });

  it("refuses an unknown one rather than quietly serving the default source", () => {
    // getConnector() falls back to Google Ads, which is right inside the app
    // and wrong at a route boundary: a typo returned a confident 200 full of
    // the wrong platform's numbers.
    const r = checkConnector("notreal");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/Unknown data source "notreal"/);
  });
});

describe("isPeriod", () => {
  // A URL parameter must never be able to take a page down. periodKind throws;
  // this is the question to ask when the answer decides a fallback.
  it("recognises the two shapes", () => {
    expect(isPeriod("2026-08")).toBe(true);
    expect(isPeriod("2026")).toBe(true);
  });

  it("rejects everything else without throwing", () => {
    for (const v of ["not-a-period", "2026-13", "2026-00", "", "26-08", "2026-8"])
      expect(isPeriod(v)).toBe(false);
  });
});
