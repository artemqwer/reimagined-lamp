"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Session } from "@/lib/auth";
import { createClient } from "@/lib/supabase";
import { useCrossFilter } from "@/lib/store";
import {
  CONNECTORS,
  connectedConnectorsRaw,
  connectorHasFeature,
  connectorSlug,
  type ConnectorId,
} from "@/lib/connectors";
import ConnectorBrandIcon from "@/components/ConnectorBrandIcon";

// Icons mirror the Figma sidebar exactly (Lucide, 16px viewBox, #364153 stroke).
const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.333,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const SYSTEM_NAV = [
  {
    group: "SYSTEM",
    items: [
      {
        label: "Data Sources",
        href: "/data-sources",
        icon: (
          <svg {...ICON_PROPS}>
            <path d="M8 14.6667V11.3333" />
            <path d="M6 5.33333V1.33333" />
            <path d="M10 5.33333V1.33333" />
            <path d="M12 5.33333V8.66667C12 9.37391 11.719 10.0522 11.219 10.5523C10.7189 11.0524 10.0406 11.3333 9.33333 11.3333H6.66667C5.95942 11.3333 5.28115 11.0524 4.78105 10.5523C4.28095 10.0522 4 9.37391 4 8.66667V5.33333H12Z" />
          </svg>
        ),
      },
    ],
  },
  {
    group: "ACCOUNT",
    items: [
      {
        label: "Profile",
        href: "/profile",
        icon: (
          <svg {...ICON_PROPS}>
            <path d="M12.6667 14V12.6667C12.6667 11.9594 12.3857 11.2811 11.8856 10.781C11.3855 10.281 10.7072 10 10 10H6C5.29276 10 4.61448 10.281 4.11438 10.781C3.61428 11.2811 3.33333 11.9594 3.33333 12.6667V14" />
            <path d="M8 7.33333C9.47276 7.33333 10.6667 6.13943 10.6667 4.66667C10.6667 3.19391 9.47276 2 8 2C6.52724 2 5.33333 3.19391 5.33333 4.66667C5.33333 6.13943 6.52724 7.33333 8 7.33333Z" />
          </svg>
        ),
      },
      {
        label: "Admin Panel",
        href: "/admin",
        icon: (
          <svg {...ICON_PROPS}>
            <path d="M10.6667 14V12.6667C10.6667 11.9594 10.3857 11.2811 9.88562 10.781C9.38552 10.281 8.70724 10 8 10H4C3.29276 10 2.61448 10.281 2.11438 10.781C1.61428 11.2811 1.33333 11.9594 1.33333 12.6667V14" />
            <path d="M6 7.33333C7.47276 7.33333 8.66667 6.13943 8.66667 4.66667C8.66667 3.19391 7.47276 2 6 2C4.52724 2 3.33333 3.19391 3.33333 4.66667C3.33333 6.13943 4.52724 7.33333 6 7.33333Z" />
            <path d="M14.6667 14V12.6667C14.6662 12.0758 14.4696 11.5018 14.1076 11.0349C13.7456 10.5679 13.2388 10.2344 12.6667 10.0867" />
            <path d="M10.6667 2.08667C11.2403 2.23353 11.7487 2.56713 12.1118 3.03487C12.4748 3.50261 12.6719 4.07789 12.6719 4.67C12.6719 5.26211 12.4748 5.83739 12.1118 6.30513C11.7487 6.77287 11.2403 7.10647 10.6667 7.25333" />
          </svg>
        ),
      },
    ],
  },
];

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
  session?: Session | null;
  onLogout?: () => void;
}

// The source's official mark: Google Ads keeps its PNG, the rest use the shared
// brand SVGs (same as the header switcher).
function ConnectorIcon({ id }: { id: ConnectorId }) {
  if (id === "google_ads") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/google-ads.png" alt="" className="w-4 h-4 object-contain" />;
  }
  return <ConnectorBrandIcon id={id} size={16} />;
}

