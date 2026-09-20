# MetricForge (ads-dashboard)

E-commerce / advertising intelligence dashboard. Aggregates performance data
from Google Ads, Meta Ads, Google Analytics 4 and Shopify (plus any data
source an admin adds through the Admin Panel) into one dashboard with KPI
cards, breakdown tables, trend charts and an AI analyst.

## Tech stack

- **Next.js 16** (App Router, Turbopack) + React 19 + TypeScript
- **Tailwind CSS 4**
- **Supabase** — auth (incl. MFA) and Postgres (admin config, prompts, custom
  data sources)
- **Windsor.ai** — unified ad-platform API, and the **only** data source. Every
  connector, built-in or admin-added, reads through it
- **Gemini** (Vertex AI) — the AI chat / insights panel, authenticated by
  workload identity federation rather than a service-account key
- **Recharts**, **Zustand** (cross-filter + connector state), **Jest**

## Getting started

This project uses [pnpm](https://pnpm.io) (pinned via `packageManager` in
`package.json` — `corepack enable` picks it up automatically).

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.local.example` → `.env.local` and fill in the values described
below before running anything that touches data (dashboard, sync, AI).

### Environment variables

| Variable                                                      | What it's for                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Supabase project — auth + client-side reads. The anon key is public by design; RLS protects the data |
| `SUPABASE_SERVICE_ROLE_KEY`                                   | Server-only. Bypasses RLS — admin routes, and anything writing `app_metadata`                        |
| `WINDSOR_API_KEY`                                             | Shared Windsor.ai workspace key. Only ever used together with a user's own connected-account scope   |
| `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT_EMAIL` | Vertex AI via federation — no key stored anywhere. What production uses                              |
| `GEMINI_API_KEY`                                              | AI Studio key. Simpler alternative for local development                                             |
| `GEMINI_LOCATION`, `GEMINI_MODEL`, `GEMINI_PROJECT_ID`        | Vertex region / model. `GEMINI_PROJECT_ID` only if it can't be derived from the account email        |
| `GROQ_API_KEY`                                                | Optional fallback LLM when Gemini is unavailable                                                     |
| `CRON_SECRET`                                                 | Shared secret for `/api/ai-optimizer/refresh`                                                        |
| `NEXT_PUBLIC_APP_URL`                                         | Base URL for OAuth redirects and Open Graph metadata                                                 |

There is no BigQuery configuration any more — see
[`docs/bigquery-disabled.md`](docs/bigquery-disabled.md).

## Architecture

### Connector registry (`src/lib/connectors.ts`)

The single source of truth for "what data sources exist and what they can
show." Two layers:

- **Built-in connectors** (`google_ads`, `meta_ads`, `ga4`, `shopify`) —
  hardcoded manifests: metrics, dimensions, KPI cards, tabs, Windsor field
  mappings. All four read through Windsor; there is no second data path.
- **Custom connectors** — admin-added through the Admin Panel (Data Sources
  tab → _New data source_), stored in the `custom_connectors` Supabase
  table, merged into the same live registry at runtime
  (`setCustomConnectors`). No deploy needed to add a new data source, as
  long as it's a platform Windsor.ai supports. Metrics aren't limited to the
  ~15 built-in canonical ones (ROAS, CPA, …) either — the admin form can
  pull the real field list straight from Windsor
  (`GET connectors.windsor.ai/<slug>/fields`, proxied by
  `/api/admin/windsor-fields`) and register any raw field (e.g. GA4's
  `bounceRate`) as a custom metric with no formula, just a display format.

Every connector — built-in or custom — flows through the _same_ API routes
(`/api/windsor`, `/api/data/[dimension]`), keyed generically by connector id
and Windsor platform slug.

### Admin-configurable dashboard

Beyond picking a connector, an admin can reshape _that connector's own
dashboard_ without touching code, via the Admin Panel's Data Sources tab
(`src/app/(dashboard)/admin/ConnectorConfigPanel.tsx`):

- **KPI cards** — show/hide/reorder/rename any canonical metric card, and
  pick its display format (Number / Currency / Percent).
- **Table Widgets** (`TableWidgetsPanel.tsx` /
  `ConfigurableTableWidget.tsx`) — build independent breakdown tables, each
  with its own primary + additional dimensions (shown as tabs), its own
  metric columns, its own cross-filtering toggle and default sort. A
  connector with no table widgets configured keeps rendering the built-in
  Extended Analytics list — this is additive, not a replacement.

Config is stored per-connector in the `connector_config` Supabase table and
applied to every user's dashboard.

### Data flow

`/api/windsor` and `/api/data/[dimension]` resolve, per request: which
connector, which Windsor `ds` slug, and the signed-in user's own
connected-account scope
(`app_metadata.windsor_accounts[<ds>]`, server-validated, never
user-editable) — so a shared Windsor workspace key can safely serve many
users, each seeing only their own account's rows.

### AI

`src/lib/aiQuery.ts` / `src/lib/gemini.ts` + `/api/ai-chat`, `/api/ai-insights`
— a Gemini-backed analyst that can call a `query_data` tool to fetch any
breakdown on demand. System prompts and per-connector preset questions live
in the `prompts` Supabase table, editable from the Admin Panel's Prompt
Library (falls back to built-in defaults when the table is empty/unset up).

## Project structure

```
src/
  app/
    (dashboard)/          # authenticated app shell (Sidebar, layout)
      [source]/            # the dashboard itself, one route for every connector
      admin/               # User Management / Analytics / Prompts / Data Sources
      ai-optimizer/        # recommendations + evidence tables
      smart-goals/         # per-user goal config and timeline
      data-sources/        # user-facing "connect a platform" page
      profile/ invites/
    api/                   # windsor, data, admin, ai-*, optimizer, smart-goals,
                           # custom-events, team, windsor-connect, register
    login/ register/ ...   # auth pages
  proxy.ts                 # server-side auth gate — Next 16 renamed
                           # middleware.ts to proxy.ts, and it sits at src/,
                           # not src/app/
  components/              # shared chrome (Sidebar, brand icons)
  lib/                     # connectors.ts, authz, supabase clients, Windsor
                           # fetchers, AI query pipeline, Zustand store
  __tests__/               # Jest — connector manifests, Windsor field mapping,
                           # authz, Gemini federation, routes
