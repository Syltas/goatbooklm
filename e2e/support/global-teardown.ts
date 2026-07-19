import fs from "node:fs"

import { TEST_USER_FILE } from "../auth.setup"
import { deleteTestUser, type TestUser } from "./test-user"

/**
 * Runs once after the whole Playwright run finishes (config: `globalTeardown`).
 * Deletes the test user created in `auth.setup.ts` — FK cascade
 * (`notebooks.user_id references auth.users(id) on delete cascade`) removes
 * every notebook/source/chunk/message it created along with it, so no
 * separate per-table cleanup is required.
 */
export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(TEST_USER_FILE)) return

  const user = JSON.parse(fs.readFileSync(TEST_USER_FILE, "utf-8")) as TestUser
  await deleteTestUser(user.id)
  fs.rmSync(TEST_USER_FILE, { force: true })
}
