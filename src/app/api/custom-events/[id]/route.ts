import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

async function getSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
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
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if ("category" in body) patch.category = body.category;
  if ("type" in body) patch.type = body.type ?? null;
  if ("startDate" in body) patch.start_date = body.startDate;
  if ("endDate" in body) patch.end_date = body.endDate || null;
  if ("title" in body) patch.title = body.title;
  if ("desc" in body) patch.description = body.desc || null;

  // Same rule as on create: an event cannot end before it starts.
  const start = (patch.start_date ?? "") as string;
  const end = (patch.end_date ?? "") as string;
  if (start && end && end < start)
    return NextResponse.json(
      { error: "The event ends before it starts. Clear the end date or move it later." },
      { status: 400 },
    );

  const { data, error } = await supabase
    .from("custom_events")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    id: data.id,
    category: data.category,
    type: data.type,
    startDate: data.start_date,
    endDate: data.end_date,
    title: data.title,
    desc: data.description,
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Missing ID" }, { status: 400 });
  }

  const { error } = await supabase
    .from("custom_events")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id); // Extra safety, RLS already handles this

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
