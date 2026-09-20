"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseSession } from "@/lib/auth";
import type { AdminUser, Plan, SubStatus } from "@/app/api/admin/users/route";
import type { DbPrompt, PromptType } from "@/lib/prompts";
import {
  parsePresetQuestions,
  serializePresetQuestions,
  type PresetQuestion,
} from "@/lib/presetQuestions";
import ConnectorConfigPanel from "./ConnectorConfigPanel";
import BigQuerySyncPanel from "./BigQuerySyncPanel";
import { MOCK_USERS } from "@/lib/mockAdminData";

const PLANS: Plan[] = ["Free", "Professional", "Business", "Enterprise"];
const STATUSES: SubStatus[] = ["Active", "Trial", "Expired"];
const PLAN_PRICE: Record<Plan, number> = {
  Free: 0,
  Professional: 199,
  Business: 349,
  Enterprise: 499,
};
const PAGE_SIZE = 10;

const usd = (n: number | undefined | null) => `$${(n ?? 0).toLocaleString("en-US")}`;

function PlanBadge({ plan }: { plan: Plan }) {
  const map: Record<Plan, string> = {
    Free: "bg-gray-100 text-gray-600",
    Professional: "bg-emerald-50 text-emerald-700",
    Business: "bg-pink-50 text-pink-600",
    Enterprise: "bg-purple-50 text-purple-700",
  };
  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-[12px] font-medium whitespace-nowrap ${map[plan] ?? "bg-gray-100 text-gray-600"}`}
    >
      {plan}
    </span>
  );
}

function StatusBadge({ status }: { status: SubStatus }) {
  const map: Record<SubStatus, { cls: string; icon: React.ReactNode }> = {
    Active: {
      cls: "bg-green-50 text-green-700 border-green-200",
      icon: (
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="9 12 11.5 14.5 16 9.5" />
        </svg>
      ),
    },
    Trial: {
      cls: "bg-yellow-50 text-yellow-700 border-yellow-200",
      icon: (
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 7 12 12 15 14" />
        </svg>
      ),
    },
    Expired: {
      cls: "bg-red-50 text-red-600 border-red-200",
      icon: (
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      ),
    },
  };
  const { cls, icon } = map[status] ?? map.Active;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-medium border whitespace-nowrap ${cls}`}
    >
      {icon}
      {status}
    </span>
  );
}

