import { isPlatformAdmin } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { adminClient } from "@/lib/supabase-admin";
import {
  BUILT_IN_CONNECTORS,
  type CustomConnectorRow,
  type CustomConnectorDimensionInput,
  type CustomConnectorMetricInput,
  type MetricSchema,
  type MetricFormat,
} from "@/lib/connectors";

// Admin-defined data sources (see supabase/custom_connectors.sql). Read by
// every signed-in user (the dashboard needs the full list to render the
// Sidebar / connector switcher / data-sources page); written by admins only —
// same pattern as /api/connector-config and /api/admin/prompts.

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

// "Table doesn't exist yet" shows up as either the raw Postgres code (42P01)
// or PostgREST's own schema-cache miss (PGRST205), depending on which layer
// answers first — treat both as "not set up yet" rather than a hard 500.
const isMissingTable = (code: string | undefined) => code === "42P01" || code === "PGRST205";

const SLUG_RE = /^[a-z][a-z0-9_]{1,39}$/;
const METRIC_SCHEMAS: MetricSchema[] = ["ads", "analytics", "commerce"];
const METRIC_FORMATS: MetricFormat[] = ["money", "number", "percent", "ratio"];

function isDimensionInput(v: unknown): v is CustomConnectorDimensionInput {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.key === "string" &&
    d.key.trim() !== "" &&
    typeof d.label === "string" &&
    d.label.trim() !== "" &&
    typeof d.singular === "string" &&
    d.singular.trim() !== "" &&
    typeof d.windsorField === "string" &&
    d.windsorField.trim() !== ""
  );
}

function isMetricInput(v: unknown): v is CustomConnectorMetricInput {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.key === "string" &&
    m.key.trim() !== "" &&
    typeof m.label === "string" &&
    m.label.trim() !== "" &&
    typeof m.windsorField === "string" &&
    m.windsorField.trim() !== "" &&
    METRIC_FORMATS.includes(m.format as MetricFormat) &&
    // Optional; absent falls back to the format (see MetricDef.aggregation).
    (m.aggregation === undefined || m.aggregation === "sum" || m.aggregation === "avg")
  );
}

function validate(body: Record<string, unknown>): { row: CustomConnectorRow } | { error: string } {
  const id = String(body.id ?? "")
    .trim()
    .toLowerCase();
  if (!SLUG_RE.test(id))
    return {
      error:
        "Id must be lowercase letters, numbers and underscores (2-40 chars, starting with a letter)",
    };
  if (id in BUILT_IN_CONNECTORS)
    return { error: `"${id}" is a built-in connector and can't be overridden` };

  const label = String(body.label ?? "").trim();
  if (!label) return { error: "Label is required" };

  const color = String(body.color ?? "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: "Color must be a hex value like #4285F4" };

  const windsorSource = String(body.windsor_source ?? "").trim();
  if (!windsorSource) return { error: "Windsor source slug is required" };

  const metricSchema = body.metric_schema as MetricSchema;
  if (!METRIC_SCHEMAS.includes(metricSchema))
    return { error: "metric_schema must be one of: ads, analytics, commerce" };

  if (!isDimensionInput(body.primary_dimension))
    return { error: "Primary dimension is required (key, label, singular, windsorField)" };

  const dimensionsRaw = Array.isArray(body.dimensions) ? body.dimensions : [];
  if (!dimensionsRaw.every(isDimensionInput))
    return { error: "Every additional dimension needs key, label, singular and windsorField" };

  const aiDimensionsRaw = Array.isArray(body.ai_dimensions) ? body.ai_dimensions : [];
  if (!aiDimensionsRaw.every((d) => typeof d === "string"))
    return { error: "ai_dimensions must be a list of dimension keys" };

  const customMetricsRaw = Array.isArray(body.custom_metrics) ? body.custom_metrics : [];
  if (!customMetricsRaw.every(isMetricInput))
    return {
      error: "Every custom metric needs key, label, windsorField and a valid format",
    };
  const metricKeys = customMetricsRaw.map((m) => (m as CustomConnectorMetricInput).key);
  if (new Set(metricKeys).size !== metricKeys.length)
    return { error: "Custom metric keys must be unique" };

  return {
    row: {
      id,
      label,
      color,
      windsor_source: windsorSource,
      metric_schema: metricSchema,
      primary_dimension: body.primary_dimension as CustomConnectorDimensionInput,
      dimensions: dimensionsRaw as CustomConnectorDimensionInput[],
      ai_dimensions: aiDimensionsRaw as string[],
      custom_metrics: customMetricsRaw as CustomConnectorMetricInput[],
    },
  };
}

// GET → every custom connector. Any authenticated user.
// GET is deliberately open to any signed-in user, despite the /api/admin path:
// the dashboard layout loads the source registry for everyone, and locking this
// down would leave every non-admin without their connected sources. Only the
// writes below are admin-only. Move the read to a neutral path if the path
// keeps inviting the question.
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ connectors: [] });

  const { data, error } = await adminClient()
    .from("custom_connectors")
    .select(
      "id, label, color, windsor_source, metric_schema, primary_dimension, dimensions, ai_dimensions, custom_metrics",
    )
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingTable(error.code)) return NextResponse.json({ connectors: [] });
    return NextResponse.json({ error: error.message, connectors: [] }, { status: 500 });
  }
  return NextResponse.json({ connectors: data ?? [] });
}

// POST → create or update (upsert by id) a custom connector. Admin only.
export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user || !isPlatformAdmin(user))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: "Service role key not configured" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = validate(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  const { row } = result;
  const { error } = await adminClient()
    .from("custom_connectors")
    .upsert(
      { ...row, created_by: user.email, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );
  if (error) {
    if (isMissingTable(error.code)) {
      return NextResponse.json(
        {
          error:
            "The custom_connectors table doesn't exist yet. Run supabase/custom_connectors.sql in your Supabase SQL editor.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, connector: row });
}
