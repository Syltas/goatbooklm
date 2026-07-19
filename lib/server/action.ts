import type { User } from "@supabase/supabase-js"
import type { z } from "zod"

import { createClient } from "@/lib/supabase/server"

interface ActionOptions<Schema extends z.ZodTypeAny> {
  /**
   * Require an authenticated user (default: true). Set to false only for
   * explicitly public actions — and say why in a comment at the call site.
   */
  auth?: boolean
  /** Zod schema used to validate the raw input before the handler runs. */
  schema?: Schema
}

type ActionInput<Schema extends z.ZodTypeAny | undefined> =
  Schema extends z.ZodTypeAny ? z.infer<Schema> : undefined

/**
 * Wraps a server action handler with the same discipline every action in
 * this codebase follows: resolve the request-scoped Supabase client,
 * require an authenticated user (unless explicitly opted out), validate
 * input with a Zod schema, then delegate to the handler with typed input.
 */
export function enhanceAction<
  Return,
  Schema extends z.ZodTypeAny | undefined = undefined,
>(
  handler: (input: ActionInput<Schema>, user: User) => Promise<Return>,
  options: ActionOptions<NonNullable<Schema>> = {}
) {
  return async (rawInput: ActionInput<Schema>): Promise<Return> => {
    // 1. Resolve the request-scoped Supabase client (reads cookies).
    const supabase = await createClient()

    // 2. Resolve the authenticated user.
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // 3. Fail closed unless the action is explicitly public.
    if (options.auth !== false && !user) {
      throw new Error("Unauthorized")
    }

    // 4. Validate input with the Zod schema, if provided.
    const input = options.schema
      ? (options.schema.parse(rawInput) as ActionInput<Schema>)
      : (rawInput as ActionInput<Schema>)

    // 5. Delegate to the handler with typed input + user.
    return handler(input, user as User)
  }
}
