import type { User } from "@supabase/supabase-js"
import { unstable_rethrow } from "next/navigation"
import type { z } from "zod"

import { toGermanErrorMessage } from "@/lib/server/error-messages"
import { createClient } from "@/lib/supabase/server"

/**
 * Shared discriminated result shape for server actions that return data on
 * success. Defined once so every feature's actions — and the existing auth
 * actions — share one convention instead of each declaring an ad-hoc union
 * (Eng-Review 2026-07-19, F8, specs/01-notebooks.md). Callers narrow with
 * `"error" in result`.
 */
export type ActionResult<T> = { data: T } | { error: string }

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
 * Only the first issue is surfaced: every schema in this codebase already
 * carries a field-specific German message (lib/notebooks/schema.ts et al.),
 * so that single message is exactly what an end user needs — showing every
 * issue at once would just pile on context for what's normally one bad
 * field in one form.
 */
function formatValidationError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Eingabe ungültig."
}

/**
 * Wraps a server action handler with the same discipline every action in
 * this codebase follows: resolve the request-scoped Supabase client,
 * require an authenticated user (unless explicitly opted out), validate
 * input with a Zod schema, then delegate to the handler with typed input —
 * all inside one `try/catch`. Without it, a thrown ZodError, a missing
 * session, or anything a caller does before its own `try` (e.g.
 * `createAdminClient()` throwing on a missing env var) escapes as an
 * uncaught exception and hits the client as Next.js's dev error overlay
 * instead of a normal `{ error }` result.
 */
export function enhanceAction<
  T,
  Schema extends z.ZodTypeAny | undefined = undefined,
>(
  handler: (
    input: ActionInput<Schema>,
    user: User
  ) => Promise<ActionResult<T>>,
  options: ActionOptions<NonNullable<Schema>> = {}
) {
  return async (rawInput: ActionInput<Schema>): Promise<ActionResult<T>> => {
    try {
      // 1. Resolve the request-scoped Supabase client (reads cookies).
      const supabase = await createClient()

      // 2. Resolve the authenticated user.
      const {
        data: { user },
      } = await supabase.auth.getUser()

      // 3. Fail closed unless the action is explicitly public. Returned as
      // `{ error }`, not thrown — a throw here used to bypass every
      // caller's own try/catch and reach the client as an unhandled
      // exception instead of a normal result.
      if (options.auth !== false && !user) {
        return { error: "Bitte melde dich erneut an." }
      }

      // 4. Validate input with the Zod schema, if provided. `safeParse`
      // instead of `parse`: a schema violation becomes a returned
      // `{ error }` with the first (already German, field-specific) issue
      // message, never a thrown ZodError.
      let input: ActionInput<Schema>
      if (options.schema) {
        const parsed = options.schema.safeParse(rawInput)
        if (!parsed.success) {
          return { error: formatValidationError(parsed.error) }
        }
        input = parsed.data as ActionInput<Schema>
      } else {
        input = rawInput as ActionInput<Schema>
      }

      // 5. Delegate to the handler with typed input + user.
      return await handler(input, user as User)
    } catch (error) {
      // redirect()/notFound()/forbidden()/unauthorized() interrupt control
      // flow by throwing a special Next.js digest error — rethrow those so
      // the framework still handles them. Otherwise a successful redirect
      // from inside a handler (signOutAction, signInWithPasswordAction, …)
      // would be swallowed right here and turned into a bogus error result.
      unstable_rethrow(error)
      return { error: toGermanErrorMessage(error, "enhanceAction") }
    }
  }
}
