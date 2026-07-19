# GoatbookLM

An open, self-hosted take on NotebookLM — upload sources, ask questions, and
get grounded answers.

## Stack

- [Next.js 15](https://nextjs.org) (App Router) + TypeScript
- [Supabase](https://supabase.com) via `@supabase/ssr` — Postgres, Auth, Storage
- [shadcn/ui](https://ui.shadcn.com) + Tailwind CSS
- Server Actions via a local `enhanceAction` helper (`lib/server/action.ts`) — auth + Zod
- [Vercel AI SDK](https://sdk.vercel.ai) (Anthropic + OpenAI providers)

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Start the local Supabase stack (requires the [Supabase CLI](https://supabase.com/docs/guides/cli)):

   ```bash
   supabase start
   ```

3. Copy the environment template and fill in the values printed by `supabase start`
   (plus your Anthropic/OpenAI API keys):

   ```bash
   cp .env.example .env.local
   ```

4. Run the dev server:

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

### Local ingestion worker (Spec 02 — Source-Ingestion)

The local `pg_cron` schedule (`supabase/migrations/..._create_ingestion_queue.sql`)
ticks every 15s and POSTs to `http://host.docker.internal:3100/api/ingestion-worker`
(the URL is read from `public.ingestion_worker_config`, seeded by
`supabase/seed.sql`) — `host.docker.internal` because the schedule runs
inside the Supabase Postgres container and needs to reach the host machine,
not `localhost`. For sources (PDF/text/web) to actually get processed
locally, the dev server must be reachable on **port 3100**, not the default
3000:

```bash
pnpm exec next dev --turbopack --port 3100
```

(`pnpm dev` on the default port 3000 works for everything except ingestion —
new sources will sit on `pending`/`processing` forever since the worker tick
can't reach them. Playwright's `webServer` config already starts the app on
3100 automatically — see `playwright.config.ts`.)

The worker endpoint is protected by a shared secret (`x-worker-secret`
header) that lives **only in the database** — the
`public.ingestion_worker_config` table, seeded fresh on every
`supabase db reset` by `supabase/seed.sql` (no `INGESTION_WORKER_SECRET` env
var, nothing to keep in sync). In production, set it once after deploying,
via a manual SQL UPDATE — see
`supabase/migrations/20260719144042_create_ingestion_queue.sql`'s header
comment for the exact statement.

## Scripts

- `pnpm dev` — start the dev server (Turbopack)
- `pnpm build` — production build
- `pnpm start` — run the production build
- `pnpm lint` — lint with ESLint
- `pnpm tsc --noEmit` — type-check

## Project conventions

See `CLAUDE.md` for the full set of conventions (Supabase clients, RLS
requirements, server action patterns, skill routing).
