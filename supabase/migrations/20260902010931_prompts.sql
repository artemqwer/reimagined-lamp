-- Prompt Library. Service-role only: the admin API reads and writes it, so RLS
-- is on with NO policies (PostgREST therefore returns nothing to anon/user).
-- Folds prompts.sql + prompts_per_connector.sql + prompts_optimizer_types.sql
-- into the final type check rather than create-then-alter-twice.
create table if not exists public.prompts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text not null,
  content    text not null default '',
  active     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.prompts drop constraint if exists prompts_type_check;
alter table public.prompts
  add constraint prompts_type_check
  check (type in (
    'core',
    -- analyst prompt per source
    'google_ads', 'meta_ads', 'ga4', 'shopify',
    -- quick-question set per source ('preset_questions' = shared fallback)
    'preset_questions',
    'preset_google_ads', 'preset_meta_ads', 'preset_ga4', 'preset_shopify',
    -- AI Optimizer phrasing per source
    'optimizer_google_ads', 'optimizer_meta_ads', 'optimizer_ga4', 'optimizer_shopify'
  ));

alter table public.prompts enable row level security;
