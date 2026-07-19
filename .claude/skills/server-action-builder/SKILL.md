---
name: server-action-builder
description: Create Next.js + Supabase Server Actions with a local enhanceAction helper, Zod validation, and service patterns. Use when implementing mutations, form submissions, or API operations that need authentication and validation. Invoke with /server-action-builder.
---

# Server Action Builder

You are an expert at creating type-safe server actions for a Next.js 15 (App Router) + Supabase app following established patterns.

## The `enhanceAction` Helper

There is no framework-provided action wrapper. Instead every server action goes through one small local helper, `@/lib/server/action.ts`, that captures the same discipline in one place: resolve the Supabase server client, require an authenticated user, validate input with a Zod schema, then delegate to the handler with typed input.

```typescript
// lib/server/action.ts
import type { User } from '@supabase/supabase-js';
import type { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

interface ActionOptions<Schema extends z.ZodTypeAny> {
  // Require an authenticated user (default: true). Set to false only for
  // explicitly public actions — and say why in a comment at the call site.
  auth?: boolean;
  // Zod schema used to validate the raw input before the handler runs.
  schema?: Schema;
}

export function enhanceAction<Schema extends z.ZodTypeAny, Return>(
  handler: (input: z.infer<Schema>, user: User) => Promise<Return>,
  options: ActionOptions<Schema> = {},
) {
  return async (rawInput: z.infer<Schema>): Promise<Return> => {
    // 1. Resolve the request-scoped Supabase client (reads cookies).
    const supabase = await createClient();

    // 2. Resolve the authenticated user.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 3. Fail closed unless the action is explicitly public.
    if (options.auth !== false && !user) {
      throw new Error('Unauthorized');
    }

    // 4. Validate input with the Zod schema.
    const input = options.schema
      ? options.schema.parse(rawInput)
      : (rawInput as z.infer<Schema>);

    // 5. Delegate to the handler with a typed input + user.
    return handler(input, user as User);
  };
}
```

Every action in this codebase uses this helper. It guarantees three non-negotiables in one place: **auth is required by default**, **input is validated by Zod**, and the handler receives a **typed** `input` and `user`.

## Workflow

When asked to create a server action, follow these steps.

### Step 1: Create the Zod Schema

Create the validation schema alongside the feature in `lib/<feature>/schema.ts`:

```typescript
// lib/notebooks/schema.ts
import { z } from 'zod';

export const CreateNotebookSchema = z.object({
  title: z.string().min(1, 'Title is required'),
});

export type CreateNotebookInput = z.infer<typeof CreateNotebookSchema>;
```

Note what is **not** here: no `userId`. Ownership IDs never come from client input — the server derives `user_id` from the authenticated session (see Step 3).

### Step 2: Create the Service Layer

**North star: services are decoupled from their interface.** The service is pure logic — it receives a database client as a dependency, never imports one. This means the same service works whether called from a server action, a route handler, a CLI command, or a plain unit test.

Create the service in `lib/<feature>/service.ts`:

```typescript
// lib/notebooks/service.ts
import type { SupabaseClient } from '@supabase/supabase-js';

import type { CreateNotebookInput } from './schema';

export function createNotebookService(client: SupabaseClient) {
  return new NotebookService(client);
}

class NotebookService {
  constructor(private readonly client: SupabaseClient) {}

  async create(data: CreateNotebookInput & { userId: string }) {
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
}
```

The service never calls `createClient()` — the caller provides the client. This keeps the service testable (pass a mock client) and reusable (any interface can supply its own client). The owning `userId` is passed in as an argument; the service does not read the session.

### Step 3: Create the Server Action (Thin Adapter)

The action is a **thin adapter** — it resolves dependencies (client) and delegates to the service. No business logic lives here. Crucially, it takes `user.id` from the authenticated session and passes it to the service; it never trusts a `user_id` from the client.

Create the action in `app/<feature>/actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@/lib/server/action';
import { createClient } from '@/lib/supabase/server';
import { createNotebookService } from '@/lib/notebooks/service';
import { CreateNotebookSchema } from '@/lib/notebooks/schema';

export const createNotebookAction = enhanceAction(
  async function (data, user) {
    const client = await createClient();
    const service = createNotebookService(client);

    // user.id comes from the session — never from client input.
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

## Key Patterns

1. **Services are pure, interfaces are thin adapters.** The service contains all business logic. The server action (or route handler, or CLI command) is glue code that resolves dependencies and calls the service. If a route handler and a server action do the same thing, they call the same service function.
2. **Inject dependencies, don't import them in services.** Services receive their database client or any I/O capability as constructor arguments — never by importing request-scoped modules. This keeps them testable with stubs and reusable across interfaces.
3. **Schema in a separate file** — reusable between client and server.
4. **Never trust ownership IDs from the client.** `user_id` is always derived server-side from `user.id`. The client cannot set who owns a row.
5. **Revalidation** — use `revalidatePath` after mutations.
6. **Trust RLS** — don't add manual per-row auth checks in normal queries; Row Level Security (`auth.uid() = user_id`) enforces access. The `enhanceAction` `auth: true` gate just guarantees there is a logged-in user at all.
7. **Testable in isolation** — because services accept their dependencies, you can test them with a mock client and no running infrastructure.

## File Structure

```
lib/
├── notebooks/
│   ├── schema.ts          # Zod schemas + types
│   └── service.ts         # Pure service (dependencies injected)
└── server/
    └── action.ts          # enhanceAction helper

app/
└── notebooks/
    ├── actions.ts         # 'use server' — thin action adapters
    └── _components/
        └── notebook-form.tsx
```

## Reference Files

See examples in:
- `[Examples](examples.md)`
- `[Reference](reference.md)`
