/**
 * Maps raw Supabase/PostgREST errors to short, understandable German
 * messages for the UI. The original error is always logged server-side via
 * `console.error` — never forwarded to the client raw, since Auth/PostgREST
 * error strings are English, occasionally leak implementation detail, and
 * are not something an end user can act on.
 *
 * Lookup order: `error.code` (Supabase `AuthError`/`PostgrestError` both
 * expose one) against a known map, then a message substring match, then a
 * generic fallback.
 */

const GENERIC_FALLBACK = "Etwas ist schiefgelaufen. Bitte erneut versuchen."

const CODE_MESSAGES: Record<string, string> = {
  // Auth (@supabase/auth-js `AuthError.code`)
  invalid_credentials: "E-Mail oder Passwort ist falsch.",
  over_email_send_rate_limit: "Zu viele Versuche — bitte kurz warten.",
  over_request_rate_limit: "Zu viele Versuche — bitte kurz warten.",
  over_sms_send_rate_limit: "Zu viele Versuche — bitte kurz warten.",
  otp_expired: "Code ungültig oder abgelaufen.",
  otp_disabled: "Code ungültig oder abgelaufen.",
  user_already_exists: "Diese E-Mail ist bereits registriert.",
  email_exists: "Diese E-Mail ist bereits registriert.",
}

const MESSAGE_PATTERNS: Array<[RegExp, string]> = [
  [/invalid login credentials/i, "E-Mail oder Passwort ist falsch."],
  [/rate limit/i, "Zu viele Versuche — bitte kurz warten."],
  [
    /otp|token .*(expired|invalid)|(expired|invalid) .*token/i,
    "Code ungültig oder abgelaufen.",
  ],
  [/already registered|already exists/i, "Diese E-Mail ist bereits registriert."],
]

function extractCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code
  }
  return undefined
}

/**
 * Translates `error` into a German message safe to show in the UI, logging
 * the original (English, potentially sensitive) error server-side first.
 * `context` is a short label (e.g. the action name) to make the server log
 * useful.
 */
export function toGermanErrorMessage(error: unknown, context: string): string {
  console.error(`[${context}]`, error)

  const message = error instanceof Error ? error.message : undefined
  const code = extractCode(error)

  if (code && CODE_MESSAGES[code]) {
    return CODE_MESSAGES[code]
  }

  if (message) {
    for (const [pattern, mapped] of MESSAGE_PATTERNS) {
      if (pattern.test(message)) return mapped
    }
  }

  return GENERIC_FALLBACK
}
