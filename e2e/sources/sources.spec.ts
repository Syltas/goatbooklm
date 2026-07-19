import { expect, test } from "@playwright/test"

import { NotebooksPage } from "../notebooks/notebooks.po"
import { SourcesPanelPage } from "./sources.po"

const SOURCE_TITLE = "E2E Textquelle"
const SOURCE_TEXT =
  "Dies ist ein kurzer Testtext für die Ingestion-Pipeline. Er passt in " +
  "einen einzigen Chunk und sollte nach der asynchronen Verarbeitung " +
  "(Queue + Worker + echtes Embedding) als „Bereit“ markiert werden."

test.describe("source ingestion end-to-end", () => {
  test("add text source → queue+worker processes it → reader → delete", async ({
    page,
  }) => {
    const notebooks = new NotebooksPage(page)
    await notebooks.goto()

    const notebookTitle = `E2E Ingestion ${Date.now()}`
    await notebooks.createNotebook(notebookTitle)
    const notebookId = await notebooks.soleNotebookId()
    await notebooks.openNotebook(notebookId)
    await page.waitForURL(`**/notebooks/${notebookId}`)

    const sources = new SourcesPanelPage(page)

    // Fresh notebook — Listen-Mode empty state (AC-53).
    await expect(sources.emptyCta).toBeVisible()

    // Fastest real path through the full ingestion contract: Text-Tab
    // (AC-12) skips PDF-Storage-upload/Web-fetch entirely, but still goes
    // through the SAME queue+worker pipeline (AC-47/AC-48) as PDF/Web —
    // addTextSourceAction enqueues a job, the pg_cron-triggered worker
    // (this app must be reachable on :3100, see playwright.config.ts)
    // dequeues it, chunks the text, calls the real OpenAI embeddings API,
    // and persists chunks + `status='ready'`.
    await sources.addTextSource(SOURCE_TITLE, SOURCE_TEXT)

    // The new source is visible immediately (optimistic local update from
    // addTextSourceAction's returned row) in a non-final state.
    await expect(page.getByText(SOURCE_TITLE)).toBeVisible()
    await expect(sources.sourceRows).toHaveCount(1)

    // Cron tick interval (15s) + a real embedding call — generous timeout.
    await sources.waitForReady(90_000)
    await expect(sources.statusBadge).toContainText("1 Chunk")

    // Reader-Mode (AC-50): click the row → full text, back arrow (AC-51)
    // returns to Listen-Mode without altering the list.
    await sources.sourceRows.first().click()
    await expect(sources.readerContent).toBeVisible()
    await expect(sources.readerContent).toContainText("Testtext")
    await sources.readerBack.click()
    await expect(sources.readerContent).toBeHidden()
    await expect(sources.sourceRows).toHaveCount(1)

    // Delete with confirm (AC-33) — cancel path already covered by the
    // notebooks smoke spec's equivalent dialog; here the destructive path
    // matters (proves cascade delete + list update).
    await sources.deleteButton.click()
    await expect(sources.deleteDialog).toBeVisible()
    await sources.deleteConfirmButton.click()
    await expect(sources.deleteDialog).toBeHidden()
    await expect(sources.emptyCta).toBeVisible()

    // Cleanup: remove the notebook this test created.
    await page.getByTestId("app-header-home-link").click()
    await page.waitForURL("**/notebooks")
    await notebooks.deleteNotebook(notebookId)
  })
})
