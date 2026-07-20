import { anthropic } from "@ai-sdk/anthropic"
import { streamText } from "ai"
import { after } from "next/server"

import { buildSourcesBlock, splitLeadingH1 } from "@/lib/studio/context"
import { REPORT_FORMAT_META } from "@/lib/studio/format-meta"
import {
  buildReportUserTurn,
  REPORT_INCOMPLETE_HINT,
  reportSystemPrompt,
} from "@/lib/studio/prompts"
import { generateReportSchema, type ReportFormat } from "@/lib/studio/schema"
import { createStudioService } from "@/lib/studio/service"
import { createClient } from "@/lib/supabase/server"

/**
 * Wie `app/api/chat/route.ts`: 120s Wall-Clock deckt lange Streams (Vercel
 * rechnet Streaming-Dauer mit), Node-Runtime für den request-scoped
 * Supabase-SSR-Client.
 */
export const maxDuration = 120
export const runtime = "nodejs"

/** Gleicher verifizierter Slug wie der Chat (`AnthropicModelId`-Union). */
const REPORT_MODEL_ID = "claude-sonnet-5"

const REPORT_MAX_OUTPUT_TOKENS = 8192

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return textError("Ungültiger Request-Body.", 400)
  }

  const parsed = generateReportSchema.safeParse(body)
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

  // v1-Scope: alle ready-Quellen mit Inhalt (Spec Premise 4). Das optionale
  // `sourceIds` der Create-Variante ist Forward-Compat und wird ignoriert.
  const sources = await service.loadReadySources(input.notebookId)
  if (sources.length === 0) {
    return textError(
      "Keine verarbeitete Quelle mit Inhalt vorhanden. Füge zuerst eine Quelle hinzu.",
      422
    )
  }
  const sourceIds = sources.map((source) => source.id)

  let artifactId: string
  let format: ReportFormat

  if ("retryArtifactId" in input) {
    const existing = await service.getOwnedArtifact(input.retryArtifactId)
    if (!existing || existing.type !== "report" || existing.notebook_id !== input.notebookId) {
      return textError("Bericht nicht gefunden.", 404)
    }
    format = existing.format as ReportFormat

    // Retry-Guard: nur `failed` oder stale-`generating` (updated_at älter
    // als das Backstop-Fenster) darf zurückgesetzt werden — 0 getroffene
    // Rows heißt "läuft noch" → 409, nichts wird geclobbert.
    const claimed = await service.claimRetry({
      artifactId: existing.id,
      notebookId: input.notebookId,
      sourceIds,
      provisionalTitle: REPORT_FORMAT_META[format].label,
    })
    if (!claimed) {
      return textError("Dieser Bericht wird gerade erstellt.", 409)
    }
    artifactId = claimed.id
  } else {
    format = input.format
    const artifact = await service.createGeneratingArtifact({
      notebookId: input.notebookId,
      userId: user.id,
      format,
      provisionalTitle: REPORT_FORMAT_META[format].label,
      sourceIds,
    })
    artifactId = artifact.id
  }

  const result = streamText({
    model: anthropic(REPORT_MODEL_ID),
    system: reportSystemPrompt(format),
    messages: [{ role: "user", content: buildReportUserTurn(buildSourcesBlock(sources)) }],
    maxOutputTokens: REPORT_MAX_OUTPUT_TOKENS,
  })

  // Chat-Pattern (F4/AC-43): der Modell-Stream läuft unabhängig von der
  // Client-Verbindung zu Ende; die Persistenz sitzt in `after()`, das auf
  // Vercel garantiert nach der Response noch ausgeführt wird — Tab zu
  // heißt: der Report wird trotzdem fertig und landet als `ready` in der DB.
  result.consumeStream()

  after(async () => {
    try {
      const [text, finishReason] = await Promise.all([result.text, result.finishReason])
      const { title, body: markdown } = splitLeadingH1(text)
      const truncated = finishReason !== "stop"
      await service.finalizeReady({
        artifactId,
        title: title ?? REPORT_FORMAT_META[format].label,
        markdown: truncated ? `${markdown}${REPORT_INCOMPLETE_HINT}` : markdown,
        truncated,
      })
    } catch (err) {
      console.error("[studio] report generation failed", err)
      try {
        await service.finalizeFailed({
          artifactId,
          errorMessage:
            "Modell aktuell nicht verfügbar oder überlastet. Bitte erneut versuchen.",
        })
      } catch (persistErr) {
        console.error("[studio] finalizeFailed persist failed", persistErr)
      }
    }
  })

  // Reiner Text-Stream (kein useChat-Protokoll — der Viewer ist kein Chat);
  // die Artefakt-ID reist im Header, damit der Client Liste/Viewer sofort
  // an die richtige Row binden kann.
  return result.toTextStreamResponse({
    headers: {
      "X-Artifact-Id": artifactId,
      "Cache-Control": "no-store",
    },
  })
}

function textError(message: string, status: number): Response {
  return new Response(message, { status })
}
