import type { MetadataRoute } from "next";

// Without this file `/robots.txt` falls through to the `[source]` catch-all and
// crawlers get a 200 with dashboard HTML in it. A real robots.txt also matters
// for the share card: Slack, X and LinkedIn all check it before unfurling, so
// the public entry points have to stay crawlable even though the app does not.

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://metricforge.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/login", "/register", "/reset-password"],
      // Everything behind the login is per-tenant data — nothing to index, and
      // no reason to hand crawlers a map of the API surface.
      disallow: [
        "/api/",
        "/admin",
        "/profile",
        "/invites",
        "/data-sources",
        "/auth/",
        "/connect-preview",
        "/debug-windsor",
      ],
    },
    host: siteUrl,
  };
}
