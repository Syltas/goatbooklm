import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("ai", () => ({
  embedMany: vi.fn(),
}))

import { embedMany } from "ai"

import { batchForEmbedding, createEmbedChunks } from "../embed"

const mockedEmbedMany = vi.mocked(embedMany)

describe("createEmbedChunks", () => {
  beforeEach(() => {
    mockedEmbedMany.mockReset()
  })

  it("AC-24: a small input goes out as a single embedMany call with maxParallelCalls: 5", async () => {
    mockedEmbedMany.mockResolvedValue({
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    } as never)

    const fakeModel = { modelId: "fake-embedding-model" }
    const embedChunks = createEmbedChunks(fakeModel as never)

    const result = await embedChunks(["Chunk A", "Chunk B"])

    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ])
    expect(mockedEmbedMany).toHaveBeenCalledTimes(1)
    expect(mockedEmbedMany).toHaveBeenCalledWith({
      model: fakeModel,
      values: ["Chunk A", "Chunk B"],
      maxParallelCalls: 5,
    })
  })

  it("short-circuits to an empty array without calling embedMany", async () => {
    const embedChunks = createEmbedChunks({ modelId: "fake" } as never)

    const result = await embedChunks([])

    expect(result).toEqual([])
    expect(mockedEmbedMany).not.toHaveBeenCalled()
  })

  it("propagates an embedMany rejection (e.g. OpenAI rate limit) to the caller", async () => {
    mockedEmbedMany.mockRejectedValue(new Error("rate limited"))
    const embedChunks = createEmbedChunks({ modelId: "fake" } as never)

    await expect(embedChunks(["x"])).rejects.toThrow("rate limited")
  })

  it("regression: splits a >2048-chunk source across multiple embedMany calls and preserves order", async () => {
    // Root-cause fix: a large source must never go out as one oversized
    // request. Here the 2048-item cap forces the split (cheaper to exercise
    // than the 250k-token cap, same batching code path). Each fake embedding
    // encodes its chunk's index so we can assert concatenation order survives
    // the batch boundary.
    mockedEmbedMany.mockImplementation(
      async ({ values }: { values: string[] }) =>
        ({ embeddings: values.map((v) => [Number(v)]) }) as never
    )

    const embedChunks = createEmbedChunks({ modelId: "fake" } as never)
    const texts = Array.from({ length: 2049 }, (_, i) => String(i))

    const result = await embedChunks(texts)

    expect(mockedEmbedMany).toHaveBeenCalledTimes(2)
    expect((mockedEmbedMany.mock.calls[0][0] as { values: string[] }).values).toHaveLength(2048)
    expect((mockedEmbedMany.mock.calls[1][0] as { values: string[] }).values).toHaveLength(1)
    expect(result).toHaveLength(2049)
    expect(result[0]).toEqual([0])
    expect(result[2048]).toEqual([2048])
  })
})

describe("batchForEmbedding", () => {
  it("keeps a small list in a single batch", () => {
    expect(batchForEmbedding(["a", "b", "c"])).toEqual([["a", "b", "c"]])
  })

  it("returns no batches for an empty input", () => {
    expect(batchForEmbedding([])).toEqual([])
  })

  it("splits once the combined request-size budget is exceeded, without losing or reordering any text", () => {
    // Each text is ~300k chars (~75k request units via chars/4); a handful of
    // them must not fit in one request (240k-unit budget, 300k OpenAI limit).
    // Assert a split happened and the flattened batches equal the input.
    const big = "lorem ".repeat(50_000)
    const texts = Array.from({ length: 6 }, (_, i) => `${i} ${big}`)

    const batches = batchForEmbedding(texts)

    expect(batches.length).toBeGreaterThanOrEqual(2)
    expect(batches.flat()).toEqual(texts)
  })
})
