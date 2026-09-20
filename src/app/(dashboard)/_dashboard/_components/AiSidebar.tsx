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
    <div className="mt-2 flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#2563EB"
        strokeWidth="2"
        className="shrink-0"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-emerald-700">{action.label}</p>
        <p className="text-[10px] text-emerald-500">
          {fmt(action.start)} – {fmt(action.end)}
        </p>
      </div>
      <span className="ml-auto text-[10px] font-medium text-green-600 bg-green-50 border border-green-100 rounded-full px-2 py-0.5 shrink-0">
        Applied
      </span>
    </div>
  );
}

function FilterActionCard({ action, onApply }: { action: FilterAction; onApply: () => void }) {
  return (
    <button
      onClick={onApply}
      className="mt-2 w-full group flex items-center gap-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 rounded-xl px-3 py-2 transition text-left cursor-pointer"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#2563EB"
        strokeWidth="2"
        className="shrink-0"
      >
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-emerald-700 truncate">{action.label}</p>
        <p className="text-[10px] text-emerald-500">Apply filters to the dashboard</p>
      </div>
      <span className="ml-auto text-[11px] font-semibold text-emerald-600 group-hover:translate-x-0.5 transition-transform shrink-0">
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
    <div className="mb-2 space-y-1 bg-violet-50/60 border border-violet-100 rounded-xl px-3 py-2">
      {actions.map((a, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[11px] text-gray-600">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#16a34a"
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
    High: "bg-green-50 text-green-700 border-green-200",
    Medium: "bg-amber-50 text-amber-700 border-amber-200",
    Low: "bg-gray-100 text-gray-500 border-gray-200",
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
    <div className="border border-gray-200 rounded-2xl p-4 bg-white shadow-sm">
      <div className="flex items-start gap-2 mb-1">
        <span className="w-5 h-5 rounded-full bg-linear-to-br from-violet-500 to-indigo-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
          {index + 1}
        </span>
        <p className="text-[13px] font-semibold text-gray-900 leading-snug flex-1">{ins.insight}</p>
      </div>
      {ins.confidence && (
        <div className="flex justify-end mb-1.5">
          <ConfidenceBadge level={ins.confidence} />
        </div>
      )}
      {/* Full analysis body (chat-level depth) — the numbers/breakdown the AI walked
          through. Rendered with the same markdown formatter the chat uses. */}
      {ins.details && (
        <div className="mt-1.5 text-[12.5px] text-gray-700 leading-relaxed space-y-0.5">
          {renderAiText(ins.details)}
        </div>
      )}
      {ins.whyItMatters && (
        <div className="mt-2">
          <p className="text-[11px] font-bold text-violet-600 uppercase tracking-wide mb-0.5">
            Why It Matters
          </p>
          <p className="text-[12px] text-gray-600">{ins.whyItMatters}</p>
        </div>
      )}
      {ins.rootCause && (
        <div className="mt-2.5">
          <p className="text-[11px] font-bold text-amber-600 uppercase tracking-wide mb-0.5">
            Root Cause
          </p>
          <p className="text-[12px] text-gray-600">{ins.rootCause}</p>
        </div>
      )}
      {ins.action?.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wide mb-1">
            Recommended Action
          </p>
          <ul className="space-y-0.5">
            {ins.action.map((a, i) => (
              <li key={i} className="text-[12px] text-gray-600 flex gap-1.5">
                <span className="text-emerald-400 shrink-0">•</span>
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ins.impact && (
        <div className="mt-2.5 pt-2.5 border-t border-gray-100">
          <p className="text-[11px] font-bold text-green-600 uppercase tracking-wide mb-0.5">
            Estimated Impact
          </p>
          <p className="text-[12px] text-green-700 font-medium">{ins.impact}</p>
        </div>
      )}
      <div className="mt-3 pt-2.5 border-t border-gray-100">
        {/* Applies the exact filters behind this insight (highlights the entities,
            rebuilds charts/tables). On desktop the chat panel stays open. Falls back
            to just revealing the dashboard when the insight has no filterable entity. */}
        <button
          onClick={() => {
            if (ins.filterAction) onApplyFilter(ins.filterAction);
            else onViewDashboard();
          }}
          className="flex items-center gap-1 text-[12px] font-medium text-violet-600 hover:text-violet-700 transition"
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
  // AI Analytics additions
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

  // Compact analysis-level summary for the always-visible context line, e.g.
  // "Entire Account", "3 Campaigns Selected", "Mobile Devices",
  // "Search Terms (15 selected), 2 Devices".
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

  return (
    <>
      {/* Mobile backdrop */}
      {aiOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-99 lg:hidden animate-in fade-in duration-200"
          onClick={onClose}
        />
      )}

      {/* Sliding panel */}
      <div
        className={`fixed right-0 top-0 z-100 flex flex-col bg-white shadow-2xl border-l border-gray-200 transition-transform duration-300 ease-out w-full sm:w-110 ${aiOpen ? "translate-x-0" : "translate-x-full"}`}
        style={{ height: "100dvh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg,#a78bfa,#818cf8)" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M12 1.5C12.5 7.5 16.5 11.5 22.5 12C16.5 12.5 12.5 16.5 12 22.5C11.5 16.5 7.5 12.5 1.5 12C7.5 11.5 11.5 7.5 12 1.5Z" />
              </svg>
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-gray-900">
                AI Analytics{selectedCount > 0 ? ` (${selectedCount} Selected)` : ""}
              </h3>
              <p className="text-[12px] text-gray-400">
                {mode === "selection" ? "Analyzing Selected Context" : "Entire Account"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setHistoryView((v) => !v)}
              title="Chat history"
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition ${historyView ? "bg-violet-100 text-violet-600" : "hover:bg-gray-100 text-gray-400"}`}
            >
              <svg
                width="16"
                height="16"
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
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition"
            >
              <svg
                width="16"
                height="16"
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

        {/* Persistent compact context line — stays visible while the chat scrolls
            so the user never loses track of WHAT is being analyzed (level + period).
            Updates automatically with selection / filters / period. Hidden in the
            history view. Especially important on mobile where the dashboard is off-screen. */}
        {!historyView && (
          <div className="shrink-0 flex items-center gap-2 px-5 py-2 bg-violet-50/70 border-b border-violet-100 text-[11px]">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#7C3AED"
              strokeWidth="2"
              className="shrink-0"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="font-semibold text-violet-700 truncate">{levelSummary}</span>
            <span className="text-violet-300 shrink-0">•</span>
            <span className="text-violet-600 whitespace-nowrap shrink-0">{dateRangeLabel}</span>
          </div>
        )}

        {/* Scrollable content */}
        <div ref={aiScrollRef} className="flex-1 overflow-y-auto">
          {/* History Panel */}
          {historyView && (
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[14px] font-bold text-gray-800">Chat History</p>
                <button
                  onClick={() => {
                    onNewChat();
                    setHistoryView(false);
                  }}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-violet-600 border border-violet-200 rounded-xl px-3 py-1.5 hover:bg-violet-50 transition"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  New chat
                </button>
              </div>

              {sessionsLoading ? (
                <div className="flex items-center justify-center py-10 gap-2 text-gray-400 text-[13px]">
                  <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                  Loading…
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#9CA3AF"
                      strokeWidth="1.8"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </div>
                  <p className="text-[13px] text-gray-400">No conversations yet</p>
                  <p className="text-[11px] text-gray-300 mt-1">
                    Your chats are saved automatically
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className={`group flex items-center gap-2 rounded-xl border px-3.5 py-3 cursor-pointer transition ${s.id === currentSessionId ? "border-violet-200 bg-violet-50/60" : "border-gray-200 hover:border-violet-200 hover:bg-violet-50/30"}`}
                      onClick={() => {
                        onLoadSession(s);
                        setHistoryView(false);
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-gray-800 truncate">{s.title}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{fmtDate(s.updated_at)}</p>
                      </div>
                      {/* Always visible on Mobile/Tablet (no hover); hover-only on
                          Desktop (lg+) to keep the list clean. */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete(s);
                        }}
                        title="Delete chat"
                        className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition shrink-0"
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

          {/* Context Panel */}
          {!historyView && (
            <>
              <div className="px-5 py-3 bg-violet-50/40 border-b border-gray-100">
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                  Current Context
                </p>
                <div className="flex items-center gap-1.5 mb-2 text-[12px] text-gray-600">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#6366F1"
                    strokeWidth="2"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  {dateRangeLabel}
                </div>
                {selectionChips.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selectionChips.map((c) => (
                      <span
                        key={c.dimension}
                        className="text-[11px] bg-white border border-violet-200 text-violet-700 rounded-full px-2 py-0.5"
                      >
                        <span className="font-semibold">{c.dimension}:</span>{" "}
                        {c.values.slice(0, 2).join(", ")}
                        {c.values.length > 2 ? ` +${c.values.length - 2}` : ""}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400">
                    Entire account — select rows in any table to narrow the analysis.
                  </p>
                )}
                {dataIncluded.length > 0 && (
                  <p className="text-[10px] text-gray-400 mt-2">
                    Data included: {dataIncluded.join(", ")}
                  </p>
                )}
              </div>

              <div className="p-5 space-y-4">
                {/* Preset questions — shown until the user starts an analysis or chats.
                Picking one runs the focused analysis (colored insight cards). */}
                {!insightsLoading && insights.length === 0 && aiMsgs.length === 0 && (
                  <div>
                    <p className="text-[13px] text-gray-600 mb-1">
                      Pick a question to analyze{" "}
                      {mode === "selection" ? "your selection" : "the account"}:
                    </p>
                    <p className="text-[11px] text-gray-400 mb-3">
                      or type your own below — the analysis runs only when you ask.
                    </p>
                    <div className="flex flex-col gap-2">
                      {presetQuestions.map((q, i) => (
                        // Only the question text is shown; the hidden description is
                        // sent to the AI as extra analysis instructions.
                        <button
                          key={`${q.question}-${i}`}
                          onClick={() => onAnalyze(q.question, q.description)}
                          className="group flex items-center justify-between gap-2 text-[13px] text-gray-700 border border-gray-200 rounded-xl px-3.5 py-2.5 text-left hover:border-violet-300 hover:bg-violet-50/40 transition"
                        >
                          <span>{q.question}</span>
                          <svg
                            className="text-gray-300 group-hover:text-violet-400 shrink-0 transition"
                            width="14"
                            height="14"
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
                    </div>
                    <div className="border-t border-gray-100 pt-3 mt-1">
                      <button
                        onClick={() => onAnalyze()}
                        className="group flex items-center justify-between gap-2 text-[13px] text-gray-700 border border-gray-200 rounded-xl px-3.5 py-2.5 text-left hover:border-violet-300 hover:bg-violet-50/40 transition w-full"
                      >
                        <span className="flex items-center gap-2">
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className="text-violet-400 shrink-0"
                          >
                            <path d="M12 1.5C12.5 7.5 16.5 11.5 22.5 12C16.5 12.5 12.5 16.5 12 22.5C11.5 16.5 7.5 12.5 1.5 12C7.5 11.5 11.5 7.5 12 1.5Z" />
                          </svg>
                          Analyze {mode === "selection" ? "selection" : "full account"}
                        </span>
                        <svg
                          className="text-gray-300 group-hover:text-violet-400 shrink-0 transition"
                          width="14"
                          height="14"
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
                )}

                {/* The picked preset question — kept above the response (like a chat turn)
                so it's always clear what the AI is answering. */}
                {focusQuestion && (insightsLoading || insights.length > 0) && (
                  <div className="flex justify-end">
                    <div className="max-w-[78%] bg-emerald-600 text-white rounded-2xl rounded-tr-sm px-4 py-3">
                      <p className="text-[13px] leading-relaxed">{focusQuestion}</p>
                    </div>
                  </div>
                )}

                {/* AI Insights */}
                {insightsLoading ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-3">
                    <div className="w-7 h-7 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-[12px] text-gray-400">
                      Analyzing {mode === "selection" ? "your selection" : "the account"}…
                    </p>
                  </div>
                ) : insights.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                      AI Insights
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

                {/* Suggested Questions */}
                {!insightsLoading && suggestedQuestions.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                      Suggested Questions
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestedQuestions.map((q) => (
                        <button
                          key={q}
                          onClick={() => onSendMsg(q)}
                          className="text-[12px] text-gray-600 border border-gray-200 rounded-full px-3 py-1 hover:bg-gray-50 hover:border-violet-300 transition text-left"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Chat messages */}
                {aiMsgs.length > 0 && (
                  <div className="space-y-4 pt-2 border-t border-gray-100">
                    {aiMsgs.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
                      >
                        {msg.role === "assistant" && (
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                            style={{ background: "linear-gradient(135deg,#a78bfa,#818cf8)" }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                              <path d="M12 1.5C12.5 7.5 16.5 11.5 22.5 12C16.5 12.5 12.5 16.5 12 22.5C11.5 16.5 7.5 12.5 1.5 12C7.5 11.5 11.5 7.5 12 1.5Z" />
                            </svg>
                          </div>
                        )}
                        <div
                          className={`max-w-[78%] ${msg.role === "assistant" ? "bg-gray-50 rounded-2xl rounded-tl-sm" : "bg-emerald-600 text-white rounded-2xl rounded-tr-sm"} px-4 py-3`}
                        >
                          {msg.role === "assistant" ? (
                            <>
                              {msg.actions && msg.actions.length > 0 && (
                                <ActionsList actions={msg.actions} />
                              )}
                              <div className="text-[13px] text-gray-800 space-y-0.5">
                                {renderAiText(msg.text)}
                              </div>
                              {msg.dateAction && <DateActionCard action={msg.dateAction} />}
                              {msg.filterAction && (
                                <FilterActionCard
                                  action={msg.filterAction}
                                  onApply={() => onApplyFilter(msg.filterAction!)}
                                />
                              )}
                              <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-gray-100">
                                <span className="text-[10px] text-gray-400">{msg.time}</span>
                                <button
                                  onClick={() => onTogglePin(msg.id)}
                                  title={msg.pinned ? "Unpin" : "Pin"}
                                  className={`transition ${msg.pinned ? "text-purple-500" : "text-gray-300 hover:text-gray-500"}`}
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
                              <p className="text-[10px] text-emerald-200 mt-1.5">{msg.time}</p>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {aiLoading && (
                  <div className="flex gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "linear-gradient(135deg,#a78bfa,#818cf8)" }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                        <path d="M12 1.5C12.5 7.5 16.5 11.5 22.5 12C16.5 12.5 12.5 16.5 12 22.5C11.5 16.5 7.5 12.5 1.5 12C7.5 11.5 11.5 7.5 12 1.5Z" />
                      </svg>
                    </div>
                    <div className="bg-gray-50 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                      {[0, 0.15, 0.3].map((delay, i) => (
                        <span
                          key={i}
                          className="w-2 h-2 rounded-full bg-gray-400 animate-bounce inline-block"
                          style={{ animationDelay: `${delay}s` }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Input */}
        <div className="px-5 pt-3 pb-4 border-t border-gray-100 shrink-0">
          <div className="flex gap-2">
            <input
              value={aiInput}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSendMsg();
                }
              }}
              placeholder="Ask anything about this context…"
              className="flex-1 text-[14px] border border-violet-200 focus:border-violet-400 rounded-xl px-4 py-2.5 outline-none placeholder-gray-300 transition"
            />
            <button
              onClick={() => onSendMsg()}
              disabled={!aiInput.trim() || aiLoading}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-white text-[14px] font-semibold transition disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#818cf8,#a78bfa)" }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Delete-chat confirmation — sits above the AI panel (z-100). Works on all
          devices since the trash icon is always tappable on Mobile/Tablet. */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-120 flex items-center justify-center p-4 bg-black/40 animate-in fade-in duration-150"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-[320px] p-5 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="2"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
              </div>
              <div className="min-w-0">
                <h4 className="text-[15px] font-bold text-gray-900">Delete chat?</h4>
                <p className="text-[12px] text-gray-500 mt-0.5">
                  Are you sure you want to delete{" "}
                  <span className="font-medium text-gray-700">“{confirmDelete.title}”</span>? This
                  can&apos;t be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 text-[13px] font-medium border border-gray-200 text-gray-600 py-2 rounded-xl hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteSession(confirmDelete.id)}
                className="flex-1 text-[13px] font-medium bg-red-600 hover:bg-red-700 text-white py-2 rounded-xl transition"
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
