# Database

The schema lives in `migrations/`, in the layout the Supabase CLI expects
(`<timestamp>_<name>.sql`). The filenames match the `supabase_migrations`
history recorded in the project, so `supabase db push` and `supabase migration
list` both agree with what is actually deployed.

## Why the loose `*.sql` files are gone

The schema used to be twelve hand-run files at the top of this directory, each
headed "Run once in the Supabase SQL editor". Nothing recorded whether a given
file had been run, against which project, or in which order — and the app had
outgrown them:

- **`ai_chat_sessions_and_custom_events.sql` created a `custom_events` table the
  app cannot use.** It declared `(title, start_date, end_date, color)`, but
  `src/app/api/custom-events/route.ts` inserts and selects `category`, `type`
  and `description` and never touches `color`. `merge_smart_goal_events.sql`
  inserted those same three columns, so the two files contradicted each other.
  Every write against the documented shape would have failed. The migration
  here takes its columns from the route.
- **The `avatars` storage bucket was in no file at all.** It existed only
  because someone created it by hand in the dashboard, so a fresh project failed
  every profile-photo upload with "Bucket not found". It is a migration now,
  with policies that confine a user's writes to their own folder.
- Several files were create-then-alter pairs (`prompts` had its type check
  rewritten twice, `smart_goals` had its primary key swapped,
  `optimizer_marks` gained `snapshot`). Those are folded into a single
  final-shape statement each.

The originals are in git history if you need them:
`git log --diff-filter=D --name-only -- 'supabase/*.sql'`

## Two files were deliberately NOT carried over

Both were one-time data migrations against the _previous_ database, which this
project replaced. Neither describes schema:

- `merge_smart_goal_events.sql` copied rows from `smart_goal_events` into
  `custom_events`. There is nothing to copy in a fresh project.
- `move_privileged_metadata_to_app_metadata.sql` moved `is_admin` and stored
  credentials out of user-writable `user_metadata`. A fresh project has no users
  carrying the old shape, and everything written since `src/lib/authz.ts` goes
  to `app_metadata` already.

## Access pattern

Two kinds of table, and the difference is deliberate:

|                                                                                            | RLS | Policies     | Reached by                          |
| ------------------------------------------------------------------------------------------ | --- | ------------ | ----------------------------------- |
| `smart_goals`, `smart_goal_events`, `custom_events`, `ai_chat_sessions`, `optimizer_marks` | on  | 4 owner-only | the user's own anon-key client      |
| `prompts`, `connector_config`, `custom_connectors`, `optimizer_analysis`                   | on  | **none**     | the service role, via the admin API |

The second group having no policies is the point, not an oversight: RLS with no
policy denies everything, so PostgREST returns nothing to an anon or user token
and the only way in is a server route holding the service-role key. Supabase's
linter reports these as `rls_enabled_no_policy` at INFO level; that is expected
here.

## Adding a change

```sh
supabase migration new <name>     # writes migrations/<timestamp>_<name>.sql
supabase db push                  # applies what the remote has not seen
```
