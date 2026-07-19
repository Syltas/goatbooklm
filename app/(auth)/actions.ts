"use server"

import { redirect } from "next/navigation"

import { createAuthService } from "@/lib/auth/service"
import {
  LoginOtpRequestSchema,
  LoginOtpVerifySchema,
  LoginPasswordSchema,
  SignupSchema,
} from "@/lib/auth/schema"
import { enhanceAction } from "@/lib/server/action"
import { createClient } from "@/lib/supabase/server"

// All four actions below are explicitly public (`auth: false`): a visitor
// hitting /login or /signup is, by definition, not authenticated yet, so
// enhanceAction's default "require a logged-in user" gate does not apply
// here. Nothing in these handlers trusts client input for identity — the
// resulting session is whatever Supabase Auth issues for the credentials
// supplied, and `redirect()` only ever fires after a Supabase call
// succeeded.
//
// Service failures (bad credentials, expired OTP, etc.) are caught here and
// returned as `{ error: string }` rather than thrown. Next.js redacts the
// message of any Error thrown out of a Server Action in production, which
// would turn "Invalid login credentials" into a generic, useless string —
// returning it as plain data instead keeps the real message intact for the
// client to render.

function getActionErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again."
}

// Explicit discriminated result types so callers narrow with a plain
// `"error" in result` check instead of relying on inference across the
// try/catch + redirect control flow (which TS otherwise widens into an
// all-optional shape, defeating narrowing).
type ActionError = { error: string }
export type SignUpActionResult =
  | ActionError
  | { needsEmailConfirmation: boolean }

export const signInWithPasswordAction = enhanceAction(
  async (data): Promise<ActionError | undefined> => {
    const client = await createClient()
    const service = createAuthService(client)

    try {
      await service.signInWithPassword(data)
    } catch (error) {
      return { error: getActionErrorMessage(error) }
    }

    redirect("/dashboard")
  },
  { auth: false, schema: LoginPasswordSchema }
)

export const requestLoginOtpAction = enhanceAction(
  async (data): Promise<ActionError | undefined> => {
    const client = await createClient()
    const service = createAuthService(client)

    try {
      await service.requestOtp(data)
    } catch (error) {
      return { error: getActionErrorMessage(error) }
    }
  },
  { auth: false, schema: LoginOtpRequestSchema }
)

export const verifyLoginOtpAction = enhanceAction(
  async (data): Promise<ActionError | undefined> => {
    const client = await createClient()
    const service = createAuthService(client)

    try {
      await service.verifyOtp(data)
    } catch (error) {
      return { error: getActionErrorMessage(error) }
    }

    redirect("/dashboard")
  },
  { auth: false, schema: LoginOtpVerifySchema }
)

export const signUpAction = enhanceAction(
  async (data): Promise<SignUpActionResult> => {
    const client = await createClient()
    const service = createAuthService(client)

    let result: Awaited<ReturnType<typeof service.signUp>>
    try {
      result = await service.signUp(data)
    } catch (error) {
      return { error: getActionErrorMessage(error) }
    }

    if (result.session) {
      // Email confirmations are disabled on this project — signUp() already
      // returned a live session, so this is effectively a successful login.
      redirect("/dashboard")
    }

    return {
      needsEmailConfirmation: !result.user?.email_confirmed_at,
    }
  },
  { auth: false, schema: SignupSchema }
)
