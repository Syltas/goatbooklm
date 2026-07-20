import { type Locator, type Page } from "@playwright/test"

/**
 * Page Object for the Chat-Panel on `/notebooks/[notebookId]`
 * (specs/03-chat-grounding.md) — every selector goes through `data-test`,
 * mirrors `e2e/sources/sources.po.ts`'s conventions.
 */
export class ChatPanelPage {
  constructor(private readonly page: Page) {}

  get input(): Locator {
    return this.page.getByTestId("chat-input")
  }

  get sendButton(): Locator {
    return this.page.getByTestId("chat-send")
  }

  get emptyHint(): Locator {
    return this.page.getByTestId("chat-empty-hint")
  }

  get suggestedChips(): Locator {
    return this.page.getByTestId("chat-suggested-question-chip")
  }

  get errorRetry(): Locator {
    return this.page.getByTestId("chat-error-retry")
  }

  get assistantMessages(): Locator {
    return this.page.locator('[data-test="chat-message"][data-role="assistant"]')
  }

  get citationPopover(): Locator {
    return this.page.getByTestId("citation-popover")
  }

  get citationPopoverOpenSource(): Locator {
    return this.page.getByTestId("citation-popover-open-source")
  }

  /** "Seite X · Absatz Y" locator line (Design-Review 2026-07-20 §Teil 1) —
   *  absent when it degrades to nothing (theoretical: neither page nor
   *  paragraph available), present as "Absatz Y" alone for a non-paginated
   *  source (text/web/note). */
  get citationPopoverLocator(): Locator {
    return this.page.getByTestId("citation-popover-locator")
  }

  get allMessages(): Locator {
    return this.page.getByTestId("chat-message")
  }

  get headerMenu(): Locator {
    return this.page.getByTestId("chat-header-menu")
  }

  get deleteHistoryMenuItem(): Locator {
    return this.page.getByTestId("chat-header-menu-delete-history")
  }

  get deleteHistoryDialog(): Locator {
    return this.page.getByTestId("delete-chat-history-dialog")
  }

  get deleteHistoryConfirm(): Locator {
    return this.page.getByTestId("delete-chat-history-confirm-button")
  }

  get deleteHistoryCancel(): Locator {
    return this.page.getByTestId("delete-chat-history-cancel-button")
  }

  lastAssistantMessage(): Locator {
    return this.assistantMessages.last()
  }

  async openHistoryDeleteDialog() {
    await this.headerMenu.click()
    await this.deleteHistoryMenuItem.click()
  }

  async ask(question: string) {
    await this.input.fill(question)
    await this.sendButton.click()
  }
}
