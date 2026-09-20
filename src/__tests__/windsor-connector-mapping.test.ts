/**
 * /api/windsor — non-Google connectors (Meta / GA4 / Shopify) go through the
 * generic manifest path. Each source names its metrics differently; the route
 * must fold them onto the canonical row the dashboard reads.
 */

const mockGetUser = jest.fn();

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

jest.mock("next/headers", () => ({
  cookies: jest.fn(() => Promise.resolve({ getAll: () => [] })),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/windsor/route";

// The route memoises responses per (key, connector, dates, group_by), so tests that
// reuse a connector+group_by must vary the range or they'd read each other's rows.
function call(connector: string, groupBy: string, dateFrom = "2024-01-01") {
  const url = new URL("http://localhost/api/windsor");
  url.searchParams.set("date_from", dateFrom);
  url.searchParams.set("date_to", "2024-01-31");
  url.searchParams.set("group_by", groupBy);
  url.searchParams.set("connector", connector);
  return GET(new NextRequest(url.toString()));
}

// Windsor answers with each connector's NATIVE field names.
function windsorReturns(rows: Record<string, unknown>[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: rows }),
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({
    // The key lives in app_metadata — user_metadata is user-writable, so nothing
    // the server acts on is read from there any more (see lib/authz).
    data: { user: { id: "u1", user_metadata: {}, app_metadata: { windsor_api_key: "k" } } },
  });
});

describe("each source is read from its own Windsor endpoint", () => {
  // `/all` blends every connector wired into the Windsor account, so a non-Google
  // source that hit it would silently get the same merged rows as everyone else.
  it.each([
    ["shopify", "date,product", "shopify"],
    ["ga4", "date,channel", "googleanalytics4"],
    ["meta_ads", "date,campaign", "facebook"],
  ])("%s reads from /%s", async (connector, groupBy, endpoint) => {
    windsorReturns([]);
    await call(connector, groupBy, "2023-06-01");

    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain(`connectors.windsor.ai/${endpoint}?`);
    expect(url).not.toContain("connectors.windsor.ai/all?");
  });
});

describe("generic connector → canonical row", () => {
  it("GA4: sessions become traffic, conversion_value becomes revenue", async () => {
    windsorReturns([
      {
        date: "2024-01-01",
        default_channel_group: "Organic Search",
        sessions: 400,
        users: 310,
        conversions: 12,
        conversion_value: 900,
      },
    ]);

    const res = await call("ga4", "date,channel");
    const json = await res.json();
    const row = json.data[0];

    expect(row.dimension).toBe("Organic Search");
    expect(row.clicks).toBe(400); // sessions → traffic
    expect(row.conversions).toBe(12);
    expect(row.conversion_value).toBe(900);
    expect(row.spend).toBe(0); // GA4 has no ad spend
  });

  it("Shopify: orders become conversions, total_sales becomes revenue", async () => {
    windsorReturns([
      {
        date: "2024-01-01",
        product_title: "Blue Shirt",
        orders: 7,
        total_sales: 349.5,
        quantity: 9,
      },
    ]);

    const res = await call("shopify", "date,product");
    const json = await res.json();
    const row = json.data[0];

    expect(row.dimension).toBe("Blue Shirt");
    expect(row.conversions).toBe(7); // orders → conversions
    expect(row.conversion_value).toBe(349.5); // total_sales → revenue
    expect(row.clicks).toBe(9); // quantity → traffic
    expect(row.spend).toBe(0);
  });

  it("Meta: reach counts as impressions, spend/clicks pass through", async () => {
    windsorReturns([
      {
        date: "2024-01-01",
        adset_name: "Retarget 30d",
        clicks: 88,
        reach: 5200,
        spend: 40,
        conversions: 4,
        conversion_value: 260,
      },
    ]);

    const res = await call("meta_ads", "date,adset");
    const json = await res.json();
    const row = json.data[0];

    expect(row.dimension).toBe("Retarget 30d");
    expect(row.clicks).toBe(88);
    expect(row.impressions).toBe(5200); // reach → impressions
    expect(row.spend).toBe(40);
    expect(row.conversion_value).toBe(260);
  });
});
