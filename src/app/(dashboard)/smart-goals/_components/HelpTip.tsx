"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** The "?" help icons Smart Goals carries on its main blocks. Click rather than
 *  hover, so the text is reachable on a phone too.
 *
 *  The panel is drawn on the body at a measured, clamped position — not
 *  absolutely inside this inline span. Inline, a tip opened near the right edge
 *  of a phone ran off the screen (its fixed 18rem width had nowhere to go);
 *  measuring the trigger and pinning the panel within the viewport keeps the
 *  whole thing on screen wherever the icon happens to sit. */
export default function HelpTip({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const margin = 12;
      const width = Math.min(288, window.innerWidth - margin * 2);
      // Sit under the icon, left-aligned to it, but nudged left when that would
      // overflow the right edge.
      const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
      setPos({ top: r.bottom + 6, left, width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <span className="relative inline-flex shrink-0">
      <button
        ref={btnRef}
        type="button"
        aria-label={`Help: ${title}`}
        onClick={() => setOpen((v) => !v)}
        className="w-4 h-4 rounded-full border border-gray-300 text-gray-400 hover:text-gray-600 hover:border-gray-400 text-[10px] leading-none flex items-center justify-center transition"
      >
        ?
      </button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-60" onClick={() => setOpen(false)} />
            <div
              className="fixed z-61 bg-white border border-gray-200 rounded-xl shadow-lg p-3"
              style={{ top: pos.top, left: pos.left, width: pos.width }}
            >
              <span className="block text-[12px] font-bold text-gray-900 mb-1">{title}</span>
              <span className="block text-[12px] text-gray-600 leading-relaxed">{children}</span>
            </div>
          </>,
          document.body,
        )}
    </span>
  );
}
