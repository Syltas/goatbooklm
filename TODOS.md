# TODOS

Deferred work captured during planning. Each item has enough context to pick up cold.

## Multimedia-Upload als Source-Typen — nach Core Loop mit PDF (Andi, 2026-07-19)

- **What:** Weitere Quellen-Typen jenseits von pdf/text/web: Audio, Video, Bilder, YouTube-URLs.
- **Why:** NotebookLM unterstützt Multimedia-Quellen; Kern des späteren Studio-Ausbaus (Audio/Video-Overviews brauchen entsprechende Inputs).
- **Pros:** Deutlich breiterer Quellen-Funnel; Voraussetzung für Studio-Features.
- **Cons:** Transkription (Whisper o.ä.) + Frame-/OCR-Pipelines = eigene Verarbeitungsstrecken, Kosten pro Ingest steigen.
- **Context:** Ansatzpunkte existieren bereits: `sources.type`-Check-Constraint erweitern (Migration), Ingestion-Service ist queue-basiert (pgmq) und pro Typ erweiterbar (`extract.ts` bekommt pro Typ einen Extractor, Rest der Pipeline — Chunking 800/100, Embedding, Reader — bleibt identisch). Storage-Bucket nimmt heute nur `application/pdf` an → MIME-Allowlist erweitern.
- **Depends on / blocked by:** Core Loop (Spec 01–03) gebaut und mit PDF stabil. Entscheid von Andi: erst ansehen, wenn Core Loop mit PDF steht.

## Rate-Limiting pro User (Ingestion + Chat) — vor Public Launch

- **What:** Per-User-Limits auf die Ingestion-Actions und `/api/chat`.
- **Why:** v1 hat keine Obergrenze. Jeder Upload kostet OpenAI-Embeddings, jede Chat-Frage Claude-Tokens. Ein einzelner Account oder ein Script kann unkontrollierte API-Kosten verursachen, sobald die App (public repo) echten Traffic sieht.
- **Pros:** Kostenkontrolle, Schutz vor Missbrauch/Runaway-Scripts.
- **Cons:** Zusätzliche Infra/Logik; für v1-Testphase (wenige Nutzer) noch nicht nötig.
- **Context:** Kandidaten: Upstash Ratelimit (sliding window) ODER DB-Counter-Tabelle pro `user_id` + Zeitfenster. Ansatzpunkte: `enhanceAction`-Wrapper (zentral für alle Actions) und der Chat-Route-Handler. Sinnvolle Startlimits: X Uploads/Stunde, Y Chat-Turns/Minute pro User.
- **Depends on / blocked by:** Core Loop (Spec 01–03) gebaut; sinnvollerweise vor öffentlichem Launch.

## Storage-Objekt-Cleanup bei User-Löschung (Later)

- **What:** Beim Löschen eines ganzen Accounts verwaiste PDF-Objekte im `sources`-Bucket aufräumen.
- **Why:** FK-Cascade räumt DB-Rows, aber Storage-Objekte hängen nicht an der FK-Kette. Notebook-Delete ist bereits abgedeckt (Spec 02, `deleteNotebookStorageObjects`), Account-Delete nicht.
- **Context:** Supabase bietet kein natives Storage-Cascade. Optionen: DB-Trigger/Edge-Function beim `auth.users`-Delete, die die Pfad-Präfixe `{user_id}/` im Bucket leert.
- **Depends on / blocked by:** Account-Delete-Flow existiert noch nicht (kein v1-Feature).
