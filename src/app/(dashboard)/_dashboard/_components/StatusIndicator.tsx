import React from "react";

// One status glyph across every table (dashboard + AI Optimizer), so a state
// always reads the same:
//   Active         → green dot
//   Paused/unknown → grey dot   (paused used to be yellow, which read ambiguously)
//   Removed        → red ✕      (a cross, unmistakably "gone", not just a colour)
//
// `status` is the StatusColor the tables already carry (campaignStatusColor):
// green = active, yellow = paused, red = removed, gray = not reported.

const TITLES: Record<string, string> = {
  green: "Active",
  yellow: "Paused",
  red: "Removed",
  gray: "Status not reported",
};

export function StatusIndicator({
  status,
  title,
  className = "",
}: {
  status: string;
  title?: string;
  className?: string;
}) {
  const label = title ?? TITLES[status] ?? "Status not reported";
  if (status === "red") {
    return (
      <span
        title={label}
        aria-label={label}
        className={`inline-flex items-center justify-center text-red-500 shrink-0 ${className}`}
      >
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
        >
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </span>
    );
  }
  const bg = status === "green" ? "bg-green-500" : "bg-gray-300";
  return (
    <span
      title={label}
      aria-label={label}
      className={`w-2 h-2 rounded-full inline-block shrink-0 ${bg} ${className}`}
    />
  );
}
