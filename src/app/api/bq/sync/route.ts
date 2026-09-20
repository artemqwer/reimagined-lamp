import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isPlatformAdmin } from "@/lib/authz";
import { prewarmAll } from "@/lib/bqPrewarm";
import { isBigQueryConfigured, fetchFromBigQuery } from "@/lib/bigquery";

// Prewarm BigQuery for every connected account. Runs on a schedule (see
// vercel.json) so the store is warm before users open the dashboard. Two ways in:
//   1. Vercel cron — the CRON_SECRET bearer, attached automatically.
//   2. A logged-in platform admin — so BigQuery can be tested/triggered by hand
//      from the browser without the secret.
// No-op (skipped) unless BigQuery is configured (BQ_ENABLED=true + auth wired).
//
// `?selftest=1` (admin only) runs a fast READ-ONLY probe instead of a full sync:
// one BigQuery query for a date that matches nothing. If it doesn't throw, auth,
// the dataset/table and read permission are all good; the full sync then also
// exercises write permission. This is the safe first check when turning BQ on.
export const maxDuration = 300;

async function isAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          /* read-only: this route never refreshes the session */
        },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return !!user && isPlatformAdmin(user);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const cronAuthed = !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!cronAuthed && !(await isAdmin()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (new URL(req.url).searchParams.get("selftest") === "1") {
    if (!isBigQueryConfigured())
      return NextResponse.json({ ok: false, configured: false, note: "BQ_ENABLED not set" });
    try {
      // A query that matches nothing — proves auth + table + read access with no writes.
      await fetchFromBigQuery({
        accountId: "__selftest__",
        connector: "google_ads",
        groupBy: "campaign",
        dateFrom: "2099-01-01",
        dateTo: "2099-01-01",
      });
      return NextResponse.json({ ok: true, configured: true, note: "read probe succeeded" });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const result = await prewarmAll();
  return NextResponse.json({ ok: true, ...result });
}
