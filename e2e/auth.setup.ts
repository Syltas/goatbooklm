import fs from "node:fs"
import path from "node:path"

import { expect, test as setup } from "@playwright/test"

import { createTestUser, TEST_USER_PASSWORD } from "./support/test-user"

export const AUTH_STATE_FILE = path.join(__dirname, ".auth/user.json")
export const TEST_USER_FILE = path.join(__dirname, ".auth/test-user.json")

/**
 * Runs once before the `chromium` project (see playwright.config.ts
 * `dependencies`). Creates a throwaway test user via the Admin API, logs in
 * through the real login UI (password tab — it's the default tab, no
 * `data-test="login-tab-password"` click needed), and persists the resulting
 * session as `storageState` so every other spec starts already authenticated.
 * `global-teardown.ts` deletes the user (and, via FK cascade, its
 * notebooks) after the run.
 */
setup("authenticate", async ({ page }) => {
  const user = await createTestUser()

  fs.mkdirSync(path.dirname(TEST_USER_FILE), { recursive: true })
  fs.writeFileSync(TEST_USER_FILE, JSON.stringify(user, null, 2))

  await page.goto("/login")
  await page.getByTestId("login-password-email-input").fill(user.email)
  await page
    .getByTestId("login-password-password-input")
    .fill(TEST_USER_PASSWORD)
  await page.getByTestId("login-password-submit-button").click()

  await page.waitForURL("**/notebooks")
  await expect(page.getByTestId("app-header-user-email")).toHaveText(
    user.email
  )

  await page.context().storageState({ path: AUTH_STATE_FILE })
})
