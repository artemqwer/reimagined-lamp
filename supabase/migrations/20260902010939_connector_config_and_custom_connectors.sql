-- Admin-global connector tables. Same access pattern as prompts: the admin API
-- talks to them with the service role, so RLS is on with no public policies.

-- Which tables/metrics show, their order and labels.
create table if not exists public.connector_config (
  connector  text primary key,
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.connector_config enable row level security;

-- Admin-defined data sources (added from the Admin Panel without a code
-- deploy). Built-in connectors stay in src/lib/connectors.ts and are never rows.
create table if not exists public.custom_connectors (
  id                text primary key,          -- slug, e.g. "tiktok_ads"
  label             text not null,
  color             text not null,             -- hex, fallback badge + UI accents
  windsor_source    text not null,             -- Windsor.ai platform slug
  metric_schema     text not null,             -- "ads" | "analytics" | "commerce"
  primary_dimension jsonb not null,            -- { key, label, singular, windsorField }
  dimensions        jsonb not null default '[]'::jsonb,
  ai_dimensions     jsonb not null default '[]'::jsonb,
  custom_metrics    jsonb not null default '[]'::jsonb,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.custom_connectors enable row level security;
