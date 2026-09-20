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
  queryDataToolOaiFor,
  executeDataQuery,
  CAMPAIGN_SETTINGS_TOOL,
  CAMPAIGN_SETTINGS_TOOL_OAI,
  executeCampaignSettings,
  showOnDashboardToolFor,
  showOnDashboardToolOaiFor,
  normalizeFilterAction,
} from "@/lib/aiQuery";
import {
  getConnector,
  ensureCustomConnectorsLoaded,
  windsorAccountIdFor,
  DEFAULT_CONNECTOR,
} from "@/lib/connectors";

export const maxDuration = 60;

interface CampaignContext {
  name: string;
  type: string;
  cost: string;
  revenue: string;
  roas: string;
  clicks: number;
  conversions: number;
  cpa: string;
}
interface KpiContext {
  label: string;
  value: string;
  trend: string;
}
interface DimRow {
  name: string;
  cost: string;
  revenue: string;
  roas: string;
  cpa: string;
  clicks: number;
  conv: number;
}
interface DimGroup {
  dimension: string;
  rows: DimRow[];
}
interface DashboardContext {
  dateRange: string;
  connected: boolean;
  dataSource: string | null;
  kpis: KpiContext[] | null;
  campaigns?: CampaignContext[];
  crossDims?: DimGroup[];
  mode?: "account" | "selection";
  selection?: { dimension: string; values: string[] }[];
}

const SET_DATE_RANGE_TOOL = {
  type: "function",
  function: {
    name: "set_date_range",
    description: [
      "ONLY use this tool when the user explicitly asks to CHANGE, SELECT, SWITCH, or SET a date range or period.",
      "Examples that should trigger this tool: 'show me 2022', 'switch to March 2023', 'select last month', 'set period to Q1 2024'.",
      "Do NOT use this tool for: analysis questions, recommendations, chart explanations, or any request that doesn't explicitly ask to change the date.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        start: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end: { type: "string", description: "End date in YYYY-MM-DD format" },
        label: { type: "string", description: "Short label, e.g. '2022', 'March 2023', 'Q1 2024'" },
      },
      required: ["start", "end", "label"],
    },
  },
};

