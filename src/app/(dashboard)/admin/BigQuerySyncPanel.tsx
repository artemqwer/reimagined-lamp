"use client";

import { useState } from "react";

// Admin control for the BigQuery cache. "Test connection" runs the read-only
// self-test (proves auth + table + read access, no writes); "Run sync now"
// triggers a full prewarm (real writes) for every connected account. Both hit
// /api/bq/sync, which authorises the logged-in platform admin — no secret needed.
type Result = {
  ok?: boolean;
  configured?: boolean;
  note?: string;
  error?: string;
  accounts?: number;
  synced?: number;
  errors?: number;
  firstError?: string;
  skipped?: boolean;
};

export default function BigQuerySyncPanel({
  showToast,
}: {
  showToast: (t: "success" | "error", s: string) => void;
}) {
  const [busy, setBusy] = useState<null | "test" | "sync">(null);
  const [result, setResult] = useState<Result | null>(null);

  const run = async (mode: "test" | "sync") => {
    setBusy(mode);
    setResult(null);
    try {
      const res = await fetch(mode === "test" ? "/api/bq/sync?selftest=1" : "/api/bq/sync");
      const data: Result = await res
        .json()
        .catch(() => ({ error: `HTTP ${res.status}` }) as Result);
      setResult(data);
      const good = mode === "test" ? data.ok === true : data.ok === true && !data.errors;
      if (good)
        showToast(
          "success",
          mode === "test"
            ? "BigQuery reachable"
            : data.skipped
              ? "BigQuery is disabled"
              : `Synced ${data.synced ?? 0} · ${data.errors ?? 0} errors`,
        );
      else showToast("error", data.error || data.firstError || data.note || "BigQuery not ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ error: msg });
      showToast("error", msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-[14px] font-bold text-gray-800">BigQuery cache</h3>
          <p className="text-[12.5px] text-gray-500 mt-1 max-w-xl">
            The dashboard reads from a BigQuery store instead of pulling Windsor live.{" "}
            <span className="font-medium">Test connection</span> is a read-only check;{" "}
            <span className="font-medium">Run sync now</span> pulls every connected account into
            BigQuery.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => run("test")}
            disabled={busy !== null}
            className="px-3.5 py-2 rounded-lg text-[13px] font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === "test" ? "Testing…" : "Test connection"}
          </button>
          <button
            onClick={() => run("sync")}
            disabled={busy !== null}
            className="px-3.5 py-2 rounded-lg text-[13px] font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy === "sync" ? "Syncing…" : "Run sync now"}
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-4">
          <div
            className={`text-[13px] font-medium ${result.ok && !result.errors ? "text-green-700" : "text-red-600"}`}
          >
            {result.error
              ? `Error: ${result.error}`
              : result.firstError
                ? `Error: ${result.firstError}`
                : result.skipped
                  ? "BigQuery is disabled (BQ_ENABLED not set)"
                  : result.note
                    ? result.note
                    : result.synced != null
                      ? `Accounts: ${result.accounts} · Synced: ${result.synced} · Errors: ${result.errors}`
                      : "Done"}
          </div>
          <pre className="mt-2 text-[11.5px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-x-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
