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
import AccentPicker from "@/components/AccentPicker";

// Icons mirror the Figma sidebar exactly (Lucide, 16px viewBox, #A1A1AA stroke).
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
    group: "WORKSPACE",
    items: [
      {
        label: "Pipelines",
        href: "/data-sources",
        icon: (
          <svg {...ICON_PROPS}>
            <path d="M2.667 2.667h10.666L9.333 7.6V12l-2.666 1.667V7.6L2.667 2.667z" />
          </svg>
        ),
      },
    ],
  },
  {
    group: "ACCOUNT",
    items: [
      {
        label: "Account",
        href: "/profile",
        icon: (
          <svg {...ICON_PROPS}>
            <rect x="1.8" y="3.3" width="12.4" height="9.3" rx="2.2" />
            <circle cx="5.7" cy="6.9" r="1.4" />
            <path d="M3.4 10.9a2.6 2.6 0 0 1 4.6 0" />
            <path d="M9.6 6.3h2.9" />
            <path d="M9.6 8.5h2.9" />
          </svg>
        ),
      },
      {
        label: "Control Room",
        href: "/admin",
        icon: (
          <svg {...ICON_PROPS}>
            <path d="M3 2.7v4.6M3 10.2v2.5M8 2.7v1.7M8 6.9v5.8M13 2.7v6.7M13 11.2v1.5" />
            <circle cx="3" cy="8.6" r="1.5" />
            <circle cx="8" cy="5.7" r="1.5" />
            <circle cx="13" cy="10.7" r="1.5" />
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
  // platform section (and no Watchtower / Forge AI), just Pipelines.
  const [platforms, setPlatforms] = useState<ConnectorId[]>([]);
  // Admin-added sources reach the registry asynchronously (see the layout), so
  // this must recompute when they land — otherwise it keeps the built-ins-only
  // snapshot it took on mount and a connected custom source never appears.
  const connectorsVersion = useCrossFilter((s) => s.connectorsVersion);
  useEffect(() => {
    // Viewing as a client: show THEIR connected platforms (stashed by the admin
    // page), not the admin's own — getUser() here only returns the admin.
    if (typeof window !== "undefined") {
      const raw = sessionStorage.getItem("mf_view_as_connectors");
      if (sessionStorage.getItem("mf_view_as") && raw) {
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

  // Watchtower / Forge AI show only when at least one CONNECTED source has
  // that feature left on in Admin → Pipelines. A feature defaults to on, so
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
          className={`flex items-center rounded-xl text-[14px] transition mb-1 ${
            collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"
          } ${active ? "bg-emerald-500/10 text-[var(--brand-fg)] ring-1 ring-emerald-500/25" : "text-[#A1A1AA] hover:bg-zinc-800/60 hover:text-zinc-200"}`}
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
        title={collapsed ? "Forge AI" : undefined}
        className={`flex items-center rounded-xl text-[14px] transition mb-1 ${
          collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"
        } ${active ? "bg-emerald-500/10 text-[var(--brand-fg)] ring-1 ring-emerald-500/25" : "text-[#A1A1AA] hover:bg-zinc-800/60 hover:text-zinc-200"}`}
      >
        <span className="relative shrink-0">
          {/* The design's own icon, exported from Figma: one outlined
              four-point star with a small spark above right and below left.
              Stroked like every other icon in this rail rather than filled,
              which is what made the old pair of solid stars sit heavier than
              its neighbours. */}
          <svg {...ICON_PROPS}>
            <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2.8" />
            <path d="M8.9 5.3 6.2 8.4h1.9L7.2 10.9 10.1 7.6H8.1l.8-2.3z" />
          </svg>
        </span>
        {!collapsed && <span className="whitespace-nowrap flex-1">Forge AI</span>}
      </Link>
    );
  };

  const smartGoalsLink = (onNavigate?: () => void) => {
    const active = pathname === "/smart-goals";
    return (
      <Link
        href="/smart-goals"
        onClick={onNavigate}
        title={collapsed ? "Watchtower" : undefined}
        className={`flex items-center rounded-xl text-[14px] transition mb-1 ${
          collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"
        } ${active ? "bg-emerald-500/10 text-[var(--brand-fg)] ring-1 ring-emerald-500/25" : "text-[#A1A1AA] hover:bg-zinc-800/60 hover:text-zinc-200"}`}
      >
        <span className="relative shrink-0">
          <svg {...ICON_PROPS}>
            <path d="M8 14A6 6 0 1 1 14 8" />
            <path d="M8 8l3.2-3.2" />
            <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
          </svg>
        </span>
        {!collapsed && <span className="whitespace-nowrap flex-1">Watchtower</span>}
      </Link>
    );
  };

  const content = (
    <aside
      className={`relative h-full glass rounded-2xl flex flex-col transition-[width] duration-200 ease-out ${collapsed ? "w-[72px]" : "w-[256px]"}`}
    >
      {/* Desktop collapse toggle — floating circular button on the right edge (Figma) */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="hidden lg:flex absolute top-7 -right-3 z-20 w-6 h-6 items-center justify-center rounded-full glass shadow-sm text-zinc-400 hover:text-zinc-300 hover:border-zinc-700 transition"
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
        className={`flex pt-5 pb-4 border-b border-zinc-800 ${collapsed ? "flex-col items-center gap-3 px-2" : "items-center px-4"}`}
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
                className="text-[14px] font-black whitespace-nowrap"
                data-brand
                style={{ letterSpacing: "0.1em" }}
              >
                METRICFORGE
              </div>
              <div
                className="text-[11px] text-zinc-500 whitespace-nowrap"
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
          className="lg:hidden text-zinc-500 hover:text-zinc-400 transition ml-auto shrink-0"
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
        {/* Command palette trigger — ⌘K everywhere in the app */}
        {!collapsed && (
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
            className="w-full mb-4 flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-800/80 bg-zinc-800/40 text-[13px] text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 transition"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span className="flex-1 text-left">Search…</span>
            <kbd className="text-[10px] text-zinc-600 border border-zinc-700/70 rounded px-1.5 py-0.5">
              ⌘K
            </kbd>
          </button>
        )}
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
              <p className="px-3 mb-2 text-[11px] font-medium text-[#71717A] tracking-[0.8px] uppercase whitespace-nowrap">
                CHANNELS
              </p>
            )}
            {renderPlatforms(onMobileClose)}
          </div>
        )}
        {SYSTEM_NAV.map(({ group, items }) => (
          <div key={group} className="mb-4">
            {!collapsed && (
              <p className="px-3 mb-2 text-[11px] font-medium text-[#71717A] tracking-[0.8px] uppercase whitespace-nowrap">
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
                  className={`flex items-center rounded-xl text-[14px] transition mb-1 ${
                    collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"
                  } ${active ? "bg-emerald-500/10 text-[var(--brand-fg)] ring-1 ring-emerald-500/25" : "text-[#A1A1AA] hover:bg-zinc-800/60 hover:text-zinc-200"}`}
                >
                  <span
                    className={`relative shrink-0 ${active ? "text-[var(--brand-fg)]" : "text-[#A1A1AA]"}`}
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
        className={`border-t border-zinc-800 p-3 flex items-center ${collapsed ? "justify-center" : "gap-2.5"}`}
      >
        {session?.avatar ? (
          <img
            src={session.avatar}
            alt={session.name}
            className="w-8 h-8 rounded-full shrink-0 object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-fg))] flex items-center justify-center text-white text-[12px] font-bold shrink-0">
            {session?.name ? session.name.slice(0, 2).toUpperCase() : "U"}
          </div>
        )}
        {!collapsed && (
          <>
            <div className="overflow-hidden flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-zinc-200 truncate whitespace-nowrap">
                {session?.name ?? "User"}
              </p>
              <p className="text-[11px] text-zinc-500 truncate whitespace-nowrap">
                {session?.email ?? ""}
              </p>
            </div>
            <AccentPicker />
            {onLogout && (
              <button
                onClick={onLogout}
                title="Sign out"
                aria-label="Sign out"
                className="shrink-0 -m-2 p-2 flex items-center justify-center text-zinc-500 hover:text-red-500 transition"
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
      {/* Desktop sidebar — floating rounded panel */}
      <div className="hidden lg:flex h-screen shrink-0 sticky top-0 z-30 p-3">{content}</div>

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
        <aside className="w-[260px] h-full glass border-r flex flex-col">
          {/* Logo + close */}
          <div className="flex items-center justify-between px-4 pt-5 pb-4 border-b border-zinc-800">
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
                  className="text-[14px] font-black"
                  data-brand
                  style={{ letterSpacing: "0.1em" }}
                >
                  METRICFORGE
                </div>
                <div className="text-[11px] text-zinc-500">E-commerce Intelligence</div>
              </div>
            </div>
            <button onClick={onMobileClose} className="text-zinc-500 hover:text-zinc-400">
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
                <p className="px-3 mb-2 text-[11px] font-medium text-[#71717A] tracking-[0.8px] uppercase">
                  CHANNELS
                </p>
                {renderPlatforms(onMobileClose)}
              </div>
            )}
            {SYSTEM_NAV.map(({ group, items }) => (
              <div key={group} className="mb-4">
                <p className="px-3 mb-2 text-[11px] font-medium text-[#71717A] tracking-[0.8px] uppercase">
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
                      className={`flex items-center gap-3 px-3 py-2 rounded-xl text-[14px] transition mb-1 ${
                        active
                          ? "bg-emerald-500/10 text-[var(--brand-fg)] ring-1 ring-emerald-500/25"
                          : "text-[#A1A1AA] hover:bg-zinc-800/60 hover:text-zinc-200"
                      }`}
                    >
                      <span className={active ? "text-[var(--brand-fg)]" : "text-[#A1A1AA]"}>
                        {icon}
                      </span>
                      {label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="border-t border-zinc-800 p-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-fg))] flex items-center justify-center text-white text-[12px] font-bold shrink-0">
              {session?.name ? session.name.slice(0, 2).toUpperCase() : "U"}
            </div>
            <div className="overflow-hidden flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-zinc-200 truncate">
                {session?.name ?? "User"}
              </p>
              <p className="text-[11px] text-zinc-500 truncate">{session?.email ?? ""}</p>
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                title="Sign out"
                aria-label="Sign out"
                className="shrink-0 -m-2 p-2 flex items-center justify-center text-zinc-500 hover:text-red-500 transition"
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
