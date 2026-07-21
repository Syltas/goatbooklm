# Spec v2 — Fixes Runde 2 (Polish, localhost:3100)

*(9 Vibe-Annotations 2026-07-21 in DoD übersetzt — Annotation-Block bleibt zur Nachvollziehbarkeit unverändert)*

Referenz-Notebook: `/notebooks/f07b2ca2-6dd4-41f1-ada1-9dc933d38b9b`

---

## 1. Erstellen führt direkt hinein

- [ ] 🐛 Klick auf „Notiz hinzufügen" (FAB `notes-add-button`) öffnet nach dem Erstellen sofort den Notiz-Editor: `handleCreateNote` (`studio-panel.tsx:440-449`) setzt nach `onNoteCreated` zusätzlich `setView({ mode: "note", noteId: result.data.id })`. Heute: Notiz wird nur erstellt + als Listenzeile prepended, der Editor öffnet nicht (Vibe-Annotation #1)
- [ ] 🐛 Nach dem Anlegen eines neuen Notizbuchs navigiert die App direkt in `/notebooks/[newId]` (im `onSubmit`/`onSaved`-Pfad, `notebook-form-dialog.tsx:105-121` → `notebook-grid.tsx`, per `router.push`), statt auf `/notebooks` zu bleiben. Heute: Dialog schließt, neue Karte wird nur in die Grid prepended (Vibe-Annotation #3)

## 2. Studio-Generierung: Report-Parität & „Erklären"

- [ ] 🐛 Report-Erstellung verhält sich wie die anderen Cards — kein erzwungener Live-View mehr: `handleCreate` (`studio-panel.tsx:371-379`) nutzt für `type === "report"` denselben Fire-and-forget-Pfad wie `startObjectGeneration` (Liste bleibt via `setView({ mode: "list" })`, Zeile zeigt „Wird erstellt…"-Badge, öffnet automatisch via `pendingViewerId`, sobald `ready`). Heute: Report zwingt sofort in `setView({ mode: "live" })` (Vibe-Annotation #2)
- [ ] **Cross-cutting:** Der Report-Streaming-Zweig (`startReportStream`, `studio-panel.tsx:285-340`, `{ mode: "live" }`-View + ReportViewer-Streaming-Modus) entfällt aus dem Create-Flow. Report-Content wird weiterhin serverseitig generiert + persistiert und im normalen `ReportViewer` geöffnet, wenn fertig (Vibe-Annotation #2)
- [ ] 🐛 Klick auf „Erklären" (`flashcard-explain`) beendet den Vollbildmodus des Studio-Viewers. Heute: `isFullscreen` bleibt an, die Chat-Antwort erscheint hinter dem `fixed inset-0`-Overlay und ist unsichtbar. Erfordert, dass `handleExplain` (`notebook-detail-shell.tsx:437-442`) den Fullscreen-State von StudioPanel zurücksetzen kann — via neuer Methode auf `StudioPanelHandle` (heute nur `flush()`) oder geliftetem `isFullscreen` (Vibe-Annotation #4)
- [ ] „Erklären" macht zusätzlich den Chat sichtbar: auf Desktop wird ein eingeklapptes Chat-Panel expandiert (`toggle("chat")` / `collapsed.chat`), auf Mobile schließt der Studio-Sheet (bereits via `closeMobilePanel`) — sodass die injizierte Chat-Antwort sichtbar ist (Vibe-Annotation #4)

## 3. Lesbarkeits-Breite in den Viewern

- [ ] Flashcard-Inhalt (`flashcard`, `flashcards-viewer.tsx:125-131`, heute `w-full`) bekommt eine lesbare, zentrierte Max-Breite (`max-w-* mx-auto`, ~65–75ch), damit die Karte im Vollbild nicht über die ganze Viewport-Breite läuft (Vibe-Annotation #5)
- [ ] Quiz-Body (`quiz-viewer.tsx:99`, `min-h-0 flex-1 overflow-y-auto px-4`) bekommt dieselbe zentrierte Max-Breite (Vibe-Annotation #6)
- [ ] Report-Body (`report-viewer-body`, `report-viewer.tsx:78`) bekommt dieselbe zentrierte Max-Breite (Vibe-Annotation #7)
- [ ] Notiz-Editor-Content (`note-editor-content`, `NOTE_CONTENT_CLASS`, `note-editor.tsx:46-61`) bekommt dieselbe zentrierte Max-Breite (Vibe-Annotation #8)
- [ ] **Cross-cutting:** Die Max-Breite greift in-column als No-Op (Panel ist ohnehin schmaler) und constrained nur im Vollbild — eine gemeinsame Breiten-Konstante/Wrapper für alle 4 Flächen, kein 4× divergierender Wert

## 4. Weiße Lesefläche für Notiz & Report

- [ ] Notiz-Editor-Content und Report-Body bekommen eine explizite weiße Lesefläche via `bg-card` (= `--surface`, heute `#ffffff`) — auch im Vollbild, wo damit der cremefarbene `--background` (`#f6f5f1`) überschrieben wird, den `FullscreenContainer` setzt. Lesefläche in-column UND Vollbild konsistent weiß; der `FullscreenContainer`-Rahmen bleibt `bg-background` (weißes „Papier" auf cremefarbenem Rahmen) (Vibe-Annotation #8)

## 5. Source-Farbcoding nach Dokumenttyp

- [ ] Semantische Typ-Farb-Tokens definieren (in `app/globals.css`, light + dark): PDF = rot, `docx` = blau, `xlsx`+`csv` = grün, `image` = lila, `txt`+`md`+`text` = grau, `web` = türkis — Abdeckung aller 9 Source-Typen (`pdf, txt, md, docx, xlsx, csv, image, text, web`) (Vibe-Annotation #9)
- [ ] 🐛 Der Farbpunkt in `SourceListItem` (`> span`, `source-list-item.tsx:129-135`) nutzt eine Typ→Farbe-Map statt `getNotebookCardColor(source.id)` (id-Hash). Gleiche Dokumentart = gleiche Farbe → Unterscheidbarkeit. `getNotebookCardColor` bleibt für Notebook-Karten/-Zeilen unverändert (nur `SourceListItem` umstellen) (Vibe-Annotation #9)

## 6. Notiz-Zeile: Parität mit Artefakten (Kebab-Menü)

- [ ] Notiz-Zeilen in der Studio-Liste erhalten dasselbe 3-Punkte-Kebab-Menü (⋮) wie Artefakt-Zeilen — mit „Umbenennen" **und** „Löschen" — statt des heutigen direkten Mülleimer-Icons (heute: Notiz = direkter Trash-Button, Artefakt = ⋮-Kebab). Optische + funktionale Parität in der gemischten Liste (Nachtrag-Annotation, Screenshot)
- [ ] „Löschen" nutzt den bestehenden `DeleteNoteDialog` (Confirm-Dialog, destruktiv). „Umbenennen" öffnet einen Rename-Dialog analog zum Artefakt-Rename; bestehenden Note-Title-Update-Pfad wiederverwenden, sonst minimale Server-Action (`enhanceAction`, `auth: true`, Zod, RLS via Note-Ownership) (Nachtrag-Annotation)

## 7. Anschluss: Vollbild-Behandlung generalisieren

- [ ] Die Vollbild-Lesebehandlung (zentrierte `max-w-2xl mx-auto` + weiße `bg-card`-Papierfläche wie bei Report/Notiz-Editor) gilt generell für ALLE Vollbild-Inhalte — nachziehen für: read-only `NoteViewer` (Notiz aus Chat) und `AudioViewer` (Titel + Player + Transkript). Heute fehlt sie dort (voll-breit, keine Papierfläche) (Anschluss-Annotation, Screenshots)
- [ ] Im Notiz-Editor zieht auch die Formatierungs-Toolbar (und die Titel-/„gespeichert"-Kopfzeile) auf die Content-Breite (`max-w-2xl mx-auto`) mit, statt voll-breit über der zentrierten Papierspalte zu stehen (Anschluss-Annotation, Screenshot)

---

# Vibe Annotations — localhost:3100 · 9 annotations

Follow my instructions on these elements. When applying design changes, map values to the project design system (Tailwind classes, CSS variables, or design tokens).

---

## 1. Klick auf Notiz erstellen sollte mich auch gleich zum notiz screen navigieren.

- **Component:** `Button`
- **Page:** /notebooks/f07b2ca2-6dd4-41f1-ada1-9dc933d38b9b
- **Selector:** `button[data-test="notes-add-button"]`
- **Element:** `button` "Notiz hinzufügen"

## 2. klick auf einen der berichte wiederum sollte mich nicht in die Generierungsseite leiten sondern nur die karte erstellen und anzeigen, dass es generiert wird, wie bei den anderen cards

- **Component:** `Presence`
- **Page:** /notebooks/f07b2ca2-6dd4-41f1-ada1-9dc933d38b9b
- **Selector:** `div[data-test="create-artifact-dialog"] div:nth-of-type(2)`
- **Element:** `div` "Briefing-DokumentÜberblick über deine Quellen mit Kernerkenn…"

## 3. Neues Notizbuch erstellen sollte mich auch direkt in das Notizbuch bringen

- **Component:** `CreateNotebookCard`
- **Page:** /notebooks
- **Selector:** `button[data-test="notebooks-empty-cta"]`
- **Element:** `button` "Neues Notizbuch"

## 4. erklärensolltemichausdemvollbildmodusrausbringenunddenchatanzeigen

- **Component:** `FlashcardsViewer`
- **Page:** /notebooks/f07b2ca2-6dd4-41f1-ada1-9dc933d38b9b
- **Selector:** `span[data-test="flashcard-explain"]`
- **Element:** `span` "Erklären"

## 5. kartesollteauchvollbildeineeingeschränkebreitehabendamitdielesbarkeiterhaltenbleibt

- **Component:** `FlashcardsViewer`
- **Page:** /notebooks/f07b2ca2-6dd4-41f1-ada1-9dc933d38b9b
- **Selector:** `button[data-test="flashcard"]`
- **Element:** `button` "8 / 34Sie beschreibt lineare Störungen rotierender Schwarzer…"

## 6. auch hier breite für lesbarkeit einschränken

- **Component:** `QuizViewer`
- **Page:** /notebooks/f07b2ca2-6dd4-41f1-ada1-9dc933d38b9b
- **Selector:** `div.min-h-0.flex-1.overflow-y-auto.px-4`
- **Element:** `div` "Gravitationsphysik-Quiz1 / 11Was ergibt die Analyse von Pavl…"

## 7. auch hier breite für lesbarkeit einschränken

- **Component:** `ReportMarkdown`
- **Page:** /notebooks/f07b2ca2-6dd4-41f1-ada1-9dc933d38b9b
- **Selector:** `div[data-test="report-viewer-body"] > div`
- **Element:** `div` "Kurzfragen-Quiz
1. Was besagt die zentrale Schlussfolgerung …"

## 8. auch hier breite für lesbarkeit einschränken und hintergrund hier und bei den berichten weiß lassen für besere lesbarkeit

- **Component:** `PureEditorContent`
- **Page:** /notebooks/f07b2ca2-6dd4-41f1-ada1-9dc933d38b9b
- **Selector:** `div[data-test="note-editor-content"]`
- **Element:** `div` "Als Untersuchungsrahmen dient die Polymer Parameterized Fiel…"

## 9. colorcoding nach art des dokuments nicht random für bessere unterscheidbarkeit

- **Component:** `SourceListItem`
- **Page:** /notebooks/f07b2ca2-6dd4-41f1-ada1-9dc933d38b9b
- **Selector:** `div[data-test="source-row-489e12b0-dfaa-4dd4-a5a5-70e205c5a715"] > span`
- **Element:** `span` ""
