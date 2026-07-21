import { describe, expect, it } from "vitest"

import { buildDialogueBlocks, DIALOGUE_BLOCK_MAX_CHARS } from "../dialogue-blocks"

describe("buildDialogueBlocks", () => {
  it("packt kurze Turns in einen einzigen Block", () => {
    const turns = [
      { speaker: 1 as const, text: "Hallo." },
      { speaker: 2 as const, text: "Mhm." },
      { speaker: 1 as const, text: "Weiter im Text." },
    ]
    expect(buildDialogueBlocks(turns)).toEqual([turns])
  })

  it("schneidet an der Zeichen-Grenze, ohne Turns zu zerreißen", () => {
    const turns = [
      { speaker: 1 as const, text: "a".repeat(1_000) },
      { speaker: 2 as const, text: "b".repeat(1_000) },
      { speaker: 1 as const, text: "c".repeat(500) },
    ]
    const blocks = buildDialogueBlocks(turns)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual([turns[0]])
    expect(blocks[1]).toEqual([turns[1], turns[2]])
    for (const block of blocks) {
      const chars = block.reduce((sum, t) => sum + t.text.length, 0)
      expect(chars).toBeLessThanOrEqual(DIALOGUE_BLOCK_MAX_CHARS)
    }
  })

  it("zerlegt einen Über-Limit-Turn an Satzgrenzen in Folge-Turns desselben Sprechers", () => {
    const sentence = `${"x".repeat(700)}.`
    const turns = [{ speaker: 2 as const, text: `${sentence} ${sentence} ${sentence}` }]
    const blocks = buildDialogueBlocks(turns)
    const flat = blocks.flat()
    expect(flat.length).toBeGreaterThan(1)
    expect(flat.every((t) => t.speaker === 2)).toBe(true)
    expect(flat.every((t) => t.text.length <= DIALOGUE_BLOCK_MAX_CHARS)).toBe(true)
    expect(flat.map((t) => t.text).join(" ")).toBe(`${sentence} ${sentence} ${sentence}`)
  })

  it("schneidet einen pathologischen Einzelsatz hart", () => {
    const turns = [{ speaker: 1 as const, text: "y".repeat(4_000) }]
    const flat = buildDialogueBlocks(turns).flat()
    expect(flat.every((t) => t.text.length <= DIALOGUE_BLOCK_MAX_CHARS)).toBe(true)
    expect(flat.map((t) => t.text).join("")).toBe("y".repeat(4_000))
  })

  it("verwirft leere Turns und liefert nie leere Blöcke", () => {
    const blocks = buildDialogueBlocks([
      { speaker: 1, text: "   " },
      { speaker: 2, text: "Echt jetzt?" },
      { speaker: 1, text: "" },
    ])
    expect(blocks).toEqual([[{ speaker: 2, text: "Echt jetzt?" }]])
    expect(buildDialogueBlocks([])).toEqual([])
  })
})
