# Source-Ingestion — Feature-Spec

| Feld | Wert |
|---|---|
| **Feature-Name** | `source-ingestion` |
| **Bereich/Modul** | Notebook-Detailseite — Sources-Panel (linkes Panel, Platzhalter aus Spec 01) |
| **Layers betroffen** | DB (neue Migration: Storage-Bucket + Policies), Service, API/Server-Action, UI |
| **Sichtbarkeit** | customer-facing, ausschließlich für eingeloggte User |
| **Modus** | NEW |
| **Non-trivial?** | Ja (DB + Service + Server-Action + UI + externe Netzwerk-/API-Calls) → `/plan-eng-review` vor Build empfohlen |

---

## 1. Ziel/Scope

User können in einem Notebook Wissensquellen hinzufügen — PDF-Upload, eingefügter Text oder eine Web-URL — die serverseitig extrahiert, in 800-Token-Chunks mit 100-Token-Overlap zerlegt, per OpenAI `text-embedding-3-small` embedded und in `public.chunks` (pgvector) persistiert werden. Der Sources-Panel-Platzhalter aus Spec 01 (`/notebooks/[notebookId]`, linkes Panel) wird mit einem „Add source"-Dialog und einer Source-Liste (Status-Badges, Chunk-Count, Retry, Delete) gefüllt. Diese Chunks sind die Grundlage für RAG-Chat (spätere Spec) und Citation-Highlighting (Spec 03), das die in `chunks.metadata` gespeicherten Char-Offsets konsumiert.

`public.sources` und `public.chunks` (inkl. RLS, HNSW-Index) existieren bereits seit `supabase/migrations/20260719103134_create_core_schema.sql`. **Für dieses Feature ist nur eine neue Migration für den Storage-Bucket + `storage.objects`-Policies nötig — keine neuen Spalten/Tabellen für `sources`/`chunks`.**

## 2. Non-Goals (explizit außerhalb v1)

- Kein OCR — Bild-/gescannte PDFs ohne Textlayer werden als Fehler behandelt, nicht verarbeitet.
- Keine Bilder/Diagramme aus PDFs extrahiert oder gespeichert.
- Kein YouTube/Audio/Video als Source-Typ (nur `pdf` / `text` / `web`, wie im DB-Check-Constraint).
- Keine asynchrone Queue (Background-Jobs, Worker) — v1 ist synchron in Server Actions. Der Service-Schnitt (siehe §9) ist bewusst so gehalten, dass eine Queue später ohne Interface-Bruch andocken kann (Ersetzen des Aufrufers, nicht der Service-Methoden).
- Kein Re-Embedding bei späterer Änderung der Chunk-Parameter (800/100) — bestehende Chunks bleiben, wie sie beim Verarbeitungslauf entstanden sind, bis der User manuell „Retry" klickt.
- Kein Multi-File-Upload (ein PDF pro Upload-Vorgang).
- Kein Website-Crawling über die Einstiegs-URL hinaus (nur die eine angegebene Seite, keine Unterseiten).
- Keine granulare Fortschrittsanzeige (Prozent/Schritt-für-Schritt) — nur die vier Status-Werte `pending` / `processing` / `ready` / `error`.
- Keine Rate-Limits pro User für Ingestion-Aktionen (späteres Hardening).
- Kein Realtime (Supabase Realtime Subscriptions) für Status-Updates — Client-Polling reicht (siehe §6).
- Kein i18n-Zwang (projektweit optional, kein Gate für dieses Feature).

## 3. Ist-Zustand

### Code-Inventar

- `app/(app)/notebooks/[notebookId]/page.tsx` **existiert noch nicht** — Spec 01 (`specs/01-notebooks.md`) definiert diese Route inkl. eines leeren „Sources"-Platzhalter-Panels (linke Seite), ist zum Zeitpunkt dieser Spec aber noch nicht gebaut. Diese Spec geht davon aus, dass Spec 01 vor dem Build dieser Spec umgesetzt ist (Reihenfolge-Abhängigkeit, siehe §14 Risks).
- Kein `lib/ingestion/`-Verzeichnis, keine Chunking-/Extraction-/Embedding-Services vorhanden.
- Verfügbare shadcn-Bausteine: `tabs.tsx`, `dialog.tsx`, `card.tsx`, `label.tsx`, `textarea.tsx`, `input.tsx`, `alert.tsx`, `skeleton.tsx`, `dropdown-menu.tsx`, `sonner.tsx` (Toast), `form.tsx`, `button.tsx` — reichen für den 3-Tab-Dialog und die Source-Liste, keine neue shadcn-Component nötig.
- `enhanceAction` (`lib/server/action.ts`) und das Service-Pattern (`createXService(client)`, siehe `lib/auth/service.ts`) sind die verbindlichen Adapter-/Service-Konventionen im Projekt.
- `createAdminClient()` (`lib/supabase/admin.ts`, service-role) existiert, wird für diese Spec **nicht** gebraucht — alle Ingestion-Operationen laufen unter der Session des Users, RLS trägt das Scoping.

### DB-Inventar (bereits vorhanden)

```
public.sources
  id             uuid primary key default gen_random_uuid()
  notebook_id    uuid not null references public.notebooks(id) on delete cascade
  user_id        uuid not null references auth.users(id) on delete cascade
  type           text not null check (type in ('pdf', 'text', 'web'))
  title          varchar(500) not null
  url            text (nullable)
  storage_path   text (nullable)
  content_text   text (nullable)
  status         text not null default 'pending' check (status in ('pending','processing','ready','error'))
  error_message  text (nullable)
  created_at / updated_at timestamptz

RLS: enable + revoke all + grant an authenticated/service_role
Policy "sources_owner": using/with check (auth.uid() = user_id AND notebook gehört auth.uid())

public.chunks
  id             uuid primary key default gen_random_uuid()
  source_id      uuid not null references public.sources(id) on delete cascade
  notebook_id    uuid not null references public.notebooks(id) on delete cascade
  user_id        uuid not null references auth.users(id) on delete cascade
  chunk_index    int not null
  content        text not null
  embedding      extensions.vector(1536) (nullable)
  metadata       jsonb not null default '{}'
  created_at     timestamptz
  unique (source_id, chunk_index)

RLS: enable + revoke all + grant an authenticated/service_role
Policy "chunks_owner": using/with check (auth.uid() = user_id AND notebook + source gehören auth.uid())
Index: hnsw (embedding vector_cosine_ops)
```

