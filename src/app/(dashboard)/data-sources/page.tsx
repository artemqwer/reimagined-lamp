"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import {
  CONNECTORS,
  setCustomConnectors,
  getCustomConnectorIds,
  type ConnectorId,
  type CustomConnectorRow,
} from "@/lib/connectors";
import WindsorConnectCard from "./WindsorConnectCard";
import ConnectorBrandIcon from "@/components/ConnectorBrandIcon";
import { isPlatformAdmin } from "@/lib/authz";

// Connectors served through the Windsor test path (native API sync ships later).
// Icons come from the shared ConnectorBrandIcon so every surface shows the same,
// current official logo.
const WINDSOR_CONNECTORS: {
  id: ConnectorId;
  name: string;
  description: string;
}[] = [
  {
    id: "meta_ads",
    name: "Meta Ads",
    description: "Facebook & Instagram advertising performance",
  },
  {
    id: "ga4",
    name: "Google Analytics 4",
    description: "Website traffic, engagement & conversions",
  },
  {
    id: "shopify",
    name: "Shopify",
    description: "E-commerce sales, products & orders",
  },
  {
    id: "google_ads",
    name: "Google Ads",
    description: "One-click connect — no setup, no API token. You'll only see your own account.",
  },
];

const comingSoon = [
  {
    id: "tiktok-ads",
    name: "TikTok Ads",
    description: "Track and optimize your TikTok advertising campaigns",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="#9CA3AF">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z" />
      </svg>
    ),
  },
  {
    id: "linkedin-ads",
    name: "LinkedIn Ads",
    description: "Monitor your LinkedIn B2B advertising campaigns",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="#9CA3AF">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  {
    id: "microsoft-ads",
    name: "Microsoft Ads",
    description: "Connect Bing Ads and expand your reach",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="1" y="1" width="10" height="10" fill="#9CA3AF" />
        <rect x="13" y="1" width="10" height="10" fill="#9CA3AF" opacity=".8" />
        <rect x="1" y="13" width="10" height="10" fill="#9CA3AF" opacity=".6" />
        <rect x="13" y="13" width="10" height="10" fill="#9CA3AF" opacity=".4" />
      </svg>
    ),
  },
];

export default function DataSourcesPage() {
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // The Google Ads co-user account bound via the legacy windsor_account_id field
  // (older connections); newer per-source bindings live in windsorAccounts below.
  const [savedAccount, setSavedAccount] = useState<{ id: string; name: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // Per-source co-user bindings (all connectors), keyed by Windsor ds slug.
  const [windsorAccounts, setWindsorAccounts] = useState<
    Record<string, { account_id: string; account_name: string }>
  >({});
  // Admin-added data sources (see connectors.ts) — connectable through the same
  // Windsor co-user flow as the built-in "More sources" below.
  const [customIds, setCustomIds] = useState<ConnectorId[]>([]);

  useEffect(() => {
    fetch("/api/admin/custom-connectors")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { connectors?: CustomConnectorRow[] } | null) => {
        // Same as the layout: don't let a failed request empty the registry.
        if (Array.isArray(j?.connectors)) setCustomConnectors(j.connectors);
        setCustomIds(getCustomConnectorIds());
      })
      .catch(() => {});
  }, []);

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      // Connected account lives in app_metadata only (server-validated, tamper-proof).
      const accId = user?.app_metadata?.windsor_account_id as string | undefined;
      const accName = user?.app_metadata?.windsor_account_name as string | undefined;
      if (accId) setSavedAccount({ id: accId, name: accName ?? accId });
      setWindsorAccounts(
        (user?.app_metadata?.windsor_accounts ?? {}) as Record<
          string,
          { account_id: string; account_name: string }
        >,
      );
      setIsAdmin(isPlatformAdmin(user));
    });
  }, []);

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-500 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-[13px] font-medium transition-all ${
            toast.type === "success"
              ? "bg-green-50 border border-green-200 text-green-700"
              : "bg-red-50 border border-red-200 text-red-700"
          }`}
        >
          {toast.type === "success" ? (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          )}
          {toast.text}
        </div>
      )}

      <h1 className="text-[22px] font-bold text-gray-900 mb-1">Data Sources</h1>
      <p className="text-[13px] text-gray-500 mb-8">
        Connect your advertising platforms to start tracking performance
      </p>

      {/* More sources via Windsor — Meta / GA4 / Shopify / Google Ads, all through
          the same one-click co-user flow. Connecting authorizes the client's own
          account into the central Windsor workspace; the dashboard then rebuilds. */}
      <div className="mb-8">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">
          More sources
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {WINDSOR_CONNECTORS.map((wc) => {
            const c = CONNECTORS[wc.id];
            const ds = c.windsorSource;
            // Google Ads may still be bound via the legacy single-account field.
            const initial =
              windsorAccounts[ds] ??
              (wc.id === "google_ads" && savedAccount
                ? { account_id: savedAccount.id, account_name: savedAccount.name }
                : null);
            return (
              <WindsorConnectCard
                key={wc.id}
                ds={ds}
                connectorId={wc.id}
                name={wc.name}
                description={wc.description}
                icon={<ConnectorBrandIcon id={wc.id} size={22} />}
                tables={c.dimensions.length}
                initialAccount={initial}
                isAdmin={isAdmin}
                onToast={showToast}
              />
            );
          })}
          {customIds.map((id) => {
            const c = CONNECTORS[id];
            const ds = c.windsorSource;
            return (
              <WindsorConnectCard
                key={id}
                ds={ds}
                connectorId={id}
                name={c.label}
                description="Custom data source — added from the Admin Panel"
                icon={<ConnectorBrandIcon id={id} size={22} />}
                tables={c.dimensions.length}
                initialAccount={windsorAccounts[ds] ?? null}
                isAdmin={isAdmin}
                onToast={showToast}
              />
            );
          })}
        </div>
      </div>

      {/* Coming Soon */}
      <div>
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">
          Coming Soon
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {comingSoon.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 opacity-60"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center shrink-0">
                    {c.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-gray-500">{c.name}</h3>
                      <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full uppercase tracking-wide">
                        Coming soon
                      </span>
                    </div>
                    <p className="text-[12px] text-gray-400 leading-snug mt-0.5">{c.description}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
