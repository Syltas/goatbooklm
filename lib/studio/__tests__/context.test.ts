import { describe, expect, it } from "vitest"

import {
  buildSourcesBlock,
  splitLeadingH1,
  truncateFairly,
  TRUNCATION_MARKER,
} from "../context"

describe("truncateFairly", () => {
  it("lässt Text unter dem Budget unangetastet", () => {
    expect(truncateFairly("kurz", 100)).toBe("kurz")
  })

  it("kürzt 70/30 mit Marker und hält das Budget ein", () => {
    const text = "A".repeat(700) + "B".repeat(700)
    const budget = 200
    const result = truncateFairly(text, budget)
    expect(result.length).toBeLessThanOrEqual(budget)
    expect(result).toContain(TRUNCATION_MARKER)
    const [head, tail] = result.split(TRUNCATION_MARKER)
    // 70 % Anfang / 30 % Ende (auf das Netto-Budget nach Marker-Abzug)
    expect(head.length).toBeGreaterThan(tail.length)
    expect(head.startsWith("A")).toBe(true)
    expect(tail.endsWith("B")).toBe(true)
  })
})

describe("buildSourcesBlock", () => {
  const source = (id: string, text: string) => ({
    id,
    title: `Quelle ${id}`,
    contentText: text,
  })

  it("übernimmt Quellen unter dem Budget vollständig", () => {
    const block = buildSourcesBlock([source("1", "eins"), source("2", "zwei")], 1000)
    expect(block).toContain('<quelle nr="1" titel="Quelle 1">')
    expect(block).toContain("eins")
    expect(block).toContain("zwei")
    expect(block).not.toContain(TRUNCATION_MARKER)
  })

  it("verteilt das Budget fair pro Quelle bei Überschreitung", () => {
    const long = "X".repeat(500)
    const block = buildSourcesBlock([source("1", long), source("2", long)], 400)
    // 2 Quellen à 500 > 400 gesamt → je ~200 Budget, beide gekürzt
    const occurrences = block.split(TRUNCATION_MARKER).length - 1
    expect(occurrences).toBe(2)
  })
})

describe("splitLeadingH1", () => {
  it("extrahiert die H1 und strippt sie aus dem Body", () => {
    const { title, body } = splitLeadingH1("# Mein Titel\n\nErster Absatz.")
    expect(title).toBe("Mein Titel")
    expect(body).toBe("Erster Absatz.")
  })

  it("liefert null ohne führende H1 und lässt den Body unverändert", () => {
    const markdown = "Kein Titel hier.\n\n# Späterer Heading"
    const { title, body } = splitLeadingH1(markdown)
    expect(title).toBeNull()
    expect(body).toBe(markdown)
  })

  it("ignoriert eine leere H1", () => {
    const { title } = splitLeadingH1("#   \nText")
    expect(title).toBeNull()
  })

  it("verkraftet Windows-Zeilenenden und führenden Whitespace", () => {
    const { title, body } = splitLeadingH1("\n# Titel\r\nBody")
    expect(title).toBe("Titel")
    expect(body).toBe("Body")
  })
})
