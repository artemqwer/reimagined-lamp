// Data-source routing for the dashboard.
//
// There is one source: Windsor.ai. The dashboard calls /api/windsor and
// /api/data; the server resolves the caller's connected account and reads from
// Windsor.
//
// This file used to also resolve an internal BigQuery mirror of a Google Ads
// sync. That path was removed — see docs/bigquery-disabled.md. It had never run
// successfully (its destination table was never created), and no UI reached
// either the Google Ads OAuth flow or the sync endpoint that fed it.

// Client fetch base paths.
export function rowsApiBase(): string {
  return "/api/windsor";
}
export function dimApiBase(): string {
  return "/api/data";
}
