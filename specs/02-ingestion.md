# Source-Ingestion — Feature-Spec

| Feld | Wert |
|---|---|
| **Feature-Name** | `source-ingestion` |
| **Bereich/Modul** | Notebook-Detailseite — Sources-Panel (linkes Panel, Platzhalter aus Spec 01) |
| **Layers betroffen** | DB (neue Migration: Storage-Bucket + Policies **+ pgmq-Queue + pg_cron-Schedule**, Eng-Review 2026-07-19), Service, API/Server-Action **+ Worker-Route-Handler**, UI |
| **Sichtbarkeit** | customer-facing, ausschließlich für eingeloggte User |
| **Modus** | NEW |
| **Non-trivial?** | Ja (DB + Service + Server-Action + Worker/Queue + UI + externe Netzwerk-/API-Calls) → `/plan-eng-review` vor Build empfohlen |

---

## 1. Ziel/Scope

User können in einem Notebook Wissensquellen hinzufügen — PDF-Upload, eingefügter Text oder eine Web-URL — die serverseitig extrahiert, in 800-Token-Chunks mit 100-Token-Overlap zerlegt, per OpenAI `text-embedding-3-small` embedded und in `public.chunks` (pgvector) persistiert werden. Der Sources-Panel-Platzhalter aus Spec 01 (`/notebooks/[notebookId]`, linkes Panel) wird mit einem „Add source"-Dialog und einer Source-Liste (Status-Badges, Chunk-Count, Retry, Delete) gefüllt. Diese Chunks sind die Grundlage für RAG-Chat (spätere Spec) und Citation-Highlighting (Spec 03), das die in `chunks.metadata` gespeicherten Char-Offsets konsumiert.

**(Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur, Product-Owner-Entscheidung 2026-07-19):** Die eigentliche Extraktions-/Chunking-/Embedding-Pipeline läuft **nicht mehr synchron in der Server-Action**, sondern asynchron über eine **pgmq-Queue + pg_cron-getriggerten Worker**. Add-Actions legen die `pending`-Row an, enqueuen einen Job und kehren sofort zurück; ein periodisch getriggerter Worker-Route-Handler zieht Jobs aus der Queue und führt dieselbe Pipeline aus (siehe §4 Punkt 1, §7, §9). Das war ursprünglich (siehe Non-Goals, jetzt korrigiert) als „kein v1-Scope" markiert — per Entscheid vom 2026-07-19 ist die Queue jetzt v1-Scope, weil sie das Vercel-Timeout-Risiko strukturell statt nur durch einen hohen `maxDuration`-Wert entschärft.

`public.sources` und `public.chunks` (inkl. RLS, HNSW-Index) existieren bereits seit `supabase/migrations/20260719103134_create_core_schema.sql`. **Für dieses Feature sind zwei neue Migrationen nötig: (1) Storage-Bucket + `storage.objects`-Policies, (2) pgmq-Queue `ingestion_jobs` + pg_cron-Schedule (siehe §8) — keine neuen Spalten/Tabellen für `sources`/`chunks` selbst.**

## 2. Non-Goals (explizit außerhalb v1)

- Kein OCR — Bild-/gescannte PDFs ohne Textlayer werden als Fehler behandelt, nicht verarbeitet.
- Keine Bilder/Diagramme aus PDFs extrahiert oder gespeichert.
- Kein YouTube/Audio/Video als Source-Typ (nur `pdf` / `text` / `web`, wie im DB-Check-Constraint).
- ~~Keine asynchrone Queue (Background-Jobs, Worker) — v1 ist synchron in Server Actions.~~ **(Eng-Review 2026-07-19, Nachtrag — Product-Owner-Entscheidung): gestrichen.** Die asynchrone Queue (pgmq + pg_cron) ist jetzt v1-Scope (siehe §1, §4 Punkt 1). Non-Goal bleibt stattdessen: **kein Multi-Worker-Autoscaling / keine Prioritäts-Queues v1** — ein einzelner pg_cron-getriggerter Worker-Tick verarbeitet Jobs sequenziell/in kleiner fester Batch-Größe, keine dynamische Skalierung mehrerer paralleler Worker-Instanzen und keine Job-Priorisierung (FIFO reicht v1).
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

### Queue-Inventar (Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur)

- `pgmq` (Postgres Message Queue Extension) ist auf Supabase verfügbar, aber im Projekt **noch nicht aktiviert** (`create extension if not exists pgmq;` fehlt).
- `pg_cron` ist auf Supabase verfügbar, ebenfalls noch nicht aktiviert.
- `pg_net` (für HTTP-Calls aus Postgres heraus, nötig damit `pg_cron` den Worker-Route-Handler per HTTP triggern kann) ist auf Supabase verfügbar, noch nicht aktiviert.
- Kein Worker-Route-Handler (`app/api/ingestion-worker/route.ts`) vorhanden — braucht diese Spec neu (siehe §9, §11).

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

**(Eng-Review 2026-07-19, F5) Node-Version pinnen:** `unpdf`/PDF.js v5 nutzt ES2024
`Promise.withResolvers`, das erst ab Node 22 nativ verfügbar ist. `package.json` bekommt
`"engines": { "node": ">=22" }`, und das Vercel-Projekt muss explizit auf Node 22.x gesetzt
werden (Project Settings → Node.js Version), da Vercel sonst ggf. eine ältere LTS-Version
verwendet. Siehe DoD-Node-Version.

## 4. Architektur-Entscheidungen

Diese Entscheidungen sind für den Build bindend (nicht Teil der offenen Fragen in §14):

1. **Ablauf v1 (Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur, ersetzt die ursprüngliche „synchron, keine Queue"-Entscheidung vollständig): asynchron über pgmq + pg_cron.** Add-Actions (`createPdfSourceAction`/`processSourceAction`-PDF-Pfad, `addTextSourceAction`, `addWebSourceAction`) legen die `sources`-Row (`status='pending'`) an, enqueuen einen Job `{ source_id }` in die pgmq-Queue `ingestion_jobs` und kehren **sofort** zurück — keine Server-Action läuft mehr die schwere Pipeline inline. Ein **pg_cron**-Schedule (alle 15s, siehe §8) triggert per `pg_net`-HTTP-Call periodisch `app/api/ingestion-worker/route.ts` (`export const maxDuration = 300`). Der Worker liest Jobs via `pgmq.read('ingestion_jobs', vt=600, qty=<klein, z.B. 3>)`, setzt pro Job `status='processing'`, ruft **dieselben** Service-Methoden auf, die vorher inline in den Actions liefen (extract→chunk→embed→persist, siehe §9), setzt `ready`/`error`, und `pgmq.delete`/`pgmq.archive` den Job bei jedem erreichten Endzustand (`ready` **oder** `error` — ein regulärer, behandelter Fehler ist kein Grund für ein automatisches Queue-Retry, das entscheidet weiterhin explizit der User über „Retry", siehe AC-32).

   **Warum das das Vercel-Timeout-Risiko strukturell löst statt nur zu verschieben:** Die User-facing Server-Action ist jetzt in Millisekunden fertig (nur Row-Insert + Queue-Send) — ein 20MB-PDF mit tausenden Chunks blockiert nie mehr eine Request/Response-Interaktion des Users. Das `maxDuration=300`-Risiko existiert weiterhin, aber jetzt ausschließlich für den **Worker-Endpoint**, dessen Timeout kein User-sichtbares UI blockiert (das Panel pollt ohnehin async).

   **Crash-Resilienz (natürliches Retry):** `pgmq`s Visibility-Timeout (`vt=600`, 10 Minuten — bewusst > `maxDuration=300` des Workers, damit ein noch legitim laufender Job nicht während der eigenen Verarbeitung erneut ausgeliefert wird) sorgt dafür, dass ein Job, dessen Worker-Invocation crasht/timeoutet **bevor** er `pgmq.delete` aufruft, nach Ablauf der Visibility-Timeout automatisch erneut zugestellt wird (`pgmq.read` liefert ihn beim nächsten Cron-Tick erneut). Kein manuelles Retry nötig für Infrastruktur-Crashes — nur für inhaltliche Fehler (kaputtes PDF etc.), die der Worker sauber als `status='error'` beendet (siehe §9, §10 Fehler-Matrix, neue ACs AC-47…AC-49).

   **`maxDuration`-Übersicht, final (löst F2/OV7 endgültig auf):**
   | Route | Datei | `maxDuration` | Grund |
   |---|---|---|---|
   | Ingestion-Worker | `app/api/ingestion-worker/route.ts` | **300** | Zieht Jobs aus `ingestion_jobs`, führt die volle Pipeline aus |
   | Chat | `app/api/chat/route.ts` (Spec 03) | **120** | Streaming-Antwort, siehe Spec 03 §3.4 |
   | Sources-Actions | `app/(app)/notebooks/[notebookId]/sources/actions.ts` | **keins** | `'use server'`-Datei, nur async Function-Exports erlaubt; Actions sind jetzt ohnehin schnell (nur Enqueue) |
   | Notebook-Detail-Page | `app/(app)/notebooks/[notebookId]/page.tsx` (Spec 01) | **keins** | Reiner Server-Component-Fetch, keine lange Operation läuft mehr von hier aus |

   Der Service-Schnitt in §9 hält Extraktion/Chunking/Embedding/Persistenz weiterhin als einzeln aufrufbare, reine Methoden — das war bereits für eine spätere Queue vorbereitet und wird mit diesem Rearchitektur-Schritt eingelöst, nicht verworfen.

