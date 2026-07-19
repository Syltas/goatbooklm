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

`/notebooks` wird die neue App-Home und ersetzt `/dashboard` vollständig. Eingeloggte User sehen dort ein Grid ihrer eigenen Notebooks, können neue anlegen, umbenennen/bearbeiten und löschen. Jedes Notebook öffnet eine Detailseite (`/notebooks/[notebookId]`), die in dieser Spec nur als Shell (Titel + zwei leere Platzhalter-Panels) existiert — Inhalt folgt in Spec 02 (Sources) und Spec 03 (Chat).

Die Tabelle `public.notebooks` (inkl. RLS-Owner-Policy) existiert bereits seit `supabase/migrations/20260719103134_create_core_schema.sql`. **Für dieses Feature ist keine neue Migration nötig.**

## 2. Non-Goals (explizit außerhalb v1)

- Kein Sharing/Collaboration (kein zweiter User sieht je ein fremdes Notebook)
- Keine Suche/Filter über Notebooks
- Kein Archiv / Soft-Delete — Löschen ist hart (FK-Cascade)
- Keine Sortier-Optionen in der UI (fixe Default-Sortierung, siehe Annahme 1)
- Kein Anzeigen der Quellen-Anzahl auf der Card (v1 ohne Count, siehe Annahme im Brief)
- Keine Bulk-Actions (Mehrfachauswahl/-löschung)
- Kein Inhalt auf der Detailseite (Sources/Chat sind reine Platzhalter-Panels)
- Kein i18n-Zwang (projektweit optional, kein Gate für dieses Feature)

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
5. **Notebooks vorhanden** → Grid mit einer Card pro Notebook: Titel, Beschreibung (oder Platzhaltertext falls leer), formatiertes `created_at`.
6. Klick auf eine Card (außerhalb des Kebab-Menüs) → Navigation zu `/notebooks/[notebookId]`.
7. Jede Card hat ein Kebab-Menü (`DropdownMenu`) mit „Bearbeiten" und „Löschen".
8. „Bearbeiten" → derselbe Dialog wie beim Erstellen, vorausgefüllt mit aktuellem Titel/Beschreibung → Submit aktualisiert das Notebook, Dialog schließt, Card reflektiert neue Werte ohne manuellen Reload.
9. „Löschen" → Confirm-Dialog mit Warntext, der den Notebook-Titel nennt → Bestätigen löscht das Notebook (inkl. Cascade), Card verschwindet aus dem Grid, Success-Toast. Abbrechen schließt den Dialog folgenlos.
10. Detailseite `/notebooks/[notebookId]`: existiert das Notebook und gehört dem eingeloggten User → Titel-Header + zwei leere Platzhalter-Panels „Sources" (links) und „Chat" (Mitte). Existiert es nicht oder gehört einem anderen User → `notFound()` (Next.js 404).

## 5. UI-Verhalten — Loading / Empty / Error

