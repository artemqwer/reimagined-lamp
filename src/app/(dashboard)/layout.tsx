"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import TopNav from "@/components/TopNav";
import { getSupabaseSession, logoutUser, pendingMfaFactor, type Session } from "@/lib/auth";
import { createClient } from "@/lib/supabase";
import { setCustomConnectors, type CustomConnectorRow } from "@/lib/connectors";
import { useCrossFilter } from "@/lib/store";
import { isPlatformAdmin } from "@/lib/authz";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  // "View as Client" banner — shown app-wide (dashboard, Watchtower, Forge AI …)
  // so the admin always knows whose data they're seeing and can leave. Re-read on
  // navigation because the layout doesn't remount between pages: the admin sets
  // it on /admin and only THEN routes into a dashboard.
  const [viewAsName, setViewAsName] = useState<string | null>(null);
  useEffect(() => {
    try {
      setViewAsName(
        sessionStorage.getItem("mf_view_as") ? sessionStorage.getItem("mf_view_as_name") : null,
      );
    } catch {
      setViewAsName(null);
    }
  }, [pathname]);
  const exitViewAs = () => {
    try {
      sessionStorage.removeItem("mf_view_as");
      sessionStorage.removeItem("mf_view_as_name");
      sessionStorage.removeItem("mf_view_as_connectors");
    } catch {
      /* private mode */
    }
    setViewAsName(null);
    router.push("/admin");
  };

  useEffect(() => {
    getSupabaseSession().then(async (s) => {
      if (!s) {
        router.replace("/login");
        return;
      }
      // 2FA enabled but not yet satisfied this session → finish it on /login.
      const factorId = await pendingMfaFactor();
      if (factorId) {
        router.replace("/login");
        return;
      }
      setSession(s);
      setChecking(false);
    });

    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, supabaseSession) => {
      if (!supabaseSession) return;
      const user = supabaseSession.user;
      const name = user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "User";
      const avatar = user.user_metadata?.avatar_url ?? user.user_metadata?.picture;
      const teamId = (user.user_metadata?.team_id as string | undefined) ?? null;
      const isAdmin = isPlatformAdmin(user);
      setSession({ email: user.email!, name, avatar, teamId, isAdmin });
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load admin-added data sources once per session so the TopNav / connector
  // switcher / data-sources page see them without a deploy. Silently keeps the
  // built-ins only on failure — the dashboard must never hard-fail on this.
  useEffect(() => {
    fetch("/api/admin/custom-connectors")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { connectors?: CustomConnectorRow[] } | null) => {
        // Only a real answer touches the registry. A failed request used to
        // land here as `?? []`, which wiped every admin-added source the
        // session had already loaded — the sidebar then dropped a connected
        // source while the data-sources page went on listing it.
        if (Array.isArray(j?.connectors)) setCustomConnectors(j.connectors);
      })
      .catch(() => {});
  }, []);

  // Load the admin's connector display config here — at the layout, not only in
  // DashboardView — so Watchtower and Forge AI honour the "which sections a
  // source appears in" toggles on a fresh page load too.
  const setConnectorConfigs = useCrossFilter((s) => s.setConnectorConfigs);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/connector-config")
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && j?.configs) setConnectorConfigs(j.configs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [setConnectorConfigs]);

  const handleLogout = async () => {
    await logoutUser();
    router.replace("/login");
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[var(--brand)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full min-h-screen">
      <TopNav session={session} onLogout={handleLogout} />

      {viewAsName && (
        <div className="flex items-center justify-center gap-3 flex-wrap bg-[var(--brand)] text-white text-[13px] px-4 py-2 text-center">
          <span>
            Viewing as <span className="font-semibold">{viewAsName}</span> — you are seeing this
            client&rsquo;s live data.
          </span>
          <button
            onClick={exitViewAs}
            className="inline-flex items-center h-[26px] px-3 rounded-md bg-zinc-900/15 hover:bg-zinc-900/25 font-medium transition"
          >
            Exit
          </button>
        </div>
      )}
      <main className="flex-1 pb-6 sm:pb-10 page-fade">{children}</main>
    </div>
  );
}
