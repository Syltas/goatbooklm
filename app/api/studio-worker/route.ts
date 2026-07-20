import { timingSafeEqual } from "node:crypto"

import { anthropic } from "@ai-sdk/anthropic"
import { generateObject } from "ai"
import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import type { Database } from "@/lib/database.types"
import {
  audioScriptSystemPrompt,
  buildAudioScriptUserTurn,
} from "@/lib/studio/audio-prompts"
import { audioScriptSchema } from "@/lib/studio/audio-schema"
import {
  deleteStudioAudioJob,
  readStudioAudioJobs,
  STUDIO_AUDIO_VT_SECONDS,
} from "@/lib/studio/audio-queue"
import { processStudioAudioTick } from "@/lib/studio/audio-worker"
import { synthesizeTurn } from "@/lib/studio/elevenlabs"
import { concatAudioSegments } from "@/lib/studio/mp3"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * pg_cron-getriggerter Studio-Audio-Worker (docs/specs/studio-audio.md) —
 * exakt das Gerüst von `app/api/ingestion-worker/route.ts`: nie von Usern
 * aufgerufen, pg_cron + pg_net POSTen alle 15s mit Shared-Secret-Header;
 * fail-closed, constant-time verglichen. Secret lebt NUR in
 * `studio_worker_config` (Seed/manuelles UPDATE), nie in env.
 */
export const maxDuration = 300
export const runtime = "nodejs"

const WORKER_SECRET_HEADER = "x-worker-secret"
const SCRIPT_MODEL_ID = "claude-sonnet-5"
const SCRIPT_MAX_OUTPUT_TOKENS = 16_000
const BUCKET = "studio-audio"

const SECRET_CACHE_TTL_MS = 30_000
let cachedSecret: { value: string; fetchedAt: number } | null = null

async function loadWorkerSecret(
  supabase: SupabaseClient<Database>
): Promise<string | null> {
  if (cachedSecret && Date.now() - cachedSecret.fetchedAt < SECRET_CACHE_TTL_MS) {
    return cachedSecret.value
  }
  const { data, error } = await supabase
    .from("studio_worker_config")
    .select("secret")
    .eq("id", true)
    .maybeSingle()
  if (error || !data) {
    console.error("[studio-worker] failed to load worker secret", error)
    return null
  }
  cachedSecret = { value: data.secret, fetchedAt: Date.now() }
  return data.secret
}

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const admin = createAdminClient()

  // Fail-closed: kein Secret ladbar oder Header falsch → 401, kein Tick.
  const expected = await loadWorkerSecret(admin)
  const provided = request.headers.get(WORKER_SECRET_HEADER)
  if (!expected || !provided || !secretsMatch(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    // Route erst gar nicht arbeiten lassen — Create-Route gated das ebenso,
    // aber ein bereits enqueueter Job soll hier klar sichtbar liegen bleiben.
    console.error("[studio-worker] ELEVENLABS_API_KEY missing — skipping tick")
    return NextResponse.json({ skipped: "missing elevenlabs key" }, { status: 200 })
  }

  try {
    const summary = await processStudioAudioTick({
      db: admin,
      readJobs: () =>
        readStudioAudioJobs(admin, { vt: STUDIO_AUDIO_VT_SECONDS, qty: 1 }),
      deleteJob: (msgId) => deleteStudioAudioJob(admin, msgId),
      generateScript: async ({ format, content, sourcesBlock }) => {
        const { object } = await generateObject({
          model: anthropic(SCRIPT_MODEL_ID),
          schema: audioScriptSchema,
          system: audioScriptSystemPrompt(format, content.params),
          messages: [
            {
              role: "user",
              content: buildAudioScriptUserTurn(sourcesBlock, content.params.focus),
            },
          ],
          maxOutputTokens: SCRIPT_MAX_OUTPUT_TOKENS,
        })
        return object
      },
      synthesizeTurn: (input) => synthesizeTurn({ apiKey, ...input }),
      storage: {
        upload: async (path, data) => {
          const { error } = await admin.storage
            .from(BUCKET)
            .upload(path, data, { contentType: "audio/mpeg", upsert: true })
          if (error) throw error
        },
        download: async (path) => {
          const { data, error } = await admin.storage.from(BUCKET).download(path)
          if (error || !data) throw error ?? new Error(`download failed: ${path}`)
          return new Uint8Array(await data.arrayBuffer())
        },
        remove: async (paths) => {
          const { error } = await admin.storage.from(BUCKET).remove(paths)
          if (error) throw error
        },
      },
      concatSegments: concatAudioSegments,
      now: () => Date.now(),
    })

    return NextResponse.json(summary)
  } catch (err) {
    // Infrastruktur-Fehler (Queue-RPC down etc.) — 500, pg_cron kommt in
    // 15s wieder; der Job bleibt dank vt erhalten.
    console.error("[studio-worker] tick failed", err)
    return NextResponse.json({ error: "tick failed" }, { status: 500 })
  }
}
