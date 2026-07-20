import { anthropic } from "@ai-sdk/anthropic"
import { generateText } from "ai"
import type { LanguageModel } from "ai"

import { fileExtension } from "../formats"
import type { FileExtraction, FileExtractorInput } from "./types"

/**
 * Vision model for image sources. Anthropic, deliberately matching the chat
 * route's provider and slug (`CHAT_MODEL_ID` in `app/api/chat/route.ts`) —
 * this project already splits providers by job (Anthropic for generation,
 * OpenAI for embeddings, see `lib/embeddings/client.ts`), and image
 * description is a generation task, so it belongs on the Anthropic side.
 * Using the same slug as chat rather than a second one means there is one
 * model version to reason about when output quality changes.
 *
 * `ANTHROPIC_API_KEY` is read by the provider from the server environment
 * only — this module is imported exclusively from `lib/ingestion/deps.ts`,
 * which is wired into the worker Route Handler and Server Actions, never
 * into a client component.
 */
const VISION_MODEL_ID = "claude-sonnet-5"

/**
 * Cap on the generated description. Large enough for a dense
 * slide/screenshot's full text transcription, small enough that a
 * pathological image can't produce a description that dwarfs the rest of the
 * notebook's corpus and skews retrieval toward itself.
 */
const MAX_DESCRIPTION_TOKENS = 4096

/**
 * Asks for BOTH a description and a verbatim transcription in one call.
 * Two separate calls (one "describe", one "OCR") would double latency and
 * cost for a single source, and the results would have to be stitched
 * together anyway — `content_text` is one field.
 *
 * The instruction to omit a "no text present" note matters: without it the
 * model reliably appends a sentence like "Das Bild enthält keinen Text",
 * which then becomes a real, embeddable chunk that competes for retrieval
 * against actual content.
 */
const VISION_PROMPT = `Analysiere dieses Bild für eine Wissensdatenbank.

Gib zurück:
1. Eine sachliche Beschreibung dessen, was zu sehen ist — Motiv, Aufbau, erkennbare Objekte, Personen, Diagramme oder Strukturen. Bei Diagrammen und Tabellen: beschreibe, was dargestellt wird, inklusive Achsen, Reihen und erkennbarer Werte.
2. Anschließend den vollständigen im Bild enthaltenen Text, wörtlich und in Lesereihenfolge, unter der Überschrift "Text im Bild:".

Schreibe auf Deutsch, in Fließtext ohne Aufzählungszeichen für Teil 1. Wenn das Bild keinen Text enthält, lasse Teil 2 samt Überschrift ersatzlos weg — schreibe keinen Hinweis darauf, dass kein Text vorhanden ist. Gib ausschließlich den Inhalt zurück, ohne Einleitung wie "Hier ist die Beschreibung".`

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}

/**
 * Resolves the IANA media type the vision API needs. Derived from the file
 * name rather than sniffed from the bytes because `matchesMagic` has already
 * verified the bytes are one of the three accepted encodings before this
 * head ever runs, and the extension is what the format registry keyed on.
 */
export function imageMediaType(fileName: string): string {
  return EXTENSION_MEDIA_TYPES[fileExtension(fileName)] ?? "image/png"
}

/**
 * Image head — a single vision call produces the description *and* the
 * contained text, and the result becomes `content_text`. From there the
 * image travels the identical chunk → embed → persist path as every other
 * format; nothing downstream knows it was generated rather than extracted.
 *
 * The model is injectable so unit tests exercise this head without a real
 * API call (same pattern as `createEmbedChunks` in `lib/ingestion/embed.ts`).
 */
export function createExtractImage(model: LanguageModel = anthropic(VISION_MODEL_ID)) {
  return async function extractImage(
    input: FileExtractorInput
  ): Promise<FileExtraction> {
    const { text } = await generateText({
      model,
      maxOutputTokens: MAX_DESCRIPTION_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            // A `file` part, not the older `image` part: the AI SDK
            // deprecated `{ type: "image" }` in favour of a `file` part
            // carrying an explicit `mediaType`, and the deprecated form
            // logs a warning on every single ingestion run.
            {
              type: "file",
              data: input.bytes,
              mediaType: imageMediaType(input.fileName),
              filename: input.fileName,
            },
            { type: "text", text: VISION_PROMPT },
          ],
        },
      ],
    })

    return { text: text.trim() }
  }
}

/** Default, production-wired image head. Tests should use
 *  `createExtractImage(stubModel)` instead of importing this. */
export const extractImage = createExtractImage()
