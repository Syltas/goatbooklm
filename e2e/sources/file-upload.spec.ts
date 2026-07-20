import { expect, test } from "@playwright/test"

import { buildMinimalPdf } from "../support/pdf-fixture"
import { NotebooksPage } from "../notebooks/notebooks.po"
import { SourcesPanelPage } from "./sources.po"

/**
 * End-to-end coverage for the non-PDF formats. PDF was the only format the
 * pipeline accepted, and it was hard-coded into nine separate places — this
 * proves a completely different format now traverses the same
 * create → upload → queue → worker → extract → embed → ready path, with the
 * real queue and real OpenAI embeddings behind it.
 */
test.describe("multi-format upload", () => {
  test("a .txt file ingests to ready and its text is readable in the reader", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const notebooks = new NotebooksPage(page)
    await notebooks.goto()

    const notebookTitle = `E2E TXT ${Date.now()}`
    await notebooks.createNotebook(notebookTitle)
    const notebookId = await notebooks.soleNotebookId()
    await notebooks.openNotebook(notebookId)
    await page.waitForURL(`**/notebooks/${notebookId}`)

    const sources = new SourcesPanelPage(page)
    await sources.emptyCta.click()
    await expect(sources.dialog).toBeVisible()
    await sources.fileTab.click()

    const body =
      "Projektnotiz Legienhof. Die Sanierung des Ostflügels wird auf das dritte Quartal 2026 verschoben, weil die Fensterelemente verspätet geliefert werden."

    await sources.fileInput.setInputFiles({
      name: "Projektnotiz.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(body, "utf8"),
    })

    // The title strips the .txt extension — the old strip was `/\.pdf$/i`
    // and would have left "Projektnotiz.txt" as the title.
    await expect(sources.fileTitleInput).toHaveValue("Projektnotiz")

    await sources.fileSubmit.click()
    await expect(sources.dialog).toBeHidden()

    await sources.waitForReadyTitle("Projektnotiz", 90_000)

    // Reader shows the extracted text — for .txt that is the file verbatim.
    await sources.rowForTitle("Projektnotiz").click()
    await expect(sources.readerContent).toContainText("Ostflügels")

    await sources.readerBack.click()
    await page.getByTestId("app-header-home-link").click()
    await page.waitForURL("**/notebooks")
    await notebooks.deleteNotebook(notebookId)
  })

  test("a video is refused by name rather than as a generic unsupported type", async ({
    page,
  }) => {
    const notebooks = new NotebooksPage(page)
    await notebooks.goto()

    const notebookTitle = `E2E Video ${Date.now()}`
    await notebooks.createNotebook(notebookTitle)
    const notebookId = await notebooks.soleNotebookId()
    await notebooks.openNotebook(notebookId)
    await page.waitForURL(`**/notebooks/${notebookId}`)

    const sources = new SourcesPanelPage(page)
    await sources.emptyCta.click()
    await sources.fileTab.click()

    await sources.fileInput.setInputFiles({
      name: "aufnahme.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]),
    })

    // "Videos werden nicht unterstützt" — not "Dateityp nicht erlaubt". A
    // user who picked a video deliberately needs to know it is out of scope,
    // not that something went wrong with their file.
    await expect(sources.validationError).toContainText("Videos werden nicht unterstützt")
    // Rejected client-side: no row was created.
    await expect(sources.sourceRows).toHaveCount(0)

    await page.locator('[data-slot="dialog-close"]').first().click()
    await page.getByTestId("app-header-home-link").click()
    await page.waitForURL("**/notebooks")
    await notebooks.deleteNotebook(notebookId)
  })
})

/**
 * E2E coverage for the multi-PDF-upload + content-hash-dedupe feature. The
 * real incident this feature responds to (see task brief): two sources in
 * one notebook silently held byte-identical PDFs under two different
 * titles because (a) the title field stuck across a file switch in the
 * open dialog, and (b) nothing ever compared the actual file content.
 * Both fixes are covered here.
 */
