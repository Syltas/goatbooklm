import { anthropic } from "@ai-sdk/anthropic"
import { generateObject, streamText } from "ai"
import { after } from "next/server"

import type { Json } from "@/lib/database.types"
import { enqueueStudioAudioJob } from "@/lib/studio/audio-queue"
import {
  AUDIO_FORMAT_META,
  parseAudioContent,
  STALE_GENERATING_MINUTES_AUDIO,
  type AudioFormat,
} from "@/lib/studio/audio-schema"
import {
  flashcardsContentSchema,
  quizContentSchema,
} from "@/lib/studio/content-schema"
import { buildSourcesBlock, splitLeadingH1, type ContextSource } from "@/lib/studio/context"
import { REPORT_FORMAT_META, STUDIO_TYPE_META } from "@/lib/studio/format-meta"
import {
  buildObjectUserTurn,
  buildReportUserTurn,
  FLASHCARDS_SYSTEM_PROMPT,
  QUIZ_SYSTEM_PROMPT,
  REPORT_INCOMPLETE_HINT,
  reportSystemPrompt,
} from "@/lib/studio/prompts"
import {
  generateArtifactSchema,
  type GeneratableType,
  type ReportFormat,
} from "@/lib/studio/schema"
import { createStudioService } from "@/lib/studio/service"
import { shuffleQuizOptions } from "@/lib/studio/shuffle"
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

/**
 * Wie `app/api/chat/route.ts`: 120s Wall-Clock deckt lange Streams/Objekt-
 * Generierungen (Vercel rechnet Streaming-Dauer mit), Node-Runtime für den
 * request-scoped Supabase-SSR-Client.
 */
export const maxDuration = 120
export const runtime = "nodejs"

/** Gleicher verifizierter Slug wie der Chat (`AnthropicModelId`-Union). */
const STUDIO_MODEL_ID = "claude-sonnet-5"

const STUDIO_MAX_OUTPUT_TOKENS = 8192

const GENERIC_FAIL_MESSAGE =
  "Modell aktuell nicht verfügbar oder überlastet. Bitte erneut versuchen."

const RATE_LIMIT_MESSAGE =
  "Zu viele Anfragen. Bitte warte einen Moment und versuche es erneut."

const AUDIO_RATE_LIMIT_MESSAGE =
  "Zu viele Audio-Erzeugungen. Bitte versuche es in einer Stunde erneut."

