"use client";

import React, { useState } from "react";
import PerformanceTable from "./PerformanceTable";

type Timeframe = "hour" | "day_of_week" | "date" | "week" | "month" | "quarter" | "year";

const OPTIONS: { value: Timeframe; label: string }[] = [
  { value: "hour", label: "Hours" },
  { value: "day_of_week", label: "Days" },
  { value: "date", label: "Dates" },
  { value: "week", label: "Weeks" },
  { value: "month", label: "Months" },
  { value: "quarter", label: "Quarters" },
  { value: "year", label: "Years" },
];

interface Props {
  dateFrom: string;
  dateTo: string;
  rangeLabel: string;
  isVisible: boolean;
}

export default function TimePerformanceTable({ dateFrom, dateTo, rangeLabel, isVisible }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>("day_of_week");
  const active = OPTIONS.find((o) => o.value === timeframe)!;

  return (
    <div className="relative">
      <PerformanceTable
        key={timeframe}
        title="Time Performance"
        dimensionLabel={active.label.replace(/s$/, "")}
        dimensionKey={timeframe}
        dateFrom={dateFrom}
        dateTo={dateTo}
        rangeLabel={rangeLabel}
        isVisible={isVisible}
        headerRight={
          <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg p-0.5 overflow-x-auto scrollbar-none">
            <span className="text-[11px] text-gray-400 px-2 hidden lg:inline whitespace-nowrap shrink-0">
              Time by:
            </span>
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setTimeframe(o.value)}
                className={`px-2 py-0.5 text-[11px] sm:text-[12px] rounded-md transition whitespace-nowrap shrink-0 ${
                  timeframe === o.value
                    ? "bg-white border border-gray-200 shadow-sm text-emerald-600 font-semibold"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        }
      />
    </div>
  );
}
