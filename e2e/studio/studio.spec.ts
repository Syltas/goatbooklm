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
  test("Report erstellen → streamt → persistiert → umbenennen → löschen", async ({
    page,
  }) => {
    // Reale Ingestion (Embedding) + ein realer Claude-Call für den Report —
    // gleiche Budget-Logik wie e2e/chat/chat.spec.ts.
    test.setTimeout(300_000)

    const notebooks = new NotebooksPage(page)
    await notebooks.goto()

    const notebookTitle = `E2E Studio ${Date.now()}`
    await notebooks.createNotebook(notebookTitle)
    const notebookId = await notebooks.soleNotebookId()
    await notebooks.openNotebook(notebookId)
    await page.waitForURL(`**/notebooks/${notebookId}`)

    const sources = new SourcesPanelPage(page)
    const studio = new StudioPanelPage(page)

    // Leerer Zustand: Kachel sichtbar, noch keine Berichte.
    await expect(studio.createReportTile).toBeVisible()
    await expect(studio.artifactRows).toHaveCount(0)

    // Ohne ready-Quelle sind die Format-Karten disabled (Spec: Route würde
    // 422en, die UI lässt es gar nicht erst zu).
    await studio.createReportTile.click()
    await expect(studio.createDialog).toBeVisible()
    await expect(studio.formatCard("briefing_doc")).toBeDisabled()
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
  })
})