test.describe("PDF upload: multi-file + content-hash dedupe", () => {
  test("title follows the selected file until the user edits it by hand (sticky-title bug fix)", async ({
    page,
  }) => {
    const notebooks = new NotebooksPage(page)
    await notebooks.goto()

    const notebookTitle = `E2E PDF Title ${Date.now()}`
    await notebooks.createNotebook(notebookTitle)
    const notebookId = await notebooks.soleNotebookId()
    await notebooks.openNotebook(notebookId)
    await page.waitForURL(`**/notebooks/${notebookId}`)

    const sources = new SourcesPanelPage(page)
    await sources.emptyCta.click()
    await expect(sources.dialog).toBeVisible()
    await sources.fileTab.click()

    const fileA = buildMinimalPdf("Briefing VZUG Inhalt")
    const fileB = buildMinimalPdf("Briefing Legienhof Inhalt")

    // Pick file A — title auto-fills from its name.
    await sources.fileInput.setInputFiles({
      name: "Briefing-VZUG-16.07.pdf",
      mimeType: "application/pdf",
      buffer: fileA,
    })
    await expect(sources.fileTitleInput).toHaveValue("Briefing-VZUG-16.07")

    // Switch to file B WITHOUT editing the title by hand — this is the
    // exact real-world incident: the title used to stick on "A"'s name
    // while the bytes underneath were already B's. It must now follow B.
    await sources.fileInput.setInputFiles({
      name: "Briefing-Legienhof-16.07.pdf",
      mimeType: "application/pdf",
      buffer: fileB,
    })
    await expect(sources.fileTitleInput).toHaveValue("Briefing-Legienhof-16.07")

    // Now edit the title BY HAND, then switch files again — the manual
    // edit must survive this time (titleTouched).
    await sources.fileTitleInput.fill("Mein eigener Titel")
    await sources.fileInput.setInputFiles({
      name: "Briefing-VZUG-16.07.pdf",
      mimeType: "application/pdf",
      buffer: fileA,
    })
    await expect(sources.fileTitleInput).toHaveValue("Mein eigener Titel")

    // Cleanup — close without submitting, delete the scratch notebook.
    await page.locator('[data-slot="dialog-close"]').first().click()
    await expect(sources.dialog).toBeHidden()
    await page.getByTestId("app-header-home-link").click()
    await page.waitForURL("**/notebooks")
    await notebooks.deleteNotebook(notebookId)
  })

  test("multiple PDFs become independent ready sources; re-uploading identical content is rejected naming the existing source", async ({
    page,
  }) => {
    // Two real queue+worker+OpenAI-embedding round trips (one per file) —
    // generous budget, same reasoning as playwright.config.ts's own
    // 120s-per-test floor for a single one.
    test.setTimeout(180_000)

    const notebooks = new NotebooksPage(page)
    await notebooks.goto()

    const notebookTitle = `E2E PDF Multi ${Date.now()}`
    await notebooks.createNotebook(notebookTitle)
    const notebookId = await notebooks.soleNotebookId()
    await notebooks.openNotebook(notebookId)
    await page.waitForURL(`**/notebooks/${notebookId}`)

    const sources = new SourcesPanelPage(page)
    await expect(sources.emptyCta).toBeVisible()
    await sources.emptyCta.click()
    await expect(sources.dialog).toBeVisible()
    await sources.fileTab.click()

    const alphaBytes = buildMinimalPdf(`Alpha Inhalt ${Date.now()}`)
    const betaBytes = buildMinimalPdf(`Beta Inhalt ${Date.now()}`)

    // Task 1: the drop-zone/file-input accept 2+ files in one selection.
    await sources.fileInput.setInputFiles([
      { name: "Alpha.pdf", mimeType: "application/pdf", buffer: alphaBytes },
      { name: "Beta.pdf", mimeType: "application/pdf", buffer: betaBytes },
    ])

    // Task 2: 2+ files replace the editable title field with a per-file
    // filename list.
    await expect(sources.fileTitleInput).toHaveCount(0)
    await expect(sources.fileList).toBeVisible()
    await expect(sources.fileList).toContainText("Alpha")
    await expect(sources.fileList).toContainText("Beta")

    await sources.fileSubmit.click()
    await expect(sources.dialog).toBeHidden()

    // Task 4: each file became its own source row with its own
    // filename-derived title — not one shared/merged source.
    await expect(sources.sourceRows).toHaveCount(2)
    await expect(page.getByText("Alpha", { exact: true })).toBeVisible()
    await expect(page.getByText("Beta", { exact: true })).toBeVisible()

    // Real queue + worker + real OpenAI embeddings for BOTH independent
    // jobs — proves task 4's "one row + one job per file" end to end.
    await sources.waitForReadyTitle("Alpha", 90_000)
    await sources.waitForReadyTitle("Beta", 90_000)

    // Task 5: uploading a file with IDENTICAL bytes to "Alpha" again (same
    // notebook) is rejected, naming "Alpha" specifically — the exact piece
    // of information that would have caught the real incident immediately.
    // The dedupe pre-check runs at create time (before any Storage upload
    // or enqueue), so no extra processing wait is needed here.
    await sources.addButton.click()
    await expect(sources.dialog).toBeVisible()
    await sources.fileTab.click()
    await sources.fileInput.setInputFiles({
      name: "Alpha-Duplikat.pdf",
      mimeType: "application/pdf",
      buffer: alphaBytes,
    })
    await sources.fileSubmit.click()

    await expect(sources.fileError).toBeVisible()
    await expect(sources.fileError).toContainText("Alpha")
    // Rejected, not a generic failure — the dialog stays open (task 4) and
    // no third source row was created.
    await expect(sources.dialog).toBeVisible()
    await expect(sources.sourceRows).toHaveCount(2)

    await page.locator('[data-slot="dialog-close"]').first().click()
    await expect(sources.dialog).toBeHidden()

    await page.getByTestId("app-header-home-link").click()
    await page.waitForURL("**/notebooks")
    await notebooks.deleteNotebook(notebookId)
  })
})
