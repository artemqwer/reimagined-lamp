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
import PreferencesMenu from "@/components/PreferencesMenu";
import { logoutUser } from "@/lib/auth";

// Icon set — stroked 16px, mirrors the new product vocabulary.
const ICON_PROPS = {
  width: 15,
  height: 15,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const NAV_ICONS = {
  watchtower: (
    <svg {...ICON_PROPS}>
      <path d="M8 14A6 6 0 1 1 14 8" />
      <path d="M8 8l3.2-3.2" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  ),
  forgeAI: (
    <svg {...ICON_PROPS}>
      <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2.8" />
      <path d="M8.9 5.3 6.2 8.4h1.9L7.2 10.9 10.1 7.6H8.1l.8-2.3z" />
    </svg>
  ),
  pipelines: (
    <svg {...ICON_PROPS}>
      <path d="M2.667 2.667h10.666L9.333 7.6V12l-2.666 1.667V7.6L2.667 2.667z" />
    </svg>
  ),
  account: (
    <svg {...ICON_PROPS}>
      <rect x="1.8" y="3.3" width="12.4" height="9.3" rx="2.2" />
      <circle cx="5.7" cy="6.9" r="1.4" />
      <path d="M3.4 10.9a2.6 2.6 0 0 1 4.6 0" />
      <path d="M9.6 6.3h2.9" />
      <path d="M9.6 8.5h2.9" />
    </svg>
  ),
  controlRoom: (
    <svg {...ICON_PROPS}>
      <path d="M3 2.7v4.6M3 10.2v2.5M8 2.7v1.7M8 6.9v5.8M13 2.7v6.7M13 11.2v1.5" />
      <circle cx="3" cy="8.6" r="1.5" />
      <circle cx="8" cy="5.7" r="1.5" />
      <circle cx="13" cy="10.7" r="1.5" />
    </svg>
  ),
};

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  brandIcon?: ConnectorId;
}

interface TopNavProps {
  session?: Session | null;
  onLogout?: () => void;
}

function ConnectorIcon({ id }: { id: ConnectorId }) {
  if (id === "google_ads") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/google-ads.png" alt="" className="w-3.5 h-3.5 object-contain" />;
  }
  return <ConnectorBrandIcon id={id} size={15} />;
}

