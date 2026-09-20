import { windsorApiKeyOf } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  geminiConverse,
  isGeminiConfigured,
  type GeminiTool,
  type GeminiContent,
} from "@/lib/gemini";
import { getActivePrompts } from "@/lib/prompts";
import {
  queryDataToolFor,
  showOnDashboardToolFor,
  executeDataQuery,
  normalizeFilterAction,
} from "@/lib/aiQuery";
import {
  getConnector,
  ensureCustomConnectorsLoaded,
  windsorAccountIdFor,
  aiQueryDimensionsFor,
  DEFAULT_CONNECTOR,
} from "@/lib/connectors";

export const maxDuration = 60;

// ─── Types ──────────────────────────────────────────────────────────────────

interface KpiCtx {
  label: string;
  value: string;
  trend: string;
}
interface RowCtx {
  name: string;
  type?: string;
  cost: string;
  revenue: string;
  roas: string;
  cpa: string;
  clicks: number;
  conv: number;
}
interface DimGroupCtx {
  dimension: string;
  rows: RowCtx[];
}

interface InsightsContext {
  dateRange: string;
  connected: boolean;
  dataSource: string | null;
  mode: "account" | "selection";
  selection: { dimension: string; values: string[] }[];
  kpis: KpiCtx[] | null;
  campaigns?: RowCtx[];
  crossDims?: DimGroupCtx[];
}

export interface InsightFilterAction {
  label: string;
  filters?: { dimension: string; values?: string[]; search?: string }[];
  date_from?: string;
  date_to?: string;
}
export interface AiInsight {
  insight: string;
  details?: string;
  whyItMatters?: string;
  rootCause?: string;
  action: string[];
  impact?: string;
  confidence?: "High" | "Medium" | "Low";
  filterAction?: InsightFilterAction;
}

