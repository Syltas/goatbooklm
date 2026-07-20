import { expect, test } from "@playwright/test"

import { NotebooksPage } from "../notebooks/notebooks.po"
import { SourcesPanelPage } from "../sources/sources.po"
import { ChatPanelPage } from "./chat.po"

const SOURCE_TITLE = "E2E Verlauf-Quelle"
const SOURCE_TEXT =
  "Der Silberne Steinbock ist eine fiktive Auszeichnung aus einem Playwright-Testfixture. " +
  "Der Silberne Steinbock wiegt exakt 913 Gramm und besteht aus poliertem Zinn."

test.describe("chat history deletion", () => {
  test("kebab menu → confirm dialog → transcript cleared and stays cleared after reload", async ({
    page,
  }) => {
    // One real embedding call plus one real Claude call.
    test.setTimeout(240_000)

    const notebooks = new NotebooksPage(page)
    await notebooks.goto()

    const notebookTitle = `E2E Verlauf ${Date.now()}`
    await notebooks.createNotebook(notebookTitle)
    const notebookId = await notebooks.soleNotebookId()
    await notebooks.openNotebook(notebookId)
    await page.waitForURL(`**/notebooks/${notebookId}`)

    const chat = new ChatPanelPage(page)
    const sources = new SourcesPanelPage(page)

    // Empty transcript: the menu exists but the delete item is disabled —
    // nothing to delete, so no dialog should be reachable.
    await expect(chat.headerMenu).toBeVisible()
    await chat.headerMenu.click()
    await expect(chat.deleteHistoryMenuItem).toBeDisabled()
    await page.keyboard.press("Escape")

    await sources.addTextSource(SOURCE_TITLE, SOURCE_TEXT)
    await sources.waitForReady(90_000)
    await expect(chat.input).toBeEnabled({ timeout: 15_000 })

    await chat.ask("Wie viel wiegt der Silberne Steinbock?")
    await expect(chat.assistantMessages).toHaveCount(1, { timeout: 90_000 })
    await expect(chat.lastAssistantMessage()).toContainText("913", { timeout: 90_000 })
    await expect(chat.allMessages).toHaveCount(2)

    // Cancel must be non-destructive.
    await chat.openHistoryDeleteDialog()
    await expect(chat.deleteHistoryDialog).toBeVisible()
    await chat.deleteHistoryCancel.click()
    await expect(chat.deleteHistoryDialog).toBeHidden()
    await expect(chat.allMessages).toHaveCount(2)

    // Confirm clears the client-held transcript immediately…
    await chat.openHistoryDeleteDialog()
    await chat.deleteHistoryConfirm.click()
    await expect(chat.deleteHistoryDialog).toBeHidden()
    await expect(chat.allMessages).toHaveCount(0)
    // Empty-chat-summary feature (Part A, e2e/chat/chat-actions.spec.ts):
    // once this notebook's one `ready` source has a generated summary, the
    // empty state shows that instead of the static suggested-question
    // chips — which variant renders depends on whether the worker's
    // background summarization finished by this point in the test, not on
    // anything this test itself is exercising (history deletion). Either is
    // a valid "cleared and usable" empty state here.
    await expect(
      page.getByTestId("chat-notebook-summary").or(chat.suggestedChips.first())
    ).toBeVisible()

    // …and the rows are really gone server-side, not just hidden client-side.
    await page.reload()
    await expect(chat.allMessages).toHaveCount(0)

    // Back to the empty state: nothing left to delete.
    await chat.headerMenu.click()
    await expect(chat.deleteHistoryMenuItem).toBeDisabled()
    await page.keyboard.press("Escape")

    await page.getByTestId("app-header-home-link").click()
    await page.waitForURL("**/notebooks")
    await notebooks.deleteNotebook(notebookId)
  })
})
