---
description: End-to-end feature implementation for a Next.js + Supabase + shadcn/ui app across database, server, and UI layers
---

# Feature Builder

You are an expert at implementing complete features in a Next.js 15 (App Router) + Supabase + shadcn/ui app following established patterns across all layers.

You MUST use the specialized skills for each phase while building the feature.

- Database Schema: `postgres-supabase-expert`
- Services & Server Actions: `service-builder` and `server-action-builder`
- Forms: `forms-builder`

**Stack assumptions.** Single app repo (no monorepo). Paths are relative to the
repo root: `app/`, `components/`, `lib/`, `supabase/`. The `@/` import alias maps
to the repo root. Ownership is **per user**: user-owned tables carry
`user_id uuid not null references auth.users(id)` and RLS enforces
`auth.uid() = user_id`.

## Implementation Phases

### Phase 1: Database Schema

Use the `postgres-supabase-expert` skill.

1. Create a migration: `supabase migration new create_<feature>`
2. Write the table in the generated `supabase/migrations/<ts>_create_<feature>.sql` with RLS enabled and an owner policy
3. Apply: `supabase db push` (or `supabase db reset` locally to re-apply from scratch)
4. Regenerate types: `supabase gen types typescript --local > lib/database.types.ts`

```sql
-- supabase/migrations/<ts>_create_notebooks.sql
create table if not exists public.notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title varchar(255) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS + grants (same migration, always)
alter table public.notebooks enable row level security;
revoke all on public.notebooks from authenticated, service_role;
grant select, insert, update, delete on table public.notebooks to authenticated;
grant select, insert, update, delete on table public.notebooks to service_role;

create policy "notebooks_owner" on public.notebooks
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_notebooks_updated_at
  before update on public.notebooks
  for each row execute function public.set_updated_at();

create index if not exists ix_notebooks_user_id on public.notebooks(user_id);
```

### Phase 2: Server Layer

Use `service-builder` and `server-action-builder` for detailed patterns.

**Rule: Services are decoupled from interfaces.** The service is pure logic that receives dependencies (the Supabase client, etc.) as arguments — it never imports request-scoped modules. The server action is a thin adapter that resolves dependencies and calls the service, supplying the owning `user.id` from the session. The same service can then be called from a server action, a route handler, a CLI command, or a unit test with zero changes.

1. **Schema** (`lib/<feature>/schema.ts`) — Zod schema + types. No ownership IDs in the input schema.
2. **Service** (`lib/<feature>/service.ts`) — pure logic, dependencies injected, testable in isolation.
3. **Actions** (`app/<feature>/actions.ts`) — thin adapter, `'use server'`, no business logic. Passes `user.id` into the service.

```typescript
// app/notebooks/actions.ts
'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@/lib/server/action';
import { createClient } from '@/lib/supabase/server';
import { CreateNotebookSchema } from '@/lib/notebooks/schema';
import { createNotebookService } from '@/lib/notebooks/service';

export const createNotebookAction = enhanceAction(
  async function (data, user) {
    const client = await createClient();
    const service = createNotebookService(client);
    const result = await service.create({ ...data, userId: user.id });

    revalidatePath('/notebooks');

    return { success: true, data: result };
  },
  { auth: true, schema: CreateNotebookSchema },
);
```

### Phase 3: UI Components

Use the `forms-builder` skill for form patterns.

Create colocated components in the route's `_components/` directory:

1. **List component** — display items with loading/empty states
2. **Form component** — create/edit with react-hook-form + zodResolver + shadcn form
3. **Detail component** — single item view

### Phase 4: Page Integration

Create the page under `app/<feature>/`. Reads are automatically scoped to the
current user by RLS, so no manual `user_id` filter is needed on selects.

```typescript
// app/notebooks/page.tsx
import { createClient } from '@/lib/supabase/server';

import { CreateNotebookForm } from './_components/notebook-form';
import { NotebooksList } from './_components/notebooks-list';

export default async function NotebooksPage() {
  const supabase = await createClient();

  const { data: notebooks } = await supabase
    .from('notebooks')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Notebooks</h1>
        <CreateNotebookForm />
      </header>

      <NotebooksList notebooks={notebooks ?? []} />
    </div>
  );
}
```

