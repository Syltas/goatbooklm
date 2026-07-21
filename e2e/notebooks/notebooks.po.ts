import { expect, type Locator, type Page } from "@playwright/test"

/**
 * Page Object for `/notebooks`. Every selector goes through `data-test`
 * (`testIdAttribute` configured in playwright.config.ts) — no role/text
 * queries, per the E2E task constraint. Per-notebook elements are keyed by
 * the notebook's real id (`notebook-card-{id}`, `notebook-card-menu-{id}`,
 * …); `soleNotebookId()` recovers that id from the DOM after creation
 * instead of hardcoding it, since the id is server-generated.
 */
export class NotebooksPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/notebooks")
    await this.page.waitForLoadState("networkidle")
  }

  get emptyCreateTile(): Locator {
    return this.page.getByTestId("notebooks-empty-cta")
  }

  get createButton(): Locator {
    return this.page.getByTestId("notebooks-create-button")
  }

  get formDialog(): Locator {
    return this.page.getByTestId("notebook-form-dialog")
  }

  get titleInput(): Locator {
    return this.page.getByTestId("notebook-form-title-input")
  }

  get descriptionInput(): Locator {
    return this.page.getByTestId("notebook-form-description-input")
  }

  get submitButton(): Locator {
    return this.page.getByTestId("notebook-form-submit-button")
  }

  get deleteDialog(): Locator {
    return this.page.getByTestId("delete-notebook-dialog")
  }

  get deleteConfirmButton(): Locator {
    return this.page.getByTestId("delete-notebook-confirm-button")
  }

  get deleteCancelButton(): Locator {
    return this.page.getByTestId("delete-notebook-cancel-button")
  }

  get cardLinks(): Locator {
    return this.page.locator('[data-test^="notebook-card-link-"]')
  }

  cardLink(id: string): Locator {
    return this.page.getByTestId(`notebook-card-link-${id}`)
  }

  card(id: string): Locator {
    return this.page.getByTestId(`notebook-card-${id}`)
  }

  /** The card's visible title text — NOT the invisible stretched `<Link>`
   *  that covers the whole card. Used to prove clicks on the card's real
   *  content navigate (F1: stretched-link z-order regression guard). */
  cardTitle(id: string): Locator {
    return this.page.getByTestId(`notebook-card-title-${id}`)
  }

  menuTrigger(id: string): Locator {
    return this.page.getByTestId(`notebook-card-menu-${id}`)
  }

  editMenuItem(id: string): Locator {
    return this.page.getByTestId(`notebook-card-edit-${id}`)
  }

  deleteMenuItem(id: string): Locator {
    return this.page.getByTestId(`notebook-card-delete-${id}`)
  }

  async createNotebook(title: string, description?: string) {
    await this.emptyCreateTile.click()
    await expect(this.formDialog).toBeVisible()
    await this.titleInput.fill(title)
    if (description) {
      await this.descriptionInput.fill(description)
    }
    await this.submitButton.click()
    await expect(this.formDialog).toBeHidden()
  }

  /** Recovers the id of the single notebook currently in the grid. */
  async soleNotebookId(): Promise<string> {
    await expect(this.cardLinks).toHaveCount(1)
    const testId = await this.cardLinks.first().getAttribute("data-test")
    if (!testId) {
      throw new Error("notebook card link is missing its data-test attribute")
    }
    return testId.replace("notebook-card-link-", "")
  }

  /** Titel-basierter Lookup — robust gegen Leichen-Notebooks aus zuvor
   *  fehlgeschlagenen Specs desselben Laufs (der Test-User wird erst im
   *  global-teardown geräumt). */
  async notebookIdByTitle(title: string): Promise<string> {
    const link = this.cardLinks.filter({ hasText: title }).first()
    await expect(link).toBeVisible()
    const testId = await link.getAttribute("data-test")
    if (!testId) {
      throw new Error("notebook card link is missing its data-test attribute")
    }
    return testId.replace("notebook-card-link-", "")
  }

  async openNotebook(id: string) {
    await this.cardLink(id).click()
  }

  async renameNotebook(id: string, newTitle: string) {
    await this.menuTrigger(id).click()
    await this.editMenuItem(id).click()
    await expect(this.formDialog).toBeVisible()
    await this.titleInput.fill(newTitle)
    await this.submitButton.click()
    await expect(this.formDialog).toBeHidden()
  }

  async deleteNotebook(id: string) {
    await this.menuTrigger(id).click()
    await this.deleteMenuItem(id).click()
    await expect(this.deleteDialog).toBeVisible()
    await this.deleteConfirmButton.click()
    await expect(this.deleteDialog).toBeHidden()
  }
}

/** Page Object for `/notebooks/[notebookId]` (the 3-panel detail shell). */
export class NotebookDetailPage {
  constructor(private readonly page: Page) {}

  get sourcesPanelCollapse(): Locator {
    return this.page.getByTestId("sources-panel-collapse")
  }

  get chatPanelCollapse(): Locator {
    return this.page.getByTestId("chat-panel-collapse")
  }

  get studioPanelCollapse(): Locator {
    return this.page.getByTestId("studio-panel-collapse")
  }

  async expectThreePanelsVisible() {
    await expect(this.sourcesPanelCollapse).toBeVisible()
    await expect(this.chatPanelCollapse).toBeVisible()
    await expect(this.studioPanelCollapse).toBeVisible()
  }
}
