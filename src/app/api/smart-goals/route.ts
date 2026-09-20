import { isPlatformAdmin } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  carryForward,
  monthsOfYear,
  periodKind,
  previousPeriod,
  rollUpMonthsToYear,
  splitYearToMonth,
  validateSettings,
  type SmartGoalsSettings,
} from "@/lib/smartGoals";
import { goalMetricsFor } from "@/lib/smartGoalMetrics";
import { ensureCustomConnectorsLoaded, isConnectorId } from "@/lib/connectors";

// Smart Goals configuration for one period.
//
// GET  /api/smart-goals?period=2026-01 → { settings, configured, source }
// POST /api/smart-goals                → saves one period's settings
//
// Goals belong to the person who set them, so this talks to Supabase as the
// user (RLS owns the access rules — see supabase/smart_goals.sql), not with the
// service role.

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

/** Missing table (42P01) means the migration hasn't been run yet. That's a
 *  setup state, not a failure: the dashboard shows the empty "no goals" state
 *  rather than an error nobody can act on. */
// Two codes mean the same thing. Postgres raises 42P01 for a query against a
// table that isn't there; PostgREST answers PGRST205 before it ever runs one,
// because the table isn't in its schema cache. Only the second shows up in
// practice, which is why checking for the first alone looked fine and still
// surfaced a 500 on a fresh install.
const TABLE_MISSING = ["42P01", "PGRST205"];
const isTableMissing = (code?: string) => !!code && TABLE_MISSING.includes(code);

/** The table exists but predates goals being per source. Named rather than
 *  passed through as "column smart_goals.connector does not exist", which tells
 *  nobody what to do about it. */
const COLUMN_MISSING = ["42703", "PGRST204"];
const isColumnMissing = (code?: string) => !!code && COLUMN_MISSING.includes(code);
const MIGRATION_HINT =
  "Smart Goals is now per data source. Re-run supabase/smart_goals.sql in the Supabase SQL editor to add the `connector` column.";

/**
 * "View as Client" access for goals: WHICH user's goals a request reads/writes,
 * and WHICH Supabase client to do it with.
 *
 * smart_goals is RLS-protected owner-only (auth.uid() = user_id), so the normal
 * user-scoped client can only ever touch the caller's own rows — filtering by a
 * different user_id still returns nothing and a cross-user write is rejected.
 * When an authorised admin / same-team viewer is acting as a client, we therefore
 * switch to the service-role client (which bypasses RLS) AND target the client's
 * id. Otherwise it's the caller's own id with their own RLS client, unchanged.
 */
