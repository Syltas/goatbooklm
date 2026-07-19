import { expect, test } from "@playwright/test"

import { NotebooksPage } from "../notebooks/notebooks.po"
import { SourcesPanelPage } from "../sources/sources.po"
import { ChatPanelPage } from "./chat.po"

// Must byte-match `NO_COVERAGE_MESSAGE` (`lib/chat/prompt.ts`) — duplicated
// as a literal (not imported) so this test also guards against an
// accidental drift between the two.
const NO_COVERAGE_MESSAGE = "Ihre Quellen enthalten dazu keine Informationen."

const SOURCE_TITLE = "E2E Chat-Quelle"
const SOURCE_TEXT =
  "Die Goldene Pampelmuse ist eine fiktive Trophäe aus einem Playwright-Testfixture. " +
  "Die Goldene Pampelmuse wiegt exakt 742 Gramm und besteht aus vergoldetem Messing. " +
  "Sie wird jährlich an das Team mit dem kreativsten Bugfix des Jahres verliehen."

test.describe("chat grounding end-to-end", () => {
  test("empty-notebook gate → grounded answer with citation → reader highlight", async ({
    page,
  }) => {
    // Real embedding calls (ingestion + query) and two real Claude calls —
    // generous budget on top of Playwright's own action timeouts.
    test.setTimeout(240_000)

    const notebooks = new NotebooksPage(page)
    await notebooks.goto()

    const notebookTitle = `E2E Chat ${Date.now()}`
    await notebooks.createNotebook(notebookTitle)
    const notebookId = await notebooks.soleNotebookId()
    await notebooks.openNotebook(notebookId)
    await page.waitForURL(`**/notebooks/${notebookId}`)

    const chat = new ChatPanelPage(page)
    const sources = new SourcesPanelPage(page)

    // AC-B1/AC-50 — 0 ready sources: input disabled + hint, no suggested
    // questions yet (those need ≥1 ready source).
    await expect(chat.emptyHint).toBeVisible()
    await expect(chat.input).toBeDisabled()
    await expect(chat.suggestedChips).toHaveCount(0)

    // Real ingestion pipeline (queue + worker + real OpenAI embedding) —
    // same path as e2e/sources/sources.spec.ts.
    await sources.addTextSource(SOURCE_TITLE, SOURCE_TEXT)
    await sources.waitForReady(90_000)

    // Input unlocks without a manual reload once the source is ready
    // (readyCount is derived from the same live-polled state the Sources
    // panel renders — see `notebook-detail-shell.tsx`).
    await expect(chat.input).toBeEnabled({ timeout: 15_000 })
    await expect(chat.suggestedChips.first()).toBeVisible()

    // AC-H1 — off-topic question against a single-topic source: no chunk
    // clears the similarity gate (Schicht 2), so the Anthropic call never
    // happens and the refusal is the deterministic gate constant, byte-exact
    // (not a paraphrase).
    await chat.ask("Wer ist der aktuelle Bundeskanzler von Deutschland?")
    await expect(chat.assistantMessages).toHaveCount(1, { timeout: 30_000 })
    const refusal = chat.lastAssistantMessage()
    await expect(refusal).toHaveText(NO_COVERAGE_MESSAGE)
    await expect(refusal.getByTestId("citation-chip")).toHaveCount(0)
    await expect(refusal.getByTestId("ungrounded-badge")).toHaveCount(0)

    // On-topic question — real Claude call, grounded in the fixture text
    // (AC-H1's counterpart: the same single source, but now on-topic).
    await chat.ask("Wie viel wiegt die Goldene Pampelmuse?")
    await expect(chat.assistantMessages).toHaveCount(2, { timeout: 60_000 })
    const answer = chat.lastAssistantMessage()
    await expect(answer).toContainText("742", { timeout: 60_000 })
    await expect(answer.getByTestId("citation-chip").first()).toBeVisible()

    // §7 Popover-first Highlight-Bridge (AC-45/AC-G1/AC-G2/AC-H5-light):
    // chip click opens the popover with the cited passage, NOT the reader
    // directly.
    const chip = answer.getByTestId("citation-chip").first()
    await chip.click()
    await expect(chat.citationPopover).toBeVisible()
    await expect(chat.citationPopover).toContainText(SOURCE_TITLE)
    await expect(chat.citationPopover).toContainText("742")

    // "Quelle anzeigen" opens the Reader-Mode in the (already-visible,
    // desktop) Sources-Panel and highlights the cited passage.
    await chat.citationPopoverOpenSource.click()
    await expect(sources.readerContent).toBeVisible()
    const highlight = page.getByTestId("source-reader-highlight")
    await expect(highlight).toBeVisible()
    await expect(highlight).toContainText("742")

    // Cleanup.
    await page.getByTestId("app-header-home-link").click()
    await page.waitForURL("**/notebooks")
    await notebooks.deleteNotebook(notebookId)
  })
})
