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

  lastAssistantMessage(): Locator {
    return this.assistantMessages.last()
  }

  async ask(question: string) {
    await this.input.fill(question)
    await this.sendButton.click()
  }
}
