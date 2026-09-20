import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { adminClient } from "@/lib/supabase-admin";

// PATCH /api/team/members/:id  body: { role: "admin" | "user" }
// Only the team owner can change a member's role.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: memberId } = await params;
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

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Service role key not configured" }, { status: 503 });
  }

  const { role } = (await req.json()) as { role?: string };
  if (role !== "admin" && role !== "user") {
    return NextResponse.json({ error: "Role must be admin or user" }, { status: 400 });
  }

  const client = adminClient();
  const {
    data: { user: target },
  } = await client.auth.admin.getUserById(memberId);
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  // Verify the requester is the owner of the target's team
  const targetTeamId = target.user_metadata?.team_id as string | undefined;
  if (targetTeamId !== user.id) {
    return NextResponse.json(
      { error: "Only the team owner can change member roles" },
      { status: 403 },
    );
  }

  const { error } = await client.auth.admin.updateUserById(memberId, {
    user_metadata: { ...target.user_metadata, team_role: role },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE /api/team/members/:id — owner removes a member (sets their team_id to null)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: memberId } = await params;
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

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Service role key not configured" }, { status: 503 });
  }

  const client = adminClient();
  const {
    data: { user: target },
  } = await client.auth.admin.getUserById(memberId);
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const targetTeamId = target.user_metadata?.team_id as string | undefined;
  // Allow if requester is the owner OR the member is removing themselves
  if (targetTeamId !== user.id && memberId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const newMeta: Record<string, unknown> = { ...target.user_metadata };
  delete newMeta.team_id;
  delete newMeta.team_role;

  const { error } = await client.auth.admin.updateUserById(memberId, {
    user_metadata: newMeta,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
