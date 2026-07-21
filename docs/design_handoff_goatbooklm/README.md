# Handoff: GoatbookLM — Landing Page, Notebook-Redesign, Logo & Impressum

## Overview
Design-Paket für das Repo `Syltas/goatbooklm` (Next.js 15 App Router, Tailwind CSS 4, shadcn/ui, Figtree). Enthält:

1. **Landing Page** (neu) — öffentliche Marketing-Seite, ersetzt `app/page.tsx`
2. **Notebook Listing v2** — behutsames Redesign von `app/(app)/notebooks/`
3. **Notebook Detail v2** — behutsames Redesign von `app/(app)/notebooks/[notebookId]/`
4. **Logo** — neue Bildmarke + Wortmarke (SVG)
5. **Impressum** — neue statische Seite, verlinkt aus dem Landing-Footer

## About the Design Files
Die HTML-Dateien in diesem Paket sind **Design-Referenzen (HTML-Prototypen)** — sie zeigen Look & Verhalten, sind aber kein Produktionscode. Aufgabe: die Designs im bestehenden Codebase-Setup **nachbauen** (Next.js App Router + Tailwind 4 + shadcn/ui), mit den vorhandenen Mustern (Server Components, `Button`/`Input` aus `components/ui`, CSS-Tokens in `app/globals.css`).

