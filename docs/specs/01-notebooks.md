# Notebook-CRUD — Feature-Spec

| Feld | Wert |
|---|---|
| **Feature-Name** | `notebook-crud` |
| **Bereich/Modul** | App-Home / Notebooks (Kern-Navigation) |
| **Layers betroffen** | Service, API/Server-Action, UI — **kein neuer DB-Layer** (Tabelle existiert bereits) |
| **Sichtbarkeit** | customer-facing, ausschließlich für eingeloggte User |
| **Modus** | NEW |
| **Non-trivial?** | Ja (Service + Server-Action + UI, Routing-Migration) → `/plan-eng-review` vor Build empfohlen |

---

## 1. Ziel/Scope

`/notebooks` wird die neue App-Home und ersetzt `/dashboard` vollständig. Eingeloggte User sehen dort ein Grid ihrer eigenen Notebooks, können neue anlegen, umbenennen/bearbeiten und löschen. Jedes Notebook öffnet eine Detailseite (`/notebooks/[notebookId]`), die in dieser Spec nur als Shell existiert — Inhalt folgt in Spec 02 (Sources) und Spec 03 (Chat). **(Design-Review 2026-07-19, korrigiert):** Die Shell hat **drei** Panels, nicht zwei — Sources (links), Chat (Mitte, breit/dominant) und Studio (rechts, v1 Non-Goal/Platzhalter „kommt bald"), siehe Abschnitt „Design-Review-Ergänzungen (2026-07-19)" in §9 sowie `DESIGN.md`.

**(Design-Review 2026-07-19) Visuelles System:** siehe `DESIGN.md` (Figtree all-sans, weiß/minimal, schwarze Primary-Pills, ein blauer Accent, Pastell nur für Notebook-Karten, cardless Panels, Hairlines statt Schatten) — verbindliche visuelle Source-of-Truth für alle UI dieser Spec. UI-Sprache Deutsch (bereits entschieden, siehe unten).

Im Zuge dieses Features wird zusätzlich die gesamte bestehende UI (Landing-Page, Login, Signup, App-Header — aktuell Englisch) auf durchgängig deutsche Texte umgestellt (Entscheid: App-Sprache Deutsch, siehe Annahme 13).

Die Tabelle `public.notebooks` (inkl. RLS-Owner-Policy) existiert bereits seit `supabase/migrations/20260719103134_create_core_schema.sql`. **Für dieses Feature ist keine neue Migration nötig.**

## 2. Non-Goals (explizit außerhalb v1)

- Kein Sharing/Collaboration (kein zweiter User sieht je ein fremdes Notebook)
- ~~Keine Suche/Filter über Notebooks~~ **(Design-Review 2026-07-19): aufgehoben.** Eine client-seitige Titel-Suche (Filterung der bereits geladenen Liste, kein Server-Volltext-Feature) ist jetzt v1-Scope, siehe „Design-Review-Ergänzungen" in §9 (AC-41/AC-42).
- Kein Archiv / Soft-Delete — Löschen ist hart (FK-Cascade)
- ~~Keine Sortier-Optionen in der UI (fixe Default-Sortierung, siehe Annahme 1)~~ **(Design-Review 2026-07-19): präzisiert, nicht aufgehoben.** Es bleibt genau **ein** fester Default-Sortiermodus („Zuletzt verwendet") ohne User-wählbares Sortier-Menü — kein Mehrfach-Optionen-Sort-UI (siehe Annahme 1, geändert).
- Kein Anzeigen der Quellen-Anzahl auf der Card (v1 ohne Count, siehe Annahme im Brief)
- Keine Bulk-Actions (Mehrfachauswahl/-löschung)
- Kein Inhalt auf der Detailseite (Sources/Chat/Studio sind reine Platzhalter-Panels — **(Design-Review 2026-07-19)** Studio ist zusätzlich v1 Non-Goal auch als späterer Inhalt, siehe AC-35/AC-37)
- Kein i18n-Zwang (projektweit optional, kein Gate für dieses Feature)
- **(Design-Review 2026-07-19, NEU)** Kein eigener Emoji-/Farb-Picker pro Notebook — v1 automatisch/deterministisch aus `notebook.id` (siehe AC-38); ein User-Picker ist ein späteres Upgrade (TODO, siehe Annahme 14), keine neue DB-Spalte in dieser Spec.
- **(Design-Review 2026-07-19, NEU)** Kein echtes „zuletzt geöffnet"-Tracking (kein neuer Zeitstempel/keine neue Spalte) — die „Zuletzt verwendet"-Sortierung nutzt `updated_at` als Proxy (siehe Annahme 1).

## 3. Ist-Zustand

- `app/(app)/dashboard/page.tsx`: Platzhalter-Seite, zeigt nur `Signed in as {email}` + einen statischen Hinweistext. Kein Notebook-Bezug.
- `app/(app)/layout.tsx`: geschützter Layout-Wrapper (`redirect("/login")` falls kein User), Header-Link (`data-test="app-header-home-link"`) zeigt aktuell auf `/dashboard`.
- Redirect-Ziele, die aktuell `/dashboard` referenzieren:
  - `app/(auth)/actions.ts`: 3× `redirect("/dashboard")` (Passwort-Login, OTP-Verify, Signup mit sofortiger Session)
  - `app/auth/confirm/route.ts`: `safeNextPath()`-Fallback liefert `/dashboard`, wenn kein/kein sicherer `next`-Query-Param vorhanden ist
- `middleware.ts`: `PUBLIC_PATHS` enthält `/`, `/login`, `/signup`, sowie alles unter `/auth/`. `/dashboard` ist **nicht** in `PUBLIC_PATHS` und damit implizit geschützt — es gibt keinen Code-Pfad in `middleware.ts`, der explizit auf `/dashboard` verweist. `/notebooks` wird durch dieselbe Logik automatisch geschützt sein, sobald es nicht in `PUBLIC_PATHS` aufgenommen wird (wird es nicht). → kein Code-Diff in `middleware.ts` nötig, nur Verifikation (siehe AC-8).
- Kein Service, keine Server-Action, keine UI-Komponente für Notebooks vorhanden.
- Verfügbare Bausteine: `components/ui/dialog.tsx`, `card.tsx`, `dropdown-menu.tsx`, `form.tsx`, `input.tsx`, `textarea.tsx`, `skeleton.tsx`, `sonner.tsx` (Toast) — alles bereits im Projekt vorhanden, keine neuen shadcn-Components nötig außer ggf. `AlertDialog` für den Delete-Confirm (siehe Annahme 11).

### DB-Inventar (`notebooks`, bereits vorhanden)

```
public.notebooks
  id           uuid primary key default gen_random_uuid()
  user_id      uuid not null references auth.users(id) on delete cascade
  title        varchar(255) not null
  description  text (nullable)
  created_at   timestamptz not null default now()
  updated_at   timestamptz not null default now()  -- via set_updated_at()-Trigger

RLS: enable + revoke all + grant select/insert/update/delete an authenticated
Policy "notebooks_owner": using/with check (auth.uid() = user_id)
```

Abhängige Tabellen (`sources`, `chunks`, `messages`) referenzieren `notebook_id` mit `on delete cascade` — ein Notebook-Delete räumt sie automatisch mit auf, ohne dass diese Spec dafür Code schreiben muss.

## 4. Soll-Zustand — User-Flow

1. User loggt sich ein (Passwort oder OTP) oder bestätigt Signup mit sofortiger Session → landet auf `/notebooks` statt `/dashboard`.
2. **Kein Notebook vorhanden** → Empty-State mit Hinweistext + CTA-Button „Neues Notebook erstellen".
3. User klickt CTA (oder den Create-Button im Grid-Header, falls bereits Notebooks existieren) → zentrierter `Dialog` öffnet sich mit Formular (`title` Pflichtfeld ≤255 Zeichen, `description` optional).
4. User füllt Formular aus und submitted → bei validem Input: Notebook wird angelegt (`user_id` serverseitig aus Session), Dialog schließt, Success-Toast, neue Card erscheint im Grid ohne manuellen Reload.
5. **Notebooks vorhanden** → Grid mit einer Card pro Notebook: Titel, Beschreibung (oder Platzhaltertext falls leer), formatiertes `created_at`. **(Design-Review 2026-07-19):** Card zusätzlich mit Pastell-Hintergrund + Emoji (siehe AC-38); Header zeigt View-Toggle (Grid/Liste), Suchfeld und schwarze „Neu erstellen"-Pill (siehe AC-41).
6. Klick auf eine Card (außerhalb des Kebab-Menüs) → Navigation zu `/notebooks/[notebookId]`.
7. Jede Card hat ein Kebab-Menü (`DropdownMenu`) mit „Bearbeiten" und „Löschen".
8. „Bearbeiten" → derselbe Dialog wie beim Erstellen, vorausgefüllt mit aktuellem Titel/Beschreibung → Submit aktualisiert das Notebook, Dialog schließt, Card reflektiert neue Werte ohne manuellen Reload.
9. „Löschen" → Confirm-Dialog mit Warntext, der den Notebook-Titel nennt → Bestätigen löscht das Notebook (inkl. Cascade), Card verschwindet aus dem Grid, Success-Toast. Abbrechen schließt den Dialog folgenlos.
10. Detailseite `/notebooks/[notebookId]`: existiert das Notebook und gehört dem eingeloggten User → Titel-Header + drei Panels „Sources" (links, Platzhalter), „Chat" (Mitte, Platzhalter) und „Studio" (rechts). **(Design-Review 2026-07-19, korrigiert):** ursprünglich „zwei leere Platzhalter-Panels" — Studio ist ab dieser Revision Teil der Shell, v1 nur als einklappbarer „kommt bald"-Platzhalter (siehe AC-35…AC-37). Existiert das Notebook nicht oder gehört einem anderen User → `notFound()` (Next.js 404).

## 5. UI-Verhalten — Loading / Empty / Error

| Zustand | Verhalten |
|---|---|
| **Initial-Loading** `/notebooks` | `app/(app)/notebooks/loading.tsx` zeigt ein Skeleton-Grid (Platzhalter-Cards via `Skeleton`), solange der Server Component-Fetch läuft. |
| **Initial-Loading** `/notebooks/[notebookId]` | `app/(app)/notebooks/[notebookId]/loading.tsx` zeigt einen Skeleton-Header + zwei Skeleton-Panels. |
| **Empty-State** | **(Design-Review 2026-07-19, geändert)** Kein Notebook vorhanden → Grid mit ausschließlich der gestrichelten („dashed") „Neues Notizbuch erstellen"-Karte (`data-test="notebooks-empty-cta"`) unter der „Zuletzt verwendet"-Überschrift. Kein separater zentrierter Hinweistext/Leerraum — die Create-Karte selbst IST der Empty-State (warm statt kalt). |
| **Mutation-Pending** (Create/Edit/Delete) | Submit-/Confirm-Button zeigt Pending-Text (`useTransition`) und ist `disabled`, analog zu `LoginPage`. |
| **Mutation-Error** (Create/Edit) | Inline `Alert` im Dialog mit der Fehlermeldung aus der Action; Dialog bleibt offen, Formulardaten bleiben erhalten. |
| **Mutation-Error** (Delete) | Error-`Toast` mit verständlicher Meldung; Notebook bleibt im Grid sichtbar (keine optimistische Entfernung vor Serverbestätigung). |
| **Validierungsfehler** (Formular) | Inline `FormMessage` unter dem jeweiligen Feld (react-hook-form + zodResolver), Submit wird nicht ausgelöst. |
| **Unerwarteter Fetch-Fehler** (z.B. DB down beim initialen Laden) | Kein dediziertes `error.tsx` in v1 — Next.js Default-Error-Boundary greift (siehe Annahme 5). |
| **404** (`/notebooks/[notebookId]`) | Next.js Standard-404 via `notFound()` — sowohl bei nicht-existenter als auch bei fremder ID (kein Unterschied in der Darstellung, siehe Annahme 4). |

## 6. Datei-Struktur-Vorschlag

```
lib/notebooks/
  schema.ts                     # CreateNotebookSchema, UpdateNotebookSchema, DeleteNotebookSchema
  service.ts                    # createNotebookService(client): create/list/getById/update/delete
  service.test.ts               # Unit-Tests (happy + error path je Methode)

app/(app)/notebooks/
  page.tsx                      # Server Component: fetch + Grid/Empty-State + Create-Trigger
  loading.tsx                   # Skeleton-Grid
  actions.ts                    # 'use server' — createNotebookAction, updateNotebookAction, deleteNotebookAction
  _components/
    notebook-grid.tsx
    notebook-card.tsx           # Card + Kebab-DropdownMenu (Bearbeiten/Löschen)
    notebook-form-dialog.tsx    # gemeinsamer Dialog für Create + Edit (mode-Prop)
    delete-notebook-dialog.tsx  # Confirm-Dialog
  [notebookId]/
    page.tsx                    # Server Component: RLS-Fetch, notFound() bei leer, Shell-Layout
                                 # (Eng-Review 2026-07-19, OV7, aktualisiert durch Queue-Rearchitektur
                                 # in Spec 02): braucht KEIN `maxDuration` — die Ingestion-Pipeline
                                 # läuft asynchron über eine pgmq-Queue + einen separaten
                                 # Worker-Route-Handler (`app/api/ingestion-worker/route.ts`,
                                 # `maxDuration = 300`), nicht mehr in einer von dieser Page
                                 # getriggerten Server-Action. Chat (Spec 03) läuft separat über
                                 # `app/api/chat/route.ts` mit eigenem `maxDuration = 120`. Alle drei
                                 # Routen (page.tsx ohne maxDuration, ingestion-worker=300,
                                 # chat=120) koexistieren widerspruchsfrei.
    loading.tsx                 # Skeleton-Detail

# Entfernt
app/(app)/dashboard/page.tsx    # komplett gelöscht

# Modifiziert
app/(app)/layout.tsx            # Header-Link "/dashboard" → "/notebooks"
app/auth/confirm/route.ts       # safeNextPath()-Fallback "/dashboard" → "/notebooks"
app/(auth)/actions.ts           # 3× redirect("/dashboard") → redirect("/notebooks")

# Nur verifiziert, kein Diff erwartet
middleware.ts                   # /notebooks ist automatisch geschützt (nicht in PUBLIC_PATHS)
```

## 7. Data-Model (bereits vorhanden, keine Migration)

Siehe Abschnitt 3 (Ist-Zustand). Der Service arbeitet ausschließlich mit den bestehenden Spalten von `public.notebooks`.

## 8. API-Contract (Skizze)

**Zod-Schemas** (`lib/notebooks/schema.ts`):

```
CreateNotebookSchema = { title: string, min 1, max 255; description?: string, max 2000 (Annahme 2) }
UpdateNotebookSchema = CreateNotebookSchema & { id: uuid }
DeleteNotebookSchema = { id: uuid }
```

**Service** (`lib/notebooks/service.ts`, Client injiziert, keine `createClient()`-Importe):

```
create(data: CreateNotebookInput & { userId }) → Notebook
list(userId) → Notebook[]                       // sortiert nach created_at desc (Annahme 1)
getById(id, userId) → Notebook | null            // RLS-gestützt, kein manueller user_id-Filter zusätzlich (Annahme 6)
                                                  // (Eng-Review 2026-07-19, OV9): id wird VOR dem Query als
                                                  // UUID validiert (zod `.uuid()`-Guard am Service- bzw.
                                                  // Page-Eingang); ist id kein syntaktisch valides UUID,
                                                  // liefert getById `null` statt die Query auszuführen —
                                                  // sonst wirft PostgREST `invalid input syntax for type uuid`
                                                  // und die Route würde mit 500 statt mit notFound() (404) enden.
update(id, data: Partial<CreateNotebookInput>, userId) → Notebook
delete(id, userId) → void
```

**Server-Actions** (`app/(app)/notebooks/actions.ts`, alle mit `enhanceAction({ auth: true, schema })`):

```
createNotebookAction(input) → { data: Notebook } | { error: string }
updateNotebookAction(input) → { data: Notebook } | { error: string }
deleteNotebookAction(input: { id }) → { success: true } | { error: string }
```

**(Eng-Review 2026-07-19, F8) Konvention `ActionResult<T>`:** Der gemeinsame Rückgabetyp
`ActionResult<T> = { data: T } | { error: string }` wird in `lib/server/action.ts` definiert
und von allen Actions dieser Spec **und** von Spec 02 verwendet, statt ihn pro Feature ad-hoc
zu duplizieren. Die drei Actions oben werden entsprechend als `ActionResult<Notebook>` bzw.
`ActionResult<{ success: true }>` typisiert. Bestehende Auth-Actions (`app/(auth)/actions.ts`)
werden im Zuge dieses Builds (der sie wegen der Deutsch-Umstellung ohnehin anfasst, siehe §1)
auf denselben Typ migriert.

Alle drei rufen nach Erfolg `revalidatePath('/notebooks')` (und bei Update zusätzlich
`revalidatePath('/notebooks/[notebookId]')`, falls die Detailseite bereits Titel-Header cached).
**(Eng-Review 2026-07-19, OV10):** `revalidatePath` braucht bei dynamischen Segmenten das
Typ-Argument, sonst matcht der literale Bracket-String keine reale URL und revalidiert nichts:
`revalidatePath('/notebooks/[notebookId]', 'page')`. Alle Aufrufe in dieser Spec **und** in
Spec 02 sind entsprechend mit dem zweiten Argument zu versehen.

## 9. Akzeptanzkriterien

### Route-Migration (`/dashboard` → `/notebooks`)

- [ ] AC-1: GIVEN ein eingeloggter User besucht `/notebooks` THEN sieht er entweder das Notebook-Grid oder den Empty-State (kein Redirect, kein 404).
- [ ] AC-2: GIVEN ein User loggt sich per Passwort ein WHEN Login erfolgreich THEN landet er auf `/notebooks`.
- [ ] AC-3: GIVEN ein User loggt sich per Email-OTP ein WHEN Verifizierung erfolgreich THEN landet er auf `/notebooks`.
- [ ] AC-4: GIVEN ein neuer User signt sich auf WHEN Signup erfolgreich ist und sofort eine Session existiert THEN landet er auf `/notebooks`.
- [ ] AC-5: GIVEN ein User klickt einen Confirm-/Magic-Link ohne (sicheren) `next`-Query-Param WHEN Verifizierung erfolgreich THEN landet er auf `/notebooks` (Fallback-Route).
- [ ] AC-6: GIVEN die Route `/dashboard` WHEN aufgerufen THEN existiert sie nicht mehr im Repo (`app/(app)/dashboard/` gelöscht) und liefert Next.js' Standard-404.
- [ ] AC-7: GIVEN der App-Header WHEN gerendert THEN verlinkt der Home-Link (`data-test="app-header-home-link"`) auf `/notebooks`.
- [ ] AC-8: GIVEN ein nicht eingeloggter Besucher WHEN er `/notebooks` direkt aufruft THEN redirected die Middleware ihn nach `/login`.

### Notebook-Liste & Empty-State

- [ ] AC-9: GIVEN ein User ohne Notebooks WHEN er `/notebooks` besucht THEN sieht er einen Empty-State mit CTA-Button (`data-test="notebooks-empty-cta"`). **(Design-Review 2026-07-19, präzisiert):** konkret die dashed „Neues Notizbuch erstellen"-Karte unter der „Zuletzt verwendet"-Überschrift, kein separater zentrierter Hinweistext (siehe AC-40).
- [ ] AC-10: GIVEN ein User mit ≥1 Notebook WHEN er `/notebooks` besucht THEN sieht er ein Grid mit genau einer Card pro eigenem Notebook.
- [ ] AC-11: GIVEN eine Notebook-Card WHEN gerendert THEN zeigt sie Titel, Beschreibung (oder Platzhaltertext falls leer, Annahme 8) und formatiertes `created_at` — kein Quellen-Count in v1. **(Design-Review 2026-07-19):** zusätzlich Pastell-Hintergrund + Emoji, siehe AC-38.
- [ ] AC-12: GIVEN zwei Notebooks unterschiedlicher User WHEN User A `/notebooks` besucht THEN sieht er ausschließlich seine eigenen Notebooks (RLS-Verifikation, z.B. via zweitem Testuser).
- [ ] AC-13: GIVEN die Notebook-Liste lädt WHEN die Seite initial gerendert wird THEN zeigt `app/(app)/notebooks/loading.tsx` eine Skeleton-Grid-UI.

### Notebook erstellen

- [ ] AC-14: GIVEN ein User klickt den Create-Button (Empty-State-CTA oder Grid-Header-Button, `data-test="notebooks-create-button"`) THEN öffnet sich ein zentrierter `Dialog` (kein `Sheet`) mit Formular (`title`, `description`).
- [ ] AC-15: GIVEN das Create-Formular WHEN `title` leer submitted wird THEN zeigt das Formular einen Validierungsfehler und keine Server-Action wird ausgelöst.
- [ ] AC-16: GIVEN das Create-Formular WHEN `title` >255 Zeichen ist THEN zeigt das Formular einen Validierungsfehler.
- [ ] AC-17: GIVEN valide Eingaben WHEN Submit THEN wird ein Notebook mit `user_id = auth.uid()` (serverseitig aus Session, nicht aus Client-Input) angelegt, der Dialog schließt, ein Success-Toast erscheint, und die neue Card erscheint im Grid ohne manuellen Reload.
- [ ] AC-18: GIVEN das Create-Formular WHEN `description` leer gelassen wird THEN wird das Notebook trotzdem erfolgreich angelegt.
- [ ] AC-19: GIVEN die Create-Action serverseitig fehlschlägt (z.B. simulierter DB-Fehler) THEN zeigt der Dialog eine Inline-Fehlermeldung und bleibt offen, Formulardaten bleiben erhalten.

### Notebook umbenennen/bearbeiten

- [ ] AC-20: GIVEN eine Notebook-Card WHEN der User das Kebab-Menü öffnet (`data-test="notebook-card-menu-{id}"`) THEN sieht er die Optionen „Bearbeiten" und „Löschen".
- [ ] AC-21: GIVEN der User klickt „Bearbeiten" THEN öffnet sich derselbe Dialog wie beim Erstellen, vorausgefüllt mit dem aktuellen Titel und der aktuellen Beschreibung.
- [ ] AC-22: GIVEN valide Änderungen WHEN Submit THEN wird das Notebook aktualisiert (inkl. `updated_at` via bestehendem Trigger), der Dialog schließt, und die Card im Grid reflektiert die neuen Werte ohne manuellen Reload.
- [ ] AC-23: GIVEN ein User versucht ein fremdes Notebook zu bearbeiten (manipulierte ID) THEN liefert die Action keinen Treffer / schlägt fehl (RLS blockiert), kein fremdes Notebook wird verändert.

### Notebook löschen

- [ ] AC-24: GIVEN der User klickt „Löschen" im Kebab-Menü THEN öffnet sich ein Confirm-`Dialog` mit Warntext, der den Notebook-Titel nennt.
- [ ] AC-25: GIVEN der Confirm-Dialog WHEN der User „Abbrechen" klickt THEN schließt sich der Dialog, ohne dass etwas gelöscht wird.
- [ ] AC-26: GIVEN der Confirm-Dialog WHEN der User die Löschung bestätigt (`data-test="delete-notebook-confirm-button"`) THEN wird das Notebook gelöscht, verschwindet aus dem Grid ohne manuellen Reload, und ein Success-Toast erscheint.
- [ ] AC-27: GIVEN ein Notebook mit verknüpften Sources/Chunks/Messages WHEN es gelöscht wird THEN werden alle verknüpften Zeilen durch die bestehenden FK-`on delete cascade`-Constraints automatisch mitgelöscht.
- [ ] AC-28: GIVEN die Delete-Action serverseitig fehlschlägt THEN zeigt ein Error-Toast eine verständliche Fehlermeldung, das Notebook bleibt im Grid sichtbar.

### Notebook-Detailseite (Shell)

- [ ] AC-29: GIVEN ein User klickt auf eine Notebook-Card (außerhalb des Kebab-Menüs) THEN navigiert er zu `/notebooks/[notebookId]`.
- [ ] AC-30: GIVEN ein existierendes, eigenes Notebook WHEN `/notebooks/[notebookId]` aufgerufen wird THEN zeigt die Seite den Notebook-Titel im Header sowie drei Panels „Sources" (links, Platzhalter), „Chat" (Mitte, Platzhalter) und „Studio" (rechts). **(Design-Review 2026-07-19, korrigiert):** ursprünglich „zwei leere Platzhalter-Panels" — das Studio-Panel ist ab dieser Revision ebenfalls Teil der Shell, v1 nur als einklappbarer „kommt bald"-Platzhalter (siehe AC-35…AC-37).
- [ ] AC-31: GIVEN eine nicht existierende Notebook-ID WHEN `/notebooks/[notebookId]` aufgerufen wird THEN rendert Next.js die Standard-404-Seite (`notFound()`).
- [ ] AC-32: GIVEN die Notebook-ID eines fremden Users WHEN der eingeloggte User `/notebooks/[notebookId]` aufruft THEN rendert Next.js dieselbe 404-Seite wie bei AC-31 (RLS liefert leeres Resultat, keine Existenz-Info-Leakage).
- [ ] AC-33: GIVEN eine syntaktisch ungültige `notebookId` (kein UUID) WHEN die Route aufgerufen wird THEN rendert Next.js die 404-Seite (kein 500). **(Eng-Review 2026-07-19, OV9):** Konkret via zod-`.uuid()`-Guard vor dem Query (in `getById` bzw. am Page-Eingang) — ein malformed Input erzeugt `null` statt die Query auszuführen; ohne diesen Guard wirft PostgREST `invalid input syntax for type uuid`, was ohne Behandlung zu einem 500 statt 404 führen würde.

### UI-Sprache (Deutsch)

- [ ] AC-34: GIVEN Landing-, Login-, Signup-Seiten und App-Header WHEN gerendert THEN sind alle sichtbaren UI-Texte Deutsch (keine englischen Rest-Strings).

### Design-Review-Ergänzungen (2026-07-19)

**Visuelles System:** siehe `DESIGN.md` (Figtree all-sans, weiß/minimal, schwarze Primary-Pills, ein blauer Accent, Pastell nur für Notebook-Karten, cardless Panels, Hairlines statt Schatten) — verbindliche visuelle Source-of-Truth für alle UI dieser Spec.

**Layout-Korrektur** (ersetzt die frühere „zwei Platzhalter-Panels"-Formulierung): Die Notebook-Detailseite hat **drei** Panels — Sources (links, mit Listen-/Reader-Mode, siehe Spec 02 §16), Chat (Mitte, breit/dominant, siehe Spec 03) und Studio (rechts, v1 Non-Goal/Platzhalter). Alle drei sind unabhängig ein-/ausklappbar.

- [ ] AC-35: GIVEN Notebook-Detailseite WHEN gerendert THEN zeigt sie drei Panels: „Sources" (links), „Chat" (Mitte, breiter/dominanter als die anderen beiden), „Studio" (rechts) — Studio zeigt in v1 einen schmalen, einklappbaren Platzhalter „Audio, Video & mehr — kommt bald" statt echtem Inhalt (Audio/Video/Slides/Mindmap sind v1 Non-Goal).
- [ ] AC-36: GIVEN jedes der drei Panels (Sources/Chat/Studio) WHEN gerendert THEN besitzt es oben ein Collapse-Icon (`data-test="{panel}-panel-collapse"`), mit dem es unabhängig von den anderen Panels ein-/ausgeklappt werden kann.
- [ ] AC-37: GIVEN das Studio-Panel WHEN sein Layout gebaut wird THEN ist es so dimensioniert/positioniert, dass ein späteres Befüllen mit echtem Inhalt (Audio/Video/Slides/Mindmap, Post-v1) keinen strukturellen Umbau der 3-Panel-Aufteilung erfordert.

**Grid-Karten** (Pastell + Emoji, wie freigegebener Mockup „Notebook-Grid (Home)", siehe Approved Mockups):

- [ ] AC-38: GIVEN das Notebook-Grid WHEN gerendert THEN zeigt jede Notebook-Card einen Pastell-Hintergrund aus der 6er-Palette (`--card-1`…`--card-6` laut DESIGN.md), deterministisch aus `notebook.id` gehasht (dieselbe ID ergibt immer dieselbe Farbe), sowie ein Emoji (Default 📓 — kein User-Picker in v1, keine neue DB-Spalte).
- [ ] AC-39: GIVEN das Notebook-Grid WHEN gerendert THEN ist die erste Karte immer eine gestrichelte („dashed") „Neues Notizbuch erstellen"-Karte, die den Create-Dialog öffnet.
- [ ] AC-40: GIVEN 0 Notebooks WHEN `/notebooks` besucht wird THEN besteht die Ansicht ausschließlich aus der Überschrift „Zuletzt verwendet" und der dashed Create-Karte (`data-test="notebooks-empty-cta"`) — kein zusätzlicher separater Leerraum-Hinweistext; die Create-Karte selbst ist der Empty-State (siehe AC-9).
- [ ] AC-41: GIVEN der Notebooks-Header WHEN gerendert THEN zeigt er eine schwarze „Neu erstellen"-Pill (`--primary` laut DESIGN.md, `data-test="notebooks-create-button"`), einen Grid/Liste-View-Toggle (`data-test="notebooks-view-toggle"`) und ein Suchfeld (`data-test="notebooks-search-input"`).
- [ ] AC-42: GIVEN der User tippt in das Suchfeld WHEN der Suchbegriff im Titel eines Notebooks vorkommt (case-insensitive, client-seitige Filterung der bereits geladenen Liste, kein Server-Roundtrip) THEN bleiben nur die Treffer im Grid/in der Liste sichtbar.
- [ ] AC-43: GIVEN der User wechselt den View-Toggle auf „Liste" THEN werden dieselben Notebooks als kompakte Zeilen statt als Pastell-Karten dargestellt; Zurückschalten auf „Grid" stellt die Karten wieder her (gleiche zugrunde liegenden Daten, andere Darstellung).
- [ ] AC-44: GIVEN die Notebook-Übersicht WHEN sie geladen wird THEN sind Notebooks standardmäßig nach „Zuletzt verwendet" sortiert (Proxy: `updated_at desc` — echtes Last-Opened-Tracking ist kein v1-Scope, siehe Annahme 14).

**Responsive/Mobile (≤768px):**

- [ ] AC-45: GIVEN Viewport ≤768px WHEN die Notebook-Detailseite geladen wird THEN ist das Chat-Panel das Default-Vollbild-Panel; Sources- und Studio-Panel sind über eine Tab-/Icon-Leiste als ein-/ausklappbares Bottom-Sheet/Overlay erreichbar.
- [ ] AC-46: GIVEN ein geöffnetes Bottom-Sheet/Overlay (Sources oder Studio) auf Mobile WHEN es aktiv ist THEN hält es den Tastatur-Fokus (Focus-Trap), alle interaktiven Elemente erfüllen mindestens 44×44px Touch-Targets, und keine Funktion ist ausschließlich per Hover erreichbar.
- [ ] AC-47: GIVEN diese Bottom-Sheets/Overlays WHEN sie eingeordnet werden THEN sind sie reine Panel-Navigation (kein Formular) — die Projektregel „Dialog statt Sheet für Formulare" bleibt unverändert; Create-/Edit-/Delete-Notebook-Dialoge bleiben auch auf Mobile zentrierte `Dialog`-Komponenten.

*(Design-Review 2026-07-19 — Referenz: `DESIGN.md`; Mockups siehe Abschnitt „Approved Mockups" am Ende dieser Datei.)*

## 10. Definition of Done (Qualitäts-Gates)

- [ ] DoD-DB: keine neue Migration nötig — bestehende `notebooks`-Tabelle/RLS wiederverwendet; `lib/database.types.ts` bereits aktuell für `notebooks` (kein Re-Gen nötig, da keine Schemaänderung)
- [ ] DoD-Auth: jede Notebook-Mutation läuft über `enhanceAction` mit `auth: true`; `user.id` kommt ausschließlich aus `supabase.auth.getUser()`, nie aus Client-Input; Liste/Detail verlassen sich auf RLS statt zusätzlichem manuellen `user_id`-Filter (analog zum „Trust RLS"-Prinzip aus `server-action-builder`)
- [ ] DoD-i18n: kein Gate (projektweit optional) — Strings dürfen hartkodiert bleiben
- [ ] DoD-Test-Selektoren: `data-test` auf jedem interaktiven Element (Create-Button, Formular-Inputs, Submit, Kebab-Menü-Trigger, Bearbeiten-/Löschen-Menüpunkte, Confirm-/Abbrechen-Buttons, Card-Link). **(Design-Review 2026-07-19, erweitert):** zusätzlich `notebooks-view-toggle`, `notebooks-search-input`, `{panel}-panel-collapse` (je Sources/Chat/Studio).
- [ ] DoD-Design (Design-Review 2026-07-19): Notebook-Grid, Detailseiten-Shell (3 Panels) und Cards folgen `DESIGN.md` (Figtree all-sans, schwarze Primary-Pill, Pastell nur auf Notebook-Karten, Hairlines statt Schatten in Panels).
- [ ] DoD-A11y (Design-Review 2026-07-19): Bottom-Sheet/Overlay-Panels auf Mobile (≤768px) haben Focus-Trap und 44×44px Touch-Targets (siehe AC-46); Fokus-Ring sichtbar in `--accent`.
- [ ] DoD-Responsive (Design-Review 2026-07-19): Mobile-Verhalten aus AC-45…AC-47 verifiziert (Chat-Vollbild-Default, Bottom-Sheet-Panel-Navigation, keine Sheet/SlideOver-Formulare).
- [ ] DoD-Nav/Routing: `/notebooks` und `/notebooks/[notebookId]` registriert; `app/(app)/dashboard/` vollständig entfernt; Header-Link zeigt auf `/notebooks`
- [ ] DoD-Verify: `pnpm tsc --noEmit` → 0 Fehler
- [ ] DoD-Verify: `pnpm next lint` → 0 Fehler
- [ ] DoD-Verify: `pnpm next build` → erfolgreich
- [ ] DoD-Unit-Test: `lib/notebooks/service.ts` hat Unit-Tests für `create`, `list`, `getById`, `update`, `delete` — je Methode mindestens 1 Happy-Path- und 1 Error-Path-Test, gegen einen gestubbten/gemockten `SupabaseClient` (kein echter DB-Call)
- [ ] DoD-Grep: `grep -rn "/dashboard"` im Repo (außerhalb `.git`/`node_modules`/`.next`) liefert keine Treffer mehr
- [ ] DoD-Grep-Sprache: grep-artiger Check auf verbliebene englische UI-Strings in den umgestellten Seiten (Landing, Login, Signup, App-Header) — keine Treffer mehr
- [ ] DoD-Convention (Eng-Review 2026-07-19, F8): `ActionResult<T>` ist in `lib/server/action.ts` definiert; `createNotebookAction`/`updateNotebookAction`/`deleteNotebookAction` sowie die bestehenden Auth-Actions (`app/(auth)/actions.ts`) nutzen diesen Typ statt lokaler Ad-hoc-Union-Types
- [ ] DoD-E2E-Infra (Eng-Review 2026-07-19, F10): Playwright-Test-Infrastruktur gemäß neuem Abschnitt 13 „Test-Infrastruktur" steht (Config gegen lokales Supabase Port 54521, Auth-Fixture, DB-Reset-Strategie) und der Smoke-E2E (Login → Notebook anlegen → Detail) läuft grün
- [ ] DoD-QA: alle AC-1…AC-47 grün verifiziert (manuell oder via `/qa`)

## 11. Risks & Open Questions

- **Kein Test-Runner installiert**: `package.json` enthält aktuell weder `vitest` noch `jest`. DoD-Unit-Test setzt voraus, dass im Rahmen des Builds ein leichtgewichtiger Runner (empfohlen: `vitest`, ESM-nativ, passt zu Next.js 15) ergänzt wird. Nicht blockierend, aber zusätzlicher Setup-Schritt außerhalb des reinen Feature-Codes.
- **Scope-Creep-Risk**: Quellen-Anzahl auf der Card, Sortier-UI, Suche, Sharing, Archiv — bewusst nicht Teil dieser Spec (siehe Non-Goals). Nicht mal als deaktivierte UI-Stubs anlegen.
- **Architektur-Entscheidung**: Grid als Server Component mit direktem Supabase-Fetch (kein Client-seitiges Fetching/SWR); Mutationen invalidieren via `revalidatePath('/notebooks')`. Konsistent mit dem bestehenden Server-Component-Pattern im Projekt (`dashboard/page.tsx`, `layout.tsx`).
- **Kein Blocker identifiziert** — diese Spec ist approval-ready, kein `🚧 BLOCKER`.

## 12. Annahmen (für Review)

1. **Default-Sortierung** der Notebook-Liste: **(Design-Review 2026-07-19, geändert)** `updated_at desc` als Proxy für „Zuletzt verwendet" (Grid-Heading laut Mockup) — echtes Last-Opened-Tracking ist kein v1-Scope (kein neuer Zeitstempel/keine neue Spalte, siehe Annahme 14). Bleibt ein einzelner fester Sortiermodus ohne User-wählbares Sortier-Menü; View-Toggle (Grid/Liste) und Titel-Suche sind zusätzlich vorhanden (siehe AC-41…AC-44), ändern aber nichts an der festen Sortierlogik selbst.
2. **Description-Feldlänge**: clientseitig (Zod) auf 2000 Zeichen begrenzt. Die DB-Spalte ist `text` (technisch unbegrenzt) — reine UX-Grenze, kein DB-Constraint, kein Migrations-Bedarf.
3. **Rename und Bearbeiten sind derselbe Flow**: ein gemeinsamer Dialog/eine gemeinsame Action (`updateNotebookAction` für `title` + `description`) — kein separates „nur Titel umbenennen"-UI.
4. **404-Verhalten identisch** für „existiert nicht" und „gehört anderem User" — kein Unterschied in Fehlermeldung/Darstellung, um keine Existenz-Info über fremde Notebooks zu leaken (analog zum Anti-Enumeration-Kommentar in `lib/auth/service.ts`).
5. **Kein eigenes `error.tsx`** für unerwartete Fetch-Fehler auf `/notebooks` in v1 — die Next.js-Default-Error-Boundary greift; ein dediziertes Error-UI ist Later-Scope.
6. **`getById` filtert nicht zusätzlich manuell nach `user_id`** — folgt dem bestehenden „Trust RLS"-Prinzip aus dem `server-action-builder`-Skill; RLS ist alleinige Zugriffskontrolle.
7. **`middleware.ts` braucht keinen Code-Change**: `/notebooks` ist nicht in `PUBLIC_PATHS`, fällt also automatisch unter den geschützten Pfad. Trotzdem als DoD-Punkt (AC-8) verifiziert, nicht nur angenommen.
8. **Leere Beschreibung** auf der Card zeigt einen neutralen Platzhaltertext (z.B. „Keine Beschreibung") statt leerem Raum.
9. **Keine deaktivierten UI-Stubs** für Sharing/Suche/Archiv/Sortierung — vollständig out of scope, kein totes UI im Code.
10. **Test-Runner-Wahl** (vitest) ist eine Implementierungsempfehlung, kein hartes Spec-Requirement — falls das Build-Tooling eine andere Wahl trifft, bleibt DoD-Unit-Test trotzdem gültig (Happy+Error-Path je Service-Methode).
11. **Delete-Confirm-Dialog** nutzt die bestehende `Dialog`-Komponente (nicht `AlertDialog`, da letztere aktuell nicht in `components/ui/` vorhanden ist) — konsistent mit der Projektregel „Dialog statt Sheet für Overlays".
12. **Notebook-Card-Klickfläche**: die gesamte Card (außer Kebab-Menü-Bereich) ist als Link zur Detailseite klickbar, nicht nur ein separater „Öffnen"-Button — reduziert Klicks, ist aber nicht explizit im Brief spezifiziert.
13. **Entschieden 2026-07-19: App-Sprache Deutsch (Andi).** Die gesamte bestehende UI (Landing, Login, Signup, App-Header, aktuell Englisch) wird im Zuge dieses Features auf Deutsch umgestellt (siehe §1, AC-34, DoD-Grep-Sprache).
14. **(Design-Review 2026-07-19) Emoji-/Farb-Picker ist TODO, kein v1-Scope:** Notebook-Emoji ist v1 immer 📓 (Default), Kartenfarbe deterministisch aus `notebook.id` gehasht (6er-Pastell-Palette, siehe DESIGN.md `--card-1`…`--card-6`) — kein User-Picker, keine neue DB-Spalte. Ein späteres Upgrade (User wählt eigenes Emoji/Farbe, würde eine neue Spalte auf `notebooks` brauchen) ist explizit vorgemerkt, nicht Teil dieser Spec.

---

## 13. Test-Infrastruktur (Eng-Review 2026-07-19, F10)

Playwright-E2E-Setup wird mit diesem Feature Scope von Spec 01 — die Specs 02 (Ingestion) und
03 (Chat) referenzieren dieselbe Infrastruktur, statt sie jeweils neu aufzubauen. Aufbau nach
den Patterns aus `.claude/skills/playwright-e2e/SKILL.md`:

- **`playwright.config.ts`** gegen lokales Supabase (Port **54521**, projektspezifischer
  lokaler Stack — nicht der Supabase-CLI-Default-Port), `testIdAttribute: 'data-test'`,
  `baseURL` auf den lokalen Next.js-Dev-/Preview-Server.
- **Auth-Fixture**: Ein Test-User wird vor dem Run über die Supabase-Admin-API
  (service-role, `createAdminClient()`) angelegt/sichergestellt, meldet sich einmalig über
  ein `setup`-Project an (`e2e/auth.setup.ts`) und persistiert den `storageState` unter
  `e2e/.auth/user.json`; alle nachfolgenden Test-Projects laufen bereits eingeloggt.
- **DB-Reset-Strategie pro Run**: vor jedem vollständigen Testlauf wird der lokale
  Supabase-Stand auf einen definierten Ausgangszustand zurückgesetzt (z.B. via
  `supabase db reset --local` oder ein äquivalentes Fixture-Truncate der User-eigenen
  Notebooks/Sources/Messages vor dem `setup`-Project), damit Tests nicht auf Daten
  vorheriger Runs aufbauen.
- **1 Smoke-E2E**: Login → Notebook anlegen → Detailseite öffnen (`e2e/notebooks/notebooks.spec.ts`),
  als Nachweis, dass die Infrastruktur end-to-end funktioniert; deckt keine Einzel-AC vollständig
  ab, sondern verifiziert den Kritischer-Pfad/Happy-Path.

Diese Infrastruktur ist DoD-Voraussetzung für Spec 01 (siehe DoD-E2E-Infra) und wird von Spec 02
(Sources-Flows) und Spec 03 (Chat-/Guardrail-Flows, dort insbesondere für AC-H1 sowie das
`evals/guardrail.eval.ts`-Script) wiederverwendet statt dupliziert.

---

**Empfohlener nächster Schritt:** `/plan-eng-review specs/01-notebooks.md` (non-trivial: Service + Server-Action + UI + Routing-Migration), danach `/feature-builder` mit dieser Spec als Input, danach `/qa` gegen AC-1…AC-47.

`Spec written: specs/01-notebooks.md — 47 acceptance criteria (34 ursprünglich + 13 aus der Design-Review 2026-07-19: 3-Panel-Layout, Grid-Karten, Responsive), 3 open questions (kein Blocker), next: /plan-eng-review`

## Approved Mockups

| Screen | Mockup Path | Direction | Notes |
|--------|-------------|-----------|-------|
| Notebook-Detail (Sources\|Chat\|Studio-deferred) | ~/.gstack/projects/Syltas-goatbooklm/designs/notebook-detail-3panel-20260719/real-detail.png | Echtes-NotebookLM-Look: weiß/minimal, all-sans, schwarze Pills, Zitat-Popover, Reader im linken Panel, Studio rechts 'kommt bald' | Referenz für Layout + Zitat-Popover-Fluss |
| Notebook-Grid (Home) | ~/.gstack/projects/Syltas-goatbooklm/designs/notebook-detail-3panel-20260719/real-grid.png | Pastell-Emoji-Karten, dashed Create-Karte, schwarze 'Neu erstellen'-Pill, View-Toggle + Sort | Referenz für Grid + Karten-Zuweisung (auto Hash-Farbe) |

*(Design-Review 2026-07-19)*

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 24 issues (12 section + 12 outside voice), 0 critical gaps, all folded into specs |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score 4/10 → 9/10, 13 decisions; realigned to real NotebookLM (2 approved mockups) |
| Outside Voice | Claude subagent (opus) | Independent 2nd opinion | 1 | issues_found | 12 additive findings, no cross-model tension |

- **CROSS-MODEL:** Eng outside voice (opus) produced 12 additive findings, zero contradictions. Biggest residual risk: grounding gate rests on a single 0.35 similarity threshold that `text-embedding-3-small` may not separate cleanly — addressed via early calibration milestone + margin/relative-drop fallback. Design outside voice (Codex) skipped — CLI not installed.
- **DESIGN:** User supplied real NotebookLM screenshots → aligned to that look (minimal/white/all-sans Figtree, black primary pills, citation popover, source reader in left panel, Studio panel right deferred as v1 non-goal). DESIGN.md created; 2 mockups approved (see Approved Mockups). Layout realigned from 3-working-panels to Sources|Chat|Studio-deferred.
- **VERDICT:** ENG + DESIGN CLEARED — 24 eng findings + 13 design decisions folded into specs; async pgmq+pg_cron ingestion queue moved into v1. Ready to implement.

NO UNRESOLVED DECISIONS
