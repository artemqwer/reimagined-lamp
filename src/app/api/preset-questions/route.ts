import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getActivePrompts, presetTypeFor } from "@/lib/prompts";
import { parsePresetQuestions } from "@/lib/presetQuestions";
import { isConnectorId, ensureCustomConnectorsLoaded, DEFAULT_CONNECTOR } from "@/lib/connectors";

export async function GET(request: Request) {
  await ensureCustomConnectorsLoaded();
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
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Each data source has its own question set; fall back to the shared one.
  const raw = new URL(request.url).searchParams.get("connector");
  const connector = isConnectorId(raw) ? raw : DEFAULT_CONNECTOR;
  const prompts = await getActivePrompts();
  const content = prompts[presetTypeFor(connector)] || prompts.preset_questions;
  // Returns [{ question, description }] — description is hidden AI instructions.
  const questions = parsePresetQuestions(content);

  return NextResponse.json({ questions });
}
