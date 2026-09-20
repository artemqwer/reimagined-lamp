"use client";

import React from "react";
import ConnectorSwitcher from "@/app/(dashboard)/_dashboard/_components/ConnectorSwitcher";

/**
 * The bar every source-scoped page opens with: the source's own mark and name,
 * which is also how you switch source.
 *
 * It is the dashboard's ConnectorSwitcher, not a copy of it — the spec draws
 * the same header on Smart Goals and the optimizer, and two switchers that
 * merely look alike would be two things to keep in step. Whatever the charts
 * do when a source is picked, these pages now do too.
 *
 * `children` sit at the right end: the controls that belong to this particular
 * page (its period picker, its primary action).
 */
export default function SourceHeader({ children }: { children?: React.ReactNode }) {
  return (
    // On a phone the source already names itself in the app's top bar, the
    // same way it does on a dashboard, so this whole bar goes away when it has
    // nothing else to carry — two headers, one saying METRICFORGE and one
    // saying Google Ads, was the thing to fix.
    <div
      className={`bg-white/80 border border-gray-200/70 rounded-2xl px-4 sm:px-5 py-3 mb-4 ${
        children ? "" : "hidden sm:block"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="hidden sm:flex">
          <ConnectorSwitcher />
        </div>
        {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
      </div>
    </div>
  );
}