async function groq(apiKey: string, body: object): Promise<Response> {
  return fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function buildSystemPrompt(
  ctx: DashboardContext,
  corePrompt: string,
  googleAdsPrompt: string,
  connector: string = DEFAULT_CONNECTOR,
): string {
  const today = new Date().toISOString().split("T")[0];
  const hasData = ctx.kpis !== null && ctx.kpis !== undefined;

  let dataStatus: string;
  if (!ctx.connected) {
    dataStatus = "NOT CONNECTED — user must connect a data source first";
  } else if (!hasData) {
    dataStatus = `CONNECTED (${ctx.dataSource ?? "data source"}) but no data found for the selected period ${ctx.dateRange} — the data source likely has no records for this date range`;
  } else {
    dataStatus = `connected (${ctx.dataSource ?? "data source"})`;
  }

  const c = getConnector(connector);

  // `sourcePrompt` is the ACTIVE source's analyst prompt from the library (each
  // connector has its own, admin-editable). We append the concrete shape of this
  // source so the model always knows its entity, breakdowns and metrics — and,
  // for cost-free sources, that spend metrics simply don't exist.
  const sourceBrief = [
    googleAdsPrompt,
    "",
    `LIVE SOURCE: ${c.label}. Main entity: ${c.primaryLabel.toLowerCase()}.`,
    `Available breakdowns: ${c.dimensions.map((d) => d.singular.toLowerCase()).join(", ")}.`,
    `Metrics you have: ${c.metrics.map((m) => m.label).join(", ")}.`,
    c.hasCost
      ? "Cost, ROAS and profit are available — use them."
      : `${c.label} carries NO ad spend. There is no cost, CPC, CPA, ROAS or profit — never report, estimate or reason about them. Do not call anything a "campaign".`,
  ].join("\n");

  let prompt = `${corePrompt}

${sourceBrief}

---
LIVE CONTEXT: You are answering live chat questions as the ${c.label} analyst inside the DataRocks dashboard.
Today's date: ${today}
Current period: ${ctx.dateRange}
Data source status: ${dataStatus}

`;

  if (ctx.kpis) {
    prompt += `ACCOUNT KPIs:\n`;
    ctx.kpis.forEach((k) => {
      prompt += `  • ${k.label}: ${k.value} (${k.trend} vs prev period)\n`;
    });
    prompt += "\n";
  }

  if (ctx.campaigns?.length) {
    // The rows are the source's primary entity — campaigns for ads, products for
    // Shopify, channels for GA4 — so they're named and priced accordingly.
    prompt += `${c.primaryLabel.toUpperCase()}S (${ctx.campaigns.length} shown):\n`;
    ctx.campaigns.forEach((r) => {
      prompt += c.hasCost
        ? `  • ${r.name} [${r.type}] — spend: ${r.cost}, revenue: ${r.revenue}, ROAS: ${r.roas}, CPA: ${r.cpa}, clicks: ${r.clicks}, conv: ${r.conversions}\n`
        : `  • ${r.name} — revenue: ${r.revenue}, conv: ${r.conversions}, clicks: ${r.clicks}\n`;
    });
    prompt += "\n";
  }

  if (ctx.crossDims?.length) {
    prompt += `CROSS-DIMENSIONAL DATA (top rows per dimension — ad groups, keywords, search terms, devices, audiences, geography, time, networks, etc.):\n`;
    ctx.crossDims.forEach((d) => {
      prompt += `  ${d.dimension}:\n`;
      d.rows.forEach((r) => {
        prompt += c.hasCost
          ? `    - ${r.name} — spend ${r.cost}, revenue ${r.revenue}, ROAS ${r.roas}, CPA ${r.cpa}, clicks ${r.clicks}, conv ${r.conv}\n`
          : `    - ${r.name} — revenue ${r.revenue}, conv ${r.conv}, clicks ${r.clicks}\n`;
      });
    });
    prompt += "\n";
  }

  prompt += `MULTI-STEP EXECUTION (IMPORTANT):
- A single message can contain SEVERAL conditions (a period, a device/segment, an analysis level like campaigns/ad groups, a metric, etc.). You MUST satisfy EVERY condition before giving the final answer — never act on just one part and stop.
- Plan the request as ordered steps and execute them with tools, in this order:
  1. If a period is mentioned → call set_date_range. (This does NOT end the turn — keep going.)
  2. For each segment/filter mentioned (device, network, country, audience, match type, a specific campaign, etc.) → fetch the relevant numbers with query_data, scoped/filtered to that segment, for the now-active period.
  3. Gather any extra breakdowns the analysis needs (e.g. per-campaign rows at the requested level).
  4. Call show_on_dashboard ONCE with ALL the conditions combined (e.g. device=Mobile for the whole account, plus the date range) so the user can open the exact view.
  5. Write the final analysis + recommendations, grounded in the numbers you fetched and addressing EVERY condition in the request.
- Example — "Show me mobile performance for all campaigns for Q2 2022": set_date_range(Q2 2022) → query_data(dimension: campaign, ... ) and query_data(dimension: device, search/value Mobile) for that period → show_on_dashboard(device=Mobile + date Q2 2022) → final analysis of mobile performance across campaigns. Do NOT stop after only setting the date.
- After calling set_date_range, ALWAYS continue with the remaining steps; never reply with only "the period is set, ask me about it".

RULES:
- You HAVE the data shown above (KPIs, campaigns and the cross-dimensional rows). Analyze it directly. NEVER tell the user you "only have campaign-level data" or that you "need access to the X report" when that dimension is present above — just answer from it.
- You can also call the query_data tool to fetch ANY other breakdown of the account for the current period: ad groups, keywords, search terms, devices, networks, audiences, countries/regions, day of week, hour, and time buckets (week/month/quarter/year). You can scope it to one campaign (campaign param) and/or filter values (search param), and call it several times before answering.
- When the user asks about something not already in the context (e.g. "ad groups in campaign X", "mobile performance for campaign Y", "clicks for search terms containing Z", "profit by week"), ALWAYS call query_data to get the real numbers. Do NOT reply that you don't have the data or that it isn't broken down — fetch it.
- For questions about campaign CONFIGURATION rather than performance — bidding strategy, campaign type/channel, status, budget, target ROAS/CPA — call the campaign_settings tool (optionally filtered by campaign name). Do not say you only have performance metrics; fetch the settings.
- ALMOST ALWAYS attach a show_on_dashboard action. Whenever your answer references concrete dimension values the user could view on the dashboard — one OR several campaigns, devices, networks, match types, ad groups, keywords, search terms, audiences, countries/regions, and/or a date range — call show_on_dashboard so a one-click "Show on dashboard" button appears. Call it once, after you've gathered the data, then write your text answer. Do NOT wait for the user to ask for a link/chart — include it by default. The ONLY times to skip it: pure greetings/help/conceptual questions, or answers with no concrete filterable values at all.
- MANDATORY for "find / list / show me the … that …" questions: any request to find or list items matching a condition (e.g. "find search terms with 100+ clicks and 0 conversions", "list keywords with no sales") ALWAYS ends with a show_on_dashboard call carrying those exact rows — use a "search" contains-term for high-cardinality dims (search_term/keyword) or the explicit "values" for a small set — so the user can open the same filtered view. Never answer such a question without the button.
- CHOOSING values vs search in show_on_dashboard: when the question is "containing/with word X" on a high-cardinality dimension (search_term, keyword), pass search: "X" (NOT a list of values) so the dashboard filters to EVERY matching value — exactly matching your analysis of all those rows. Use values only for a small, specific set (e.g. one campaign, ['Mobile'], a couple of named items). Never enumerate a long list when a search term captures the same set.
- For campaign_name, use the campaign's EXACT name as it appears in the data — do NOT append the type/channel (write "Shoes", not "Shoes [Search]") and do not shorten or reword it. For device values use the exact casing from the data (e.g. "MOBILE").
- Only say data is unavailable if query_data returns an error or empty result (e.g. no data source connected, or no rows match).
- Be concise and actionable (max 3-4 short paragraphs or a short bullet list)
- Always reference actual numbers from the data above when available
- If data source is NOT CONNECTED: tell the user to connect a data source
- If data source is CONNECTED but no data for this period: explain that the source is connected but has no records for this specific date range — suggest trying a different period or syncing data. Do NOT say the source is disconnected
- Use set_date_range ONLY when the user explicitly asks to change/select/switch the time period — NOT for analysis or recommendations
- After the date is changed, provide a brief analysis or note about the data availability for that period
- Respond in the same language the user writes in`;

  return prompt;
}

/**
 * Which tools have to run before the others.
 *
 * set_date_range changes the period every later read uses, and
 * show_on_dashboard decides what the answer carries — so they run first, in the
 * order the model asked for them. Everything else only READS, which is what
 * makes running those together safe.
 */
export const STATEFUL_TOOLS = ["set_date_range", "show_on_dashboard"];

export function partitionToolCalls<T extends { fnName: string }>(
  calls: T[],
): { stateful: T[]; readOnly: T[] } {
  return {
    stateful: calls.filter((c) => STATEFUL_TOOLS.includes(c.fnName)),
    readOnly: calls.filter((c) => !STATEFUL_TOOLS.includes(c.fnName)),
  };
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
    message,
    context,
    history = [],
    dateFrom,
    dateTo,
    connector = DEFAULT_CONNECTOR,
  } = await req.json();
  const prompts = await getActivePrompts();
  // Each source has its own analyst prompt in the library; fall back to Google Ads'.
  const sourcePrompt = (prompts as Record<string, string>)[connector] ?? prompts.google_ads;
  const systemPrompt = buildSystemPrompt(context, prompts.core, sourcePrompt, connector);

  // The user's Windsor key + the active period power the query_data tool, which
  // lets the model fetch any breakdown on demand instead of guessing.
  // Account scope from the server-validated app_metadata (Windsor co-user connect).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountId = windsorAccountIdFor((user as any).app_metadata, connector);
  // Personal Windsor key, else the shared workspace key (only WITH an account scope).
  let windsorKey = windsorApiKeyOf(user);
  if (!windsorKey && accountId) windsorKey = process.env.WINDSOR_API_KEY;
  const queryDateFrom: string = typeof dateFrom === "string" ? dateFrom : "";
  const queryDateTo: string = typeof dateTo === "string" ? dateTo : "";
  // Max tool round-trips before we force a final answer. Multi-condition requests
  // (period + filter + level + analysis) need several steps, so allow more.
  const MAX_TOOL_STEPS = 7;

  // A short label for each tool action, surfaced to the UI as the "AI Actions"
  // checklist so the user sees what the assistant did, in order.
  function describeAction(name: string, args: Record<string, unknown>): string {
    switch (name) {
      case "set_date_range":
        return `Applying date range: ${args.label ?? "period"}`;
      case "query_data": {
        const dim = String(args.dimension ?? "data");
        const scope = args.campaign
          ? ` for ${args.campaign}`
          : args.search
            ? ` matching "${args.search}"`
            : "";
        return `Loading ${dim} data${scope}`;
      }
      case "campaign_settings":
        return `Loading campaign settings`;
      case "show_on_dashboard":
        return `Applying filters to dashboard`;
      default:
        return name;
    }
  }

  // ─── Primary: Gemini via Vertex AI ──────────────────────────────────────────
  if (isGeminiConfigured()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const historyText = (history as any[])
        .slice(-10)
        .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
        .join("\n");
      const userPrompt = historyText ? `${historyText}\nUser: ${message}` : message;

      const tools: GeminiTool[] = [
        queryDataToolFor(connector) as GeminiTool,
        CAMPAIGN_SETTINGS_TOOL,
        showOnDashboardToolFor(connector),
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let pendingFilterAction: any = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let pendingDateAction: any = null;
      const actions: string[] = [];
      // Active period — updated when the model changes the date mid-turn so that
      // subsequent query_data calls fetch the NEW range, not the original one.
      let activeFrom = queryDateFrom;
      let activeTo = queryDateTo;
      // Always offer the date tool — multi-condition requests may include a period
      // even when the heuristic is unsure; the model only calls it when relevant.
      tools.push({
        name: SET_DATE_RANGE_TOOL.function.name,
        description: SET_DATE_RANGE_TOOL.function.description,
        parameters: SET_DATE_RANGE_TOOL.function.parameters,
      });

      const contents: GeminiContent[] = [{ role: "user", parts: [{ text: userPrompt }] }];

      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        const { parts } = await geminiConverse({
          system: systemPrompt,
          contents,
          tools,
          temperature: 0.4,
          maxTokens: 1024,
          thinkingBudget: 0, // disable thinking so the reply isn't starved of tokens
        });
        const fnPart = parts.find((p) => p.functionCall);
        if (!fnPart) {
          const text = parts
            .map((p) => p.text ?? "")
            .join("")
            .trim();
          if (text) actions.push("Generating analysis");
          return NextResponse.json({
            text: text || "No response received.",
            filterAction: pendingFilterAction ?? undefined,
            dateAction: pendingDateAction ?? undefined,
            actions: actions.length ? actions : undefined,
          });
        }
        const { name, args } = fnPart.functionCall as {
          name: string;
          args: Record<string, unknown>;
        };
        actions.push(describeAction(name, args));

        let result: Record<string, unknown>;
        if (name === "set_date_range") {
          const a = args as { start: string; end: string; label: string };
          pendingDateAction = { start: a.start, end: a.end, label: a.label };
          activeFrom = a.start;
          activeTo = a.end;
          // Not terminal — tell the model to keep executing the remaining steps.
          result = {
            ok: true,
            label: a.label,
            from: a.start,
            to: a.end,
            note: `Date range applied to ${a.label} (${a.start} → ${a.end}). Now continue with the remaining conditions (filters, data, analysis) for THIS period.`,
          };
        } else if (name === "show_on_dashboard") {
          pendingFilterAction = normalizeFilterAction(args, connector);
          result = pendingFilterAction
            ? {
                ok: true,
                note: "A 'Show on dashboard' button will be attached to your answer. Now write the analysis text.",
              }
            : { ok: false, note: "No valid filters provided; skip the button and just answer." };
        } else if (name === "query_data") {
          result = await executeDataQuery(
            windsorKey,
            activeFrom,
            activeTo,
            args,
            user.id,
            accountId,
            connector,
          );
        } else if (name === "campaign_settings") {
          result = await executeCampaignSettings(windsorKey, activeFrom, activeTo, args, accountId);
        } else {
          break; // unknown tool → stop looping
        }
        // Gemini REST: the model's functionCall is a "model" turn; the function
        // result is sent back in a "user" turn carrying a functionResponse part.
        contents.push({ role: "model", parts: [{ functionCall: fnPart.functionCall }] });
        contents.push({ role: "user", parts: [{ functionResponse: { name, response: result } }] });
      }

      // Tool budget exhausted — ask for a final answer with the data gathered.
      const { parts: finalParts } = await geminiConverse({
        system: systemPrompt,
        contents,
        temperature: 0.4,
        maxTokens: 1024,
        thinkingBudget: 0,
      });
      actions.push("Generating analysis");
      return NextResponse.json({
        text:
          finalParts
            .map((p) => p.text ?? "")
            .join("")
            .trim() || "No response received.",
        filterAction: pendingFilterAction ?? undefined,
        dateAction: pendingDateAction ?? undefined,
        actions: actions.length ? actions : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI error";
      // If Gemini fails and Groq isn't available, surface it. For quota / rate
      // limits, show a friendly note instead of dumping the raw 429 JSON.
      if (!groqKey) {
        if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg)) {
          return NextResponse.json({
            text: "⚠️ The AI is rate-limited right now (the data source returned a lot of requests in a short time). Please wait ~30 seconds and try again.",
          });
        }
        return NextResponse.json({ error: msg }, { status: 500 });
      }
      // otherwise fall through to Groq
    }
  }

  // ─── Fallback: Groq ─────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: "system", content: systemPrompt },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...history.slice(-10).map((m: any) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: any[] = [
    queryDataToolOaiFor(connector),
    CAMPAIGN_SETTINGS_TOOL_OAI,
    showOnDashboardToolOaiFor(connector),
    SET_DATE_RANGE_TOOL,
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pendingFilterAction: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pendingDateAction: any = null;
  const actions: string[] = [];
  let activeFrom = queryDateFrom;
  let activeTo = queryDateTo;

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const res = await groq(groqKey!, {
      model: "llama-3.3-70b-versatile",
      messages,
      tools,
      tool_choice: "auto",
      max_tokens: 1024,
      temperature: 0.4,
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Groq error: ${await res.text()}` }, { status: 500 });
    }
    const data = await res.json();
    const choice = data.choices?.[0];

    if (choice?.finish_reason === "tool_calls") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolCalls: any[] = choice.message?.tool_calls ?? [];
      // Execute every tool call (including set_date_range, which is no longer
      // terminal), feed results back, then loop to continue the remaining steps.
      messages.push(choice.message);
      // The model usually asks for several things at once — a couple of
      // breakdowns and a settings read. Run in a row they cost the sum of their
      // upstream calls (40ms to 2.3s each), and the user waits through all of
      // it before a single word is written.
      //
      // Two of the tools change what the others read (the date range) or what
      // the answer carries (the dashboard button), so those go first, in the
      // order the model asked for them. What's left only READS, so it goes
      // together. Replies are pushed back in the model's own order regardless
      // of which finished first.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = toolCalls.map((tc: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let a: any = {};
        try {
          a = JSON.parse(tc.function.arguments);
        } catch {
          /* keep {} */
        }
        return { tc, fnName: tc.function?.name as string, a };
      });
      for (const { fnName, a } of parsed) actions.push(describeAction(fnName, a));

      const results = new Map<string, Record<string, unknown>>();
      const { stateful, readOnly } = partitionToolCalls(parsed);

      for (const { tc, fnName, a } of stateful) {
        if (fnName === "set_date_range") {
          pendingDateAction = { start: a.start, end: a.end, label: a.label };
          activeFrom = a.start;
          activeTo = a.end;
          results.set(tc.id, {
            ok: true,
            label: a.label,
            note: `Date range applied to ${a.label} (${a.start} → ${a.end}). Now continue with the remaining conditions (filters, data, analysis) for THIS period.`,
          });
        } else if (fnName === "show_on_dashboard") {
          pendingFilterAction = normalizeFilterAction(a, connector);
          results.set(
            tc.id,
            pendingFilterAction
              ? {
                  ok: true,
                  note: "A 'Show on dashboard' button will be attached to your answer. Now write the analysis text.",
                }
              : { ok: false, note: "No valid filters provided; skip the button and just answer." },
          );
        }
      }

      await Promise.all(
        readOnly.map(async ({ tc, fnName, a }) => {
          let result: Record<string, unknown>;
          if (fnName === "query_data") {
            result = await executeDataQuery(
              windsorKey,
              activeFrom,
              activeTo,
              a,
              user.id,
              accountId,
              connector,
            );
          } else if (fnName === "campaign_settings") {
            result = await executeCampaignSettings(windsorKey, activeFrom, activeTo, a, accountId);
          } else {
            result = { error: "Unsupported tool" };
          }
          results.set(tc.id, result);
        }),
      );

      // Every tool_call the model made needs an answer, in its own order.
      for (const { tc } of parsed)
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(results.get(tc.id) ?? { error: "Unsupported tool" }),
        });
      continue;
    }

    if (choice?.message?.content) actions.push("Generating analysis");
    return NextResponse.json({
      text: choice?.message?.content ?? "No response received.",
      filterAction: pendingFilterAction ?? undefined,
      dateAction: pendingDateAction ?? undefined,
      actions: actions.length ? actions : undefined,
    });
  }

  return NextResponse.json({
    text: "I gathered the data but couldn't compose a final answer — please ask again.",
    filterAction: pendingFilterAction ?? undefined,
    dateAction: pendingDateAction ?? undefined,
    actions: actions.length ? actions : undefined,
  });
}
