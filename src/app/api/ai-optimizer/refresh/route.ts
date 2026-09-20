import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase-admin";
import {
  buildSystemPrompt,
  rewordFindings,
  type Finding,
  type WordedItem,
} from "@/lib/optimizerPhrasing";

// The daily AI Optimizer refresh — the one place the model is called.
//
// It rewords the findings that page opens recorded as pending (optimizer_analysis
// rows with no wording yet) and stores the result, so every user reads it for
// the rest of the day without a model call. Only NEW/changed findings are
// reworded — a day where nothing moved costs nothing.
//
// Triggered by Vercel Cron (see vercel.json). Vercel attaches
// `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set in the project
// env; this route refuses anything else, so the endpoint can't be run by others.

// Let this function run longer than the platform default — it makes several
// model calls. Still bounded by DEADLINE_MS below so it always returns.
export const maxDuration = 60;

// Bound the work per run so one invocation can't fan out into a huge model bill
// if a lot of distinct findings accumulated. Whatever isn't done drains on the
// next run — each row is committed as it finishes.
const MAX_PER_RUN = 30;
// How many rewrites run at once. Sequential calls blew past the function's time
// limit on any real backlog; a small pool fits far more into the budget.
const CONCURRENCY = 6;
// Stop starting new work after this, so the function returns a result instead of
// being killed mid-flight (and the caller/cron sees a clean response).
const DEADLINE_MS = 50_000;
// Findings churn as the data moves; drop rows older than this so the table
// doesn't grow without bound. Comfortably longer than a day, so nothing in use
// is removed.
const PRUNE_AFTER_DAYS = 14;

async function refresh(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "CRON_SECRET is not set — the refresh endpoint is disabled." },
      { status: 503 },
    );
  if (req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: "Service role key not configured" }, { status: 503 });

  const db = adminClient();

  // Prune stale rows first — best-effort.
  try {
    const cutoff = new Date(Date.now() - PRUNE_AFTER_DAYS * 86_400_000).toISOString();
    await db.from("optimizer_analysis").delete().lt("created_at", cutoff);
  } catch {
    /* pruning is housekeeping — a failure here doesn't stop the refresh */
  }

  let pending: { hash: string; connector: string; goal_label: string; findings: Finding[] }[] = [];
  try {
    const { data, error } = await db
      .from("optimizer_analysis")
      .select("hash, connector, goal_label, findings")
      .is("worded", null)
      // Newest first: word the findings people are actually looking at today
      // before any stale backlog, which ages out via the prune above.
      .order("created_at", { ascending: false })
      .limit(MAX_PER_RUN);
    if (error) {
      if (error.code === "42P01")
        return NextResponse.json(
          { error: "optimizer_analysis table not found — run supabase/optimizer_analysis.sql." },
          { status: 503 },
        );
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    pending = (data ?? []) as typeof pending;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "read failed" },
      { status: 500 },
    );
  }

  // One system prompt per connector, not per row.
  const systemByConnector = new Map<string, string>();
  const systemFor = async (connector: string) => {
    const cached = systemByConnector.get(connector);
    if (cached !== undefined) return cached;
    const s = await buildSystemPrompt(connector);
    systemByConnector.set(connector, s);
    return s;
  };

  // Reword a few at a time, up to the time budget. Each row is stored as it
  // finishes, so a run that's cut short still makes progress and the rest drains
  // next time.
  const start = Date.now();
  const analyzedAt = new Date().toISOString();
  let worded = 0;
  let next = 0;
  const worker = async () => {
    while (Date.now() - start < DEADLINE_MS) {
      const i = next++;
      if (i >= pending.length) return;
      const row = pending[i];
      const findings = Array.isArray(row.findings) ? row.findings : [];
      if (findings.length === 0) continue;
      const system = await systemFor(row.connector);
      const items: WordedItem[] | null = await rewordFindings({
        system,
        goalLabel: row.goal_label || "revenue",
        findings,
      });
      if (!items) continue; // leave pending; the next run tries again
      try {
        await db
          .from("optimizer_analysis")
          .update({ worded: items, analyzed_at: analyzedAt })
          .eq("hash", row.hash);
        worded++;
      } catch {
        /* couldn't store this one — it stays pending for next time */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

  return NextResponse.json({
    ok: true,
    pending: pending.length,
    worded,
    remaining: pending.length - worded,
    analyzedAt,
  });
}

// Vercel Cron issues a GET; POST is offered too for manual/authorized triggers.
export const GET = refresh;
export const POST = refresh;