function provisionalTitle(type: GeneratableType, format: string | null): string {
  if (type === "report" && format) {
    return REPORT_FORMAT_META[format as ReportFormat].label
  }
  if (type === "audio" && format) {
    return AUDIO_FORMAT_META[format as AudioFormat].label
  }
  return STUDIO_TYPE_META[type].label
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return textError("Ungültiger Request-Body.", 400)
  }

  const parsed = generateArtifactSchema.safeParse(body)
  if (!parsed.success) {
    return textError(parsed.error.issues[0]?.message ?? "Ungültige Eingabe.", 400)
  }
  const input = parsed.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Fail-closed: keine Session, keine weitere Arbeit.
  if (!user) {
    return textError("Nicht angemeldet.", 401)
  }

  const service = createStudioService({ db: supabase })

  // Owner-Check — fremde und nicht existierende Notebooks antworten
  // einheitlich 404 (Chat-Konvention, kein Leak welcher Fall vorlag).
  const notebook = await service.assertNotebookOwned(input.notebookId)
  if (!notebook) {
    return textError("Notizbuch nicht gefunden.", 404)
  }

  // Rate-Limit (studio_generate): jede Generierung — Report/Flashcards/Quiz/
  // Audio — zählt gegen dieses Budget, VOR jedem Artefakt-Insert/Claim/Enqueue
  // und vor dem bezahlten Modell-Aufruf. Der Zähler liegt in Postgres
  // (serverless-safe); der RPC löst den User serverseitig via auth.uid() auf.
  const generateLimit = await enforceRateLimit(
    supabase,
    "studio_generate",
    RATE_LIMITS.studio_generate
  )
  if (!generateLimit.allowed) {
    return textError(RATE_LIMIT_MESSAGE, 429)
  }

  // Audio triggert zusätzlich ElevenLabs (per-character TTS) — der teuerste
  // Pfad. Deshalb ein zweites, deutlich engeres Stundenbudget, das NUR
  // Audio-Anfragen zählt. Wird in beiden Zweigen (Retry/Create) geprüft,
  // sobald `type` bekannt ist, aber noch VOR dem Artefakt-Insert/Claim.
  async function enforceAudioLimit(): Promise<Response | null> {
    const audioLimit = await enforceRateLimit(
      supabase,
      "studio_audio",
      RATE_LIMITS.studio_audio
    )
    return audioLimit.allowed ? null : textError(AUDIO_RATE_LIMIT_MESSAGE, 429)
  }

  let artifactId: string
  let type: GeneratableType
  let format: string | null
  let sources: ContextSource[]

  if ("retryArtifactId" in input) {
    const existing = await service.getOwnedArtifact(input.retryArtifactId)
    if (!existing || existing.notebook_id !== input.notebookId) {
      return textError("Artefakt nicht gefunden.", 404)
    }
    type = existing.type as GeneratableType
    format = existing.format

    // Audio-Stundenbudget VOR dem Retry-Claim (kein Artefakt-Reset bei Limit).
    if (type === "audio") {
      const limited = await enforceAudioLimit()
      if (limited) return limited
    }

    // Audio in der TTS-Phase behält seinen Quellen-Snapshot — das bezahlte
    // Skript basiert darauf (Spec Retry-Anpassung). Alle anderen Fälle
    // (inkl. Audio in der Skript-Phase) laden frisch: Schnittmenge mit noch
    // ready-Quellen, sonst Alle-Quellen-Fallback.
    const audioPhase =
      type === "audio" ? parseAudioContent(existing.content)?.phase : undefined
    const keepSnapshot = type === "audio" && audioPhase === "tts"

    if (keepSnapshot) {
      sources = []
    } else {
      sources = await service.loadReadySources(
        input.notebookId,
        existing.source_ids.length > 0 ? existing.source_ids : undefined
      )
      if (sources.length === 0) {
        sources = await service.loadReadySources(input.notebookId)
      }
      if (sources.length === 0) {
        return textError(
          "Keine verarbeitete Quelle mit Inhalt vorhanden. Füge zuerst eine Quelle hinzu.",
          422
        )
      }
    }

    // Retry-Guard: nur `failed` oder stale-`generating` (updated_at älter
    // als das Backstop-Fenster; Audio: 15 min, Inline-Typen: 5 min) darf
    // zurückgesetzt werden — 0 getroffene Rows heißt "läuft noch" → 409.
    const claimed = await service.claimRetry({
      artifactId: existing.id,
      notebookId: input.notebookId,
      sourceIds: keepSnapshot
        ? existing.source_ids
        : sources.map((source) => source.id),
      provisionalTitle: provisionalTitle(type, format),
      preserveContent: type === "audio",
      staleMinutes: type === "audio" ? STALE_GENERATING_MINUTES_AUDIO : undefined,
    })
    if (!claimed) {
      return textError("Dieses Artefakt wird gerade erstellt.", 409)
    }
    artifactId = claimed.id
  } else {
    type = input.type
    format =
      input.type === "report" || input.type === "audio" ? input.format : null

    // Audio-Stundenbudget VOR dem Artefakt-Insert und dem Key-Gate.
    if (type === "audio") {
      const limited = await enforceAudioLimit()
      if (limited) return limited
    }

    if (input.type === "audio" && !process.env.ELEVENLABS_API_KEY) {
      // Fail-closed VOR jedem Insert/Enqueue (Spec Key-Gate).
      return textError(
        "Audio-Erzeugung ist nicht konfiguriert (ELEVENLABS_API_KEY fehlt).",
        503
      )
    }

    // Auswahl aus dem Create-Dialog; leere/fehlende Auswahl = alle
    // ready-Quellen. Fremde IDs fallen als Schnittmenge einfach raus.
    sources = await service.loadReadySources(input.notebookId, input.sourceIds)
    if (sources.length === 0) {
      return textError(
        "Keine der gewählten Quellen ist verarbeitet und hat Inhalt.",
        422
      )
    }

    const artifact = await service.createGeneratingArtifact({
      notebookId: input.notebookId,
      userId: user.id,
      type,
      format,
      provisionalTitle: provisionalTitle(type, format),
      sourceIds: sources.map((source) => source.id),
      initialContent:
        input.type === "audio"
          ? {
              params: {
                language: input.language,
                length: input.length,
                ...(input.focus?.trim() ? { focus: input.focus.trim() } : {}),
              },
              phase: "script",
            }
          : undefined,
    })
    artifactId = artifact.id
  }

  // -------------------------------------------------------------------------
  // Audio: kein Inline-Pfad — Job in die pgmq-Queue (Admin-Client, RPC ist
  // service_role-only; Ownership wurde oben RLS-scoped geprüft), der
  // pg_cron-Worker übernimmt. Panel-Poll zeigt die Phasen.
  // -------------------------------------------------------------------------
  if (type === "audio") {
    try {
      await enqueueStudioAudioJob(createAdminClient(), artifactId)
    } catch (err) {
      console.error("[studio] enqueue audio job failed", err)
      await failSafely(service, artifactId)
      return textError("Etwas ist schiefgelaufen. Bitte erneut versuchen.", 500)
    }
    return Response.json(
      { artifactId },
      { status: 202, headers: { "X-Artifact-Id": artifactId, "Cache-Control": "no-store" } }
    )
  }

  const sourcesBlock = buildSourcesBlock(sources)

  // -------------------------------------------------------------------------
  // Reports: Text-Stream (Live-Rendering im Viewer), Persist in after().
  // -------------------------------------------------------------------------
  if (type === "report") {
    const result = streamText({
      model: anthropic(STUDIO_MODEL_ID),
      system: reportSystemPrompt(format as ReportFormat),
      messages: [{ role: "user", content: buildReportUserTurn(sourcesBlock) }],
      maxOutputTokens: STUDIO_MAX_OUTPUT_TOKENS,
    })

    // Chat-Pattern (F4/AC-43): der Modell-Stream läuft unabhängig von der
    // Client-Verbindung zu Ende; die Persistenz sitzt in `after()` — Tab zu
    // heißt: der Report wird trotzdem fertig und landet als `ready` in der DB.
    result.consumeStream()

    after(async () => {
      try {
        const [text, finishReason] = await Promise.all([
          result.text,
          result.finishReason,
        ])
        const { title, body: markdown } = splitLeadingH1(text)
        const truncated = finishReason !== "stop"
        await service.finalizeReady({
          artifactId,
          title: title ?? provisionalTitle(type, format),
          content: truncated
            ? { markdown: `${markdown}${REPORT_INCOMPLETE_HINT}`, truncated: true }
            : { markdown },
        })
      } catch (err) {
        console.error("[studio] report generation failed", err)
        await failSafely(service, artifactId)
      }
    })

    return result.toTextStreamResponse({
      headers: {
        "X-Artifact-Id": artifactId,
        "Cache-Control": "no-store",
      },
    })
  }

  // -------------------------------------------------------------------------
  // Flashcards/Quiz: strukturierte Generierung. Kein Live-Stream — die
  // Response trägt sofort die Artefakt-ID (202), `generateObject` + Persist
  // laufen in after() zu Ende; das Panel pollt die `generating`-Row.
  // -------------------------------------------------------------------------
  const objectSchema = type === "flashcards" ? flashcardsContentSchema : quizContentSchema
  const system = type === "flashcards" ? FLASHCARDS_SYSTEM_PROMPT : QUIZ_SYSTEM_PROMPT

  after(async () => {
    try {
      const { object } = await generateObject({
        model: anthropic(STUDIO_MODEL_ID),
        schema: objectSchema,
        system,
        messages: [{ role: "user", content: buildObjectUserTurn(sourcesBlock) }],
        maxOutputTokens: STUDIO_MAX_OUTPUT_TOKENS,
      })
      // #9: das Modell biased `correct_index` fast immer auf 0 — im Viewer
      // war die korrekte Antwort dadurch praktisch immer Option A. Fix nur
      // für Quiz-Artefakte (erkennbar an `questions`; Flashcards haben
      // `cards` und kein Options-/Index-Konzept): Optionen je Frage mischen,
      // `correct_index` auf die neue Position der korrekten Option remappen.
      const content = "questions" in object ? shuffleQuizOptions(object) : object
      await service.finalizeReady({
        artifactId,
        title: object.title,
        content: content as unknown as Json,
      })
    } catch (err) {
      console.error(`[studio] ${type} generation failed`, err)
      await failSafely(service, artifactId)
    }
  })

  return Response.json(
    { artifactId },
    {
      status: 202,
      headers: {
        "X-Artifact-Id": artifactId,
        "Cache-Control": "no-store",
      },
    }
  )
}

async function failSafely(
  service: ReturnType<typeof createStudioService>,
  artifactId: string
): Promise<void> {
  try {
    await service.finalizeFailed({ artifactId, errorMessage: GENERIC_FAIL_MESSAGE })
  } catch (persistErr) {
    console.error("[studio] finalizeFailed persist failed", persistErr)
  }
}

function textError(message: string, status: number): Response {
  return new Response(message, { status })
}
