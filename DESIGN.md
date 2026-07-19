# GoatbookLM — Design System (v1)

> Nah am echten NotebookLM: **minimal, clean, viel Weißraum, all-sans.** Ein ruhiges
> Recherche-Werkzeug. Referenz: NotebookLM/Gemini-Notebook (Screenshots vom Nutzer,
> 2026-07-19). Das Signature-Gefühl: **jede Aussage sichtbar an ihrer Quelle verankert.**

## Klassifizierung

**App UI** (workspace-driven, data-dense, task-focused). Keine Marketing-/Landing-Regeln.
Utility-Sprache. Vorbild-Aesthetik: NotebookLM — weiß, luftig, schwarze Primary-Pills,
Pastell nur als Kategorie-/Karten-Akzent.

## Layout (an echtem NotebookLM ausgerichtet — korrigiert 2026-07-19)

Notebook-Detail = **2 Arbeits-Panels in v1** + rechtes Studio-Panel **deferred**:

```
┌──────────────┬───────────────────────────┬──────────────┐
│  SOURCES      │  CHAT                      │  STUDIO       │
│  (links)      │  (mitte, breit)           │  (rechts)     │
│               │                            │               │
│  Listen-Mode: │  Message-Liste            │  v1: DEFERRED │
│   Quellen-    │  + Streaming-Antwort      │  (Audio/Video/│
│   Rows        │  + Inline-Zitate [n]      │   Slides/     │
│  ODER         │  + Composer unten         │   Mindmap =   │
│  Reader-Mode: │                            │   Non-Goal).  │
│   geöffnete   │  Zitat-Klick → Popover    │  v1: Panel    │
│   Quelle als  │   am Zitat (Passage +     │   ausblendbar │
│   Volltext,   │   'Quelle anzeigen')      │   / schmaler  │
│   gescrollt+  │                            │   Platzhalter │
│   markiert    │                            │   'kommt bald'│
└──────────────┴───────────────────────────┴──────────────┘
```

