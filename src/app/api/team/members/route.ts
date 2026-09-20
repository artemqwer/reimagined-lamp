import { windsorApiKeyOf } from "@/lib/authz";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { listAllUsers, makeAvatarColor } from "@/lib/supabase-admin";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  hasWindsor: boolean;
  isPending: boolean;
  role: "owner" | "admin" | "user";
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
    return NextResponse.json({ members: [] });
  }

  const all = await listAllUsers();
  const myTeamId = user.user_metadata?.team_id as string | undefined;
  const members: TeamMember[] = [];

  type PendingInvite = { from_id: string };

  const roleOf = (meta: Record<string, unknown>): "admin" | "user" =>
    (meta.team_role as "admin" | "user" | undefined) === "admin" ? "admin" : "user";

  // If I'm a team owner (no team_id, or team_id === my id):
  // include myself + accepted members + pending invitees
  if (!myTeamId || myTeamId === user.id) {
    const myMeta = user.user_metadata ?? {};
    members.push({
      id: user.id,
      name: (myMeta.full_name as string) || user.email?.split("@")[0] || "You",
      email: user.email ?? "",
      avatarColor: makeAvatarColor(user.id),
      hasWindsor: !!windsorApiKeyOf(user),
      isPending: false,
      role: "owner",
    });
    for (const u of all) {
      if (u.id === user.id) continue;
      const m = u.user_metadata ?? {};
      const isAccepted = (m.team_id as string | undefined) === user.id;
      const isPending = ((m.pending_team_invites as PendingInvite[] | undefined) ?? []).some(
        (p) => p.from_id === user.id,
      );
      if (!isAccepted && !isPending) continue;
      members.push({
        id: u.id,
        name: (m.full_name as string) || u.email?.split("@")[0] || "Unknown",
        email: u.email ?? "",
        avatarColor: makeAvatarColor(u.id),
        hasWindsor: !!windsorApiKeyOf(u),
        isPending,
        role: isAccepted ? roleOf(m) : "user",
      });
    }
  } else {
    // I'm a member of someone else's team — show owner + all teammates (including me)
    const owner = all.find((u) => u.id === myTeamId);
    if (owner) {
      const m = owner.user_metadata ?? {};
      members.push({
        id: owner.id,
        name: (m.full_name as string) || owner.email?.split("@")[0] || "Unknown",
        email: owner.email ?? "",
        avatarColor: makeAvatarColor(owner.id),
        hasWindsor: !!windsorApiKeyOf(owner),
        isPending: false,
        role: "owner",
      });
    }
    for (const u of all.filter(
      (u) => (u.user_metadata?.team_id as string | undefined) === myTeamId,
    )) {
      const m2 = u.user_metadata ?? {};
      members.push({
        id: u.id,
        name: (m2.full_name as string) || u.email?.split("@")[0] || "Unknown",
        email: u.email ?? "",
        avatarColor: makeAvatarColor(u.id),
        hasWindsor: !!windsorApiKeyOf(u),
        isPending: false,
        role: roleOf(m2),
      });
    }
  }

  return NextResponse.json({ members });
}
