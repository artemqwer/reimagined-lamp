"use client";

import { useEffect, useSyncExternalStore } from "react";

type AccentId = "forge" | "ember" | "iris";
type Density = "comfort" | "compact";
type BgStyle = "aurora" | "flat" | "carbon";

const ACCENTS: { id: AccentId; color: string; label: string }[] = [
  { id: "forge", color: "#10b981", label: "Forge" },
  { id: "ember", color: "#f97316", label: "Ember" },
  { id: "iris", color: "#8b5cf6", label: "Iris" },
];

// One generic localStorage-backed store factory (lint-safe, no state-in-effect).
function prefStore<T extends string>(key: string, fallback: T) {
  const listeners = new Set<() => void>();
  return {
    get: (): T =>
      (typeof window === "undefined" ? fallback : (localStorage.getItem(key) as T | null)) ??
      fallback,
    set: (v: T) => {
      localStorage.setItem(key, v);
      listeners.forEach((l) => l());
    },
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

const accentStore = prefStore<AccentId>("mf_accent", "forge");
const densityStore = prefStore<Density>("mf_density", "comfort");
const bgStore = prefStore<BgStyle>("mf_bg", "aurora");

const SEG =
  "flex-1 text-center px-2 py-1.5 rounded-xl text-[11.5px] font-medium transition cursor-pointer";

// Workspace preferences: accent, density, background — all live via data-attributes.
export default function PreferencesMenu() {
  const accent = useSyncExternalStore(
    accentStore.subscribe,
    accentStore.get,
    () => "forge" as AccentId,
  );
  const density = useSyncExternalStore(
    densityStore.subscribe,
    densityStore.get,
    () => "comfort" as Density,
  );
  const bg = useSyncExternalStore(bgStore.subscribe, bgStore.get, () => "aurora" as BgStyle);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.accent = accent;
    root.dataset.density = density;
    root.dataset.bg = bg;
  }, [accent, density, bg]);

  return (
    <div className="relative group/prefs shrink-0">
      <button
        aria-label="Workspace preferences"
        className="w-8 h-8 rounded-full border border-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 transition"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {/* Popover — opens on hover via CSS only, no state needed */}
      <div className="invisible opacity-0 group-hover/prefs:visible group-hover/prefs:opacity-100 hover:visible hover:opacity-100 transition-opacity absolute bottom-full left-0 mb-2 w-[228px] glass rounded-2xl p-3 z-50 shadow-2xl">
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-[0.8px] mb-2">
          Accent
        </p>
        <div className="flex items-center gap-2 mb-3">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => accentStore.set(a.id)}
              title={a.label}
              className={`w-5 h-5 rounded-full transition ${
                accent === a.id
                  ? "ring-2 ring-zinc-400 ring-offset-2 ring-offset-[#101013]"
                  : "opacity-60 hover:opacity-100"
              }`}
              style={{ background: a.color }}
            />
          ))}
        </div>
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-[0.8px] mb-2">
          Density
        </p>
        <div className="flex gap-1 bg-zinc-800/60 rounded-xl p-1 mb-3">
          <button
            onClick={() => densityStore.set("comfort")}
            className={`${SEG} ${density === "comfort" ? "bg-zinc-900 text-[var(--brand-fg)]" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            Comfort
          </button>
          <button
            onClick={() => densityStore.set("compact")}
            className={`${SEG} ${density === "compact" ? "bg-zinc-900 text-[var(--brand-fg)]" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            Compact
          </button>
        </div>
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-[0.8px] mb-2">
          Background
        </p>
        <div className="flex gap-1 bg-zinc-800/60 rounded-xl p-1">
          <button
            onClick={() => bgStore.set("aurora")}
            className={`${SEG} ${bg === "aurora" ? "bg-zinc-900 text-[var(--brand-fg)]" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            Aurora
          </button>
          <button
            onClick={() => bgStore.set("flat")}
            className={`${SEG} ${bg === "flat" ? "bg-zinc-900 text-[var(--brand-fg)]" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            Flat
          </button>
          <button
            onClick={() => bgStore.set("carbon")}
            className={`${SEG} ${bg === "carbon" ? "bg-zinc-900 text-[var(--brand-fg)]" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            Carbon
          </button>
        </div>
      </div>
    </div>
  );
}
