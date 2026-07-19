"use server"

import { redirect } from "next/navigation"

import { createAuthService } from "@/lib/auth/service"
import {
  LoginOtpRequestSchema,
  LoginOtpVerifySchema,
  LoginPasswordSchema,
  SignupSchema,
} from "@/lib/auth/schema"
import { enhanceAction, type ActionResult } from "@/lib/server/action"
import { toGermanErrorMessage } from "@/lib/server/error-messages"
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
// would turn "Invalid login credentials" into an opaque, useless string —
// returning it as plain data instead lets us map it to a specific German
// message for the client to render. The raw Supabase message is logged
// server-side (`toGermanErrorMessage`) but never sent to the client as-is.

function getActionErrorMessage(error: unknown) {
  return toGermanErrorMessage(error, "auth-action")
}

export type SignUpSuccess = { needsEmailConfirmation: boolean }

export const signInWithPasswordAction = enhanceAction(
  async (data): Promise<ActionResult<{ success: true }>> => {
    const client = await createClient()
    const service = createAuthService(client)

    try {
      await service.signInWithPassword(data)
    } catch (error) {
      return { error: getActionErrorMessage(error) }
    }

    redirect("/notebooks")
  },
  { auth: false, schema: LoginPasswordSchema }
)

export const requestLoginOtpAction = enhanceAction(
  async (data): Promise<ActionResult<{ sent: true }>> => {
    const client = await createClient()
    const service = createAuthService(client)

    try {
      await service.requestOtp(data)
    } catch (error) {
      return { error: getActionErrorMessage(error) }
    }

    return { data: { sent: true } }
  },
  { auth: false, schema: LoginOtpRequestSchema }
)

export const verifyLoginOtpAction = enhanceAction(
  async (data): Promise<ActionResult<{ success: true }>> => {
    const client = await createClient()
    const service = createAuthService(client)

    try {
      await service.verifyOtp(data)
    } catch (error) {
      return { error: getActionErrorMessage(error) }
    }

    redirect("/notebooks")
  },
  { auth: false, schema: LoginOtpVerifySchema }
)

export const signUpAction = enhanceAction(
  async (data): Promise<ActionResult<SignUpSuccess>> => {
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
      redirect("/notebooks")
    }

    return {
      data: {
        needsEmailConfirmation: !result.user?.email_confirmed_at,
      },
    }
  },
  { auth: false, schema: SignupSchema }
)
