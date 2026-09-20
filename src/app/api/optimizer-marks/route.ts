import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { periodKind } from "@/lib/smartGoals";
import { ensureCustomConnectorsLoaded, isConnectorId } from "@/lib/connectors";

// Which optimizer recommendations a user has acted on or waved away.
//
// GET    /api/optimizer-marks?connector=…&period=… → { marks: {id: {state, at}} }
// POST   /api/optimizer-marks                      → mark one
// DELETE /api/optimizer-marks?…&id=…               → put it back
//
// Marks belong to the person who made them, so this talks to Supabase as the
// user (RLS owns the access rules — see supabase/optimizer_marks.sql).

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

// A missing table means the migration hasn't been run. That is a setup state,
// not a failure: dismissing still works for the session, it just won't outlive
// it, which is far better than a page that refuses to load.
const TABLE_MISSING = ["42P01", "PGRST205"];
const isTableMissing = (code?: string) => !!code && TABLE_MISSING.includes(code);
// The snapshot column predates a migration on some installs — treat "no such
// column" as "save without it" rather than an error.
const COLUMN_MISSING = ["42703", "PGRST204"];
const isColumnMissing = (code?: string) => !!code && COLUMN_MISSING.includes(code);
const SETUP_HINT =
  "Marks aren't stored yet — run supabase/optimizer_marks.sql in the Supabase SQL editor to keep them between visits.";

const STATES = ["completed", "dismissed"];

/** Both routes need the same two things checked before they touch the table. */
async function scope(req: NextRequest, body?: { connector?: string; period?: string }) {
  const connector = body?.connector ?? req.nextUrl.searchParams.get("connector") ?? "";
  const period = body?.period ?? req.nextUrl.searchParams.get("period") ?? "";
  try {
    periodKind(period);
  } catch {
    return { error: `Unsupported period "${period}" — expected YYYY-MM or YYYY` };
  }
  await ensureCustomConnectorsLoaded();
  if (!isConnectorId(connector)) return { error: `Unknown source "${connector}"` };
  return { connector, period };
}

export async function GET(req: NextRequest) {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const s = await scope(req);
  if ("error" in s) return NextResponse.json({ error: s.error }, { status: 400 });

  const read = (cols: string) =>
    supabase
      .from("optimizer_marks")
      .select(cols)
      .eq("user_id", user.id)
      .eq("connector", s.connector)
      .eq("period", s.period);

  // The snapshot column is added by a later migration; fall back to reading
  // without it so marks still load before that migration has been run.
  let { data, error } = await read("recommendation_id, state, marked_at, snapshot");
  if (error && isColumnMissing(error.code))
    ({ data, error } = await read("recommendation_id, state, marked_at"));

  if (error) {
    if (isTableMissing(error.code))
      return NextResponse.json({ marks: {}, stored: false, hint: SETUP_HINT });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const marks: Record<string, { state: string; at: string; snapshot?: unknown }> = {};
  for (const row of (data ?? []) as unknown as {
    recommendation_id: string;
    state: string;
    marked_at: string;
    snapshot?: unknown;
  }[])
    marks[row.recommendation_id] = {
      state: row.state,
      at: row.marked_at,
      snapshot: row.snapshot ?? undefined,
    };
  return NextResponse.json({ marks, stored: true });
}

export async function POST(req: NextRequest) {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    connector?: string;
    period?: string;
    id?: string;
    state?: string;
    snapshot?: unknown;
  } | null;
  const s = await scope(req, body ?? undefined);
  if ("error" in s) return NextResponse.json({ error: s.error }, { status: 400 });
  const id = (body?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Missing recommendation id" }, { status: 400 });
  if (!STATES.includes(body?.state ?? ""))
    return NextResponse.json({ error: "state must be completed or dismissed" }, { status: 400 });

  const marked_at = new Date().toISOString();
  const base = {
    user_id: user.id,
    connector: s.connector,
    period: s.period,
    recommendation_id: id,
    state: body!.state,
    marked_at,
  };
  const save = (row: Record<string, unknown>) =>
    supabase
      .from("optimizer_marks")
      .upsert(row, { onConflict: "user_id,connector,period,recommendation_id" });

  // Store the frozen analysis snapshot with the mark. If that column isn't there
  // yet (migration not run), save the mark without it rather than failing.
  let { error } = await save({ ...base, snapshot: body?.snapshot ?? null });
  if (error && isColumnMissing(error.code)) ({ error } = await save(base));

  if (error) {
    if (isTableMissing(error.code))
      return NextResponse.json({ ok: false, stored: false, hint: SETUP_HINT });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, stored: true, at: marked_at });
}

export async function DELETE(req: NextRequest) {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const s = await scope(req);
  if ("error" in s) return NextResponse.json({ error: s.error }, { status: 400 });
  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "Missing recommendation id" }, { status: 400 });

  const { error } = await supabase
    .from("optimizer_marks")
    .delete()
    .eq("user_id", user.id)
    .eq("connector", s.connector)
    .eq("period", s.period)
    .eq("recommendation_id", id);

  if (error) {
    if (isTableMissing(error.code))
      return NextResponse.json({ ok: false, stored: false, hint: SETUP_HINT });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, stored: true });
}