2. **PDF-Upload läuft NICHT über den Server-Action-Body.** Vercel-Serverless-Functions haben ein hartes Request-Body-Limit (~4.5MB) für Server Actions und Route Handler — bei bis zu 20MB PDFs nicht tragbar. Stattdessen: Client lädt die Datei **direkt in Supabase Storage** hoch (Storage-RLS schützt den Pfad-Prefix = `auth.uid()`), der Next.js-Server sieht die Binärdaten nie. Ablauf: (a) `createPdfSourceAction` legt eine `pending`-Row an und liefert `{ sourceId, storagePath }`; (b) Client lädt clientseitig direkt zu Storage hoch; (c) Client ruft `processSourceAction({ sourceId })` — **(Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur)** diese Action enqueued nur noch einen Job `{ source_id }` in `ingestion_jobs` und kehrt sofort zurück; der spätere pg_cron-getriggerte Worker liest den Job, lädt die Datei aus Storage und startet die Pipeline (siehe §4 Punkt 1).

3. **Embedding ist pro Source atomar.** Alle Chunk-Texte werden vollständig embedded — **(Eng-Review 2026-07-19, F7, korrigiert)** über einen einzigen `embedMany`-Call (`maxParallelCalls: 5`, kein manuelles 100er-Batching mehr, siehe §9 embed.ts) —, **bevor** irgendein DB-Insert passiert. Schlägt `embedChunks` fehl, wird abgebrochen, **kein** Chunk dieser Source landet in der DB, `status='error'`. Schlägt der finale Bulk-Insert nach erfolgreichem Embedding fehl, werden bereits inserierte Chunks dieser Source wieder gelöscht (Rollback-by-delete; Postgres-Transaktion wird nicht über die Embedding-API hinweg offengehalten). Kein sichtbarer Teilerfolg — entweder eine `ready`-Source mit vollständigen Chunks oder eine `error`-Source ganz ohne Chunks.

