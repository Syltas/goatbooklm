# Server Action Examples

Real-world patterns for a Next.js 15 + Supabase app. All actions go through the
local `enhanceAction` helper (`@/lib/server/action.ts`).

## Update Action

```typescript
'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@/lib/server/action';
import { createClient } from '@/lib/supabase/server';
import { createNotebookService } from '@/lib/notebooks/service';
import { UpdateNotebookSchema } from '@/lib/notebooks/schema';

export const updateNotebookAction = enhanceAction(
  async function (data, user) {
    const client = await createClient();
    const service = createNotebookService(client);

    // The service scopes the update to this user; RLS enforces it too.
    await service.update({ ...data, userId: user.id });

    revalidatePath(`/notebooks/${data.notebookId}`);

    return { success: true };
  },
  {
    auth: true,
    schema: UpdateNotebookSchema,
  },
);
```

## Simple Profile Update (direct query, no service)

For a one-line mutation with no reusable logic, the action may query directly —
but it still derives the row owner from `user.id`, never from client input.

```typescript
'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@/lib/server/action';
import { createClient } from '@/lib/supabase/server';
import { UpdateProfileSchema } from '@/lib/profile/schema';

export const updateProfileAction = enhanceAction(
  async function (data, user) {
    const client = await createClient();

    const { error } = await client
      .from('profiles')
      .update({ display_name: data.displayName })
      .eq('id', user.id); // scope to the authenticated user

    if (error) {
      throw error;
    }

    revalidatePath('/settings');

    return { success: true };
  },
  {
    auth: true,
    schema: UpdateProfileSchema,
  },
);
```

## Action with Redirect

```typescript
'use server';

import { redirect } from 'next/navigation';

import { enhanceAction } from '@/lib/server/action';
import { createClient } from '@/lib/supabase/server';
import { createNotebookService } from '@/lib/notebooks/service';
import { CreateNotebookSchema } from '@/lib/notebooks/schema';

export const createNotebookAction = enhanceAction(
  async function (data, user) {
    const client = await createClient();
    const service = createNotebookService(client);

    const notebook = await service.create({ ...data, userId: user.id });

    // Redirect after creation
    redirect(`/notebooks/${notebook.id}`);
  },
  {
    auth: true,
    schema: CreateNotebookSchema,
  },
);
```

## Delete Action

```typescript
'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@/lib/server/action';
import { createClient } from '@/lib/supabase/server';
import { DeleteNotebookSchema } from '@/lib/notebooks/schema';

export const deleteNotebookAction = enhanceAction(
  async function (data, user) {
    const client = await createClient();

    const { error } = await client
      .from('notebooks')
      .delete()
      .eq('id', data.notebookId)
      .eq('user_id', user.id); // RLS also validates ownership

    if (error) {
      throw error;
    }

    revalidatePath('/notebooks');

    return { success: true };
  },
  {
    auth: true,
    schema: DeleteNotebookSchema,
  },
);
```

## Error Handling with isRedirectError

`redirect()` works by throwing a special error. When you wrap an action body in
`try/catch`, re-throw redirect errors so navigation still happens.

```typescript
'use server';

import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { redirect } from 'next/navigation';

import { enhanceAction } from '@/lib/server/action';
import { SubmitFormSchema } from '@/lib/forms/schema';
import { processForm } from '@/lib/forms/service';

export const submitFormAction = enhanceAction(
  async function (data, user) {
    try {
      await processForm(data, user.id);

      redirect('/success');
    } catch (error) {
      // Don't treat redirects as errors — re-throw them so navigation happens.
      if (!isRedirectError(error)) {
        // Handle the actual failure (log, wrap, rethrow).
      }
      throw error;
    }
  },
  {
    auth: true,
    schema: SubmitFormSchema,
  },
);
```

## Public Action (auth disabled — must be justified)

Auth is required by default. The only way to opt out is `auth: false`, and it
must be explained in a comment.

```typescript
'use server';

import { enhanceAction } from '@/lib/server/action';
import { createClient } from '@/lib/supabase/server';
import { SubscribeSchema } from '@/lib/newsletter/schema';

export const subscribeAction = enhanceAction(
  async function (data) {
    // PUBLIC: newsletter opt-in from the marketing page, no login required.
    const client = await createClient();

    const { error } = await client
      .from('newsletter_subscribers')
      .insert({ email: data.email });

    if (error) {
      throw error;
    }

    return { success: true };
  },
  {
    auth: false, // explicitly public — no user context
    schema: SubscribeSchema,
  },
);
```
