import { expect, type Locator, type Page } from "@playwright/test"

/**
 * Page Object for this feature's own additions to the Chat panel — the
 * empty-chat notebook summary (Part A) and the per-answer actions/follow-up
 * chips (Part B). Kept in a DEDICATED file, separate from
 * `e2e/chat/chat.po.ts`: that file (and its `chat.spec.ts`) belong to a
 * parallel agent reworking citation interaction, per this task's file-
 * ownership split — this PO only ever selects on `data-test` attributes this
 * feature itself introduced, never touching theirs.
 */
export class ChatActionsPage {
  constructor(private readonly page: Page) {}

  get input(): Locator {
    return this.page.getByTestId("chat-input")
  }

  get sendButton(): Locator {
    return this.page.getByTestId("chat-send")
  }

  get assistantMessages(): Locator {
    return this.page.locator('[data-test="chat-message"][data-role="assistant"]')
  }

  get userMessages(): Locator {
    return this.page.locator('[data-test="chat-message"][data-role="user"]')
  }

  lastAssistantMessage(): Locator {
    return this.assistantMessages.last()
  }

  lastUserMessage(): Locator {
    return this.userMessages.last()
  }

  get notebookSummary(): Locator {
    return this.page.getByTestId("chat-notebook-summary")
  }

  get notebookSummaryText(): Locator {
    return this.page.getByTestId("chat-notebook-summary-text")
  }

  get summarySaveNoteButton(): Locator {
    return this.page.getByTestId("chat-summary-save-note")
  }

  get summaryCopyButton(): Locator {
    return this.page.getByTestId("chat-summary-copy")
  }

  get followUpChips(): Locator {
    return this.page.getByTestId("chat-followup-chip")
  }

  async ask(question: string) {
    await this.input.fill(question)
    await this.sendButton.click()
  }

  /**
   * Waits for the Studio panel's note list to contain a title-input row
   * whose LIVE value equals `title`. `note-list-item.tsx` renders the title
   * as a controlled `<Input value="…">` — no text-node content, so
   * `getByText` can't find it, and (Playwright, unlike Testing Library, has
   * no `getByDisplayValue`) a plain CSS `input[value=...]` attribute
   * selector is unreliable here too: React updates the DOM `.value`
   * PROPERTY on a controlled input, not necessarily the HTML attribute a CSS
   * selector matches against. Reading `.value` via `evaluateAll` inside an
   * auto-retrying `expect(...).toPass()` sidesteps both problems — this is
   * the wait for "the note is now visible", not a Locator (there's no
   * evergreen single-element handle to return once the note might not exist
   * yet).
   */
  async expectNoteWithTitle(title: string, timeoutMs = 15_000): Promise<void> {
    const inputs = this.page.locator('[data-test^="note-title-input-"]')
    await expect(async () => {
      const values = await inputs.evaluateAll((elements) =>
        elements.map((element) => (element as HTMLInputElement).value)
      )
      expect(values).toContain(title)
    }).toPass({ timeout: timeoutMs })
  }

  /** Sonner toasts render as plain visible text in a portal — no dedicated
   *  `data-test` on them anywhere in this codebase yet, so a text locator is
   *  the simplest correct match. */
  async expectToast(text: string) {
    await expect(this.page.getByText(text).first()).toBeVisible({ timeout: 10_000 })
  }
}