- **Der Quellen-Text-Viewer (OV1) lebt IM linken Panel** (Reader-Mode), nicht als 3. Spalte. Die Sources-Liste toggelt zwischen Listen- und Reader-Ansicht (Zurück-Pfeil führt zur Liste).
- **Zitat-Klick primär = Popover-Karte** direkt am `[n]` (Quellenname + zitierte Passage + „Quelle anzeigen"-Link). „Quelle anzeigen" öffnet die Quelle im linken Panel (Reader-Mode), scrollt zum Chunk, markiert ihn dezent.
- **Studio-Panel rechts ist v1 Non-Goal** (Audio/Video/Präsentation kommen später). v1: entweder ausblenden (2-Panel) oder schmaler Platzhalter „Audio, Video & mehr — kommt bald". Layout so bauen, dass das dritte Panel später ohne Umbau andockt.
- Panels durch 1px-Hairline getrennt, kein Schatten. Panels ein-/ausklappbar (Collapse-Icon oben rechts je Panel, wie im Original).

## Typografie (all-sans, kein Serif)

Kein Default-Stack (kein system-ui / Inter / Roboto / Arial als Primary). Google-Sans-Anmutung: rounded-humanist Grotesk.

| Rolle | Schrift | Einsatz |
|---|---|---|
| UI + Lesetext | **Figtree** (variable, rounded-humanist) | ALLES: Nav, Chat, Quelltext-Reader, Listen |
| Mono | **Geist Mono** | Chunk-Index, IDs, Code in Quellen |

- Ein durchgehender Sans (wie NotebookLM). Kein Serif-Reading-Font — das war die falsche Fährte; echtes NotebookLM ist komplett sans.
- Body ≥ 16px. Reader-Text 16px, line-height 1.6. Chat-Antwort 15–16px.
- Skala (px): 12 · 13 · 14 · 16 · 18 · 22 · 28. Gewichte 400 / 500 / 600.

## Farbe (CSS-Variablen, light + dark)

Sehr weiß/neutral. **Schwarz** als Primary-Aktion (wie NotebookLM-Pills). EIN restrained-Accent für Links/aktive States. Pastell nur für Notebook-Karten + spätere Studio-Kacheln. Kein Purple-Gradient-Slop.

```css
:root {
  --bg:        #FFFFFF;  /* reinweiß, NotebookLM-luftig */
  --surface:   #FFFFFF;
  --surface-2: #F6F6F7;  /* Chat-Bubble, Hover, Suggested-Chips */
  --border:    #E8E8EA;  /* 1px hairlines */
  --text:      #1F1F1F;
  --text-muted:#5F6368;  /* Sekundär, Meta, Zitat-Nummern */
  --primary:   #1F1F1F;  /* schwarze Primary-Pill (Create new, Senden) */
  --primary-fg:#FFFFFF;
  --accent:    #2563EB;  /* flaches Blau — Links, aktive Source, Fokus-Ring, Citation-Chip-Text */
  --highlight: #FFF3BF;  /* dezenter Marker-Wash im Reader beim Zitat-Sprung */
  --danger:    #D93025;  /* Error, destruktiv */
  --ok:        #188038;  /* ready-Status */
  /* Pastell-Palette für Notebook-Karten (rotierend, user- oder hash-zugewiesen) */
  --card-1:#FCE8E6; --card-2:#E8EAF6; --card-3:#E6F4EA; --card-4:#FEF7E0; --card-5:#F3E8FD; --card-6:#E0F2F1;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg:#131314; --surface:#1E1F20; --surface-2:#28292A; --border:#3C4043;
    --text:#E8EAED; --text-muted:#9AA0A6; --primary:#E8EAED; --primary-fg:#131314;
    --accent:#8AB4F8; --highlight:#5C4B1A; --danger:#F28B82; --ok:#81C995;
    --card-1:#3A2C2B; --card-2:#2B2E43; --card-3:#26382C; --card-4:#3B3524; --card-5:#33263E; --card-6:#233A38;
  }
}
```

- **Schwarze Primary-Pill** für die eine Hauptaktion pro Screen (Create new / Senden). Nicht inflationär.
- **Blau-Accent** sparsam: Links, aktive/ausgewählte Quelle, Fokus-Ring, Citation-Chip-Text. Kein Purple, keine Gradients.
- **Pastell-Karten** nur im Notebook-Grid (Karte = Interaktion, wie im Original) und später Studio-Kacheln — nie als Deko in Listen/Panels.
- **Highlight-Wash** dezent (nicht knallgelb): kurzer Marker beim Zitat-Sprung im Reader, danach ruhig.

## Zitat-Darstellung (Signature — an echtem NotebookLM)

- Inline im Chat: `[n]` als **kleine, dezente Chip/Superscript-Nummer** in `--text-muted`/`--accent`, im Textfluss (nicht als große Buttons). Semantisch `<button>` (a11y), aber visuell zurückhaltend.
- Klick auf `[n]` → **Popover-Karte** direkt am Zitat: Quellenname (fett, klein) + zitierte Passage (2–4 Zeilen) + „Quelle anzeigen"-Link. Leichtgewichtig, schließt bei Klick daneben.
- „Quelle anzeigen" → linkes Panel wechselt in Reader-Mode, scrollt zum `char_start`, `--highlight`-Wash über die Passage, kurzer Puls.

## Spacing & Layout

- 4/8px-Skala: 4 · 8 · 12 · 16 · 24 · 32. Panel-Padding 16–24, Row-Padding 10/12.
- **Cardless in Panels** (Quellen = Rows mit Hairlines + Checkbox rechts, wie Original). **Karten nur im Notebook-Grid** (Card IST das Notebook) und später Studio-Kacheln.
- Hairline (1px) statt Schatten; Schatten nur für Overlays (Dialog, Popover).
- Radius: 8px (Buttons/Inputs), 12–16px (Notebook-Karten, Dialog), Pills voll gerundet.

## Motion

Sparsam, funktional. 150–250ms ease-out. `prefers-reduced-motion` respektieren.
1. Streaming-Token natürlich.
2. Zitat-Sprung: smooth-scroll + kurzer Highlight-Puls (~600ms), dann statisch.
3. Panel Collapse/Expand + Status pending→ready: sanftes Fade, kein Springen.

## Ikonografie

lucide-react, 1.5px stroke, `--text-muted`. Typ-Icons PDF/Text/Web dezent monochrom (Original nutzt farbiges PDF-Icon — ok als einzelne funktionale Farbe, nie Icons-in-Kreisen als Deko).

## Verbote (AI-Slop-Blacklist)

- Kein system-ui/Inter als Primary; kein Serif-Reading-Font.
- Keine 3-Spalten-Feature-Grids, keine Icons-in-farbigen-Kreisen als Deko, kein centered-everything.
- Kein Purple/Indigo-Gradient, keine dekorativen Blobs/Wavy-Divider, keine Emoji als Design-Elemente (Ausnahme: user-gewähltes Notebook-Emoji auf der Karte, wie im Original).
- Ein Primary (schwarz), ein Accent (blau), Pastell nur für Karten/Kacheln.
