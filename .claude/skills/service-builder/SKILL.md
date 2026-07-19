---
name: service-builder
description: Build pure, interface-agnostic services with injected dependencies for a Next.js + Supabase app. Use when creating business logic that must work across server actions, route handlers, CLI commands, or tests. Invoke with /service-builder.
---

# Service Builder

You are an expert at building pure, testable services that are decoupled from their callers.

## North Star

**Every service is decoupled from its interface (I/O).** A service takes plain data in, does work, and returns plain data out. It has no knowledge of whether it was called from a route handler, a server action, a CLI command, or a test. The caller is a thin adapter that resolves dependencies and delegates.

## Workflow

When asked to create a service, follow these steps.

### Step 1: Define the Contract

Start with the input/output types. These are plain TypeScript — no framework types.

```typescript
// lib/notebooks/schema.ts
import { z } from 'zod';

export const CreateNotebookSchema = z.object({
  title: z.string().min(1),
});

export type CreateNotebookInput = z.infer<typeof CreateNotebookSchema>;

export interface Notebook {
  id: string;
  title: string;
  user_id: string;
  created_at: string;
}
```

The owning `user_id` is part of the output type but **not** the input schema —
ownership is supplied by the caller from the authenticated session, never
accepted from client input.

### Step 2: Build the Service

The service receives all dependencies through its constructor. It never imports request-scoped modules (`createClient`, `revalidatePath`, etc.).

```typescript
// lib/notebooks/service.ts
import type { SupabaseClient } from '@supabase/supabase-js';

import type { CreateNotebookInput, Notebook } from './schema';

export function createNotebookService(client: SupabaseClient) {
  return new NotebookService(client);
}

class NotebookService {
  constructor(private readonly client: SupabaseClient) {}

  async create(data: CreateNotebookInput & { userId: string }): Promise<Notebook> {
    const { data: result, error } = await this.client
      .from('notebooks')
      .insert({
        title: data.title,
        user_id: data.userId,
      })
      .select()
      .single();

    if (error) throw error;

    return result;
  }

  async list(userId: string): Promise<Notebook[]> {
    const { data, error } = await this.client
      .from('notebooks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data;
  }

  async delete(id: string, userId: string): Promise<void> {
    const { error } = await this.client
      .from('notebooks')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;
  }
}
```

### Step 3: Write Thin Adapters

Each interface is a thin adapter — it resolves dependencies, calls the service, and handles interface-specific concerns (revalidation, redirects, HTTP responses, CLI output). It also supplies the owning `userId` from the authenticated session.

**Server Action adapter:**

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
  {
    auth: true,
    schema: CreateNotebookSchema,
  },
);
```

**Route Handler adapter:**

```typescript
// app/api/notebooks/route.ts
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { CreateNotebookSchema } from '@/lib/notebooks/schema';
import { createNotebookService } from '@/lib/notebooks/service';

export async function POST(request: Request) {
  const client = await createClient();

  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = CreateNotebookSchema.parse(await request.json());

  const service = createNotebookService(client);
  const result = await service.create({ ...body, userId: user.id });

  return NextResponse.json(result);
}
```

**CLI / script adapter:**

```typescript
// scripts/seed-notebook.ts
import { createAdminClient } from '@/lib/supabase/admin';
import { createNotebookService } from '@/lib/notebooks/service';

const client = createAdminClient();
const service = createNotebookService(client);

await service.create({ title: 'Seeded notebook', userId: process.argv[2] });
```

### Step 4: Write Tests

Because the service accepts dependencies, you can test it with stubs — no running database, no framework runtime.

```typescript
// lib/notebooks/__tests__/service.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createNotebookService } from '../service';

function createMockClient(overrides: Record<string, unknown> = {}) {
  const mockChain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: 'nb-1',
        title: 'Test',
        user_id: 'user-1',
        created_at: new Date().toISOString(),
      },
      error: null,
    }),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
    ...overrides,
  };

  return {
    from: vi.fn(() => mockChain),
    mockChain,
  } as unknown as SupabaseClient & { mockChain: typeof mockChain };
}