async function groq(apiKey: string, body: object): Promise<Response> {
  return fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface ChatTurn {
  role: string;
  content: string;
}

function buildInsightsPrompt(
  ctx: InsightsContext,
  corePrompt: string,
  googleAdsPrompt: string,
  focus?: string,
  history?: ChatTurn[],
  focusInstructions?: string,
  withTools = false,
  connector: string = DEFAULT_CONNECTOR,
): string {
  const c = getConnector(connector);
  const lines: string[] = [];
  lines.push(corePrompt);
  lines.push("");
  // The ACTIVE source's analyst prompt from the library, plus the concrete shape
  // of this source so the model can't drift into another platform's vocabulary.
  lines.push(googleAdsPrompt);
  lines.push("");
  lines.push(`LIVE SOURCE: ${c.label}. Main entity: ${c.primaryLabel.toLowerCase()}.`);
  lines.push(`Metrics you have: ${c.metrics.map((m) => m.label).join(", ")}.`);
  if (!c.hasCost) {
    lines.push(
      `${c.label} carries NO ad spend: there is no cost, CPC, CPA, ROAS or profit. Never report, estimate or reason about them, and never call anything a "campaign".`,
    );
  }
  lines.push("");
  lines.push(`---`);
  lines.push(`LIVE CONTEXT (${c.label}, inside the MetricForge dashboard).`);
  lines.push(`Current period: ${ctx.dateRange}`);
  lines.push("");

  if (ctx.mode === "selection" && ctx.selection.length > 0) {
    lines.push(
      `ANALYSIS MODE: Selected Context. The user has selected a specific segment. Analyze THIS segment across every related dimension (ad groups, keywords, search terms, devices, audiences, geography, time, day of week, networks) — find patterns, problems, anomalies, growth opportunities and the factors that drive the result.`,
    );
    lines.push(`SELECTED SEGMENT:`);
    ctx.selection.forEach((s) => lines.push(`  • ${s.dimension}: ${s.values.join(", ")}`));
  } else {
    lines.push(
      `ANALYSIS MODE: Entire Account. Analyze the whole account for the period and surface the most important findings.`,
    );
  }
  lines.push("");

  if (ctx.kpis) {
    lines.push(`ACCOUNT / SEGMENT KPIs:`);
    ctx.kpis.forEach((k) => lines.push(`  • ${k.label}: ${k.value} (${k.trend} vs prev period)`));
    lines.push("");
  }

  if (ctx.campaigns?.length) {
    lines.push(`${c.primaryLabel.toUpperCase()}S:`);
    ctx.campaigns.slice(0, 15).forEach((r) => {
      lines.push(
        c.hasCost
          ? `  • ${r.name}${r.type ? ` [${r.type}]` : ""} — spend ${r.cost}, revenue ${r.revenue}, ROAS ${r.roas}, CPA ${r.cpa}, clicks ${r.clicks}, conv ${r.conv}`
          : `  • ${r.name} — revenue ${r.revenue}, conv ${r.conv}, clicks ${r.clicks}`,
      );
    });
    lines.push("");
  }

  if (ctx.crossDims?.length) {
    lines.push(`CROSS-DIMENSIONAL DATA (top rows per dimension):`);
    ctx.crossDims.forEach((d) => {
      lines.push(`  ${d.dimension} (${d.rows.length} rows):`);
      d.rows.slice(0, 40).forEach((r) => {
        lines.push(
          c.hasCost
            ? `    - ${r.name} — spend ${r.cost}, revenue ${r.revenue}, ROAS ${r.roas}, CPA ${r.cpa}, clicks ${r.clicks}, conv ${r.conv}`
            : `    - ${r.name} — revenue ${r.revenue}, conv ${r.conv}, clicks ${r.clicks}`,
        );
      });
    });
    lines.push("");
  }

  if (withTools) {
    lines.push(`ANALYSIS TOOLS — call these BEFORE writing the final JSON:`);
    lines.push(
      `1) query_data — fetch the REAL, complete breakdown for one dimension (the context above is only top rows, truncated). For ANY numeric / counting / threshold / ranking condition (e.g. "worst 10 … that lost money", "search terms with 100+ clicks and 0 conversions", "keywords that spent over $X with no sales") you MUST call query_data — scope & sort to surface the qualifying rows (e.g. dimension "search_term", sort_by "profit", sort_dir "asc" for the biggest LOSSES; sort_dir "desc" for the largest; you can also narrow by campaign or by a value substring via "search"). NEVER answer "none found" from the truncated context alone.`,
    );
    lines.push(
      `2) show_on_dashboard — builds the one-click "View on dashboard" link. Call it ONCE, after gathering data, with EVERY condition combined.`,
    );
    lines.push("");
    lines.push(`EXTRACT AND HONOUR EVERY CONDITION IN THE QUESTION (CRITICAL — logical AND):`);
    lines.push(
      `- A question often bundles SEVERAL conditions: an ENTITY to rank (search terms / campaigns / keywords / ad groups / hours / devices…), PLUS filters such as a DEVICE ("on Mobile" → device MOBILE), a DAY-OF-WEEK ("on Weekends" → day_of_week Saturday AND Sunday; "on Monday" → Monday), a NETWORK, a GEOGRAPHY / country / region, an AUDIENCE, a CAMPAIGN TYPE, and/or a DATE RANGE, PLUS a RANKING (worst/best/top-N by a metric — usually Ad Profit for "lost money / worst").`,
    );
    lines.push(
      `- You MUST recognise and apply ALL of them together. Analyse ONLY the subset that satisfies every condition, and describe results strictly for that subset. Do NOT silently ignore a condition (e.g. never analyse ALL devices when the question says "on Mobile").`,
    );
    lines.push(
      `- Then call show_on_dashboard ONCE with the COMPLETE set of filters so the opened dashboard matches your analysis exactly. Supported filter dimensions: ${["campaign_name", ...aiQueryDimensionsFor(connector)].join(", ")}. Pass each value exactly as it appears in the data. For the entity’s specific rows pass their "values" (or a "search" contains-term for a high-cardinality one). Put any explicit period in date_from/date_to (YYYY-MM-DD).`,
    );
    lines.push(
      `- Example — "Top 10 Worst Search Terms That Lost Money on Mobile": query_data(dimension search_term, sort_by profit, sort_dir asc, limit 10) → show_on_dashboard(filters: [{dimension:"search_term", values:[…the 10 terms]}, {dimension:"device", values:["MOBILE"]}]) → output JSON. NEVER drop the device=MOBILE filter.`,
    );
    lines.push(
      `- After the tool calls, output the final insights JSON (schema below) as your reply — and NOTHING else.`,
    );
    lines.push("");
  }

  if (focus && focus.trim()) {
    lines.push(`USER'S CHOSEN FOCUS: "${focus.trim()}"`);
    lines.push(
      `Center the insights on answering this question. Make the findings, root causes and actions directly address it, using the data above.`,
    );
    lines.push("");
  }

  if (focusInstructions && focusInstructions.trim()) {
    lines.push(
      `ADDITIONAL REQUIREMENTS (admin-defined — HIGHEST PRIORITY. They OVERRIDE every default formatting rule below, including the "one clear sentence" insight limit, the "1-3 actions" limit, and the insight count. Follow them literally, even if it makes an insight long.):`,
    );
    lines.push(focusInstructions.trim());
    lines.push(
      `- If they ask for a specific NUMBER of items (e.g. "show 10 search terms", "not less than 10"), you MUST output EXACTLY that many, enumerated — put the full list in the "action" array (ONE item per entry) and/or as a numbered list inside "insight". Do NOT compress them into a summary sentence, and do NOT stop early. The "1-3 actions" cap does NOT apply here.`,
    );
    lines.push(
      `- Before answering, COUNT the qualifying rows in the data above. If there are at least N qualifying rows, you MUST output N items — never fewer.`,
    );
    lines.push(
      `- Output fewer than requested ONLY if the data genuinely has fewer qualifying rows, and then state the exact number found (e.g. "only 6 search terms had spend with zero conversions") in the insight.`,
    );
    lines.push("");
  }

  if (history && history.length > 0) {
    lines.push(
      `SESSION HISTORY (already discussed this session — apply the Suggested Questions Rules: do NOT repeat these questions or re-suggest what was already asked/answered; propose the logical NEXT step instead):`,
    );
    history
      .slice(-8)
      .forEach((h) =>
        lines.push(
          `  ${h.role === "assistant" ? "A" : "Q"}: ${String(h.content ?? "").slice(0, 200)}`,
        ),
      );
    lines.push("");
  }

  const focused = !!(focus && focus.trim());
  if (focused) {
    lines.push(
      `TASK: The user picked a SPECIFIC question, so produce ONLY the insight(s) that directly answer it — EXACTLY ONE insight card by default. Do NOT add extra insights about other campaigns, segments or topics that weren't asked. If (and only if) the ANALYSIS INSTRUCTIONS above explicitly ask for a different number of cards, follow that. Each insight follows the Output Structure. Return STRICT JSON:`,
    );
  } else {
    lines.push(
      `TASK: Produce 1 to 5 insights, sorted by importance per the Insight Prioritization rules. Each insight follows the Output Structure. Return STRICT JSON:`,
    );
  }
  lines.push(`{`);
  lines.push(`  "insights": [`);
  lines.push(`    {`);
  lines.push(`      "insight": "the headline finding — one clear sentence",`);
  lines.push(
    `      "details": "the FULL analysis, chat-quality: a few short paragraphs and/or bullet lines that actually walk through the numbers. For a COMPARISON or BREAKDOWN question, show EVERY side with its concrete metrics (e.g. 'Weekend (Sat+Sun): spend $2,985, revenue $14,223, ROAS 4.76x, CPA $271.48, conversions 11' AND 'Weekday (Mon-Fri): spend $14,370, revenue $31,994, ROAS 2.23x, CPA $378.89, conversions 40'), then the takeaway. For a ranking/list question, enumerate the items with their numbers. Use plain markdown: '**bold**' for labels, '* ' or '- ' for bullets, blank lines between paragraphs. This is the body the user reads, so make it as complete and useful as a full chat answer — NEVER just restate the one-line insight.",`,
  );
  lines.push(
    `      "whyItMatters": "business significance (profit / revenue / efficiency / growth)",`,
  );
  lines.push(
    `      "rootCause": "most likely explanation, when supported by evidence — else omit",`,
  );
  lines.push(`      "action": ["recommended next step", "another step"],`);
  lines.push(
    `      "impact": "estimated business impact e.g. 'Potential ROAS Improvement: +8% to +15%' — OMIT entirely if evidence is insufficient",`,
  );
  lines.push(`      "confidence": "High | Medium | Low",`);
  lines.push(
    `      "entities": { "dimension": "one of campaign_name|device|network|match_type|ad_group|keyword|search_term|audience|country|region|day_of_week|hour", "values": ["exact dimension values this insight is about, e.g. campaign names or ['MOBILE']"], "search": "OR a contains-term for high-cardinality dims (search_term/keyword) instead of values" }`,
  );
  lines.push(`    }`);
  lines.push(`  ],`);
  lines.push(
    `  "suggestedQuestions": ["3 to 6 short follow-up questions relevant to this exact context"]`,
  );
  lines.push(`}`);
  lines.push("");
  lines.push(`OUTPUT RULES:`);
  lines.push(
    `- Apply ALL rules above (Business First, Root Cause, Confidence, No Hallucination, etc.).`,
  );
  lines.push(
    `- Reference ACTUAL numbers from the data. Never invent facts, metrics, causes, revenue or impact.`,
  );
  lines.push(
    `- "details" is REQUIRED and is the main body — give it CHAT-LEVEL depth. Cover every side/segment/item the question implies with its real numbers (fetched via query_data), exactly like a thorough chat answer would. If the question compares two things, present BOTH with their full metrics; do not describe only the "winner". Keep "insight" as the one-line headline and put the complete walk-through in "details".`,
  );
  lines.push(`- "action" is an array of 2-5 short, specific, evidence-based bullet strings.`);
  lines.push(
    `- Omit "rootCause" if you cannot identify a reliable one; omit "impact" unless evidence supports an estimate.`,
  );
  lines.push(
    `- Always set "confidence". When Low confidence, prefer data-collection / further-analysis actions over optimization.`,
  );
  lines.push(
    `- "entities": include it whenever the insight is ABOUT concrete dimension values the user could open on the dashboard (the campaigns / device / search terms / etc. behind the finding). Use "values" for a small explicit set (exact names / ['MOBILE']); use "search" for a "containing X" pattern on search_term/keyword. Omit "entities" only for purely conceptual insights or when nothing concrete is filterable. This powers the "View on dashboard" button — it applies exactly these filters.`,
  );
  lines.push(
    `- If not connected or no data for the period, return a single insight explaining that and empty suggestedQuestions.`,
  );
  lines.push(
    `- suggestedQuestions MUST be answerable from the data already provided above (campaigns, ad groups, keywords, search terms, devices, etc.). They are clicked and sent straight back to you, so only suggest what you can actually answer now.`,
  );
  lines.push(
    `- NEVER suggest questions about "accessing", "pulling", "exporting" or "connecting" a report or data source, and never suggest questions about a dimension that is absent from the context — those lead to dead-end "I don't have that data" answers.`,
  );
  lines.push(
    `- "action", "insight", "whyItMatters", "rootCause", "impact" and each suggestedQuestion MUST be plain strings, never objects.`,
  );
  lines.push(`- Respond in the same language implied by the data labels (default English).`);
  lines.push(`- Output ONLY the JSON object, nothing else.`);

  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  await ensureCustomConnectorsLoaded();
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        // Writing back a refreshed token is what stops the session dying.
        // Without this the server refreshes the access token, drops the new
        // cookies on the floor, and the browser keeps presenting the old
        // refresh token — which Supabase then rejects as already used. Ten
        // parallel requests turn that into a burst of 401s and a logout.
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) cookieStore.set(name, value, options);
          } catch {
            // Called from somewhere cookies can't be written (a render rather
            // than a route handler). The request still works; the refresh just
            // isn't persisted from here.
          }
        },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groqKey = process.env.GROQ_API_KEY;
  if (!isGeminiConfigured() && !groqKey) {
    return NextResponse.json({ error: "No AI provider configured" }, { status: 500 });
  }

  const {
    context,
    focus,
    history,
    focusInstructions,
    dateFrom,
    dateTo,
    connector = DEFAULT_CONNECTOR,
  } = (await req.json()) as {
    context: InsightsContext;
    focus?: string;
    history?: ChatTurn[];
    focusInstructions?: string;
    dateFrom?: string;
    dateTo?: string;
    connector?: string;
  };

  if (!context?.connected) {
    return NextResponse.json({
      insights: [
        {
          insight: "Connect a data source to see AI insights.",
          action: ["Open Profile → Data Source and add your Windsor.ai API key."],
          confidence: "High" as const,
        },
      ],
      suggestedQuestions: [],
    });
  }
  if (!context.kpis) {
    return NextResponse.json({
      insights: [
        {
          insight: `No data found for ${context.dateRange}.`,
          whyItMatters: "The connected source has no records for this period.",
          action: ["Try a different date range or sync your data."],
          confidence: "High" as const,
        },
      ],
      suggestedQuestions: [],
    });
  }

  const prompts = await getActivePrompts();
  // Each source has its own analyst prompt in the library; fall back to Google Ads'.
  const sourcePrompt = (prompts as Record<string, string>)[connector] ?? prompts.google_ads;
  const systemPrompt = buildInsightsPrompt(
    context,
    prompts.core,
    sourcePrompt,
    focus,
    history,
    focusInstructions,
    isGeminiConfigured(),
    connector,
  );

  // Same data-access path as the chat: a Windsor co-user account scope + key so the
  // query_data tool fetches the REAL, complete breakdown (not just the truncated
  // context snapshot) — this is what makes Preset Questions find data like the chat.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountId = windsorAccountIdFor((user as any).app_metadata, connector);
  let windsorKey = windsorApiKeyOf(user);
  if (!windsorKey && accountId) windsorKey = process.env.WINDSOR_API_KEY;
  const queryFrom = typeof dateFrom === "string" ? dateFrom : "";
  const queryTo = typeof dateTo === "string" ? dateTo : "";

  // The multi-condition "View on dashboard" link the model builds via show_on_dashboard
  // (carries EVERY condition it recognised: entity values + device + day_of_week + date…).
  let toolFilterAction: InsightFilterAction | null = null;

  let raw = "{}";
  try {
    if (isGeminiConfigured()) {
      // Primary: Gemini via Vertex AI (service account). Tool loop identical to the
      // chat route: the model may call query_data to fetch any breakdown, and
      // show_on_dashboard to build the multi-filter link, before it writes the
      // final insights JSON as its reply text.
      const tools: GeminiTool[] = [
        queryDataToolFor(connector) as GeminiTool,
        showOnDashboardToolFor(connector) as GeminiTool,
      ];
      const contents: GeminiContent[] = [
        { role: "user", parts: [{ text: "Generate the insights JSON now." }] },
      ];
      const MAX_TOOL_STEPS = 6;
      let captured = false;
      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        const { parts } = await geminiConverse({
          system: systemPrompt,
          contents,
          tools,
          temperature: 0.5,
          maxTokens: 6144,
          thinkingBudget: 0,
        });
        const fnPart = parts.find((p) => p.functionCall);
        if (!fnPart) {
          raw =
            parts
              .map((p) => p.text ?? "")
              .join("")
              .trim() || "{}";
          captured = true;
          break;
        }
        const { name, args } = fnPart.functionCall as {
          name: string;
          args: Record<string, unknown>;
        };
        let result: Record<string, unknown>;
        if (name === "query_data") {
          result = await executeDataQuery(
            windsorKey,
            queryFrom,
            queryTo,
            args,
            user.id,
            accountId,
            connector,
          );
        } else if (name === "show_on_dashboard") {
          toolFilterAction = normalizeFilterAction(args, connector);
          result = toolFilterAction
            ? {
                ok: true,
                note: "The 'View on dashboard' link will apply exactly these filters. Now finish gathering data if needed and output the insights JSON.",
              }
            : {
                ok: false,
                note: "No valid filters were provided; make sure each condition uses a supported dimension, then continue.",
              };
        } else {
          result = { error: `Unknown tool ${name}` };
        }
        contents.push({ role: "model", parts: [{ functionCall: fnPart.functionCall }] });
        contents.push({ role: "user", parts: [{ functionResponse: { name, response: result } }] });
      }
      if (!captured) {
        // Tool budget exhausted — force the final JSON answer with the data gathered.
        const { parts } = await geminiConverse({
          system: systemPrompt,
          contents,
          temperature: 0.5,
          maxTokens: 6144,
          thinkingBudget: 0,
        });
        raw =
          parts
            .map((p) => p.text ?? "")
            .join("")
            .trim() || "{}";
      }
    } else {
      // Fallback: Groq
      const res = await groq(groqKey!, {
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Generate the insights JSON now." },
        ],
        response_format: { type: "json_object" },
        max_tokens: 2048,
        temperature: 0.5,
      });
      if (!res.ok)
        return NextResponse.json({ error: `Groq error: ${await res.text()}` }, { status: 500 });
      const data = await res.json();
      raw = data.choices?.[0]?.message?.content ?? "{}";
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI error" },
      { status: 500 },
    );
  }

  let parsed: { insights?: AiInsight[]; suggestedQuestions?: string[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Be tolerant of markdown fences or stray text around the JSON object.
    const cleaned = raw
      .replace(/```json\s*/gi, "")
      .replace(/```/g, "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    try {
      parsed = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
    } catch {
      return NextResponse.json({ error: "AI returned malformed JSON" }, { status: 500 });
    }
  }

  // Coerce every field to the exact shape the UI renders. The model sometimes
  // returns objects where we expect strings — rendering those crashes React
  // (error #31: "Objects are not valid as a React child").
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const str = (v: any): string => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    // Pull a sensible string out of an object instead of rendering "[object]".
    if (typeof v === "object")
      return String(
        v.text ??
          v.value ??
          v.label ??
          v.description ??
          v.step ??
          Object.values(v)
            .filter((x) => typeof x === "string")
            .join(" — ") ??
          "",
      );
    return String(v);
  };
  // Turn the model's "entities" into a dashboard FilterAction for "View on dashboard".
  // Dimensions the "View on dashboard" link may filter on. Derived from the
  // active source, so a breakdown that exists there — including one an admin
  // added — can actually be linked to. It used to be a fixed Google Ads list,
  // which silently dropped the link on every other source: the model asked to
  // filter by, say, day_of_week_name and the action never reached the client.
  // The two campaign_* keys are how the primary table stores its own selection
  // whatever the connector, so they're always valid.
  const VALID_DIMS = new Set([
    "campaign_name",
    "campaign_selected",
    ...aiQueryDimensionsFor(connector),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildFilterAction = (ins: any, fallbackLabel: string): InsightFilterAction | undefined => {
    const e = ins?.entities;
    if (!e || typeof e !== "object") return undefined;
    const dim = str(e.dimension).trim();
    if (!VALID_DIMS.has(dim)) return undefined;
    const values = Array.isArray(e.values)
      ? e.values
          .map(str)
          .map((s: string) => s.trim())
          .filter(Boolean)
      : [];
    const search = e.search ? str(e.search).trim() : "";
    if (values.length === 0 && !search) return undefined;
    const filter: { dimension: string; values?: string[]; search?: string } = { dimension: dim };
    if (search) filter.search = search;
    else filter.values = values;
    return { label: fallbackLabel.slice(0, 50) || "View on dashboard", filters: [filter] };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sanitize = (ins: any): AiInsight => ({
    insight: str(ins?.insight),
    details: ins?.details ? str(ins.details) : undefined,
    whyItMatters: ins?.whyItMatters ? str(ins.whyItMatters) : undefined,
    rootCause: ins?.rootCause ? str(ins.rootCause) : undefined,
    action: Array.isArray(ins?.action)
      ? ins.action.map(str).filter(Boolean)
      : ins?.action
        ? [str(ins.action)]
        : [],
    impact: ins?.impact ? str(ins.impact) : undefined,
    confidence:
      ins?.confidence === "High" || ins?.confidence === "Medium" || ins?.confidence === "Low"
        ? ins.confidence
        : undefined,
    filterAction: buildFilterAction(ins, str(ins?.insight)),
  });

  // A picked question with no custom admin instructions answers with exactly ONE
  // card — no extra unrelated insights. Admin instructions (if any) may define a
  // different count, so don't cap when they're present.
  const cap = focus && focus.trim() && !(focusInstructions && focusInstructions.trim()) ? 1 : 5;
  const insights = (Array.isArray(parsed.insights) ? parsed.insights : [])
    .slice(0, cap)
    .map(sanitize)
    .filter((i) => i.insight);
  const suggestedQuestions = (
    Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions : []
  )
    .slice(0, 6)
    .map(str)
    .filter(Boolean);

  // The show_on_dashboard tool builds the COMPLETE multi-condition link (entity +
  // device + day_of_week + date…). It's more reliable than the per-insight
  // `entities` fallback, so when present it drives the primary insight's
  // "View on dashboard" button — ensuring every condition from the question is applied.
  if (toolFilterAction && insights.length > 0) {
    insights[0] = { ...insights[0], filterAction: toolFilterAction };
  }

  return NextResponse.json({ insights, suggestedQuestions });
}
