"use client";

import React, { useState, useEffect, useCallback } from "react";
import { AiMessage, AiInsight, AiSelectionChip, renderAiText } from "../_data/constants";
import type { DateAction, FilterAction, ChatSession } from "../_data/constants";
import { useCrossFilter } from "@/lib/store";
import { getConnector } from "@/lib/connectors";

function DateActionCard({ action }: { action: DateAction }) {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  return (
    <div className="mt-2 flex items-center gap-2 bg-[var(--brand)]/8 border border-[var(--brand)]/20 rounded-xl px-3 py-2">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--brand-fg)"
        strokeWidth="2"
        className="shrink-0"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-[var(--brand-fg)]">{action.label}</p>
        <p className="text-[10px] text-zinc-500">
          {fmt(action.start)} – {fmt(action.end)}
        </p>
      </div>
      <span className="ml-auto text-[10px] font-medium text-[var(--brand-fg)] bg-[var(--brand)]/10 border border-[var(--brand)]/20 rounded-full px-2 py-0.5 shrink-0">
        Applied
      </span>
    </div>
  );
}

function FilterActionCard({ action, onApply }: { action: FilterAction; onApply: () => void }) {
  return (
    <button
      onClick={onApply}
      className="mt-2 w-full group flex items-center gap-2 bg-[var(--brand)]/8 hover:bg-[var(--brand)]/14 border border-[var(--brand)]/20 rounded-xl px-3 py-2 transition text-left cursor-pointer"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--brand-fg)"
        strokeWidth="2"
        className="shrink-0"
      >
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-[var(--brand-fg)] truncate">{action.label}</p>
        <p className="text-[10px] text-zinc-500">Apply filters to the dashboard</p>
      </div>
      <span className="ml-auto text-[11px] font-semibold text-[var(--brand-fg)] group-hover:translate-x-0.5 transition-transform shrink-0">
        Show →
      </span>
    </button>
  );
}

// Ordered checklist of the steps the assistant performed for a message, so the
// user can see exactly what the AI did (date applied, filters, data loaded…).
function ActionsList({ actions }: { actions: string[] }) {
  if (!actions.length) return null;
  return (
    <div className="mb-2 space-y-1 bg-[var(--brand)]/8 border border-[var(--brand)]/15 rounded-xl px-3 py-2">
      {actions.map((a, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--brand-fg)"
            strokeWidth="3"
            className="shrink-0"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {a}
        </div>
      ))}
    </div>
  );
}

