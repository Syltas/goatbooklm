import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

import type { Database } from "@/lib/database.types"

/**
 * Wrapper um die `*_studio_audio_job(s)`-RPCs (Migration
 * `20260721090001_create_studio_audio_infra.sql`) — service_role-only,
 * gleiche Muster wie `lib/ingestion/queue.ts` inkl. Poison-Message-Handling.
 *
 * `vt = 330`: muss über der Worker-`maxDuration` (300s) liegen, damit ein
 * laufender Tick den Job exklusiv hält — aber bewusst NICHT die 600s der
 * Ingestion: bricht ein Tick am Zeitbudget ab (ohne delete), übernimmt der
 * nächste Tick nach vt-Ablauf; 330s halbiert diese Fortsetzungs-Lücke.
 */
export const STUDIO_AUDIO_VT_SECONDS = 330

const artifactIdSchema = z.uuid()

export interface StudioAudioJob {
  msgId: number
  readCt: number
  artifactId: string
}

export interface PoisonStudioAudioJob {
  msgId: number
  invalid: true
}

export type StudioAudioQueueEntry = StudioAudioJob | PoisonStudioAudioJob

export function isPoisonStudioAudioJob(
  entry: StudioAudioQueueEntry
): entry is PoisonStudioAudioJob {
  return "invalid" in entry && entry.invalid === true
}

export async function enqueueStudioAudioJob(
  supabase: SupabaseClient<Database>,
  artifactId: string
): Promise<void> {
  const { error } = await supabase.rpc("enqueue_studio_audio_job", {
    payload: { artifact_id: artifactId },
  })
  if (error) throw error
}

export async function readStudioAudioJobs(
  supabase: SupabaseClient<Database>,
  opts: { vt?: number; qty?: number } = {}
): Promise<StudioAudioQueueEntry[]> {
  const { data, error } = await supabase.rpc("read_studio_audio_jobs", {
    p_vt: opts.vt ?? STUDIO_AUDIO_VT_SECONDS,
    p_qty: opts.qty ?? 1,
  })
  if (error) throw error

  return (data ?? []).map((row): StudioAudioQueueEntry => {
    const message = row.message as { artifact_id?: unknown } | null
    const parsed = artifactIdSchema.safeParse(message?.artifact_id)
    if (!parsed.success) {
      console.error(
        `[studio-audio-queue] job ${row.msg_id} has no/an invalid artifact_id — poison message`,
        message
      )
      return { msgId: row.msg_id, invalid: true }
    }
    return { msgId: row.msg_id, readCt: row.read_ct, artifactId: parsed.data }
  })
}

export async function deleteStudioAudioJob(
  supabase: SupabaseClient<Database>,
  msgId: number
): Promise<void> {
  const { error } = await supabase.rpc("delete_studio_audio_job", { msg_id: msgId })
  if (error) throw error
}
