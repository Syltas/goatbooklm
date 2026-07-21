import { describe, expect, it, vi } from "vitest"

import { SourceNotFoundError, type Source } from "../service"
import {
  MAX_DELIVERY_ATTEMPTS,
  processIngestionTick,
  type PoisonWorkerJob,
  type WorkerJob,
  type WorkerQueueItem,
} from "../worker"

const NOW = new Date().toISOString()

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source-1",
    notebook_id: "notebook-1",
    user_id: "user-1",
    type: "text",
    title: "Testquelle",
    url: null,
    storage_path: null,
    content_text: "Text",
    status: "ready",
    error_message: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as Source
}

describe("processIngestionTick", () => {
  it("deletes the job when runIngestionJob resolves with status='ready'", async () => {
    const job: WorkerJob = { msgId: 1, sourceId: "source-1", readCt: 1 }
    const readySource = makeSource({ status: "ready" })
    const runIngestionJob = vi.fn().mockResolvedValue(readySource)
    const deleteJob = vi.fn().mockResolvedValue(undefined)
    const markSourceFailed = vi.fn()

    const results = await processIngestionTick([job], {
      runIngestionJob,
      deleteJob,
      markSourceFailed,
    })

    expect(runIngestionJob).toHaveBeenCalledWith({ sourceId: "source-1" })
    expect(deleteJob).toHaveBeenCalledWith(1)
    expect(results).toEqual([
      {
        msgId: 1,
        sourceId: "source-1",
        status: "ready",
        errorMessage: undefined,
        notebookId: "notebook-1",
      },
    ])
  })

  it("deletes the job when runIngestionJob resolves with status='error' (handled failure)", async () => {
    const job: WorkerJob = { msgId: 2, sourceId: "source-2", readCt: 1 }
    const erroredSource = makeSource({
      id: "source-2",
      status: "error",
      error_message: "PDF konnte nicht gelesen werden.",
    })
    const runIngestionJob = vi.fn().mockResolvedValue(erroredSource)
    const deleteJob = vi.fn().mockResolvedValue(undefined)
    const markSourceFailed = vi.fn()

    const results = await processIngestionTick([job], {
      runIngestionJob,
      deleteJob,
      markSourceFailed,
    })

    expect(deleteJob).toHaveBeenCalledWith(2)
    expect(results).toEqual([
      {
        msgId: 2,
        sourceId: "source-2",
        status: "error",
        errorMessage: "PDF konnte nicht gelesen werden.",
        notebookId: "notebook-1",
      },
    ])
  })

  it("does NOT delete the job when runIngestionJob throws (unhandled crash) — left for pgmq redelivery", async () => {
    const job: WorkerJob = { msgId: 3, sourceId: "source-3", readCt: 1 }
    const runIngestionJob = vi.fn().mockRejectedValue(new Error("db down"))
    const deleteJob = vi.fn()
    const markSourceFailed = vi.fn()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    const results = await processIngestionTick([job], {
      runIngestionJob,
      deleteJob,
      markSourceFailed,
    })

    expect(deleteJob).not.toHaveBeenCalled()
    expect(results).toEqual([
      { msgId: 3, sourceId: "source-3", status: "crashed", errorMessage: "db down" },
    ])
    consoleError.mockRestore()
  })

  it("isolates failures across a batch: one crashing job does not prevent the others from processing", async () => {
    const jobs: WorkerJob[] = [
      { msgId: 1, sourceId: "source-1", readCt: 1 },
      { msgId: 2, sourceId: "source-2", readCt: 1 },
      { msgId: 3, sourceId: "source-3", readCt: 1 },
    ]
    const runIngestionJob = vi
      .fn()
      .mockResolvedValueOnce(makeSource({ id: "source-1", status: "ready" }))
      .mockRejectedValueOnce(new Error("crash on job 2"))
      .mockResolvedValueOnce(
        makeSource({ id: "source-3", status: "error", error_message: "x" })
      )
    const deleteJob = vi.fn().mockResolvedValue(undefined)
    const markSourceFailed = vi.fn()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    const results = await processIngestionTick(jobs, {
      runIngestionJob,
      deleteJob,
      markSourceFailed,
    })

    expect(runIngestionJob).toHaveBeenCalledTimes(3)
    expect(deleteJob).toHaveBeenCalledTimes(2)
    expect(deleteJob).toHaveBeenCalledWith(1)
    expect(deleteJob).toHaveBeenCalledWith(3)
    expect(deleteJob).not.toHaveBeenCalledWith(2)
    expect(results.map((r) => r.status)).toEqual(["ready", "crashed", "error"])
    consoleError.mockRestore()
  })

  it("a delete-job failure after a successful run is logged but does not throw/block the tick", async () => {
    const job: WorkerJob = { msgId: 1, sourceId: "source-1", readCt: 1 }
    const runIngestionJob = vi.fn().mockResolvedValue(makeSource({ status: "ready" }))
    const deleteJob = vi.fn().mockRejectedValue(new Error("queue unavailable"))
    const markSourceFailed = vi.fn()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      processIngestionTick([job], { runIngestionJob, deleteJob, markSourceFailed })
    ).resolves.toEqual([
      {
        msgId: 1,
        sourceId: "source-1",
        status: "ready",
        errorMessage: undefined,
        notebookId: "notebook-1",
      },
    ])
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("empty tick: resolves with an empty result array, no calls made", async () => {
    const runIngestionJob = vi.fn()
    const deleteJob = vi.fn()
    const markSourceFailed = vi.fn()

    const results = await processIngestionTick([], {
      runIngestionJob,
      deleteJob,
      markSourceFailed,
    })

    expect(results).toEqual([])
    expect(runIngestionJob).not.toHaveBeenCalled()
    expect(deleteJob).not.toHaveBeenCalled()
  })

  // Eng-Review H2 — poison messages must not kill the tick.
  it("poison message (no/invalid source_id): deleted immediately, runIngestionJob never called for it", async () => {
    const poisonJob: PoisonWorkerJob = { msgId: 99, invalid: true }
    const runIngestionJob = vi.fn()
    const deleteJob = vi.fn().mockResolvedValue(undefined)
    const markSourceFailed = vi.fn()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    const results = await processIngestionTick([poisonJob], {
      runIngestionJob,
      deleteJob,
      markSourceFailed,
    })

    expect(runIngestionJob).not.toHaveBeenCalled()
    expect(deleteJob).toHaveBeenCalledWith(99)
    expect(results).toEqual([{ msgId: 99, sourceId: "", status: "invalid" }])
    consoleError.mockRestore()
  })

  it("poison message mixed with real jobs: the poison message is deleted, the other jobs are processed normally", async () => {
    const jobs: WorkerQueueItem[] = [
      { msgId: 1, sourceId: "source-1", readCt: 1 },
      { msgId: 2, invalid: true },
      { msgId: 3, sourceId: "source-3", readCt: 1 },
    ]
    const runIngestionJob = vi
      .fn()
      .mockResolvedValueOnce(makeSource({ id: "source-1", status: "ready" }))
      .mockResolvedValueOnce(makeSource({ id: "source-3", status: "ready" }))
    const deleteJob = vi.fn().mockResolvedValue(undefined)
    const markSourceFailed = vi.fn()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    const results = await processIngestionTick(jobs, {
      runIngestionJob,
      deleteJob,
      markSourceFailed,
    })

    expect(runIngestionJob).toHaveBeenCalledTimes(2)
    expect(runIngestionJob).toHaveBeenCalledWith({ sourceId: "source-1" })
    expect(runIngestionJob).toHaveBeenCalledWith({ sourceId: "source-3" })
    expect(deleteJob).toHaveBeenCalledTimes(3)
    expect(deleteJob).toHaveBeenCalledWith(1)
    expect(deleteJob).toHaveBeenCalledWith(2)
    expect(deleteJob).toHaveBeenCalledWith(3)
    expect(results.map((r) => r.status)).toEqual(["ready", "invalid", "ready"])
    consoleError.mockRestore()
  })

  it("a poison-message delete failure is logged but does not throw/block the tick", async () => {
    const poisonJob: PoisonWorkerJob = { msgId: 5, invalid: true }
    const runIngestionJob = vi.fn()
    const deleteJob = vi.fn().mockRejectedValue(new Error("queue unavailable"))
    const markSourceFailed = vi.fn()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      processIngestionTick([poisonJob], { runIngestionJob, deleteJob, markSourceFailed })
    ).resolves.toEqual([{ msgId: 5, sourceId: "", status: "invalid" }])
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  // Eng-Review M1 — SourceNotFoundError is terminal, not a crash.
  it("runIngestionJob throwing SourceNotFoundError: deleted immediately (terminal), not left for crash-redelivery", async () => {
    const job: WorkerJob = { msgId: 7, sourceId: "deleted-source", readCt: 1 }
    const runIngestionJob = vi.fn().mockRejectedValue(new SourceNotFoundError())
    const deleteJob = vi.fn().mockResolvedValue(undefined)
    const markSourceFailed = vi.fn()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    const results = await processIngestionTick([job], {
      runIngestionJob,
      deleteJob,
      markSourceFailed,
    })

    expect(deleteJob).toHaveBeenCalledWith(7)
    expect(results).toEqual([
      {
        msgId: 7,
        sourceId: "deleted-source",
        status: "notFound",
        errorMessage: expect.any(String),
      },
    ])
    consoleError.mockRestore()
  })

  it("a different (non-SourceNotFoundError) thrown error is still treated as a retryable crash", async () => {
    const job: WorkerJob = { msgId: 8, sourceId: "source-8", readCt: 1 }
    const runIngestionJob = vi.fn().mockRejectedValue(new Error("transient db error"))
    const deleteJob = vi.fn()
    const markSourceFailed = vi.fn()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    const results = await processIngestionTick([job], {
      runIngestionJob,
      deleteJob,
      markSourceFailed,
    })

    expect(deleteJob).not.toHaveBeenCalled()
    expect(results).toEqual([
      { msgId: 8, sourceId: "source-8", status: "crashed", errorMessage: "transient db error" },
    ])
    consoleError.mockRestore()
  })

  // read_ct dead-letter backstop — bounds an uncatchable crash-loop (OOM,
  // maxDuration kill) that would otherwise redeliver forever.
  describe("read_ct dead-letter", () => {
    it("dead-letters a job whose read_ct exceeds MAX_DELIVERY_ATTEMPTS: marks the source failed, deletes the job, never calls runIngestionJob", async () => {
      const job: WorkerJob = {
        msgId: 10,
        sourceId: "source-10",
        readCt: MAX_DELIVERY_ATTEMPTS + 1,
      }
      const runIngestionJob = vi.fn()
      const deleteJob = vi.fn().mockResolvedValue(undefined)
      // markSourceFailed returns the source's notebook_id (WorkerTickDeps
      // contract) so the dead-letter result can feed the summary debounce.
      const markSourceFailed = vi.fn().mockResolvedValue("nb-10")
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

      const results = await processIngestionTick([job], {
        runIngestionJob,
        deleteJob,
        markSourceFailed,
      })

      expect(runIngestionJob).not.toHaveBeenCalled()
      expect(markSourceFailed).toHaveBeenCalledWith("source-10", expect.any(String))
      expect(deleteJob).toHaveBeenCalledWith(10)
      expect(results).toEqual([
        {
          msgId: 10,
          sourceId: "source-10",
          status: "deadLettered",
          errorMessage: expect.any(String),
          notebookId: "nb-10",
        },
      ])
      consoleError.mockRestore()
    })

    it("a null notebook_id from markSourceFailed (source row gone) yields a result without notebookId", async () => {
      const job: WorkerJob = {
        msgId: 13,
        sourceId: "source-13",
        readCt: MAX_DELIVERY_ATTEMPTS + 1,
      }
      const runIngestionJob = vi.fn()
      const deleteJob = vi.fn().mockResolvedValue(undefined)
      const markSourceFailed = vi.fn().mockResolvedValue(null)
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

      const results = await processIngestionTick([job], {
        runIngestionJob,
        deleteJob,
        markSourceFailed,
      })

      expect(results[0].status).toBe("deadLettered")
      expect(results[0]).not.toHaveProperty("notebookId")
      consoleError.mockRestore()
    })

    it("does not dead-letter at exactly MAX_DELIVERY_ATTEMPTS — still a normal (retryable) crash", async () => {
      const job: WorkerJob = { msgId: 11, sourceId: "source-11", readCt: MAX_DELIVERY_ATTEMPTS }
      const runIngestionJob = vi.fn().mockRejectedValue(new Error("still failing"))
      const deleteJob = vi.fn()
      const markSourceFailed = vi.fn()
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

      const results = await processIngestionTick([job], {
        runIngestionJob,
        deleteJob,
        markSourceFailed,
      })

      expect(runIngestionJob).toHaveBeenCalledWith({ sourceId: "source-11" })
      expect(markSourceFailed).not.toHaveBeenCalled()
      expect(deleteJob).not.toHaveBeenCalled()
      expect(results).toEqual([
        { msgId: 11, sourceId: "source-11", status: "crashed", errorMessage: "still failing" },
      ])
      consoleError.mockRestore()
    })

    it("a markSourceFailed failure during dead-letter is logged, but the job is still deleted", async () => {
      const job: WorkerJob = {
        msgId: 12,
        sourceId: "source-12",
        readCt: MAX_DELIVERY_ATTEMPTS + 5,
      }
      const runIngestionJob = vi.fn()
      const deleteJob = vi.fn().mockResolvedValue(undefined)
      const markSourceFailed = vi.fn().mockRejectedValue(new Error("db down"))
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

      const results = await processIngestionTick([job], {
        runIngestionJob,
        deleteJob,
        markSourceFailed,
      })

      expect(deleteJob).toHaveBeenCalledWith(12)
      expect(results[0].status).toBe("deadLettered")
      // The failed mark means no notebook_id is known — the result must not
      // carry one (the debounce would query a notebook that was never
      // settled by this outcome).
      expect(results[0]).not.toHaveProperty("notebookId")
      expect(consoleError).toHaveBeenCalled()
      consoleError.mockRestore()
    })
  })
})
