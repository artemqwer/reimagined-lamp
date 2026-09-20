import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { adminClient } from "@/lib/supabase-admin";

export interface PendingInvite {
  from_id: string;
  from_name: string;
  from_email: string;
  created_at: string;
}

export async function GET() {
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
    return NextResponse.json({ invites: [] });
  }

  // Use admin client to get fresh metadata (session JWT may be stale)
  const {
    data: { user: fresh },
  } = await adminClient().auth.admin.getUserById(user.id);
  const invites: PendingInvite[] =
    (fresh?.user_metadata?.pending_team_invites as PendingInvite[] | undefined) ?? [];

  return NextResponse.json({ invites });
}

export async function PATCH(req: NextRequest) {
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

  const { from_id, action } = (await req.json()) as {
    from_id: string;
    action: "accept" | "decline";
  };
  if (!from_id || !action)
    return NextResponse.json({ error: "Missing from_id or action" }, { status: 400 });

  // Use fresh metadata — JWT cache may be stale after server-side updates
  const {
    data: { user: fresh },
  } = await adminClient().auth.admin.getUserById(user.id);
  const pending: PendingInvite[] =
    (fresh?.user_metadata?.pending_team_invites as PendingInvite[] | undefined) ?? [];
  const filtered = pending.filter((p) => p.from_id !== from_id);

  // If accepting, refuse when user is already in another team
  if (action === "accept") {
    const currentTeamId = fresh?.user_metadata?.team_id as string | undefined;
    if (currentTeamId && currentTeamId !== user.id && currentTeamId !== from_id) {
      return NextResponse.json(
        {
          error: "You are already a member of another team. Leave it first to accept this invite.",
          code: "ALREADY_IN_TEAM",
        },
        { status: 409 },
      );
    }
  }

  const newMeta: Record<string, unknown> = {
    ...fresh?.user_metadata,
    pending_team_invites: filtered,
  };

  if (action === "accept") {
    newMeta.team_id = from_id;
  }

  const { error } = await adminClient().auth.admin.updateUserById(user.id, {
    user_metadata: newMeta,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
