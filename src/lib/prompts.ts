import { adminClient } from "./supabase-admin";
import { CORE_ANALYST_MASTER_PROMPT, GOOGLE_ADS_ANALYST_PROMPT } from "./aiPrompt";

// Prompt types the AI routes consume. The Prompt Library can hold many prompts;
// the active one of each type is used at request time. Beyond the shared `core`
// and `preset_questions`, every data source has its own analyst prompt so the AI
// reasons in that source's terms (a GA4 analyst shouldn't talk about ROAS).
export type PromptType =
  | "core"
  // Analyst prompt per source.
  | "google_ads"
  | "meta_ads"
  | "ga4"
  | "shopify"
  // Quick-question set per source (`preset_questions` stays as the shared
  // fallback for sources without their own set).
  | "preset_questions"
  | "preset_google_ads"
  | "preset_meta_ads"
  | "preset_ga4"
  | "preset_shopify"
  // AI Optimizer phrasing instructions per source — how its findings are worded
  // for that source (its entities, its metrics). The findings themselves stay
  // deterministic; this only shapes the wording.
  | "optimizer_google_ads"
  | "optimizer_meta_ads"
  | "optimizer_ga4"
  | "optimizer_shopify";

/** Every prompt type there is — the one list a route can check a request against. */
export const PROMPT_TYPES = [
  "core",
  "google_ads",
  "meta_ads",
  "ga4",
  "shopify",
  "preset_questions",
  "preset_google_ads",
  "preset_meta_ads",
  "preset_ga4",
  "preset_shopify",
  "optimizer_google_ads",
  "optimizer_meta_ads",
  "optimizer_ga4",
  "optimizer_shopify",
] as const;

/** Is this a prompt type the app knows? Used where the value arrives from a
 *  request, so an unknown one is refused instead of quietly becoming "core". */
export function isPromptType(v: unknown): v is PromptType {
  return typeof v === "string" && (PROMPT_TYPES as readonly string[]).includes(v);
}

// The per-source analyst prompt types, in the order the admin library lists them.
export const CONNECTOR_PROMPT_TYPES = ["google_ads", "meta_ads", "ga4", "shopify"] as const;

/** The preset-questions prompt type for a connector. */
export function presetTypeFor(connector: string): PromptType {
  return `preset_${connector}` as PromptType;
}

/** The AI Optimizer phrasing prompt type for a connector. */
export function optimizerTypeFor(connector: string): PromptType {
  return `optimizer_${connector}` as PromptType;
}

