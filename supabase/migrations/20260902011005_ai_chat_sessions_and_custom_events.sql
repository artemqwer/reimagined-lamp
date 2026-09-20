-- Per-user tables reached through the caller's own anon-key client, so RLS is
-- the ONLY thing separating tenants: without a policy one user's select returns
-- everyone's chat transcripts.
create table if not exists public.ai_chat_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text,
  messages   jsonb not null default '[]'::jsonb,
  insights   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_chat_sessions_user_updated
  on public.ai_chat_sessions (user_id, updated_at desc);

alter table public.ai_chat_sessions enable row level security;

drop policy if exists "own chats: read" on public.ai_chat_sessions;
create policy "own chats: read"
  on public.ai_chat_sessions for select using (auth.uid() = user_id);

drop policy if exists "own chats: insert" on public.ai_chat_sessions;
create policy "own chats: insert"
  on public.ai_chat_sessions for insert with check (auth.uid() = user_id);

drop policy if exists "own chats: update" on public.ai_chat_sessions;
create policy "own chats: update"
  on public.ai_chat_sessions for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own chats: delete" on public.ai_chat_sessions;
create policy "own chats: delete"
  on public.ai_chat_sessions for delete using (auth.uid() = user_id);

-- Calendar events the user annotates the dashboard timeline with.
--
-- NOTE: the shape here is taken from src/app/api/custom-events/route.ts, NOT
-- from the old supabase/ai_chat_sessions_and_custom_events.sql. That file
-- declared (title, start_date, end_date, color) — but the route inserts and
-- selects category / type / description and never touches `color`, and
-- merge_smart_goal_events.sql inserted those same three columns. Creating the
-- documented shape would have produced a table every write 500s against.
create table if not exists public.custom_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  category    text not null,
  type        text,
  start_date  date not null,
  end_date    date,
  title       text not null,
  description text,
  created_at  timestamptz not null default now(),
  constraint custom_events_span check (end_date is null or end_date >= start_date)
);

create index if not exists custom_events_user_start
  on public.custom_events (user_id, start_date);

alter table public.custom_events enable row level security;

drop policy if exists "own events: read" on public.custom_events;
create policy "own events: read"
  on public.custom_events for select using (auth.uid() = user_id);

drop policy if exists "own events: insert" on public.custom_events;
create policy "own events: insert"
  on public.custom_events for insert with check (auth.uid() = user_id);

drop policy if exists "own events: update" on public.custom_events;
create policy "own events: update"
  on public.custom_events for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own events: delete" on public.custom_events;
create policy "own events: delete"
  on public.custom_events for delete using (auth.uid() = user_id);
