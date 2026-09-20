// SQL to create the table (run once in Supabase SQL editor):
//
// create table if not exists ai_chat_sessions (
//   id uuid primary key default gen_random_uuid(),
//   user_id uuid references auth.users not null,
//   title text,
//   messages jsonb default '[]',
//   insights jsonb default '[]',
//   created_at timestamptz default now(),
//   updated_at timestamptz default now()
// );
// alter table ai_chat_sessions enable row level security;
// create policy "own" on ai_chat_sessions for all using (auth.uid() = user_id);

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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
  return { user, supabase };
}

export async function GET() {
  const { user, supabase } = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("ai_chat_sessions")
    .select("id, title, created_at, updated_at, messages, insights")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sessions: data ?? [] });
}

export async function POST(req: NextRequest) {
  const { user, supabase } = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { title, messages, insights } = (await req.json()) as {
    title?: string;
    messages?: unknown[];
    insights?: unknown[];
  };

  const { data, error } = await supabase
    .from("ai_chat_sessions")
    .insert([
      {
        user_id: user.id,
        title: title?.trim() || "New conversation",
        messages: messages ?? [],
        insights: insights ?? [],
      },
    ])
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: (data as { id: string }).id });
}
