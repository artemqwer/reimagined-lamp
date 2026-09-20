import { createHash } from "crypto";
import { adminClient } from "./supabase-admin";
import { geminiGenerate } from "./gemini";
import { getActivePrompts, optimizerTypeFor, isPromptType } from "./prompts";

// The AI Optimizer's paid step, in one place: turning computed findings into
// short recommendations with the model. The findings and every number are
// computed deterministically elsewhere (lib/aiOptimizer.ts) — this only rewords
// them, under rules that forbid inventing a figure. It runs from the daily
// refresh job, not on page open, and the result is cached (see
// supabase/optimizer_analysis.sql), so identical findings are reworded once.

/** One finding as it goes to the model — text only, never a number to change.
 *  `action` is the deterministic template ("Exclude … or pause it"), sent as the
 *  fallback and starting point the model improves into a real recommendation. */
export interface Finding {
  id: string;
  kind: string;
  title: string;
  detail: string;
  action: string;
}

export interface WordedItem {
  id: string;
  title: string;
  detail: string;
  action: string;
}

// The task the model performs, added AFTER the analyst prompts (core + the
// source's analyst prompt — the SAME prompts the dashboard AI uses, so editing
// them in Admin → Prompts changes both). Those set the reasoning; this sets the
// output contract and asks for a real recommendation, not just "pause/exclude".
const SYSTEM = `Your task: rewrite each advertising finding for a marketer, and for each give the best next action to take.

Rules you must follow:
- Every number in your output must appear in the input. Never calculate, estimate, round differently, or introduce a figure of your own.
- Never promise a result. These are suggestions to review, not actions being taken.
- "title": one sentence — what to do, naming the entity. "detail": one or two sentences — why, using the input's numbers.
- "action": one or two sentences — the most useful next step to improve this result, specific to this finding and following the analyst guidance above. Prefer diagnostic and improvement steps — investigate landing page experience, review campaign targeting, improve creative relevance, analyze search intent, review audience quality, optimize bidding strategy, improve the conversion funnel — over a blunt "pause / exclude / remove", unless the finding genuinely warrants stopping spend.
- Plain professional English. No emoji, no exclamation marks, no filler like "Great news".
- Keep the same id for every item, and return every item you are given.

Return JSON only: {"items":[{"id":"...","title":"...","detail":"...","action":"..."}]}`;

/** The cache key: the wording depends only on the source, the goal and the
 *  findings' own text, so identical findings hash the same and reuse the same
 *  wording. Kept stable — the same JSON the client sends is what's hashed. */
export function phrasingHash(connector: string, goalLabel: string, findings: Finding[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ connector, goalLabel, findings }))
    .digest("hex");
}

/** The full system prompt for a source's optimizer recommendations.
 *
 *  It reuses the SAME configurable prompts the dashboard AI does — the core
 *  analyst prompt and the source's analyst prompt (Admin → Prompts) — so a
 *  change there improves both the dashboard's insights and the optimizer's
 *  actions, and there is no separate hardcoded optimizer logic. On top of those
 *  come the source's optional optimizer prompt and the admin's Data Sources
 *  instructions, then the strict output contract (which always holds). */
export async function buildSystemPrompt(connector: string): Promise<string> {
  let core = "";
  let analyst = "";
  let optimizerPrompt = "";
  try {
    const prompts = await getActivePrompts();
    core = prompts.core ?? "";
    // The source's analyst prompt, exactly as the dashboard AI picks it.
    analyst = (prompts as Record<string, string>)[connector] ?? prompts.google_ads ?? "";
    const type = optimizerTypeFor(connector);
    if (isPromptType(type)) optimizerPrompt = prompts[type] ?? "";
  } catch {
    /* fall back to the generic rules only */
  }

  let adminInstructions = "";
  try {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { data } = await adminClient()
        .from("connector_config")
        .select("config")
        .eq("connector", connector)
        .maybeSingle();
      const cfg = (data?.config ?? null) as { optimizerInstructions?: string } | null;
      if (typeof cfg?.optimizerInstructions === "string")
        adminInstructions = cfg.optimizerInstructions;
    }
  } catch {
    /* no per-source instructions — the prompts above stand on their own */
  }

  return [core, analyst, optimizerPrompt, adminInstructions, SYSTEM]
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Drop the cached optimizer wording so the next daily refresh regenerates it.
 *
 *  The optimizer's recommendations use the SAME prompts as the dashboard AI
 *  (core + the source's analyst prompt), so an edit in Admin → Prompts must
 *  reach them too. Since the wording is cached by findings-hash, a prompt change
 *  wouldn't otherwise re-run on a stable account; clearing it here makes the
 *  next refresh reword everything with the new prompt. Best-effort. */
export async function invalidateOptimizerCache(): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await adminClient()
      .from("optimizer_analysis")
      .update({ worded: null, analyzed_at: null })
      .not("worded", "is", null);
  } catch {
    /* the cache turns over as findings change anyway */
  }
}

/** Reword one set of findings. Returns null on any failure, so the caller keeps
 *  the computed wording rather than showing nothing. */
export async function rewordFindings(args: {
  system: string;
  goalLabel: string;
  findings: Finding[];
}): Promise<WordedItem[] | null> {
  const payload = args.findings.map((o) => ({
    id: o.id,
    kind: o.kind,
    title: o.title,
    detail: o.detail,
    action: o.action,
  }));
  try {
    const { text } = await geminiGenerate({
      system: args.system,
      user: `The account is being run for: ${args.goalLabel}.\n\nFindings:\n${JSON.stringify(payload, null, 1)}`,
      json: true,
      temperature: 0.3,
      maxTokens: 2000,
      // Gemini 2.5 "thinks" by default, which burns the output-token budget and
      // truncates the JSON (so parsing fails and nothing gets worded) — and it's
      // slow. This is a mechanical rewrite, no reasoning needed: turn it off.
      thinkingBudget: 0,
    });
    if (!text) return null;
    const parsed = JSON.parse(text) as { items?: WordedItem[] };
    const byId = new Map((parsed.items ?? []).map((i) => [i.id, i]));
    return payload.map((o) => ({
      id: o.id,
      title: byId.get(o.id)?.title?.trim() || o.title,
      detail: byId.get(o.id)?.detail?.trim() || o.detail,
      // The model's improved recommendation, falling back to the template.
      action: byId.get(o.id)?.action?.trim() || o.action,
    }));
  } catch {
    return null;
  }
}
