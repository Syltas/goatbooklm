# Spec v2 — Fixes (localhost:3100)

*(9 Vibe-Annotations 2026-07-21 in DoD übersetzt — Annotation-Block bleibt zur Nachvollziehbarkeit unverändert)*

Referenz-Notebook: `/notebooks/61f01804-5845-4031-b789-6c094482de3c`

---

## 1. Studio: Notizen & Artefakte in einer Liste

- [ ] Notizen erscheinen als Einträge in **derselben** Liste wie die Studio-Artefakte (`studio-artifact-list` in `studio-panel.tsx`), gemischt sortiert (z.B. nach `updated_at`/`created_at`); die separate Notizen-Section (`studio-notes-slot` / `notes-panel.tsx`-Slot) entfällt (Vibe-Annotation #8)
- [ ] Eine Notiz-Zeile öffnet den `NoteEditor` als Full-Slot-Viewer, der die Liste ersetzt und die **volle Höhe der Studio-Spalte** einnimmt — analog zu den Artefakt-Viewern (`ReportViewer`/`FlashcardsViewer`/`QuizViewer`/`AudioViewer`). Heute öffnet die Notiz nur im unteren `flex-[3]`-Bereich, Tiles+Liste bleiben darüber (Vibe-Annotation #5)
- [ ] 🐛 „Notiz hinzufügen" wird ein **Floating Action Button**: fixiert/absolut über dem Studio-Inhalt, immer sichtbar, belegt keinen Layout-Platz; ersetzt den bisherigen Full-Width-Button `notes-add-button` **und** die Empty-State-CTA `notes-empty-cta` (Vibe-Annotation #7)
- [ ] `data-test` bleibt erhalten: `notes-add-button` am FAB, `note-row-<id>` an den Notiz-Zeilen, `artifact-row-<id>` unverändert an den Artefakt-Zeilen

## 2. Studio: Vollbild-Overlay für Inhalte

- [ ] Kleiner Expand-Button **oben rechts** im Inhaltsbereich jedes geöffneten Studio-Viewers — Report, Karteikarten, Quiz, Audio **und** `NoteEditor` (Vibe-Annotation #6)
- [ ] Klick → der Inhalt rendert als **Vollbild-Overlay über den ganzen Viewport** (`fixed inset-0`), alles andere verdeckt; eine Exit-/Close-Control schließt zurück in die Studio-Spalte (Vibe-Annotation #6)
- [ ] Overlay-Verhalten identisch für alle 5 Inhaltstypen über **ein gemeinsames Wrapper-Pattern**, nicht pro Viewer dupliziert
- [ ] `data-test` am Expand-Button (z.B. `content-fullscreen-toggle`); `ESC` schließt das Overlay

## 3. Quellen-Liste & Status

- [ ] „· N Chunks" aus dem Quellen-Status-Badge entfernen; Ready-State zeigt nur noch „Bereit" (`source-list-item.tsx` → `StatusBadge`, Ready-Branch). `getChunkCount` bleibt nur relevant, falls anderswo gebraucht (Vibe-Annotation #3)
- [ ] 🐛 Große Quellen mit vielen Chunks schlagen beim Speichern fehl („Speichern der Quelle fehlgeschlagen"). Ursache-Hypothese: **einzelner Bulk-Insert aller Chunk-Rows inkl. Embedding-Vektoren** (`service.ts:430`, `chunks.insert(rows)`) — Payload/Row-Count-Limit. Fix: Chunk-Insert **batchen** (z.B. 500 Rows/Batch), Rollback-Semantik erhalten; Ursache am realen Fall bestätigen; großen Upload (viele Chunks) verifizieren (Vibe-Annotation #4)

## 4. Upload-Dialog

- [ ] 🐛 „Quelle hinzufügen"-Dialog läuft bei vielen Dateien (20) oben **und** unten aus dem Viewport. Fix: Dialog `max-height` (z.B. `max-h-[85dvh]`) + interner Scroll auf der Datei-Liste; Header + Aktions-Footer bleiben im Viewport sichtbar. Mit 20 Dateien verifizieren (Vibe-Annotation #1)

## 5. Chat-Eingabe

- [ ] 🐛 Composer-Eingabe hebt sich farblich vom Chat-Panel ab („andere Farbe als Hintergrund, sieht komisch"). Ziel: **nahtlos einfügen** — nur Border als Abgrenzung, kein Farb-Kontrast. Befund: Composer-Pill `bg-card` sitzt auf Panel `bg-card` → doppelt wirkt abgesetzt. `chat-input.tsx` Container/Textarea-Flächen prüfen und angleichen (Vibe-Annotation #2)

## 6. Quiz

- [ ] 🐛 Im Quiz ist immer Option **A** korrekt. Ursache: LLM emittiert biased `correct_index: 0`, es gibt **kein** Shuffle (kein `shuffle`/`Math.random` in `lib/studio` oder `app/api/studio`). Fix: nach `generateObject` (`app/api/studio/generate/route.ts:272-288`) je Frage `options` shufflen **und** `correct_index` remappen, sodass die korrekte Position variiert. Über einen generierten Quiz verifizieren, dass `correct_index` nicht durchgehend 0 ist (Vibe-Annotation #9)

---

# Vibe Annotations — localhost:3100 · 9 annotations

Follow my instructions on these elements. When applying design changes, map values to the project design system (Tailwind classes, CSS variables, or design tokens).

---

## 1. Nichtmehr nutzbar wenn ich 20 Dateien auf einmal hochladen will. Modal top und bottom sind out of screen

- **Component:** `Presence`
- **Page:** /notebooks/61f01804-5845-4031-b789-6c094482de3c
- **Selector:** `#radix-_R_t6minebn5rkndlb_`
- **Element:** `div` "Quelle hinzufügenFüge eine Datei (PDF, Word, Excel, CSV, Tex…"

## 2. warum hat das auf einmal eine andere Farbe als der Hintergrund? sieht komisch aus

- **Component:** `Textarea`
- **Page:** /notebooks/61f01804-5845-4031-b789-6c094482de3c
- **Selector:** `textarea[data-test="chat-input"]`
- **Element:** `textarea` ""

## 3. Chunks muss hier nicht stehen hat für den endnutzer ja wenig mehrwert

- **Component:** `StatusBadge`
- **Page:** /notebooks/61f01804-5845-4031-b789-6c094482de3c
- **Selector:** `div[data-test="source-row-14669767-f99f-46f0-af70-f8d815b21323"] p:nth-of-type(2)`
- **Element:** `p` "Bereit · 19 Chunks"

## 4. mehrere Quellen schlagen fehl

- **Component:** `SourceListItem`
- **Page:** /notebooks/61f01804-5845-4031-b789-6c094482de3c
- **Selector:** `div[data-test="source-row-0011d653-587b-46e5-bb6e-14bebd0ccb27"]`
- **Element:** `div` "2601.00989v2FehlerSpeichern der Quelle fehlgeschlagen."

## 5. Das notizbuch hier unten sollte die ganze rechte seite ausfüllen wenn ich eine notiz offen habe

- **Component:** `StudioPanel`
- **Page:** /notebooks/61f01804-5845-4031-b789-6c094482de3c
- **Selector:** `div.flex.h-full > div.min-h-0.flex-1 > div.flex.h-full > div.flex-1.overflow-y-auto`
- **Element:** `div` "Dieses Korpus vereint aktuelle Beiträge der theoretischen Gr…"

## 6. Alle Inhalte der rechten Spalte sollten auf vollbild gezogen werden können. optimal kleiner button oben rechts im inhalt nachdem der inhalt belegt die ganze rechte Seite Patch durch ist

- **Component:** `Panel`
- **Page:** /notebooks/61f01804-5845-4031-b789-6c094482de3c
- **Selector:** `#nb-panel-studio`
- **Element:** `div` "StudioBerichtKarteikartenQuizAudioNoch keine Artefakte. Erst…"

## 7. Das sollte ein hovering button sein

- **Component:** `Button`
- **Page:** /notebooks/61f01804-5845-4031-b789-6c094482de3c
- **Selector:** `button[data-test="notes-add-button"]`
- **Element:** `button` "Notiz hinzufügen"

## 8. Notizen sind genau so oben bei den Studio Card ergebnissen dabei nicht separat

- **Component:** `NoteListItem`
- **Page:** /notebooks/61f01804-5845-4031-b789-6c094482de3c
- **Selector:** `div[data-test="note-row-7029d4c8-76bb-4eaf-996a-7224442e55c8"]`
- **Element:** `div` "Zuletzt bearbeitet am 21. Juli 2026"

## 9. im quiz ist immer a richtig... das sollte natürlich variieren sonst hat das keinen mehrwert

- **Component:** `QuizViewer`
- **Page:** /notebooks/61f01804-5845-4031-b789-6c094482de3c
- **Selector:** `div[data-test="quiz-options"]`
- **Element:** `div` "A.Ab n ≥ 4Richtig!Richtig: Für n=2 und n=3 existieren Kasner…"
