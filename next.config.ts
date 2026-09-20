import type { NextConfig } from "next";

// Response headers the app was serving none of. Vercel adds HSTS on its own
// domains but not the strengthened form below, and nothing else was set — the
// dashboard could be framed by any origin, and every response advertised
// `Access-Control-Allow-Origin: *`.
//
// No full Content-Security-Policy yet: Next inlines bootstrap scripts, so a
// script-src policy needs per-request nonces and middleware to thread them
// through. `frame-ancestors` is the part that can be set safely today, and it
// is the one X-Frame-Options only approximates.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing in the dashboard asks for these; denying them up front means a
  // dependency can't start asking quietly.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=()",
  },
  // Two years, subdomains included, and eligible for the preload list — the
  // custom domain was getting a bare max-age.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Vercel serves prerendered pages and /_next/static assets with
  // `Access-Control-Allow-Origin: *` of its own accord — the API block below
  // overrode it for /api, but every HTML document still advertised the
  // wildcard. Nothing here is meant to be read cross-origin, so deny it
  // everywhere rather than only on the API.
  //
  // This does not affect the app's own asset loads: CORS is not consulted for
  // same-origin requests, and the app never fetches itself from another origin.
  { key: "Access-Control-Allow-Origin", value: "null" },
];

const nextConfig: NextConfig = {
  // Pin the workspace root. Without a .git marker (this is a standalone clone),
  // Turbopack otherwise infers the root by walking up the tree and can land
  // outside the project, failing to resolve `next`. __dirname keeps it here.
  turbopack: { root: __dirname },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The API is same-origin only. Without this the wildcard CORS header on
      // these responses lets any site read them with the caller's cookies.
      // Access-Control-Allow-Origin is set for every path above, so it is not
      // repeated here — listing it twice makes Next emit the header twice.
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
