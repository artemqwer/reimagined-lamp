import {
  isGoogleAdsApiConfigured,
  describeGoogleAdsError,
  GADS_API_VERSION,
} from "@/lib/google-ads-api";

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

describe("isGoogleAdsApiConfigured", () => {
  it("returns false when no env vars", () => {
    expect(isGoogleAdsApiConfigured()).toBe(false);
  });

  it("returns true when developer token set", () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-token";
    expect(isGoogleAdsApiConfigured()).toBe(true);
  });
});

describe("describeGoogleAdsError", () => {
  // The bug this replaces: the code assumed any HTML body meant an unapproved
  // developer token, so a sunset API version was reported as an account
  // permissions problem and sent us to the wrong place to fix it.
  it("names a sunset API version when the host answers with HTML", () => {
    const msg = describeGoogleAdsError(404, "<!DOCTYPE html><html>Error 404 (Not Found)</html>");
    expect(msg).toMatch(/no longer served/i);
    expect(msg).toContain(GADS_API_VERSION);
    expect(msg).not.toMatch(/test account/i);
  });

  it("names the developer token when Google says it is unapproved", () => {
    const msg = describeGoogleAdsError(
      403,
      JSON.stringify({
        error: {
          details: [
            { errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" } }] },
          ],
        },
      }),
    );
    expect(msg).toMatch(/test accounts only/i);
    expect(msg).toMatch(/Basic Access/);
  });

  it("passes anything else through rather than guessing", () => {
    expect(describeGoogleAdsError(500, "upstream exploded")).toContain("upstream exploded");
  });
});

describe("GADS_API_VERSION", () => {
  // v18 was sunset and 404ing for every call. Whatever it is pinned to, it
  // must at least be past the versions known to be dead.
  it("is not one of the sunset versions", () => {
    const n = Number(GADS_API_VERSION.replace(/^v/, ""));
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(20);
  });
});

describe("getGoogleAdsCustomerId", () => {
  beforeEach(() => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token-123";
  });

  it("returns first customer ID from listAccessibleCustomers", async () => {
    jest.resetModules();
    const { getGoogleAdsCustomerId } = await import("@/lib/google-ads-api");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ resourceNames: ["customers/1234567890", "customers/9876543210"] }),
    });

    const id = await getGoogleAdsCustomerId("access-token");
    expect(id).toBe("1234567890");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("listAccessibleCustomers"),
      expect.objectContaining({
        headers: expect.objectContaining({ "developer-token": "dev-token-123" }),
      }),
    );
  });

  it("throws when no accounts found", async () => {
    jest.resetModules();
    const { getGoogleAdsCustomerId } = await import("@/lib/google-ads-api");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ resourceNames: [] }),
    });

    await expect(getGoogleAdsCustomerId("token")).rejects.toThrow(
      "No accessible Google Ads accounts",
    );
  });
});

describe("fetchGoogleAdsApiData", () => {
  beforeEach(() => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token-123";
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  });

  it("refreshes access token before making API call", async () => {
    jest.resetModules();
    const { fetchGoogleAdsApiData } = await import("@/lib/google-ads-api");

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "new-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [], nextPageToken: undefined }),
      });

    await fetchGoogleAdsApiData(
      "2024-01-01",
      "2024-01-31",
      "date",
      "refresh-token-123",
      "1234567890",
    );

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("googleads.googleapis.com"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "developer-token": "dev-token-123",
          Authorization: "Bearer new-access-token",
        }),
      }),
    );
  });

  it("maps API response to AdsRow format", async () => {
    jest.resetModules();
    const { fetchGoogleAdsApiData } = await import("@/lib/google-ads-api");

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              segments: { date: "2024-01-15" },
              campaign: { name: "PMax: Summer Sale" },
              metrics: {
                impressions: "5000",
                clicks: "200",
                costMicros: "50000000",
                conversions: "10",
                conversionsValue: "500",
              },
            },
          ],
        }),
      });

    const result = await fetchGoogleAdsApiData(
      "2024-01-01",
      "2024-01-31",
      "date,campaign",
      "refresh-token",
      "1234567890",
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      date: "2024-01-15",
      campaign: "PMax: Summer Sale",
      impressions: 5000,
      clicks: 200,
      spend: 50,
      conversions: 10,
      conversion_value: 500,
    });
  });

  it("handles pagination with nextPageToken", async () => {
    jest.resetModules();
    const { fetchGoogleAdsApiData } = await import("@/lib/google-ads-api");

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              segments: { date: "2024-01-01" },
              campaign: { name: "A" },
              metrics: {
                impressions: "100",
                clicks: "10",
                costMicros: "1000000",
                conversions: "1",
                conversionsValue: "50",
              },
            },
          ],
          nextPageToken: "page-2",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              segments: { date: "2024-01-02" },
              campaign: { name: "B" },
              metrics: {
                impressions: "200",
                clicks: "20",
                costMicros: "2000000",
                conversions: "2",
                conversionsValue: "100",
              },
            },
          ],
        }),
      });

    const result = await fetchGoogleAdsApiData(
      "2024-01-01",
      "2024-01-31",
      "date,campaign",
      "refresh-token",
      "1234567890",
    );
    expect(result).toHaveLength(2);
  });

  it("throws when token refresh fails", async () => {
    jest.resetModules();
    const { fetchGoogleAdsApiData } = await import("@/lib/google-ads-api");

    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "invalid_grant: Token has been expired",
    });

    await expect(
      fetchGoogleAdsApiData("2024-01-01", "2024-01-31", "date", "expired-token", "1234567890"),
    ).rejects.toThrow("Token refresh failed");
  });
});
