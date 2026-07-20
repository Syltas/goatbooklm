import { expect, type Locator, type Page } from "@playwright/test"

/**
 * Page Object for the Sources-Panel on `/notebooks/[notebookId]`
 * (specs/02-ingestion.md). Every selector goes through `data-test`, per
 * the E2E task constraint — mirrors `e2e/notebooks/notebooks.po.ts`'s
 * conventions.
 */
export class SourcesPanelPage {
  constructor(private readonly page: Page) {}

  get addButton(): Locator {
    return this.page.getByTestId("sources-add-button")
  }

  get emptyCta(): Locator {
    return this.page.getByTestId("sources-empty-cta")
  }

  get dialog(): Locator {
    return this.page.getByTestId("add-source-dialog")
  }

  get textTab(): Locator {
    return this.page.getByTestId("add-source-tab-text")
  }

  get fileTab(): Locator {
    return this.page.getByTestId("add-source-tab-file")
  }

  get fileInput(): Locator {
    return this.page.getByTestId("file-upload-file-input")
  }

  get fileTitleInput(): Locator {
    return this.page.getByTestId("file-upload-title-input")
  }

  get fileSummary(): Locator {
    return this.page.getByTestId("file-upload-file-summary")
  }

  get fileList(): Locator {
    return this.page.getByTestId("file-upload-file-list")
  }

  get fileSubmit(): Locator {
    return this.page.getByTestId("file-upload-submit")
  }

  /** Client-side pre-validation message (unsupported type, video, per-format
   *  size cap) — distinct from `fileError`, which shows a *server* rejection
   *  such as a dedupe hit. */
  get validationError(): Locator {
    return this.page.getByTestId("file-upload-validation-error")
  }

  get fileError(): Locator {
    return this.page.getByTestId("file-upload-error")
  }

  get textTitleInput(): Locator {
    return this.page.getByTestId("text-source-title-input")
  }

  get textTextarea(): Locator {
    return this.page.getByTestId("text-source-textarea")
  }

  get textSubmit(): Locator {
    return this.page.getByTestId("text-source-submit")
  }

  get statusBadge(): Locator {
    return this.page.getByTestId("source-status-badge")
  }

  get sourceRows(): Locator {
    return this.page.locator('[data-test^="source-row-"]')
  }

  get readerBack(): Locator {
    return this.page.getByTestId("source-reader-back")
  }

  get readerContent(): Locator {
    return this.page.getByTestId("source-reader-content")
  }

  get deleteButton(): Locator {
    return this.page.getByTestId("source-delete-button")
  }

  get deleteDialog(): Locator {
    return this.page.getByTestId("delete-source-dialog")
  }

  get deleteConfirmButton(): Locator {
    return this.page.getByTestId("delete-source-confirm-button")
  }

  async addTextSource(title: string, text: string) {
    await this.emptyCta.click()
    await expect(this.dialog).toBeVisible()
    await this.textTab.click()
    await this.textTitleInput.fill(title)
    await this.textTextarea.fill(text)
    await expect(this.textSubmit).toBeEnabled()
    await this.textSubmit.click()
    await expect(this.dialog).toBeHidden()
  }

  /** Waits for the (single) source row to reach `status='ready'`
   *  (§6 badge text "Bereit · N Chunks") — the cron tick (15s) + a real
   *  OpenAI embedding call both need to land within `timeoutMs`. */
  async waitForReady(timeoutMs: number) {
    await expect(this.statusBadge).toContainText("Bereit", { timeout: timeoutMs })
  }

  /** Row-scoped lookup by visible title — needed once the panel holds more
   *  than one source (multi-PDF upload) and a single shared `statusBadge`
   *  locator would be ambiguous. */
  rowForTitle(title: string): Locator {
    return this.page.locator('[data-test^="source-row-"]', { hasText: title })
  }

  /** Same as `waitForReady`, but scoped to the row whose title matches
   *  `title` — for asserting on ONE of several PDF sources by name. */
  async waitForReadyTitle(title: string, timeoutMs: number) {
    await expect(this.rowForTitle(title).getByTestId("source-status-badge")).toContainText(
      "Bereit",
      { timeout: timeoutMs }
    )
  }
}