### Phase 5: Navigation

Add the route by creating the folder under `app/`, then add a link to it from
your sidebar / nav component. Keep the nav items in one place so links stay
consistent.

```tsx
// components/app-sidebar.tsx (or wherever your nav lives)
import Link from 'next/link';

const navItems = [
  { href: '/notebooks', label: 'Notebooks' },
  // add the new route here
];

export function AppSidebar() {
  return (
    <nav className="flex flex-col gap-1">
      {navItems.map((item) => (
        <Link key={item.href} href={item.href} data-test={`nav-${item.label.toLowerCase()}`}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
```

## File Structure

```
app/notebooks/
├── page.tsx                     # List page
├── actions.ts                   # 'use server' — thin action adapters
├── [notebookId]/
│   └── page.tsx                 # Detail page
└── _components/
    ├── notebooks-list.tsx
    ├── notebook-form.tsx
    └── notebook-card.tsx

lib/notebooks/
├── schema.ts                    # Zod schemas + TS types
├── service.ts                   # Pure service (dependencies injected)
└── __tests__/
    └── service.test.ts

supabase/migrations/
└── <ts>_create_notebooks.sql
```

## Verification Checklist

### Database Layer

- [ ] Migration created in `supabase/migrations/`
- [ ] Table has `user_id uuid not null references auth.users(id)`
- [ ] RLS enabled on the table
- [ ] Default permissions revoked (`revoke all ... from authenticated, service_role`)
- [ ] Permissions granted to `authenticated` AND `service_role`
- [ ] Owner policy uses `auth.uid() = user_id` (or parent-ownership for child tables)
- [ ] Indexes added for `user_id` / foreign keys and common queries
- [ ] `updated_at` trigger added
- [ ] Migration applied (`supabase db push`)
- [ ] TypeScript types regenerated to `lib/database.types.ts`

### Server Layer

- [ ] Zod schema in `lib/<feature>/schema.ts` — no ownership IDs in the input schema
- [ ] Service in `lib/<feature>/service.ts` with dependencies injected (not imported)
- [ ] Service contains all business logic — testable with a mock client
- [ ] Server actions are thin adapters — resolve client, supply `user.id`, call service, revalidate
- [ ] Server actions go through the `enhanceAction` helper
- [ ] Actions have `auth: true` and a `schema` (or `auth: false` with a comment explaining why it's public)
- [ ] `user_id` derived from the session — never accepted from client input
- [ ] `revalidatePath` called after mutations
- [ ] `isRedirectError` check if the action uses `redirect()`

### UI Layer

- [ ] Components colocated in the route's `_components/` directory
- [ ] Forms use `react-hook-form` with `zodResolver`
- [ ] Loading states with `useTransition`
- [ ] Error display with the `Alert` component
- [ ] `data-test` attributes on every interactive element (input, select, button, link)
- [ ] Toast notifications for success/error where appropriate
- [ ] Forms in modals use `Dialog` (centered) — not a side panel/sheet

### Page Layer

- [ ] Page in the correct `app/<feature>/` route
- [ ] Async `params`/`searchParams` awaited where used
- [ ] Server-side data fetching via `await createClient()`
- [ ] Reads rely on RLS for scoping (no leaking another user's rows)

### Navigation

- [ ] Route folder created under `app/`
- [ ] Link added to the sidebar / nav component

### Testing

- [ ] Service unit test with a mock client (happy path + error path)
- [ ] Page Object created for E2E tests (if adding e2e coverage)
- [ ] Basic CRUD flows tested with `data-test` selectors

### Final Verification

```bash
# Type check
pnpm tsc --noEmit

# Lint
pnpm next lint        # or: pnpm eslint .

# Build (catches server/client boundary + RSC issues)
pnpm next build

# E2E (if tests exist)
pnpm exec playwright test <feature> --workers=1
```

When you are done, review the code for quality: RLS present on every new table, `auth: true` on every action, no ownership IDs from client input, `data-test` on interactive elements, and no business logic leaking into adapters.
