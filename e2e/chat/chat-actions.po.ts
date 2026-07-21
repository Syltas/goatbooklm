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
   * Waits for the Studio panel's note list to contain a title row whose text
   * equals `title`. `note-list-item.tsx` renders the title as a static
   * `<p data-test="note-title-<id>">` (kebab-menu parity rework,
   * specs-v2-fixes-2.md §6 — it used to be a controlled `<Input>` that saved
   * on blur; rename now goes through `RenameNoteDialog` instead, same as
   * artifact rows). Reading `.textContent` via `evaluateAll` inside an
   * auto-retrying `expect(...).toPass()` is the wait for "the note is now
   * visible" — not a Locator, since there's no evergreen single-element
   * handle to return once the note might not exist yet.
   */
  async expectNoteWithTitle(title: string, timeoutMs = 15_000): Promise<void> {
    const titles = this.page.locator('[data-test^="note-title-"]')
    await expect(async () => {
      const values = await titles.evaluateAll((elements) =>
        elements.map((element) => element.textContent?.trim() ?? "")
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