supabase/
  migrations/             # the schema, in Supabase CLI layout; `supabase db push`
  README.md               # access pattern, and why the loose *.sql files went
docs/
  bigquery-disabled.md    # why BigQuery was removed and how to revive it
scripts/
  generate-brand-assets.mjs  # favicon/icon/OG raster generation from the logo
  restore-bigquery.sh        # recreates the BigQuery infrastructure if needed
```

## Testing & code quality

```bash
pnpm test          # Jest
pnpm lint          # ESLint (Next.js core-web-vitals + TypeScript rules)
pnpm exec tsc --noEmit
pnpm format        # Prettier — writes
pnpm format:check  # Prettier — checks only
```

- **Pre-commit** (husky + lint-staged): auto-fixes ESLint issues and
  formats staged files. It won't block a commit over pre-existing lint
  errors in a file you didn't otherwise touch — the gate that matters
  locally is "did I introduce something new," not repo-wide cleanliness.
- **CI** (`.github/workflows/ci.yml`): on every PR and every push to `main` —
  install, **lint (a real gate — 0 errors required)**, format check
  (non-blocking), typecheck, test, build. No deploy step; Vercel deploys
  independently via its own GitHub integration.
- **Dependabot** (`.github/dependabot.yml`): weekly, grouped minor/patch PRs
  for dependencies and GitHub Actions versions.

## Deployment

Deployed on [Vercel](https://vercel.com) from `main`, independent of the CI
pipeline above — CI does not gate the deploy, and the repo has no branch
protection (a private repo on GitHub Free cannot have it). So a red build can
still ship. Run `pnpm lint && pnpm build` before pushing to `main`.

**Commits must be authored as the Vercel account owner** or they deploy as
`BLOCKED` with no build logs. See [AGENTS.md](AGENTS.md) — this catches
everyone once.

Environments map like this:

| Vercel     | branch    | Supabase         | Vertex AI project |
| ---------- | --------- | ---------------- | ----------------- |
| Production | `main`    | `metricforge-prod` | `metricforge-prod`  |
| Preview    | any other | `metricforge-dev`  | `metricforge-dev`   |

The split is enforced by GCP, not by the app: each workload-identity provider
pins the Vercel `environment` claim, so a preview deployment cannot obtain a
production token.
