"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the real error in the console so it can be diagnosed.
    console.error("Dashboard render error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f9fafb] p-6">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 max-w-lg w-full text-center">
        <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#EF4444"
            strokeWidth="2"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h2 className="text-[18px] font-bold text-gray-900 mb-2">Something went wrong</h2>
        <p className="text-[13px] text-gray-500 mb-3">This page hit an error while rendering.</p>
        <pre className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3 mb-5 text-left overflow-auto max-h-40 whitespace-pre-wrap break-words">
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>
        <button
          onClick={reset}
          className="bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold px-5 py-2 rounded-xl transition"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