async function resolveGoalsAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: { id: string; user_metadata?: any },
  viewAs: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ userId: string; admin: any | null }> {
  if (!viewAs || viewAs === user.id || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return { userId: user.id, admin: null };
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const {
    data: { user: target },
  } = await admin.auth.admin.getUserById(viewAs);
  if (!target) return { userId: user.id, admin: null };
  const targetTeamId = target.user_metadata?.team_id as string | undefined;
  // Authorize view_as ONLY on values the caller cannot forge (see the note in
  // /api/windsor): the removed myTeamId clauses trusted the caller's own
  // user_metadata.team_id, which any user can rewrite to a victim's id.
  const authorized = isPlatformAdmin(user) || targetTeamId === user.id;
  return authorized ? { userId: viewAs, admin } : { userId: user.id, admin: null };
}

export async function GET(req: NextRequest) {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // "View as Client": an admin (or same-team member) reads the client's goals so
  // the Smart Goals / AI Optimizer pages show the client's plan. Under view-as the
  // read goes through the service-role client (`db`), which bypasses the owner-only
  // RLS that would otherwise hide the client's rows from the admin's session.
  const { userId: targetUserId, admin } = await resolveGoalsAccess(
    user,
    req.nextUrl.searchParams.get("view_as"),
  );
  const db = admin ?? supabase;

  const period = req.nextUrl.searchParams.get("period") ?? "";
  try {
    periodKind(period);
  } catch {
    return NextResponse.json(
      { error: `Unsupported period "${period}" — expected YYYY-MM or YYYY` },
      { status: 400 },
    );
  }

  // Goals belong to a source. The registry has to be loaded before a slug can
  // be checked — the server has its own JS context, so an admin-added source is
  // otherwise unknown here.
  await ensureCustomConnectorsLoaded();
  const connector = req.nextUrl.searchParams.get("connector") ?? "";
  if (!isConnectorId(connector))
    return NextResponse.json({ error: `Unknown source "${connector}"` }, { status: 400 });

  // Everything this period could inherit from, in one read: the period before
  // it (an unconfigured month continues where the last left off), and the
  // periods of the other shape describing the same time — the months inside a
  // year, or the year around a month. A plan entered on either shape is a plan
  // for both, so neither view starts empty because of where it was typed.
  const kind = periodKind(period);
  const prev = previousPeriod(period);
  const related = kind === "year" ? monthsOfYear(period) : [period.slice(0, 4)];
  const { data, error } = await db
    .from("smart_goals")
    .select("period, config")
    .eq("user_id", targetUserId)
    .eq("connector", connector)
    .in("period", [period, prev, ...related]);

  if (error) {
    if (isTableMissing(error.code))
      return NextResponse.json({ settings: null, configured: false, source: "empty" });
    if (isColumnMissing(error.code))
      return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as { period: string; config: SmartGoalsSettings }[];
  const rowFor = (p: string) => rows.find((r) => r.period === p)?.config;
  const own = rowFor(period) ?? null;
  const metrics = goalMetricsFor(connector);

  // Ordered by how directly each speaks for this period.
  //
  // A year is described best by its own months — they are this year's plan,
  // where last year's is only a precedent. A month is described best by the
  // month before it, which is the most recent thing the user actually decided;
  // a share of the year is the coarser statement and comes after.
  const carried = carryForward(period, connector, null, rowFor(prev) ?? null);
  let settings =
    kind === "year"
      ? (own ??
        rollUpMonthsToYear(
          period,
          connector,
          related.map(rowFor).filter((r): r is SmartGoalsSettings => !!r),
          metrics,
        ) ??
        carried)
      : (own ??
        carried ??
        splitYearToMonth(period, connector, rowFor(related[0]) ?? null, metrics));

  // Where they came from, so the UI can say where the numbers are from rather
  // than implying the user typed them here. Computed BEFORE the layout override
  // below, which replaces `settings` with a new object and would break the
  // reference check against `carried`.
  const source = !settings
    ? "empty"
    : own
      ? "own"
      : settings === carried
        ? "carried"
        : kind === "year"
          ? "rolled_up"
          : "split";

  // Order and colour are a single per-source choice, not a per-period one: a
  // metric should sit in the same position and show the same colour in every
  // month. The layout the user set most recently wins, applied to whatever this
  // period's goals are — so existing periods look consistent without needing to
  // be re-saved. Targets/enabled/auto stay per period.
  if (settings) {
    try {
      const { data: recentRows } = await db
        .from("smart_goals")
        .select("config")
        .eq("user_id", targetUserId)
        .eq("connector", connector)
        .order("updated_at", { ascending: false })
        .limit(1);
      const layout = (recentRows?.[0]?.config as SmartGoalsSettings | undefined)?.goals;
      if (layout?.length) {
        const byMetric = new Map(layout.map((g) => [g.metric, { order: g.order, color: g.color }]));
        settings = {
          ...settings,
          goals: settings.goals.map((g) => {
            const l = byMetric.get(g.metric);
            return l ? { ...g, order: l.order, color: l.color } : g;
          }),
        };
      }
    } catch {
      /* the layout override is cosmetic — a hiccup here must not blank the goals */
    }
  }

  return NextResponse.json({
    settings,
    // Whether this period has goals at all — false puts the empty state on
    // screen and blocks the AI features that depend on having a goal.
    configured: settings !== null,
    source,
  });
}

export async function POST(req: NextRequest) {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // "View as Client": an admin editing a client's goals while viewing as them
  // writes to the CLIENT, not to their own account — otherwise the goal they just
  // saved vanishes from the view-as view (it landed on the admin instead). The
  // write goes through the service-role client (`db`) so the owner-only RLS
  // WITH CHECK doesn't reject a row whose user_id isn't the admin's.
  const { userId: targetUserId, admin } = await resolveGoalsAccess(
    user,
    req.nextUrl.searchParams.get("view_as"),
  );
  const db = admin ?? supabase;

  const body = (await req.json().catch(() => null)) as { settings?: SmartGoalsSettings } | null;
  const settings = body?.settings;
  if (!settings) return NextResponse.json({ error: "Missing settings" }, { status: 400 });

  try {
    periodKind(settings.period);
  } catch {
    return NextResponse.json({ error: "Unsupported period" }, { status: 400 });
  }

  await ensureCustomConnectorsLoaded();
  if (!isConnectorId(settings.connector))
    return NextResponse.json({ error: "Unknown source" }, { status: 400 });

  // Narrow to the shape smartGoals.ts defines BEFORE validating, so what gets
  // checked is exactly what gets stored: an unknown key a client sent would
  // otherwise be read back as if it were configuration, and a target that
  // arrived as a string ("7500" from a number input) would fail the check
  // rather than being coerced.
  const clean: SmartGoalsSettings = {
    connector: settings.connector,
    period: settings.period,
    goals: (settings.goals ?? []).map((g) => ({
      metric: g.metric,
      enabled: !!g.enabled,
      order: Number(g.order) || 0,
      color: typeof g.color === "string" ? g.color : undefined,
      target:
        g.target === null || g.target === undefined || g.target === ("" as unknown as number)
          ? null
          : Number(g.target),
      auto: !!g.auto,
    })),
    aiFocus: settings.aiFocus ?? null,
    marginPct: Number(settings.marginPct),
    alwaysShowTimeline: !!settings.alwaysShowTimeline,
  };

  // The same validation the modal runs, applied again here: a client that skips
  // it must not be able to store a configuration the rest of the app can't
  // interpret (no goals at all, or a target of zero).
  // Validated against THIS source's metrics: a target on a metric the source
  // doesn't have can't be stored, whatever the client believed.
  const validation = validateSettings(clean, goalMetricsFor(clean.connector));
  if (!validation.canSave) {
    return NextResponse.json(
      {
        error: "Invalid goal configuration",
        errors: validation.errors,
        formErrors: validation.formErrors,
      },
      { status: 400 },
    );
  }

  const { error } = await db.from("smart_goals").upsert(
    {
      user_id: targetUserId,
      connector: clean.connector,
      period: clean.period,
      config: clean,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,connector,period" },
  );

  if (error) {
    if (isTableMissing(error.code))
      return NextResponse.json(
        {
          error:
            "The smart_goals table doesn't exist yet. Run supabase/smart_goals.sql in the Supabase SQL editor.",
        },
        { status: 503 },
      );
    if (isColumnMissing(error.code))
      return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Order and colour are a single per-source choice, not a per-period one: the
  // client wants each metric to sit in the same position and show the same
  // colour in every month, current and previous. So stamp the layout just saved
  // onto every other stored period for this source. Targets, enabled and auto
  // stay per period — only where a goal sits and what colour it is are shared.
  // Best-effort: the period itself is already saved, so a failure here doesn't
  // fail the request.
  try {
    const layout = new Map(clean.goals.map((g) => [g.metric, { order: g.order, color: g.color }]));
    const { data: others } = await db
      .from("smart_goals")
      .select("period, config")
      .eq("user_id", targetUserId)
      .eq("connector", clean.connector)
      .neq("period", clean.period);
    const updates = [];
    for (const row of others ?? []) {
      const cfg = row.config as SmartGoalsSettings;
      let changed = false;
      const goals = (cfg.goals ?? []).map((g) => {
        const l = layout.get(g.metric);
        if (l && (g.order !== l.order || g.color !== l.color)) {
          changed = true;
          return { ...g, order: l.order, color: l.color };
        }
        return g;
      });
      if (changed)
        updates.push({
          user_id: targetUserId,
          connector: clean.connector,
          period: row.period,
          config: { ...cfg, goals },
          updated_at: new Date().toISOString(),
        });
    }
    if (updates.length)
      await db.from("smart_goals").upsert(updates, { onConflict: "user_id,connector,period" });
  } catch {
    /* layout sync is a convenience; the saved period stands regardless */
  }

  return NextResponse.json({ ok: true, settings: clean });
}
