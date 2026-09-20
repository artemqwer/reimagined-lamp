import { isPlatformAdmin } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { adminClient } from "@/lib/supabase-admin";
import {
  isConnectorId,
  ensureCustomConnectorsLoaded,
  type ConnectorConfigMap,
} from "@/lib/connectors";

// Global, admin-defined per-connector display config (which tables/metrics show,
// order, labels). Read by every user's dashboard; written by admins only —
// mirrors the AI-prompts admin pattern (Supabase table + service-role client).
//
// Table `connector_config`: connector text primary key, config jsonb, updated_at.
// Missing table (42P01) is treated as "no overrides" so the app runs on the
// built-in manifest defaults until an admin configures anything.

async function getUser() {
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
  return user;
}

// GET → the whole override map { [connector]: config }. Any authenticated user
// (the dashboard needs it to render the admin-configured tables).
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ configs: {} });
  await ensureCustomConnectorsLoaded();

  const { data, error } = await adminClient().from("connector_config").select("connector, config");
  if (error) {
    // Table not created yet → run on defaults.
    if (error.code === "42P01") return NextResponse.json({ configs: {} });
    return NextResponse.json({ error: error.message, configs: {} }, { status: 500 });
  }
  const configs: ConnectorConfigMap = {};
  for (const row of (data ?? []) as { connector: string; config: unknown }[]) {
    if (isConnectorId(row.connector) && row.config && typeof row.config === "object") {
      configs[row.connector] = row.config as ConnectorConfigMap[typeof row.connector];
    }
  }
  return NextResponse.json({ configs });
}

// POST → upsert one connector's config. Admin only.
export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!isPlatformAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: "Service role key not configured" }, { status: 503 });
  await ensureCustomConnectorsLoaded();

  const body = (await req.json().catch(() => ({}))) as { connector?: string; config?: unknown };
  if (!isConnectorId(body.connector))
    return NextResponse.json({ error: "Unknown connector" }, { status: 400 });

  const { error } = await adminClient()
    .from("connector_config")
    .upsert(
      {
        connector: body.connector,
        config: body.config ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "connector" },
    );
  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json(
        {
          error:
            "The connector_config table doesn't exist yet. Create it in Supabase: connector text primary key, config jsonb, updated_at timestamptz.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
