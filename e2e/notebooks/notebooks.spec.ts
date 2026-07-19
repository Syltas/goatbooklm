import { expect, test } from "@playwright/test"

import { NotebookDetailPage, NotebooksPage } from "./notebooks.po"

test.describe("notebooks smoke", () => {
  test("login → create → open detail → back → rename → delete", async ({
    page,
  }) => {
    const notebooks = new NotebooksPage(page)

    // Already authenticated via the `setup` project's storageState — going
    // straight to /notebooks proves AC-1 (no redirect, no 404).
    await notebooks.goto()

    // Fresh test user has zero notebooks — the dashed create tile IS the
    // empty state (AC-9/AC-40).
    await expect(notebooks.emptyCreateTile).toBeVisible()
    await expect(notebooks.cardLinks).toHaveCount(0)

    const title = `E2E Notizbuch ${Date.now()}`
    await notebooks.createNotebook(title, "Erstellt vom Playwright-Smoke-Test")

    // Card appears without a manual reload (AC-17).
    const id = await notebooks.soleNotebookId()
    await expect(notebooks.card(id)).toContainText(title)

    // F1 regression guard: click precisely on the card TITLE, not the
    // stretched-link anchor's own center — the bug being guarded against
    // stacked the invisible full-bleed nav link (z-0) *under* the visible
    // content (z-10), so clicks on the title/description silently did
    // nothing instead of navigating. `force: true` is required and
    // correct here: Playwright's actionability check refuses a plain
    // click because the anchor (not the h3) is the element that actually
    // receives the pointer event at that point — which is exactly the
    // stretched-link stacking the fix establishes. `force: true` skips
    // that guard and dispatches a real click at the title's coordinates,
    // letting the browser's native hit-testing (i.e. the anchor on top)
    // resolve it, proving the click truly navigates.
    await notebooks.cardTitle(id).click({ force: true })
    await page.waitForURL(`**/notebooks/${id}`)
    await page.getByTestId("app-header-home-link").click()
    await page.waitForURL("**/notebooks")
    await expect(notebooks.card(id)).toBeVisible()

    // Open the detail shell (AC-29/AC-30): 3 panels, each independently
    // collapsible (AC-36).
    await notebooks.openNotebook(id)
    await page.waitForURL(`**/notebooks/${id}`)

    const detail = new NotebookDetailPage(page)
    await detail.expectThreePanelsVisible()

    // Back to the grid via the persistent app header.
    await page.getByTestId("app-header-home-link").click()
    await page.waitForURL("**/notebooks")
    await expect(notebooks.card(id)).toBeVisible()

    // Rename (AC-20…AC-22): same dialog, prefilled, updates without reload.
    const renamedTitle = `${title} (umbenannt)`
    await notebooks.renameNotebook(id, renamedTitle)
    await expect(notebooks.card(id)).toContainText(renamedTitle)

    // Delete with confirm (AC-24…AC-26): card disappears, grid returns to
    // the empty state.
    await notebooks.deleteNotebook(id)
    await expect(notebooks.cardLink(id)).toHaveCount(0)
    await expect(notebooks.emptyCreateTile).toBeVisible()
  })
})

test.describe("unauthenticated access", () => {
  // Override the project's logged-in storageState for this test only.
  test.use({ storageState: { cookies: [], origins: [] } })

  test("redirects /notebooks to /login when logged out (AC-8)", async ({
    page,
  }) => {
    await page.goto("/notebooks")
    await page.waitForURL("**/login")
    await expect(page).toHaveURL(/\/login$/)
  })
})
