"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface PendingInvite {
  from_id: string;
  from_name: string;
  from_email: string;
  created_at: string;
}

export default function InvitesPage() {
  const router = useRouter();
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/team/invites")
      .then((r) => r.json())
      .then((j) => {
        if (j.invites) setInvites(j.invites);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleRespond = async (from_id: string, action: "accept" | "decline") => {
    setResponding(from_id);
    await fetch("/api/team/invites", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_id, action }),
    });
    setInvites((prev) => prev.filter((i) => i.from_id !== from_id));
    setResponding(null);
    if (action === "accept") router.push("/google-ads");
  };

  return (
    <div className="p-4 sm:p-6 max-w-[600px]">
      <h1 className="text-[22px] font-bold text-gray-900 mb-1">Invites</h1>
      <p className="text-[14px] text-gray-400 mb-6">Team invitations waiting for your response</p>

      {loading && (
        <div className="flex items-center gap-2 text-gray-400 text-[14px]">
          <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      )}

      {!loading && invites.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9CA3AF"
              strokeWidth="1.8"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <p className="text-[14px] font-medium text-gray-500">No pending invites</p>
          <p className="text-[12px] text-gray-400">
            When someone invites you to their team, it will appear here
          </p>
        </div>
      )}

      {!loading && invites.length > 0 && (
        <div className="space-y-3">
          {invites.map((inv) => (
            <div
              key={inv.from_id}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5"
            >
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-full bg-emerald-600 flex items-center justify-center text-white text-[14px] font-bold shrink-0">
                  {inv.from_name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-gray-900">{inv.from_name}</p>
                  <p className="text-[12px] text-gray-400 mb-1">{inv.from_email}</p>
                  <p className="text-[13px] text-gray-600">Invites you to join their team</p>
                  <p className="text-[11px] text-gray-300 mt-1">
                    {new Date(inv.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => handleRespond(inv.from_id, "decline")}
                  disabled={responding === inv.from_id}
                  className="flex-1 text-[13px] font-medium border border-gray-200 text-gray-600 py-2 rounded-xl hover:bg-gray-50 transition disabled:opacity-50"
                >
                  Decline
                </button>
                <button
                  onClick={() => handleRespond(inv.from_id, "accept")}
                  disabled={responding === inv.from_id}
                  className="flex-1 text-[13px] font-medium bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {responding === inv.from_id && (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  Accept & Join
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
