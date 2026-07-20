import { expect, test } from "@playwright/test"

import { NotebooksPage } from "../notebooks/notebooks.po"
import { SourcesPanelPage } from "../sources/sources.po"
import { ChatActionsPage } from "./chat-actions.po"

/**
 * This feature's own spec — the empty-chat notebook summary (Part A) and
 * per-answer actions/follow-up-question chips (Part B). Kept separate from
 * `e2e/chat/chat.spec.ts` (a parallel agent's file, reworking citation
 * interaction) per this task's file-ownership split.
 */

const SOURCE_TITLE = "E2E Chat-Actions-Quelle"
const SOURCE_TEXT =
  "Die Silberne Wanderdrossel ist ein fiktiver Vogel aus einem Playwright-Testfixture. " +
  "Die Silberne Wanderdrossel wiegt exakt 128 Gramm und lebt in den Schweizer Alpen. " +
  "Sie ernährt sich hauptsächlich von Beeren und kleinen Insekten und brütet im Frühsommer."

test.describe("chat actions: notebook summary, save-as-note, copy, follow-ups", () => {
  test("summary appears in the empty chat, an answer gets actions + follow-ups, both save as notes", async ({
    page,
  }) => {
    // Real ingestion (queue + worker + OpenAI embedding), a real worker-side
    // summarization call, and a real chat Claude call, all in one test —
    // generous budget on top of Playwright's own action timeouts.
    test.setTimeout(300_000)

    // Grants clipboard-write up front so "Kopieren" exercises the SUCCESS
    // path (a real `navigator.clipboard.writeText`), not the permission-
    // denied catch branch — without this, Chromium can reject an
    // unprivileged clipboard write and the test would only ever prove the
    // error toast, never the real copy.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"])

    const notebooks = new NotebooksPage(page)
    await notebooks.goto()

    const notebookTitle = `E2E Chat-Actions ${Date.now()}`
    await notebooks.createNotebook(notebookTitle)
    const notebookId = await notebooks.soleNotebookId()
    await notebooks.openNotebook(notebookId)
    await page.waitForURL(`**/notebooks/${notebookId}`)

    const sources = new SourcesPanelPage(page)
    const chat = new ChatActionsPage(page)

    await sources.addTextSource(SOURCE_TITLE, SOURCE_TEXT)
    await sources.waitForReady(90_000)

    // Part A — the summary is generated in the WORKER right after the
    // ready-transition, not on page load; `use-notebook-summary-polling.ts`
    // is what surfaces it here without a manual reload. Generous timeout
    // covers the 15s cron tick plus a real Claude summarization call.
    await expect(chat.notebookSummary).toBeVisible({ timeout: 60_000 })
    const summaryText = await chat.notebookSummaryText.textContent()
    expect(summaryText?.trim().length ?? 0).toBeGreaterThan(0)

    // "Kopieren" on the summary quittiert sichtbar (a toast).
    await chat.summaryCopyButton.click()
    await chat.expectToast("In die Zwischenablage kopiert.")

    // "Als Notiz speichern" on the summary creates a note visible in Studio
    // (same page, Studio panel is unconditionally mounted on desktop).
    await chat.summarySaveNoteButton.click()
    await chat.expectToast("Notiz gespeichert.")
    await chat.expectNoteWithTitle("Notizbuch-Zusammenfassung")

    // A real question — actions + follow-ups only appear once the answer
    // has FULLY streamed in (never mid-stream, per the DoD).
    await chat.ask("Wie viel wiegt die Silberne Wanderdrossel?")
    await expect(chat.assistantMessages).toHaveCount(1, { timeout: 60_000 })
    const answer = chat.lastAssistantMessage()
    await expect(answer).toContainText("128", { timeout: 60_000 })

    await expect(answer.getByTestId("chat-message-actions")).toBeVisible()
    await expect(chat.followUpChips).toHaveCount(3, { timeout: 15_000 })

    // "Als Notiz speichern" on the answer creates a SECOND, distinctly
    // titled note (not the summary's).
    await answer.getByTestId("chat-message-save-note").click()
    await chat.expectToast("Notiz gespeichert.")
    await chat.expectNoteWithTitle("Notiz aus Chat")

    // Clicking a follow-up chip sends it as a new question immediately
    // (unlike the static empty-chat suggestions, which only fill the
    // input) — assert the exact chip text lands in the new user bubble.
    const followUpText = (await chat.followUpChips.first().textContent())?.trim()
    expect(followUpText?.length ?? 0).toBeGreaterThan(0)
    await chat.followUpChips.first().click()

    await expect(chat.userMessages).toHaveCount(2, { timeout: 10_000 })
    await expect(chat.lastUserMessage()).toHaveText(followUpText ?? "")

    await expect(chat.assistantMessages).toHaveCount(2, { timeout: 60_000 })
    const secondAnswer = chat.lastAssistantMessage()
    await expect(secondAnswer.getByTestId("chat-message-actions")).toBeVisible({
      timeout: 60_000,
    })

    // Older (first) answer no longer shows follow-up chips — "Ältere
    // Antworten zeigen keine."
    await expect(
      chat.assistantMessages.first().getByTestId("chat-followup-chip")
    ).toHaveCount(0)

    // Cleanup.
    await page.getByTestId("app-header-home-link").click()
    await page.waitForURL("**/notebooks")
    await notebooks.deleteNotebook(notebookId)
  })
})
