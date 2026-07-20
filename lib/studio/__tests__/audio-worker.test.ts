import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import type { Database } from "@/lib/database.types"

import { processStudioAudioTick, type AudioWorkerDeps } from "../audio-worker"
import type { AudioScript } from "../audio-schema"

type QueryResult = { data: unknown; error: unknown }

/** Table-aware Chainable-Mock (Muster aus service.test.ts). */
function createMockDb(responsesByTable: Record<string, QueryResult[]>) {
  const callsByTable: Record<string, { method: string; args: unknown[] }[]> = {}
  const queues: Record<string, QueryResult[]> = {}
  for (const [t, r] of Object.entries(responsesByTable)) queues[t] = [...r]

  function chainableFor(table: string) {
    callsByTable[table] ??= []
    const log = callsByTable[table]
    const nextResult = () => (queues[table] ??= []).shift() ?? { data: null, error: null }
    const chainable: Record<string, unknown> = {
      then: (ok: (v: QueryResult) => unknown, err?: (r: unknown) => unknown) =>
        Promise.resolve(nextResult()).then(ok, err),
    }
    for (const m of ["select", "update", "eq", "in", "order"]) {
      chainable[m] = vi.fn((...args: unknown[]) => {
        log.push({ method: m, args })
        return chainable
      })
    }
    for (const m of ["single", "maybeSingle"]) {
      chainable[m] = vi.fn(() => {
        log.push({ method: m, args: [] })
        return Promise.resolve(nextResult())
      })
    }
    return chainable
  }

  const chainables: Record<string, ReturnType<typeof chainableFor>> = {}
  const from = vi.fn((table: string) => (chainables[table] ??= chainableFor(table)))
  return { db: { from } as unknown as SupabaseClient<Database>, callsByTable }
}

const SCRIPT: AudioScript = {
  title: "Test-Episode",
  turns: [
    { speaker: 1, text: "Erster Beitrag." },
    { speaker: 2, text: "Zweiter Beitrag." },
    { speaker: 1, text: "Dritter Beitrag." },
  ],
}

function artifactRow(content: unknown) {
  return {
    id: "art-1",
    notebook_id: "nb-1",
    user_id: "user-1",
    type: "audio",
    format: "brief",
    title: "Kurzüberblick",
    status: "generating",
    content,
    source_ids: ["s1"],
    error_message: null,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
  }
}

function createDeps(overrides: Partial<AudioWorkerDeps> & { db: AudioWorkerDeps["db"] }) {
  const uploads: Record<string, Uint8Array> = {}
  const deps: AudioWorkerDeps = {
    readJobs: async () => [{ msgId: 1, readCt: 1, artifactId: "art-1" }],
    deleteJob: vi.fn(async () => undefined),
    generateScript: vi.fn(async () => SCRIPT),
    synthesizeTurn: vi.fn(async () => new Uint8Array([1, 2, 3])),
    storage: {
      upload: vi.fn(async (path: string, data: Uint8Array) => {
        uploads[path] = data
      }),
      download: vi.fn(async () => new Uint8Array([1, 2, 3])),
      remove: vi.fn(async () => undefined),
    },
    concatSegments: vi.fn((segments: Uint8Array[]) => segments[0]),
    now: () => 0,
    ...overrides,
  }
  return { deps, uploads }
}

describe("Message-Guard", () => {
  it("löscht die Message ohne Arbeit, wenn das Artefakt fehlt", async () => {
    const { db } = createMockDb({ studio_artifacts: [{ data: null, error: null }] })
    const { deps } = createDeps({ db })
    const summary = await processStudioAudioTick(deps)
    expect(summary.deletedStale).toBe(1)
    expect(deps.deleteJob).toHaveBeenCalledWith(1)
    expect(deps.generateScript).not.toHaveBeenCalled()
  })

  it("löscht die Message, wenn das Artefakt schon ready ist", async () => {
    const { db } = createMockDb({
      studio_artifacts: [{ data: { ...artifactRow({}), status: "ready" }, error: null }],
    })
    const { deps } = createDeps({ db })
    const summary = await processStudioAudioTick(deps)
    expect(summary.deletedStale).toBe(1)
    expect(deps.synthesizeTurn).not.toHaveBeenCalled()
  })
})

