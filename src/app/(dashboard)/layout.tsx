"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { getSupabaseSession, logoutUser, pendingMfaFactor, type Session } from "@/lib/auth";
import { createClient } from "@/lib/supabase";
import { connectorFromSlug, setCustomConnectors, type CustomConnectorRow } from "@/lib/connectors";
import { useCrossFilter } from "@/lib/store";
import ConnectorSwitcher from "@/app/(dashboard)/_dashboard/_components/ConnectorSwitcher";
import { isPlatformAdmin } from "@/lib/authz";

const DEFAULT_HEADER_DATE = "Mar 31 – Apr 13, 2026";

// Section marks for the phone top bar — the same stroked icons the sidebar uses
// for Smart Goals and the AI Optimizer, sized for the bar.
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

  // "View as Client" banner — shown app-wide (dashboard, Smart Goals, AI
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
  // DashboardView — so Smart Goals and the AI Optimizer honour the "which
  // sections a source appears in" toggles on a fresh page load too. It only used
  // to load on the dashboard, so a browser refresh straight onto Smart Goals
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
      <div className="min-h-screen flex items-center justify-center bg-[#f9fafb]">
        <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Every data source has its own dashboard URL now, so "are we on a dashboard"
  // is a question about the slug rather than one hardcoded path.
  const onDashboard = !!pathname && !!connectorFromSlug(pathname.replace(/^\//, ""));
  const displayDate = headerDate ?? (onDashboard ? DEFAULT_HEADER_DATE : "");
  // Smart Goals and the optimizer name themselves on a phone — the source is
  // chosen with the platform tabs inside the page, so the top bar shows the
  // section (icon + name), not a source switcher that would duplicate them.
  // Only the dashboards keep the switcher up here, since that's where switching
  // source is the whole point.
  const section: { icon: React.ReactNode; name: string } | null =
    pathname === "/smart-goals"
      ? {
          name: "Smart Goals",
          icon: (
            <svg {...SECTION_ICON}>
              <circle cx="8" cy="8" r="6.667" />
              <circle cx="8" cy="8" r="4" />
              <circle cx="8" cy="8" r="1.333" />
            </svg>
          ),
        }
      : pathname === "/ai-optimizer"
        ? {
            name: "AI Optimizer",
            icon: (
              <svg {...SECTION_ICON}>
                <path d="M6.62469 10.3333C6.56517 10.1026 6.44492 9.89209 6.27643 9.7236C6.10795 9.55512 5.8974 9.43487 5.66669 9.37535L1.57669 8.32068C1.50691 8.30088 1.44549 8.25885 1.40176 8.20098C1.35803 8.14311 1.33437 8.07255 1.33437 8.00002C1.33437 7.92748 1.35803 7.85692 1.40176 7.79905C1.44549 7.74118 1.50691 7.69915 1.57669 7.67935L5.66669 6.62402C5.89732 6.56455 6.10782 6.4444 6.27629 6.27604C6.44476 6.10768 6.56507 5.89727 6.62469 5.66668L7.67936 1.57668C7.69896 1.50663 7.74095 1.44491 7.7989 1.40094C7.85686 1.35698 7.92761 1.33318 8.00036 1.33318C8.0731 1.33318 8.14385 1.35698 8.20181 1.40094C8.25977 1.44491 8.30175 1.50663 8.32136 1.57668L9.37536 5.66668C9.43488 5.8974 9.55513 6.10795 9.72361 6.27643C9.89209 6.44491 10.1026 6.56516 10.3334 6.62468L14.4234 7.67868C14.4937 7.69808 14.5557 7.74002 14.5999 7.79807C14.6441 7.85611 14.6681 7.92706 14.6681 8.00002C14.6681 8.07297 14.6441 8.14392 14.5999 8.20196C14.5557 8.26001 14.4937 8.30195 14.4234 8.32135L10.3334 9.37535C10.1026 9.43487 9.89209 9.55512 9.72361 9.7236C9.55513 9.89209 9.43488 10.1026 9.37536 10.3333L8.32069 14.4234C8.30109 14.4934 8.2591 14.5551 8.20114 14.5991C8.14319 14.6431 8.07244 14.6669 7.99969 14.6669C7.92694 14.6669 7.8562 14.6431 7.79824 14.5991C7.74028 14.5551 7.6983 14.4934 7.67869 14.4234L6.62469 10.3333Z" />
                <path d="M13.3333 2V4.66667" />
                <path d="M14.6667 3.33333H12" />
                <path d="M2.66667 11.3333V12.6667" />
                <path d="M3.33333 12H2" />
              </svg>
            ),
          }
        : null;

  return (
    <div className="flex w-full min-h-screen bg-[#f9fafb]">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        session={session}
        onLogout={handleLogout}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="text-gray-500 hover:text-gray-700"
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
              // Smart Goals / AI Optimizer name themselves; their platform tabs
              // inside the page do the source switching.
              <div className="flex items-center gap-2 text-[#101828]">
                <span className="text-[#059669]">{section.icon}</span>
                <span className="text-[15px] font-bold">{section.name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/data-rocks-logo.png"
                  alt="MetricForge"
                  width={28}
                  height={28}
                  className="object-contain"
                />
                <span
                  className="text-[14px] font-black" data-brand
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
              className="flex items-center gap-1.5 text-[12px] text-gray-600 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 cursor-pointer active:bg-gray-50 transition-colors"
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
          <div className="flex items-center justify-center gap-3 flex-wrap bg-[#059669] text-white text-[13px] px-4 py-2 text-center">
            <span>
              Viewing as <span className="font-semibold">{viewAsName}</span> — you are seeing this
              client&rsquo;s live data.
            </span>
            <button
              onClick={exitViewAs}
              className="inline-flex items-center h-[26px] px-3 rounded-md bg-white/15 hover:bg-white/25 font-medium transition"
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
