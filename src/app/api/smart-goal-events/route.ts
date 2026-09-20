import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { EVENT_CATEGORY_KEYS, isEventType } from "@/lib/smartGoalEvents";

// Events on the Smart Goals timeline — the manual ones a user adds to explain
// what happened. Automatic sources (Google Ads changes, holidays) are folded in
// on the client from their own endpoints.
//
// GET  /api/smart-goal-events?from=2026-01-01&to=2026-01-31
// POST /api/smart-goal-events

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

/** Missing table = the migration hasn't been run. The timeline shows no manual
 *  events rather than an error: nothing else on the page depends on them. */
// Two codes mean the same thing. Postgres raises 42P01 for a query against a
// table that isn't there; PostgREST answers PGRST205 before it ever runs one,
// because the table isn't in its schema cache. Only the second shows up in
// practice, which is why checking for the first alone looked fine and still
// surfaced a 500 on a fresh install.
const TABLE_MISSING = ["42P01", "PGRST205"];
const isTableMissing = (code?: string) => !!code && TABLE_MISSING.includes(code);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to))
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });

  // A multi-day event that starts before the window but runs into it still
  // belongs on this timeline, so the overlap test is on the span, not the start.
  const { data, error } = await supabase
    .from("smart_goal_events")
    .select("id, category, type, start_date, end_date, title, description")
    .eq("user_id", user.id)
    .lte("start_date", to)
    .or(`end_date.is.null,end_date.gte.${from}`)
    .order("start_date", { ascending: true });

  if (error) {
    if (isTableMissing(error.code)) return NextResponse.json({ events: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    events: (data ?? [])
      // The `or` above can't also re-check the window's lower bound for
      // single-day events, so those are filtered here.
      .filter((e) => (e.end_date ?? e.start_date) >= from)
      .map((e) => ({
        id: e.id,
        category: e.category,
        type: e.type,
        startDate: e.start_date,
        endDate: e.end_date,
        title: e.title,
        description: e.description,
        source: "manual" as const,
      })),
  });
}

export async function POST(req: NextRequest) {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { category, type, startDate, endDate, title, description } = body as Record<string, string>;

  // The same required set the modal enforces, checked again here so a client
  // that skips it can't store an event the timeline can't place or label.
  if (!EVENT_CATEGORY_KEYS.includes(category as never))
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  if (!isEventType(category as never, type))
    return NextResponse.json({ error: "Unknown event type for this category" }, { status: 400 });
  if (!ISO_DATE.test(startDate ?? ""))
    return NextResponse.json({ error: "startDate must be YYYY-MM-DD" }, { status: 400 });
  if (endDate && (!ISO_DATE.test(endDate) || endDate < startDate))
    return NextResponse.json({ error: "endDate must be on or after startDate" }, { status: 400 });
  if (!title?.trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("smart_goal_events")
    .insert({
      user_id: user.id,
      category,
      type,
      start_date: startDate,
      end_date: endDate || null,
      title: title.trim().slice(0, 80),
      description: description?.trim().slice(0, 200) || null,
    })
    .select("id, category, type, start_date, end_date, title, description")
    .single();

  if (error) {
    if (isTableMissing(error.code))
      return NextResponse.json(
        {
          error:
            "The smart_goal_events table doesn't exist yet. Run supabase/smart_goals.sql in the Supabase SQL editor.",
        },
        { status: 503 },
      );
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    event: {
      id: data.id,
      category: data.category,
      type: data.type,
      startDate: data.start_date,
      endDate: data.end_date,
      title: data.title,
      description: data.description,
      source: "manual" as const,
    },
  });
}
