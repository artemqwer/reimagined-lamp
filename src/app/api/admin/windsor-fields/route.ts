import { isPlatformAdmin } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Proxies Windsor.ai's own field-metadata endpoint (GET connectors.windsor.ai/
// <connector>/fields) so the "New data source" admin form can let an admin
// PICK from the real list of fields a platform exposes, instead of typing a
// Windsor field name blind. A platform like Facebook Ads or GA4 has hundreds
// of fields — this is the only way "add any metric Windsor supports" is
// actually usable.

interface WindsorField {
  id: string;
  name?: string;
  type?: string;
  description?: string;
}

// Per Windsor's docs: NUMERIC/PERCENT fields are metrics, everything else
// (TEXT/DATE/TIMESTAMP/BOOLEAN/OBJECT) is a dimension.
const METRIC_TYPES = new Set(["NUMERIC", "PERCENT"]);

export async function GET(req: NextRequest) {
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
  if (!isPlatformAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const connector = req.nextUrl.searchParams.get("connector")?.trim();
  if (!connector) return NextResponse.json({ error: "Missing connector" }, { status: 400 });

  const params = new URLSearchParams();
  if (process.env.WINDSOR_API_KEY) params.set("api_key", process.env.WINDSOR_API_KEY);

  let res: Response;
  try {
    res = await fetch(
      `https://connectors.windsor.ai/${encodeURIComponent(connector)}/fields?${params}`,
    );
  } catch {
    return NextResponse.json({ error: "Could not reach Windsor.ai" }, { status: 502 });
  }
  if (!res.ok) {
    // Windsor explains itself in the body — most often "No <slug> account for
    // user X was found, add your accounts at …". Showing only the status code
    // turned a fixable setup step into an opaque "Windsor.ai 400".
    const body = await res.text().catch(() => "");
    let message = `Windsor.ai ${res.status}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed?.error) message = String(parsed.error).trim();
    } catch {
      const plain = body.replace(/<[^>]*>/g, "").trim();
      if (plain) message = plain.slice(0, 300);
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const json = await res.json().catch(() => null);
  // Windsor's /fields endpoint returns a bare array of field objects, not
  // `{ fields: [...] }` — but fall back to the wrapped shape too in case a
  // connector (or a future Windsor API version) nests it.
  const fields: WindsorField[] = Array.isArray(json)
    ? json
    : Array.isArray(json?.fields)
      ? json.fields
      : [];

  const metrics = fields
    .filter((f) => METRIC_TYPES.has((f.type ?? "").toUpperCase()))
    .map((f) => ({
      key: f.id,
      label: f.name ?? f.id,
      format:
        (f.type ?? "").toUpperCase() === "PERCENT" ? ("percent" as const) : ("number" as const),
      description: f.description ?? "",
    }));
  const dimensions = fields
    .filter((f) => !METRIC_TYPES.has((f.type ?? "").toUpperCase()))
    .map((f) => ({ key: f.id, label: f.name ?? f.id, description: f.description ?? "" }));

  return NextResponse.json({ metrics, dimensions });
}