export interface DbPrompt {
  id: string;
  name: string;
  type: PromptType;
  content: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// Hardcoded defaults — used when the prompts table is empty/unavailable so the
// AI never breaks even before the library is set up.
export const FALLBACK_PROMPTS: Record<PromptType, string> = {
  core: CORE_ANALYST_MASTER_PROMPT,
  google_ads: GOOGLE_ADS_ANALYST_PROMPT,
  meta_ads: [
    "# Meta Ads Analyst",
    "You analyse Meta (Facebook & Instagram) advertising: campaigns, ad sets, ads, placements and platforms.",
    "Cost, ROAS, CPA and profit are available — use them, and judge creative/placement performance, audience overlap and frequency.",
  ].join("\n"),
  ga4: [
    "# Google Analytics 4 Analyst",
    "You analyse website behaviour: channels, source/medium, landing pages, devices, geography and events.",
    "GA4 carries NO ad spend — there is no cost, CPC, CPA, ROAS or profit. Never report or estimate them.",
    "Judge acquisition quality by sessions, conversion rate, conversions and revenue; look for weak landing pages, low-converting channels and device gaps.",
  ].join("\n"),
  shopify: [
    "# Shopify Analyst",
    "You analyse store sales: products, variants, collections, customer types, traffic sources and discounts.",
    "Shopify carries NO ad spend — there is no cost, CPC, CPA, ROAS or profit. Never report or estimate them.",
    "Judge performance by orders, total sales, items sold and average order value; look for slow movers, discount leakage and AOV opportunities.",
  ].join("\n"),
  preset_questions: [
    "What should I optimize first?",
    "Where am I wasting budget?",
    "Which campaigns should I scale?",
    "What's hurting my ROAS?",
    "Find my biggest growth opportunities",
  ].join("\n"),
  // Per-source quick questions — phrased for that source (a GA4 user should never
  // be offered "What's hurting my ROAS?").
  preset_google_ads: [
    "What should I optimize first?",
    "Where am I wasting budget?",
    "Which campaigns should I scale?",
    "What's hurting my ROAS?",
    "Find my biggest growth opportunities",
  ].join("\n"),
  preset_meta_ads: [
    "What should I optimize first?",
    "Which ad sets should I scale?",
    "Which creatives are fatiguing?",
    "Where am I wasting budget?",
    "Find my biggest growth opportunities",
  ].join("\n"),
  preset_ga4: [
    "What should I optimize first?",
    "Which channels drive the most conversions?",
    "Where am I losing engaged traffic?",
    "Which landing pages underperform?",
    "Find my biggest growth opportunities",
  ].join("\n"),
  preset_shopify: [
    "What should I optimize first?",
    "Which products sell best?",
    "Where am I losing sales?",
    "How can I raise average order value?",
    "Find my biggest growth opportunities",
  ].join("\n"),
  // AI Optimizer phrasing per source — extra domain context added ABOVE the
  // strict rewording rules (which always apply: never invent a number, never
  // promise a result). Admins can tune the voice/emphasis per source here.
  optimizer_google_ads: [
    "These are Google Ads optimisation findings — campaigns, ad groups, ads, keywords, search terms, devices, and time of day.",
    "Cost, ROAS, CPA and profit are real here; speak in those terms. Prefer concrete actions (pause, raise/lower bids, add negatives, reallocate budget).",
  ].join("\n"),
  optimizer_meta_ads: [
    "These are Meta Ads optimisation findings — campaigns, ad sets, ads, placements and audiences.",
    "Cost, ROAS and CPA are real here. Talk about creative fatigue, audience overlap, placement and budget reallocation.",
  ].join("\n"),
  optimizer_ga4: [
    "These are Google Analytics 4 optimisation findings — channels, source/medium, landing pages, devices and geography.",
    "GA4 has NO ad spend: never mention cost, CPC, CPA, ROAS or profit. Speak in sessions, conversion rate, conversions and revenue.",
  ].join("\n"),
  optimizer_shopify: [
    "These are Shopify optimisation findings — products, variants, collections, customer types and discounts.",
    "Shopify has NO ad spend: never mention cost, CPC, CPA, ROAS or profit. Speak in orders, total sales, items sold and average order value.",
  ].join("\n"),
};

/** Active prompt content per type, falling back to the built-in master prompts. */
export async function getActivePrompts(): Promise<Record<PromptType, string>> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ...FALLBACK_PROMPTS };
  try {
    const { data, error } = await adminClient()
      .from("prompts")
      .select("type, content, active, updated_at")
      .eq("active", true);
    if (error || !data) return { ...FALLBACK_PROMPTS };

    const pick = (t: PromptType): string => {
      const rows = (data as Pick<DbPrompt, "type" | "content" | "updated_at">[]).filter(
        (r) => r.type === t && r.content?.trim(),
      );
      if (!rows.length) return FALLBACK_PROMPTS[t];
      rows.sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
      return rows[0].content;
    };
    return {
      core: pick("core"),
      google_ads: pick("google_ads"),
      meta_ads: pick("meta_ads"),
      ga4: pick("ga4"),
      shopify: pick("shopify"),
      preset_questions: pick("preset_questions"),
      preset_google_ads: pick("preset_google_ads"),
      preset_meta_ads: pick("preset_meta_ads"),
      preset_ga4: pick("preset_ga4"),
      preset_shopify: pick("preset_shopify"),
      optimizer_google_ads: pick("optimizer_google_ads"),
      optimizer_meta_ads: pick("optimizer_meta_ads"),
      optimizer_ga4: pick("optimizer_ga4"),
      optimizer_shopify: pick("optimizer_shopify"),
    };
  } catch {
    return { ...FALLBACK_PROMPTS };
  }
}
