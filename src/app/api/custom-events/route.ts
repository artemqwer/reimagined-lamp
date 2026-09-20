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

export async function GET() {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("custom_events")
    .select("*")
    .eq("user_id", user.id)
    .order("start_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Map to frontend format
  const mapped = data.map((e) => ({
    id: e.id,
    category: e.category,
    type: e.type,
    startDate: e.start_date,
    endDate: e.end_date,
    title: e.title,
    desc: e.description,
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const { category, type, startDate, endDate, title, desc } = body ?? {};

  // Checked here so a missing field is a sentence rather than a 500 quoting
  // Postgres — the raw message named the table and the column it rejected.
  if (!category || typeof category !== "string")
    return NextResponse.json({ error: "Pick a category for the event." }, { status: 400 });
  if (!title || typeof title !== "string" || !title.trim())
    return NextResponse.json({ error: "Give the event a title." }, { status: 400 });
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate))
    return NextResponse.json({ error: "Give the event a start date." }, { status: 400 });
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate))
    return NextResponse.json({ error: "The end date is not a date." }, { status: 400 });
  if (endDate && endDate < startDate)
    return NextResponse.json(
      { error: "The event ends before it starts. Clear the end date or move it later." },
      { status: 400 },
    );

  const { data, error } = await supabase
    .from("custom_events")
    .insert([
      {
        user_id: user.id,
        category,
        type: type || null,
        start_date: startDate,
        end_date: endDate || null,
        title,
        description: desc || null,
      },
    ])
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

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
