import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, Json } from "@/lib/database.types"

import {
  parseAudioContent,
  SCRIPT_CHAR_CAP,
  type AudioContent,
  type AudioFormat,
  type AudioScript,
} from "./audio-schema"
import {
  isPoisonStudioAudioJob,
  type StudioAudioQueueEntry,
} from "./audio-queue"
import { buildSourcesBlock, type ContextSource } from "./context"
import { ElevenLabsError } from "./elevenlabs"

type StudioArtifactRow = Database["public"]["Tables"]["studio_artifacts"]["Row"]

/**
 * Phasen-Maschine des Audio-Workers (docs/specs/studio-audio.md, Approach B)
 * — pure Orchestrierung, alle Seiteneffekte injiziert (service-builder-
 * Pattern wie `lib/ingestion/worker.ts`). Läuft ausschließlich im
 * pg_cron-getriggerten Route-Handler mit Admin-Client.
 *
 * Phasen: `script` (Claude schreibt + persistiert das Skript, teuerste
 * Einzelphase — wird bei Retry NIE wiederholt, wenn sie fertig war) →
 * `tts` (pro Turn ein Segment, `tts.done` persistiert nach jedem Segment →
 * ein am Zeitbudget abgebrochener Tick setzt exakt dort fort) → Finalisieren
 * (Segmente concat → eine MP3 → `ready`).
 */

export const TICK_BUDGET_MS = 240_000

const GENERIC_FAIL = "Audio-Erzeugung fehlgeschlagen. Bitte erneut versuchen."

export interface AudioWorkerDeps {
  /** Admin-Client (BYPASSRLS) — der Worker hat keinen acting user. */
  db: SupabaseClient<Database>
  readJobs: () => Promise<StudioAudioQueueEntry[]>
  deleteJob: (msgId: number) => Promise<void>
  generateScript: (input: {
    format: AudioFormat
    content: AudioContent
    sourcesBlock: string
  }) => Promise<AudioScript>
  synthesizeTurn: (input: {
    speaker: 1 | 2
    text: string
    previousText?: string
    nextText?: string
    languageCode: string
  }) => Promise<Uint8Array>
  storage: {
    upload: (path: string, data: Uint8Array) => Promise<void>
    download: (path: string) => Promise<Uint8Array>
    remove: (paths: string[]) => Promise<void>
  }
  concatSegments: (segments: Uint8Array[]) => Uint8Array
  now: () => number
  tickBudgetMs?: number
}

export interface TickSummary {
  processed: number
  deferred: number
  failed: number
  deletedStale: number
}

function segmentPath(row: StudioArtifactRow, index: number): string {
  return `${row.user_id}/${row.id}/segments/${index}.mp3`
}

function finalPath(row: StudioArtifactRow): string {
  return `${row.user_id}/${row.id}.mp3`
}

export async function processStudioAudioTick(deps: AudioWorkerDeps): Promise<TickSummary> {
  const summary: TickSummary = { processed: 0, deferred: 0, failed: 0, deletedStale: 0 }
  const budget = deps.tickBudgetMs ?? TICK_BUDGET_MS
  const startedAt = deps.now()

  const entries = await deps.readJobs()

  for (const entry of entries) {
    if (isPoisonStudioAudioJob(entry)) {
      await deps.deleteJob(entry.msgId)
      summary.deletedStale++
      continue
    }

    // Message-Guard (Review-Fix R1-3): Artefakt weg oder bereits
    // finalisiert (ready/failed — z. B. UI-Retry-Re-Enqueue trifft auf
    // Redelivery eines abgestürzten Ticks) → Message weg, keine Arbeit.
    const { data: row, error } = await deps.db
      .from("studio_artifacts")
      .select()
      .eq("id", entry.artifactId)
      .maybeSingle()
    if (error) throw error
    if (!row || row.type !== "audio" || row.status !== "generating") {
      await deps.deleteJob(entry.msgId)
      summary.deletedStale++
      continue
    }

    const content = parseAudioContent(row.content)
    if (!content) {
      await failArtifact(deps, row.id, GENERIC_FAIL)
      await deps.deleteJob(entry.msgId)
      summary.failed++
      continue
    }

    try {
      const outcome = await processJob(deps, row, content, () => deps.now() - startedAt > budget)
      if (outcome === "deferred") {
        // Zeitbudget erschöpft: Job NICHT löschen — vt läuft ab, der
        // nächste Tick liest denselben Job und setzt am Zwischenstand fort.
        summary.deferred++
      } else {
        await deps.deleteJob(entry.msgId)
        summary.processed++
      }
    } catch (err) {
      console.error(`[studio-audio-worker] job for artifact ${row.id} failed`, err)
      const userMessage = err instanceof ElevenLabsError ? err.userMessage : GENERIC_FAIL
      await failArtifact(deps, row.id, userMessage)
      await deps.deleteJob(entry.msgId)
      summary.failed++
    }
  }

  return summary
}

