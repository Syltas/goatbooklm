# Feature-Spec V2-1 — Core-Loop-Ausbau (`core-loop-v2`)

*(10 Vibe-Annotations 2026-07-20 in DoD übersetzt — Annotation-Block am Ende bleibt unverändert zur Nachvollziehbarkeit)*
*(Eng-Review 2026-07-20 eingearbeitet: 4 Blocking-Findings korrigiert, S0 ergänzt, S2 von 4 auf 9 Sync-Punkte erweitert, S9 von Structured Output auf Trailer umgestellt)*
*(Design-Review 2026-07-20 eingearbeitet: S6 in S6a (baubar) und S6b (blockiert) gesplittet; die Behauptung „Popover-first wurde 2026-07-19 bewusst eingeführt" ist widerlegt und korrigiert)*

- **Modus:** EXTEND (baut auf `specs/01-notebooks.md`, `02-ingestion.md`, `03-chat-grounding.md` auf)
- **Bereich/Modul:** Notebook-Detail (alle drei Panels) + Ingestion-Pipeline
- **Layers:** DB (2 neue Tabellen, 3 Spalten-Migrationen), Service, API, UI
- **Non-trivial:** ja — neue Tabellen, neuer Vision-Pfad, ein Signatur-Refactor quer durch alle Server Actions (§S0), ein **Rückbau einer bereits ausgelieferten AC** (§S6)

---

## S0 — `enhanceAction` fängt Fehler zentral

*(Eng-Review-Finding N2 — vorgezogen, weil S1 und S2 neue Actions auf genau diese Schicht legen)*

- [ ] `enhanceAction` (`lib/server/action.ts:41-62`) umschließt Client-Auflösung, Auth und Handler-Aufruf mit einem `try/catch` — heute existiert dort **kein** `try/catch`, weshalb alles vor dem Handler-eigenen `try` ungefangen durchfliegt
- [ ] Der Rückgabetyp wird von generisch `Return` auf `ActionResult<T>` verengt, sodass ein gefangener Fehler als `{ error }` beim Client ankommt statt als Next.js-Dev-Overlay
- [ ] Alle bestehenden Aufrufer ziehen mit — Notebooks, Auth, Sources, Chat-History. `pnpm tsc --noEmit` findet jeden einzelnen; die Umstellung gilt erst als fertig, wenn er sauber ist
- [ ] Fehlermeldungen laufen weiterhin durch `toGermanErrorMessage`, der Rohfehler wird server-seitig geloggt und nie an den Client durchgereicht

---

## 0. Vorab geklärt (keine DoDs nötig)

**Annotation #4 — „wird hier bereits etwas extrahiert aus der Website?"**
**Ja.** Web-Quellen laufen durch dieselbe Pipeline wie PDFs: SSRF-Vorprüfung
(`lib/ingestion/extract.ts:70-116`) → undici-Fetch mit IP-pinned Dispatcher, 15 s Timeout,
10 MB Cap, max. 5 Redirects (`extract.ts:281-345`) → Readability-Extraktion via
`linkedom` + `@mozilla/readability` (`extract.ts:392-409`) → Chunking (800 Token / 100
Overlap) → `text-embedding-3-small` → `chunks`-Tabelle. Einziger Unterschied zu PDF sind
Stage 8/9 (Fetch+Readability statt Storage-Download+`unpdf`); Web-Chunks haben
`char_start`/`char_end`, aber kein `page`.

→ **Kein DoD.** Die Annotation war eine Frage, die Antwort ist „ist schon so".

---

## S1 — Mehrfach-Upload von PDFs

*(Vibe-Annotation #1)*

- [ ] Der Datei-Input in `PdfUploadTab` akzeptiert `multiple`; Drop-Zone und Klick-Auswahl nehmen beide 2+ Dateien entgegen (heute: `event.target.files?.[0]` bzw. `event.dataTransfer.files?.[0]`, State ist ein einzelnes `File | null`, `pdf-upload-tab.tsx:44,154,182`)
- [ ] Bei **genau 1** ausgewählter Datei bleibt das editierbare Titelfeld wie heute
- [ ] Bei **2+** Dateien ersetzt eine Liste der Dateinamen das Titelfeld; jede Quelle bekommt ihren Dateinamen (ohne `.pdf`) als Titel, Umbenennen erfolgt nachträglich in der Quellen-Liste
- [ ] 🐛 Das Titelfeld wird beim Wechsel der Datei neu aus dem Dateinamen abgeleitet, solange der Nutzer es nicht selbst editiert hat (`titleTouched`-Flag) — heute klebt der zuerst gesetzte Titel über Datei-Wechsel hinweg (`pdf-upload-tab.tsx:76`, `setTitle((prev) => prev || …)`), wodurch eine Datei unter dem Namen einer anderen ingested wird
- [ ] Jede Datei erzeugt eine eigene `sources`-Row und einen eigenen Queue-Job; ein Fehler bei Datei 2 lässt die Uploads 1 und 3 unberührt und wird pro Datei angezeigt
- [ ] Jedes interaktive Element des neuen Mehrfach-Uploads (Datei-Liste, Entfernen-Buttons, Submit) trägt ein `data-test`-Attribut
- [ ] Migration ergänzt `sources.content_hash text` **plus** `unique (notebook_id, content_hash)` — ohne den Unique-Index ist die Dedupe-Prüfung eine Race-Condition: zwei gleichzeitige Uploads derselben Datei sind beide `pending` und kommen beide durch
- [ ] `supabase gen types typescript --local > lib/database.types.ts` ist nach der Migration gelaufen
- [ ] **Cross-cutting:** Content-Hash (`sha256` der Bytes) wird auf `sources` gespeichert; ein Upload, dessen Hash im selben Notebook schon existiert, wird mit Nennung der bestehenden Quelle abgelehnt — verhindert die stille Corpus-Verdopplung, die das top-k halbiert
- [ ] Der Hash wird **im Worker aus den tatsächlich geladenen Bytes** neu berechnet und mit dem Client-Wert abgeglichen; weicht er ab, gewinnt der Worker-Wert. Der Client lädt direkt in Storage hoch (`pdf-upload-tab.tsx:81-83`), der Server sieht die Bytes vorher nie — ein allein client-gelieferter Hash wäre gegen CLAUDE.md-Regel 2 nur weich

---

## S2 — Weitere Dateitypen

*(Vibe-Annotation #3 — Entscheid: alles inkl. Bilder in einem Durchgang, kein Video)*

- [ ] `.txt` und `.md` werden als Quelle akzeptiert und direkt (ohne Extraktions-Bibliothek) in den Chunking-Pfad gegeben
- [ ] `.docx` wird akzeptiert; Text-Extraktion über eine Bibliothek im Stil von `mammoth`, Ergebnis geht in denselben Chunking-Pfad
- [ ] `.xlsx` und `.csv` werden akzeptiert; jedes Sheet wird als Markdown-Tabelle serialisiert, damit Zellbezüge im Chunk lesbar bleiben
- [ ] Bilder (`.png`, `.jpg`, `.webp`) werden akzeptiert; ein Vision-Call erzeugt Beschreibung **und** enthaltenen Text, das Ergebnis wird als `content_text` gechunkt und embedded
- [ ] Videos werden explizit abgelehnt, mit einer Meldung die sagt *dass* Video nicht unterstützt wird (nicht nur „Dateityp nicht erlaubt")
- [ ] Pro Format existiert eine eigene Fehlermeldung in `INGESTION_MESSAGES`; heute werfen **alle** Download-/Extraktionsfehler die PDF-Formulierung `pdfCorrupt` (`lib/ingestion/service.ts:336,343,358,371`)
- [ ] `supabase gen types typescript --local > lib/database.types.ts` ist nach der Typ-Migration gelaufen

**Cross-cutting — die Pipeline ist an 9 Stellen heimlich PDF-förmig.** Alle müssen mit:

- [ ] **Migration**: `sources.type` hat heute `check (type in ('pdf','text','web'))` (`20260719103134_create_core_schema.sql:63`) — neue Typen brauchen eine Migration, sonst schlägt jeder Insert fehl
- [ ] Storage-Pfad hängt die Endung hart an: `` `${data.userId}/${sourceId}.pdf` `` (`service.ts:121`)
- [ ] Der server-seitige Größen-Check sitzt **innerhalb** des PDF-Zweigs (`service.ts:363`); `text`/`web` prüfen gar nicht. Pro-Typ-Limits heißen `extractContent` umbauen, nicht eine Konstante tauschen
- [ ] Storage-Cleanup beim Quellen-Löschen ist PDF-gegatet: `if (source.type === "pdf" && source.storage_path)` (`service.ts:466`) — neue Binärtypen verwaisen sonst im Storage
- [ ] Storage-Sweep beim **Notebook**-Löschen ist PDF-gegatet: `.eq("type","pdf")` (`service.ts:499`) — heute leakt damit jede Nicht-PDF-Datei beim Notebook-Delete
- [ ] Der Stale-Pending-Guard prüft Upload-Existenz nur für PDF (`service.ts:438`) — neue Upload-Typen verlieren ihn stillschweigend
- [ ] Magic-Byte-Check steht hart auf `%PDF-` (`service.ts:354-359`)
- [ ] Client-seitiges Endung-Strippen ist `/\.pdf$/i` (`pdf-upload-tab.tsx:35-37`); MIME-Validierung ebenso PDF-only (`:61-65,180`), Zod-Schema `z.literal("application/pdf")` (`lib/ingestion/schema.ts:22-24`), Storage-Bucket-Allowlist ebenso (`20260719144041_create_sources_storage_bucket.sql:7`)
- [ ] `IngestionDeps` führt `extractPdfText` als benanntes Feld (`service.ts:77-79`) — „ein Extraktions-Kopf pro Format" heißt Registry-Refactor, der auch `lib/ingestion/deps.ts` und die Stubs in `lib/ingestion/__tests__/service.test.ts` umschreibt
- [ ] **Cross-cutting:** Pro Dateityp ein eigenes Größenlimit, **server-seitig auf den tatsächlich geladenen Bytes** geprüft — ein 20-MB-PNG ist etwas anderes als ein 20-MB-PDF

**🤔 Produkt-Loch bei Bild-Quellen:** `content_text` ist bei Bildern **modell-generierte Prosa** (geschrieben in `service.ts:288`), und der Reader-Mode highlightet `content_text[char_start..char_end]` (Spec 03, AC-G2). Ein Zitat-Klick in eine Bild-Quelle zeigt also generierten Text statt des Bildes. Was der Reader bei Bildern anzeigen soll, ist nicht entschieden — **muss vor dem Bau von S2 geklärt werden.**

---

## S3 — 🐛 Server-Actions werfen ungefangen

*(Vibe-Annotation #2 — „web hinzufügen schlägt fehl". Der Selector der Annotation war `nextjs-portal`, also das Next.js-Dev-Error-Overlay: die Action wirft, statt ein `ActionResult` zurückzugeben. Welcher der drei Pfade konkret gefeuert hat, ist offen — alle drei sind unabhängig davon Bugs.)*

*(Die zentrale Ursache — kein `try/catch` in `enhanceAction` — ist als **S0** vorgezogen. Hier bleibt, was S0 nicht abdeckt.)*

- [ ] 🐛 `createAdminClient()` wird **innerhalb** des `try` aufgerufen; heute steht es davor (`sources/actions.ts:137`, `try` öffnet erst `:139`), und die Non-null-Assertions in `lib/supabase/admin.ts:14-16` werfen bei fehlender `SUPABASE_SERVICE_ROLE_KEY` an der Action vorbei. Gleiches Muster an `:87`, `:111`, `:166`. Nach S0 ist das kein Overlay mehr, aber die Meldung bleibt nichtssagend, solange der Aufruf außerhalb steht
- [ ] 🐛 `enhanceAction` validiert mit `safeParse` statt `parse` und gibt bei Schema-Verstoß ein `{ error }` mit Feldbezug zurück (heute: `lib/server/action.ts:57`, ZodError propagiert ungefangen)
- [ ] 🐛 Eine abgelaufene Session führt zu einem `{ error }`-Ergebnis, nicht zu `throw new Error("Unauthorized")` (`lib/server/action.ts:52`)
- [ ] 🐛 Schlägt das Enqueue nach dem Row-Insert fehl, wird die `sources`-Row auf `error` gesetzt statt als `pending` liegen zu bleiben — heute entsteht eine Waise, die nie verarbeitet wird und erst nach 10 min über den Client-Stale-Guard als roter Fehler auftaucht (`lib/ingestion/service.ts:209,217`)
- [ ] 🐛 Die SSRF-Prüfung unterscheidet „DNS-Auflösung fehlgeschlagen" von „IP ist geblockt"; heute kollabieren beide zu `"Diese URL ist nicht erlaubt."` (`extract.ts:43,103-108`), womit ein transienter Netzwerkfehler wie eine Sicherheitsblockade aussieht
- [ ] Der Worker-Endpoint in `supabase/seed.sql:23` kommt aus einer Umgebungsvariable statt hart auf einem Port zu stehen. **Nicht** auf `:3000` umstellen: `playwright.config.ts:9-14` hält fest, dass Port 3000 auf dieser Maschine von einem fremden Projekt belegt ist und der Dev-Server deshalb absichtlich auf `:3100` läuft — ein Pin auf 3000 würde die E2E-Suite brechen und den Worker auf eine fremde App zeigen lassen

---

## S4 — Lesbarkeit der Chat-Antwort

*(Vibe-Annotation #6 — Entscheid: Stufe „Body 16/1.7, H2 20px, Divider über H2")*

- [ ] Body-Text der Assistant-Nachricht steht auf `text-[16px] leading-[1.7]` (heute `text-[15px] leading-[1.6]`, `message-item.tsx:65`)
- [ ] H2 steht auf 20px, H3 auf 17px, H4 auf 15px semibold (heute 16/15/15, `citation-render.tsx` `BASE_COMPONENTS`)
- [ ] Vor jedem H2 **außer dem ersten** rendert eine Trennlinie (`border-t`), ohne dass das Modell dafür `---` ausgeben muss
- [ ] Die User-Bubble zieht auf dieselbe Schriftgröße mit, damit Frage und Antwort nicht unterschiedlich groß wirken (`message-item.tsx:27`)
- [ ] Die Blasenbreite bleibt auch dann lesbar, wenn das Chat-Panel nach S5 schmal gezogen wird — heute deckelt `max-w-[85%]` (`message-item.tsx:47`) prozentual, was bei 16px-Text in einem schmalen Panel zu kurze Zeilen erzeugt

---

## S5 — Verschiebbare Panels

*(Vibe-Annotation #5 — Entscheid: statt fester Prozentwerte per Drag resizable. Die wörtlichen Zahlen aus der Annotation gingen rechnerisch nicht auf: 345 + 700 + 345 = 1390 bei 1600px Viewport. **Nachtrag 2026-07-20: durchgängig relative Einheiten, keine festen Pixelbreiten.**)*

**Umsetzung: `react-resizable-panels`**, nicht Eigenbau — die Bibliothek liefert Prozent-Größen, `minSize`/`maxSize` in Prozent, `collapsible` und `autoSaveId`-Persistenz nativ, also fünf der acht DoDs.

- [ ] Zwischen Sources↔Chat und Chat↔Studio sitzt je ein Drag-Handle, das die Panel-Breiten stufenlos verändert (heute fix: `w-[300px]` / `flex-1` / `w-[300px]`, `notebook-detail-shell.tsx:218,232,255`)
- [ ] Die Panel-Breiten sind **relativ** (Prozent des verfügbaren Platzes) — das heutige feste `w-[300px]` verschwindet und wird nicht durch einen anderen Pixelwert ersetzt
- [ ] Mindest- und Höchstbreite pro Panel sind ebenfalls prozentual, abgesichert gegen eine Lesbarkeitsgrenze — kein Panel lässt sich unbenutzbar schmal ziehen, und auf einem 2560px-Screen wachsen die Seitenleisten nicht ins Absurde
- [ ] Bei Viewport-Änderung behalten die Panels ihr **Verhältnis** zueinander — **mit expliziter Vorrangregel: greift eine Min-/Max-Grenze, gewinnt die Grenze, das Verhältnis ist best-effort.** (Ohne diese Regel widersprechen sich die beiden DoDs am Clamp-Rand: sobald eine Grenze bindet, summieren sich die Anteile nicht mehr auf 100% und das ungeklammerte Panel schluckt den Rest.)
- [ ] Die gewählten Verhältnisse überleben Reload und Notebook-Wechsel, persistiert in `localStorage` als **Anteile, nicht als Pixelwerte** — sonst bricht die Wiederherstellung auf einem anders großen Bildschirm
- [ ] Das bestehende Collapse-Verhalten bleibt funktionsfähig: ein collapsed Panel geht auf die schmale Rail, und beim Wieder-Ausklappen kehrt das vom Nutzer gezogene Verhältnis zurück — nicht der Default
- [ ] Die Rail-Breite `w-14` (`notebook-detail-shell.tsx:69`) bleibt als fester Pixelwert **ausdrücklich erlaubt** — sie ist eine Control-Größe, keine Flächenaufteilung
- [ ] Auf Mobile (<768px) ändert sich nichts: Chat bleibt full-bleed, Sources/Studio bleiben im Bottom-Sheet, keine Drag-Handles. **Achtung:** das `hidden … md:flex` steckt heute in derselben `expandedClassName`-Zeichenkette wie die Breite (`:218,255`) — beim Ersetzen der Breite darf das Mobile-Verstecken nicht mit verschwinden
- [ ] Jedes Drag-Handle trägt `role="separator"`, ist fokussierbar und lässt sich mit den Pfeiltasten bewegen
- [ ] Jedes Drag-Handle trägt ein `data-test`-Attribut
- [ ] **Cross-cutting:** Layout-Breiten im Notebook-Detail werden generell relativ ausgedrückt; feste `w-[…px]`-Klassen bleiben nur dort zulässig, wo es um Icon-/Control-Größen geht, nicht um Flächenaufteilung

---

## S6a — Zitat-Vorschau: Locator zurück, Hover öffnet

*(Vibe-Annotation #7, erster Teil — nach `/plan-design-review` 2026-07-20 aus dem ursprünglichen S6 herausgelöst. Nicht-destruktiv, ändert **keine** Aktivierungs-Semantik, hält die E2E durchgehend grün.)*

> **Befund des Design-Reviews zur Vorgeschichte:** Die frühere Fassung dieser Spec behauptete, das
> Design-Review vom 19.07. habe Popover-first *bewusst* eingeführt. Das ist so nicht haltbar.
> Laut Task-Log (`tasks-design-review-20260719-150736.jsonl`, DT3) hat Popover-first sich gegen eine
> **Right-Panel-Highlight-Spalte** durchgesetzt, nicht gegen Klick-zum-Sprung; es fiel als
> Nebenprodukt aus dem Layout-Umbau und war 1 von 13 Entscheidungen derselben Sitzung. Die
> Begründung in `decisions.jsonl` (`0144b725`) lautet *„User supplied real NotebookLM screenshots"*
> — Referenz-Treue, kein Usability-Befund. `specs/03-chat-grounding.md:509-512` dokumentiert **was**
> sich änderte, nirgends **warum**. Es existiert kein Befund der Form „Klick-zum-Sprung stört das
> Lesen". Die Umkehrung überstimmt also kein abgewogenes Urteil.

- [ ] Das Zitat-Popover zeigt wieder eine Locator-Zeile (`Seite N · Absatz M`) zwischen Quellenname und Passage — sie war im approved Mockup (`designs/notebook-detail-3panel-20260719/real-detail.png`) enthalten und ist beim Bauen verlorengegangen (`citation-popover.tsx:26-29` rendert heute nur Titel + Passage)
- [ ] Bei Quellen ohne Seiteninformation (Web, Text, Notiz — dort gibt es kein `page` im Chunk-Metadata) degradiert die Zeile sauber, statt „Seite undefined" zu zeigen
- [ ] Hover über einen Zitat-Chip öffnet das Popover nach **350 ms**; Verlassen schließt es nach **200 ms** Nachlauf, damit der Zeiger in die Karte wandern kann, ohne dass sie verschwindet. Hovern über der Karte hält sie offen
- [ ] Hover-Öffnen bindet **ausschließlich an die sichtbaren 16×16 px** des Chips. Das `after:-inset-3.5`-Padding (`citation-chip.tsx:35`) bleibt Klick- und Touch-Ziel, löst aber **kein** Hover aus — sonst ragt die 44 px hohe Trefferfläche 8–10 px in die Zeilen darüber und darunter (Zeilenhöhe 24 px, nach S4 27,2 px) und die Karte öffnet über normalem Fließtext, ohne dass ein Chip berührt wurde
- [ ] Während eine Nachricht noch streamt, öffnet Hover auf deren Chips nicht — `CitationRender` rendert unbedingt (`message-item.tsx:66`), Chips fließen also während des Streamens um und eine daran verankerte Karte würde springen
- [ ] Klick-, Touch- und Tastaturverhalten bleiben **unverändert** gegenüber heute: Klick/Tap öffnet das Popover, „Quelle anzeigen" springt in den Reader. AC-45, AC-46, AC-47, AC-51 und der grüne E2E bleiben damit gültig
- [ ] Umsetzung über einen **controlled** Radix `Popover` mit eigener Pointer-Verdrahtung — **kein** `HoverCard`. HoverCard bewegt den Fokus nicht in die Karte und würde AC-47 (Focus-in + Focus-Return) still aushebeln

---

## S6b — 🚧 Klick springt direkt in den Reader

*(Vibe-Annotation #7, zweiter Teil. **Blockiert.** Erst bauen, wenn S6a ausgeliefert ist und sich im Betrieb zeigt, dass der Direktsprung dann überhaupt noch fehlt.)*

> **Harte Vorbedingung: der Sprung muss umkehrbar sein.** `source-reader-context.tsx:47` hält den
> gesamten Reader-Zustand in `useState({ sourceId: null })` — ein Slot, kein Stack. Ein Fehlklick
> auf ein 16-px-Inline-Ziel verwirft heute die vorher offene Quelle samt Scroll-Position, und
> `source-reader-back` führt zur **Liste**, nicht zur vorherigen Quelle. Auf Mobile legt
> `onMobileReaderOpen()` (`notebook-detail-shell.tsx:145-147`) zusätzlich ein Bottom-Sheet über den
> Chat und kostet die Chat-Scroll-Position. Auch eine Textauswahl über einen Chip hinweg kann den
> Klick auslösen. Unwiderruflicher Panel-Wechsel gegen 16-px-Trefferfläche ist ein schlechter Tausch.

- [ ] `source-reader-context.tsx` merkt sich den vorherigen Zustand (Quelle **und** Scroll-Position); die Zurück-Affordanz stellt ihn wieder her, statt zur Liste zu führen — **diese DoD ist Vorbedingung für alle folgenden**
- [ ] Auf Desktop springt ein Klick auf den Chip direkt in den Reader-Mode, scrollt zum Chunk, hebt ihn hervor und schließt das Popover; er toggelt das Popover nie
- [ ] **Mobile/Touch bleibt exakt wie heute:** Tap → Popover → „Quelle anzeigen" → Sheet. Kein unsichtbarer Zwei-Tap. Die Divergenz ist dadurch gerechtfertigt, dass Hover auf einem Gerät existiert und auf dem anderen nicht — nicht durch einen unsichtbaren Modus. `specs/03-chat-grounding.md:707-708` verlangt ohnehin, dass keine Funktion nur per Hover erreichbar ist
- [ ] Tastatur: Enter/Space öffnet weiterhin das Popover (AC-47 bleibt erhalten), darin ist „Quelle anzeigen" **auto-fokussiert**, sodass ein zweites Enter springt. Zwei Anschläge, beide auf beschrifteten Bedienelementen
- [ ] „Quelle anzeigen" (`citation-popover.tsx:33`) **bleibt auf jedem Viewport** — es ist der Tastatur-Pfad, der Screenreader-Pfad, der Touch-Pfad, die einzige beschriftete Affordanz und der E2E-Anker (`e2e/chat/chat.spec.ts:83-84`), und wurde vor einem Commit erst gehärtet (QA ISSUE-002)
- [ ] Ein Sprung meldet sich über eine höfliche Live-Region an („Reader-Mode geöffnet: *Quellenname*") — heute in beiden Entwürfen unspezifiziert, und ohne sie erfährt ein Screenreader-Nutzer nichts von dem Panel-Wechsel
- [ ] AC-G4: ein Chip ohne `char_start`/`char_end` springt nicht ins Leere, sondern degradiert sichtbar — der bisherige Degrade-Pfad war über „Quelle anzeigen" formuliert (`specs/03-chat-grounding.md:604`) und greift beim Direktsprung nicht mehr
- [ ] **Cross-cutting:** Popover-first steckt in `specs/03-chat-grounding.md` an **zehn** Stellen (25-26, 67 §2 Scope, 414, 418, 482, 601, 602, 640 Design-Notes, 644, 673 Annahme A-1) sowie in **`DESIGN.md:36` und `:92`** („Zitat-Klick primär = Popover-Karte"), das laut `specs/03:29-32` die bindende visuelle Source-of-Truth ist. Betroffen sind zusätzlich AC-46, AC-47, AC-51, §14 und DoD-Design/DoD-A11y (`:663-664`)
- [ ] **Cross-cutting:** `e2e/chat/chat.spec.ts:78` macht `chip.click()` und assertet danach das Popover (`:79-81`); die Assertion wird auf `hover()` umgestellt, die Page-Object-Accessoren `citationPopover` / `citationPopoverOpenSource` (`e2e/chat/chat.po.ts`) ziehen mit
- [ ] **Cross-cutting:** Der QA-Report vom 19.07. (`.gstack/qa-reports/qa-report-goatbooklm-2026-07-19.md`) beschreibt den alten Ablauf als verifiziert und wird als überholt markiert

---

## S7a — Notizen: Datenmodell & CRUD

*(Vibe-Annotation #9 — Entscheid: volles Paket)*

- [ ] Migration legt `notes` an mit `user_id uuid not null references auth.users(id)`, `notebook_id`, `title`, `content` (TipTap-JSON), Timestamps — inkl. `enable row level security`, `revoke all`, `grant` und Owner-Policy in **derselben** Migration
- [ ] `supabase gen types typescript --local > lib/database.types.ts` ist nach der Migration gelaufen
- [ ] Service `lib/notes/service.ts` mit injizierter Client-Dependency; Unit-Tests decken Happy- und Error-Pfad ab
- [ ] Server Actions für Anlegen/Ändern/Löschen über `enhanceAction`, `auth: true`, `user_id` ausschließlich server-seitig aufgelöst
- [ ] Das Studio-Panel listet die Notizen des Notebooks statt des heutigen Platzhalters „Audio, Video & mehr — kommt bald" (`panel-placeholders.tsx`)
- [ ] Ein „Notiz hinzufügen"-Button unten im Studio-Panel legt eine leere Notiz an und öffnet sie
- [ ] Löschen einer Notiz bestätigt über einen Dialog
- [ ] `notebook_id` trägt `on delete cascade` — ein gelöschtes Notebook lässt keine verwaisten Notizen zurück
- [ ] Die Liste ist nach zuletzt geändert absteigend sortiert und hat einen Leerzustand, der erklärt wofür Notizen da sind
- [ ] Jedes interaktive Element der Liste trägt ein `data-test`-Attribut

---

## S7b — Notizen: TipTap-Editor

*(Vibe-Annotation #9)*

- [ ] TipTap ist als Dependency ergänzt (`@tiptap/react`, `starter-kit`, `extension-link`) — heute steht davon **nichts** in `package.json`
- [ ] Der Editor wird mit `immediatelyRender: false` initialisiert; ohne das erzeugt TipTap im Next-15-App-Router einen Hydration-Mismatch
- [ ] Eine geöffnete Notiz zeigt ein editierbares Titelfeld und darunter den TipTap-Editor
- [ ] Die Toolbar enthält genau: Undo, Redo, Textgröße, Bold, Italic, Link, Code, Codeblock, Bullet-List, Ordered-List, Quote, Divider, Clear-Formatting. **„Textgröße" = Überschriften-Ebene** (Normal / H1 / H2 / H3), nicht Font-Size in px — so zeigt es auch die Referenz `image-2.png` („Normal"-Dropdown), und StarterKit kann es ohne Zusatz-Extension
- [ ] Änderungen werden ohne expliziten Speichern-Klick persistiert (debounced), mit sichtbarem Zustand „gespeichert / speichert…"
- [ ] Schlägt das Speichern fehl, ist das sichtbar und der Nutzer verliert seinen Text nicht — ein stiller Fehlschlag bei Autosave ist schlimmer als gar kein Autosave
- [ ] Ein Serializer wandelt in beide Richtungen zwischen TipTap-JSON und Plaintext um. **S7c, S8 und S9 hängen alle daran** (Notiz→Quelle braucht Text, „Als Notiz speichern" braucht JSON) — ohne diese DoD besitzt ihn niemand
- [ ] Der Editor rendert im Studio-Panel und ist auf dessen Breite benutzbar (kein horizontales Scrollen der Toolbar bei der Default-Breite **nach S5**)
- [ ] Jeder Toolbar-Button und das Titelfeld tragen ein `data-test`-Attribut

---

## S7c — Notiz zu Quelle machen

*(Vibe-Annotation #9 — das Fragezeichen ist als Vorgabe entschieden)*

- [ ] Am unteren Rand der geöffneten Notiz sitzt „Zu Quelle machen"
- [ ] Der Klick übergibt den Notiz-Inhalt als Text an dieselbe Ingestion-Pipeline wie eine Text-Quelle: eigene `sources`-Row, Chunking, Embedding, `chunks`
- [ ] Die entstandene Quelle erscheint in der Quellen-Liste und durchläuft dieselben Status-Übergänge (`pending → processing → ready`) wie jede andere Quelle
- [ ] Die Notiz bleibt nach der Umwandlung als Notiz bestehen; Quelle und Notiz sind ab dann unabhängig (eine spätere Notiz-Änderung aktualisiert die Quelle **nicht**)
- [ ] Eine leere Notiz lässt sich gar nicht erst umwandeln — der Button ist deaktiviert. Heute würde sie eine Row anlegen, den Job einreihen und dann mit `noReadableText` (`service.ts:400-402`) als rote Fehler-Quelle enden
- [ ] Notizen über dem 500.000-Zeichen-Limit von `AddTextSourceSchema` (`lib/ingestion/schema.ts:40`) werden vor dem Absenden abgefangen, mit klarer Meldung statt Schema-Fehler
- [ ] Der Button trägt ein `data-test`-Attribut

---

## S8 — Notebook-Summary im leeren Chat

*(Vibe-Annotation #8 — Entscheid: gecacht, invalidiert bei Quellen-Änderung. Referenz: `image.png`)*

- [ ] Migration ergänzt die Zusammenfassung auf `notebooks` (Text + Zeitstempel/Gültigkeitsmarker), inkl. Grants; RLS gilt über die bestehende Owner-Policy
- [ ] `supabase gen types typescript --local > lib/database.types.ts` ist nach der Migration gelaufen
- [ ] Ein Notebook mit ≥1 `ready`-Quelle hat eine gespeicherte Zusammenfassung seiner Quellen (Titel + Fließtext), persistiert in der DB
- [ ] Die Zusammenfassung wird **einmal** pro Quellen-Stand erzeugt, nicht bei jedem Öffnen — der leere Chat rendert sie ohne Wartezeit
- [ ] **Der Auslöser ist der Übergang einer Quelle nach `ready` (und das Löschen einer Quelle) — nicht der Insert.** Beim Insert ist die Quelle `pending` (`lib/ingestion/service.ts:302-310`); eine Regenerierung zu diesem Zeitpunkt würde aus einem Korpus zusammenfassen, der die neue Quelle noch gar nicht enthält, und nichts würde später nachziehen
- [ ] Die Generierung läuft **im Worker**, direkt nach dem `ready`-Übergang — die Zusammenfassung steht bereit, bevor der Nutzer den Chat öffnet, kein Kaltstart im leeren Chat
- [ ] Der Umfang des Modell-Inputs ist gedeckelt: pro Quelle geht nur ein begrenzter Ausschnitt in den Call, bei Überschreitung wird pro Quelle vorzusammengefasst und dann verdichtet. Ohne Deckel sprengen fünf große PDFs (`content_text` bis 500k Zeichen ≈ 250k Token) das Kontextfenster
- [ ] Schlägt die Generierung fehl, bleibt der leere Chat benutzbar und zeigt den heutigen Hinweis statt einer kaputten oder leeren Summary-Fläche
- [ ] Bei leerem Chat steht die Zusammenfassung an der Stelle, an der heute „Stellen Sie eine Frage zu Ihren Quellen." + die drei statischen Vorschläge stehen (`chat-panel.tsx:81-103`)
- [ ] Unter der Zusammenfassung sitzen „Als Notiz speichern" und „Kopieren"; „Als Notiz speichern" legt eine Notiz nach S7a an
- [ ] Notebooks ohne `ready`-Quelle zeigen weiterhin den heutigen Hinweis, keine leere Summary-Fläche
- [ ] Beide Aktionen tragen `data-test`-Attribute

---

## S9 — Aktionen & Folgefragen an der Antwort

*(Vibe-Annotation #10 — Entscheid: Follow-ups im selben LLM-Call, **als Trailer im Textstream, nicht als Structured Output**. Referenz: `image-3.png`)*

> **Warum kein `Output.object`:** Die Fähigkeit existiert im installierten SDK (`ai@7.0.31` exportiert `Output`, `streamText` akzeptiert `output`), zwingt das Modell aber in ein JSON-Dokument — der Nutzer sähe live `{"answer":"Ihre Quellen…` getippt. Zusätzlich brechen drei bewusst gebaute Pfade in `app/api/chat/route.ts`: der M3-Partial-Rescue (`:279-353`), `parseCitations` (`:356`) und `appendIncompleteHint` (`:363-366`). Und qualifiziert das Modell nicht für natives `json_schema`, fällt `@ai-sdk/anthropic` auf einen erzwungenen Tool-Call zurück — dann kommt der Inhalt als Tool-Input-Delta statt als Text-Delta und **das Streaming verschwindet ganz**.

- [ ] Am Ende jeder abgeschlossenen Assistant-Antwort sitzen „Als Notiz speichern" und „Kopieren"
- [ ] „Kopieren" legt den Antworttext in die Zwischenablage und quittiert sichtbar
- [ ] „Als Notiz speichern" legt eine Notiz nach S7a mit dem Antworttext an
- [ ] Unter der **letzten** Antwort stehen drei Folgefragen, die inhaltlich auf dieser Antwort aufbauen; ältere Antworten zeigen keine
- [ ] Die Folgefragen entstehen im **selben** Anthropic-Call wie die Antwort, als klar abgetrennter Block am Ende des Textstreams — kein zweiter Round-Trip
- [ ] Der Client schneidet diesen Block ab, bevor er die Antwort rendert, und zeigt ihn als Chips. Muster und Ort wie das bestehende `appendIncompleteHint` / `stripIncompleteHint` (`lib/chat/messages.ts`, `message-item.tsx:44`)
- [ ] Der abgetrennte Block landet **nicht** im persistierten `content` der Nachricht und verwirrt damit auch nicht die Historie beim nächsten Turn
- [ ] Lässt sich der Block nicht parsen, wird die Antwort normal gerendert und es erscheinen einfach keine Chips — ein Parse-Fehler darf die Antwort nie beschädigen
- [ ] Klick auf eine Folgefrage schickt sie als neue Frage ab (heute füllen die statischen Vorschläge nur das Eingabefeld, `chat-panel.tsx:96`)
- [ ] Läuft die Antwort noch (Streaming), sind weder Aktionen noch Folgefragen sichtbar — insbesondere blitzt der Trailer während des Streamens nicht als Rohtext auf
- [ ] `GROUNDING_SYSTEM_PROMPT` ändert sich für den Trailer → **`pnpm eval` ist gelaufen und grün**. Das ist die einzige Stelle, an der eine Grounding-Regression sonst unsichtbar bliebe
- [ ] Alle Aktionen und Chips tragen `data-test`-Attribute

---

## Offene Punkte 🤔

- 🤔 **Bilder-Kosten (S2):** Ein Vision-Call pro Bild ist der erste Pfad in diesem Projekt, bei dem *Ingestion* Modellkosten verursacht (bisher nur Embeddings). Ob es dafür ein Limit pro Notebook braucht, ist nicht entschieden.
- 🤔 **Reader-Mode bei Bild-Quellen (S2):** Was soll der Reader zeigen, wenn ein Zitat in eine Bild-Quelle führt — das Bild, den generierten Beschreibungstext, oder beides? **Muss vor dem Bau von S2 entschieden sein.**
- 🤔 **Summary-Kosten (S8):** Zehn Quellen nacheinander hochladen heißt zehn `ready`-Übergänge und damit zehn Neu-Generierungen. Ob das gedebounced wird, ist offen.
- 🤔 **Retrieval-Fairness:** `TOP_K = 8` mit flachem Vektor-Suchlauf hat keine Per-Source-Garantie (`app/api/chat/route.ts:55`). Am 2026-07-20 landeten 8/8 Chunks auf einer einzigen `source_id` — allerdings im degenerierten Fall zweier byte-identischer Quellen. Kein DoD, bis ein echter Fall mit zwei *verschiedenen* Dokumenten gemessen ist.

---

## Abschluss-Gate (gilt für jede Section)

- [ ] `pnpm tsc --noEmit` → 0 Fehler
- [ ] `pnpm next lint` → 0 Fehler
- [ ] `pnpm build` → grün *(nicht `pnpm next build` — das schreibt in `.next` und zerschießt den laufenden Dev-Server; `pnpm build` setzt `NEXT_DIST_DIR=.next-build`, siehe Commit 173efa7)*
- [ ] Betroffene E2E-Suites laufen grün
- [ ] Nach jeder Migration: `supabase gen types typescript --local > lib/database.types.ts`

## Cross-Cutting-Übersicht

| Betrifft | Wo | Aus |
|---|---|---|
| `enhanceAction`-Signatur → alle Actions der App | Notebooks, Auth, Sources, Chat-History | S0 |
| Pipeline an **9** Stellen PDF-förmig (inkl. DB-CHECK-Constraint) | siehe S2-Liste | S2 |
| Größenlimit pro Dateityp, server-seitig auf echten Bytes | `lib/ingestion/service.ts` | S2 |
| Content-Hash-Dedupe + Unique-Index gegen Race | `sources` + Upload-Pfad + Worker | S1 |
| Relative statt fester Layout-Breiten | `notebook-detail-shell.tsx`, `localStorage` | S5 |
| `specs/03-chat-grounding.md` (10 Stellen) + `DESIGN.md:36,92` + AC-46/47/51 + §14 | Spec- + Design-Dateien | S6b |
| `e2e/chat/chat.spec.ts:78` + `chat.po.ts` anpassen | E2E | S6b |
| Reader braucht Zurück-Pfad (vorherige Quelle + Scroll) | `source-reader-context.tsx` | S6b |
| TipTap-JSON ↔ Plaintext-Serializer | S7b besitzt ihn, S7c/S8/S9 nutzen ihn | S7b |
| `data-test` auf jedem neuen interaktiven Element | alle UI-Sections | CLAUDE.md |
| `pnpm eval` nach Prompt-Änderung | S9 | S9 |

## Bau-Reihenfolge

Vier Lanes, parallelisierbar bis auf die genannten Abhängigkeiten.

| Lane | Reihenfolge | Hinweis |
|---|---|---|
| **A — Fundament** | S0 → S3 → S1 → S2 | S0 zuerst, weil S1/S2 neue Actions auf diese Schicht legen. **S2 ist der größte Brocken, ~3× so groß wie ursprünglich veranschlagt.** |
| **B — Chat-UI** | S4 → S6a → *(Pause)* → S6b | Muss intern seriell laufen: S4 ändert `citation-render.tsx`, S6a/S6b fassen `citation-chip.tsx` an, das von dort gerendert wird. **S6b ist bewusst gestoppt** — erst S6a ausliefern und im Betrieb prüfen, ob der Direktsprung dann noch fehlt. |
| **C — Notizen** | S7a → S7b → S7c | S7a ist die am besten spezifizierte Section — guter Startpunkt für Momentum. |
| **D — nach C** | S8 → S9 | Beide brauchen S7a **und** S7b (Serializer). |
| **E — eigenständig** | S5 | Sollte **vor** S7b landen, sonst ist dessen Breiten-DoD nicht prüfbar. |

⚠️ **Konflikt:** Lane B und Lane D fassen beide `components/chat/message-item.tsx` an — B die Typografie, D die Aktionsleiste. Entweder koordinieren oder B vor D abschließen.

---
---

# Vibe Annotations — localhost:3100 · 10 annotations

Follow my instructions on these elements. When applying design changes, map values to the project design system (Tailwind classes, CSS variables, or design tokens).

---

## 1. auswählen sollte mehr als eine Datei auswählen können

- **Component:** `PdfUploadTab`
- **Page:** /notebooks/7a322144-4ffb-4ef1-9026-a5e03875525c
- **Selector:** `div[data-test="pdf-upload-dropzone"]`
- **Element:** `div` "PDF hierher ziehen oder auswählen (max. 20MB)Datei auswählen"

## 2. web hinzufügen schlägt fehl

- **Page:** /notebooks/7a322144-4ffb-4ef1-9026-a5e03875525c
- **Selector:** `html > body > script:nth-of-type(22) > nextjs-portal >> div > div:nth-of-type(1)`
- **Element:** `div` ""

## 3. Multimedia Upload noch nötig. Bilder, excel, word, txt, md. kein video

- **Component:** `PdfUploadTab`
- **Page:** /notebooks/7a322144-4ffb-4ef1-9026-a5e03875525c
- **Selector:** `div[data-test="pdf-upload-dropzone"]`
- **Element:** `div` "PDF hierher ziehen oder auswählen (max. 20MB)Datei auswählen"

## 4. wird hier bereits etwas extrahiert aus der Website? Falls nein muss auf jeden Fall auch die Website analysiert und in die (vector)db gespeichert werden

- **Component:** `FormProvider`
- **Page:** /notebooks/7a322144-4ffb-4ef1-9026-a5e03875525c
- **Selector:** `div[data-test="add-source-dialog"] form:nth-of-type(1)`
- **Element:** `form` "URLTitel (optional)Hinzufügen"

## 5. Mitte um 30% schmaler, beide seitenleisten je 15% breiter für besseren lesefluss

- **Component:** `ChatPanel`
- **Page:** /notebooks/7a322144-4ffb-4ef1-9026-a5e03875525c
- **Selector:** `section.min-h-0.flex-col > div.min-h-0.flex-1 > div.flex.h-full > div.min-h-0.flex-1`
- **Element:** `div` "Kannst du mir sagen was die wichtigsten Vorbereitungen für b…"

## 6. text etwas größer für bessere lesbarkeit und headings und abschnitte klarer trennen mit divider und größeren heading texten

- **Component:** `MessageItem`
- **Page:** /notebooks/7a322144-4ffb-4ef1-9026-a5e03875525c
- **Selector:** `div.flex.flex-col.items-start.gap-1\.5`
- **Element:** `div` "Ihre Quellen behandeln nur ein Meeting – den Discovery Call …"

## 7. Quelle schon on hover zeigen und bei klick dann direkt links den entsprechenden textabschnitt zeigen

- **Component:** `PopoverTrigger`
- **Page:** /notebooks/7a322144-4ffb-4ef1-9026-a5e03875525c
- **Selector:** `div.text-foreground > ul.mb-3.last\:mb-0 > li:nth-of-type(1) > button.mx-0\.5.inline-flex`
- **Element:** `button` "4"

## 8. Bei leerem Chat direkt summary zeigen und bei summary auch save to note option und kopieren option

- **Component:** `ChatPanel`
- **Page:** /notebooks/7a322144-4ffb-4ef1-9026-a5e03875525c
- **Selector:** `div.min-h-0.flex-1 > div.flex.h-full > div.min-h-0.flex-1 > div.flex.h-full`
- **Element:** `div` "Stellen Sie eine Frage zu Ihren Quellen.Worum geht es in die…"
![alt text](image.png)

## 9. hovering notiz hinzufügen button hier unten schonmal für notizen rein machen und notizen erstellbar machen. Editor zum Notiz bearbeiten: TipTap. Toolleiste: undo, redo, bold, italic, link, size, code, codeblock, ul, ol, quote, divider, clear formatting. unten option es zu einer quelle zu machen?

- **Component:** `StudioPanelBody`
- **Page:** /notebooks/7a322144-4ffb-4ef1-9026-a5e03875525c
- **Selector:** `div.flex.min-h-0 > section.min-h-0.flex-col > div.min-h-0.flex-1 > div.flex.h-full`
- **Element:** `div` "Audio, Video & mehr — kommt bald"
![alt text](image-1.png)
![alt text](image-2.png)

## 10. auch hier am ende der nachricht wie bei summary einen als notiz speichern und einen kopieren button rein und 3 passende nächste fragen oder anweisungen basierend auf der letzten antwort

- **Component:** `MessageList`
- **Page:** /notebooks/7a322144-4ffb-4ef1-9026-a5e03875525c
- **Selector:** `div.flex.flex-col.gap-4.px-4`
- **Element:** `div` "Kannst du mir sagen was die wichtigsten Vorbereitungen für b…"
![alt text](image-3.png)
