import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("ai", () => ({
  embed: vi.fn(),
}))

import { embed } from "ai"

import { embedQuery } from "../client"

const mockedEmbed = vi.mocked(embed)

describe("embedQuery", () => {
  beforeEach(() => {
    mockedEmbed.mockReset()
  })

  it("calls embed once with the injected model and text, returns the embedding vector", async () => {
    mockedEmbed.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] } as never)

    const fakeModel = { modelId: "fake-embedding-model" }
    const result = await embedQuery(fakeModel as never, "Was steht in den Quellen?")

    expect(result).toEqual([0.1, 0.2, 0.3])
    expect(mockedEmbed).toHaveBeenCalledTimes(1)
    expect(mockedEmbed).toHaveBeenCalledWith({
      model: fakeModel,
      value: "Was steht in den Quellen?",
    })
  })

  it("propagates an embed rejection (e.g. OpenAI rate limit) to the caller", async () => {
    mockedEmbed.mockRejectedValue(new Error("rate limited"))

    await expect(embedQuery({ modelId: "fake" } as never, "x")).rejects.toThrow(
      "rate limited"
    )
  })
})
