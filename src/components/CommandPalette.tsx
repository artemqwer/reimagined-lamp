"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import {
  connectedConnectorsRaw,
  connectorSlug,
  CONNECTORS,
  type ConnectorId,
} from "@/lib/connectors";
import { logoutUser } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/authz";

interface Item {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

// Product-wide command palette (⌘K / Ctrl+K). Pure client state — no backend.
export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const onOpen = () => setOpen(true);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, [close]);

  // Build the item list on open — session-driven, like the Sidebar.
  useEffect(() => {
    if (!open) return;
    const build = async () => {
      const nav: Item[] = [
        {
          id: "smart-goals",
          label: "Watchtower",
          hint: "Section",
          run: () => router.push("/smart-goals"),
        },
        {
          id: "ai-optimizer",
          label: "Forge AI",
          hint: "Section",
          run: () => router.push("/ai-optimizer"),
        },
        {
          id: "data-sources",
          label: "Pipelines",
          hint: "Section",
          run: () => router.push("/data-sources"),
        },
        { id: "profile", label: "Account", hint: "Account", run: () => router.push("/profile") },
      ];
      try {
        const {
          data: { user },
        } = await createClient().auth.getUser();
        if (user && isPlatformAdmin(user)) {
          nav.push({
            id: "admin",
            label: "Control Room",
            hint: "Account",
            run: () => router.push("/admin"),
          });
        }
        const platforms = connectedConnectorsRaw(user) as ConnectorId[];
        for (const id of platforms) {
          const slug = connectorSlug(id);
          nav.unshift({
            id: `src-${id}`,
            label: CONNECTORS[id].label,
            hint: "Dashboard",
            run: () => router.push(`/${slug}`),
          });
        }
      } catch {
        /* offline/unauthed — sections only */
      }
      nav.push({
        id: "signout",
        label: "Sign out",
        hint: "Action",
        run: async () => {
          await logoutUser();
          router.replace("/login");
        },
      });
      setItems(nav);
    };
    build();
  }, [open, router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => (i.label + " " + (i.keywords ?? "")).toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  if (!open) return null;

  const runAt = (i: number) => {
    const item = filtered[i];
    if (!item) return;
    close();
    item.run();
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[14vh] px-4"
      onClick={close}
    >
      <div
        className="glass rounded-2xl w-full max-w-[520px] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-800/80">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-zinc-500 shrink-0"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, filtered.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              }
              if (e.key === "Enter") {
                e.preventDefault();
                runAt(cursor);
              }
            }}
            placeholder="Jump to a section, source or action…"
            className="flex-1 bg-transparent text-[14px] text-zinc-200 placeholder-zinc-600 outline-none"
          />
          <kbd className="text-[10px] text-zinc-600 border border-zinc-800 rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>
        <div className="max-h-[320px] overflow-y-auto p-1.5 scrollbar-none">
          {filtered.length === 0 && (
            <p className="text-[13px] text-zinc-600 text-center py-8">No matches</p>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              onClick={() => runAt(i)}
              onMouseEnter={() => setCursor(i)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition ${
                i === cursor
                  ? "bg-emerald-500/10 text-[var(--brand-fg)]"
                  : "text-zinc-300 hover:bg-zinc-800/60"
              }`}
            >
              <span className="text-[14px] font-medium">{item.label}</span>
              {item.hint && <span className="text-[11px] text-zinc-600">{item.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