export default function TopNav({ session, onLogout }: TopNavProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const setActiveConnector = useCrossFilter((s) => s.setActiveConnector);
  const connectorConfigs = useCrossFilter((s) => s.connectorConfigs);
  const connectorsVersion = useCrossFilter((s) => s.connectorsVersion);
  const [platforms, setPlatforms] = useState<ConnectorId[]>([]);

  useEffect(() => {
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
          /* fall through */
        }
      }
    }
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => setPlatforms(connectedConnectorsRaw(user)));
  }, [connectorsVersion]);

  const showSmartGoals = platforms.some((id) =>
    connectorHasFeature("smartGoals", connectorConfigs[id]),
  );
  const showOptimizer = platforms.some((id) =>
    connectorHasFeature("optimizer", connectorConfigs[id]),
  );

  const linkCls = (active: boolean) =>
    `flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition whitespace-nowrap ${
      active
        ? "bg-[var(--brand)]/12 text-[var(--brand-fg)] ring-1 ring-[var(--brand)]/25"
        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
    }`;

  const is = (href: string) => pathname === href;

  const leftItems: NavItem[] = [
    ...(showSmartGoals
      ? [{ label: "Watchtower", href: "/smart-goals", icon: NAV_ICONS.watchtower }]
      : []),
    ...(showOptimizer
      ? [{ label: "Forge AI", href: "/ai-optimizer", icon: NAV_ICONS.forgeAI }]
      : []),
  ];
  const rightItems: NavItem[] = [
    { label: "Pipelines", href: "/data-sources", icon: NAV_ICONS.pipelines },
    { label: "Account", href: "/profile", icon: NAV_ICONS.account },
    ...(session?.isAdmin
      ? [{ label: "Control Room", href: "/admin", icon: NAV_ICONS.controlRoom, adminOnly: true }]
      : []),
  ];

  const drawerItem = (item: NavItem) => (
    <Link
      key={item.href}
      href={item.href}
      onClick={() => {
        if (item.brandIcon) setActiveConnector(item.brandIcon);
        setMobileOpen(false);
      }}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition ${
        is(item.href)
          ? "bg-[var(--brand)]/12 text-[var(--brand-fg)]"
          : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
      }`}
    >
      <span className={is(item.href) ? "text-[var(--brand-fg)]" : "text-zinc-500"}>
        {item.icon}
      </span>
      {item.label}
    </Link>
  );

  return (
    <>
      {/* Desktop top command bar */}
      <header className="hidden lg:sticky lg:top-0 lg:z-40 lg:flex items-center gap-3 h-[60px] px-4 glass border-t-0 border-x-0">
        {/* Brand */}
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0 mr-1"
          onClick={() => setMobileOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/metricforge-logo.png"
            alt="MetricForge"
            width={30}
            height={30}
            className="object-contain"
          />
          <span
            className="text-[13px] font-black whitespace-nowrap text-[var(--brand-fg)]"
            style={{ letterSpacing: "0.1em" }}
          >
            METRICFORGE
          </span>
        </Link>

        <div className="w-px h-5 bg-zinc-800/80 mx-1 shrink-0" />

        {/* Source dashboards */}
        <nav className="flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-none">
          {platforms.map((id) => {
            const href = `/${connectorSlug(id)}`;
            return (
              <Link
                key={id}
                href={href}
                onClick={() => setActiveConnector(id)}
                title={CONNECTORS[id].label}
                className={linkCls(is(href))}
              >
                <ConnectorIcon id={id} />
                <span>{CONNECTORS[id].label}</span>
              </Link>
            );
          })}
          {platforms.length > 0 && <div className="w-px h-5 bg-zinc-800/80 mx-1 shrink-0" />}
          {leftItems.map((item) => (
            <Link key={item.href} href={item.href} className={linkCls(is(item.href))}>
              <span className={is(item.href) ? "text-[var(--brand-fg)]" : "text-zinc-500"}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Right cluster */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
            className="flex items-center gap-2 rounded-full border border-zinc-700/60 bg-zinc-800/40 px-3 py-1.5 text-[12.5px] text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition"
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
            Search
            <kbd className="text-[10px] text-zinc-600 border border-zinc-700/70 rounded px-1.5 py-0.5">
              ⌘K
            </kbd>
          </button>
          <PreferencesMenu />
          {onLogout && (
            <button
              onClick={onLogout}
              title="Sign out"
              aria-label="Sign out"
              className="w-8 h-8 rounded-full border border-zinc-800 flex items-center justify-center text-zinc-500 hover:text-red-400 hover:border-red-500/30 transition"
            >
              <svg
                width="14"
                height="14"
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
          {session?.avatar ? (
            <img
              src={session.avatar}
              alt={session.name}
              className="w-8 h-8 rounded-full shrink-0 object-cover ring-1 ring-zinc-800"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-fg))] flex items-center justify-center text-white text-[11px] font-bold shrink-0">
              {session?.name ? session.name.slice(0, 2).toUpperCase() : "U"}
            </div>
          )}
        </div>
      </header>

      {/* Mobile bar */}
      <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between px-4 h-[56px] glass border-x-0 border-t-0">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Menu"
          className="text-zinc-400 hover:text-zinc-200"
        >
          <svg
            width="20"
            height="20"
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
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/metricforge-logo.png"
            alt="MetricForge"
            width={26}
            height={26}
            className="object-contain"
          />
          <span
            className="text-[12px] font-black text-[var(--brand-fg)]"
            style={{ letterSpacing: "0.1em" }}
          >
            METRICFORGE
          </span>
        </div>
        <PreferencesMenu />
      </header>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-50 lg:hidden transition-opacity duration-300 ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileOpen(false)}
      />
      <div
        className={`fixed inset-y-0 left-0 z-[60] lg:hidden transition-transform duration-300 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="w-[272px] h-full glass rounded-r-2xl flex flex-col">
          <div className="flex items-center justify-between px-4 pt-5 pb-4 border-b border-zinc-800/70">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/metricforge-logo.png"
                alt="MetricForge"
                width={30}
                height={30}
                className="object-contain"
              />
              <span
                className="text-[12px] font-black text-[var(--brand-fg)]"
                style={{ letterSpacing: "0.1em" }}
              >
                METRICFORGE
              </span>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <svg
                width="17"
                height="17"
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
          <nav className="flex-1 overflow-y-auto px-2 pt-3 pb-4 space-y-0.5">
            {platforms.length > 0 && (
              <p className="px-3 pb-2 pt-1 text-[10.5px] font-semibold text-zinc-500 tracking-[0.8px] uppercase">
                Channels
              </p>
            )}
            {platforms.map((id) => {
              const href = `/${connectorSlug(id)}`;
              return (
                <Link
                  key={id}
                  href={href}
                  onClick={() => {
                    setActiveConnector(id);
                    setMobileOpen(false);
                  }}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition ${
                    is(href)
                      ? "bg-[var(--brand)]/12 text-[var(--brand-fg)]"
                      : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                  }`}
                >
                  <ConnectorIcon id={id} />
                  {CONNECTORS[id].label}
                </Link>
              );
            })}
            {(leftItems.length > 0 || rightItems.length > 0) && (
              <p className="px-3 pb-2 pt-3 text-[10.5px] font-semibold text-zinc-500 tracking-[0.8px] uppercase">
                Workspace
              </p>
            )}
            {leftItems.map(drawerItem)}
            {rightItems.map(drawerItem)}
          </nav>
          <div className="border-t border-zinc-800/70 p-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-fg))] flex items-center justify-center text-white text-[11px] font-bold shrink-0">
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
                className="shrink-0 p-2 text-zinc-500 hover:text-red-400 transition"
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
        </div>
      </div>
    </>
  );
}
