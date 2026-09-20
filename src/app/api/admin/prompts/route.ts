import { isPlatformAdmin } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { isPromptType, type PromptType } from "@/lib/prompts";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { adminClient } from "@/lib/supabase-admin";
import { FALLBACK_PROMPTS } from "@/lib/prompts";
import { invalidateOptimizerCache } from "@/lib/optimizerPhrasing";

async function requireAdmin() {
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
  if (!isPlatformAdmin(user)) return null;
  return user;
}

export async function GET() {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: "Service role key not configured" }, { status: 503 });

  const { data, error } = await adminClient()
    .from("prompts")
    .select("*")
    .order("type")
    .order("updated_at", { ascending: false });
  if (error)
    return NextResponse.json(
      { error: error.message, prompts: [] },
      { status: error.code === "42P01" ? 200 : 500 },
    );
  return NextResponse.json({ prompts: data ?? [] });
}

export async function POST(req: NextRequest) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: "Service role key not configured" }, { status: 503 });

  const body = (await req.json()) as {
    name?: string;
    type?: string;
    content?: string;
    active?: boolean;
    seed?: boolean;
    dedupe?: boolean;
  };
  const client = adminClient();

  // Remove duplicate prompts (same type + name) — keep one per group, preferring
  // the active one, otherwise the most recently updated.
  if (body.dedupe) {
    const { data: rows, error } = await client
      .from("prompts")
      .select("id, type, name, active, updated_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const groups = new Map<string, { id: string; active: boolean; updated_at: string }[]>();
    for (const r of (rows ?? []) as {
      id: string;
      type: string;
      name: string;
      active: boolean;
      updated_at: string;
    }[]) {
      const key = `${r.type}|${r.name}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push({
        id: r.id,
        active: r.active,
        updated_at: r.updated_at,
      });
    }
    const toDelete: string[] = [];
    for (const list of groups.values()) {
      if (list.length <= 1) continue;
      list.sort((a, b) =>
        a.active !== b.active ? (a.active ? -1 : 1) : b.updated_at > a.updated_at ? 1 : -1,
      );
      toDelete.push(...list.slice(1).map((x) => x.id)); // keep the first (active / newest)
    }
    if (toDelete.length > 0) {
      const { error: delErr } = await client.from("prompts").delete().in("id", toDelete);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, removed: toDelete.length });
  }

  // Seed the library with the built-in master prompts (active), so the admin
  // starts from the real, editable text. Idempotent — skip a default whose name
  // already exists so re-running never duplicates.
  if (body.seed) {
    const defaults = [
      {
        name: "Core Analyst (default)",
        type: "core",
        content: FALLBACK_PROMPTS.core,
        active: true,
      },
      {
        name: "Google Ads Analyst (default)",
        type: "google_ads",
        content: FALLBACK_PROMPTS.google_ads,
        active: true,
      },
      {
        name: "Preset Questions (default)",
        type: "preset_questions",
        content: FALLBACK_PROMPTS.preset_questions,
        active: true,
      },
    ];
    const { data: existing } = await client.from("prompts").select("name, type");
    const have = new Set(
      (existing ?? []).map((r: { name: string; type: string }) => `${r.type}|${r.name}`),
    );
    const missing = defaults.filter((d) => !have.has(`${d.type}|${d.name}`));
    if (missing.length > 0) {
      const { error } = await client.from("prompts").insert(missing);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, inserted: missing.length });
  }

  // Every type, not two of them.
  //
  // This recognised google_ads and preset_questions and quietly turned all the
  // rest into "core", so a prompt saved as the GA4 analyst came back badged
  // Core Analyst and was never used by the GA4 analyst. An unknown type is now
  // refused rather than replaced.
  if (body.type !== undefined && !isPromptType(body.type))
    return NextResponse.json({ error: `Unknown prompt type "${body.type}".` }, { status: 400 });
  const type: PromptType = isPromptType(body.type) ? body.type : "core";

  // Activating a prompt deactivates the others of the same type.
  if (body.active) await client.from("prompts").update({ active: false }).eq("type", type);

  const { data, error } = await client
    .from("prompts")
    .insert([
      {
        name: body.name?.trim() || "Untitled prompt",
        type,
        content: body.content ?? "",
        active: !!body.active,
      },
    ])
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // The optimizer's actions use these prompts too — clear its cache so the next
  // refresh regenerates with the new/activated prompt.
  await invalidateOptimizerCache();
  return NextResponse.json({ prompt: data });
}
