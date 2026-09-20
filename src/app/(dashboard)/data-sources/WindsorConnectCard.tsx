"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { connectorSlug, type ConnectorId } from "@/lib/connectors";

type LinkAccount = { account_id: string; account_name: string };

// One-click Windsor co-user connect for a single data source. Clients authorize
// THEIR account into the central Windsor workspace and see only their own — the
// same "Authorize via Link" flow Google Ads uses, parameterised by `ds`. No API
// key to paste: the server holds the central WINDSOR_API_KEY.
export default function WindsorConnectCard({
  ds,
  connectorId,
  name,
  description,
  icon,
  tables,
  initialAccount,
  isAdmin,
  onToast,
}: {
  ds: string; // Windsor slug: googleanalytics4 / facebook / shopify
  connectorId: ConnectorId; // dashboard connector this source powers
  name: string;
  description: string;
  icon: React.ReactNode;
  tables: number;
  initialAccount: LinkAccount | null;
  isAdmin: boolean;
  onToast: (type: "success" | "error", text: string) => void;
}) {
  const [saved, setSaved] = useState<LinkAccount | null>(initialAccount);
  // The parent reads the binding from the user record asynchronously, so
  // initialAccount is null on first render and populates once loaded. Sync the
  // connected state to it — only fires when it actually changes (on load), so it
  // never clobbers a connect/disconnect the user just made.
  useEffect(() => {
    setSaved(initialAccount);
  }, [initialAccount]);
  const [connecting, setConnecting] = useState(false);
  const [accounts, setAccounts] = useState<LinkAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adminAccounts, setAdminAccounts] = useState<LinkAccount[] | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopAtRef = useRef<number>(0);

  const api = useCallback(
    (action: string, extra = "") =>
      `/api/windsor-connect?action=${action}&ds=${encodeURIComponent(ds)}${extra}`,
    [ds],
  );

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  const selectAccount = useCallback(
    async (a: LinkAccount) => {
      const r = await fetch(api("save", `&account_id=${encodeURIComponent(a.account_id)}`));
      const j = await r.json();
      if (!r.ok || j.error) {
        onToast("error", j.error || "Failed to save account");
        return;
      }
      setSaved({
        account_id: j.account?.account_id ?? a.account_id,
        account_name: j.account?.account_name ?? a.account_name,
      });
      setAccounts([]);
      onToast("success", `${name} connected`);
      // Refresh the whole app so the new source shows immediately without a manual
      // reload: the sidebar re-reads the connected sources (new platform section,
      // Smart Goals / AI Optimizer if enabled), and we land on this source's
      // dashboard. A full navigation is the reliable way to get the fresh
      // app_metadata (where the connection lives) everywhere at once. The short
      // delay lets the "connected" toast register first.
      setTimeout(() => {
        window.location.href = `/${connectorSlug(connectorId)}`;
      }, 700);
    },
    [api, name, onToast, connectorId],
  );

  const checkAccounts = useCallback(async () => {
    try {
      const r = await fetch(api("accounts"));
      const j = await r.json();
      if (j.error) {
        setError(j.error);
        return;
      }
      if (Array.isArray(j.accounts) && j.accounts.length > 0) {
        setConnecting(false);
        if (pollRef.current) clearInterval(pollRef.current);
        if (j.accounts.length === 1) await selectAccount(j.accounts[0]);
        else setAccounts(j.accounts);
      }
    } catch {
      /* keep polling */
    }
  }, [api, selectAccount]);

  const startConnect = useCallback(async () => {
    setError(null);
    setAccounts([]);
    setConnecting(true);
    try {
      const r = await fetch(api("link"));
      const j = await r.json();
      if (!r.ok || j.error || !j.url) {
        setError(j.error || "Could not start Windsor authorization.");
        setConnecting(false);
        return;
      }
      window.open(j.url, "_blank", "noopener,noreferrer,width=560,height=720");
      stopAtRef.current = Date.now() + 3 * 60 * 1000;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        if (Date.now() > stopAtRef.current) {
          if (pollRef.current) clearInterval(pollRef.current);
          setConnecting(false);
          setError(
            isAdmin
              ? "No new account detected. If it's already connected to the team, use “Show workspace accounts” below."
              : "We couldn't detect a new account. Finish authorizing in the Windsor window, then try again.",
          );
          return;
        }
        checkAccounts();
      }, 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setConnecting(false);
    }
  }, [api, checkAccounts, isAdmin]);

  const disconnect = useCallback(async () => {
    await fetch(api("disconnect"));
    setSaved(null);
    setAccounts([]);
    onToast("success", `${name} disconnected`);
  }, [api, name, onToast]);

  const loadAdminAccounts = useCallback(async () => {
    setAdminLoading(true);
    try {
      const r = await fetch(api("workspace-accounts"));
      const j = await r.json();
      if (j.error) {
        onToast("error", j.error);
        return;
      }
      setAdminAccounts(Array.isArray(j.accounts) ? j.accounts : []);
    } finally {
      setAdminLoading(false);
    }
  }, [api, onToast]);

  const adminAssign = useCallback(
    async (a: LinkAccount) => {
      const r = await fetch(api("admin-set", `&account_id=${encodeURIComponent(a.account_id)}`));
      const j = await r.json();
      if (!r.ok || j.error) {
        onToast("error", j.error || "Failed to assign");
        return;
      }
      setSaved({
        account_id: j.account?.account_id ?? a.account_id,
        account_name: j.account?.account_name ?? a.account_name,
      });
      setAdminAccounts(null);
      onToast("success", "Account assigned");
    },
    [api, onToast],
  );

  return (
    <div
      className={`bg-white rounded-2xl border shadow-sm p-5 transition ${saved ? "border-green-200" : "border-gray-100"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-gray-50 flex items-center justify-center shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-semibold text-gray-900">{name}</h3>
              {saved && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  Connected
                </span>
              )}
            </div>
            <p className="text-[12px] text-gray-400 leading-snug mt-0.5">{description}</p>
            <p className="text-[11px] text-gray-300 mt-1">{tables} tables · via Windsor</p>
          </div>
        </div>
        {!saved && accounts.length === 0 && (
          <button
            onClick={startConnect}
            disabled={connecting}
            className="inline-flex items-center gap-2 text-white text-[12px] font-semibold px-4 py-2 rounded-xl transition shrink-0 disabled:opacity-90 bg-emerald-600 hover:bg-emerald-700 shadow-sm"
          >
            {connecting ? (
              <>
                <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Waiting…
              </>
            ) : (
              "Connect"
            )}
          </button>
        )}
      </div>

      {/* Connected account */}
      {saved && (
        <div className="mt-4 pt-4 border-t border-gray-50 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-gray-900 truncate">
              {saved.account_name}
            </div>
            <div className="text-[12px] text-gray-400 tabular-nums">ID {saved.account_id}</div>
          </div>
          <button
            onClick={disconnect}
            className="text-[12px] font-medium border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-2 rounded-xl transition shrink-0"
          >
            Disconnect
          </button>
        </div>
      )}

      {/* Account picker (after authorizing several of your own) */}
      {!saved && accounts.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-50">
          <p className="text-[12px] font-semibold text-gray-600 mb-2">Select your account</p>
          <div className="space-y-2">
            {accounts.map((a) => (
              <button
                key={a.account_id}
                onClick={() => selectAccount(a)}
                className="w-full flex items-center gap-3 text-left p-3 rounded-xl border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/40 transition"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-gray-800 truncate">
                    {a.account_name}
                  </div>
                  <div className="text-[12px] text-gray-400 tabular-nums">ID {a.account_id}</div>
                </div>
                <span className="text-[12px] font-semibold text-emerald-600 shrink-0">Use this →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {connecting && (
        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[12px] text-gray-500 leading-snug">
            A Windsor window opened — approve there, then come back. We&apos;ll detect it
            automatically.
          </p>
          <button
            onClick={checkAccounts}
            className="text-[12px] font-semibold text-[#059669] hover:text-[#1247c8] transition shrink-0"
          >
            Check now
          </button>
        </div>
      )}
      {error && <p className="text-[12px] text-red-500 mt-3">{error}</p>}

      {/* Admin-only: assign any workspace account directly */}
      {isAdmin && !saved && (
        <div className="mt-4 pt-4 border-t border-gray-50">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
              Admin · assign account
            </span>
            <button
              onClick={loadAdminAccounts}
              disabled={adminLoading}
              className="text-[12px] font-semibold text-[#059669] hover:text-[#1247c8] transition disabled:opacity-50"
            >
              {adminLoading ? "Loading…" : adminAccounts ? "Refresh" : "Show workspace accounts"}
            </button>
          </div>
          {adminAccounts && (
            <div className="space-y-2 mt-3">
              {adminAccounts.length === 0 && (
                <p className="text-[12px] text-gray-400">No accounts in the workspace.</p>
              )}
              {adminAccounts.map((a) => (
                <button
                  key={a.account_id}
                  onClick={() => adminAssign(a)}
                  className="w-full flex items-center gap-3 text-left p-3 rounded-xl border border-gray-200 hover:border-purple-300 hover:bg-purple-50/40 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-gray-800 truncate">
                      {a.account_name}
                    </div>
                    <div className="text-[12px] text-gray-400 tabular-nums">ID {a.account_id}</div>
                  </div>
                  <span className="text-[12px] font-semibold text-purple-600 shrink-0">
                    Assign →
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
