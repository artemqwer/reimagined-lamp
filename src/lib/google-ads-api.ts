import type { WindsorDataRow } from "./windsor";

// Google Ads API version.
//
// Google sunsets these on a rolling schedule — roughly four releases a year,
// each supported for about a year — and a sunset version stops being served
// entirely: the host answers an HTML 404 page rather than a JSON error, which
// is not obviously a version problem when you read it in a log. This was
// pinned to v18 long after v18 died, so every call through this module failed
// and connecting a Google Ads account could not work at all.
//
// To check what is live: request any version path and see which answer. A live
// version returns JSON (a real error is still JSON); a sunset one returns HTML.
export const GADS_API_VERSION = "v25";

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const { access_token } = await res.json();
  return access_token as string;
}

export function isGoogleAdsApiConfigured(): boolean {
  return !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
}

/**
 * Turns a Google Ads API failure into a sentence that names the actual cause.
 *
 * The two failures that matter here are indistinguishable if you only look at
 * the status code, and the fix for each is somewhere different: a sunset API
 * version is fixed in this file, an unapproved developer token is fixed in a
 * Google Ads account by applying for access. Reporting the second when it was
 * the first sent us looking in the wrong place for a long time.
 */
export function describeGoogleAdsError(status: number, body: string): string {
  if (body.includes("<!DOCTYPE") || body.includes("<html")) {
    return `Google Ads API ${GADS_API_VERSION} is no longer served (HTTP ${status}). It has been sunset — bump GADS_API_VERSION in lib/google-ads-api.ts to a current version.`;
  }
  if (body.includes("DEVELOPER_TOKEN_NOT_APPROVED")) {
    return "This developer token is approved for test accounts only, so it cannot read real ad accounts. Apply for Basic Access in Google Ads → Tools → API Center.";
  }
  return `HTTP ${status}: ${body.slice(0, 500)}`;
}

export async function getGoogleAdsCustomerId(accessToken: string): Promise<string> {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!devToken) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN not set");

  const res = await fetch(
    `https://googleads.googleapis.com/${GADS_API_VERSION}/customers:listAccessibleCustomers`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": devToken,
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Failed to list Google Ads customers: ${describeGoogleAdsError(res.status, body)}`,
    );
  }
  const data = await res.json();
  const resourceNames: string[] = data.resourceNames ?? [];
  if (!resourceNames.length) throw new Error("No accessible Google Ads accounts found");
  return resourceNames[0].replace("customers/", "");
}

export async function fetchGoogleAdsApiData(
  dateFrom: string,
  dateTo: string,
  groupBy: "date" | "campaign" | "date,campaign",
  refreshToken: string,
  customerId: string,
): Promise<WindsorDataRow[]> {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN!;
  const customerIdClean = customerId.replace(/-/g, "");
  const managerId = process.env.GOOGLE_ADS_MANAGER_ID?.replace(/-/g, "");

  const accessToken = await refreshAccessToken(refreshToken);

  const selectDate = groupBy.includes("date") ? "segments.date," : "";
  const selectCampaign = groupBy.includes("campaign") ? "campaign.name," : "";

  const query = `
    SELECT
      ${selectDate}
      ${selectCampaign}
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
      AND campaign.status != 'REMOVED'
    ORDER BY ${groupBy.includes("date") ? "segments.date" : "campaign.name"}
  `.trim();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": devToken,
    "Content-Type": "application/json",
  };
  if (managerId) headers["login-customer-id"] = managerId;

  const results: Record<string, unknown>[] = [];
  let pageToken: string | undefined;

  do {
    const body: Record<string, unknown> = { query };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(
      `https://googleads.googleapis.com/${GADS_API_VERSION}/customers/${customerIdClean}/googleAds:search`,
      { method: "POST", headers, body: JSON.stringify(body) },
    );

    if (!res.ok) {
      throw new Error(`Google Ads API: ${describeGoogleAdsError(res.status, await res.text())}`);
    }

    const data = await res.json();
    if (data.results) results.push(...data.results);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return results.map((r: Record<string, unknown>) => {
    const seg = r.segments as Record<string, unknown> | undefined;
    const campaign = r.campaign as Record<string, unknown> | undefined;
    const metrics = r.metrics as Record<string, unknown> | undefined;
    return {
      date: seg?.date as string | undefined,
      campaign: campaign?.name as string | undefined,
      impressions: Number(metrics?.impressions ?? 0),
      clicks: Number(metrics?.clicks ?? 0),
      spend: Number(metrics?.costMicros ?? 0) / 1_000_000,
      conversions: Number(metrics?.conversions ?? 0),
      conversion_value: Number(metrics?.conversionsValue ?? 0),
    };
  });
}
