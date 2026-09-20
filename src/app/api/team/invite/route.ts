import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { adminClient, listAllUsers } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
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
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 503 },
    );
  }

  const { email } = (await req.json()) as { email: string };
  if (!email?.trim()) return NextResponse.json({ error: "Email required" }, { status: 400 });

  const teamOwnerId = (user.user_metadata?.team_id as string | undefined) ?? user.id;
  const client = adminClient();

  const {
    data: { user: owner },
  } = await client.auth.admin.getUserById(teamOwnerId);
  const ownerMeta = owner?.user_metadata ?? {};
  const ownerName =
    (ownerMeta.full_name as string | undefined) ??
    (ownerMeta.name as string | undefined) ??
    owner?.email ??
    "Someone";

  const all = await listAllUsers();
  const existing = all.find((u) => u.email?.toLowerCase() === email.trim().toLowerCase());

  if (existing) {
    const existingTeamId = existing.user_metadata?.team_id as string | undefined;

    // Already a member of another team — block invitation
    if (existingTeamId && existingTeamId !== existing.id && existingTeamId !== teamOwnerId) {
      const otherOwner = all.find((u) => u.id === existingTeamId);
      const otherName =
        (otherOwner?.user_metadata?.full_name as string | undefined) ??
        otherOwner?.email ??
        "another team";
      return NextResponse.json(
        {
          error: `This user is already a member of ${otherName}'s team`,
          code: "ALREADY_IN_TEAM",
        },
        { status: 409 },
      );
    }

    // Already in this team
    if (existingTeamId === teamOwnerId) {
      return NextResponse.json(
        {
          error: "This user is already a member of your team",
          code: "ALREADY_IN_YOUR_TEAM",
        },
        { status: 409 },
      );
    }

    const pending: {
      from_id: string;
      from_name: string;
      from_email: string;
      created_at: string;
    }[] = (existing.user_metadata?.pending_team_invites as typeof pending | undefined) ?? [];

    if (!pending.find((p) => p.from_id === teamOwnerId)) {
      pending.push({
        from_id: teamOwnerId,
        from_name: ownerName,
        from_email: owner?.email ?? "",
        created_at: new Date().toISOString(),
      });
      const { error } = await client.auth.admin.updateUserById(existing.id, {
        user_metadata: { ...existing.user_metadata, pending_team_invites: pending },
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, pending: true });
  }

  // New user — invite via Supabase email, but seed only a pending invite (no team_id).
  // They'll see the invite on their /invites page after signing in and must explicitly accept.
  const pendingInvite = {
    from_id: teamOwnerId,
    from_name: ownerName,
    from_email: owner?.email ?? "",
    created_at: new Date().toISOString(),
  };
  const { error } = await client.auth.admin.inviteUserByEmail(email.trim(), {
    data: { pending_team_invites: [pendingInvite] },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
