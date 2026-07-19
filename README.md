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

## Scripts

- `pnpm dev` — start the dev server (Turbopack)
- `pnpm build` — production build
- `pnpm start` — run the production build
- `pnpm lint` — lint with ESLint
- `pnpm tsc --noEmit` — type-check

## Project conventions

See `CLAUDE.md` for the full set of conventions (Supabase clients, RLS
requirements, server action patterns, skill routing).
