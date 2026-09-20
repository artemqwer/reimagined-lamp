"use client";

import Link from "next/link";
import { notFound } from "next/navigation";

// ─────────────────────────────────────────────────────────────────────────────
// STANDALONE PREVIEW PAGE — not linked anywhere in the app navigation.
// Open directly at /connect-preview.
//
// This wires the REAL Windsor "Authorize via Link" (co-user) flow so you can
// actually connect a Google Ads account to our Windsor workspace, in-platform:
//   1. Paste a Windsor API key (workspace/team key) — used server-side only,
//      never stored on our side (kept in your browser's localStorage for convenience).
//      Or set WINDSOR_API_KEY in env and leave the field blank.
//   2. Click Connect → we generate a co-user authorization URL and open it.
//   3. You approve Google Ads access in the Windsor window.
//   4. We poll the linked accounts and show the connected account_id / name.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState } from "react";

type Status = "idle" | "connecting" | "connected";
type Account = { account_id: string; account_name: string };

export default function ConnectPreviewPage() {
  // Diagnostic surface, not a product page: it drives the live Windsor bridge
  // against the workspace key. Off in production unless deliberately enabled.
  if (process.env.NEXT_PUBLIC_ENABLE_DEBUG_ROUTES !== "true") notFound();
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopAtRef = useRef<number>(0);

  // Restore a previously pasted key for convenience.
  useEffect(() => {
    const saved = localStorage.getItem("windsor_preview_key");
    if (saved) setApiKey(saved);
  }, []);
  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  const keyParam = () => (apiKey.trim() ? `&key=${encodeURIComponent(apiKey.trim())}` : "");

  const checkAccounts = async (): Promise<boolean> => {
    try {
      const r = await fetch(`/api/windsor-connect?action=accounts${keyParam()}`);
      const j = await r.json();
      if (j.error) {
        setError(j.error);
        return false;
      }
      if (Array.isArray(j.accounts) && j.accounts.length > 0) {
        setAccounts(j.accounts);
        setStatus("connected");
        setNote(null);
        if (pollRef.current) clearInterval(pollRef.current);
        return true;
      }
    } catch {
      /* keep polling */
    }
    return false;
  };

  const connect = async () => {
    setError(null);
    setNote(null);
    if (apiKey.trim()) localStorage.setItem("windsor_preview_key", apiKey.trim());
    setStatus("connecting");
    try {
      const r = await fetch(`/api/windsor-connect?action=link${keyParam()}`);
      const j = await r.json();
      if (!r.ok || j.error || !j.url) {
        setError(j.error || "Could not start the Windsor authorization.");
        setStatus("idle");
        return;
      }
      // Open Windsor's authorization window — user approves Google Ads there.
      window.open(j.url, "_blank", "noopener,noreferrer,width=560,height=720");
      setNote(
        "A Windsor window opened. Approve Google Ads there, then come back — we'll detect it automatically.",
      );
      // Poll linked accounts for up to ~3 minutes.
      stopAtRef.current = Date.now() + 3 * 60 * 1000;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        if (Date.now() > stopAtRef.current) {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus((s) => (s === "connecting" ? "idle" : s));
          setNote(null);
          return;
        }
        checkAccounts();
      }, 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setStatus("idle");
    }
  };

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setStatus("idle");
    setAccounts([]);
    setError(null);
    setNote(null);
  };

  return (
    <div className="min-h-screen w-full bg-[#f9fafb] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md flex items-center justify-end gap-4 mb-3">
        <Link
          href="/login"
          className="text-[13px] font-semibold text-[#059669] hover:text-[#1247c8] transition"
        >
          Log in →
        </Link>
      </div>

      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="px-7 pt-7 pb-5 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-white border border-gray-200 flex items-center justify-center shrink-0">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <circle cx="7" cy="17" r="3.2" fill="#34A853" />
                  <rect
                    x="9.2"
                    y="2.6"
                    width="6.4"
                    height="15"
                    rx="3.2"
                    transform="rotate(30 9.2 2.6)"
                    fill="#FBBC04"
                  />
                  <rect
                    x="13.6"
                    y="4.2"
                    width="6.4"
                    height="15"
                    rx="3.2"
                    transform="rotate(30 13.6 4.2)"
                    fill="#4285F4"
                  />
                </svg>
              </div>
              <div className="min-w-0">
                <h1 className="text-[18px] font-bold text-gray-900 leading-tight">
                  Connect your Google Ads
                </h1>
                <p className="text-[13px] text-gray-500 mt-0.5">
                  Link your account in a few seconds
                </p>
              </div>
            </div>
          </div>

          <div className="px-7 py-6">
            {status === "connected" ? (
              /* ── Connected ── */
              <div className="animate-in fade-in duration-300 space-y-2.5">
                {accounts.map((a) => (
                  <div
                    key={a.account_id}
                    className="flex items-center gap-3 p-3.5 rounded-2xl border border-green-200 bg-green-50/60"
                  >
                    <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#16a34a"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold text-gray-900 truncate">
                        {a.account_name}
                      </div>
                      <div className="text-[12px] text-gray-500 tabular-nums">
                        ID {a.account_id}
                      </div>
                    </div>
                    <span className="text-[11px] font-semibold text-green-700 bg-green-100 border border-green-200 rounded-full px-2.5 py-1 shrink-0">
                      Connected
                    </span>
                  </div>
                ))}
                <Link
                  href="/login"
                  className="w-full mt-2 flex items-center justify-center gap-2 bg-[#059669] hover:bg-[#1247c8] text-white text-[14px] font-semibold rounded-xl py-3 transition"
                >
                  Go to dashboard
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>
                <button
                  onClick={reset}
                  className="w-full text-[13px] font-medium text-gray-500 hover:text-gray-800 transition py-1.5"
                >
                  Connect another / reset
                </button>
              </div>
            ) : (
              /* ── Idle / connecting ── */
              <div>
                {/* Windsor API key */}
                <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">
                  Windsor API key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="paste your Windsor workspace key (or set in env)"
                  className="w-full text-[13px] border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-400 bg-white mb-4"
                />

                <button
                  onClick={connect}
                  disabled={status === "connecting"}
                  className="w-full flex items-center justify-center gap-2.5 rounded-xl py-3 text-[14px] font-semibold text-white transition disabled:opacity-90 disabled:cursor-default"
                  style={{ background: "linear-gradient(90deg, #2b7fff, #4285F4)" }}
                >
                  {status === "connecting" ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Waiting for authorization…
                    </>
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M21.35 11.1H12v2.9h5.35c-.25 1.5-1.8 4.4-5.35 4.4-3.2 0-5.8-2.65-5.8-5.9s2.6-5.9 5.8-5.9c1.8 0 3 .77 3.7 1.43l2.5-2.42C16.9 3.6 14.7 2.6 12 2.6 6.9 2.6 2.8 6.7 2.8 11.8s4.1 9.2 9.2 9.2c5.3 0 8.8-3.73 8.8-8.98 0-.6-.06-1.06-.15-1.52z"
                          fill="#fff"
                        />
                      </svg>
                      Connect Google Ads
                    </>
                  )}
                </button>

                {status === "connecting" && (
                  <button
                    onClick={checkAccounts}
                    className="w-full mt-2 text-[13px] font-semibold text-[#059669] hover:text-[#1247c8] transition py-1.5"
                  >
                    I&apos;ve approved — check now
                  </button>
                )}

                {note && (
                  <p className="text-[12px] text-gray-500 text-center mt-3 leading-snug animate-in fade-in">
                    {note}
                  </p>
                )}
                {error && (
                  <p className="text-[12px] text-red-500 text-center mt-3 leading-snug">{error}</p>
                )}

                <div className="flex items-center gap-1.5 justify-center mt-5 text-[11.5px] text-gray-400">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Secured by Windsor.ai — we never see your password
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-gray-400 mt-4">
          Preview · /connect-preview · real Windsor Authorize-via-Link flow
        </p>
      </div>
    </div>
  );
}