4. **Content-Text auch für PDF.** `content_text` wird für **alle** Source-Typen mit dem extrahierten Volltext befüllt — auch bei `type='pdf'` (zusätzlich zu `storage_path`, das die Originaldatei referenziert). Grund: Chunk-Metadata-Contract (`char_start`/`char_end` als Offsets „in `sources.content_text`") funktioniert für PDF-Citation-Highlighting (Spec 03) nur, wenn `content_text` auch für PDFs existiert. Siehe Annahme 3.

5. **Status-Update-Mechanismus: Client-Polling, kein Realtime.** Eine Client-Komponente pollt (alle 2s) solange mindestens eine Source im Panel `status IN ('pending','processing')` hat, und stoppt automatisch, sobald alle Sources einen finalen Status (`ready`/`error`) erreicht haben. **(Eng-Review 2026-07-19, OV8):** Das Polling ruft **nicht** `router.refresh()` (globaler RSC-Refresh der gesamten `[notebookId]/page.tsx`) auf, sondern einen client-seitigen Status-Fetch, der nur den Sources-Subtree aktualisiert (z.B. `GET`/Server-Action, die nur die Source-Rows des Notebooks liefert und lokalen State im `SourcesPanel` patcht) — alternativ pausiert das Polling, solange ein Chat-Stream aktiv ist. Begründung: `SourcesPanel` und `ChatPanel` teilen sich dieselbe `[notebookId]/page.tsx`; ein globaler `router.refresh()` würde den `ChatPanel` inkl. eines gerade laufenden Streams mid-Stream neu rendern und den Stream sichtbar stören/abreißen lassen.

## 5. Soll-Zustand — User-Flow

1. User öffnet `/notebooks/[notebookId]`, sieht im Sources-Panel entweder eine Liste bestehender Sources oder (leer) einen Hinweistext + „Add source"-Button (`data-test="sources-add-button"`).
2. Klick auf „Add source" → zentrierter `Dialog` (`data-test="add-source-dialog"`) mit 3 Tabs: **PDF** (Default-Tab), **Text**, **Web**.
3. **PDF-Tab**: Drag&Drop-Fläche oder File-Picker-Button. Nach Dateiauswahl: Client-Validierung (MIME `application/pdf`, ≤20MB). Bei Erfolg: Dateiname + Größe angezeigt, „Upload"-Button aktiv. Submit → (a) `createPdfSourceAction` legt Source-Row an, (b) Client lädt Datei direkt zu Storage hoch (mit sichtbarem Upload-Spinner), (c) `processSourceAction` wird aufgerufen — **(Eng-Review 2026-07-19, Nachtrag)** enqueued nur einen Job und kehrt sofort zurück, (d) Dialog schließt, Source erscheint mit `status='pending'` in der Liste (wechselt zu `processing`, sobald der nächste Worker-Tick den Job zieht).
4. **Text-Tab**: Titel-Input (Pflicht) + Textarea (Pflicht, Zeichen-Zähler, Limit 500.000). Submit → `addTextSourceAction` legt Row an und **(Eng-Review 2026-07-19, Nachtrag)** enqueued einen Job, statt synchron zu verarbeiten. Dialog schließt, Source erscheint mit `status='pending'`.
5. **Web-Tab**: URL-Input (Pflicht, http/https), Titel-Input (optional). Submit → `addWebSourceAction` prüft `assertSafeUrl(url)` als schnellen synchronen Pre-Check (Fail-Fast bei offensichtlich verbotener URL, z.B. `localhost`/Nicht-http(s)-Schema — Action gibt dann direkt einen Fehler zurück, **ohne** Row-Erstellung), legt bei bestandenem Pre-Check die Row an und **(Eng-Review 2026-07-19, Nachtrag)** enqueued einen Job statt selbst zu fetchen/extrahieren. Der vollständige Redirect-Loop-SSRF-Guard (jeder Hop einzeln per DNS geprüft, siehe OV5/§9) läuft beim tatsächlichen Fetch **im Worker**, da Redirect-Ziele erst zur Fetch-Zeit bekannt sind. Dialog schließt, Source erscheint mit `status='pending'`.
6. Panel pollt, bis die neue Source `ready` (mit Chunk-Count) oder `error` (mit `error_message` + Retry-Button) zeigt. Zwischen Enqueue und dem nächsten pg_cron-Tick (bis zu ~15s, siehe §8) bleibt die Source sichtbar `pending`, danach `processing`.
7. Bei `error`: User klickt „Retry" (`data-test="source-retry-button"`) → ein neuer Job wird für dieselbe Source enqueued, `status` wechselt zurück auf `pending` und danach (nächster Worker-Tick) auf `processing`.
8. User klickt „Delete" (`data-test="source-delete-button"`) an einer Source → Confirm-`Dialog` mit Warntext (Source-Titel genannt) → Bestätigen löscht DB-Row (Chunks per Cascade) und ggf. das Storage-Objekt; Abbrechen ändert nichts.

## 6. UI-Verhalten — Loading / Empty / Error / Status

| Zustand | Verhalten |
|---|---|
| **Sources-Panel leer** | Hinweistext „Noch keine Quellen" + „Add source"-CTA (`data-test="sources-empty-cta"`). |
| **Sources-Panel mit Einträgen** | Liste, jede Zeile: Typ-Icon (PDF/Text/Web), Titel, Status-Badge (`data-test="source-status-badge"`), Kebab/Buttons für Retry (nur bei `error`) und Delete (immer). |
| **Status `pending`** | Badge zeigt „Wird verarbeitet…" (dezenter Spinner/Pulse), kein Chunk-Count. **(Eng-Review 2026-07-19, Nachtrag)** Deckt jetzt zwei Unterzustände ab: „gerade erst angelegt/enqueued, wartet auf den nächsten pg_cron-Tick" (typ. <15s) und den alten „Storage-Upload nicht abgeschlossen"-Fall (AC-11) — beide zeigen dieselbe Badge, kein separater UI-Zustand nötig. Panel pollt alle 2s, solange ≥1 Source non-final ist — **(Eng-Review 2026-07-19, OV8)** scoped Status-Fetch statt globalem `router.refresh()` (siehe §4 Punkt 5), damit ein paralleler Chat-Stream nicht gestört wird. |
| **Status `processing`** | Badge zeigt „Wird verarbeitet…" (dezenter Spinner/Pulse), kein Chunk-Count — jetzt spezifisch: der Worker hat den Job aus `ingestion_jobs` gezogen und führt die Pipeline gerade aus. Gleiches Polling-Verhalten wie `pending`. |
| **Status `ready`** | Badge „Bereit · N Chunks" — **(Eng-Review 2026-07-19, F12)** Chunk-Count wird für alle Sources des Notebooks in **einer** gruppierten Query geladen (Supabase: `sources`-Select mit `chunks(count)`), nicht als N Einzel-Counts pro Source-Row. Grund: bei 2s-Polling wäre ein N+1-Query-Pattern (ein `count(chunks) where source_id=…` je sichtbarer Source) unnötige Last auf DB und Netzwerk. |
| **Status `error`** | Badge „Fehler" (destruktive Farbe) + `error_message`-Text unter der Zeile + Retry-Button. |
| **Status `processing` seit >10 Minuten** | **(Eng-Review 2026-07-19, OV2, umformuliert für Queue-Rearchitektur)** Primärer Mechanismus ist jetzt `pgmq`s eigene Visibility-Timeout (`vt=600`, siehe §4/§8): crasht der Worker mitten in der Pipeline, wird der Job nach 10 Minuten automatisch erneut zugestellt — die Source fällt ohne UI-Zutun zurück in eine erneute `processing`-Runde, kein manueller Eingriff nötig (siehe AC-49). Der Staleness-Guard (Source mit `status='processing'` und `updated_at` älter als 10 Minuten → als `error` behandelt, `error_message` = „Verarbeitung abgebrochen (Timeout/Neustart).") bleibt als **Fallback** bestehen für den Randfall, dass der Row-Status trotz Redelivery nicht mehr konsistent nachgezogen wird (z.B. der Job wurde bereits aus der Queue gelöscht, aber das finale Status-Update auf der Row schlug fehl). Badge + Retry-Button erscheinen in diesem Fallback-Fall wie bei jedem anderen `error`. |
| **PDF-Upload läuft** | Submit-Button im Dialog zeigt Pending-Text („Wird hochgeladen…" → „Wird verarbeitet…") und ist `disabled` (analog `useTransition`-Pattern aus Spec 01). |
| **Validierungsfehler (Formular)** | Inline-Fehlermeldung je Tab (z.B. „Datei zu groß", „URL ungültig", „Text zu lang") — Submit wird nicht ausgelöst, kein Server-Roundtrip. |
| **Mutation-Error (Create-Action wirft, z.B. DB down)** | Inline `Alert` im Dialog, Dialog bleibt offen, Eingaben bleiben erhalten. |
| **Delete-Error** | Error-`Toast`, Source bleibt in der Liste sichtbar (keine optimistische Entfernung vor Serverbestätigung). |

## 7. Pipeline-Diagramm

**(Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur):** vollständig überarbeitet — Add-Actions
enqueuen nur noch, ein pg_cron-getriggerter Worker führt die eigentliche Pipeline aus.

```
── PDF ─────────────────────────────────────────────────────────────────────
Client                    Server-Action (schnell)          Storage/DB              pgmq
------                    ------------------------          ----------              ----
validiere MIME+Size (≤20MB)
  │
  ├─ createPdfSourceAction ───► insert sources(status='pending',
  │                              type='pdf', storage_path=…)  ────────► DB
  │  ◄── { sourceId, storagePath } ──┘
  │
  ├─ Upload direkt zu Storage ─────────────────────────────────────────► Storage
  │   (RLS: Pfad-Prefix = auth.uid())                                    bucket "sources"
  │
  └─ processSourceAction(sourceId) ─► pgmq.send('ingestion_jobs', {source_id}) ──────► Queue
                                       ◄── Action kehrt sofort zurück (kein Warten auf Pipeline)

── Text ────────────────────────────────────────────────────────────────────
Client ─ addTextSourceAction({title, text}) ─► insert sources(status='pending',
                                                 type='text', content_text=text)
                                                pgmq.send('ingestion_jobs', {source_id}) ──► Queue
                                                ◄── Action kehrt sofort zurück

── Web ─────────────────────────────────────────────────────────────────────
Client ─ addWebSourceAction({url, title?}) ──► assertSafeUrl(url)  [schneller Pre-Check,
                                                 wirft bei offensichtlich verbotener URL
                                                 → Action gibt Fehler zurück, KEINE Row]
                                                insert sources(status='pending', type='web')
                                                pgmq.send('ingestion_jobs', {source_id}) ──► Queue
                                                ◄── Action kehrt sofort zurück

── Worker (für alle drei Typen identisch, läuft NICHT als Server-Action) ───────────────────
pg_cron (alle 15s) ─ pg_net.http_post ──► POST /api/ingestion-worker  [maxDuration=300]
                                            │
                                            ├─ pgmq.read('ingestion_jobs', vt=600, qty=3)
                                            │
                                            └─ pro Job { source_id }:
                                                 status → 'processing'
                                                 [type='pdf'] downloadFromStorage(storage_path)
                                                              extractPdfText() → content_text, pageOffsets
                                                 [type='web'] fetch mit manuellem Redirect-Loop
                                                              (jeder Hop: DNS-Resolve → Blocklist → pin,
                                                              siehe OV5) → extractWebText() → content_text
                                                 [type='text'] content_text bereits vorhanden
                                                 chunkText(content_text) → Chunk[]
                                                 embedChunks(chunk.content) → vector[]  [embedMany,
                                                              maxParallelCalls=5, siehe F7]
                                                 [alle OK?] insert chunks(+embedding+metadata)
                                                            status → 'ready'
                                                            pgmq.delete(job)  [Endzustand erreicht]
                                                 [Fehler]   rollback (delete inserted chunks)
                                                            status → 'error' (+error_message)
                                                            pgmq.delete(job)  [behandelter Fehler,
                                                            KEIN automatisches Queue-Retry — User
                                                            muss explizit „Retry" klicken]
                                                 [Crash/Timeout VOR pgmq.delete] kein expliziter Job-
                                                            State-Change — pgmq liefert den Job nach
                                                            Ablauf von vt=600s automatisch erneut aus
                                                            (natürliches Retry, siehe §4 Punkt 1)
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

**pgmq-Queue `ingestion_jobs` + pg_cron-Schedule (Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur):**

```sql
-- supabase/migrations/<ts>_create_ingestion_queue.sql
create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net;

select pgmq.create('ingestion_jobs');   -- Payload-Shape: { "source_id": "<uuid>" }

-- pg_cron triggert den Worker-Route-Handler per HTTP alle 15 Sekunden.
-- <APP_URL> und <WORKER_SECRET> sind Deployment-Konfiguration (kein Secret im Repo).
select cron.schedule(
  'ingestion-worker-tick',
  '15 seconds',
  $$
  select net.http_post(
    url := '<APP_URL>/api/ingestion-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.ingestion_worker_secret', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

- **Queue-Ops laufen ausschließlich service-role/server-seitig** (im Worker-Route-Handler mit `createAdminClient()`), **nicht** unter der User-Session — `pgmq`-Tabellen sind keine `authenticated`-Nutzer-Ressource, es gibt keine RLS-Policy für Client-Zugriff, `pgmq.send`/`pgmq.read`/`pgmq.delete` werden nie direkt vom Client aufgerufen. Add-Actions rufen `pgmq.send` über den Service (`enqueueIngestionJob`, siehe §9) ebenfalls service-seitig auf, nicht via Client-RPC.
- **Worker-Endpoint-Auth:** `POST /api/ingestion-worker` prüft den `Authorization: Bearer <WORKER_SECRET>`-Header gegen ein Server-Env-Var (z.B. `INGESTION_WORKER_SECRET`) — ohne gültigen Header `401`, kein `pgmq.read`. Verhindert, dass der Endpoint von außen beliebig oft getriggert wird.
- **Visibility-Timeout `vt=600`** (10 Minuten) ist bewusst größer als `maxDuration=300` des Workers (Sicherheitsmarge, damit ein noch legitim laufender Job nicht doppelt ausgeliefert wird) und deckungsgleich mit dem OV2-Staleness-Guard-Schwellwert (siehe §6) — beide Mechanismen greifen an derselben 10-Minuten-Marke.
- **Cron-Intervall 15s** ist ein v1-Default (kein hartes Requirement) — schnell genug, dass „pending" für den User nicht spürbar hängt, selten genug, um keine relevante DB-/Function-Last durch Leerläufe zu erzeugen (siehe Annahme 15).

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

  // (Eng-Review 2026-07-19, F6) Algorithmus-Contract, verbindlich:
  // NIEMALS decode(tokens.slice(a, b)) als chunk.content verwenden. cl100k_base ist ein
  // byte-level-BPE-Tokenizer — eine Token-Grenze kann ein Multi-Byte-Zeichen (Umlaut, Emoji,
  // CJK) mitten durchschneiden; decode() liefert dann U+FFFD-Replacement-Zeichen und die
  // charStart/charEnd-Offsets driften gegenüber dem Originaltext.
  // Stattdessen: Character-Offsets werden über einen Prefix-Decode ab Token 0 bestimmt und mit
  // `text.startsWith(prefix)` als Korrektheits-Orakel verifiziert; kollidiert die Token-Grenze
  // mit einem Multi-Byte-Zeichen, wird die Token-Grenze um 1 Token zurückgesnappt, bis das
  // Orakel hält. `chunk.content` wird IMMER über `text.slice(charStart, charEnd)` aus dem
  // Originaltext erzeugt, nie aus dekodierten Tokens rekonstruiert. Offsets werden an
  // Overlap-Grenzen gecacht (wiederverwendet statt neu berechnet), um die Prefix-Decode-Kosten
  // nicht quadratisch mit der Chunk-Zahl wachsen zu lassen.
  // Konsequenz für die Token-Ziele (siehe AC-19/AC-20, angepasst): 800/100 sind Zielwerte, kein
  // hartes Kriterium mehr — die Char-Offset-Invarianz (AC-21) hat Vorrang vor exakter Token-Zahl.

extract.ts
  extractPdfText(bytes: Uint8Array): Promise<{ text: string; pageOffsets: { page: number; charStart: number; charEnd: number }[] }>
  extractWebText(url: string, opts?: { timeoutMs?: number; maxBytes?: number }): Promise<{ text: string; title?: string }>
  assertSafeUrl(url: string): void   // SSRF-Guard, wirft bei Verstoß — Nutzung siehe unten (OV5)

  // (Eng-Review 2026-07-19, OV5) SSRF-Guard-Mechanismus, verbindlich:
  // Ein einmaliges assertSafeUrl(url) unmittelbar vor fetch(url) reicht NICHT — fetch() löst
  // DNS beim tatsächlichen Request erneut auf (TOCTOU/DNS-Rebinding: die IP zum Prüfzeitpunkt
  // kann eine andere sein als die IP zum Verbindungszeitpunkt) und folgt Redirects intransparent
  // (ein Redirect-Ziel wird nie gegen den Guard geprüft, wenn fetch() `redirect:'follow'` nutzt).
  // Stattdessen implementiert extract.ts den Fetch als manuellen Redirect-Loop:
  //   1. fetch(url, { redirect: 'manual' })
  //   2. Vor JEDEM Hop: Hostname der aktuellen URL per DNS auflösen, resultierende IP(s) gegen
  //      die Blocklist prüfen (private/loopback/link-local-Ranges, insbesondere explizit
  //      169.254.169.254 — Cloud-Metadata-Endpoint).
  //   3. Auf die geprüfte, gepinnte IP verbinden (nicht erneut über den Hostnamen re-resolven) —
  //      das schließt das DNS-Rebinding-Fenster zwischen Prüfung und Verbindung.
  //   4. Bei 3xx-Response: Location-Header extrahieren, Schritte 1–3 für das Redirect-Ziel
  //      wiederholen, max. 5 Hops (danach Abbruch als Fehler).
  // assertSafeUrl(url) bleibt als synchrone Vorab-Prüfung der Ursprungs-URL (schnelles Fail vor
  // jeglichem Netzwerk-Call), ersetzt aber NICHT die Pro-Hop-Prüfung im Redirect-Loop.

embed.ts
  embedChunks(texts: string[]): Promise<number[][]>
  // (Eng-Review 2026-07-19, F7) Implementierung: KEIN eigenes 100er-Batching mehr.
  // embedMany (ai SDK v7) batcht selbst nach maxEmbeddingsPerCall (OpenAI: 2048 pro Call).
  // Aufruf: embedMany({ model, values: <komplette Chunk-Content-Liste>, maxParallelCalls: 5 }).
  // maxParallelCalls muss explizit gesetzt werden — der SDK-Default ist Infinity, was bei vielen
  // Batches alle gleichzeitig feuern und OpenAI-Rate-Limits reißen würde. 5 ist der gewählte
  // Deckel für v1 (keine Config-Option, hartkodiert).

service.ts
  interface IngestionDeps {
    supabase: SupabaseClient
    extractPdfText, extractWebText, chunkText, embedChunks   // injiziert, in Tests stubbar
    downloadStorageFile(path: string): Promise<Uint8Array>
    deleteStorageFile(path: string): Promise<void>
    enqueueJob(sourceId: string): Promise<void>               // (Eng-Review 2026-07-19, Nachtrag) pgmq.send-Wrapper, injiziert/stubbar
  }
  createIngestionService(deps): IngestionService
    createPendingPdfSource({ notebookId, userId, title, fileName }) → { sourceId, storagePath }
    createTextSource({ notebookId, userId, title, text }) → Source           // (Eng-Review 2026-07-19, Nachtrag) legt
                                                                              // pending-Row an + enqueueJob(sourceId);
                                                                              // KEIN synchrones Verarbeiten mehr
    createWebSource({ notebookId, userId, url, title? }) → Source            // (Eng-Review 2026-07-19, Nachtrag) prüft
                                                                              // assertSafeUrl(url) als Pre-Check, legt
                                                                              // pending-Row an + enqueueJob(sourceId);
                                                                              // KEIN synchrones Fetch/Verarbeiten mehr
    enqueueIngestionJob({ sourceId, userId }) → void                         // (Eng-Review 2026-07-19, Nachtrag) NEU —
                                                                              // von processSourceAction (PDF-Pfad, nach
                                                                              // erfolgreichem Storage-Upload) aufgerufen;
                                                                              // Ownership-Check + pgmq.send, kein Processing
    runIngestionJob({ sourceId }) → Source                                   // (Eng-Review 2026-07-19, Nachtrag) NEU —
                                                                              // die eigentliche Pipeline (vormals
                                                                              // processSource: extract→chunk→embed→
                                                                              // persist, alle drei Source-Typen); wird
                                                                              // NUR vom Worker-Route-Handler aufgerufen,
                                                                              // nie direkt von einer Client-Action
    retrySource({ sourceId, userId }) → Source                               // guard: nur wenn status='error' (oder
                                                                              // stale processing, siehe AC-41-Ausnahme);
                                                                              // enqueued erneut einen Job statt selbst
                                                                              // zu verarbeiten
    deleteSource({ sourceId, userId }) → void                                // löscht Row + ggf. Storage-Objekt
    deleteNotebookStorageObjects({ notebookId, userId }) → void              // sammelt storage_paths aller PDF-Sources
                                                                              // des Notebooks und entfernt die Objekte
                                                                              // im Bucket (siehe Reihenfolge unten)
```

**(Eng-Review 2026-07-19, Nachtrag) Worker-Route-Handler-Contract** (`app/api/ingestion-worker/route.ts`,
`export const maxDuration = 300`, `export const runtime = 'nodejs'`):

```
POST /api/ingestion-worker
  Auth: Authorization: Bearer <INGESTION_WORKER_SECRET> (Server-Env-Var, Vergleich via
        constant-time-Check) — kein User-Auth, wird ausschließlich von pg_cron/pg_net getriggert.
  Ablauf:
    1. Secret prüfen, sonst 401.
    2. pgmq.read('ingestion_jobs', vt=600, qty=3) über createAdminClient() (service-role).
    3. Für jeden Job sequenziell: createIngestionService(...).runIngestionJob({ sourceId }),
       dann pgmq.delete(job) — unabhängig davon, ob runIngestionJob mit status='ready' oder
       status='error' endet (beides ist ein behandelter Endzustand). Wirft runIngestionJob
       selbst unbehandelt (Crash), bleibt der Job in der Queue und wird nach vt=600s erneut
       zugestellt (kein pgmq.delete in diesem Pfad).
    4. 200 mit { processed: number } — auch wenn 0 Jobs anstanden (leerer Tick ist normal).
```

**`deleteNotebookStorageObjects`** wird vom Notebook-Delete-Flow (Spec 01, `lib/notebooks/service.ts` `delete()`) aufgerufen, bevor bzw. nachdem das Notebook selbst gelöscht wird (Reihenfolge siehe unten). Sie liest `storage_path` aller `sources` des Notebooks mit `type='pdf' AND storage_path IS NOT NULL` und entfernt die zugehörigen Objekte im `sources`-Bucket.

**Reihenfolge Storage-Delete vs. DB-Delete (empfohlen):** (1) `storage_paths` **vor** dem DB-Delete lesen (danach sind die `sources`-Rows durch die FK-Cascade weg und die Pfade nicht mehr auflösbar); (2) DB-Delete des Notebooks ausführen (Cascade räumt `sources`/`chunks`/`messages` auf); (3) Storage-Delete **danach**, best-effort, mit Log bei Fehler. Begründung: Die DB ist die Quelle der Wahrheit für den User-sichtbaren Zustand — das Notebook muss aus Nutzersicht sofort weg sein, unabhängig davon, ob der Storage-Provider gerade Latenz/Fehler hat. Ein fehlgeschlagener Storage-Delete nach erfolgreichem DB-Delete hinterlässt im schlimmsten Fall ein verwaistes, aber unsichtbares Objekt (kein Datenleck, nur Speicherkosten) und wird geloggt statt die Notebook-Löschung selbst blockieren oder fehlschlagen zu lassen.

### Server-Actions (`app/(app)/notebooks/[notebookId]/sources/actions.ts`, alle `enhanceAction({ auth: true, schema })`)

**(Eng-Review 2026-07-19, F2, final aufgelöst durch die Queue-Rearchitektur — siehe §4 Punkt 1):**
`export const maxDuration = 300` steht **NICHT** in dieser Datei — `'use server'`-Dateien dürfen
nur async Functions exportieren, eine `const`-Export dort ist ein Build-Error. Das gilt jetzt
ohnehin unabhängig vom Build-Error-Argument: diese Actions sind seit der Queue-Rearchitektur nur
noch Row-Insert + `pgmq.send` und brauchen kein erhöhtes Timeout mehr. `maxDuration = 300` steht
stattdessen am **Worker-Route-Handler** `app/api/ingestion-worker/route.ts` (nicht — wie in einer
früheren Fassung dieser Spec — an `app/(app)/notebooks/[notebookId]/page.tsx`; die Page braucht
seit der Queue-Rearchitektur ebenfalls kein `maxDuration` mehr, siehe Tabelle in §4 Punkt 1).

```
createPdfSourceAction(input)  → ActionResult<{ sourceId: string; storagePath: string }>
processSourceAction(input)    → ActionResult<{ enqueued: true }>   // (Eng-Review 2026-07-19, Nachtrag)
                                                                    // enqueued nur noch, kein Source-Rückgabewert
                                                                    // mehr nötig (Panel liest Status via Polling)
addTextSourceAction(input)    → ActionResult<Source>               // Source mit status='pending'
addWebSourceAction(input)     → ActionResult<Source>                // Source mit status='pending'
retrySourceAction(input)      → ActionResult<{ enqueued: true }>   // (Eng-Review 2026-07-19, Nachtrag)
deleteSourceAction(input)     → ActionResult<{ success: true }>
```

**(Eng-Review 2026-07-19, F8):** `ActionResult<T> = { data: T } | { error: string }`, definiert
in `lib/server/action.ts` (geteilte Konvention mit Spec 01 — siehe dort §8). Kein lokales
Ad-hoc-Union-Type pro Action.

Alle rufen nach Erfolg `revalidatePath('/notebooks/[notebookId]', 'page')` **(Eng-Review
2026-07-19, OV10: Typ-Argument `'page'` erforderlich, sonst matcht der literale
Bracket-String keine reale URL und revalidiert nichts)**. `user.id` kommt ausschließlich aus
`supabase.auth.getUser()`. Ownership-Check (Source gehört User + Notebook) läuft doppelt: RLS
in der DB **und** ein expliziter Check im Service, bevor `processSource`/`retrySource`/`deleteSource`
etwas verändern (RLS allein liefert bei fremder ID nur ein leeres Resultat, kein Fehler — der
Service muss das explizit als „nicht gefunden/nicht erlaubt" behandeln, um `processSource` auf
einer fremden Row gar nicht erst zu starten).

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
| OpenAI-Fehler (Rate-Limit/5xx/ungültiger Key) | `embedChunks` (im Worker) wirft | Abbruch, kein Insert | `error` | „Embedding fehlgeschlagen — bitte erneut versuchen." | Retry |
| Teilweiser Embedding-Fail (Eng-Review 2026-07-19, F7, präzisiert: `embedMany` wirft für einen internen Batch) | `embedChunks` (im Worker) wirft mitten im `embedMany`-Call | Der gesamte `embedChunks`-Aufruf für diese Source schlägt fehl (kein Chunk dieser Source wird embedded gespeichert) | `error` | wie OpenAI-Fehler oben | Retry |
| DB-Insert-Fehler nach erfolgreichem Embedding | Insert-Call (im Worker) wirft | Bereits inserierte Chunks dieser Source werden gelöscht (Rollback) | `error` | „Speichern der Quelle fehlgeschlagen." | Retry |
| Storage-Upload (PDF) schlägt clientseitig fehl | Client-seitiger Storage-Call wirft | `processSourceAction` wird nicht aufgerufen, kein Job enqueued | bleibt `pending` | — (kein serverseitiger Fehler) | manueller Retry-Button im UI (erneuter Upload-Versuch) |
| Text > 500.000 Zeichen / PDF > 20MB (Server-seitige Re-Validierung) | Zod-Schema bei der Action bzw. Größen-Check im Worker vor Verarbeitung | Abgelehnt **vor** Row-Erstellung bzw. vor Verarbeitung im Worker | Row wird nicht angelegt / `error` | „Datei/Text überschreitet das erlaubte Limit." | Kleinere Datei/kürzerer Text |
| Ownership-Verstoß (fremde `sourceId`) | Service-Check nach RLS-Fetch | Aktion abgelehnt, keine Mutation, kein Job enqueued | unverändert | — | Kein UI-Pfad (Row nicht sichtbar) |
| Doppelter Retry während laufender Verarbeitung | Service prüft `status` vor Enqueue | Zweiter Aufruf wird abgelehnt (Ausnahme: stale `processing`, siehe AC-41) | unverändert (`processing`) | „Verarbeitung läuft bereits." | Warten, bis Panel pollt |
| **(Eng-Review 2026-07-19, Nachtrag) Worker crasht/timeoutet mitten in der Pipeline** | keine `pgmq.delete` erfolgt | Job bleibt in der Queue, wird nach `vt=600s` automatisch erneut zugestellt (natürliches Retry, siehe §4 Punkt 1) | bleibt `processing` bis Redelivery, dann erneuter Durchlauf | — | Kein User-Eingriff nötig; Staleness-Guard (§6) greift nur als Fallback |
| **(Eng-Review 2026-07-19, Nachtrag) Worker-Endpoint ohne/mit falschem Secret aufgerufen** | Secret-Check am Start von `/api/ingestion-worker` | `401`, kein `pgmq.read` | unverändert | — | Kein User-Pfad (Infra-/Konfigurationsfehler) |

## 11. Datei-Struktur-Vorschlag

```
lib/ingestion/
  schema.ts                       # CreatePdfSourceSchema, ProcessSourceSchema, AddTextSourceSchema,
                                   # AddWebSourceSchema, RetrySourceSchema, DeleteSourceSchema
  chunker.ts                      # chunkText(text, opts): Chunk[] — pure, js-tiktoken cl100k_base
  extract.ts                      # extractPdfText (unpdf), extractWebText (readability+linkedom), assertSafeUrl
  embed.ts                        # embedChunks(texts): number[][] — ai SDK embedMany, maxParallelCalls=5 (F7)
  service.ts                      # createIngestionService(deps): IngestionService
  __tests__/
    chunker.test.ts                # Grenzfälle: Overlap, letzter Chunk, Text < 800 Token, Char-Offset-Invariante
    service.test.ts                # happy/error path je Methode, gestubbte deps (kein echter Netzwerk-/DB-Call)

app/api/ingestion-worker/
  route.ts                         # (Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur) NEU.
                                    # export const maxDuration = 300; export const runtime = 'nodejs'
                                    # POST-Handler: Secret-Auth → pgmq.read → runIngestionJob je Job → pgmq.delete

app/(app)/notebooks/[notebookId]/sources/
  actions.ts                       # 'use server' — kein maxDuration-Export hier (Eng-Review 2026-07-19,
                                    # F2 — Actions sind seit der Queue-Rearchitektur ohnehin nur noch
                                    # Row-Insert + pgmq.send, kein langlaufender Code mehr)
                                    # createPdfSourceAction, processSourceAction, addTextSourceAction,
                                    # addWebSourceAction, retrySourceAction, deleteSourceAction
  _components/
    sources-panel.tsx              # ersetzt den Platzhalter aus Spec 01, pollt via scoped Status-Fetch
                                    # (Eng-Review 2026-07-19, OV8: kein globaler router.refresh())
    add-source-dialog.tsx          # Dialog mit Tabs-Wrapper
    pdf-upload-tab.tsx             # Drag&Drop/File-Picker + Client-Validierung + Upload-Orchestrierung
    text-source-tab.tsx            # Titel + Textarea + Zeichen-Zähler
    web-source-tab.tsx             # URL + optionaler Titel
    source-list.tsx
    source-list-item.tsx           # Icon, Titel, Status-Badge, Retry/Delete
    delete-source-dialog.tsx       # Confirm-Dialog
    source-text-viewer.tsx         # (Eng-Review 2026-07-19, OV1) Quellen-Text-Viewer — zeigt
                                    # content_text, mappt char_start/char_end auf DOM, scrollt,
                                    # <mark>-Highlight; segmentiertes/virtualisiertes Rendering für
                                    # große Texte (siehe neuer Abschnitt 16)

supabase/migrations/
  <timestamp>_create_sources_storage_bucket.sql   # insert into storage.buckets(...) + storage.objects-Policies
  <timestamp>_create_ingestion_queue.sql          # (Eng-Review 2026-07-19, Nachtrag) NEU — pgmq/pg_cron/pg_net
                                                   # extensions + pgmq.create('ingestion_jobs') + cron.schedule(...)

# Modifiziert
next.config.ts                     # experimental.serverActions.bodySizeLimit auf '2mb' (Text-Payload bis 500k Zeichen)
package.json                       # + js-tiktoken, unpdf, @mozilla/readability, linkedom, vitest (devDep)
                                    # + "engines": { "node": ">=22" } (Eng-Review 2026-07-19, F5)
app/(app)/notebooks/[notebookId]/page.tsx   # rendert <SourcesPanel> statt Platzhalter (aus Spec 01)
                                    # (Eng-Review 2026-07-19, F2/OV7, final): KEIN maxDuration hier —
                                    #   maxDuration=300 sitzt am neuen app/api/ingestion-worker/route.ts
.env.example                       # + INGESTION_WORKER_SECRET (Eng-Review 2026-07-19, Nachtrag)
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
- [ ] AC-10 (Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur, umformuliert): GIVEN erfolgreicher Storage-Upload WHEN der Client `processSourceAction({ sourceId })` aufruft THEN enqueued die Action einen Job `{ source_id }` in `ingestion_jobs` und kehrt sofort zurück (`status` bleibt `pending`); die Pipeline (Extraktion→Chunking→Embedding→Persist) läuft **nicht** innerhalb dieser Action, sondern asynchron im nächsten pg_cron-getriggerten Worker-Tick (`status` wechselt dort zu `processing`, siehe AC-47).
- [ ] AC-11: GIVEN der Storage-Upload schlägt clientseitig fehl WHEN `processSourceAction` deshalb nicht aufgerufen wird THEN bleibt die Source auf `status='pending'` mit einem sichtbaren „Upload nicht abgeschlossen"-Hinweis und einem manuellen Retry-Button.

### C. Text-Source-Flow

- [ ] AC-12 (Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur, umformuliert): GIVEN validem Text-Submit WHEN `addTextSourceAction` aufgerufen wird THEN wird eine Row mit `type='text'`, `content_text=<Text>`, `status='pending'` angelegt und ein Job in `ingestion_jobs` enqueued; die Pipeline (Chunking→Embedding→Persist) läuft **nicht** in derselben Action, sondern im nächsten Worker-Tick.
- [ ] AC-13 (Eng-Review 2026-07-19, Nachtrag, umformuliert): GIVEN der Worker hat den Job für diese Source erfolgreich verarbeitet THEN ist `status='ready'` und die Anzahl gespeicherter `chunks`-Rows entspricht `chunkText(text).length`.

### D. Web-Source-Flow

- [ ] AC-14 (Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur, präzisiert): GIVEN validem Web-Submit WHEN `addWebSourceAction` aufgerufen wird THEN läuft `assertSafeUrl(url)` als synchroner Pre-Check **in der Action, vor jeglichem Enqueue**; schlägt der Pre-Check fehl, wird **keine** Row angelegt und **kein** Job enqueued. Besteht der Pre-Check, läuft der vollständige Redirect-Loop-SSRF-Guard (jeder Hop einzeln geprüft, siehe OV5) beim tatsächlichen Fetch **im Worker** — VOR jedem Netzwerk-Request, dort wie hier ohne Ausnahme.
- [ ] AC-15: GIVEN eine URL, die statisch erkennbar zu einer privaten/loopback/link-local IP auflöst (Pre-Check) THEN wird **keine** Row angelegt, ohne dass ein Fetch stattfindet. GIVEN ein Redirect-Ziel während des Worker-Fetches auf eine solche IP zeigt THEN bricht der Worker mit `status='error'` ab (siehe AC-17).
- [ ] AC-16: GIVEN kein Titel angegeben WHEN die Seite erfolgreich geladen wird THEN wird der Titel aus dem `<title>`-Tag übernommen; fehlt dieser, wird die Domain als Titel verwendet.
- [ ] AC-17: GIVEN ein Redirect während des Fetches WHEN das Redirect-Ziel gegen den SSRF-Guard verstößt THEN wird die Verarbeitung abgebrochen. **(Eng-Review 2026-07-19, OV5, präzisiert):** Der Fetch läuft als manueller Redirect-Loop (`redirect: 'manual'`, max. 5 Hops); vor jedem Hop wird der Hostname per DNS aufgelöst, die IP gegen die Blocklist geprüft (privat/loopback/link-local, insbesondere `169.254.169.254`) und erst dann auf die geprüfte, gepinnte IP verbunden — ein einmaliges `assertSafeUrl(url)` vor `fetch()` reicht nicht, da `fetch()` DNS beim eigentlichen Request erneut auflöst und Redirects intransparent folgt (DNS-Rebinding/TOCTOU).
- [ ] AC-18: GIVEN der Web-Fetch überschreitet 15s THEN wird die Verarbeitung mit `status='error'` und einer Timeout-Meldung abgebrochen.

### E. Chunking (`chunker.ts`)

- [ ] AC-19: GIVEN ein Text mit mehr als 800 Token WHEN `chunkText` aufgerufen wird THEN hat jeder Chunk außer ggf. dem letzten **≤800 Token (Ziel 800)**. **(Eng-Review 2026-07-19, OV3, angepasst an F6 Boundary-Snapping):** exakt 800 ist kein hartes Kriterium mehr, da eine Token-Grenze bei Multi-Byte-Zeichen-Kollision um bis zu 1 Token zurückgesnappt wird.
- [ ] AC-20: GIVEN zwei aufeinanderfolgende Chunks WHEN ihre Token-Bereiche verglichen werden THEN überlappen sie sich um **≈100 Token (±1 Boundary-Snap-Token)**. **(Eng-Review 2026-07-19, OV3, angepasst an F6)**
- [ ] AC-21: GIVEN ein beliebiger Chunk WHEN `chunk.content` mit `sourceText.slice(charStart, charEnd)` verglichen wird THEN sind beide Strings identisch. **(Eng-Review 2026-07-19, OV3): bleibt hartes Kriterium** — exakte Char-Offsets haben Vorrang vor exakter Token-Zahl (Citation-Highlighting in Spec 03 hängt an korrekten Offsets, nicht an exakten Token-Counts).
- [ ] AC-22: GIVEN ein Text mit weniger als 800 Token WHEN `chunkText` aufgerufen wird THEN wird genau 1 Chunk zurückgegeben, der den kompletten Text enthält.
- [ ] AC-23: GIVEN der letzte Chunk eines Texts WHEN sein `charEnd` geprüft wird THEN entspricht er exakt `text.length`.

### F. Embedding & Persistierung

- [ ] AC-24 (Eng-Review 2026-07-19, F7, umformuliert): GIVEN gechunkter Text WHEN Embeddings erzeugt werden THEN läuft `embedChunks` über einen einzigen `embedMany({ model, values: <alle Chunk-Inhalte>, maxParallelCalls: 5 })`-Call statt einer manuell implementierten 100er-Batch-Schleife — `embedMany` batcht intern selbst nach `maxEmbeddingsPerCall` (OpenAI: 2048), `maxParallelCalls` deckelt die parallelen Requests gegen Rate-Limits (SDK-Default wäre `Infinity`).
- [ ] AC-25: GIVEN alle Chunks einer Source erfolgreich embedded WHEN sie persistiert werden THEN erhält jede `chunks`-Row `embedding` (1536 Dimensionen) sowie `metadata.char_start`/`metadata.char_end` (und bei PDF, falls ermittelbar, `metadata.page`).
- [ ] AC-26: GIVEN ein Fehler in irgendeinem Embedding-Batch WHEN die Verarbeitung abbricht THEN existiert für diese Source **kein** `chunks`-Eintrag in der DB und `status='error'`.
- [ ] AC-27: GIVEN ein Fehler beim finalen DB-Insert nach erfolgreichem Embedding WHEN die Verarbeitung abbricht THEN werden bereits inserierte Chunks dieser Source wieder gelöscht und `status='error'`.

### G. Source-Liste — Anzeige

- [ ] AC-28: GIVEN Sources-Panel mit ≥1 Source WHEN gerendert THEN zeigt jede Zeile Typ-Icon, Titel und Status-Badge (`data-test="source-status-badge"`).
- [ ] AC-29: GIVEN eine Source mit `status='ready'` THEN zeigt das Badge zusätzlich die Chunk-Anzahl (z.B. „Bereit · 42 Chunks").
- [ ] AC-30: GIVEN eine Source mit `status='error'` THEN wird `error_message` sichtbar angezeigt und ein Retry-Button (`data-test="source-retry-button"`) erscheint.
- [ ] AC-31: GIVEN ≥1 Source im Panel mit `status IN ('pending','processing')` WHEN die Seite offen bleibt THEN pollt der Client alle 2s, bis alle Sources einen finalen Status erreicht haben, und stoppt danach automatisch.

### H. Retry & Delete

- [ ] AC-32 (Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur, umformuliert): GIVEN User klickt „Retry" bei einer Error-Source THEN wechselt `status` sofort zu `pending`, `error_message` wird geleert, und `retrySourceAction` enqueued einen neuen Job; der nächste Worker-Tick setzt `status` zu `processing` und lässt die Pipeline erneut laufen (Re-Extraktion: bei `web` erneuter Fetch, bei `pdf` erneuter Storage-Download, bei `text` Re-Chunking des bestehenden `content_text`).
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
- [ ] AC-41: GIVEN eine Source mit `status='processing'` WHEN `retrySourceAction` für dieselbe Source erneut aufgerufen wird THEN wird der zweite Aufruf abgelehnt (kein doppelter paralleler Verarbeitungslauf). **(Eng-Review 2026-07-19, OV2, Ausnahme):** Ausgenommen ist eine **stale** `processing`-Source (siehe AC-46) — dort darf `retrySourceAction` den Lauf überschreiben, da die vorherige Verarbeitung nachweislich hängengeblieben ist (>10 Minuten ohne Statuswechsel) und kein echter paralleler Lauf mehr existiert.

### K. Storage-Cleanup bei Notebook-Löschung

- [ ] AC-42: GIVEN ein Notebook mit ≥1 PDF-Source WHEN das Notebook gelöscht wird THEN werden auch die zugehörigen Storage-Objekte im Bucket entfernt (kein verwaistes Objekt).

### L. Eng-Review-Ergänzungen (2026-07-19)

- [ ] AC-43 (F12): GIVEN das Sources-Panel WHEN es Chunk-Counts für `status='ready'`-Sources lädt THEN geschieht dies über **eine** gruppierte Query (Supabase `sources`-Select mit `chunks(count)`), nicht über N Einzel-Count-Queries pro Source.
- [ ] AC-44 (OV1): GIVEN der Quellen-Text-Viewer zeigt eine Source WHEN er `char_start`/`char_end` aus einem Citation-Klick (Highlight-Bridge, Spec 03) übergeben bekommt THEN scrollt er zum korrekten Offset und hebt exakt `content_text.slice(char_start, char_end)` per `<mark>` hervor.
- [ ] AC-45 (OV1): GIVEN eine Source mit bis zu 500.000 Zeichen `content_text` WHEN der Quellen-Text-Viewer sie rendert THEN bleibt die UI performant (segmentiertes/virtualisiertes Rendering statt eines einzigen Riesen-DOM-Knotens für den kompletten Text).
- [ ] AC-46 (OV2): GIVEN eine Source mit `status='processing'` und `updated_at` älter als 10 Minuten WHEN das Sources-Panel lädt oder pollt THEN wird sie als `status='error'` mit `error_message`="Verarbeitung abgebrochen (Timeout/Neustart)." behandelt, und ein Retry überschreibt diesen hängengebliebenen Lauf (siehe AC-41-Ausnahme).
- [ ] AC-47 (Nachtrag — Queue-Rearchitektur): GIVEN eine valide Add-Source-Action (PDF nach Upload, Text, Web nach SSRF-Pre-Check) WHEN sie erfolgreich zurückkehrt THEN existiert dafür genau ein Eintrag in der `ingestion_jobs`-Queue mit Payload `{ source_id: <sourceId> }`.
- [ ] AC-48 (Nachtrag — Queue-Rearchitektur): GIVEN ein Job liegt in `ingestion_jobs` WHEN der nächste pg_cron-Tick den Worker triggert THEN zieht `pgmq.read` den Job, `status` wechselt zu `processing` und danach zu `ready`/`error`, und der Job wird per `pgmq.delete` aus der Queue entfernt — ohne dass eine Client-Interaktion nötig ist.
- [ ] AC-49 (Nachtrag — Queue-Rearchitektur): GIVEN ein simulierter Worker-Crash (Job wird gelesen, aber nicht per `pgmq.delete` abgeschlossen, z.B. durch einen erzwungenen Abbruch im Test) WHEN die Visibility-Timeout (`vt=600`) abläuft THEN wird derselbe Job beim nächsten `pgmq.read` erneut ausgeliefert und die Source erreicht nach dem folgenden Worker-Durchlauf `status='ready'` (bzw. `error` bei einem inhaltlichen Fehler) — sie bleibt nicht dauerhaft auf `processing` hängen.

## 13. Definition of Done (Qualitäts-Gates)

- [ ] DoD-DB: neue Migration legt Storage-Bucket `sources` (private, 20MB-Limit, `application/pdf`-only) **und** `storage.objects`-RLS-Policies (owner-only via Pfad-Prefix) in derselben Migration an; `lib/database.types.ts` nach der Migration neu generiert (`supabase gen types typescript --local > lib/database.types.ts`).
- [ ] DoD-Queue (Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur): zweite Migration aktiviert `pgmq`/`pg_cron`/`pg_net`, legt die Queue `ingestion_jobs` an und registriert den `cron.schedule(...)`-Job (§8); Queue-Operationen laufen nachweislich nur service-role (kein `authenticated`-Grant auf `pgmq`-interne Tabellen); `INGESTION_WORKER_SECRET` ist gesetzt und der Worker-Endpoint lehnt Requests ohne/mit falschem Secret mit `401` ab.
- [ ] DoD-Auth: jede Ingestion-Action läuft über `enhanceAction({ auth: true, schema })`; `user.id` kommt ausschließlich aus `supabase.auth.getUser()`; `enqueueIngestionJob`/`retrySource`/`deleteSource` prüfen Ownership explizit im Service zusätzlich zu RLS; der Worker-Endpoint selbst hat keine User-Auth (Secret-Auth, siehe DoD-Queue) und läuft mit `createAdminClient()`.
- [ ] DoD-i18n: kein Gate (projektweit optional) — Strings dürfen hartkodiert bleiben.
- [ ] DoD-Test-Selektoren: `data-test` auf jedem interaktiven Element (Tab-Trigger, Datei-Dropzone, alle Submit-Buttons, Status-Badge, Retry-/Delete-Button, Confirm-/Abbrechen-Buttons im Delete-Dialog).
- [ ] DoD-Nav/Routing (Eng-Review 2026-07-19, Nachtrag, korrigiert): **ein** neuer Top-Level-Route-Handler nötig — `app/api/ingestion-worker/route.ts` (`maxDuration=300`); das Sources-Panel selbst lebt weiter ohne neue Route in `/notebooks/[notebookId]` aus Spec 01, `SourcesPanel` ersetzt den dortigen Platzhalter.
- [ ] DoD-Verify: `pnpm tsc --noEmit` → 0 Fehler.
- [ ] DoD-Verify: `pnpm next lint` → 0 Fehler.
- [ ] DoD-Verify: `pnpm next build` → erfolgreich.
- [ ] DoD-Unit-Test-Chunker: `chunkText` hat Tests für Overlap-Korrektheit (~100 Token zwischen Nachbar-Chunks), letzten Chunk (`charEnd === text.length`), Text < 800 Token (genau 1 Chunk), und die Char-Offset-Invariante (`content === text.slice(charStart, charEnd)`). **(Eng-Review 2026-07-19, F6, erweitert):** zusätzlich Pflicht-Tests mit Text, der Umlaute enthält, mit Emoji genau an einer Chunk-Grenze, und mit CJK-Zeichen — die Invariante `content === text.slice(charStart, charEnd)` muss in allen drei Fällen halten (Regressionsschutz gegen `decode(tokens.slice(...))`-Bugs).
- [ ] DoD-Unit-Test-Service: `IngestionService` hat für `createTextSource`/`createWebSource`/`processSource` je mindestens 1 Happy-Path- (führt zu `status='ready'` mit erwarteter Chunk-Anzahl) und 1 Error-Path-Test (embed/extract-Stub wirft → `status='error'`, keine Chunks in der Mock-DB), gegen gestubbte Dependencies (kein echter Netzwerk-/OpenAI-/DB-Call).
- [ ] DoD-Unit-Test-Cleanup (Eng-Review 2026-07-19, F9): `deleteNotebookStorageObjects` hat mindestens 1 Happy-Path-Test (alle Storage-Objekte des Notebooks werden entfernt) und 1 Error-Path-Test (Storage-Delete schlägt fehl → best-effort, wird geloggt, blockiert die Notebook-Löschung selbst nicht).
- [ ] DoD-Unit-Test-Worker (Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur): `runIngestionJob` hat dieselbe Happy-/Error-Path-Abdeckung wie das vormalige `processSource` (siehe DoD-Unit-Test-Service); zusätzlich ein Test, der belegt, dass der Worker-Handler bei erfolgreichem **und** bei fehlerhaftem (aber behandeltem) Pipeline-Durchlauf `pgmq.delete` aufruft, und ein Test, der belegt, dass bei einem geworfenen/unbehandelten Fehler **kein** `pgmq.delete` aufgerufen wird (Job bleibt für Redelivery in der Queue).
- [ ] DoD-SSRF: dedizierter Test für `assertSafeUrl` — mindestens je 1 Fall für `localhost`, eine private IPv4 (`10.x`/`172.16-31.x`/`192.168.x`), `127.0.0.1`, ein Nicht-http(s)-Schema (`file://`) — alle müssen werfen; eine öffentliche HTTPS-URL darf nicht werfen. **(Eng-Review 2026-07-19, OV5, erweitert):** zusätzlich ein Test für „Redirect auf eine interne IP" (öffentliche Ursprungs-URL, die per 3xx auf `127.0.0.1`/`169.254.169.254` weiterleitet → muss im Redirect-Loop blockiert werden) und ein DNS-Rebinding-Szenario (Hostname löst beim Prüf-Hop auf eine öffentliche IP auf, beim simulierten Verbindungs-Hop auf eine private IP → muss auf der geprüften/gepinnten IP verbinden, nicht erneut re-resolven).
- [ ] DoD-Node-Version (Eng-Review 2026-07-19, F5): `package.json` enthält `"engines": { "node": ">=22" }`; Vercel-Projekt-Node-Version ist auf 22.x gesetzt (Deploy-Checklist-Punkt vor erstem Produktions-Deploy).
- [ ] DoD-Convention (Eng-Review 2026-07-19, F8): alle Server-Actions dieser Spec nutzen `ActionResult<T>` aus `lib/server/action.ts` (siehe Spec 01 §8), kein lokaler Ad-hoc-Union-Type.
- [ ] DoD-QA: alle AC-1…AC-49 grün verifiziert (manuell oder via `/qa`).

## 14. Risks & Open Questions

- **Reihenfolge-Abhängigkeit von Spec 01**: Diese Spec setzt voraus, dass `/notebooks/[notebookId]` (inkl. Sources-Panel-Platzhalter) aus Spec 01 bereits gebaut ist. Ist Spec 01 zum Build-Zeitpunkt dieser Spec noch nicht umgesetzt, muss sie zuerst gebaut werden — kein Blocker für die Spec selbst, aber für die Reihenfolge des Builds.
- **Vercel-Timeout bei sehr großen PDFs**: Ein 20MB-PDF mit sehr viel Text kann tausende Chunks erzeugen → mehrere Minuten Embedding-Zeit. **(Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur):** Das Risiko ist strukturell entschärft, nicht mehr nur durch einen hohen `maxDuration`-Wert verschoben — die Ausführung läuft jetzt im Worker-Endpoint (`maxDuration=300`, Annahme: Pro-Plan, siehe Annahme 4), dessen Timeout keinen User-Request mehr blockiert. Ein einzelner extrem großer Job, der auch 300s im Worker überschreitet, führt zu einer Crash-artigen Nicht-Fertigstellung → `pgmq`-Redelivery versucht es erneut, was bei einer strukturell zu langen Pipeline (nicht transient) zu wiederholten Fehlversuchen führen könnte; dieser Rand-Fall (Einzel-Job > 300s reproduzierbar) ist nicht vollständig gelöst, aber deutlich seltener als vorher, da 300s jetzt ausschließlich für die reine Pipeline-Zeit zur Verfügung steht statt geteilt mit der User-Request-Latenz.
- **(Eng-Review 2026-07-19, Nachtrag) pg_cron-Intervall-Latenz**: Jede neue Source wartet im schlechtesten Fall knapp ein volles Cron-Intervall (15s, siehe §8, Annahme 15), bevor sie überhaupt von `pending` zu `processing` wechselt. Für v1 akzeptiert (kein Realtime-Anspruch, siehe Non-Goals); bei Bedarf später über ein kürzeres Intervall oder einen Trigger-Call direkt aus der Add-Action heraus (zusätzlich zum Cron-Fallback) optimierbar — Non-Goal v1.
- **(Eng-Review 2026-07-19, Nachtrag) Neue Infra-Abhängigkeiten**: `pgmq`/`pg_cron`/`pg_net` sind Supabase-Extensions, die aktiviert werden müssen; `pg_net`-HTTP-Calls aus Postgres heraus setzen voraus, dass der Worker-Endpoint von der Datenbank aus erreichbar ist (Netzwerk-/Firewall-Konfiguration bei Self-Hosting relevant, bei Supabase-Cloud + Vercel unkritisch). `INGESTION_WORKER_SECRET` ist ein neues Secret, das im Deployment gepflegt werden muss.
- **Scope-Creep-Risk**: Chunk-Parameter-UI (User stellt 800/100 selbst ein), semantisches Chunking, Multi-File-Upload, Website-Crawling, OCR — bewusst nicht Teil dieser Spec.
- **Architektur-Entscheidung „Content-Text bei PDF"**: Siehe §4 Punkt 4 — Brief-Wortlaut war an dieser Stelle mehrdeutig, hier explizit aufgelöst (Annahme 3, zur Review markiert).
- **Storage-Cleanup bei Notebook-Löschung**: Löscht ein User ein ganzes Notebook (Spec 01), räumt die DB-FK-Cascade `sources`/`chunks` automatisch auf — Storage-Objekte (PDF-Dateien) verwaisen dabei aber, weil dieser Fall nicht über `deleteSourceAction` läuft. **IN SCOPE dieser Spec (Entschieden 2026-07-19)**: `deleteNotebookStorageObjects` (§9) wird vom Notebook-Delete-Flow aus Spec 01 aufgerufen. **Kein Blocker**, da Notebook-Delete bereits in Spec 01 spezifiziert ist und der Cleanup als eigenständige, injizierbare Service-Methode andockt.
- **Kein Blocker identifiziert** — diese Spec ist approval-ready, kein `🚧 BLOCKER`.

## 15. Annahmen (für Review)

1. **PDF-Upload-Architektur**: Client lädt direkt zu Supabase Storage hoch (nicht über den Server-Action-Body), um Vercels harte ~4.5MB-Request-Limit für Serverless Functions zu umgehen. Die Server-Action erstellt nur die `pending`-Row vorab und triggert die Verarbeitung danach separat (§4 Punkt 2).
2. **PDF-Sources befüllen `content_text`** zusätzlich zu `storage_path` mit dem extrahierten Volltext, damit `char_start`/`char_end`-Offsets (Fixed Contract 3) auch für PDF-Citations (Spec 03) funktionieren (§4 Punkt 4).
3. **Embedding ist pro Source atomar** — entweder alle Chunks werden mit Embedding persistiert und `status='ready'`, oder gar keine Chunks bleiben in der DB (Rollback-by-delete) und `status='error'` (§4 Punkt 3).
4. **Entschieden 2026-07-19: Pro (Andi).** Vercel-Plan ist Pro bestätigt (`maxDuration` bis 300s ohne Fluid-Compute-Sonderkonfiguration) → `export const maxDuration = 300` ist damit abgesichert, keine offene Frage mehr. **(Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur):** sitzt jetzt am Worker-Route-Handler `app/api/ingestion-worker/route.ts`, nicht mehr an einer Actions-Datei (die dürfte das ohnehin nicht exportieren, siehe F2).
5. **Web-Fetch-Parameter**: Timeout 15s, Max-Response-Size 10MB, max. 5 Redirect-Hops (jeder erneut SSRF-geprüft) — im Brief nicht vorgegeben, hier als sinnvoller Default gesetzt.
6. **Status-Update-Mechanismus**: Client-Komponente pollt alle 2s, solange ≥1 Source `pending`/`processing` ist; kein Supabase Realtime (spätere Optimierung, nicht v1) (§4 Punkt 5). **(Eng-Review 2026-07-19, OV8, korrigiert):** kein globaler `router.refresh()` mehr, sondern scoped Status-Fetch (siehe §4 Punkt 5, §6).
7. **Vitest** ist eine Implementierungsempfehlung, kein hartes Spec-Requirement (analog Spec 01, Annahme 10 dort) — im Projekt noch nicht konfiguriert, wird mit diesem Feature als Dev-Dependency + Minimal-Config eingeführt, da DoD-Unit-Test sonst nicht erfüllbar ist.
8. **PDF-Titel** ist im Dialog ein Pflichtfeld, Default-Vorschlag = Dateiname ohne `.pdf`-Endung, editierbar — der Brief nennt für den PDF-Tab keinen expliziten Titel-Workflow.
9. **Leerer/zu kurzer extrahierter Text** (<50 Zeichen) bei PDF oder Web wird als Fehler behandelt statt als leere `ready`-Source mit 0 Chunks (§10 Fehler-Matrix).
10. **Retry bei Web-Sources** fetcht die URL erneut (nicht nur Re-Chunking eines evtl. vorhandenen `content_text`), weil ein vorheriger Fehler häufig schon vor dem Setzen von `content_text` auftrat.
11. **Web-URLs, die auf Nicht-HTML-Content zeigen** (z.B. direkt auf eine PDF-Datei), werden als Fehler behandelt, nicht automatisch in die PDF-Pipeline umgeleitet — explizit Non-Goal v1.
12. **Migration-Dateiname** für den Storage-Bucket ist ein Platzhalter (`<timestamp>_create_sources_storage_bucket.sql`); der reale Timestamp wird beim Build via `supabase migration new create_sources_storage_bucket` erzeugt.
13. **Keine Pagination** der Source-Liste pro Notebook in v1 — kein Performance-Ziel definiert, spätere Pagination ist Non-Goal.
14. **`next.config.ts`**: `experimental.serverActions.bodySizeLimit` wird auf `'2mb'` angehoben (Default 1MB), um 500.000-Zeichen-Text-Payloads sicher unter Vercels hartem 4.5MB-Plattformlimit abzudecken.
15. **(Eng-Review 2026-07-19, Nachtrag — Queue-Rearchitektur) pg_cron-Intervall & Visibility-Timeout**: Cron-Tick alle 15s (schnell genug für gefühlt-responsive UI, selten genug für wenig Leerlauf-Last) und `vt=600` (10 Minuten, > `maxDuration=300` des Workers mit Sicherheitsmarge, deckungsgleich mit dem OV2-Staleness-Schwellwert) sind v1-Defaults, keine harten Requirements — im Brief nicht vorgegeben, hier als sinnvolle Defaults gesetzt und bei Bedarf ohne Interface-Bruch tunbar.
16. **(Eng-Review 2026-07-19, Nachtrag) Worker-Batch-Größe pro Tick**: `qty=3` (max. 3 Jobs pro Worker-Invocation) ist ein v1-Default, um innerhalb von `maxDuration=300` realistisch mehrere kleinere Sources pro Tick abzuarbeiten, ohne bei mehreren großen PDFs gleichzeitig das Timeout zu riskieren — keine harte Vorgabe, tunbar.

---

## 16. Quellen-Text-Viewer (Eng-Review 2026-07-19, OV1)

**Der Quellen-Text-Viewer ist explizit Scope dieser Spec (Spec 02), nicht von Spec 03.**
Spec 03 (Chat-Grounding) konsumiert ihn ausschließlich über einen definierten Callback-Contract
(`onCite({ chunkId, sourceId })` → Viewer, siehe Spec 03 §7 Highlight-Bridge) und baut ihn nicht
selbst. Grund: `content_text` und das Sources-Panel entstehen beide hier; der Viewer ist eine
natürliche Erweiterung des Panels, keine eigenständige Chat-Komponente.

**Funktionsumfang:**

- Zeigt `sources.content_text` einer Source in einer eigenen Ansicht/einem Tab im Sources-Panel
  (`_components/source-text-viewer.tsx`, siehe §11 Datei-Struktur).
- Nimmt optional `{ charStart, charEnd }` entgegen (z.B. vom Highlight-Bridge-Callback aus Spec 03):
  scrollt zur entsprechenden Position und rendert ein `<mark>`-Highlight über
  `content_text.slice(charStart, charEnd)`.
- Fehlen `charStart`/`charEnd` (z.B. Alt-Chunk ohne Metadata) → Viewer öffnet ohne Scroll/Highlight
  (graceful degrade, konsistent mit Spec 03 AC-G4).

**Performance-Anforderung (bis zu 500.000 Zeichen, siehe §2 Text-Tab-Limit):** Ein einzelner
DOM-Knoten mit dem kompletten Text wäre bei 500k Zeichen ein Performance- und Scroll-Problem
(Layout/Paint-Kosten, `<mark>`-Insertion in einen Riesen-Textblock). Stattdessen: **segmentiertes
Rendering** — der Text wird in Abschnitte (z.B. entlang Absatz-/Chunk-Grenzen oder fester
Zeichen-Fenster) zerlegt, von denen nur die im/nahe am Viewport sichtbaren tatsächlich in den DOM
gemountet werden (virtualisiert, analog `react-window`/`react-virtual`-Pattern); beim Scroll-zu-Offset
wird zuerst zum richtigen Segment gesprungen, dann fein innerhalb des Segments positioniert.

**Neue ACs:** siehe §12 Gruppe L (AC-44 Offset-Highlight-Korrektheit, AC-45 Performance/virtualisiertes
Rendering).

---

**Empfohlener nächster Schritt:** `/plan-eng-review specs/02-ingestion.md` (non-trivial: DB + Service + Server-Action + Worker/Queue + UI + externe Netzwerk-/API-Calls), danach `/feature-builder` mit dieser Spec als Input (Build-Reihenfolge: nach Spec 01), danach `/qa` gegen AC-1…AC-49.

`Spec written: specs/02-ingestion.md — 49 acceptance criteria, kein Blocker, next: /plan-eng-review (Eng-Review 2026-07-19 eingearbeitet, inkl. Queue-Rearchitektur-Nachtrag)`

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 24 issues (12 section + 12 outside voice), 0 critical gaps, all folded into specs |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | pending (next step) |
| Outside Voice | Claude subagent (opus) | Independent 2nd opinion | 1 | issues_found | 12 additive findings, no cross-model tension |

- **CROSS-MODEL:** Outside voice (opus, fresh context) produced 12 additive findings, zero contradictions with the section review — both reviewers agree. Its #3 refined the chunker fix (relaxed token-count ACs), #12 extended the eval decision (H5 into eval). Biggest flagged residual risk: grounding gate rests on a single 0.35 similarity threshold that `text-embedding-3-small` may not separate cleanly — addressed via early calibration milestone + margin/relative-drop fallback (D15.6).
- **VERDICT:** ENG CLEARED — 24 findings all resolved into the specs; scope accepted as-is then expanded by Product-Owner decision (async pgmq+pg_cron ingestion queue moved into v1). Ready to implement after `/plan-design-review`.

NO UNRESOLVED DECISIONS
