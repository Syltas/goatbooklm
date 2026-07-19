# Service Builder Examples

## Service with Multiple Dependencies

When a service needs more than just a database client, inject all dependencies.

```typescript
// lib/sources/service.ts
import type { SupabaseClient } from '@supabase/supabase-js';

interface SourceServiceDeps {
  client: SupabaseClient;
  storage: SupabaseClient['storage'];
}

export function createSourceService(deps: SourceServiceDeps) {
  return new SourceService(deps);
}

class SourceService {
  constructor(private readonly deps: SourceServiceDeps) {}

  async ingestUpload(params: {
    sourceId: string;
    userId: string;
  }): Promise<{ path: string }> {
    const { data: source, error } = await this.deps.client
      .from('sources')
      .select('*')
      .eq('id', params.sourceId)
      .eq('user_id', params.userId)
      .single();

    if (error) throw error;

    const bytes = this.extractText(source);

    const { data: upload, error: uploadError } = await this.deps.storage
      .from('sources')
      .upload(`${params.userId}/${params.sourceId}.txt`, bytes);

    if (uploadError) throw uploadError;

    return { path: upload.path };
  }

  private extractText(source: Record<string, unknown>): Uint8Array {
    // Pure logic — no I/O
    // ...
    return new Uint8Array();
  }
}
```

**Server action adapter:**

```typescript
'use server';

import { enhanceAction } from '@/lib/server/action';
import { createClient } from '@/lib/supabase/server';
import { IngestSourceSchema } from '@/lib/sources/schema';
import { createSourceService } from '@/lib/sources/service';

export const ingestSourceAction = enhanceAction(
  async function (data, user) {
    const client = await createClient();
    const service = createSourceService({
      client,
      storage: client.storage,
    });

    return service.ingestUpload({ sourceId: data.sourceId, userId: user.id });
  },
  { auth: true, schema: IngestSourceSchema },
);
```

## Service Composing Other Services

Services can depend on other services — compose at the adapter level.

```typescript
// lib/onboarding/service.ts
import type { NotebookService } from '@/lib/notebooks/service';
import type { NotificationService } from '@/lib/notifications/service';

interface OnboardingServiceDeps {
  notebooks: NotebookService;
  notifications: NotificationService;
}

export function createOnboardingService(deps: OnboardingServiceDeps) {
  return new OnboardingService(deps);
}

class OnboardingService {
  constructor(private readonly deps: OnboardingServiceDeps) {}

  async onboardUser(params: { userId: string; displayName: string }) {
    // Create the user's first notebook
    const notebook = await this.deps.notebooks.create({
      title: `${params.displayName}'s First Notebook`,
      userId: params.userId,
    });

    // Send a welcome notification
    await this.deps.notifications.send({
      userId: params.userId,
      type: 'welcome',
      data: { notebookId: notebook.id },
    });

    return { notebook };
  }
}
```

**Adapter composes the dependency tree:**

```typescript
'use server';

import { enhanceAction } from '@/lib/server/action';
import { createClient } from '@/lib/supabase/server';
import { OnboardUserSchema } from '@/lib/onboarding/schema';
import { createOnboardingService } from '@/lib/onboarding/service';
import { createNotebookService } from '@/lib/notebooks/service';
import { createNotificationService } from '@/lib/notifications/service';

export const onboardUserAction = enhanceAction(
  async function (data, user) {
    const client = await createClient();

    const service = createOnboardingService({
      notebooks: createNotebookService(client),
      notifications: createNotificationService(client),
    });

    return service.onboardUser({ userId: user.id, displayName: data.displayName });
  },
  { auth: true, schema: OnboardUserSchema },
);
```

## Pure Function Service (No I/O)

Some services are entirely pure — they don't even need a database client.

```typescript
// lib/chunking/service.ts

interface ChunkInput {
  text: string;
  maxTokens: number;
  overlap: number;
}

interface Chunk {
  index: number;
  text: string;
}

export function chunkText(input: ChunkInput): Chunk[] {
  const words = input.text.split(/\s+/);
  const chunks: Chunk[] = [];
  const step = Math.max(1, input.maxTokens - input.overlap);

  for (let start = 0, index = 0; start < words.length; start += step, index++) {
    chunks.push({
      index,
      text: words.slice(start, start + input.maxTokens).join(' '),
    });
  }

  return chunks;
}
```

This is the simplest case — a plain function, no class, no dependencies. Trivially testable:

```typescript
import { chunkText } from '../service';

it('produces overlapping chunks', () => {
  const chunks = chunkText({
    text: 'a b c d e f',
    maxTokens: 3,
    overlap: 1,
  });

  expect(chunks[0].text).toBe('a b c');
  expect(chunks[1].text).toBe('c d e');
});
```

## Testing with a Mock Client

Full mock pattern for the Supabase client:

```typescript
import { vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Creates a chainable mock that mimics Supabase's query builder.
 * Override any method in the chain via the `overrides` param.
 */
export function createMockSupabaseClient(
  resolvedValue: { data: unknown; error: unknown } = { data: null, error: null },
  overrides: Record<string, unknown> = {},
) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};

  // Every method returns `this` (chainable) by default
  const methods = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in',
    'like', 'ilike', 'is', 'order', 'limit', 'range',
    'single', 'maybeSingle',
  ];

  for (const method of methods) {
    chain[method] = vi.fn().mockReturnThis();
  }

  // Terminal methods resolve with data
  chain.single = vi.fn().mockResolvedValue(resolvedValue);
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);

  // Apply overrides
  for (const [key, value] of Object.entries(overrides)) {
    chain[key] = vi.fn().mockImplementation(
      typeof value === 'function' ? value : () => value,
    );
  }

  // Non-terminal chains that don't end with single/maybeSingle
  // resolve when awaited via .then()
  const proxyHandler: ProxyHandler<typeof chain> = {
    get(target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(resolvedValue);
      }
      return target[prop as string] ?? vi.fn().mockReturnValue(target);
    },
  };

  const chainProxy = new Proxy(chain, proxyHandler);

  return {
    from: vi.fn(() => chainProxy),
    chain,
  } as unknown as SupabaseClient & { chain: typeof chain };
}
```

Usage:

```typescript
import { createMockSupabaseClient } from '../test-utils';
import { createNotebookService } from '../service';

it('lists notebooks for a user', async () => {
  const notebooks = [
    { id: '1', title: 'Alpha', user_id: 'user-1' },
    { id: '2', title: 'Beta', user_id: 'user-1' },
  ];

  const client = createMockSupabaseClient({ data: notebooks, error: null });
  const service = createNotebookService(client);

  const result = await service.list('user-1');

  expect(result).toEqual(notebooks);
  expect(client.from).toHaveBeenCalledWith('notebooks');
  expect(client.chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
});
```