function ConfidenceBadge({ level }: { level: AiInsight["confidence"] }) {
  if (!level) return null;
  const map = {
    High: "bg-[var(--brand)]/10 text-[var(--brand-fg)] border-[var(--brand)]/25",
    Medium: "bg-amber-500/10 text-amber-600 border-amber-500/25",
    Low: "bg-zinc-800 text-zinc-400 border-zinc-800",
  } as const;
  return (
    <span
      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${map[level]}`}
    >
      {level} confidence
    </span>
  );
}

function InsightCard({
  ins,
  index,
  onViewDashboard,
  onApplyFilter,
}: {
  ins: AiInsight;
  index: number;
  onViewDashboard: () => void;
  onApplyFilter: (a: FilterAction) => void;
}) {
  return (
    <div className="border border-zinc-800/80 rounded-2xl p-4 bg-[var(--surface)] shadow-sm">
      <div className="flex items-start gap-2 mb-1">
        <span className="w-5 h-5 rounded-full bg-linear-to-br from-[var(--brand-fg)] to-[var(--brand)] text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
          {index + 1}
        </span>
        <p className="text-[13px] font-semibold text-zinc-100 leading-snug flex-1">{ins.insight}</p>
      </div>
      {ins.confidence && (
        <div className="flex justify-end mb-1.5">
          <ConfidenceBadge level={ins.confidence} />
        </div>
      )}
      {/* Full analysis body (chat-level depth) — the numbers/breakdown the AI walked
          through. Rendered with the same markdown formatter the chat uses. */}
      {ins.details && (
        <div className="mt-1.5 text-[12.5px] text-zinc-300 leading-relaxed space-y-0.5">
          {renderAiText(ins.details)}
        </div>
      )}
      {ins.whyItMatters && (
        <div className="mt-2">
          <p className="text-[11px] font-bold text-[var(--brand-fg)] uppercase tracking-wide mb-0.5">
            Why It Matters
          </p>
          <p className="text-[12px] text-zinc-400">{ins.whyItMatters}</p>
        </div>
      )}
      {ins.rootCause && (
        <div className="mt-2.5">
          <p className="text-[11px] font-bold text-amber-500 uppercase tracking-wide mb-0.5">
            Root Cause
          </p>
          <p className="text-[12px] text-zinc-400">{ins.rootCause}</p>
        </div>
      )}
      {ins.action?.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[11px] font-bold text-[var(--brand-fg)] uppercase tracking-wide mb-1">
            Recommended Action
          </p>
          <ul className="space-y-0.5">
            {ins.action.map((a, i) => (
              <li key={i} className="text-[12px] text-zinc-400 flex gap-1.5">
                <span className="text-[var(--brand-fg)] shrink-0">•</span>
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ins.impact && (
        <div className="mt-2.5 pt-2.5 border-t border-zinc-800/70">
          <p className="text-[11px] font-bold text-[var(--brand-fg)] uppercase tracking-wide mb-0.5">
            Estimated Impact
          </p>
          <p className="text-[12px] text-[var(--brand-fg)] font-medium">{ins.impact}</p>
        </div>
      )}
      <div className="mt-3 pt-2.5 border-t border-zinc-800/70">
        {/* Applies the exact filters behind this insight (highlights the entities,
            rebuilds charts/tables). On desktop the chat panel stays open. Falls back
            to just revealing the dashboard when the insight has no filterable entity. */}
        <button
          onClick={() => {
            if (ins.filterAction) onApplyFilter(ins.filterAction);
            else onViewDashboard();
          }}
          className="flex items-center gap-1 text-[12px] font-medium text-[var(--brand-fg)] hover:brightness-110 transition"
        >
          View on dashboard
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
        </button>
      </div>
    </div>
  );
}

interface AiSidebarProps {
  aiOpen: boolean;
  aiInput: string;
  aiMsgs: AiMessage[];
  aiLoading: boolean;
  aiScrollRef: React.RefObject<HTMLDivElement>;
  // Ask Forge AI additions
  mode: "account" | "selection";
  dateRangeLabel: string;
  selectionChips: AiSelectionChip[];
  dataIncluded: string[];
  insights: AiInsight[];
  insightsLoading: boolean;
  suggestedQuestions: string[];
  focusQuestion?: string | null;
  onClose: () => void;
  onInputChange: (v: string) => void;
  onSendMsg: (text?: string) => void;
  onTogglePin: (id: number) => void;
  onApplyFilter: (action: FilterAction) => void;
  onAnalyze: (focus?: string, instructions?: string) => void;
  // Chat history
  currentSessionId: string | null;
  onNewChat: () => void;
  onLoadSession: (session: ChatSession) => void;
  onDeleteSession: (id: string) => void;
}

type PresetQuestion = { question: string; description: string };
// Fallback preset questions when an admin hasn't configured a custom set. Phrased
// per source so a cost-free connector isn't asked about budget / ROAS.
const DEFAULT_PRESET_QUESTIONS: PresetQuestion[] = [
  { question: "What should I optimize first?", description: "" },
  { question: "Where am I wasting budget?", description: "" },
  { question: "Which campaigns should I scale?", description: "" },
  { question: "What's hurting my ROAS?", description: "" },
  { question: "Find my biggest growth opportunities", description: "" },
];
const GA4_PRESET_QUESTIONS: PresetQuestion[] = [
  { question: "What should I optimize first?", description: "" },
  { question: "Which channels drive the most conversions?", description: "" },
  { question: "Where am I losing engaged traffic?", description: "" },
  { question: "Which landing pages underperform?", description: "" },
  { question: "Find my biggest growth opportunities", description: "" },
];
const SHOPIFY_PRESET_QUESTIONS: PresetQuestion[] = [
  { question: "What should I optimize first?", description: "" },
  { question: "Which products sell best?", description: "" },
  { question: "Where am I losing sales?", description: "" },
  { question: "How can I raise average order value?", description: "" },
  { question: "Find my biggest growth opportunities", description: "" },
];
function defaultPresetsFor(connector: string): PresetQuestion[] {
  if (connector === "ga4") return GA4_PRESET_QUESTIONS;
  if (connector === "shopify") return SHOPIFY_PRESET_QUESTIONS;
  return DEFAULT_PRESET_QUESTIONS;
}

// The assistant's mark — one shared spark so every corner of the chat feels like
// the same character.
function ForgeSpark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white">
      <path d="M12 1.5C12.5 7.5 16.5 11.5 22.5 12C16.5 12.5 12.5 16.5 12 22.5C11.5 16.5 7.5 12.5 1.5 12C7.5 11.5 11.5 7.5 12 1.5Z" />
      <circle cx="18.5" cy="5.5" r="1.4" />
    </svg>
  );
}

export default function AiSidebar({
  aiOpen,
  aiInput,
  aiMsgs,
  aiLoading,
  aiScrollRef,
  mode,
  dateRangeLabel,
  selectionChips,
  dataIncluded,
  insights,
  insightsLoading,
  suggestedQuestions,
  focusQuestion,
  onClose,
  onInputChange,
  onSendMsg,
  onTogglePin,
  onApplyFilter,
  onAnalyze,
  currentSessionId,
  onNewChat,
  onLoadSession,
  onDeleteSession,
}: AiSidebarProps) {
  const selectedCount = selectionChips.reduce((s, c) => s + c.values.length, 0);

  // Compact analysis-level summary, e.g. "Entire Account", "3 Campaigns Selected".
  const levelSummary =
    selectionChips.length === 0
      ? "Entire Account"
      : selectionChips
          .map((c) =>
            c.values.length === 1
              ? `${c.values[0]} ${c.dimension}s`
              : `${c.values.length} ${c.dimension}s Selected`,
          )
          .join(", ");

  const activeConnector = useCrossFilter((s) => s.activeConnector);
  // The question set is per data source (admin-editable in the Prompt Library);
  // the API resolves the active source's set, falling back to a shared one.
  const [serverPresets, setServerPresets] = useState<PresetQuestion[] | null>(null);
  useEffect(() => {
    setServerPresets(null);
    fetch(`/api/preset-questions?connector=${encodeURIComponent(activeConnector)}`)
      .then((r) => r.json())
      .then((d: { questions?: PresetQuestion[] }) => {
        if (Array.isArray(d.questions) && d.questions.length > 0) setServerPresets(d.questions);
      })
      .catch(() => {});
  }, [activeConnector]);
  const presetQuestions = serverPresets ?? defaultPresetsFor(activeConnector);

  // History panel
  const [historyView, setHistoryView] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  // Session pending delete-confirmation (null = no dialog open).
  const [confirmDelete, setConfirmDelete] = useState<ChatSession | null>(null);

  const loadSessions = useCallback(() => {
    setSessionsLoading(true);
    fetch("/api/ai-chats")
      .then((r) => r.json())
      .then((d: { sessions?: ChatSession[] }) => {
        if (Array.isArray(d.sessions)) setSessions(d.sessions);
      })
      .catch(() => {})
      .finally(() => setSessionsLoading(false));
  }, []);

  useEffect(() => {
    if (historyView) loadSessions();
  }, [historyView, loadSessions]);

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0)
      return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const handleDeleteSession = async (id: string) => {
    onDeleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setConfirmDelete(null);
  };

  const emptyChat = aiMsgs.length === 0 && insights.length === 0 && !insightsLoading;

  return (
    <>
      {/* Mobile backdrop */}
      {aiOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-99 lg:hidden animate-in fade-in duration-200"
          onClick={onClose}
        />
      )}

      {/* Sliding panel */}
      <div
        className={`fixed right-0 top-0 z-100 flex flex-col glass shadow-2xl border-l border-zinc-800/70 transition-transform duration-300 ease-out w-full sm:w-[420px] ${
          aiOpen ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ height: "100dvh" }}
      >
        {/* Header — who you're talking to */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/70 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 relative"
              style={{ background: "linear-gradient(135deg, var(--brand-fg), var(--brand))" }}
            >
              <ForgeSpark size={20} />
              {/* live status dot */}
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[var(--brand-fg)] ring-2 ring-[var(--surface)]">
                <span className="absolute inset-0 rounded-full bg-[var(--brand-fg)] animate-ping opacity-60 [animation-duration:2.5s]" />
              </span>
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-zinc-100 leading-tight">Forge Analyzer</h3>
              <p className="text-[11.5px] text-zinc-500 truncate">
                {levelSummary} · {dateRangeLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => {
                onNewChat();
                setHistoryView(false);
              }}
              title="New chat"
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-zinc-800/70 text-zinc-500 hover:text-zinc-200 transition"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button
              onClick={() => setHistoryView((v) => !v)}
              title="Chat history"
              className={`w-8 h-8 flex items-center justify-center rounded-xl transition ${
                historyView
                  ? "bg-[var(--brand)]/12 text-[var(--brand-fg)]"
                  : "hover:bg-zinc-800/70 text-zinc-500 hover:text-zinc-200"
              }`}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-zinc-800/70 text-zinc-500 hover:text-zinc-200 transition"
            >
              <svg
                width="15"
                height="15"
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
        </div>

        {/* Selection scope chips — only when a cross-filter is active */}
        {!historyView && selectionChips.length > 0 && (
          <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-5 py-2.5 border-b border-zinc-800/70">
            {selectionChips.map((c) => (
              <span
                key={c.dimension}
                className="text-[11px] bg-[var(--brand)]/10 border border-[var(--brand)]/20 text-[var(--brand-fg)] rounded-full px-2.5 py-1"
              >
                <span className="font-semibold">{c.dimension}:</span>{" "}
                {c.values.slice(0, 2).join(", ")}
                {c.values.length > 2 ? ` +${c.values.length - 2}` : ""}
              </span>
            ))}
          </div>
        )}

        {/* Scrollable content */}
        <div ref={aiScrollRef} className="flex-1 overflow-y-auto">
          {/* History */}
          {historyView && (
            <div className="p-4">
              {sessionsLoading ? (
                <div className="flex items-center justify-center py-10 gap-2 text-zinc-500 text-[13px]">
                  <div className="w-4 h-4 border-2 border-[var(--brand-fg)] border-t-transparent rounded-full animate-spin" />
                  Loading…
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-14">
                  <div className="w-10 h-10 rounded-full bg-zinc-800/70 flex items-center justify-center mx-auto mb-3 text-zinc-500">
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </div>
                  <p className="text-[13px] text-zinc-500">No conversations yet</p>
                  <p className="text-[11px] text-zinc-600 mt-1">
                    Your chats are saved automatically
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className={`group flex items-center gap-2 rounded-xl px-3.5 py-3 cursor-pointer transition border-l-2 ${
                        s.id === currentSessionId
                          ? "border-[var(--brand-fg)] bg-[var(--brand)]/8"
                          : "border-transparent hover:bg-zinc-800/50"
                      }`}
                      onClick={() => {
                        onLoadSession(s);
                        setHistoryView(false);
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-zinc-200 truncate">{s.title}</p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">{fmtDate(s.updated_at)}</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete(s);
                        }}
                        title="Delete chat"
                        className="w-6 h-6 flex items-center justify-center rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition shrink-0"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4h6v2" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chat */}
          {!historyView && (
            <div className="p-4 sm:p-5 space-y-4">
              {/* Welcome — the Analyzer introduces itself until the chat starts */}
              {emptyChat && (
                <div className="text-center pt-4 pb-2">
                  <div
                    className="w-14 h-14 rounded-3xl mx-auto mb-3 flex items-center justify-center relative"
                    style={{
                      background: "linear-gradient(135deg, var(--brand-fg), var(--brand))",
                      boxShadow: "0 8px 30px rgba(var(--brand-rgb), 0.35)",
                    }}
                  >
                    <ForgeSpark size={26} />
                    <span className="absolute -inset-2 rounded-[20px] border border-dashed border-[var(--brand)]/30 animate-ping opacity-50 [animation-duration:3s]" />
                  </div>
                  <p className="text-[15px] font-bold text-zinc-100">
                    Forge Analyzer here — what are we forging today?
                  </p>
                  <p className="text-[12px] text-zinc-500 mt-1">
                    Ask in plain English, or put one of these on the anvil.
                  </p>
                </div>
              )}

              {/* Preset questions */}
              {emptyChat && (
                <div className="space-y-1.5">
                  {presetQuestions.map((q, i) => (
                    // Only the question text is shown; the hidden description is
                    // sent to the AI as extra analysis instructions.
                    <button
                      key={`${q.question}-${i}`}
                      onClick={() => onAnalyze(q.question, q.description)}
                      className="group w-full flex items-center justify-between gap-2 text-[13px] text-zinc-300 bg-zinc-800/40 border border-zinc-800/70 rounded-xl px-3.5 py-2.5 text-left hover:border-[var(--brand)]/40 hover:bg-[var(--brand)]/8 transition"
                    >
                      <span>{q.question}</span>
                      <svg
                        className="text-zinc-600 group-hover:text-[var(--brand-fg)] group-hover:translate-x-0.5 shrink-0 transition"
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                  <button
                    onClick={() => onAnalyze()}
                    className="w-full flex items-center justify-center gap-2 text-[13px] font-semibold text-white rounded-xl px-3.5 py-2.5 hover:brightness-110 active:scale-[0.99] transition mt-1"
                    style={{ background: "linear-gradient(135deg, var(--brand-fg), var(--brand))" }}
                  >
                    <ForgeSpark size={13} />
                    Analyze {mode === "selection" ? "selection" : "full account"}
                  </button>
                  {dataIncluded.length > 0 && (
                    <p className="text-[10px] text-zinc-600 text-center pt-1">
                      Data included: {dataIncluded.join(", ")}
                    </p>
                  )}
                </div>
              )}

              {/* The picked preset question — kept above the response (like a chat
                  turn) so it's always clear what the AI is answering. */}
              {focusQuestion && (insightsLoading || insights.length > 0) && (
                <div className="flex justify-end">
                  <div className="max-w-[80%] bg-[var(--brand)] text-white rounded-2xl rounded-tr-sm px-4 py-2.5">
                    <p className="text-[13px] leading-relaxed">{focusQuestion}</p>
                  </div>
                </div>
              )}

              {/* AI Insights */}
              {insightsLoading ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, var(--brand-fg), var(--brand))" }}
                  >
                    <ForgeSpark size={18} />
                  </div>
                  <p className="text-[12px] text-zinc-500">
                    Heating the anvil — analyzing{" "}
                    {mode === "selection" ? "your selection" : "the account"}…
                  </p>
                </div>
              ) : insights.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-[10.5px] font-bold text-zinc-500 uppercase tracking-[0.8px]">
                    Insights
                  </p>
                  {insights.map((ins, i) => (
                    <InsightCard
                      key={i}
                      ins={ins}
                      index={i}
                      onApplyFilter={onApplyFilter}
                      onViewDashboard={() => {
                        onClose();
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    />
                  ))}
                </div>
              ) : null}

              {/* Suggested follow-ups */}
              {!insightsLoading && suggestedQuestions.length > 0 && (
                <div>
                  <p className="text-[10.5px] font-bold text-zinc-500 uppercase tracking-[0.8px] mb-1.5">
                    Keep digging
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestedQuestions.map((q) => (
                      <button
                        key={q}
                        onClick={() => onSendMsg(q)}
                        className="text-[12px] text-zinc-400 border border-zinc-800 rounded-full px-3 py-1.5 hover:bg-[var(--brand)]/10 hover:border-[var(--brand)]/30 hover:text-[var(--brand-fg)] transition text-left"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chat messages */}
              {aiMsgs.length > 0 && (
                <div className="space-y-4">
                  {aiMsgs.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === "user" ? "justify-end" : ""}`}
                    >
                      <div
                        className={`max-w-[85%] px-4 py-3 ${
                          msg.role === "assistant"
                            ? "bg-[var(--surface)] border border-zinc-800/70 rounded-2xl rounded-tl-sm shadow-sm"
                            : "bg-[var(--brand)] text-white rounded-2xl rounded-tr-sm"
                        }`}
                      >
                        {msg.role === "assistant" ? (
                          <>
                            {msg.actions && msg.actions.length > 0 && (
                              <ActionsList actions={msg.actions} />
                            )}
                            <div className="text-[13px] text-zinc-200 space-y-0.5">
                              {renderAiText(msg.text)}
                            </div>
                            {msg.dateAction && <DateActionCard action={msg.dateAction} />}
                            {msg.filterAction && (
                              <FilterActionCard
                                action={msg.filterAction}
                                onApply={() => onApplyFilter(msg.filterAction!)}
                              />
                            )}
                            <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-zinc-800/60">
                              <span className="text-[10px] text-zinc-500">{msg.time}</span>
                              <button
                                onClick={() => onTogglePin(msg.id)}
                                title={msg.pinned ? "Unpin" : "Pin"}
                                className={`transition ${msg.pinned ? "text-[var(--brand-fg)]" : "text-zinc-600 hover:text-zinc-400"}`}
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill={msg.pinned ? "currentColor" : "none"}
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <line x1="12" y1="17" x2="12" y2="22" />
                                  <path d="M5 17h14v-1.76a2 2 0 0 0-.85-1.65L16 12V5h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v7l-2.15 1.59A2 2 0 0 0 5 15.24V17z" />
                                </svg>
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="text-[13px] leading-relaxed">{msg.text}</p>
                            <p className="text-[10px] text-white/60 mt-1.5 text-right">
                              {msg.time}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Typing */}
              {aiLoading && (
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "linear-gradient(135deg, var(--brand-fg), var(--brand))" }}
                  >
                    <ForgeSpark size={13} />
                  </div>
                  <div className="bg-[var(--surface)] border border-zinc-800/70 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2.5">
                    <span className="flex items-center gap-1.5">
                      {[0, 0.15, 0.3].map((delay, i) => (
                        <span
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-[var(--brand-fg)] animate-bounce inline-block"
                          style={{ animationDelay: `${delay}s` }}
                        />
                      ))}
                    </span>
                    <span className="text-[12px] text-zinc-500">reading the numbers…</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer — floating pill */}
        <div className="px-4 pt-3 pb-4 border-t border-zinc-800/70 shrink-0">
          <div className="flex items-center gap-2 bg-zinc-800/40 border border-zinc-700/50 rounded-full pl-4 pr-1.5 py-1.5 focus-within:border-[var(--brand)]/40 transition">
            <input
              value={aiInput}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSendMsg();
                }
              }}
              placeholder="Ask the Analyzer anything…"
              className="flex-1 text-[14px] bg-transparent text-zinc-200 outline-none placeholder-zinc-600"
            />
            <button
              onClick={() => onSendMsg()}
              disabled={!aiInput.trim() || aiLoading}
              aria-label="Send"
              className="w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0 transition hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
              style={{ background: "linear-gradient(135deg, var(--brand-fg), var(--brand))" }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Delete-chat confirmation — sits above the AI panel (z-100). Works on all
          devices since the trash icon is always tappable on Mobile/Tablet. */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-120 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="card-elevate rounded-2xl shadow-xl w-full max-w-[320px] p-5 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center shrink-0 text-red-500">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
              </div>
              <div className="min-w-0">
                <h4 className="text-[15px] font-bold text-zinc-100">Delete chat?</h4>
                <p className="text-[12px] text-zinc-400 mt-0.5">
                  Are you sure you want to delete{" "}
                  <span className="font-medium text-zinc-300">“{confirmDelete.title}”</span>? This
                  can&apos;t be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 text-[13px] font-medium border border-zinc-800 text-zinc-400 py-2 rounded-xl hover:bg-zinc-800/60 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteSession(confirmDelete.id)}
                className="flex-1 text-[13px] font-medium bg-red-600 hover:brightness-110 text-white py-2 rounded-xl transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
