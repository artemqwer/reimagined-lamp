import type { MetadataRoute } from "next";

// Like robots.ts, this exists as much to claim the path as to be read: without
// it `/sitemap.xml` falls through to the `[source]` catch-all and answers 200
// with dashboard HTML.
//
// Only the pages reachable signed out are listed. Everything else is per-tenant
// data behind a login and has nothing to index.

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.datarocks.net";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl, changeFrequency: "monthly", priority: 1 },
    { url: `${siteUrl}/login`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteUrl}/register`, changeFrequency: "monthly", priority: 0.8 },
  ];
}
