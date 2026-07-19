# Project

> Next.js + Supabase + shadcn/ui starter. Replace this line with what the project actually does, and keep a short `CODEBASE-MAP.md` (feature → path) up to date as it grows.

## Stack

- **Next.js 15** App Router + **TypeScript**
- **Supabase** via `@supabase/ssr` — Postgres, Auth, Storage (pgvector-ready)
- **shadcn/ui** + Tailwind
- **Server Actions** via a local `enhanceAction` helper (`@/lib/server/action.ts`) — auth + Zod
- Deploy: Vercel

## Supabase clients

- Server: `createClient()` from `@/lib/supabase/server`
- Browser: `createClient()` from `@/lib/supabase/client`
- Admin (service role, server-only, bypasses RLS — use sparingly with manual checks): `createAdminClient()` from `@/lib/supabase/admin`

## Skill routing

When a request matches, invoke the skill **first**.

| Trigger | Skill |
|---|---|
| Full-stack feature (DB + action + UI) | `/feature-builder` |
| New SQL migration / RLS / schema | `/postgres-supabase-expert` |
| New server action | `/server-action-builder` |
| New service / business logic | `/service-builder` |
| Form with 3+ fields | `/react-form-builder` |
| Any E2E test | `/playwright-e2e` |
| Shape vague intent into a spec | `/spec` (gstack, global) |
| Bug / "why is this broken" | `/investigate` (gstack) |
| Code review before merge | `/review` (gstack) |
| QA / test the running app | `/qa` (gstack) |
| Visual polish / does this look right | `/design-review` (gstack) |
| Ship / create PR | `/ship` (gstack) |

The `/feature-builder`, `/*-builder`, `/postgres-supabase-expert`, `/playwright-e2e` skills live in this repo's `.claude/`. The gstack skills are global (`~/.claude/skills/gstack`).

## Security — non-negotiable

1. **Every new table:** `enable row level security` + `revoke all` + `grant select,insert,update,delete` + policies — all in the **same migration**. RLS without grants = table inaccessible; both required.
2. **Every server action resolves the user server-side** (`supabase.auth.getUser()`). Never accept a `user_id` / owner id from client input.
3. **Auth checks fail-closed:** `if (!secret || header !== secret) return 401` — never `if (secret && ...)`.
4. **API keys server-side only** — never in the client bundle (no `NEXT_PUBLIC_` on secrets).

## Conventions

- **Ownership:** rows link to `user_id uuid not null references auth.users(id)`; RLS via `auth.uid() = user_id`. (Team scoping can be layered on later.)
- **Types:** after any migration run `supabase gen types typescript --local > lib/database.types.ts`. Derive Zod enums from the generated types, never from memory.
- **UI overlays:** use `Dialog` (centered modal) or intercepted `@modal` routes. No slide-in `Sheet`/SlideOver panels for forms.
- **Destructive actions** (delete): always confirm via a dialog.
- **`data-test`** attribute on every interactive element (buttons, inputs, selects, links) — E2E tests select on it.
- **i18n optional.** If enabled, keep user-facing strings centralized. No hard gate by default.

## feature-builder is mandatory

Every feature (new route, table, action, or UI) goes through `/feature-builder`. Do not hand-roll a feature that skips its checklist.

## Verification obligation — every feature, non-optional

Before committing, check each:

**DB**
- [ ] Every new table: `enable row level security` + `revoke all` + `grant` (same migration)
- [ ] `supabase gen types typescript --local > lib/database.types.ts` run after the migration

**Server**
- [ ] Every server action resolves the user server-side (`getUser()`), never trusts a client-supplied owner id
- [ ] Auth checks fail-closed (`if (!secret || …)`)
- [ ] API keys server-side only

**UI**
- [ ] Every interactive element has a `data-test` attribute
- [ ] No `SlideOver`/`Sheet` for forms — `Dialog` or `@modal`
- [ ] Destructive actions confirm via a dialog

**Final**
- [ ] `pnpm tsc --noEmit` → 0 errors
- [ ] `pnpm next lint` → 0 errors

## Verify before commit

1. `pnpm tsc --noEmit`
2. `pnpm next lint`
3. `pnpm next build`
