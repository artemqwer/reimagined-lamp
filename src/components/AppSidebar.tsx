"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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

// Icons — lucide-style 15px strokes
const I = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function ConnectorIcon({ id }: { id: ConnectorId }) {
  if (id === "google_ads") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/google-ads.png" alt="" className="w-3.5 h-3.5 object-contain" />;
  }
  return <ConnectorBrandIcon id={id} size={15} />;
}

export default function AppSidebar({
  session,
  onLogout,
  mobileOpen,
  onMobileClose,
}: {
  session?: Session | null;
  onLogout?: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
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
    if (typeof document !== "undefined" && document.cookie.includes("mf_shot=1")) {
      setPlatforms(["ga4"]);
      return;
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

  const nav = [
    ...(platforms.length
      ? [
          {
            label: "Overview",
            href: `/${connectorSlug(platforms[0])}`,
            icon: "grid",
            brand: platforms[0] as ConnectorId | undefined,
          },
        ]
      : []),
    ...(showSmartGoals ? [{ label: "Watchtower", href: "/smart-goals", icon: "chart" }] : []),
    ...(showOptimizer ? [{ label: "Forge AI", href: "/ai-optimizer", icon: "wand" }] : []),
  ].filter(Boolean) as { label: string; href: string; icon: string; brand?: ConnectorId }[];

  const itemCls = (active: boolean) =>
    `flex items-center gap-2.5 rounded-lg px-3 h-9 text-[13px] font-medium transition ${
      active
        ? "bg-white/[0.06] text-zinc-100"
        : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]"
    }`;

  const sideLabel = "px-3 mb-2 text-[9.5px] font-bold tracking-[1.15px] text-zinc-600 uppercase";

  const content = (
    <aside className="flex flex-col h-full w-[250px] shrink-0 px-3 py-4 overflow-y-auto scrollbar-none border-r border-white/[0.05]">
      {/* Brand */}
      <Link href="/" className="flex items-center gap-2 px-2 mb-5" onClick={onMobileClose}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/metricforge-logo.png"
          alt="MetricForge"
          width={30}
          height={30}
          className="object-contain"
        />
        <span
          className="text-[13px] font-black text-[var(--brand-fg)]"
          style={{ letterSpacing: "0.1em" }}
        >
          METRICFORGE
        </span>
      </Link>

      {/* Workspace switch */}
      <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 mb-6">
        <div className="w-8 h-8 rounded-lg bg-[var(--brand)]/15 text-[var(--brand-fg)] grid place-items-center text-[13px] font-bold shrink-0">
          {(session?.name ?? "W").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-zinc-100 truncate leading-tight">
            {session?.name ?? "Workspace"}
          </p>
          <p className="text-[10.5px] text-zinc-500 truncate">Growth workspace</p>
        </div>
      </div>

      {/* Workspace nav */}
      <p className={sideLabel}>Workspace</p>
      <nav className="space-y-0.5 mb-6">
        {nav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => {
                if (item.brand) setActiveConnector(item.brand);
                onMobileClose?.();
              }}
              className={itemCls(active)}
            >
              <span className="shrink-0 opacity-90">
                {item.brand ? (
                  <ConnectorIcon id={item.brand} />
                ) : item.icon === "chart" ? (
                  <svg {...I}>
                    <path d="M3 3v18h18" />
                    <path d="m7 14 3-3 3 2 5-6" />
                  </svg>
                ) : (
                  <svg {...I}>
                    <rect x="3" y="3" width="10" height="10" rx="2" />
                    <path d="M17 3h4v4h-4zM17 13l4 8M17 13h4" />
                  </svg>
                )}
              </span>
              {item.label}
              {item.label === "Watchtower" && (
                <span className="ml-auto text-[10px] text-zinc-600">3</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Connected sources */}
      {platforms.length > 0 && (
        <>
          <p className={sideLabel}>Connected sources</p>
          <div className="space-y-0.5 mb-4">
            {platforms.map((id) => {
              const href = `/${connectorSlug(id)}`;
              const active = pathname === href;
              return (
                <Link
                  key={id}
                  href={href}
                  onClick={() => {
                    setActiveConnector(id);
                    onMobileClose?.();
                  }}
                  className={itemCls(active)}
                >
                  <ConnectorIcon id={id} />
                  <span className="truncate">{CONNECTORS[id].label}</span>
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--brand-fg)]" />
                </Link>
              );
            })}
          </div>
          <Link
            href="/data-sources"
            onClick={onMobileClose}
            className="flex items-center gap-2.5 rounded-lg px-3 h-9 text-[13px] text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04] transition mb-6"
          >
            <svg {...I}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Connect a source
          </Link>
        </>
      )}

      {/* Weekly brief plan card */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3.5 mb-4">
        <div className="w-7 h-7 rounded-lg bg-[var(--brand)]/15 text-[var(--brand-fg)] grid place-items-center mb-2">
          <svg {...I}>
            <path d="M12 1.5C12.5 7.5 16.5 11.5 22.5 12C16.5 12.5 12.5 16.5 12 22.5C11.5 16.5 7.5 12.5 1.5 12C7.5 11.5 11.5 7.5 12 1.5Z" />
          </svg>
        </div>
        <p className="text-[12.5px] font-semibold text-zinc-100">Your weekly brief</p>
        <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
          Your next insight lands Monday morning.
        </p>
        <Link
          href="/smart-goals"
          onClick={onMobileClose}
          className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-zinc-300 mt-2.5 hover:text-zinc-100 transition"
        >
          Manage brief
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </Link>
      </div>

      {/* Bottom */}
      <div className="mt-auto pt-3 border-t border-white/[0.05]">
        <Link
          href="/profile"
          onClick={onMobileClose}
          className={`flex items-center gap-2.5 rounded-lg px-3 h-9 text-[13px] font-medium transition mb-1 ${
            pathname === "/profile"
              ? "bg-white/[0.06] text-zinc-100"
              : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]"
          }`}
        >
          <svg {...I}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Settings
        </Link>
        {session?.isAdmin && (
          <Link
            href="/admin"
            onClick={onMobileClose}
            className={`flex items-center gap-2.5 rounded-lg px-3 h-9 text-[13px] font-medium transition mb-1 ${
              pathname === "/admin"
                ? "bg-white/[0.06] text-zinc-100"
                : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]"
            }`}
          >
            <svg {...I}>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
            Control Room
          </Link>
        )}
        <div className="flex items-center gap-2.5 px-2 py-2">
          {session?.avatar ? (
            <img
              src={session.avatar}
              alt={session.name}
              className="w-8 h-8 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-[linear-gradient(135deg,var(--brand-fg),var(--brand))] grid place-items-center text-white text-[11px] font-bold">
              {(session?.name ?? "U").slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-zinc-100 truncate leading-tight">
              {session?.name ?? "User"}
            </p>
            <p className="text-[10.5px] text-zinc-500 truncate">{session?.email ?? ""}</p>
          </div>
          <PreferencesMenu />
          {onLogout && (
            <button
              onClick={onLogout}
              title="Sign out"
              className="w-8 h-8 rounded-lg grid place-items-center text-zinc-600 hover:text-red-400 transition"
            >
              <svg {...I}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop */}
      <div className="hidden lg:flex h-screen sticky top-0 z-30">{content}</div>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-50 lg:hidden transition-opacity duration-300 ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onMobileClose}
      />
      <div
        className={`fixed inset-y-0 left-0 z-[60] lg:hidden transition-transform duration-300 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {content}
      </div>

      {/* Mobile bar */}
      <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between px-4 h-[56px] glass border-x-0 border-t-0">
        <button onClick={() => onMobileClose?.()} aria-label="Menu" className="text-zinc-400">
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
        <button
          onClick={async () => {
            await logoutUser();
            router.replace("/login");
          }}
          className="text-zinc-500"
        >
          <svg {...I}>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </header>
    </>
  );
}
