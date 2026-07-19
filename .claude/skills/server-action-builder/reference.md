# Server Action Reference

## `enhanceAction` API

The local helper (`@/lib/server/action.ts`) wraps a handler with auth + Zod
validation and returns a callable server action.

```typescript
import { enhanceAction } from '@/lib/server/action';

export const myAction = enhanceAction(
  async function (data, user) {
    // data: validated input (typed from schema)
    // user: authenticated user object (present unless auth: false)

    return { success: true, data: result };
  },
  {
    auth: true,          // Require authentication (default: true)
    schema: ZodSchema,   // Zod schema for validation (optional)
  },
);
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `auth` | `boolean` | `true` | Require an authenticated user. Set `false` only for explicitly public actions, with a comment explaining why. |
| `schema` | `ZodSchema` | – | Zod schema for input validation |

### Handler Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `z.infer<Schema>` | Validated input data |
| `user` | `User` | Authenticated user (from `supabase.auth.getUser()`) |

## Route Handlers

For REST-style endpoints (`app/api/**/route.ts`), use a plain Next.js Route
Handler and apply the same discipline inline: resolve the client, require a user,
validate the body with Zod, then call the service.

```typescript
// app/api/notebooks/route.ts
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { createNotebookService } from '@/lib/notebooks/service';
import { CreateNotebookSchema } from '@/lib/notebooks/schema';

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = CreateNotebookSchema.parse(await request.json());

  const service = createNotebookService(supabase);
  const result = await service.create({ ...body, userId: user.id });

  return NextResponse.json(result);
}

export async function GET(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get('q') ?? '';

  const service = createNotebookService(supabase);
  const result = await service.search(user.id, query);

  return NextResponse.json({ data: result });
}
```

If you find yourself repeating the auth-and-parse preamble, factor it into a
small `enhanceRouteHandler` helper in `@/lib/server/` mirroring `enhanceAction`.
The rule is the same: **auth by default, Zod-validated body, ownership derived
server-side.**

## Common Zod Patterns

```typescript
import { z } from 'zod';

// Basic schema — no ownership IDs; those come from the session, not the client.
export const CreateNoteSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  content: z.string().optional(),
});

// With coercion + defaults
export const SearchSchema = z.object({
  query: z.string().trim().min(1),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

// With refinements
export const DateRangeSchema = z
  .object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: 'End date must be after start date',
  });

// Enum values (mirror DB enum values from lib/database.types.ts)
export const StatusSchema = z.object({
  status: z.enum(['active', 'archived', 'processing']),
});
```

## Revalidation

```typescript
import { revalidatePath, revalidateTag } from 'next/cache';

// Revalidate a static path
revalidatePath('/notebooks');

// Revalidate a dynamic segment
revalidatePath(`/notebooks/${notebookId}`);

// Revalidate by tag
revalidateTag('notebooks');
```

## Redirect

```typescript
import { redirect } from 'next/navigation';

// Redirect after an action
redirect('/success');

// Redirect with a dynamic path
redirect(`/notebooks/${notebookId}`);
```

## Logging

Keep logging simple. Use `console` with a small context object, or a lightweight
logger if you add one. Log before and after meaningful operations.

```typescript
const ctx = { action: 'create-notebook', userId: user.id };

console.info(ctx, 'Creating notebook');
// ...
console.info({ ...ctx, notebookId: result.id }, 'Notebook created');

// On failure
console.error({ ...ctx, error }, 'Failed to create notebook');
```

## Supabase Clients

```typescript
// Standard request-scoped client (RLS enforced) — use this by default.
import { createClient } from '@/lib/supabase/server';
const supabase = await createClient();

// Browser client (client components).
import { createClient as createBrowserClient } from '@/lib/supabase/client';
const supabase = createBrowserClient();

// Admin / service-role client (bypasses RLS — server only, use sparingly and
// validate ownership manually).
import { createAdminClient } from '@/lib/supabase/admin';
const admin = createAdminClient();
```

## Error Handling

```typescript
import { isRedirectError } from 'next/dist/client/components/redirect-error';

try {
  await operation();
  redirect('/success');
} catch (error) {
  if (!isRedirectError(error)) {
    // Handle the actual error
    console.error({ error }, 'Operation failed');
    throw error;
  }
  throw error; // Re-throw redirect so navigation happens
}
```