export default function Sidebar({ mobileOpen, onMobileClose, session, onLogout }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const setActiveConnector = useCrossFilter((s) => s.setActiveConnector);
  const connectorConfigs = useCrossFilter((s) => s.connectorConfigs);
  // Only the user's connected sources appear here (loaded from their record).
  // Empty until we know — a new account with nothing connected shows no
  // platform section (and no Smart Goals / AI Optimizer), just Data Sources.
  const [platforms, setPlatforms] = useState<ConnectorId[]>([]);
  // Admin-added sources reach the registry asynchronously (see the layout), so
  // this must recompute when they land — otherwise it keeps the built-ins-only
  // snapshot it took on mount and a connected custom source never appears.
  const connectorsVersion = useCrossFilter((s) => s.connectorsVersion);
  useEffect(() => {
    // Viewing as a client: show THEIR connected platforms (stashed by the admin
    // page), not the admin's own — getUser() here only returns the admin.
    if (typeof window !== "undefined") {
      const raw = sessionStorage.getItem("dr_view_as_connectors");
      if (sessionStorage.getItem("dr_view_as") && raw) {
        try {
          const ids = JSON.parse(raw) as ConnectorId[];
          if (Array.isArray(ids) && ids.length) {
            setPlatforms(ids);
            return;
          }
        } catch {
          /* fall through to the admin's own sources */
        }
      }
    }
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => setPlatforms(connectedConnectorsRaw(user)));
  }, [connectorsVersion]);

  // Smart Goals / AI Optimizer show only when at least one CONNECTED source has
  // that feature left on in Admin → Data Sources. A feature defaults to on, so
  // before configs load a connected source still shows them (never spuriously
  // blank), and the list updates automatically as connections/settings change.
  const showSmartGoals = platforms.some((id) =>
    connectorHasFeature("smartGoals", connectorConfigs[id]),
  );
  const showOptimizer = platforms.some((id) =>
    connectorHasFeature("optimizer", connectorConfigs[id]),
  );

  // Each source has its own dashboard URL, so the link is a real link: it can
  // be copied, bookmarked and reloaded. setActiveConnector still fires on click
  // so the store is already right by the time the new route renders.
  const renderPlatforms = (onNavigate?: () => void) =>
    platforms.map((id) => {
      const href = `/${connectorSlug(id)}`;
      const active = pathname === href;
      return (
        <Link
          key={id}
          href={href}
          onClick={() => {
            setActiveConnector(id);
            onNavigate?.();
          }}
          title={collapsed ? CONNECTORS[id].label : undefined}
          className={`flex items-center rounded-[10px] text-[14px] transition mb-1 ${
            collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"
          } ${active ? "bg-[#eff6ff] text-[#047857]" : "text-[#364153] hover:bg-gray-50"}`}
        >
          <span className="relative shrink-0">
            <ConnectorIcon id={id} />
          </span>
          {!collapsed && <span className="whitespace-nowrap flex-1">{CONNECTORS[id].label}</span>}
        </Link>
      );
    });
  const optimizerLink = (onNavigate?: () => void) => {
    const active = pathname === "/ai-optimizer";
    return (
      <Link
        href="/ai-optimizer"
        onClick={onNavigate}
        title={collapsed ? "AI Optimizer" : undefined}
        className={`flex items-center rounded-[10px] text-[14px] transition mb-1 ${
          collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"
        } ${active ? "bg-[#eff6ff] text-[#047857]" : "text-[#364153] hover:bg-gray-50"}`}
      >
        <span className="relative shrink-0">
          {/* The design's own icon, exported from Figma: one outlined
              four-point star with a small spark above right and below left.
              Stroked like every other icon in this rail rather than filled,
              which is what made the old pair of solid stars sit heavier than
              its neighbours. */}
          <svg {...ICON_PROPS}>
            <path d="M6.62469 10.3333C6.56517 10.1026 6.44492 9.89209 6.27643 9.7236C6.10795 9.55512 5.8974 9.43487 5.66669 9.37535L1.57669 8.32068C1.50691 8.30088 1.44549 8.25885 1.40176 8.20098C1.35803 8.14311 1.33437 8.07255 1.33437 8.00002C1.33437 7.92748 1.35803 7.85692 1.40176 7.79905C1.44549 7.74118 1.50691 7.69915 1.57669 7.67935L5.66669 6.62402C5.89732 6.56455 6.10782 6.4444 6.27629 6.27604C6.44476 6.10768 6.56507 5.89727 6.62469 5.66668L7.67936 1.57668C7.69896 1.50663 7.74095 1.44491 7.7989 1.40094C7.85686 1.35698 7.92761 1.33318 8.00036 1.33318C8.0731 1.33318 8.14385 1.35698 8.20181 1.40094C8.25977 1.44491 8.30175 1.50663 8.32136 1.57668L9.37536 5.66668C9.43488 5.8974 9.55513 6.10795 9.72361 6.27643C9.89209 6.44491 10.1026 6.56516 10.3334 6.62468L14.4234 7.67868C14.4937 7.69808 14.5557 7.74002 14.5999 7.79807C14.6441 7.85611 14.6681 7.92706 14.6681 8.00002C14.6681 8.07297 14.6441 8.14392 14.5999 8.20196C14.5557 8.26001 14.4937 8.30195 14.4234 8.32135L10.3334 9.37535C10.1026 9.43487 9.89209 9.55512 9.72361 9.7236C9.55513 9.89209 9.43488 10.1026 9.37536 10.3333L8.32069 14.4234C8.30109 14.4934 8.2591 14.5551 8.20114 14.5991C8.14319 14.6431 8.07244 14.6669 7.99969 14.6669C7.92694 14.6669 7.8562 14.6431 7.79824 14.5991C7.74028 14.5551 7.6983 14.4934 7.67869 14.4234L6.62469 10.3333Z" />
            <path d="M13.3333 2V4.66667" />
            <path d="M14.6667 3.33333H12" />
            <path d="M2.66667 11.3333V12.6667" />
            <path d="M3.33333 12H2" />
          </svg>
        </span>
        {!collapsed && <span className="whitespace-nowrap flex-1">AI Optimizer</span>}
      </Link>
    );
  };

  const smartGoalsLink = (onNavigate?: () => void) => {
    const active = pathname === "/smart-goals";
    return (
      <Link
        href="/smart-goals"
        onClick={onNavigate}
        title={collapsed ? "Smart Goals" : undefined}
        className={`flex items-center rounded-[10px] text-[14px] transition mb-1 ${
          collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"
        } ${active ? "bg-[#eff6ff] text-[#047857]" : "text-[#364153] hover:bg-gray-50"}`}
      >
        <span className="relative shrink-0">
          <svg {...ICON_PROPS}>
            <circle cx="8" cy="8" r="6.667" />
            <circle cx="8" cy="8" r="4" />
            <circle cx="8" cy="8" r="1.333" />
          </svg>
        </span>
        {!collapsed && <span className="whitespace-nowrap flex-1">Smart Goals</span>}
      </Link>
    );
  };

  const content = (
    <aside
      className={`relative h-full bg-white border-r border-gray-100 flex flex-col transition-[width] duration-200 ease-out ${collapsed ? "w-[72px]" : "w-[256px]"}`}
    >
      {/* Desktop collapse toggle — floating circular button on the right edge (Figma) */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="hidden lg:flex absolute top-7 -right-3 z-20 w-6 h-6 items-center justify-center rounded-full bg-white border border-gray-200 shadow-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      {/* Logo */}
      <div
        className={`flex pt-5 pb-4 border-b border-gray-100 ${collapsed ? "flex-col items-center gap-3 px-2" : "items-center px-4"}`}
      >
        <div className={`flex items-center gap-2 min-w-0 ${collapsed ? "" : "flex-1"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/metricforge-logo.png"
            alt="MetricForge"
            width={36}
            height={36}
            className="shrink-0 object-contain"
          />
          {!collapsed && (
            <div className="min-w-0">
              <div
                className="text-[14px] font-black whitespace-nowrap" data-brand
                style={{ letterSpacing: "0.1em" }}
              >
                METRICFORGE
              </div>
              <div
                className="text-[11px] text-gray-400 whitespace-nowrap"
                style={{ letterSpacing: "0.03em" }}
              >
                E-commerce Intelligence
              </div>
            </div>
          )}
        </div>
        {/* Mobile close button */}
        <button
          onClick={onMobileClose}
          className="lg:hidden text-gray-400 hover:text-gray-600 transition ml-auto shrink-0"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pt-2">
        {(showSmartGoals || showOptimizer) && (
          <div className="mb-4">
            {showSmartGoals && smartGoalsLink(onMobileClose)}
            {showOptimizer && optimizerLink(onMobileClose)}
          </div>
        )}
        {/* PLATFORMS — one entry per connected source; click switches the source.
            Hidden entirely until at least one source is connected. */}
        {platforms.length > 0 && (
          <div className="mb-4">
            {!collapsed && (
              <p className="px-3 mb-2 text-[12px] text-[#6a7282] tracking-[0.6px] uppercase whitespace-nowrap">
                PLATFORMS
              </p>
            )}
            {renderPlatforms(onMobileClose)}
          </div>
        )}
        {SYSTEM_NAV.map(({ group, items }) => (
          <div key={group} className="mb-4">
            {!collapsed && (
              <p className="px-3 mb-2 text-[12px] text-[#6a7282] tracking-[0.6px] uppercase whitespace-nowrap">
                {group}
              </p>
            )}
            {items.map(({ label, href, icon }) => {
              // "User Management" is admin-only
              if (href === "/admin" && !session?.isAdmin) return null;
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onMobileClose}
                  title={collapsed ? label : undefined}
                  className={`flex items-center rounded-[10px] text-[14px] transition mb-1 ${
                    collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"
                  } ${active ? "bg-[#eff6ff] text-[#047857]" : "text-[#364153] hover:bg-gray-50"}`}
                >
                  <span
                    className={`relative shrink-0 ${active ? "text-[#047857]" : "text-[#364153]"}`}
                  >
                    {icon}
                  </span>
                  {!collapsed && <span className="whitespace-nowrap flex-1">{label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User */}
      <div
        className={`border-t border-gray-100 p-3 flex items-center ${collapsed ? "justify-center" : "gap-2.5"}`}
      >
        {session?.avatar ? (
          <img
            src={session.avatar}
            alt={session.name}
            className="w-8 h-8 rounded-full shrink-0 object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-[linear-gradient(135deg,#8e51ff,#9810fa)] flex items-center justify-center text-white text-[12px] font-bold shrink-0">
            {session?.name ? session.name.slice(0, 2).toUpperCase() : "U"}
          </div>
        )}
        {!collapsed && (
          <>
            <div className="overflow-hidden flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-gray-800 truncate whitespace-nowrap">
                {session?.name ?? "User"}
              </p>
              <p className="text-[11px] text-gray-400 truncate whitespace-nowrap">
                {session?.email ?? ""}
              </p>
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                title="Sign out"
                aria-label="Sign out"
                className="shrink-0 -m-2 p-2 flex items-center justify-center text-gray-400 hover:text-red-500 transition"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden lg:flex h-screen shrink-0 sticky top-0 z-30">{content}</div>

      {/* Mobile drawer — always rendered, animated via transform */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 lg:hidden transition-opacity duration-300 ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onMobileClose}
      />
      <div
        className={`fixed inset-y-0 left-0 z-50 lg:hidden flex transition-transform duration-300 ease-in-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <aside className="w-[260px] h-full bg-white border-r border-gray-100 flex flex-col">
          {/* Logo + close */}
          <div className="flex items-center justify-between px-4 pt-5 pb-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/metricforge-logo.png"
                alt="MetricForge"
                width={36}
                height={36}
                className="shrink-0 object-contain"
              />
              <div>
                <div
                  className="text-[14px] font-black" data-brand
                  style={{ letterSpacing: "0.1em" }}
                >
                  METRICFORGE
                </div>
                <div className="text-[11px] text-gray-400">E-commerce Intelligence</div>
              </div>
            </div>
            <button onClick={onMobileClose} className="text-gray-400 hover:text-gray-600">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pt-2">
            {(showSmartGoals || showOptimizer) && (
              <div className="mb-4">
                {showSmartGoals && smartGoalsLink(onMobileClose)}
                {showOptimizer && optimizerLink(onMobileClose)}
              </div>
            )}
            {platforms.length > 0 && (
              <div className="mb-4">
                <p className="px-3 mb-2 text-[12px] text-[#6a7282] tracking-[0.6px] uppercase">
                  PLATFORMS
                </p>
                {renderPlatforms(onMobileClose)}
              </div>
            )}
            {SYSTEM_NAV.map(({ group, items }) => (
              <div key={group} className="mb-4">
                <p className="px-3 mb-2 text-[12px] text-[#6a7282] tracking-[0.6px] uppercase">
                  {group}
                </p>
                {items.map(({ label, href, icon }) => {
                  if (href === "/admin" && !session?.isAdmin) return null;
                  const active = pathname === href;
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={onMobileClose}
                      className={`flex items-center gap-3 px-3 py-2 rounded-[10px] text-[14px] transition mb-1 ${
                        active ? "bg-[#eff6ff] text-[#047857]" : "text-[#364153] hover:bg-gray-50"
                      }`}
                    >
                      <span className={active ? "text-[#047857]" : "text-[#364153]"}>{icon}</span>
                      {label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="border-t border-gray-100 p-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[linear-gradient(135deg,#8e51ff,#9810fa)] flex items-center justify-center text-white text-[12px] font-bold shrink-0">
              {session?.name ? session.name.slice(0, 2).toUpperCase() : "U"}
            </div>
            <div className="overflow-hidden flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-gray-800 truncate">
                {session?.name ?? "User"}
              </p>
              <p className="text-[11px] text-gray-400 truncate">{session?.email ?? ""}</p>
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                title="Sign out"
                aria-label="Sign out"
                className="shrink-0 -m-2 p-2 flex items-center justify-center text-gray-400 hover:text-red-500 transition"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