describe('NotebookService', () => {
  it('creates a notebook scoped to the user', async () => {
    const client = createMockClient();
    const service = createNotebookService(client);

    const result = await service.create({ title: 'Test', userId: 'user-1' });

    expect(result.id).toBe('nb-1');
    expect(client.from).toHaveBeenCalledWith('notebooks');
  });

  it('throws on database error', async () => {
    const client = createMockClient({
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'unique violation' },
      }),
    });

    const service = createNotebookService(client);

    await expect(
      service.create({ title: 'Dup', userId: 'user-1' }),
    ).rejects.toEqual({ message: 'unique violation' });
  });
});
```

## Rules

1. **Services are pure functions over data.** Plain objects/primitives in, plain objects/primitives out. No `Request`/`Response`, no `FormData`, no cookies.

2. **Inject dependencies, never import them.** The service receives its database client, storage client, or any I/O capability as a constructor argument. Never call `createClient()` inside a service.

3. **Adapters are trivial glue.** A server action resolves the client, supplies `user.id`, calls the service, and handles `revalidatePath`. A route handler resolves the client, checks auth, calls the service, and formats the HTTP response. No business logic in adapters.

4. **One service, many callers.** If two interfaces do the same thing, they call the same service function. Duplicating logic is a violation.

5. **Ownership is a caller concern.** The adapter passes the authenticated `userId` into the service. The service scopes queries by it; RLS (`auth.uid() = user_id`) enforces it a second time at the database.

6. **Testable in isolation.** Pass a mock client, assert the output. If you need a running database to test a service, refactor until you don't.

## What Goes Where

| Concern | Location | Example |
|---------|----------|---------|
| Input validation (Zod) | `lib/<feature>/schema.ts` | `CreateNotebookSchema` |
| Business logic | `lib/<feature>/service.ts` | `NotebookService.create()` |
| Auth check | Adapter (`enhanceAction({ auth: true })`) | Server action wrapper |
| Ownership (`userId`) | Adapter → service argument | `service.create({ ...data, userId: user.id })` |
| Logging | Adapter | `console.info()` before/after service call |
| Cache revalidation | Adapter | `revalidatePath()` after mutation |
| Redirect | Adapter | `redirect()` after creation |
| HTTP response shape | Adapter | `NextResponse.json(result)` |

## File Structure

```
lib/
└── notebooks/
    ├── schema.ts               # Zod schemas + TS types
    ├── service.ts              # Pure service (dependencies injected)
    └── __tests__/
        └── service.test.ts     # Unit tests with mock client

app/
└── notebooks/
    ├── actions.ts              # Server action adapters
    └── _components/
        └── notebook-form.tsx
```

## Anti-Patterns

```typescript
// ❌ BAD: Service imports the request-scoped client
class NotebookService {
  async create(data: CreateNotebookInput) {
    const client = await createClient(); // coupling!
    // ...
  }
}

// ❌ BAD: Service trusts an ownership ID from client input
const CreateNotebookSchema = z.object({
  title: z.string(),
  userId: z.string(), // never — this lets a client write rows as anyone
});

// ❌ BAD: Business logic in the adapter
export const createNotebookAction = enhanceAction(
  async function (data, user) {
    const client = await createClient();
    // Business logic directly in the action — not reusable
    if (data.title.length > 100) throw new Error('Title too long');
    const { data: result } = await client.from('notebooks').insert(data);
    return result;
  },
  { auth: true, schema: CreateNotebookSchema },
);

// ❌ BAD: Two interfaces duplicate the same logic
// actions.ts
const result = await client.from('notebooks').insert(...).select().single();
// route.ts
const result = await client.from('notebooks').insert(...).select().single();
// Should be: both call notebookService.create()
```

## Reference

See `[Examples](examples.md)` for more patterns including services with multiple dependencies, services that compose other services, and testing strategies.
