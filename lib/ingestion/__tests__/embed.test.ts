import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("ai", () => ({
  embedMany: vi.fn(),
}))

import { embedMany } from "ai"

import { createEmbedChunks } from "../embed"

const mockedEmbedMany = vi.mocked(embedMany)

describe("createEmbedChunks", () => {
  beforeEach(() => {
    mockedEmbedMany.mockReset()
  })

  it("AC-24: calls embedMany once with all values and maxParallelCalls: 5 (no manual batching)", async () => {
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
})
