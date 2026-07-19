import { randomUUID } from "node:crypto"

import { createTestAdminClient } from "./admin-client"

export const TEST_USER_PASSWORD = "e2e-Test-Passw0rd!"

export interface TestUser {
  id: string
  email: string
}

/**
 * Creates a fresh, pre-confirmed test user via the Supabase Admin API for
 * this run only (unique email per run — no shared fixture data, no
 * `supabase db reset --local` needed between runs). `email_confirm: true`
 * skips the Mailpit OTP round-trip so `auth.setup.ts` can log in with the
 * password form immediately.
 */
export async function createTestUser(): Promise<TestUser> {
  const admin = createTestAdminClient()
  const email = `e2e+${Date.now()}-${randomUUID().slice(0, 8)}@test.local`

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_USER_PASSWORD,
    email_confirm: true,
  })

  if (error || !data.user) {
    throw new Error(`Failed to create e2e test user: ${error?.message}`)
  }

  return { id: data.user.id, email }
}

/**
 * Deletes the test user. `notebooks.user_id references auth.users(id) on
 * delete cascade` (and `sources`/`chunks`/`messages` cascade from
 * `notebooks`), so this alone removes every row the run created — no
 * separate per-table cleanup needed.
 */
export async function deleteTestUser(userId: string): Promise<void> {
  const admin = createTestAdminClient()
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) {
    console.warn(
      `e2e cleanup: failed to delete test user ${userId}: ${error.message}`
    )
  }
}