`chunks.embedding` ist absichtlich **nullable** — technisch, um spätere asynchrone Re-Embedding-Workflows zu erlauben. v1 nutzt das nicht: siehe Architektur-Entscheidung „Atomarität" in §4.

Ein Source-Delete löscht abhängige `chunks` automatisch über `on delete cascade`. Ein Storage-Objekt (bei `type='pdf'`) hängt **nicht** an dieser FK-Kette und muss explizit im Service gelöscht werden.

### Storage-Inventar

- `supabase/config.toml` hat `[storage] enabled = true`, lokales `file_size_limit = "50MiB"`, aber **keinen Bucket definiert** (`[storage.buckets.*]` ist auskommentiert).
- Kein Bucket, keine `storage.objects`-Policies für Sources vorhanden — braucht eine neue Migration (siehe §9).

### Dependency-Inventar

| Paket | Status | Zweck in diesem Feature |
|---|---|---|
| `ai` (^7.0.31), `@ai-sdk/openai` (^4.0.16) | ✅ installiert | `embedMany` für Batch-Embeddings |
| `zod` (^4.4.3) | ✅ installiert | Action-Input-Validierung |
| `js-tiktoken` | ❌ fehlt | Tokenizer `cl100k_base` für Chunking (fester Contract, siehe §4) |
| `unpdf` | ❌ fehlt | PDF-Textextraktion (Empfehlung, siehe §4) |
| `@mozilla/readability` + `linkedom` | ❌ fehlt | Web-Haupttext-Extraktion (Empfehlung, siehe §4) |
| `vitest` | ❌ fehlt | Unit-Test-Runner (projektweit noch nicht eingeführt, siehe Annahme 8) |

`OPENAI_API_KEY` ist bereits in `.env.example` vorgesehen — kein neues Env-Var nötig, nur ein realer Key im Deployment.

## 4. Architektur-Entscheidungen

Diese Entscheidungen sind für den Build bindend (nicht Teil der offenen Fragen in §14):

1. **Ablauf v1: synchron, keine Queue.** Die komplette Pipeline (Extraktion → Chunking → Embedding → Persistenz) läuft innerhalb einer einzigen Server-Action-Invocation, mit DB-Status-Updates an den Übergängen (`pending → processing → ready|error`). **Vercel-Timeout-Risiko:** Serverless-Function-Limits (z.B. 60s auf Hobby, bis 300s auf Pro ohne Sonderkonfiguration) können bei sehr großen PDFs (viele hundert Chunks → mehrere Embedding-Batches) überschritten werden. Mitigation v1: `export const maxDuration = 300` in der Ingestion-Actions-Datei setzen (Annahme: Pro-Plan, siehe Annahme 5) und die 20MB-Obergrenze als harte Guard beibehalten. Eine echte Lösung (Queue/Background-Job) ist explizit Non-Goal v1 — der Service-Schnitt in §9 hält Extraktion/Chunking/Embedding/Persistenz als einzeln aufrufbare Methoden, damit ein späterer Queue-Worker dieselben Methoden aus einem Job-Handler statt aus der Server-Action aufrufen kann, ohne die Services selbst zu ändern.

2. **PDF-Upload läuft NICHT über den Server-Action-Body.** Vercel-Serverless-Functions haben ein hartes Request-Body-Limit (~4.5MB) für Server Actions und Route Handler — bei bis zu 20MB PDFs nicht tragbar. Stattdessen: Client lädt die Datei **direkt in Supabase Storage** hoch (Storage-RLS schützt den Pfad-Prefix = `auth.uid()`), der Next.js-Server sieht die Binärdaten nie. Ablauf: (a) `createPdfSourceAction` legt eine `pending`-Row an und liefert `{ sourceId, storagePath }`; (b) Client lädt clientseitig direkt zu Storage hoch; (c) Client ruft `processSourceAction({ sourceId })`, die serverseitig aus Storage liest und die Pipeline startet.

3. **Embedding ist pro Source atomar.** Alle Chunk-Texte werden vollständig embedded (in Batches à max. 100, siehe Fixed Contract), **bevor** irgendein DB-Insert passiert. Schlägt ein Batch fehl, wird abgebrochen, **kein** Chunk dieser Source landet in der DB, `status='error'`. Schlägt der finale Bulk-Insert nach erfolgreichem Embedding fehl, werden bereits inserierte Chunks dieser Source wieder gelöscht (Rollback-by-delete; Postgres-Transaktion wird nicht über die Embedding-API hinweg offengehalten). Kein sichtbarer Teilerfolg — entweder eine `ready`-Source mit vollständigen Chunks oder eine `error`-Source ganz ohne Chunks.

