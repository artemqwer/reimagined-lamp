import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { adminClient } from "@/lib/supabase-admin";
import type { Opportunity } from "@/lib/aiOptimizer";
import {
  phrasingHash,
  buildSystemPrompt,
  rewordFindings,
  type Finding,
  type WordedItem,
} from "@/lib/optimizerPhrasing";

// The reword calls Gemini; give it room past the default serverless window.
export const maxDuration = 30;

// Serve the AI Optimizer's reworded recommendations, cached by a hash of the
// findings so the paid step runs once per DISTINCT set:
//   • worded already   → return the model's wording + when it ran (free).
//   • not worded yet   → reword it now (model call), cache it, and return it, so
//                        the model's wording AND the admin's optimizer prompt
//                        apply on first view — not only after the nightly refresh.
// The findings themselves are computed on the page (deterministic, free); the
// model only ever rewrites their WORDING, never the numbers. The daily refresh
// (/api/ai-optimizer/refresh) still exists to reword sets nobody has opened.

async function getUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) cookieStore.set(name, value, options);
          } catch {
            /* not a route handler — nothing to persist */
          }
        },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    opportunities?: (Opportunity & { action?: string })[];
    goalLabel?: string;
    connector?: string;
  } | null;
  const items = body?.opportunities ?? [];
  if (items.length === 0) return NextResponse.json({ items: [] });

  const connector = body?.connector ?? "google_ads";
  const goalLabel = body?.goalLabel ?? "revenue";
  const findings: Finding[] = items.slice(0, 12).map((o) => ({
    id: o.id,
    kind: o.kind,
    title: o.title,
    detail: o.detail,
    action: o.action ?? "",
  }));
  // The wording to show until the model's is ready: the computed text itself.
  const computed: WordedItem[] = findings.map((o) => ({
    id: o.id,
    title: o.title,
    detail: o.detail,
    action: o.action,
  }));

  // No service role → no cache table to read. Serve the computed wording; the
  // page still works, it just isn't model-polished.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ items: computed, analyzedAt: null, pending: true });

  const hash = phrasingHash(connector, goalLabel, findings);
  try {
    const { data } = await adminClient()
      .from("optimizer_analysis")
      .select("worded, analyzed_at")
      .eq("hash", hash)
      .maybeSingle();

    const worded = data?.worded as WordedItem[] | null | undefined;
    if (worded && worded.length)
      return NextResponse.json({ items: worded, analyzedAt: data?.analyzed_at ?? null });

    // Not cached yet. Record the findings (so the refresh has them), then reword
    // them NOW so the model's wording — and the admin's optimizer prompt — apply
    // on first view instead of only after the nightly job. It's cached by hash,
    // so this costs one model call per DISTINCT set of findings (the same call
    // the refresh would make, just earlier); every later view of the same set
    // reads the cache above for free.
    if (!data) {
      await adminClient()
        .from("optimizer_analysis")
        .upsert(
          { hash, connector, goal_label: goalLabel, findings, worded: null },
          { onConflict: "hash" },
        );
    }

    try {
      const system = await buildSystemPrompt(connector);
      const items = await rewordFindings({ system, goalLabel, findings });
      if (items && items.length) {
        const analyzedAt = new Date().toISOString();
        await adminClient()
          .from("optimizer_analysis")
          .update({ worded: items, analyzed_at: analyzedAt })
          .eq("hash", hash);
        return NextResponse.json({ items, analyzedAt });
      }
    } catch {
      /* model unavailable / timed out — fall through to the computed wording */
    }

    // Reword didn't land — serve the computed wording, but keep "Last analyzed"
    // from vanishing: fall back to the most recent analysed run for this
    // source+goal (today's data can shift the hash to one not worded yet).
    let analyzedAt = data?.analyzed_at ?? null;
    if (!analyzedAt) {
      const { data: recent } = await adminClient()
        .from("optimizer_analysis")
        .select("analyzed_at")
        .eq("connector", connector)
        .eq("goal_label", goalLabel)
        .not("analyzed_at", "is", null)
        .order("analyzed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      analyzedAt = recent?.analyzed_at ?? null;
    }
    return NextResponse.json({ items: computed, analyzedAt, pending: true });
  } catch {
    // Missing table or a transient error — serve the computed wording.
    return NextResponse.json({ items: computed, analyzedAt: null, pending: true });
  }
}