| Zustand | Verhalten |
|---|---|
| **Initial-Loading** `/notebooks` | `app/(app)/notebooks/loading.tsx` zeigt ein Skeleton-Grid (Platzhalter-Cards via `Skeleton`), solange der Server Component-Fetch läuft. |
| **Initial-Loading** `/notebooks/[notebookId]` | `app/(app)/notebooks/[notebookId]/loading.tsx` zeigt einen Skeleton-Header + zwei Skeleton-Panels. |
| **Empty-State** | Kein Notebook vorhanden → zentrierter Hinweistext + CTA-Button (`data-test="notebooks-empty-cta"`). Kein Grid, keine leeren Cards. |
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
update(id, data: Partial<CreateNotebookInput>, userId) → Notebook
delete(id, userId) → void
```

**Server-Actions** (`app/(app)/notebooks/actions.ts`, alle mit `enhanceAction({ auth: true, schema })`):

```
createNotebookAction(input) → { data: Notebook } | { error: string }
updateNotebookAction(input) → { data: Notebook } | { error: string }
deleteNotebookAction(input: { id }) → { success: true } | { error: string }
```

Alle drei rufen nach Erfolg `revalidatePath('/notebooks')` (und bei Update zusätzlich `revalidatePath('/notebooks/[notebookId]')`, falls die Detailseite bereits Titel-Header cached).

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

- [ ] AC-9: GIVEN ein User ohne Notebooks WHEN er `/notebooks` besucht THEN sieht er einen Empty-State mit CTA-Button (`data-test="notebooks-empty-cta"`).
- [ ] AC-10: GIVEN ein User mit ≥1 Notebook WHEN er `/notebooks` besucht THEN sieht er ein Grid mit genau einer Card pro eigenem Notebook.
- [ ] AC-11: GIVEN eine Notebook-Card WHEN gerendert THEN zeigt sie Titel, Beschreibung (oder Platzhaltertext falls leer, Annahme 8) und formatiertes `created_at` — kein Quellen-Count in v1.
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
- [ ] AC-30: GIVEN ein existierendes, eigenes Notebook WHEN `/notebooks/[notebookId]` aufgerufen wird THEN zeigt die Seite den Notebook-Titel im Header sowie zwei leere Platzhalter-Panels „Sources" (links) und „Chat" (Mitte).
- [ ] AC-31: GIVEN eine nicht existierende Notebook-ID WHEN `/notebooks/[notebookId]` aufgerufen wird THEN rendert Next.js die Standard-404-Seite (`notFound()`).
- [ ] AC-32: GIVEN die Notebook-ID eines fremden Users WHEN der eingeloggte User `/notebooks/[notebookId]` aufruft THEN rendert Next.js dieselbe 404-Seite wie bei AC-31 (RLS liefert leeres Resultat, keine Existenz-Info-Leakage).
- [ ] AC-33: GIVEN eine syntaktisch ungültige `notebookId` (kein UUID) WHEN die Route aufgerufen wird THEN rendert Next.js die 404-Seite (kein 500).

## 10. Definition of Done (Qualitäts-Gates)

- [ ] DoD-DB: keine neue Migration nötig — bestehende `notebooks`-Tabelle/RLS wiederverwendet; `lib/database.types.ts` bereits aktuell für `notebooks` (kein Re-Gen nötig, da keine Schemaänderung)
- [ ] DoD-Auth: jede Notebook-Mutation läuft über `enhanceAction` mit `auth: true`; `user.id` kommt ausschließlich aus `supabase.auth.getUser()`, nie aus Client-Input; Liste/Detail verlassen sich auf RLS statt zusätzlichem manuellen `user_id`-Filter (analog zum „Trust RLS"-Prinzip aus `server-action-builder`)
- [ ] DoD-i18n: kein Gate (projektweit optional) — Strings dürfen hartkodiert bleiben
- [ ] DoD-Test-Selektoren: `data-test` auf jedem interaktiven Element (Create-Button, Formular-Inputs, Submit, Kebab-Menü-Trigger, Bearbeiten-/Löschen-Menüpunkte, Confirm-/Abbrechen-Buttons, Card-Link)
- [ ] DoD-Nav/Routing: `/notebooks` und `/notebooks/[notebookId]` registriert; `app/(app)/dashboard/` vollständig entfernt; Header-Link zeigt auf `/notebooks`
- [ ] DoD-Verify: `pnpm tsc --noEmit` → 0 Fehler
- [ ] DoD-Verify: `pnpm next lint` → 0 Fehler
- [ ] DoD-Verify: `pnpm next build` → erfolgreich
- [ ] DoD-Unit-Test: `lib/notebooks/service.ts` hat Unit-Tests für `create`, `list`, `getById`, `update`, `delete` — je Methode mindestens 1 Happy-Path- und 1 Error-Path-Test, gegen einen gestubbten/gemockten `SupabaseClient` (kein echter DB-Call)
- [ ] DoD-Grep: `grep -rn "/dashboard"` im Repo (außerhalb `.git`/`node_modules`/`.next`) liefert keine Treffer mehr
- [ ] DoD-QA: alle AC-1…AC-33 grün verifiziert (manuell oder via `/qa`)

## 11. Risks & Open Questions

- **Kein Test-Runner installiert**: `package.json` enthält aktuell weder `vitest` noch `jest`. DoD-Unit-Test setzt voraus, dass im Rahmen des Builds ein leichtgewichtiger Runner (empfohlen: `vitest`, ESM-nativ, passt zu Next.js 15) ergänzt wird. Nicht blockierend, aber zusätzlicher Setup-Schritt außerhalb des reinen Feature-Codes.
- **Scope-Creep-Risk**: Quellen-Anzahl auf der Card, Sortier-UI, Suche, Sharing, Archiv — bewusst nicht Teil dieser Spec (siehe Non-Goals). Nicht mal als deaktivierte UI-Stubs anlegen.
- **Architektur-Entscheidung**: Grid als Server Component mit direktem Supabase-Fetch (kein Client-seitiges Fetching/SWR); Mutationen invalidieren via `revalidatePath('/notebooks')`. Konsistent mit dem bestehenden Server-Component-Pattern im Projekt (`dashboard/page.tsx`, `layout.tsx`).
- **Kein Blocker identifiziert** — diese Spec ist approval-ready, kein `🚧 BLOCKER`.

## 12. Annahmen (für Review)

1. **Default-Sortierung** der Notebook-Liste: `created_at desc` (neueste zuerst), fix ohne UI-Kontrolle — nötig, weil „keine Sortier-Optionen v1" ein Non-Goal ist, aber ein deterministischer Default gebraucht wird.
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

---

**Empfohlener nächster Schritt:** `/plan-eng-review specs/01-notebooks.md` (non-trivial: Service + Server-Action + UI + Routing-Migration), danach `/feature-builder` mit dieser Spec als Input, danach `/qa` gegen AC-1…AC-33.

`Spec written: specs/01-notebooks.md — 33 acceptance criteria, 3 open questions (kein Blocker), next: /plan-eng-review`
