import { isPlatformAdmin } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { isPromptType } from "@/lib/prompts";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { adminClient } from "@/lib/supabase-admin";
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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: "Service role key not configured" }, { status: 503 });

  const { id } = await params;
  const body = (await req.json()) as {
    name?: string;
    content?: string;
    active?: boolean;
    type?: string;
  };
  const client = adminClient();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.content === "string") patch.content = body.content;
  // Editing the type used to be silently dropped: the form sent it, the route
  // never wrote it, so a prompt kept whatever type it was created with.
  if (body.type !== undefined) {
    if (!isPromptType(body.type))
      return NextResponse.json({ error: `Unknown prompt type "${body.type}".` }, { status: 400 });
    patch.type = body.type;
  }

  if (body.active === true) {
    // Deactivate the siblings of the type it will HAVE, not the one it had —
    // moving an active prompt to another type otherwise left two active there.
    const { data: row } = await client.from("prompts").select("type").eq("id", id).single();
    const target = (patch.type as string | undefined) ?? row?.type;
    if (target) await client.from("prompts").update({ active: false }).eq("type", target);
    patch.active = true;
  } else if (body.active === false) {
    patch.active = false;
  }

  const { error } = await client.from("prompts").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // The optimizer's actions use these prompts too — clear its cache so the next
  // refresh regenerates with the edited prompt.
  await invalidateOptimizerCache();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: "Service role key not configured" }, { status: 503 });

  const { id } = await params;
  const { error } = await adminClient().from("prompts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await invalidateOptimizerCache();
  return NextResponse.json({ ok: true });
}
