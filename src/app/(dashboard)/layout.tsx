"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import AppSidebar from "@/components/AppSidebar";
import { getSupabaseSession, logoutUser, pendingMfaFactor, type Session } from "@/lib/auth";
import { createClient } from "@/lib/supabase";
import { setCustomConnectors, type CustomConnectorRow } from "@/lib/connectors";
import { useCrossFilter } from "@/lib/store";
import { isPlatformAdmin } from "@/lib/authz";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
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
    // Local design-screenshot mode (never enable on production): a browser-only
    // cookie turns the auth gate off and pretends to be an admin.
    if (typeof document !== "undefined" && document.cookie.includes("mf_shot=1")) {
      setSession({
        email: "shot@metricforge.dev",
        name: "Shot Admin",
        avatar: undefined,
        teamId: null,
        isAdmin: true,
      });
      setChecking(false);
      return;
    }
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
  }, []);

  // Load admin-added data sources once per session so the sidebar / connector
  // switcher / data-sources page see them without a deploy.
  useEffect(() => {
    fetch("/api/admin/custom-connectors")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { connectors?: CustomConnectorRow[] } | null) => {
        if (Array.isArray(j?.connectors)) setCustomConnectors(j.connectors);
      })
      .catch(() => {});
  }, []);

  // Load the admin's connector display config at the layout so Watchtower and
  // Forge AI honour the "which sections a source appears in" toggles on a fresh
  // page load too.
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

  const sectionOf = (p: string) =>
    p === "/smart-goals"
      ? "Watchtower"
      : p === "/ai-optimizer"
        ? "Forge AI"
        : p === "/data-sources"
          ? "Pipelines"
          : p === "/admin"
            ? "Control Room"
            : p === "/profile"
              ? "Account"
              : "Overview";

  return (
    <div className="flex w-full min-h-screen">
      <AppSidebar
        session={session}
        onLogout={handleLogout}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop top bar */}
        <header className="hidden lg:sticky lg:top-0 lg:z-40 lg:flex items-center justify-between h-[58px] px-5 glass border-x-0 border-t-0 shrink-0">
          <div className="breadcrumb flex items-center gap-2 text-[12.5px] text-zinc-500">
            Workspace <span className="text-zinc-700">/</span>{" "}
            <strong className="text-zinc-200 font-semibold">{sectionOf(pathname ?? "")}</strong>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
              className="flex items-center gap-2 rounded-lg border border-zinc-800/80 bg-white/[0.03] h-[34px] px-3 text-[12px] text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 transition"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Search anything
              <kbd className="text-[9.5px] text-zinc-600 border border-zinc-800 rounded px-1.5 py-0.5 flex items-center gap-0.5">
                ⌘ K
              </kbd>
            </button>
            {session?.avatar ? (
              <img
                src={session.avatar}
                alt={session.name}
                className="w-8 h-8 rounded-full object-cover ring-1 ring-white/10"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[linear-gradient(135deg,var(--brand-fg),var(--brand))] grid place-items-center text-white text-[11px] font-bold">
                {(session?.name ?? "U").slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>
        </header>

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
    </div>
  );
}
