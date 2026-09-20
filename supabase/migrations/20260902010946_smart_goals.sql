-- Smart Goals — per-user goal configuration and its own timeline events.
-- Reached through the caller's own anon-key client, so RLS is the ONLY thing
-- separating tenants: owner-only policies on both tables.
--
-- smart_goals.sql created this then altered the primary key to add `connector`;
-- the final shape is written directly here.
create table if not exists public.smart_goals (
  user_id    uuid not null references auth.users (id) on delete cascade,
  connector  text not null default 'google_ads',
  period     text not null,
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, connector, period),
  constraint smart_goals_period_shape check (period ~ '^\d{4}(-(0[1-9]|1[0-2]))?$')
);

alter table public.smart_goals enable row level security;

drop policy if exists "own smart goals: read" on public.smart_goals;
create policy "own smart goals: read"
  on public.smart_goals for select using (auth.uid() = user_id);

drop policy if exists "own smart goals: write" on public.smart_goals;
create policy "own smart goals: write"
  on public.smart_goals for insert with check (auth.uid() = user_id);

drop policy if exists "own smart goals: update" on public.smart_goals;
create policy "own smart goals: update"
  on public.smart_goals for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own smart goals: delete" on public.smart_goals;
create policy "own smart goals: delete"
  on public.smart_goals for delete using (auth.uid() = user_id);

-- end_date null = a single-day event; set = a span.
create table if not exists public.smart_goal_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  category    text not null check (category in ('events', 'ads', 'website')),
  type        text not null,
  start_date  date not null,
  end_date    date,
  title       text not null,
  description text,
  created_at  timestamptz not null default now(),
  constraint smart_goal_events_span check (end_date is null or end_date >= start_date)
);

create index if not exists smart_goal_events_user_start
  on public.smart_goal_events (user_id, start_date);

alter table public.smart_goal_events enable row level security;

drop policy if exists "own goal events: read" on public.smart_goal_events;
create policy "own goal events: read"
  on public.smart_goal_events for select using (auth.uid() = user_id);

drop policy if exists "own goal events: write" on public.smart_goal_events;
create policy "own goal events: write"
  on public.smart_goal_events for insert with check (auth.uid() = user_id);

drop policy if exists "own goal events: update" on public.smart_goal_events;
create policy "own goal events: update"
  on public.smart_goal_events for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own goal events: delete" on public.smart_goal_events;
create policy "own goal events: delete"
  on public.smart_goal_events for delete using (auth.uid() = user_id);
