"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCrossFilter } from "@/lib/store";
import { createClient } from "@/lib/supabase";
import {
  CONNECTORS,
  CONNECTOR_IDS,
  connectedConnectorsFrom,
  connectorSlug,
  type ConnectorId,
} from "@/lib/connectors";
import ConnectorBrandIcon from "@/components/ConnectorBrandIcon";

// Brand logo box for a connector — each source's official mark (Google Ads keeps
// its PNG; the rest use the shared brand SVGs).
function ConnectorLogo({ id, size = 40 }: { id: ConnectorId; size?: number }) {
  const box = `rounded-xl bg-white border border-gray-100 shadow-sm flex items-center justify-center shrink-0 overflow-hidden`;
  return (
    <div className={box} style={{ width: size, height: size }}>
      {id === "google_ads" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/google-ads.png"
          alt="Google Ads"
          className="object-contain"
          style={{ width: size * 0.6, height: size * 0.6 }}
        />
      ) : (
        <ConnectorBrandIcon id={id} size={size * 0.6} />
      )}
    </div>
  );
}

// The dashboard header title doubles as the data-source switcher: click it to
// pick which connected system (Google Ads / Meta / GA4 / Shopify) to view.
export default function ConnectorSwitcher({ compact = false }: { compact?: boolean }) {
  const activeConnector = useCrossFilter((s) => s.activeConnector);
  const setActiveConnector = useCrossFilter((s) => s.setActiveConnector);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const active = CONNECTORS[activeConnector];
  // Only offer the sources the user has connected (same as the sidebar). The
  // active one is always included so the current view is never missing.
  const [connected, setConnected] = useState<ConnectorId[]>([activeConnector]);
  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => setConnected(connectedConnectorsFrom(user)));
  }, []);
  const options = CONNECTOR_IDS.filter((id) => connected.includes(id) || id === activeConnector);
  // Picking a source here used to set the store and stay put, so the header
  // said one platform while the URL and the page said another. Each dashboard
  // has its own address; go to it.
  const pick = (id: ConnectorId) => {
    setActiveConnector(id);
    setOpen(false);
    router.push(`/${connectorSlug(id)}`);
  };
  // Nothing to switch between: the chevron would open a menu with one item in
  // it, already ticked.
  const only = options.length < 2;

  return (
    <div className="relative">
      <button
        onClick={() => !only && setOpen((v) => !v)}
        aria-disabled={only}
        className={`flex items-center group cursor-pointer text-left rounded-xl hover:bg-gray-50/70 transition -m-1 p-1 pr-2.5 ${
          compact ? "gap-2" : "gap-3"
        }`}
      >
        <ConnectorLogo id={activeConnector} size={compact ? 32 : 40} />
        <div>
          <h1
            className={`font-bold text-[#101828] leading-tight flex items-center gap-1.5 ${
              compact ? "text-[15px]" : "text-[18px]"
            }`}
          >
            {active.label}
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className={`text-gray-400 group-hover:text-gray-600 transition-transform ${open ? "rotate-180" : ""} ${only ? "hidden" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </h1>
          {/* The phone bar has one line's worth of room, and the source's
              name is the part that has to be there. */}
          {!compact && <p className="text-[14px] text-[#6a7282]">Performance Analytics</p>}
        </div>
      </button>

      {open && !only && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-2 w-[260px] bg-white border border-gray-200 rounded-2xl shadow-xl z-50 py-1.5 overflow-hidden">
            <p className="px-3 pt-1.5 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              Data source
            </p>
            {options.map((id) => {
              const c = CONNECTORS[id];
              const isActive = id === activeConnector;
              return (
                <button
                  key={id}
                  onClick={() => pick(id)}
                  className={`w-full text-left px-2.5 py-2 flex items-center gap-2.5 hover:bg-gray-50 transition ${isActive ? "bg-emerald-50/50" : ""}`}
                >
                  <ConnectorLogo id={id} size={30} />
                  <span
                    className={`flex-1 text-[13px] ${isActive ? "font-semibold text-gray-900" : "text-gray-700"}`}
                  >
                    {c.label}
                  </span>
                  {isActive && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      className="text-emerald-600 mr-1.5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