async function processJob(
  deps: AudioWorkerDeps,
  row: StudioArtifactRow,
  content: AudioContent,
  overBudget: () => boolean
): Promise<"done" | "deferred"> {
  let current = content

  if (current.phase === "script") {
    const sources = await loadSources(deps.db, row)
    if (sources.length === 0) {
      throw new Error("no ready sources with content for audio job")
    }

    const script = await deps.generateScript({
      format: row.format as AudioFormat,
      content: current,
      sourcesBlock: buildSourcesBlock(sources),
    })

    // Kosten-Cap (Review-Fix R1-4): nie mit einem Runaway-Skript in die
    // bezahlte TTS-Phase.
    const totalChars = script.turns.reduce((sum, turn) => sum + turn.text.length, 0)
    if (totalChars > SCRIPT_CHAR_CAP) {
      throw new Error(
        `script exceeds char cap (${totalChars} > ${SCRIPT_CHAR_CAP})`
      )
    }

    current = {
      ...current,
      phase: "tts",
      script,
      tts: { done: 0, total: script.turns.length },
    }
    await updateContent(deps.db, row.id, current)
  }

  if (current.phase !== "tts" || !current.script || !current.tts) {
    throw new Error(`unexpected audio job state (phase ${current.phase})`)
  }

  const script = current.script
  const turns = script.turns
  for (let index = current.tts.done; index < turns.length; index++) {
    if (overBudget()) return "deferred"

    const turn = turns[index]
    const segment = await deps.synthesizeTurn({
      speaker: turn.speaker,
      text: turn.text,
      previousText: index > 0 ? turns[index - 1].text : undefined,
      nextText: index < turns.length - 1 ? turns[index + 1].text : undefined,
      languageCode: current.params.language,
    })
    // Upsert-Semantik: Wiederholung nach Crash überschreibt dasselbe
    // Segment — idempotent.
    await deps.storage.upload(segmentPath(row, index), segment)

    current = { ...current, tts: { done: index + 1, total: turns.length } }
    await updateContent(deps.db, row.id, current)
  }

  // Finalisieren: Segmente einsammeln, konkatenieren, final hochladen.
  const segments: Uint8Array[] = []
  for (let index = 0; index < turns.length; index++) {
    segments.push(await deps.storage.download(segmentPath(row, index)))
  }
  const finalAudio = deps.concatSegments(segments)
  await deps.storage.upload(finalPath(row), finalAudio)

  const finalContent: AudioContent = {
    params: current.params,
    phase: "done",
    script,
    storage_path: finalPath(row),
  }
  const { error } = await deps.db
    .from("studio_artifacts")
    .update({
      status: "ready",
      title: script.title,
      content: finalContent as unknown as Json,
      error_message: null,
    })
    .eq("id", row.id)
  if (error) throw error

  // Aufräumen zuletzt — ein Fehler hier darf das ready nicht mehr kippen.
  try {
    await deps.storage.remove(
      turns.map((_, index) => segmentPath(row, index))
    )
  } catch (cleanupErr) {
    console.error(`[studio-audio-worker] segment cleanup failed for ${row.id}`, cleanupErr)
  }

  return "done"
}

async function loadSources(
  db: SupabaseClient<Database>,
  row: StudioArtifactRow
): Promise<ContextSource[]> {
  let query = db
    .from("sources")
    .select("id, title, content_text")
    .eq("notebook_id", row.notebook_id)
    .eq("status", "ready")
    .order("created_at", { ascending: true })
  if (row.source_ids.length > 0) {
    query = query.in("id", row.source_ids)
  }
  const { data, error } = await query
  if (error) throw error
  return (data ?? [])
    .filter((s) => (s.content_text ?? "").trim().length > 0)
    .map((s) => ({ id: s.id, title: s.title, contentText: s.content_text as string }))
}

async function updateContent(
  db: SupabaseClient<Database>,
  artifactId: string,
  content: AudioContent
): Promise<void> {
  const { error } = await db
    .from("studio_artifacts")
    .update({ content: content as unknown as Json })
    .eq("id", artifactId)
  if (error) throw error
}

async function failArtifact(
  deps: AudioWorkerDeps,
  artifactId: string,
  errorMessage: string
): Promise<void> {
  try {
    const { error } = await deps.db
      .from("studio_artifacts")
      .update({ status: "failed", error_message: errorMessage })
      .eq("id", artifactId)
    if (error) throw error
  } catch (persistErr) {
    console.error(`[studio-audio-worker] failArtifact persist failed for ${artifactId}`, persistErr)
  }
}
