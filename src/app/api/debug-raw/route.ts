import { windsorApiKeyOf } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("date_from") ?? "2022-03-01";
  const dateTo = searchParams.get("date_to") ?? "2022-04-18";
  const fields =
    searchParams.get("fields") ?? "keyword,clicks,impressions,spend,conversions,conversion_value";

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // See the note in lib/supabase-route: without setAll a refreshed token
        // is discarded and the session dies on the next burst of requests.
        setAll(list) {
          try {
            for (const { name, value, options } of list) cookieStore.set(name, value, options);
          } catch {
            /* not a route handler — nothing to persist to */
          }
        },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const windsorKey: string | undefined = windsorApiKeyOf(user);
  if (!windsorKey) return NextResponse.json({ error: "No Windsor key" }, { status: 503 });

  const params = new URLSearchParams({
    api_key: windsorKey,
    date_from: dateFrom,
    date_to: dateTo,
    fields,
  });
  const res = await fetch(`https://connectors.windsor.ai/all?${params}`);
  const json = await res.json();

  // Return first 5 rows raw so we can see all field names
  const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  return NextResponse.json({
    total_rows: rows.length,
    first_5: rows.slice(0, 5),
    all_field_names: rows[0] ? Object.keys(rows[0]) : [],
  });
}
