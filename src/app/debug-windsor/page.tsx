"use client";

import { notFound } from "next/navigation";

import { useState } from "react";

export default function DebugWindsor() {
  // Diagnostic surface, not a product page: it drives the live Windsor bridge
  // against the workspace key. Off in production unless deliberately enabled.
  if (process.env.NEXT_PUBLIC_ENABLE_DEBUG_ROUTES !== "true") notFound();
  const [dateFrom, setDateFrom] = useState("2026-02-01");
  const [dateTo, setDateTo] = useState("2026-05-18");
  const [groupBy, setGroupBy] = useState("campaign");
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(
        `/api/windsor?date_from=${dateFrom}&date_to=${dateTo}&group_by=${groupBy}`,
      );
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const rows = Array.isArray((data as { data?: unknown[] })?.data)
    ? (data as { data: unknown[] }).data
    : null;

  return (
    <div style={{ fontFamily: "monospace", padding: 24, fontSize: 13 }}>
      <h2 style={{ marginBottom: 16 }}>Windsor Raw Debug</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <label>
          From:&nbsp;
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ border: "1px solid #ccc", padding: "4px 8px", borderRadius: 4 }}
          />
        </label>
        <label>
          To:&nbsp;
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ border: "1px solid #ccc", padding: "4px 8px", borderRadius: 4 }}
          />
        </label>
        <label>
          group_by:&nbsp;
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            style={{ border: "1px solid #ccc", padding: "4px 8px", borderRadius: 4 }}
          >
            <option value="campaign">campaign</option>
            <option value="date,campaign">date,campaign</option>
            <option value="date">date</option>
            <option value="ad_group">ad_group</option>
            <option value="keyword">keyword</option>
            <option value="device">device</option>
          </select>
        </label>
        <button
          onClick={fetch_}
          disabled={loading}
          style={{
            background: "#2563eb",
            color: "#fff",
            border: "none",
            padding: "6px 16px",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          {loading ? "Loading…" : "Fetch"}
        </button>
      </div>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {data != null && (
        <div>
          <p style={{ marginBottom: 8, color: "#555" }}>
            source: <b>{(data as { source?: string }).source}</b> &nbsp;|&nbsp; rows:{" "}
            <b>{rows?.length ?? "—"}</b>
          </p>

          {rows && rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    {Object.keys(rows[0] as object).map((k) => (
                      <th
                        key={k}
                        style={{
                          border: "1px solid #ddd",
                          padding: "4px 8px",
                          background: "#f9fafb",
                          textAlign: "left",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                      {Object.values(row as object).map((v, j) => (
                        <td
                          key={j}
                          style={{
                            border: "1px solid #ddd",
                            padding: "4px 8px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {typeof v === "number"
                            ? v.toLocaleString("en-US", { maximumFractionDigits: 2 })
                            : String(v ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {rows && rows.length === 0 && (
            <p style={{ color: "#888" }}>
              ⚠️ Empty — Windsor returned no rows for this range/group_by
            </p>
          )}
        </div>
      )}
    </div>
  );
}
