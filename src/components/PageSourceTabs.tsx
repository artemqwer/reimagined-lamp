"use client";

import React, { useEffect, useState } from "react";
import { useCrossFilter } from "@/lib/store";
import { createClient } from "@/lib/supabase";
import {
  CONNECTORS,
  connectedConnectorsFrom,
  connectorHasFeature,
  type ConnectorId,
} from "@/lib/connectors";
import ConnectorBrandIcon from "@/components/ConnectorBrandIcon";

/**
 * The header Smart Goals and the optimizer open with: what section you are in,
 * then which platform you are looking at.
 *
 * These are sections in their own right, not a view of a dashboard, and the
 * page used to open with the source's mark — so it read as "Google Ads" with
 * some goals attached rather than "Smart Goals, currently showing Google Ads".
 * Naming the section and putting the platforms under it as tabs makes the two
 * levels of navigation visible, which is what they are.
 *
 * Only platforms where an admin left this section on appear. If the active one
 * isn't among them, the first that is opens instead — arriving here should
 * always land somewhere, never on an empty page.
 */
export default function PageSourceTabs({
  title,
  feature,
  actions,
  children,
}: {
  title: string;
  feature: "smartGoals" | "optimizer";
  /** The page's own controls — its period picker, its primary action. They sit
   *  on the title line, outside the card. */
  actions?: React.ReactNode;
  /** What the card holds under the tabs. Passing the section's first block
   *  here is what makes the tabs and that block read as one thing. */
  children?: React.ReactNode;
}) {
  const activeConnector = useCrossFilter((s) => s.activeConnector);
  const setActiveConnector = useCrossFilter((s) => s.setActiveConnector);
  const connectorConfigs = useCrossFilter((s) => s.connectorConfigs);
  const connectorsVersion = useCrossFilter((s) => s.connectorsVersion);
  const [connected, setConnected] = useState<ConnectorId[]>([activeConnector]);

  useEffect(() => {
    // Viewing as a client: show THEIR connected sources (stashed by the admin
    // page), not the admin's — getUser() only ever returns the admin. Mirrors the
    // sidebar's platform list.
    if (typeof window !== "undefined") {
      const raw = sessionStorage.getItem("dr_view_as_connectors");
      if (sessionStorage.getItem("dr_view_as") && raw) {
        try {
          const ids = JSON.parse(raw) as ConnectorId[];
          if (Array.isArray(ids) && ids.length) {
            setConnected(ids);
            return;
          }
        } catch {
          /* fall through to the admin's own sources */
        }
      }
    }
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => setConnected(connectedConnectorsFrom(user)));
  }, [connectorsVersion]);

  const tabs = connected.filter((id) => connectorHasFeature(feature, connectorConfigs[id]));

  // Land somewhere real: if this section is off for whatever source the rest of
  // the app is showing, move to one it is on for.
  useEffect(() => {
    if (tabs.length && !tabs.includes(activeConnector)) setActiveConnector(tabs[0]);
  }, [tabs, activeConnector, setActiveConnector]);

  return (
    <>
      {/* The section's name and its controls sit on the page itself, above the
          card — the card is the section's content, and wrapping the title in
          one made the header read as a separate panel from what follows. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-3 px-1 empty:mb-0">
        {/* Hidden on a phone: the top bar already names the section there, so
            the page heading would just repeat it. Kept from sm up. */}
        <h1 className="hidden sm:block text-[22px] sm:text-[26px] font-bold text-[#101828] leading-tight">
          {title}
        </h1>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 px-4 sm:px-5 pt-1 pb-4 sm:pb-5 mb-4">
        {tabs.length === 0 ? (
          <p className="text-[13px] text-gray-500 py-3">
            No connected platform has {title} switched on. An admin can enable it under Data source
            configuration.
          </p>
        ) : (
          tabs.length > 1 && (
            // One platform and there is nothing to choose between — the tab row
            // would be a control that does nothing.
            //
            // Scrolls sideways only. overflow-y-hidden matters: with overflow-x
            // set to auto, CSS computes overflow-y to auto as well, which let the
            // strip be dragged VERTICALLY a few pixels on a phone — the bug.
            <div className="flex gap-1 overflow-x-auto overflow-y-hidden scrollbar-none border-b border-gray-100 mb-4">
              {tabs.map((id) => {
                const on = id === activeConnector;
                return (
                  <button
                    key={id}
                    onClick={() => setActiveConnector(id)}
                    className={`flex items-center gap-2 text-[13.5px] font-medium px-3 py-2.5 -mb-px border-b-2 whitespace-nowrap transition ${
                      on
                        ? "border-[#047857] text-[#047857]"
                        : "border-transparent text-[#6a7282] hover:text-[#364153]"
                    }`}
                  >
                    <ConnectorBrandIcon id={id} size={15} />
                    {CONNECTORS[id]?.label ?? id}
                  </button>
                );
              })}
            </div>
          )
        )}
        {children}
      </div>
    </>
  );
}
