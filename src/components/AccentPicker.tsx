"use client";

import { useEffect, useSyncExternalStore } from "react";

const ACCENTS = [
  { id: "forge", color: "#10b981", label: "Forge" },
  { id: "ember", color: "#f97316", label: "Ember" },
  { id: "iris", color: "#8b5cf6", label: "Iris" },
] as const;

type AccentId = (typeof ACCENTS)[number]["id"];

const KEY = "mf_accent";
const listeners = new Set<() => void>();

// Tiny localStorage store so React can read the accent without
// state-in-effect (react-hooks/set-state-in-effect).
const store = {
  get: (): AccentId =>
    (typeof window === "undefined" ? "forge" : (localStorage.getItem(KEY) as AccentId | null)) ??
    "forge",
  set: (id: AccentId) => {
    localStorage.setItem(KEY, id);
    listeners.forEach((l) => l());
  },
  subscribe: (cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};

// Chrome accent picker — applied as data-accent on <html> (palettes in globals.css).
export default function AccentPicker() {
  const accent = useSyncExternalStore(store.subscribe, store.get, () => "forge" as AccentId);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  return (
    <div className="flex items-center gap-1.5" title="Accent color">
      {ACCENTS.map((a) => (
        <button
          key={a.id}
          onClick={() => store.set(a.id)}
          aria-label={`${a.label} accent`}
          className={`w-3.5 h-3.5 rounded-full transition ${
            accent === a.id
              ? "ring-2 ring-zinc-400 ring-offset-2 ring-offset-[#101013] scale-110"
              : "opacity-60 hover:opacity-100"
          }`}
          style={{ background: a.color }}
        />
      ))}
    </div>
  );
}