## Fidelity
**High-fidelity.** Farben, Typografie, Abstände und Radii sind final und sollen pixelgenau übernommen werden. `Notebook Listing.dc.html` und `Notebook Detail.dc.html` (ohne „v2") sind Nachbauten des IST-Zustands — nur als Vergleichsreferenz, NICHT implementieren.

## Neues Brand-Fundament (v2 + Landing)

### Typografie
- **UI/Body:** `Nunito Sans` (Google Fonts, opsz-Achse; 400/600/700) — ersetzt Figtree in den v2-Screens
- **Headings/Wortmarke:** `Baloo 2` (500/600/700) — nur für große Überschriften und die Wortmarke, sparsam einsetzen
- In `app/layout.tsx`: `Nunito_Sans` + `Baloo_2` via `next/font/google` laden, CSS-Variablen `--font-sans` / `--font-heading` in `globals.css` umhängen

### Neue Farbtoken (warm-neutral statt kühlem Grau)
| Token | Wert | Verwendung |
|---|---|---|
| `--bg` (App, v2) | `#f6f5f1` | getönter App-Hintergrund, Panels schweben darauf |
| `--bg` (Landing) | `#fdfdfc` | Seitenhintergrund Landing/Impressum |
| `--surface` | `#ffffff` | Panel-/Karten-Hintergrund |
| `--surface-2` | `#f1efe9` | Hover-Flächen, User-Chat-Bubble |
| `--border` | `#e7e4de` (App) / `#eceae6` (Landing) | Hairlines |
| `--text` | `#23211e` | Haupttext (warmes Fast-Schwarz) |
| `--text-muted` | `#78736b` (App) / `#57534c` (Landing) | Sekundärtext |
| `--text-faint` | `#a8a29b` | Platzhalter, Tertiärtext |
| `--action` | `#2563eb` | unverändert: Links, Zitat-Chips, Fokus |
| `--ok` | `#188038` | unverändert: Status „Bereit" |
| Pastelle `--card-1…6` | unverändert (`#fce8e6`, `#e8eaf6`, `#e6f4ea`, `#fef7e0`, `#f3e8fd`, `#e0f2f1`) | jetzt für Emoji-Kacheln & Quellen-Icons statt ganzer Karten |

## Screens / Views

### 1. Landing Page (`Landing Page.dc.html`)
- **Header** (sticky, `rgba(253,253,252,0.9)` + `backdrop-filter: blur(8px)`, Border unten): Logo-Lockup links (Mark 34px + Wortmarke Baloo 2 600 20px), Nav rechts (Funktionen / So geht's / FAQ, 14.5px 600 `#57534c`) + CTA-Pill „Jetzt starten" (H 38, `#23211e`, radius-full)
- **Hero** (zentriert, max-w 1080, pad 88/32/56): Badge-Pill („Open Source — nutzen oder selbst hosten", grüner 8px-Dot), H1 Baloo 2 700 60px/1.08 „Frag einfach deine Dokumente.", Sub 18px/1.65 `#57534c` max-w 560, 2 CTAs (primär gefüllt / sekundär outline, H 48, radius-full)
- **Produkt-Mockup**: Browser-Frame (radius 20, Border, Shadow `0 24px 60px -30px rgba(35,33,30,0.25)`), darin vereinfachtes 2-Panel-UI (Quellen-Liste 230px + Chat mit Zitat-Chips)
- **So geht's** (id `so-gehts`): 3 weiße Karten im Grid (radius 18, pad 26), nummerierte Kreise 40px in Pastell (`#e8eaf6`/`#e6f4ea`/`#fef7e0`), H3 19px 700
- **Funktionen** (id `funktionen`): 3 Pastell-Karten (radius 18, pad 28) — Quellen / Chat ohne Halluzination / klickbare Zitate
- **Self-hosted-Band**: dunkle Karte `#23211e` (radius 24, pad 56, Grid 1.2fr/1fr), H2 „Einfach loslegen — oder selbst hosten.", 4 Checkmark-Bullets, weißer CTA „Auf GitHub ansehen"
- **FAQ** (id `faq`, max-w 720): Accordion, 5 Fragen, Karten radius 14, nur eine offen (State: `open`-Index), Chevron rotiert 180°
- **Schluss-CTA**: H2 40px „Bereit? Die Ziege wartet. 🐐" + Pill-CTA H 52
- **Footer** (`#faf9f7`, Border oben): Logo + © 2026 links; GitHub / Anmelden / **Impressum** rechts

### 2. Notebook Listing v2 (`Notebook Listing v2.dc.html`)
Struktur wie Bestand (Toolbar, Grid/Liste-Toggle, Suche, Create), aber:
- App-Hintergrund `#f6f5f1`; Header ohne Border (Logo-Mark 30px + Wortmarke, rechts E-Mail 13.5px + „Abmelden"-Pill H 32 weiß mit Border)
- Begrüßung: H1 Baloo 2 700 34px „Willkommen zurück 👋"
- Toolbar: „Neu erstellen"-Pill H 40 links; Suche (H 40, radius-full, weiß, Icon links, W 260) + Ansicht-Toggle (weiße Pill mit Border, aktive Option `#f1efe9`) rechts
- Abschnittstitel: 15px 700 uppercase, letter-spacing 0.06em, `#78736b`
- **Karten**: weiß, radius 20, Border `#eceae4`, pad 18, min-H 216; Emoji-Kachel 46px radius 14 in Pastellfarbe (pro Notebook deterministisch via bestehendem `getNotebookCardColor`); Titel 17px 700/1.4; Meta 13px `#78736b` („Datum · n Quellen"); Hover: `translateY(-2px)` + Shadow `0 12px 28px -14px rgba(35,33,30,0.28)`
- Create-Tile: gestrichelt 1.5px `#d9d5cd`, radius 20; Hover: Border/Text dunkel + `rgba(255,255,255,0.6)`
- Listenansicht: eine weiße Karte (radius 20, pad 6), Zeilen radius 14 mit Hover `#f6f5f1`, Emoji-Kachel 38px

### 3. Notebook Detail v2 (`Notebook Detail v2.dc.html`)
Struktur wie Bestand (3 Panels Quellen/Chat/Studio), aber:
- **Frei stehende Panel-Karten**: Hintergrund `#f6f5f1`, Panels weiß radius 16, `gap: 12px`, Seiten-Padding 12px — statt durchgehender Borders
- Header: Logo-Mark (Link zurück) + Notebook-Titel 17px 700 in einer Zeile; rechts E-Mail + Abmelden-Pill
- Panel-Header: H 52, Titel 14.5px 700, Collapse-Button rund 32px (Hover `#f1efe9`)
- Quellen: „Quellen hinzufügen" als **Outline-Pill** (H 38, Border `#e7e4de`); Quellen-Zeilen radius 12 mit 28px-Icon-Kachel in Pastell (pdf/web/text-Icons aus lucide), Status 12px (`#188038` Bereit / Spinner „Wird verarbeitet…")
- Chat: Inhalt auf max-w 720 zentriert; User-Bubble radius `18/18/4/18` `#f1efe9` 15px/1.6; Assistant 15px/1.75; **Zitat-Chips** als Pills mit Hintergrund `#eef2fe`, Text `#2563eb` 10.5px 700 (Hover `#dde6fd`); Vorschlags-Chips (weiß, Border, radius-full, 13.5px 600)
- Composer: Karte mit Border radius 16 (`pad 8 8 8 16`), rahmenlose Textarea, Quellen-Zähler 12.5px `#a8a29b`, Send-Button rund 40px `#23211e`
- Studio: Icon in 52px-Pastellkreis `#f3e8fd` + Text zweizeilig

### 4. Logo (`Logo.dc.html`)
- **Bildmarke** (SVG, viewBox 0 0 48 48): Rounded-Square-Badge `rx 14` in `#23211e`; zwei Hörner-Bögen (stroke 3, round caps): `M16 15 C13.5 10.5 16 5.5 21 6.5` + gespiegelt; aufgeschlagenes Buch (fill hell): `M24 18.5 C20.5 15.5 15 15.5 12 17.5 V33 C15 31 20.5 31 24 34 C27.5 31 33 31 36 33 V17.5 C33 15.5 27.5 15.5 24 18.5 Z` + Mittelfalz `M24 19 V33.5` (stroke 2)
- **Wortmarke**: „GoatbookLM" Baloo 2 600, letter-spacing -0.01em; Lockup-Gap ≈ 0.28× Markenhöhe
- Invertierte Variante für dunkle Flächen; als `app/favicon.ico`-Ersatz und Header-Logo einsetzen

### 5. Impressum (`Impressum.dc.html`)
- Route `app/impressum/page.tsx` (öffentlich, außerhalb `(app)`)
- Max-w 680, H1 Baloo 2 40px; Abschnitte (H2 18px 700, Body 15–16px/1.75): Angaben gemäß § 5 DDG (Andreas Köckeis, Hirschauer Weg 12, 85462 Eittingermoos), Kontakt (E-Mail **Platzhalter** `kontakt@goatbooklm.de` — ersetzen!), Verantwortlich § 18 Abs. 2 MStV, Haftung für Inhalte, Haftung für Links, Urheberrecht
- Header mit Logo + „← Zurück zur Startseite", schlanker Footer

## Interactions & Behavior
- FAQ-Accordion: ein `open`-Index, Klick toggelt (nochmal klicken schließt), Chevron `rotate(180deg)`, Transition .15s
- Listing: Grid/Liste-Toggle (`view`-State), Live-Suche filtert per `title.includes(query)`, „Keine Notizbücher gefunden." bei 0 Treffern
- Karten-Hover (Grid): translateY(-2px) + Shadow, Transition .15s
- Alle bestehenden Verhalten (Dialoge, Menüs, Polling, Collapse, Mobile-Sheet) bleiben unverändert — nur Styling anpassen
- Fokus-Ringe: weiterhin `--action`-Blau (bestehendes shadcn-Muster)

## State Management
Keine neuen State-Anforderungen — bestehende Komponenten-States (view, query, formState, collapsed, mobilePanel, useSourcesPolling) bleiben. Landing/Impressum sind statisch (FAQ-State clientseitig).

## Design Tokens
Siehe Tabelle oben. Radii: Pills 9999px, Panels 16px, Karten 18–20px, Quellen-Zeilen 12px, dunkle Sektion 24px. Schatten: nur Karten-Hover + Mockup-Frame (Werte oben). Spacing-Basis 4px-Raster; großzügig: Section-Abstände Landing 88px, Panel-Gap 12px.

## Assets
- Logo-SVG: inline in allen Design-Dateien (identischer Pfad-Satz), keine externen Assets
- Icons: lucide-react (bereits im Repo) — search, layout-grid, list, plus, more-vertical, file-text, globe, align-left, arrow-up, panel-left/right/top-close, clapperboard, trash-2, loader-2
- Fonts: Google Fonts (Nunito Sans, Baloo 2) via `next/font/google`
- Emojis pro Notebook: aktuell statisch 📓 — v2 zeigt individuelle Emojis (🚲 ⚖️ 🔍 🎙️ 🧾); optional als neue DB-Spalte, sonst Default 📓 in der Emoji-Kachel

## Files
- `Landing Page.dc.html` — Landing (implementieren)
- `Notebook Listing v2.dc.html` / `Notebook Detail v2.dc.html` — Redesigns (implementieren)
- `Impressum.dc.html` — Impressum (implementieren)
- `Logo.dc.html` — Logo-Spezifikation (SVG übernehmen)
- `Notebook Listing.dc.html` / `Notebook Detail.dc.html` — Nachbau IST-Zustand (nur Referenz)

Die `.dc.html`-Dateien im Browser öffnen, um sie zu sehen; das Markup mit Inline-Styles ist die maßgebliche Spezifikation.

## Screenshots
Renderings der Zielzustände in `screenshots/`:
- `landing-page.png`
- `notebook-listing-v2.png`
- `notebook-detail-v2.png`
- `impressum.png`
- `logo.png`
