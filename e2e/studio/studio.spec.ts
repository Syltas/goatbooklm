import { expect, test } from "@playwright/test"

import { NotebooksPage } from "../notebooks/notebooks.po"
import { SourcesPanelPage } from "../sources/sources.po"
import { StudioPanelPage } from "./studio.po"

const SOURCE_TITLE = "E2E Studio-Quelle"
const SOURCE_TEXT =
  "Die Silberne Zitruspresse ist ein fiktives Werkzeug aus einem Playwright-Testfixture. " +
  "Die Silberne Zitruspresse wurde 1987 in Flensburg erfunden und presst exakt 31 Zitronen pro Minute. " +
  "Sie gilt als Meilenstein der fiktiven Küchengeräteforschung."

test.describe("studio reports end-to-end", () => {
  test("Report → Flashcards → Quiz: erstellen, ansehen, interagieren", async ({
    page,
  }) => {
    // Reale Ingestion (Embedding) + drei reale Claude-Calls (Report,
    // Flashcards, Quiz) — gleiche Budget-Logik wie e2e/chat/chat.spec.ts.
    test.setTimeout(600_000)

    const notebooks = new NotebooksPage(page)
    await notebooks.goto()

    const notebookTitle = `E2E Studio ${Date.now()}`
    await notebooks.createNotebook(notebookTitle)
    const notebookId = await notebooks.notebookIdByTitle(notebookTitle)
    await notebooks.openNotebook(notebookId)
    await page.waitForURL(`**/notebooks/${notebookId}`)

    const sources = new SourcesPanelPage(page)
    const studio = new StudioPanelPage(page)

    // Leerer Zustand: Kacheln sichtbar, noch keine Artefakte.
    await expect(studio.createTile("report")).toBeVisible()
    await expect(studio.createTile("flashcards")).toBeVisible()
    await expect(studio.createTile("quiz")).toBeVisible()
    await expect(studio.artifactRows).toHaveCount(0)

    // Ohne ready-Quelle ist Erstellen disabled (Spec: Route würde 422en,
    // die UI lässt es gar nicht erst zu).
    await studio.createTile("report").click()
    await expect(studio.createDialog).toBeVisible()
    await expect(studio.createSubmit).toBeDisabled()
    await page.keyboard.press("Escape")

    // Reale Ingestion-Pipeline — gleicher Pfad wie sources.spec.ts.
    await sources.addTextSource(SOURCE_TITLE, SOURCE_TEXT)
    await sources.waitForReady(90_000)

    // Report starten → Live-Viewer streamt (echter Claude-Call).
    await studio.startReport("briefing_doc")
    await expect(studio.viewerBody).toContainText("Zitruspresse", {
      timeout: 120_000,
    })

    // Nach Stream-Ende wechselt das Panel in den persistierten Viewer —
    // erkennbar am Kebab-Menü, das es nur dort gibt (`after()`-Persist der
    // Route + 2s-Poll des Panels).
    await expect(studio.viewerMenu).toBeVisible({ timeout: 60_000 })
    await expect(studio.viewerTitle).not.toHaveText("")

    // Zurück zur Liste: genau eine ready-Row.
    await studio.viewerBack.click()
    await expect(studio.artifactRows).toHaveCount(1)
    const row = studio.artifactRows.first()

    // Umbenennen über das Row-Kebab.
    await studio.openRowMenu(row)
    await page.getByTestId("artifact-menu-rename").click()
    await expect(studio.renameDialog).toBeVisible()
    await studio.renameInput.fill("Mein Testbericht")
    await studio.renameSave.click()
    await expect(studio.renameDialog).not.toBeVisible()
    await expect(row).toContainText("Mein Testbericht")

    // Row öffnet den Viewer mit dem neuen Titel + Inhalt.
    await row.click()
    await expect(studio.viewer).toBeVisible()
    await expect(studio.viewerTitle).toHaveText("Mein Testbericht")
    await expect(studio.viewerBody).toContainText("Zitruspresse")
    await studio.viewerBack.click()

    // Löschen mit Confirm-Dialog (CLAUDE.md: destruktiv ⇒ Dialog).
    await studio.openRowMenu(row)
    await page.getByTestId("artifact-menu-delete").click()
    await expect(studio.deleteDialog).toBeVisible()
    await studio.deleteConfirm.click()
    await expect(studio.artifactRows).toHaveCount(0)

    // ---------------------------------------------------------------------
    // Flashcards: Quellen-Auswahl → Objekt-Generierung (202 + Poll) →
    // Viewer öffnet automatisch, sobald die Row `ready` ist.
    // ---------------------------------------------------------------------
    await studio.startArtifact("flashcards")
    const flashcards = page.getByTestId("flashcards-viewer")
    await expect(flashcards).toBeVisible({ timeout: 180_000 })
    await expect(page.getByTestId("flashcard-counter")).toContainText("1 /")

    // Flip: Vorderseite → Rückseite (Explain-Button nur auf der Rückseite).
    await page.getByTestId("flashcard").click()
    await expect(page.getByTestId("flashcard")).toHaveAttribute("data-flipped", "")

    // Explain-Bridge: Prompt landet als User-Turn im Chat (Desktop: Chat-
    // Panel ist daneben sichtbar; die optimistische Bubble erscheint sofort).
    await page.getByTestId("flashcard-explain").click()
    await expect(
      page.locator('[data-test="chat-message"][data-role="user"]').last()
    ).toContainText("Karteikarten")

    // ✓-Zähler + Weiter-Navigation.
    await page.getByTestId("flashcards-mark-right").click()
    await expect(page.getByTestId("flashcards-mark-right")).toContainText("1")
    await page.getByTestId("flashcards-viewer-back").click()

    // ---------------------------------------------------------------------
    // Quiz: Hint-Toggle vor der Antwort, Feedback + Erklärungen danach.
    // ---------------------------------------------------------------------
    await studio.startArtifact("quiz")
    const quiz = page.getByTestId("quiz-viewer")
    await expect(quiz).toBeVisible({ timeout: 180_000 })
    await expect(page.getByTestId("quiz-counter")).toContainText("1 /")

    await page.getByTestId("quiz-hint-toggle").click()
    await expect(page.getByTestId("quiz-hint")).toBeVisible()

    // Antworten: irgendeine Option — danach ist die richtige grün markiert
    // und JEDE Option trägt ihre Erklärung.
    await page.getByTestId("quiz-option-0").click()
    await expect(page.locator("[data-test^='quiz-option-'][data-correct]")).toHaveCount(1)
    await expect(
      page.getByTestId("quiz-feedback-correct").or(page.getByTestId("quiz-feedback-wrong")).first()
    ).toBeVisible()

    // Navigation: Weiter → Frage 2.
    await page.getByTestId("quiz-next").click()
    await expect(page.getByTestId("quiz-counter")).toContainText("2 /")
    await page.getByTestId("quiz-viewer-back").click()

    // Beide Artefakte in der Liste (Report wurde oben gelöscht).
    await expect(studio.artifactRows).toHaveCount(2)
  })
})