function Kpi({
  icon,
  iconBg,
  value,
  delta,
  deltaUp,
  label,
}: {
  icon: React.ReactNode;
  iconBg: string;
  value: string;
  delta?: string;
  deltaUp?: boolean;
  label: string;
}) {
  // Figma 1:19211 — flat card (#e5e7eb border, rounded-10). Horizontal: 32px
  // squircle icon, then value (24px Bold #101828) + delta (14px SemiBold green/
  // red) inline, label (14px Regular #4a5565) below, info icon top-right.
  return (
    <div className="relative bg-white rounded-xl border border-gray-200 px-4 pr-9 py-4 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div
          className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
          style={{ background: iconBg }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="text-[20px] sm:text-[24px] font-bold text-[#101828] leading-7 sm:leading-8 truncate">
              {value}
            </p>
            {delta && (
              <span
                className={`text-[14px] font-semibold ${deltaUp ? "text-[#00a63e]" : "text-red-500"}`}
              >
                {deltaUp ? "+" : ""}
                {delta}
              </span>
            )}
          </div>
          <p className="text-[14px] text-[#4a5565] leading-5">{label}</p>
        </div>
      </div>
      <svg
        className="absolute top-4 right-4"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#99A1AF"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </div>
  );
}

interface EditModalProps {
  user: AdminUser;
  onClose: () => void;
  onSave: (id: string, d: Partial<AdminUser> & Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}
function EditModal({ user, onClose, onSave, onDelete }: EditModalProps) {
  const [name, setName] = useState(user.name);
  const [company, setCompany] = useState(user.company);
  const [phone, setPhone] = useState(user.phone);
  const [plan, setPlan] = useState<Plan>(user.plan);
  const [status, setStatus] = useState<SubStatus>(user.status);
  const [expiry, setExpiry] = useState(user.expiry ?? "");
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave(user.id, {
        full_name: name,
        company,
        phone,
        plan,
        subscription_status: status,
        subscription_expiry: expiry || null,
        is_admin: isAdmin,
      } as never);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      setBusy(false);
    }
  };
  const del = async () => {
    setBusy(true);
    setError("");
    try {
      await onDelete(user.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-[16px] font-bold text-gray-900">Edit User</h2>
            <p className="text-[12px] text-gray-400 mt-0.5">{user.email}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 transition"
          >
            <svg
              width="14"
              height="14"
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

        <div className="space-y-3.5">
          <Field label="Full Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Company">
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Phone">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Plan">
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value as Plan)}
                className={inputCls + " bg-white cursor-pointer"}
              >
                {PLANS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as SubStatus)}
                className={inputCls + " bg-white cursor-pointer"}
              >
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Subscription Expiry">
            <input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className={inputCls}
            />
          </Field>

          <button
            type="button"
            onClick={() => setIsAdmin((v) => !v)}
            className="w-full flex items-center justify-between gap-3 border border-gray-200 rounded-lg px-3 py-2.5 hover:bg-gray-50 transition"
          >
            <div className="flex items-center gap-2 text-left">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke={isAdmin ? "#7C3AED" : "#9CA3AF"}
                strokeWidth="2"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <div>
                <p className="text-[13px] font-medium text-gray-700">Admin access</p>
                <p className="text-[11px] text-gray-400">Can view & manage all users</p>
              </div>
            </div>
            <span
              className={`w-9 h-5 rounded-full p-0.5 transition shrink-0 ${isAdmin ? "bg-purple-600" : "bg-gray-200"}`}
            >
              <span
                className={`block w-4 h-4 rounded-full bg-white transition-transform ${isAdmin ? "translate-x-4" : ""}`}
              />
            </span>
          </button>
        </div>

        {error && <p className="text-[12px] text-red-500 mt-3">{error}</p>}

        <div className="flex gap-2 mt-5">
          {confirmDel ? (
            <>
              <button
                onClick={() => setConfirmDel(false)}
                className="flex-1 text-[13px] font-medium border border-gray-200 text-gray-600 py-2 rounded-xl hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={del}
                disabled={busy}
                className="flex-1 text-[13px] font-medium bg-red-600 hover:bg-red-700 text-white py-2 rounded-xl transition disabled:opacity-50"
              >
                {busy ? "Deleting…" : "Delete account"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setConfirmDel(true)}
                className="text-[13px] font-medium border border-red-200 text-red-600 px-3 py-2 rounded-xl hover:bg-red-50 transition"
              >
                Delete
              </button>
              <button
                onClick={onClose}
                className="flex-1 text-[13px] font-medium border border-gray-200 text-gray-600 py-2 rounded-xl hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="flex-1 text-[13px] font-medium bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-xl transition disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
const inputCls =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-emerald-400";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-medium text-gray-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

function Bars({ rows }: { rows: { label: string; value: number; color: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="text-[12px] text-gray-500 w-28 shrink-0">{r.label}</span>
          <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${(r.value / max) * 100}%`, background: r.color }}
            />
          </div>
          <span className="text-[12px] font-semibold text-gray-700 w-16 text-right shrink-0">
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

type SortDir = "asc" | "desc";

// ─── Prompt Library ──────────────────────────────────────────────────────────

// Every `preset_*` type is a question list (edited as items, not prose).
const isPresetType = (t?: PromptType) => !!t && t.startsWith("preset_");

// Core is shared; every data source then has its own analyst prompt AND its own
// quick-question set, so the AI reasons in that source's terms (GA4 has no ROAS).
const PROMPT_TYPES: { id: PromptType; label: string; hint?: string }[] = [
  { id: "core", label: "Core Analyst" },
  { id: "google_ads", label: "Google Ads Analyst" },
  { id: "meta_ads", label: "Meta Ads Analyst" },
  { id: "ga4", label: "Google Analytics 4 Analyst" },
  { id: "shopify", label: "Shopify Analyst" },
  {
    id: "preset_google_ads",
    label: "Preset Questions — Google Ads",
    hint: "Quick questions shown in the AI panel on the Google Ads dashboard.",
  },
  {
    id: "preset_meta_ads",
    label: "Preset Questions — Meta Ads",
    hint: "Quick questions shown in the AI panel on the Meta Ads dashboard.",
  },
  {
    id: "preset_ga4",
    label: "Preset Questions — Google Analytics 4",
    hint: "Quick questions shown in the AI panel on the GA4 dashboard.",
  },
  {
    id: "preset_shopify",
    label: "Preset Questions — Shopify",
    hint: "Quick questions shown in the AI panel on the Shopify dashboard.",
  },
  {
    id: "preset_questions",
    label: "Preset Questions (shared fallback)",
    hint: "Used only for sources without their own question set.",
  },
  {
    id: "optimizer_google_ads",
    label: "AI Optimizer — Google Ads",
    hint: "How the AI Optimizer words its findings for Google Ads. The findings' numbers stay computed; this shapes the wording only.",
  },
  {
    id: "optimizer_meta_ads",
    label: "AI Optimizer — Meta Ads",
    hint: "How the AI Optimizer words its findings for Meta Ads. Numbers stay computed; this shapes the wording only.",
  },
  {
    id: "optimizer_ga4",
    label: "AI Optimizer — Google Analytics 4",
    hint: "How the AI Optimizer words its findings for GA4. Numbers stay computed; this shapes the wording only.",
  },
  {
    id: "optimizer_shopify",
    label: "AI Optimizer — Shopify",
    hint: "How the AI Optimizer words its findings for Shopify. Numbers stay computed; this shapes the wording only.",
  },
];

function QuestionList({
  items,
  onChange,
}: {
  items: PresetQuestion[];
  onChange: (items: PresetQuestion[]) => void;
}) {
  const move = (from: number, to: number) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  const update = (i: number, patch: Partial<PresetQuestion>) => {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => {
    const next = [...items];
    next.splice(i, 1);
    onChange(next);
  };
  const add = () => onChange([...items, { question: "", description: "" }]);
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="border border-gray-200 rounded-xl p-2.5 bg-gray-50/40">
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
                className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-30 transition"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
              <button
                type="button"
                disabled={i === items.length - 1}
                onClick={() => move(i, i + 1)}
                className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-30 transition"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
            <input
              value={it.question}
              onChange={(e) => update(i, { question: e.target.value })}
              placeholder={`Question ${i + 1}`}
              className={inputCls + " flex-1 bg-white"}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="w-7 h-7 flex items-center justify-center text-gray-300 hover:text-red-400 transition shrink-0"
            >
              <svg
                width="13"
                height="13"
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
          {/* Hidden AI instructions for this question — not shown to the user; sent
              to the AI together with the question. Optional, multiline. */}
          <textarea
            value={it.description}
            onChange={(e) => update(i, { description: e.target.value })}
            rows={2}
            placeholder="Prompt Description / AI instructions (optional, hidden from the user) — e.g. 'Analyze only Mobile device data, compare vs Desktop, focus on ROAS/Revenue/Cost, return one insight card.'"
            className={
              inputCls +
              " mt-2 ml-7 w-[calc(100%-1.75rem)] text-[12px] leading-relaxed resize-y bg-white"
            }
          />
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-[12px] text-emerald-600 hover:text-emerald-700 border border-dashed border-emerald-200 rounded-lg px-3 py-1.5 w-full justify-center hover:bg-emerald-50 transition"
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
        Add question
      </button>
    </div>
  );
}

function PromptEditor({
  prompt,
  onClose,
  onSaved,
  showToast,
}: {
  prompt: DbPrompt | "new";
  onClose: () => void;
  onSaved: () => void;
  showToast: (t: "success" | "error", s: string) => void;
}) {
  const isNew = prompt === "new";
  const p = isNew ? null : prompt;
  const [name, setName] = useState(p?.name ?? "");
  const [type, setType] = useState<PromptType>(p?.type ?? "core");
  const [content, setContent] = useState(p?.content ?? "");
  const [active, setActive] = useState(p?.active ?? false);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  // Preset questions are edited as structured items (question + optional hidden
  // AI instructions) held in their own state; serialized to `content` only on save.
  // Only seed them from a prompt that IS a question list — otherwise switching the
  // Type dropdown on a prose prompt would shred its text into one "question" per
  // line (and saving would overwrite the prompt with that).
  const [questionItems, setQuestionItems] = useState<PresetQuestion[]>(() =>
    p && isPresetType(p.type) ? parsePresetQuestions(p.content) : [],
  );

  const save = async () => {
    const isPreset = isPresetType(type);
    const finalContent = isPreset ? serializePresetQuestions(questionItems) : content;
    if (!name.trim()) {
      showToast("error", "Name is required");
      return;
    }
    if (!finalContent.trim() || (isPreset && parsePresetQuestions(finalContent).length === 0)) {
      showToast("error", isPreset ? "Add at least one question" : "Content is required");
      return;
    }
    setBusy(true);
    try {
      const url = isNew ? "/api/admin/prompts" : `/api/admin/prompts/${p!.id}`;
      const res = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, content: finalContent, active }),
      });
      if (!res.ok)
        throw new Error(((await res.json()) as { error?: string }).error ?? "Save failed");
      showToast("success", isNew ? "Prompt created" : "Prompt saved");
      onSaved();
      onClose();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  };
  const del = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/prompts/${p!.id}`, { method: "DELETE" });
      if (!res.ok)
        throw new Error(((await res.json()) as { error?: string }).error ?? "Delete failed");
      showToast("success", "Prompt deleted");
      onSaved();
      onClose();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[16px] font-bold text-gray-900">
            {isNew ? "New Prompt" : "Edit Prompt"}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 transition"
          >
            <svg
              width="14"
              height="14"
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
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prompt Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Core Analyst v2"
                className={inputCls}
              />
            </Field>
            <Field label="Type">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as PromptType)}
                className={inputCls + " bg-white cursor-pointer"}
              >
                {PROMPT_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {isPresetType(type) ? (
            <Field label="Questions">
              <p className="text-[11px] text-gray-400 mb-2">
                Each question shows in the AI panel. Add an optional hidden &ldquo;Prompt
                Description&rdquo; per question to tell the AI exactly how to analyze it — the user
                sees only the question.
              </p>
              <QuestionList items={questionItems} onChange={setQuestionItems} />
            </Field>
          ) : (
            <Field label="Prompt Text">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={14}
                className={inputCls + " font-mono text-[12px] leading-relaxed resize-y"}
                placeholder="The full system prompt…"
              />
            </Field>
          )}
          <button
            type="button"
            onClick={() => setActive((v) => !v)}
            className="w-full flex items-center justify-between gap-3 border border-gray-200 rounded-lg px-3 py-2.5 hover:bg-gray-50 transition"
          >
            <div className="text-left">
              <p className="text-[13px] font-medium text-gray-700">Active</p>
              <p className="text-[11px] text-gray-400">
                The AI uses the active prompt of each type (one active per type)
              </p>
            </div>
            <span
              className={`w-9 h-5 rounded-full p-0.5 transition shrink-0 ${active ? "bg-green-600" : "bg-gray-200"}`}
            >
              <span
                className={`block w-4 h-4 rounded-full bg-white transition-transform ${active ? "translate-x-4" : ""}`}
              />
            </span>
          </button>
        </div>
        <div className="flex gap-2 mt-5">
          {!isNew &&
            (confirmDel ? (
              <button
                onClick={del}
                disabled={busy}
                className="text-[13px] font-medium bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-xl transition disabled:opacity-50"
              >
                Confirm delete
              </button>
            ) : (
              <button
                onClick={() => setConfirmDel(true)}
                className="text-[13px] font-medium border border-red-200 text-red-600 px-3 py-2 rounded-xl hover:bg-red-50 transition"
              >
                Delete
              </button>
            ))}
          <button
            onClick={onClose}
            className="flex-1 text-[13px] font-medium border border-gray-200 text-gray-600 py-2 rounded-xl hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 text-[13px] font-medium bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-xl transition disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptsPanel({ showToast }: { showToast: (t: "success" | "error", s: string) => void }) {
  const [prompts, setPrompts] = useState<DbPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState("");
  const [edit, setEdit] = useState<DbPrompt | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setSetupError("");
    try {
      const res = await fetch("/api/admin/prompts");
      const j = (await res.json()) as { prompts?: DbPrompt[]; error?: string };
      setPrompts(j.prompts ?? []);
      if (j.error) setSetupError(j.error);
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const activate = async (id: string) => {
    const res = await fetch(`/api/admin/prompts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    if (res.ok) {
      showToast("success", "Prompt activated");
      load();
    } else showToast("error", "Could not activate");
  };
  const [seeding, setSeeding] = useState(false);
  const seed = async () => {
    if (seeding) return; // guard against double-submit (which used to duplicate)
    setSeeding(true);
    try {
      const res = await fetch("/api/admin/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: true }),
      });
      if (res.ok) {
        showToast("success", "Built-in prompts loaded");
        await load();
      } else showToast("error", "Could not load defaults");
    } finally {
      setSeeding(false);
    }
  };
  const dedupe = async () => {
    const res = await fetch("/api/admin/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dedupe: true }),
    });
    const j = (await res.json().catch(() => ({}))) as { removed?: number };
    if (res.ok) {
      showToast(
        "success",
        j.removed
          ? `Removed ${j.removed} duplicate${j.removed > 1 ? "s" : ""}`
          : "No duplicates found",
      );
      load();
    } else showToast("error", "Could not remove duplicates");
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const tableMissing = /relation|does not exist|42P01|schema cache|find the table/i.test(
    setupError,
  );
  // Detect duplicate (type+name) prompts to offer a one-click cleanup.
  const dupeCount = (() => {
    const seen = new Map<string, number>();
    for (const p of prompts) {
      const k = `${p.type}|${p.name}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return [...seen.values()].reduce((s, n) => s + Math.max(0, n - 1), 0);
  })();

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-4 sm:px-5 py-3.5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-[14px] font-bold text-gray-800">Prompt Library</p>
          <p className="text-[12px] text-gray-400">
            System prompts the AI uses — edit & activate without touching code
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {dupeCount > 0 && (
            <button
              onClick={dedupe}
              className="flex items-center gap-1.5 border border-amber-200 bg-amber-50 text-amber-700 text-[12px] font-semibold px-3 py-2 rounded-xl hover:bg-amber-100 transition"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
              Remove {dupeCount} duplicate{dupeCount > 1 ? "s" : ""}
            </button>
          )}
          <button
            onClick={() => setEdit("new")}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold px-3.5 py-2 rounded-xl transition"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Prompt
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 gap-2 text-gray-400 text-[14px]">
          <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      )}

      {!loading && tableMissing && (
        <div className="px-5 py-10 text-center">
          <p className="text-[14px] font-semibold text-gray-700 mb-1">
            Prompt Library table isn&apos;t set up yet
          </p>
          <p className="text-[12px] text-gray-400 mb-4 max-w-md mx-auto">
            Run the SQL snippet (in the repo / provided by the developer) in your Supabase SQL
            editor to create the <code className="bg-gray-100 px-1 rounded">prompts</code> table,
            then refresh. Until then the AI uses the built-in default prompts.
          </p>
          <button onClick={load} className="text-[12px] text-emerald-600 hover:underline">
            Refresh
          </button>
        </div>
      )}

      {!loading && !tableMissing && (
        <div className="divide-y divide-gray-50">
          {prompts.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-[13px] text-gray-400 mb-3">
                No prompts yet. The AI is using the built-in defaults.
              </p>
              <button
                onClick={seed}
                disabled={seeding}
                className="text-[13px] font-semibold text-emerald-600 border border-emerald-200 rounded-xl px-4 py-2 hover:bg-emerald-50 transition disabled:opacity-50 inline-flex items-center gap-2"
              >
                {seeding && (
                  <span className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                )}
                Load built-in prompts to edit
              </button>
            </div>
          ) : (
            prompts.map((p) => {
              const meta = PROMPT_TYPES.find((t) => t.id === p.type);
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 px-5 py-3.5 hover:bg-emerald-50/20 transition cursor-pointer"
                  onClick={() => setEdit(p)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] font-semibold text-gray-800">{p.name}</p>
                      {p.active && (
                        <span className="text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5">
                          Active
                        </span>
                      )}
                      <span className="text-[10px] font-medium text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5">
                        {meta?.label ?? p.type}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                      {p.content.slice(0, 120)}…
                    </p>
                    <p className="text-[10px] text-gray-300 mt-0.5">Updated {fmt(p.updated_at)}</p>
                  </div>
                  {!p.active && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        activate(p.id);
                      }}
                      className="text-[12px] font-medium text-emerald-600 border border-emerald-200 rounded-lg px-2.5 py-1 hover:bg-emerald-50 transition shrink-0"
                    >
                      Activate
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* key → a fresh editor per prompt, so no field ever carries over from the
          previously opened one. */}
      {edit && (
        <PromptEditor
          key={edit === "new" ? "new" : edit.id}
          prompt={edit}
          onClose={() => setEdit(null)}
          onSaved={load}
          showToast={showToast}
        />
      )}
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  // Demo-data switch: fills the panel from src/lib/mockAdminData while the real
  // DB is still being built. Persisted so it survives reloads.
  const [mockMode, setMockMode] = useState(false);
  useEffect(() => {
    setMockMode(localStorage.getItem("admin:mock") === "1");
  }, []);
  // Global sign-up switch (server-side, stored in Supabase). null while loading.
  const [regEnabled, setRegEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/registration")
      .then((r) => r.json())
      .then((d) => setRegEnabled(d?.enabled !== false))
      .catch(() => {});
  }, []);
  const toggleRegistration = useCallback(async () => {
    const next = !regEnabled;
    setRegEnabled(next);
    await fetch("/api/registration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => setRegEnabled(!next));
  }, [regEnabled]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [tab, setTab] = useState<"users" | "analytics" | "prompts" | "connectors">("users");
  // null while we ask; the panel waits rather than flashing either answer.
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    getSupabaseSession().then((s) => setAllowed(!!s?.isAdmin));
  }, []);

  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("All Plans");
  const [statusFilter, setStatusFilter] = useState("All Statuses");
  const [range, setRange] = useState("All time");
  const [sortCol, setSortCol] = useState<keyof AdminUser>("lastLoginMins");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);

  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError("");
    if (mockMode) {
      setUsers(MOCK_USERS);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/admin/users");
      const json = (await res.json()) as { users?: AdminUser[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load users");
      setUsers(json.users ?? []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [mockMode]);
  useEffect(() => {
    load();
  }, [load]);
  // Open the edit modal when arriving from the detail page (/admin?edit=<id>).
  useEffect(() => {
    if (!users.length) return;
    const editId = new URLSearchParams(window.location.search).get("edit");
    if (editId) {
      const u = users.find((x) => x.id === editId);
      if (u) setEditUser(u);
      window.history.replaceState(null, "", "/admin");
    }
  }, [users]);

  const handleSave = async (id: string, data: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Save failed");
    showToast("success", "User updated");
    await load();
  };
  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    if (!res.ok)
      throw new Error(((await res.json()) as { error?: string }).error ?? "Delete failed");
    showToast("success", "Account deleted");
    await load();
  };

  // ── KPIs ──
  const now = Date.now();
  const monthMs = 30 * 86_400_000;
  const mrr = users.reduce((s, u) => s + u.revenueMonthly, 0);
  const activeCount = users.filter((u) => u.status === "Active").length;
  const expiredCount = users.filter((u) => u.status === "Expired").length;
  const churn = users.length ? (expiredCount / users.length) * 100 : 0;
  const newThisMonth = users.filter((u) => now - u.registeredMs <= monthMs);
  const newMrr = newThisMonth.reduce((s, u) => s + u.revenueMonthly, 0);

  // ── Filtering / sorting ──
  const filtered = useMemo(() => {
    let rows = [...users];
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.company.toLowerCase().includes(q),
      );
    }
    if (planFilter !== "All Plans") rows = rows.filter((u) => u.plan === planFilter);
    if (statusFilter !== "All Statuses") rows = rows.filter((u) => u.status === statusFilter);
    if (range !== "All time") {
      const days = range === "Last 30 days" ? 30 : range === "Last 90 days" ? 90 : 365;
      rows = rows.filter((u) => now - u.registeredMs <= days * 86_400_000);
    }
    rows.sort((a, b) => {
      const av = a[sortCol],
        bv = b[sortCol];
      if (typeof av === "number" && typeof bv === "number")
        return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return rows;
  }, [users, search, planFilter, statusFilter, range, sortCol, sortDir, now]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  useEffect(() => {
    setPage(1);
  }, [search, planFilter, statusFilter, range]);

  const sort = (col: keyof AdminUser) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const exportCSV = () => {
    const head = [
      "Name",
      "Email",
      "Company",
      "Phone",
      "Plan",
      "Status",
      "Expiry",
      "Registered",
      "Last Login",
      "Revenue/mo",
      "Revenue total",
    ];
    const rows = filtered.map((u) => [
      u.name,
      u.email,
      u.company,
      u.phone,
      u.plan,
      u.status,
      u.expiry ?? "",
      u.registered,
      u.lastLogin,
      u.revenueMonthly,
      u.revenueTotal,
    ]);
    const csv = [head, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `users-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  const sortArrow = (col: keyof AdminUser) =>
    sortCol === col ? (sortDir === "asc" ? "↑" : "↓") : "↕";

  // Every API behind this page already refuses a non-admin, so nothing leaked
  // — but the panel rendered around the refusal: title, tabs, revenue cards,
  // an Export button, and a bare red "Forbidden" where the table belongs. It
  // read as broken software and showed the shape of a panel that isn't theirs.
  if (allowed === null) return <div className="min-h-screen bg-[#f9fafb]" />;
  if (!allowed)
    return (
      <div className="px-4 sm:px-6 py-16 min-h-screen bg-[#f9fafb] flex items-start justify-center">
        <div className="bg-white border border-gray-200 rounded-2xl p-8 max-w-md text-center">
          <p className="text-[16px] font-semibold text-[#101828]">This page is for admins</p>
          <p className="text-[13.5px] text-gray-500 mt-1.5">
            Your account doesn&apos;t have access to user management. If you think it should, ask
            whoever set up your workspace.
          </p>
          <Link
            href="/"
            className="inline-block mt-5 text-[13.5px] font-semibold text-[#047857] hover:underline"
          >
            Back to the dashboard
          </Link>
        </div>
      </div>
    );

  return (
    <div className="px-4 sm:px-6 py-6 bg-[#f9fafb] min-h-screen">
      {toast && (
        <div
          className={`fixed top-5 right-5 z-[60] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-[13px] font-medium ${toast.type === "success" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}
        >
          {toast.text}
        </div>
      )}
      {editUser && (
        <EditModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-[20px] sm:text-[24px] font-bold text-gray-900">Admin Panel</h1>
          <p className="text-[13px] text-gray-400 mt-0.5">
            Manage users, subscriptions and analytics
          </p>
        </div>
        <button
          onClick={exportCSV}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold px-4 py-2 rounded-xl transition"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export Data
        </button>
      </div>

      {/* Tabs */}
      {/* The tabs scroll rather than widening the page: four of them don't fit a
          phone, and without this the whole admin page scrolled sideways. */}
      {/* Scrolls sideways only. overflow-y-hidden stops the strip being dragged
          vertically on a phone (overflow-x auto makes CSS compute overflow-y to
          auto too). */}
      <div className="flex items-center gap-6 border-b border-gray-200 mb-5 overflow-x-auto overflow-y-hidden scrollbar-none">
        {(
          [
            ["users", "User Management"],
            ["analytics", "Analytics"],
            ["prompts", "Prompts"],
            ["connectors", "Data Sources"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap pb-2.5 text-[14px] font-medium border-b-2 -mb-px transition ${tab === id ? "border-emerald-600 text-emerald-600" : "border-transparent text-gray-400 hover:text-gray-600"}`}
          >
            {id === "users" ? (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
              </svg>
            ) : id === "analytics" ? (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            ) : id === "prompts" ? (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            ) : (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                <path d="M3 12a9 3 0 0 0 18 0" />
              </svg>
            )}
            {label}
          </button>
        ))}
        {/* Registration switch — close public sign-up (login-only) when off. */}
        <button
          onClick={toggleRegistration}
          disabled={regEnabled === null}
          title="Allow new users to sign up. Off = login only."
          className="ml-auto shrink-0 flex items-center gap-2 whitespace-nowrap pb-2.5 text-[13px] font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          <span
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${regEnabled ? "bg-emerald-600" : "bg-gray-300"}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${regEnabled ? "translate-x-4" : "translate-x-0.5"}`}
            />
          </span>
          Registration
        </button>
        {/* Demo-data switch — populate the panel while the DB is being built. */}
        <button
          onClick={() => {
            const next = !mockMode;
            setMockMode(next);
            localStorage.setItem("admin:mock", next ? "1" : "0");
          }}
          title="Fill the panel with demo data while the database is being set up"
          className="shrink-0 flex items-center gap-2 whitespace-nowrap pb-2.5 text-[13px] font-medium text-gray-500 hover:text-gray-700"
        >
          <span
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${mockMode ? "bg-emerald-600" : "bg-gray-300"}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${mockMode ? "translate-x-4" : "translate-x-0.5"}`}
            />
          </span>
          Mock data
        </button>
      </div>

      {/* KPI cards */}
      {tab !== "prompts" && tab !== "connectors" && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
          <Kpi
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#22C55E"
                strokeWidth="2"
              >
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
            }
            iconBg="#dcfce7"
            value={usd(mrr)}
            delta={`${((newMrr / Math.max(1, mrr)) * 100).toFixed(1)}%`}
            deltaUp
            label="Monthly Recurring"
          />
          <Kpi
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#22C55E"
                strokeWidth="2"
              >
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
            }
            iconBg="#dcfce7"
            value={usd(newMrr)}
            delta={`${newThisMonth.length}`}
            deltaUp
            label="Net New MRR"
          />
          <Kpi
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#EF4444"
                strokeWidth="2"
              >
                <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
                <polyline points="17 18 23 18 23 12" />
              </svg>
            }
            iconBg="#fee2e2"
            value={`${churn.toFixed(1)}%`}
            delta={`${expiredCount}`}
            deltaUp={false}
            label="Churn Rate (Monthly)"
          />
          <Kpi
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#8B5CF6"
                strokeWidth="2"
              >
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            }
            iconBg="#f3e8ff"
            value={String(activeCount)}
            delta={`${((activeCount / Math.max(1, users.length)) * 100).toFixed(0)}%`}
            deltaUp
            label="Active Subscriptions"
          />
          <Kpi
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#10b981"
                strokeWidth="2"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
              </svg>
            }
            iconBg="#dbeafe"
            value={String(users.length)}
            delta={`${newThisMonth.length}`}
            deltaUp
            label="Registered Users"
          />
        </div>
      )}

      {tab === "connectors" ? (
        <>
          <BigQuerySyncPanel showToast={showToast} />
          <ConnectorConfigPanel showToast={showToast} />
        </>
      ) : tab === "prompts" ? (
        <PromptsPanel showToast={showToast} />
      ) : tab === "analytics" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="text-[14px] font-bold text-gray-800 mb-4">Users by Plan</h3>
            <Bars
              rows={PLANS.map((p, i) => ({
                label: p,
                value: users.filter((u) => u.plan === p).length,
                color: ["#9CA3AF", "#10b981", "#EC4899", "#8B5CF6"][i],
              }))}
            />
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="text-[14px] font-bold text-gray-800 mb-4">Users by Status</h3>
            <Bars
              rows={STATUSES.map((s, i) => ({
                label: s,
                value: users.filter((u) => u.status === s).length,
                color: ["#22C55E", "#EAB308", "#EF4444"][i],
              }))}
            />
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-5 lg:col-span-2">
            <h3 className="text-[14px] font-bold text-gray-800 mb-4">
              Monthly recurring revenue by plan
            </h3>
            <Bars
              rows={PLANS.filter((p) => p !== "Free").map((p, i) => ({
                label: p,
                value:
                  users.filter((u) => u.plan === p && u.status === "Active").length * PLAN_PRICE[p],
                color: ["#10b981", "#EC4899", "#8B5CF6"][i],
              }))}
            />
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {/* Filters */}
          <div className="px-4 sm:px-5 py-3.5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="flex items-center gap-2 flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 min-w-0">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#9CA3AF"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, or company..."
                className="text-[13px] bg-transparent outline-none w-full placeholder-gray-400 text-gray-700"
              />
            </div>
            <select
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value)}
              className="text-[13px] border border-gray-200 rounded-xl px-3 py-2 outline-none bg-white text-gray-700 cursor-pointer"
            >
              <option>All Plans</option>
              {PLANS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-[13px] border border-gray-200 rounded-xl px-3 py-2 outline-none bg-white text-gray-700 cursor-pointer"
            >
              <option>All Statuses</option>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="text-[13px] border border-gray-200 rounded-xl px-3 py-2 outline-none bg-white text-gray-700 cursor-pointer"
            >
              {["All time", "Last 30 days", "Last 90 days", "This year"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-16 gap-2 text-gray-400 text-[14px]">
              <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              Loading…
            </div>
          )}
          {!loading && fetchError && (
            <div className="flex flex-col items-center py-16 gap-2 text-[14px]">
              <p className="text-red-500">{fetchError}</p>
              <button onClick={load} className="text-[12px] text-emerald-600 hover:underline">
                Try again
              </button>
            </div>
          )}

          {!loading && !fetchError && (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] border-collapse min-w-[900px]">
                <thead>
                  <tr className="bg-gray-50/70 border-b border-gray-100 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-5 py-3 text-left">User</th>
                    <th className="px-4 py-3 text-left">Company</th>
                    <th className="px-4 py-3 text-left">Plan</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th
                      className="px-4 py-3 text-left cursor-pointer select-none hover:text-gray-700"
                      onClick={() => sort("lastLoginMins")}
                    >
                      Last Login <span className="text-gray-300">{sortArrow("lastLoginMins")}</span>
                    </th>
                    <th
                      className="px-4 py-3 text-left cursor-pointer select-none hover:text-gray-700"
                      onClick={() => sort("registeredMs")}
                    >
                      Registered <span className="text-gray-300">{sortArrow("registeredMs")}</span>
                    </th>
                    <th className="px-4 py-3 text-left">Expiry Date</th>
                    <th
                      className="px-5 py-3 text-right cursor-pointer select-none hover:text-gray-700"
                      onClick={() => sort("revenueMonthly")}
                    >
                      Revenue <span className="text-gray-300">{sortArrow("revenueMonthly")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-10 text-center text-gray-400">
                        No users match your filters
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((u) => (
                      <tr
                        key={u.id}
                        className="border-t border-gray-50 hover:bg-emerald-50/20 transition cursor-pointer"
                        onClick={() => router.push(`/admin/${u.id}`)}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            {u.avatarUrl ? (
                              <img
                                src={u.avatarUrl}
                                alt={u.name}
                                referrerPolicy="no-referrer"
                                className="w-9 h-9 rounded-full shrink-0 object-cover"
                              />
                            ) : (
                              <div
                                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-bold shrink-0"
                                style={{ background: u.avatarColor }}
                              >
                                {u.initials}
                              </div>
                            )}
                            <div className="min-w-0 max-w-[220px]">
                              <p className="font-semibold text-gray-800 whitespace-nowrap flex items-center gap-1.5">
                                <span className="truncate" title={u.name}>
                                  {u.name}
                                </span>
                                {u.isAdmin && (
                                  <span className="text-[10px] font-semibold text-purple-700 bg-purple-50 rounded px-1.5 py-0.5 shrink-0">
                                    Admin
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] text-gray-400 flex items-center gap-1 min-w-0">
                                <svg
                                  width="11"
                                  height="11"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  className="shrink-0"
                                >
                                  <rect x="2" y="4" width="20" height="16" rx="2" />
                                  <path d="m2 7 10 7 10-7" />
                                </svg>
                                <span className="truncate" title={u.email}>
                                  {u.email}
                                </span>
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 max-w-[200px]">
                          <p
                            className="text-gray-700 font-medium truncate"
                            title={u.company || undefined}
                          >
                            {u.company || "—"}
                          </p>
                          {u.phone && (
                            <p className="text-[11px] text-gray-400 flex items-center gap-1 min-w-0">
                              <svg
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                className="shrink-0"
                              >
                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                              </svg>
                              <span className="truncate" title={u.phone}>
                                {u.phone}
                              </span>
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <PlanBadge plan={u.plan} />
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusBadge status={u.status} />
                        </td>
                        <td className="px-4 py-3.5 text-gray-500 whitespace-nowrap">
                          {u.lastLogin}
                        </td>
                        <td className="px-4 py-3.5 text-gray-500 whitespace-nowrap">
                          {u.registered}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <p
                            className={
                              u.expiryState === "expired"
                                ? "text-red-600 font-medium"
                                : u.expiryState === "soon"
                                  ? "text-amber-600 font-medium"
                                  : "text-gray-600"
                            }
                          >
                            {u.expiry
                              ? new Date(u.expiry).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })
                              : "—"}
                          </p>
                          {(u.expiryState === "expired" || u.expiryState === "soon") && (
                            <p
                              className={`text-[11px] ${u.expiryState === "expired" ? "text-red-500" : "text-amber-500"}`}
                            >
                              {u.expiryLabel}
                            </p>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <p className="font-semibold text-gray-800">{usd(u.revenueMonthly)}/mo</p>
                          <p className="text-[11px] text-gray-400">{usd(u.revenueTotal)} total</p>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!loading && !fetchError && (
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <p className="text-[12px] text-gray-400">
                Showing{" "}
                <span className="font-semibold text-gray-600">
                  {filtered.length === 0 ? 0 : (curPage - 1) * PAGE_SIZE + 1}-
                  {Math.min(curPage * PAGE_SIZE, filtered.length)}
                </span>{" "}
                of <span className="font-semibold text-gray-600">{filtered.length}</span> users
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={curPage === 1}
                  className="flex items-center gap-1 text-[12px] text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ‹ Previous
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded-lg text-[12px] font-medium transition ${p === curPage ? "bg-emerald-600 text-white" : "text-gray-600 border border-gray-200 hover:bg-gray-50"}`}
                  >
                    {p}
                  </button>
                ))}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={curPage === totalPages}
                  className="flex items-center gap-1 text-[12px] text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next ›
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
