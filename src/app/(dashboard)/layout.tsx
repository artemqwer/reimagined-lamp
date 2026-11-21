"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import CommandPalette from "@/components/CommandPalette";
import { getSupabaseSession, logoutUser, pendingMfaFactor, type Session } from "@/lib/auth";
import { createClient } from "@/lib/supabase";
import { connectorFromSlug, setCustomConnectors, type CustomConnectorRow } from "@/lib/connectors";
import { useCrossFilter } from "@/lib/store";
import ConnectorSwitcher from "@/app/(dashboard)/_dashboard/_components/ConnectorSwitcher";
import { isPlatformAdmin } from "@/lib/authz";

const DEFAULT_HEADER_DATE = "Mar 31 – Apr 13, 2026";

// Section marks for the phone top bar — the same stroked icons the sidebar uses
// for Watchtower and the Forge AI, sized for the bar.
const SECTION_ICON = {
  width: 18,
  height: 18,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.333,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const fmtTs = (ts: number) =>
  new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [headerDate, setHeaderDate] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  // "View as Client" banner — shown app-wide (dashboard, Watchtower, AI
  // Optimizer …) so the admin always knows whose data they're seeing and can
  // leave. Re-read on navigation because the layout doesn't remount between
  // pages: the admin sets it on /admin and only THEN routes into a dashboard.
  const [viewAsName, setViewAsName] = useState<string | null>(null);
  useEffect(() => {
    try {
      setViewAsName(
        sessionStorage.getItem("dr_view_as") ? sessionStorage.getItem("dr_view_as_name") : null,
      );
    } catch {
      setViewAsName(null);
    }
  }, [pathname]);
  const exitViewAs = () => {
    try {
      sessionStorage.removeItem("dr_view_as");
      sessionStorage.removeItem("dr_view_as_name");
      sessionStorage.removeItem("dr_view_as_connectors");
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

  // Load admin-added data sources once per session so the Sidebar / connector
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
  // DashboardView — so Watchtower and the Forge AI honour the "which
  // sections a source appears in" toggles on a fresh page load too. It only used
  // to load on the dashboard, so a browser refresh straight onto Watchtower
  // showed sources an admin had switched off there until you navigated away and
  // back (which is when the dashboard finally loaded the config).
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

  useEffect(() => {
    const handler = (e: Event) => {
      const { start, end } = (e as CustomEvent<{ start: number; end: number }>).detail;
      setHeaderDate(`${fmtTs(start)} – ${fmtTs(end)}`);
    };
    window.addEventListener("date-range-changed", handler);
    return () => window.removeEventListener("date-range-changed", handler);
  }, []);

  const handleLogout = async () => {
    await logoutUser();
    router.replace("/login");
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#18181B]">
        <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Every data source has its own dashboard URL now, so "are we on a dashboard"
  // is a question about the slug rather than one hardcoded path.
  const onDashboard = !!pathname && !!connectorFromSlug(pathname.replace(/^\//, ""));
  const displayDate = headerDate ?? (onDashboard ? DEFAULT_HEADER_DATE : "");
  // Watchtower and the optimizer name themselves on a phone — the source is
  // chosen with the platform tabs inside the page, so the top bar shows the
  // section (icon + name), not a source switcher that would duplicate them.
  // Only the dashboards keep the switcher up here, since that's where switching
  // source is the whole point.
  const section: { icon: React.ReactNode; name: string } | null =
    pathname === "/smart-goals"
      ? {
          name: "Watchtower",
          icon: (
            <svg {...SECTION_ICON}>
              <path d="M8 14A6 6 0 1 1 14 8" />
              <path d="M8 8l3.2-3.2" />
              <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
            </svg>
          ),
        }
      : pathname === "/ai-optimizer"
        ? {
            name: "Forge AI",
            icon: (
              <svg {...SECTION_ICON}>
                <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2.8" />
                <path d="M8.9 5.3 6.2 8.4h1.9L7.2 10.9 10.1 7.6H8.1l.8-2.3z" />
              </svg>
            ),
          }
        : null;

  return (
    <div className="flex w-full min-h-screen bg-[#18181B]">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        session={session}
        onLogout={handleLogout}
      />
      <CommandPalette />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="text-zinc-400 hover:text-zinc-300"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            {onDashboard ? (
              // On a dashboard the mark IS the switcher — switching source is
              // the point here.
              <ConnectorSwitcher compact />
            ) : section ? (
              // Watchtower / Forge AI name themselves; their platform tabs
              // inside the page do the source switching.
              <div className="flex items-center gap-2 text-[#F4F4F5]">
                <span className="text-[var(--brand)]">{section.icon}</span>
                <span className="text-[15px] font-bold">{section.name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/metricforge-logo.png"
                  alt="MetricForge"
                  width={28}
                  height={28}
                  className="object-contain"
                />
                <span
                  className="text-[14px] font-black"
                  data-brand
                  style={{ letterSpacing: "0.1em" }}
                >
                  METRICFORGE
                </span>
              </div>
            )}
          </div>
          {onDashboard && (
            <div
              onClick={() => window.dispatchEvent(new CustomEvent("open-date-picker"))}
              className="flex items-center gap-1.5 text-[12px] text-zinc-400 glass rounded-lg px-2.5 py-1.5 cursor-pointer active:bg-zinc-900 transition-colors"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span className="truncate max-w-32.5">{displayDate}</span>
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          )}
        </header>

        {viewAsName && (
          <div className="flex items-center justify-center gap-3 flex-wrap bg-[var(--brand)] text-white text-[13px] px-4 py-2 text-center">
            <span>
              Viewing as <span className="font-semibold">{viewAsName}</span> — you are seeing this
              client&rsquo;s live data.
            </span>
            <button
              onClick={exitViewAs}
              className="inline-flex items-center h-[26px] px-3 rounded-md bg-zinc-900/15 hover:bg-zinc-800/60/25 font-medium transition"
            >
              Exit
            </button>
          </div>
        )}
        <main className="flex-1 pb-6 sm:pb-10">{children}</main>
      </div>
    </div>
  );
}
