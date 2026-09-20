import { isPlatformAdmin } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { adminClient } from "@/lib/supabase-admin";

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

const ALLOWED = [
  "full_name",
  "company",
  "phone",
  "plan",
  "subscription_status",
  "subscription_expiry",
  "is_admin",
];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Service role key not configured" }, { status: 503 });
  }

  const { id } = await params;
  const client = adminClient();
  const {
    data: { user: target },
  } = await client.auth.admin.getUserById(id);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json()) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of ALLOWED) if (k in body) patch[k] = body[k];

  // Prevent locking yourself out of admin access.
  if (id === me.id && patch.is_admin === false) {
    return NextResponse.json({ error: "You can't remove your own admin access" }, { status: 400 });
  }

  // The profile fields stay in user_metadata, where the user may edit their own.
  // is_admin does not: it decides who can open this panel and, through `view_as`
  // on the data routes, read any tenant's figures — so it is written to
  // app_metadata, which only the service role can touch. Splitting them here is
  // what keeps `updateUser({ data: { is_admin: true } })` from the browser inert.
  const { is_admin: isAdminPatch, ...profilePatch } = patch;

  const { error } = await client.auth.admin.updateUserById(id, {
    user_metadata: { ...target.user_metadata, ...profilePatch },
    ...(isAdminPatch === undefined
      ? {}
      : { app_metadata: { ...target.app_metadata, is_admin: isAdminPatch === true } }),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Service role key not configured" }, { status: 503 });
  }

  const { id } = await params;
  if (id === me.id)
    return NextResponse.json({ error: "You can't delete your own account" }, { status: 400 });

  const { error } = await adminClient().auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
