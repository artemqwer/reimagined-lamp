/**
 * Tests for /api/windsor route — auth and parameter validation.
 */

const mockGetUser = jest.fn();

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

jest.mock("next/headers", () => ({
  cookies: jest.fn(() => Promise.resolve({ getAll: () => [] })),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/windsor/route";

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/windsor");
  url.searchParams.set("date_from", params.date_from ?? "2024-01-01");
  url.searchParams.set("date_to", params.date_to ?? "2024-01-31");
  if (params.group_by) url.searchParams.set("group_by", params.group_by);
  return GET(new NextRequest(url.toString()));
}

const AUTHED_USER = () =>
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-123", user_metadata: {} } },
  });

const ADS_DATA = [
  {
    date: "2024-01-01",
    impressions: 1000,
    clicks: 50,
    spend: 25,
    conversions: 3,
    conversion_value: 150,
  },
];

beforeEach(() => {
  mockGetUser.mockReset();
});

describe("GET /api/windsor — auth", () => {
  it("returns 400 when date params missing", async () => {
    AUTHED_USER();
    const req = new NextRequest("http://localhost/api/windsor");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await makeRequest();
    expect(res.status).toBe(401);
  });
});