describe("Skript-Phase → TTS → ready (voller Durchlauf)", () => {
  it("generiert Skript, synthetisiert alle Turns, finalisiert", async () => {
    const content = { params: { language: "de", length: "kurz" }, phase: "script" }
    const { db, callsByTable } = createMockDb({
      studio_artifacts: [
        { data: artifactRow(content), error: null }, // load
        { data: null, error: null }, // update: phase tts
        { data: null, error: null }, // tts.done = 1
        { data: null, error: null }, // tts.done = 2
        { data: null, error: null }, // tts.done = 3
        { data: null, error: null }, // final ready update
      ],
      sources: [
        { data: [{ id: "s1", title: "Q", content_text: "Inhalt" }], error: null },
      ],
    })
    const { deps, uploads } = createDeps({ db })

    const summary = await processStudioAudioTick(deps)

    expect(summary.processed).toBe(1)
    expect(deps.generateScript).toHaveBeenCalledTimes(1)
    expect(deps.synthesizeTurn).toHaveBeenCalledTimes(3)
    // previous/next-Kontext des mittleren Turns
    expect(deps.synthesizeTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        previousText: "Erster Beitrag.",
        nextText: "Dritter Beitrag.",
      })
    )
    expect(Object.keys(uploads)).toContain("user-1/art-1/segments/0.mp3")
    expect(Object.keys(uploads)).toContain("user-1/art-1.mp3")
    expect(deps.storage.remove).toHaveBeenCalledWith([
      "user-1/art-1/segments/0.mp3",
      "user-1/art-1/segments/1.mp3",
      "user-1/art-1/segments/2.mp3",
    ])
    const finalUpdate = callsByTable.studio_artifacts
      .filter((c) => c.method === "update")
      .at(-1)
    expect(finalUpdate?.args[0]).toMatchObject({
      status: "ready",
      title: "Test-Episode",
    })
    expect(deps.deleteJob).toHaveBeenCalledWith(1)
  })
})

describe("Zeitbudget", () => {
  it("bricht nach Budget ab, ohne den Job zu löschen — Zwischenstand persistiert", async () => {
    const content = {
      params: { language: "de", length: "kurz" },
      phase: "tts",
      script: SCRIPT,
      tts: { done: 0, total: 3 },
    }
    const { db, callsByTable } = createMockDb({
      studio_artifacts: [
        { data: artifactRow(content), error: null },
        { data: null, error: null }, // tts.done = 1
      ],
    })
    let clock = 0
    const { deps } = createDeps({
      db,
      // Nach dem ersten Segment ist das Budget überschritten.
      now: () => {
        clock += 130_000
        return clock
      },
    })

    const summary = await processStudioAudioTick(deps)

    expect(summary.deferred).toBe(1)
    expect(deps.deleteJob).not.toHaveBeenCalled()
    expect(deps.synthesizeTurn).toHaveBeenCalledTimes(1)
    const updates = callsByTable.studio_artifacts.filter((c) => c.method === "update")
    expect(updates.at(-1)?.args[0]).toMatchObject({
      content: expect.objectContaining({ tts: { done: 1, total: 3 } }),
    })
  })

  it("setzt bei tts.done=1 exakt beim zweiten Turn fort", async () => {
    const content = {
      params: { language: "de", length: "kurz" },
      phase: "tts",
      script: SCRIPT,
      tts: { done: 1, total: 3 },
    }
    const { db } = createMockDb({
      studio_artifacts: [
        { data: artifactRow(content), error: null },
        { data: null, error: null }, // tts.done = 2
        { data: null, error: null }, // tts.done = 3
        { data: null, error: null }, // ready
      ],
    })
    const { deps } = createDeps({ db })

    const summary = await processStudioAudioTick(deps)

    expect(summary.processed).toBe(1)
    expect(deps.synthesizeTurn).toHaveBeenCalledTimes(2)
    expect(deps.synthesizeTurn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ text: "Zweiter Beitrag." })
    )
  })
})

describe("Kosten-Cap", () => {
  it("markiert Runaway-Skripte als failed, ohne TTS zu starten", async () => {
    const content = { params: { language: "de", length: "kurz" }, phase: "script" }
    const longScript: AudioScript = {
      title: "Zu lang",
      turns: [
        { speaker: 1, text: "x".repeat(16_000) },
        { speaker: 2, text: "y".repeat(16_000) },
        { speaker: 1, text: "z" },
      ],
    }
    const { db } = createMockDb({
      studio_artifacts: [
        { data: artifactRow(content), error: null },
        { data: null, error: null }, // failed update
      ],
      sources: [
        { data: [{ id: "s1", title: "Q", content_text: "Inhalt" }], error: null },
      ],
    })
    const { deps } = createDeps({
      db,
      generateScript: vi.fn(async () => longScript),
    })

    const summary = await processStudioAudioTick(deps)

    expect(summary.failed).toBe(1)
    expect(deps.synthesizeTurn).not.toHaveBeenCalled()
    expect(deps.deleteJob).toHaveBeenCalledWith(1)
  })
})
