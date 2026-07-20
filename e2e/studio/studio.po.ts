import { expect, type Locator, type Page } from "@playwright/test"

import type { ReportFormat } from "@/lib/studio/schema"

/**
 * Page Object für das Studio-Panel auf `/notebooks/[notebookId]`
 * (docs/specs/studio-quick-wins.md). Alle Selektoren via `data-test`,
 * Konventionen wie `e2e/sources/sources.po.ts`.
 */
export class StudioPanelPage {
  constructor(private readonly page: Page) {}

  get panel(): Locator {
    return this.page.getByTestId("studio-panel")
  }

  createTile(type: "report" | "flashcards" | "quiz"): Locator {
    return this.page.getByTestId(`studio-create-${type}-tile`)
  }

  get createDialog(): Locator {
    return this.page.getByTestId("create-artifact-dialog")
  }

  formatCard(format: ReportFormat): Locator {
    return this.page.getByTestId(`create-report-format-${format}`)
  }

  get createSubmit(): Locator {
    return this.page.getByTestId("create-artifact-submit")
  }

  get sourceCheckboxes(): Locator {
    return this.page.locator('[data-test^="source-picker-checkbox-"]')
  }

  get viewer(): Locator {
    return this.page.getByTestId("report-viewer")
  }

  get viewerTitle(): Locator {
    return this.page.getByTestId("report-viewer-title")
  }

  get viewerBody(): Locator {
    return this.page.getByTestId("report-viewer-body")
  }

  get viewerBack(): Locator {
    return this.page.getByTestId("report-viewer-back")
  }

  get viewerCopy(): Locator {
    return this.page.getByTestId("report-viewer-copy")
  }

  /** Kebab im persistierten Viewer — Sichtbarkeit = Persistenz angekommen. */
  get viewerMenu(): Locator {
    return this.viewer.locator('[data-test^="artifact-menu-"]')
  }

  get artifactRows(): Locator {
    return this.page.locator('[data-test^="artifact-row-"]')
  }

  get renameDialog(): Locator {
    return this.page.getByTestId("rename-artifact-dialog")
  }

  get renameInput(): Locator {
    return this.page.getByTestId("rename-artifact-input")
  }

  get renameSave(): Locator {
    return this.page.getByTestId("rename-artifact-save")
  }

  get deleteDialog(): Locator {
    return this.page.getByTestId("delete-artifact-dialog")
  }

  get deleteConfirm(): Locator {
    return this.page.getByTestId("delete-artifact-confirm")
  }

  async startReport(format: ReportFormat) {
    await this.createTile("report").click()
    await expect(this.createDialog).toBeVisible()
    await this.formatCard(format).click()
    await this.createSubmit.click()
    await expect(this.viewer).toBeVisible()
  }

  async startArtifact(type: "flashcards" | "quiz") {
    await this.createTile(type).click()
    await expect(this.createDialog).toBeVisible()
    await expect(this.sourceCheckboxes.first()).toBeChecked()
    await this.createSubmit.click()
    await expect(this.createDialog).not.toBeVisible()
  }

  async openRowMenu(row: Locator) {
    await row.locator('[data-test^="artifact-menu-"]').click()
  }
}