4. **Content-Text auch für PDF.** `content_text` wird für **alle** Source-Typen mit dem extrahierten Volltext befüllt — auch bei `type='pdf'` (zusätzlich zu `storage_path`, das die Originaldatei referenziert). Grund: Chunk-Metadata-Contract (`char_start`/`char_end` als Offsets „in `sources.content_text`") funktioniert für PDF-Citation-Highlighting (Spec 03) nur, wenn `content_text` auch für PDFs existiert. Siehe Annahme 3.

5. **Status-Update-Mechanismus: Client-Polling, kein Realtime.** Eine Client-Komponente pollt (`router.refresh()`, alle 2s) solange mindestens eine Source im Panel `status IN ('pending','processing')` hat, und stoppt automatisch, sobald alle Sources einen finalen Status (`ready`/`error`) erreicht haben.

## 5. Soll-Zustand — User-Flow

1. User öffnet `/notebooks/[notebookId]`, sieht im Sources-Panel entweder eine Liste bestehender Sources oder (leer) einen Hinweistext + „Add source"-Button (`data-test="sources-add-button"`).
2. Klick auf „Add source" → zentrierter `Dialog` (`data-test="add-source-dialog"`) mit 3 Tabs: **PDF** (Default-Tab), **Text**, **Web**.
3. **PDF-Tab**: Drag&Drop-Fläche oder File-Picker-Button. Nach Dateiauswahl: Client-Validierung (MIME `application/pdf`, ≤20MB). Bei Erfolg: Dateiname + Größe angezeigt, „Upload"-Button aktiv. Submit → (a) `createPdfSourceAction` legt Source-Row an, (b) Client lädt Datei direkt zu Storage hoch (mit sichtbarem Upload-Spinner), (c) `processSourceAction` wird aufgerufen, (d) Dialog schließt, Source erscheint mit `status='processing'` in der Liste.
4. **Text-Tab**: Titel-Input (Pflicht) + Textarea (Pflicht, Zeichen-Zähler, Limit 500.000). Submit → `addTextSourceAction` legt Row an und verarbeitet synchron. Dialog schließt, Source erscheint mit `status='processing'`.
5. **Web-Tab**: URL-Input (Pflicht, http/https), Titel-Input (optional). Submit → `addWebSourceAction` prüft SSRF-Guard, fetcht, extrahiert, verarbeitet synchron. Dialog schließt, Source erscheint mit `status='processing'`.
6. Panel pollt, bis die neue Source `ready` (mit Chunk-Count) oder `error` (mit `error_message` + Retry-Button) zeigt.
7. Bei `error`: User klickt „Retry" (`data-test="source-retry-button"`) → Pipeline läuft erneut, `status` wechselt zurück auf `processing`.
8. User klickt „Delete" (`data-test="source-delete-button"`) an einer Source → Confirm-`Dialog` mit Warntext (Source-Titel genannt) → Bestätigen löscht DB-Row (Chunks per Cascade) und ggf. das Storage-Objekt; Abbrechen ändert nichts.

## 6. UI-Verhalten — Loading / Empty / Error / Status

| Zustand | Verhalten |
|---|---|
| **Sources-Panel leer** | Hinweistext „Noch keine Quellen" + „Add source"-CTA (`data-test="sources-empty-cta"`). |
| **Sources-Panel mit Einträgen** | Liste, jede Zeile: Typ-Icon (PDF/Text/Web), Titel, Status-Badge (`data-test="source-status-badge"`), Kebab/Buttons für Retry (nur bei `error`) und Delete (immer). |
| **Status `pending`/`processing`** | Badge zeigt „Wird verarbeitet…" (dezenter Spinner/Pulse), kein Chunk-Count. Panel pollt alle 2s (`router.refresh()`), solange ≥1 Source non-final ist. |
| **Status `ready`** | Badge „Bereit · N Chunks" (Chunk-Count aus `count(chunks) where source_id = …`). |
| **Status `error`** | Badge „Fehler" (destruktive Farbe) + `error_message`-Text unter der Zeile + Retry-Button. |
| **PDF-Upload läuft** | Submit-Button im Dialog zeigt Pending-Text („Wird hochgeladen…" → „Wird verarbeitet…") und ist `disabled` (analog `useTransition`-Pattern aus Spec 01). |
| **Validierungsfehler (Formular)** | Inline-Fehlermeldung je Tab (z.B. „Datei zu groß", „URL ungültig", „Text zu lang") — Submit wird nicht ausgelöst, kein Server-Roundtrip. |
| **Mutation-Error (Create-Action wirft, z.B. DB down)** | Inline `Alert` im Dialog, Dialog bleibt offen, Eingaben bleiben erhalten. |
| **Delete-Error** | Error-`Toast`, Source bleibt in der Liste sichtbar (keine optimistische Entfernung vor Serverbestätigung). |

## 7. Pipeline-Diagramm

```
── PDF ─────────────────────────────────────────────────────────────────────
Client                          Server (Actions/Services)              Storage/DB
------                          --------------------------              ----------
validiere MIME+Size (≤20MB)
  │
  ├─ createPdfSourceAction ───► insert sources(status='pending',
  │                              type='pdf', storage_path=…)  ────────► DB
  │  ◄── { sourceId, storagePath } ──┘
  │
  ├─ Upload direkt zu Storage ─────────────────────────────────────────► Storage
  │   (RLS: Pfad-Prefix = auth.uid())                                    bucket "sources"
  │
  └─ processSourceAction(sourceId) ─► status → 'processing'
                                       downloadFromStorage(storage_path)
                                       extractPdfText() → content_text, pageOffsets
                                       chunkText(content_text) → Chunk[]
                                       embedChunks(chunk.content, batch≤100) → vector[]
                                       [alle OK?] insert chunks(+embedding+metadata)
                                                  status → 'ready'
                                       [Fehler]   rollback (delete inserted chunks)
                                                  status → 'error' (+error_message)

── Text ────────────────────────────────────────────────────────────────────
Client ─ addTextSourceAction({title, text}) ─► insert sources(status='pending',
                                                 type='text', content_text=text)
                                                status → 'processing'
                                                chunkText(text) → Chunk[]
                                                embedChunks(...) → vector[]
                                                insert chunks / rollback bei Fehler
                                                status → 'ready' | 'error'

── Web ─────────────────────────────────────────────────────────────────────
Client ─ addWebSourceAction({url, title?}) ──► insert sources(status='pending', type='web')
                                                status → 'processing'
                                                assertSafeUrl(url)  [SSRF-Guard, jeder Redirect-Hop]
                                                fetch(url, timeout=15s, maxSize=10MB)
                                                extractWebText(html) → content_text, title?
                                                chunkText(content_text) → Chunk[]
                                                embedChunks(...) → vector[]
                                                insert chunks / rollback bei Fehler
                                                status → 'ready' | 'error'
```

## 8. Data-Model

Keine neuen Spalten/Tabellen für `sources`/`chunks` (siehe §3). Neu ist ausschließlich:

**Storage-Bucket `sources`** (private, nicht public):

- `id = 'sources'`, `public = false`, `file_size_limit = 20971520` (20MB), `allowed_mime_types = ['application/pdf']`.
- Pfad-Konvention: `{user_id}/{source_id}.pdf`.
- `storage.objects`-RLS-Policies (owner-only, analog zu den Tabellen-Policies): `select`/`insert`/`delete` erlaubt, wenn `bucket_id = 'sources'` UND `(storage.foldername(name))[1] = auth.uid()::text`.

**`chunks.metadata` jsonb-Shape** (fixer Contract, wird von Spec 03 konsumiert):

```json
{ "char_start": 0, "char_end": 812, "page": 3 }
```

- `char_start`/`char_end`: Offsets in `sources.content_text`, so dass `chunk.content === content_text.slice(char_start, char_end)` **exakt** gilt (keine Token-Decode-Rundung — Chunk-Content wird per Char-Slice aus dem Originaltext erzeugt, nicht aus dekodierten Tokens rekonstruiert).
- `page`: nur bei `type='pdf'` und nur wenn ermittelbar (Seite, in der `char_start` liegt, 1-indexiert). Fehlt bei `text`/`web` komplett (kein Key im Objekt).

## 9. API-Contract

### Zod-Schemas (`lib/ingestion/schema.ts`)

```
CreatePdfSourceSchema  = { notebookId: uuid, title: string min 1 max 500,
                            fileName: string, fileSizeBytes: number max 20_971_520,
                            fileMimeType: literal('application/pdf') }
ProcessSourceSchema    = { sourceId: uuid }
AddTextSourceSchema    = { notebookId: uuid, title: string min 1 max 500,
                            text: string min 1 max 500_000 }
AddWebSourceSchema     = { notebookId: uuid, url: string.url(),
                            title: string max 500 optional }
RetrySourceSchema      = { sourceId: uuid }
DeleteSourceSchema     = { sourceId: uuid }
```

### Services (`lib/ingestion/`, Dependencies injiziert, keine `createClient()`-Importe)

```
chunker.ts
  interface Chunk { index: number; content: string; charStart: number; charEnd: number; tokenCount: number }
  interface ChunkOptions { maxTokens?: number /* default 800 */; overlapTokens?: number /* default 100 */ }
  chunkText(text: string, opts?: ChunkOptions): Chunk[]     // pure, keine I/O — Tokenizer cl100k_base via js-tiktoken

extract.ts
  extractPdfText(bytes: Uint8Array): Promise<{ text: string; pageOffsets: { page: number; charStart: number; charEnd: number }[] }>
  extractWebText(url: string, opts?: { timeoutMs?: number; maxBytes?: number }): Promise<{ text: string; title?: string }>
  assertSafeUrl(url: string): void   // SSRF-Guard, wirft bei Verstoß

embed.ts
  embedChunks(texts: string[]): Promise<number[][]>   // embedMany, Batches ≤100, text-embedding-3-small, 1536 dim

service.ts
  interface IngestionDeps {
    supabase: SupabaseClient
    extractPdfText, extractWebText, chunkText, embedChunks   // injiziert, in Tests stubbar
    downloadStorageFile(path: string): Promise<Uint8Array>
    deleteStorageFile(path: string): Promise<void>
  }
  createIngestionService(deps): IngestionService
    createPendingPdfSource({ notebookId, userId, title, fileName }) → { sourceId, storagePath }
    createTextSource({ notebookId, userId, title, text }) → Source           // verarbeitet synchron bis ready|error
    createWebSource({ notebookId, userId, url, title? }) → Source            // verarbeitet synchron bis ready|error
    processSource({ sourceId, userId }) → Source                             // extract→chunk→embed→persist (PDF-Pfad)
    retrySource({ sourceId, userId }) → Source                               // guard: nur wenn status='error'
    deleteSource({ sourceId, userId }) → void                                // löscht Row + ggf. Storage-Objekt
```

### Server-Actions (`app/(app)/notebooks/[notebookId]/sources/actions.ts`, alle `enhanceAction({ auth: true, schema })`, `export const maxDuration = 300`)

```
createPdfSourceAction(input)  → { data: { sourceId, storagePath } } | { error: string }
processSourceAction(input)    → { data: Source } | { error: string }
addTextSourceAction(input)    → { data: Source } | { error: string }
addWebSourceAction(input)     → { data: Source } | { error: string }
retrySourceAction(input)      → { data: Source } | { error: string }
deleteSourceAction(input)     → { success: true } | { error: string }
```

Alle rufen nach Erfolg `revalidatePath('/notebooks/[notebookId]')`. `user.id` kommt ausschließlich aus `supabase.auth.getUser()`. Ownership-Check (Source gehört User + Notebook) läuft doppelt: RLS in der DB **und** ein expliziter Check im Service, bevor `processSource`/`retrySource`/`deleteSource` etwas verändern (RLS allein liefert bei fremder ID nur ein leeres Resultat, kein Fehler — der Service muss das explizit als „nicht gefunden/nicht erlaubt" behandeln, um `processSource` auf einer fremden Row gar nicht erst zu starten).

### Empfehlung: PDF-Textextraktion — `unpdf`

**Empfehlung: `unpdf`.** Es ist explizit für Serverless/Edge gebaut (Cloudflare Workers, Vercel Functions) — keine nativen Node-Bindings, keine Dateisystem-Zugriffe beim Import, tree-shakeable Re-Packaging von `pdf.js`. `extractText(pdf, { mergePages: false })` liefert Text **pro Seite** (Array), woraus sich `pageOffsets` für `metadata.page` direkt ableiten lassen.

*Alternative (verworfen):* `pdf-parse` — einfachere API, aber ältere Versionen laden beim Import testweise eine lokale Beispiel-PDF vom Dateisystem, was in manchen Serverless-Bundlern (Vercel) zur Build-/Runtime-Zeit bricht; zudem kein sauberer Per-Page-Text-Modus ohne Zusatzaufwand.

### Empfehlung: Web-Haupttext-Extraktion — `@mozilla/readability` + `linkedom`

**Empfehlung: `@mozilla/readability` (Readability-Port, der auch Firefox' Leseansicht antreibt) + `linkedom`** als DOM-Parser. `linkedom` ist deutlich leichter/schneller als `jsdom` (keine native Abhängigkeiten, kleinerer Serverless-Bundle), reicht aber für das DOM-Subset, das Readability braucht. Ergebnis: sauberer Haupttext ohne Nav/Footer/Ads/Sidebar — deutlich bessere Chunk-Qualität als ein naiver HTML-Strip.

*Alternative (verworfen):* naives Text-Stripping (alle Tags entfernen) — einfacher, aber holt Navigations-/Footer-/Cookie-Banner-Text mit rein, verwässert die Chunks und damit die RAG-Antwortqualität.

## 10. Fehler-Matrix

| Ursache | Wo erkannt | Verhalten | `status` | `error_message` (Beispiel) | User-Aktion |
|---|---|---|---|---|---|
| Kaputtes/verschlüsseltes PDF | `extractPdfText` wirft | Abbruch vor Chunking | `error` | „PDF konnte nicht gelesen werden (beschädigt oder passwortgeschützt)." | Retry (nach neuem Upload) oder Delete |
| Bild-PDF ohne Textlayer | `extractPdfText` liefert leeren/nur-Whitespace-Text | Abbruch vor Chunking | `error` | „Kein Text im PDF gefunden — gescannte/Bild-PDFs werden ohne OCR nicht unterstützt." | Delete (kein Retry sinnvoll) |
| Web-URL nicht erreichbar (404/DNS-Fehler) | `fetch` wirft oder `!response.ok` | Abbruch vor Extraktion | `error` | „Seite nicht erreichbar (404)." | Retry oder URL korrigieren + neue Source |
| SSRF-Guard blockiert URL (private/loopback/link-local IP, Nicht-http(s)) | `assertSafeUrl` vor Fetch | Kein Request wird ausgeführt | `error` | „Diese URL ist nicht erlaubt." | Delete |
| Web-Fetch-Timeout (>15s) | `AbortController` | Abbruch | `error` | „Zeitüberschreitung beim Laden der Seite." | Retry |
| Web-Response kein HTML / leerer Haupttext nach Extraktion | Content-Type-Check bzw. `extractWebText` liefert <50 Zeichen | Abbruch | `error` | „Kein lesbarer Inhalt auf dieser Seite gefunden." | Delete |
| OpenAI-Fehler (Rate-Limit/5xx/ungültiger Key) | `embedChunks` wirft | Abbruch, kein Insert | `error` | „Embedding fehlgeschlagen — bitte erneut versuchen." | Retry |
| Teilweiser Embedding-Fail (Batch N von M schlägt fehl) | `embedChunks` wirft mitten in der Batch-Schleife | Alle bereits erfolgreichen Batches dieses Laufs werden verworfen (nichts wird inserted) | `error` | wie OpenAI-Fehler oben | Retry |
| DB-Insert-Fehler nach erfolgreichem Embedding | Insert-Call wirft | Bereits inserierte Chunks dieser Source werden gelöscht (Rollback) | `error` | „Speichern der Quelle fehlgeschlagen." | Retry |
| Storage-Upload (PDF) schlägt clientseitig fehl | Client-seitiger Storage-Call wirft | `processSourceAction` wird nicht aufgerufen | bleibt `pending` | — (kein serverseitiger Fehler) | manueller Retry-Button im UI (erneuter Upload-Versuch) |
| Text > 500.000 Zeichen / PDF > 20MB (Server-seitige Re-Validierung) | Zod-Schema bzw. Größen-Check bei `processSourceAction` | Abgelehnt **vor** Row-Erstellung bzw. vor Verarbeitung | Row wird nicht angelegt / `error` | „Datei/Text überschreitet das erlaubte Limit." | Kleinere Datei/kürzerer Text |
| Ownership-Verstoß (fremde `sourceId`) | Service-Check nach RLS-Fetch | Aktion abgelehnt, keine Mutation | unverändert | — | Kein UI-Pfad (Row nicht sichtbar) |
| Doppelter Retry während laufender Verarbeitung | Service prüft `status` vor Start | Zweiter Aufruf wird abgelehnt | unverändert (`processing`) | „Verarbeitung läuft bereits." | Warten, bis Panel pollt |

## 11. Datei-Struktur-Vorschlag

```
lib/ingestion/
  schema.ts                       # CreatePdfSourceSchema, ProcessSourceSchema, AddTextSourceSchema,
                                   # AddWebSourceSchema, RetrySourceSchema, DeleteSourceSchema
  chunker.ts                      # chunkText(text, opts): Chunk[] — pure, js-tiktoken cl100k_base
  extract.ts                      # extractPdfText (unpdf), extractWebText (readability+linkedom), assertSafeUrl
  embed.ts                        # embedChunks(texts): number[][] — ai SDK embedMany, Batches ≤100
  service.ts                      # createIngestionService(deps): IngestionService
  __tests__/
    chunker.test.ts                # Grenzfälle: Overlap, letzter Chunk, Text < 800 Token, Char-Offset-Invariante
    service.test.ts                # happy/error path je Methode, gestubbte deps (kein echter Netzwerk-/DB-Call)

app/(app)/notebooks/[notebookId]/sources/
  actions.ts                       # 'use server', export const maxDuration = 300
                                    # createPdfSourceAction, processSourceAction, addTextSourceAction,
                                    # addWebSourceAction, retrySourceAction, deleteSourceAction
  _components/
    sources-panel.tsx              # ersetzt den Platzhalter aus Spec 01, pollt via router.refresh()
    add-source-dialog.tsx          # Dialog mit Tabs-Wrapper
    pdf-upload-tab.tsx             # Drag&Drop/File-Picker + Client-Validierung + Upload-Orchestrierung
    text-source-tab.tsx            # Titel + Textarea + Zeichen-Zähler
    web-source-tab.tsx             # URL + optionaler Titel
    source-list.tsx
    source-list-item.tsx           # Icon, Titel, Status-Badge, Retry/Delete
    delete-source-dialog.tsx       # Confirm-Dialog

supabase/migrations/
  <timestamp>_create_sources_storage_bucket.sql   # insert into storage.buckets(...) + storage.objects-Policies

# Modifiziert
next.config.ts                     # experimental.serverActions.bodySizeLimit auf '2mb' (Text-Payload bis 500k Zeichen)
package.json                       # + js-tiktoken, unpdf, @mozilla/readability, linkedom, vitest (devDep)
app/(app)/notebooks/[notebookId]/page.tsx   # rendert <SourcesPanel> statt Platzhalter (aus Spec 01)
```

## 12. Akzeptanzkriterien

### A. Add-Source-Dialog & Tabs

- [ ] AC-1: GIVEN Sources-Panel WHEN User auf „Add source" klickt THEN öffnet sich ein `Dialog` (`data-test="add-source-dialog"`) mit 3 Tabs „PDF"/„Text"/„Web" (`data-test="add-source-tab-pdf|text|web"`).
- [ ] AC-2: GIVEN Dialog offen WHEN User Escape/Overlay/Close-Button nutzt THEN schließt der Dialog, ohne dass eine Source angelegt wird.
- [ ] AC-3: GIVEN PDF-Tab WHEN User eine Datei per Drag&Drop oder File-Picker wählt THEN werden Dateiname + Größe angezeigt und der Submit-Button (`data-test="pdf-upload-submit"`) aktiviert.
- [ ] AC-4: GIVEN PDF-Tab WHEN die gewählte Datei >20MB ist ODER MIME-Type ≠ `application/pdf` ist THEN erscheint eine Inline-Fehlermeldung und der Submit-Button bleibt deaktiviert.
- [ ] AC-5: GIVEN Text-Tab WHEN Titel oder Textarea leer sind THEN ist der Submit-Button (`data-test="text-source-submit"`) deaktiviert.
- [ ] AC-6: GIVEN Text-Tab WHEN die Textarea >500.000 Zeichen enthält THEN wird der Zeichen-Zähler als Fehler markiert und Submit blockiert.
- [ ] AC-7: GIVEN Web-Tab WHEN das URL-Feld eine syntaktisch ungültige URL oder ein Nicht-http(s)-Schema enthält THEN wird Submit (`data-test="web-source-submit"`) blockiert mit Inline-Fehlermeldung.

### B. PDF-Upload-Flow

- [ ] AC-8: GIVEN validem PDF-Submit WHEN `createPdfSourceAction` aufgerufen wird THEN wird eine `sources`-Row mit `status='pending'`, `type='pdf'`, `storage_path='{user_id}/{source_id}.pdf'` angelegt und `{ sourceId, storagePath }` zurückgegeben.
- [ ] AC-9: GIVEN `{ sourceId, storagePath }` vom Server WHEN der Client die Datei direkt in den `sources`-Bucket hochlädt THEN gelingt das nur, weil `storage_path`-Prefix `= auth.uid()` ist (Storage-RLS greift, kein Umweg über eine Server-Action mit Datei-Body).
- [ ] AC-10: GIVEN erfolgreicher Storage-Upload WHEN der Client `processSourceAction({ sourceId })` aufruft THEN wechselt `status` zu `processing` und die Pipeline (Extraktion→Chunking→Embedding→Persist) läuft serverseitig synchron innerhalb dieser Action.
- [ ] AC-11: GIVEN der Storage-Upload schlägt clientseitig fehl WHEN `processSourceAction` deshalb nicht aufgerufen wird THEN bleibt die Source auf `status='pending'` mit einem sichtbaren „Upload nicht abgeschlossen"-Hinweis und einem manuellen Retry-Button.

### C. Text-Source-Flow

- [ ] AC-12: GIVEN validem Text-Submit WHEN `addTextSourceAction` aufgerufen wird THEN wird eine Row mit `type='text'`, `content_text=<Text>` angelegt und die Pipeline (Chunking→Embedding→Persist) läuft synchron in derselben Action.
- [ ] AC-13: GIVEN erfolgreicher Verarbeitung WHEN die Action zurückkehrt THEN ist `status='ready'` und die Anzahl gespeicherter `chunks`-Rows entspricht `chunkText(text).length`.

### D. Web-Source-Flow

- [ ] AC-14: GIVEN validem Web-Submit WHEN `addWebSourceAction` aufgerufen wird THEN läuft `assertSafeUrl(url)` VOR jedem Netzwerk-Request.
- [ ] AC-15: GIVEN eine URL, die zu einer privaten/loopback/link-local IP auflöst THEN wird die Verarbeitung mit `status='error'` abgebrochen, ohne dass ein Fetch stattfindet.
- [ ] AC-16: GIVEN kein Titel angegeben WHEN die Seite erfolgreich geladen wird THEN wird der Titel aus dem `<title>`-Tag übernommen; fehlt dieser, wird die Domain als Titel verwendet.
- [ ] AC-17: GIVEN ein Redirect während des Fetches WHEN das Redirect-Ziel gegen den SSRF-Guard verstößt THEN wird die Verarbeitung abgebrochen (jeder Redirect-Hop wird geprüft, nicht nur die Ursprungs-URL).
- [ ] AC-18: GIVEN der Web-Fetch überschreitet 15s THEN wird die Verarbeitung mit `status='error'` und einer Timeout-Meldung abgebrochen.

### E. Chunking (`chunker.ts`)

- [ ] AC-19: GIVEN ein Text mit mehr als 800 Token WHEN `chunkText` aufgerufen wird THEN hat jeder Chunk außer ggf. dem letzten genau 800 Token.
- [ ] AC-20: GIVEN zwei aufeinanderfolgende Chunks WHEN ihre Token-Bereiche verglichen werden THEN überlappen sie sich um genau 100 Token.
- [ ] AC-21: GIVEN ein beliebiger Chunk WHEN `chunk.content` mit `sourceText.slice(charStart, charEnd)` verglichen wird THEN sind beide Strings identisch.
- [ ] AC-22: GIVEN ein Text mit weniger als 800 Token WHEN `chunkText` aufgerufen wird THEN wird genau 1 Chunk zurückgegeben, der den kompletten Text enthält.
- [ ] AC-23: GIVEN der letzte Chunk eines Texts WHEN sein `charEnd` geprüft wird THEN entspricht er exakt `text.length`.

### F. Embedding & Persistierung

- [ ] AC-24: GIVEN gechunkter Text WHEN Embeddings erzeugt werden THEN laufen die `embedMany`-Calls in Batches von maximal 100 Chunk-Inhalten.
- [ ] AC-25: GIVEN alle Chunks einer Source erfolgreich embedded WHEN sie persistiert werden THEN erhält jede `chunks`-Row `embedding` (1536 Dimensionen) sowie `metadata.char_start`/`metadata.char_end` (und bei PDF, falls ermittelbar, `metadata.page`).
- [ ] AC-26: GIVEN ein Fehler in irgendeinem Embedding-Batch WHEN die Verarbeitung abbricht THEN existiert für diese Source **kein** `chunks`-Eintrag in der DB und `status='error'`.
- [ ] AC-27: GIVEN ein Fehler beim finalen DB-Insert nach erfolgreichem Embedding WHEN die Verarbeitung abbricht THEN werden bereits inserierte Chunks dieser Source wieder gelöscht und `status='error'`.

### G. Source-Liste — Anzeige

- [ ] AC-28: GIVEN Sources-Panel mit ≥1 Source WHEN gerendert THEN zeigt jede Zeile Typ-Icon, Titel und Status-Badge (`data-test="source-status-badge"`).
- [ ] AC-29: GIVEN eine Source mit `status='ready'` THEN zeigt das Badge zusätzlich die Chunk-Anzahl (z.B. „Bereit · 42 Chunks").
- [ ] AC-30: GIVEN eine Source mit `status='error'` THEN wird `error_message` sichtbar angezeigt und ein Retry-Button (`data-test="source-retry-button"`) erscheint.
- [ ] AC-31: GIVEN ≥1 Source im Panel mit `status IN ('pending','processing')` WHEN die Seite offen bleibt THEN pollt der Client alle 2s, bis alle Sources einen finalen Status erreicht haben, und stoppt danach automatisch.

### H. Retry & Delete

- [ ] AC-32: GIVEN User klickt „Retry" bei einer Error-Source THEN wechselt `status` zu `processing`, `error_message` wird geleert, und die Pipeline läuft erneut (Re-Extraktion: bei `web` erneuter Fetch, bei `pdf` erneuter Storage-Download, bei `text` Re-Chunking des bestehenden `content_text`).
- [ ] AC-33: GIVEN User klickt „Delete" (`data-test="source-delete-button"`) WHEN der Confirm-`Dialog` bestätigt wird THEN wird die Source inkl. aller `chunks` (FK-Cascade) gelöscht; bei Abbruch bleibt die Source unverändert.
- [ ] AC-34: GIVEN eine gelöschte PDF-Source WHEN die Delete-Action ausgeführt wird THEN wird zusätzlich zur DB-Row auch die Datei im Storage-Bucket entfernt.

### I. Fehlerfälle (Extraction/Fetch)

- [ ] AC-35: GIVEN ein beschädigtes/verschlüsseltes PDF WHEN `extractPdfText` wirft THEN wird `status='error'` mit einer verständlichen `error_message` gesetzt, ohne dass Chunking/Embedding versucht wird.
- [ ] AC-36: GIVEN ein PDF ohne extrahierbaren Text (Bild-PDF) WHEN die Extraktion einen leeren/nur-Whitespace-String liefert THEN wird `status='error'` mit der Meldung „kein Text gefunden" gesetzt statt einer leeren `ready`-Source mit 0 Chunks.
- [ ] AC-37: GIVEN eine Web-URL, die 404 liefert THEN wird `status='error'` mit einer 404-spezifischen Meldung gesetzt.

### J. Sicherheit & Validierung

- [ ] AC-38: GIVEN kein authentifizierter User WHEN irgendeine Ingestion-Action aufgerufen wird THEN schlägt sie mit „Unauthorized" fehl (fail-closed über `enhanceAction`).
- [ ] AC-39: GIVEN eine `sourceId`, die einem anderen User gehört WHEN `processSourceAction`/`retrySourceAction`/`deleteSourceAction` aufgerufen wird THEN wird sie abgelehnt (RLS liefert leeres Resultat + expliziter Ownership-Check im Service verhindert eine irrtümliche Neuanlage/Verarbeitung).
- [ ] AC-40: GIVEN ein PDF-Upload, dessen tatsächliche Server-seitige Größe/MIME (nach Storage-Download) von der Client-Angabe abweicht THEN wird dies vor der Extraktion erneut geprüft und bei Verstoß mit `status='error'` abgebrochen.
- [ ] AC-41: GIVEN eine Source mit `status='processing'` WHEN `retrySourceAction` für dieselbe Source erneut aufgerufen wird THEN wird der zweite Aufruf abgelehnt (kein doppelter paralleler Verarbeitungslauf).

## 13. Definition of Done (Qualitäts-Gates)

- [ ] DoD-DB: neue Migration legt Storage-Bucket `sources` (private, 20MB-Limit, `application/pdf`-only) **und** `storage.objects`-RLS-Policies (owner-only via Pfad-Prefix) in derselben Migration an; `lib/database.types.ts` nach der Migration neu generiert (`supabase gen types typescript --local > lib/database.types.ts`).
- [ ] DoD-Auth: jede Ingestion-Action läuft über `enhanceAction({ auth: true, schema })`; `user.id` kommt ausschließlich aus `supabase.auth.getUser()`; `processSource`/`retrySource`/`deleteSource` prüfen Ownership explizit im Service zusätzlich zu RLS.
- [ ] DoD-i18n: kein Gate (projektweit optional) — Strings dürfen hartkodiert bleiben.
- [ ] DoD-Test-Selektoren: `data-test` auf jedem interaktiven Element (Tab-Trigger, Datei-Dropzone, alle Submit-Buttons, Status-Badge, Retry-/Delete-Button, Confirm-/Abbrechen-Buttons im Delete-Dialog).
- [ ] DoD-Nav/Routing: kein neuer Top-Level-Route nötig (Panel lebt in `/notebooks/[notebookId]` aus Spec 01); `SourcesPanel` ersetzt den dortigen Platzhalter.
- [ ] DoD-Verify: `pnpm tsc --noEmit` → 0 Fehler.
- [ ] DoD-Verify: `pnpm next lint` → 0 Fehler.
- [ ] DoD-Verify: `pnpm next build` → erfolgreich.
- [ ] DoD-Unit-Test-Chunker: `chunkText` hat Tests für Overlap-Korrektheit (genau 100 Token zwischen Nachbar-Chunks), letzten Chunk (`charEnd === text.length`), Text < 800 Token (genau 1 Chunk), und die Char-Offset-Invariante (`content === text.slice(charStart, charEnd)`).
- [ ] DoD-Unit-Test-Service: `IngestionService` hat für `createTextSource`/`createWebSource`/`processSource` je mindestens 1 Happy-Path- (führt zu `status='ready'` mit erwarteter Chunk-Anzahl) und 1 Error-Path-Test (embed/extract-Stub wirft → `status='error'`, keine Chunks in der Mock-DB), gegen gestubbte Dependencies (kein echter Netzwerk-/OpenAI-/DB-Call).
- [ ] DoD-SSRF: dedizierter Test für `assertSafeUrl` — mindestens je 1 Fall für `localhost`, eine private IPv4 (`10.x`/`172.16-31.x`/`192.168.x`), `127.0.0.1`, ein Nicht-http(s)-Schema (`file://`) — alle müssen werfen; eine öffentliche HTTPS-URL darf nicht werfen.
- [ ] DoD-QA: alle AC-1…AC-41 grün verifiziert (manuell oder via `/qa`).

## 14. Risks & Open Questions

- **Reihenfolge-Abhängigkeit von Spec 01**: Diese Spec setzt voraus, dass `/notebooks/[notebookId]` (inkl. Sources-Panel-Platzhalter) aus Spec 01 bereits gebaut ist. Ist Spec 01 zum Build-Zeitpunkt dieser Spec noch nicht umgesetzt, muss sie zuerst gebaut werden — kein Blocker für die Spec selbst, aber für die Reihenfolge des Builds.
- **Vercel-Timeout bei sehr großen PDFs**: Ein 20MB-PDF mit sehr viel Text kann tausende Chunks erzeugen → mehrere Minuten Embedding-Zeit. `maxDuration=300` (Annahme: Pro-Plan) reduziert, löst das Risiko aber nicht vollständig. Echte Lösung (Queue) ist bewusst Non-Goal v1.
- **Scope-Creep-Risk**: Chunk-Parameter-UI (User stellt 800/100 selbst ein), semantisches Chunking, Multi-File-Upload, Website-Crawling, OCR — bewusst nicht Teil dieser Spec.
- **Architektur-Entscheidung „Content-Text bei PDF"**: Siehe §4 Punkt 4 — Brief-Wortlaut war an dieser Stelle mehrdeutig, hier explizit aufgelöst (Annahme 3, zur Review markiert).
- **Storage-Cleanup bei Notebook-Löschung**: Löscht ein User ein ganzes Notebook (Spec 01), räumt die DB-FK-Cascade `sources`/`chunks` automatisch auf — Storage-Objekte (PDF-Dateien) verwaisen dabei aber, weil dieser Fall nicht über `deleteSourceAction` läuft. Nicht Teil dieser Spec, sollte aber vor Spec-01-Delete-Rollout oder als kleiner Follow-up (z.B. Trigger/Edge Function) nachgezogen werden. **Kein Blocker**, da Notebook-Delete bereits in Spec 01 spezifiziert und unabhängig shippbar ist.
- **Kein Blocker identifiziert** — diese Spec ist approval-ready, kein `🚧 BLOCKER`.

## 15. Annahmen (für Review)

1. **PDF-Upload-Architektur**: Client lädt direkt zu Supabase Storage hoch (nicht über den Server-Action-Body), um Vercels harte ~4.5MB-Request-Limit für Serverless Functions zu umgehen. Die Server-Action erstellt nur die `pending`-Row vorab und triggert die Verarbeitung danach separat (§4 Punkt 2).
2. **PDF-Sources befüllen `content_text`** zusätzlich zu `storage_path` mit dem extrahierten Volltext, damit `char_start`/`char_end`-Offsets (Fixed Contract 3) auch für PDF-Citations (Spec 03) funktionieren (§4 Punkt 4).
3. **Embedding ist pro Source atomar** — entweder alle Chunks werden mit Embedding persistiert und `status='ready'`, oder gar keine Chunks bleiben in der DB (Rollback-by-delete) und `status='error'` (§4 Punkt 3).
4. **Vercel-Plan wird als „Pro" angenommen** (`maxDuration` bis 300s ohne Fluid-Compute-Sonderkonfiguration) → `export const maxDuration = 300` in der Ingestion-Actions-Datei. Auf Hobby (60s-Limit) könnten sehr große PDFs zusätzlich gedrosselt werden müssen — Risiko dokumentiert (§14), keine Lösung v1.
5. **Web-Fetch-Parameter**: Timeout 15s, Max-Response-Size 10MB, max. 5 Redirect-Hops (jeder erneut SSRF-geprüft) — im Brief nicht vorgegeben, hier als sinnvoller Default gesetzt.
6. **Status-Update-Mechanismus**: Client-Komponente pollt via `router.refresh()` alle 2s, solange ≥1 Source `pending`/`processing` ist; kein Supabase Realtime (spätere Optimierung, nicht v1) (§4 Punkt 5).
7. **Vitest** ist eine Implementierungsempfehlung, kein hartes Spec-Requirement (analog Spec 01, Annahme 10 dort) — im Projekt noch nicht konfiguriert, wird mit diesem Feature als Dev-Dependency + Minimal-Config eingeführt, da DoD-Unit-Test sonst nicht erfüllbar ist.
8. **PDF-Titel** ist im Dialog ein Pflichtfeld, Default-Vorschlag = Dateiname ohne `.pdf`-Endung, editierbar — der Brief nennt für den PDF-Tab keinen expliziten Titel-Workflow.
9. **Leerer/zu kurzer extrahierter Text** (<50 Zeichen) bei PDF oder Web wird als Fehler behandelt statt als leere `ready`-Source mit 0 Chunks (§10 Fehler-Matrix).
10. **Retry bei Web-Sources** fetcht die URL erneut (nicht nur Re-Chunking eines evtl. vorhandenen `content_text`), weil ein vorheriger Fehler häufig schon vor dem Setzen von `content_text` auftrat.
11. **Web-URLs, die auf Nicht-HTML-Content zeigen** (z.B. direkt auf eine PDF-Datei), werden als Fehler behandelt, nicht automatisch in die PDF-Pipeline umgeleitet — explizit Non-Goal v1.
12. **Migration-Dateiname** für den Storage-Bucket ist ein Platzhalter (`<timestamp>_create_sources_storage_bucket.sql`); der reale Timestamp wird beim Build via `supabase migration new create_sources_storage_bucket` erzeugt.
13. **Keine Pagination** der Source-Liste pro Notebook in v1 — kein Performance-Ziel definiert, spätere Pagination ist Non-Goal.
14. **`next.config.ts`**: `experimental.serverActions.bodySizeLimit` wird auf `'2mb'` angehoben (Default 1MB), um 500.000-Zeichen-Text-Payloads sicher unter Vercels hartem 4.5MB-Plattformlimit abzudecken.

---

**Empfohlener nächster Schritt:** `/plan-eng-review specs/02-ingestion.md` (non-trivial: DB + Service + Server-Action + UI + externe Netzwerk-/API-Calls), danach `/feature-builder` mit dieser Spec als Input (Build-Reihenfolge: nach Spec 01), danach `/qa` gegen AC-1…AC-41.

`Spec written: specs/02-ingestion.md — 41 acceptance criteria, kein Blocker, next: /plan-eng-review`
