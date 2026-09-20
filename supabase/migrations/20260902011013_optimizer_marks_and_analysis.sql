-- AI Optimizer — which recommendations have been acted on or waved away.
-- Per-user through their own client, so owner-only RLS policies.
-- Folds optimizer_marks.sql + optimizer_marks_snapshot.sql (the `snapshot`
-- column is declared here rather than added by a follow-up alter).
create table if not exists public.optimizer_marks (
  user_id           uuid not null references auth.users (id) on delete cascade,
  connector         text not null,
  period            text not null,
  recommendation_id text not null,
  state             text not null,
  snapshot          jsonb,
  marked_at         timestamptz not null default now(),
  primary key (user_id, connector, period, recommendation_id),
  constraint optimizer_marks_state check (state in ('completed', 'dismissed')),
  constraint optimizer_marks_period_shape check (period ~ '^\d{4}(-(0[1-9]|1[0-2]))?$')
);

alter table public.optimizer_marks enable row level security;

drop policy if exists "own optimizer marks: read" on public.optimizer_marks;
create policy "own optimizer marks: read"
  on public.optimizer_marks for select using (auth.uid() = user_id);

drop policy if exists "own optimizer marks: write" on public.optimizer_marks;
create policy "own optimizer marks: write"
  on public.optimizer_marks for insert with check (auth.uid() = user_id);

drop policy if exists "own optimizer marks: update" on public.optimizer_marks;
create policy "own optimizer marks: update"
  on public.optimizer_marks for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own optimizer marks: delete" on public.optimizer_marks;
create policy "own optimizer marks: delete"
  on public.optimizer_marks for delete using (auth.uid() = user_id);

create index if not exists optimizer_marks_lookup
  on public.optimizer_marks (user_id, connector, period);

-- Cached optimizer phrasing, keyed by a hash of (connector + goal + findings).
-- Written by the service role only, so RLS on with no public policies.
create table if not exists public.optimizer_analysis (
  hash        text primary key,
  connector   text not null,
  goal_label  text not null default 'revenue',
  findings    jsonb not null default '[]'::jsonb,
  worded      jsonb,
  analyzed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists optimizer_analysis_pending_idx
  on public.optimizer_analysis (created_at)
  where worded is null;

alter table public.optimizer_analysis enable row level security;
