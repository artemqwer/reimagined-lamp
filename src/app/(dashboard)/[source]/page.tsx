"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCrossFilter } from "@/lib/store";
import { DEFAULT_CONNECTOR, connectorFromSlug, connectorSlug } from "@/lib/connectors";
import DashboardView from "../_dashboard/DashboardView";

// One dashboard route per data source: /google-ads, /ga4, /searchconsole …
// The dashboard used to live at the single /google-ads path with the source
// held only in localStorage, so a link couldn't point at a source and a reload
// dropped you back on Google Ads.
//
// Resolved on the client, against the same live registry the rest of the
// dashboard reads — which is also how an admin-added source becomes routable
// without a code change.
export default function SourceDashboardPage({ params }: { params: Promise<{ source: string }> }) {
  const { source } = use(params);
  const router = useRouter();
  const activeConnector = useCrossFilter((s) => s.activeConnector);
  const setActiveConnector = useCrossFilter((s) => s.setActiveConnector);
  // Admin-added sources reach the registry asynchronously (see the layout), so
  // an unknown slug isn't necessarily wrong yet — it may just be early. Wait
  // for that load before deciding, or /searchconsole would bounce to the
  // default source on every visit.
  const connectorsVersion = useCrossFilter((s) => s.connectorsVersion);
  const connector = connectorFromSlug(source);

  useEffect(() => {
    // Only on a real change: switching source deliberately clears the active
    // filters, so calling this on every mount would wipe them.
    if (connector) {
      if (connector !== activeConnector) setActiveConnector(connector);
    }
    // A slug naming no source — a typo, or a link to a source since removed —
    // lands on the default dashboard rather than a dead page.
    else if (connectorsVersion > 0) router.replace(`/${connectorSlug(DEFAULT_CONNECTOR)}`);
  }, [connector, activeConnector, connectorsVersion, router, setActiveConnector]);

  if (!connector) return null;
  return <DashboardView />;
}
