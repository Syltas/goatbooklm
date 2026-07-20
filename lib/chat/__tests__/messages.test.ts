import { describe, expect, it } from "vitest"

import {
  FOLLOW_UP_TRAILER_MARKER,
  parseFollowUpQuestions,
  splitFollowUpTrailer,
} from "../messages"

describe("splitFollowUpTrailer", () => {
  it("splits content from the trailer when the marker is present mid-text", () => {
    const raw = `Das ist die Antwort.\n\n${FOLLOW_UP_TRAILER_MARKER}\n1. Erste Frage?\n2. Zweite Frage?`

    const { content, trailer } = splitFollowUpTrailer(raw, false)

    expect(content).toBe("Das ist die Antwort.")
    expect(trailer).toBe("\n1. Erste Frage?\n2. Zweite Frage?")
  })

  it("Befund 1: while streaming, holds back a trailing substring that is only a PREFIX of the marker", () => {
    const raw = `Text so far…\n\n<<<FOLG`

    const { content, trailer } = splitFollowUpTrailer(raw, true)

    // The partial marker prefix must never flash as raw text mid-stream.
    expect(content).toBe("Text so far…\n\n")
    expect(trailer).toBeNull()
  })

  it("Befund 1: NOT streaming (isStreaming=false) treats a marker-prefix-like ending as real content", () => {
    const raw = "Der Wert ist < 100"

    const { content, trailer } = splitFollowUpTrailer(raw, false)

    expect(content).toBe(raw)
    expect(trailer).toBeNull()
  })

  it("Befund 1 regression: a mid-stream abort inside the marker (isStreaming=true) must NOT persist the fragment as content", () => {
    // Simulates app/api/chat/route.ts's M3 rescue path: the model's stream
    // died with only "<<<FOLGEF" of the 17-char marker emitted so far.
    const raw = "Vollständiger Antworttext.\n\n<<<FOLGEF"

    const { content, trailer } = splitFollowUpTrailer(raw, true)

    expect(content).toBe("Vollständiger Antworttext.\n\n")
    expect(content).not.toContain("<<<")
    expect(trailer).toBeNull()
  })

  it("no marker anywhere: the whole text is content, trailer is null", () => {
    const raw = "Eine ganz normale, vollständige Antwort ohne Trailer."

    const { content, trailer } = splitFollowUpTrailer(raw, false)

    expect(content).toBe(raw)
    expect(trailer).toBeNull()
  })

  it("no marker anywhere while streaming: nothing is held back (no suffix overlaps the marker prefix)", () => {
    const raw = "Ein Satz, der einfach so endet."

    const { content, trailer } = splitFollowUpTrailer(raw, true)

    expect(content).toBe(raw)
    expect(trailer).toBeNull()
  })

  it("trims trailing whitespace off content before the marker", () => {
    const raw = `Antwort.   \n\n${FOLLOW_UP_TRAILER_MARKER}\n1. Frage?`

    const { content } = splitFollowUpTrailer(raw, false)

    expect(content).toBe("Antwort.")
  })
})

describe("parseFollowUpQuestions", () => {
  it("parses three numbered questions, stripping numbering styles", () => {
    const trailer = "1. Erste Frage?\n2) Zweite Frage?\n3. Dritte Frage, oder?"

    expect(parseFollowUpQuestions(trailer)).toEqual([
      "Erste Frage?",
      "Zweite Frage?",
      "Dritte Frage, oder?",
    ])
  })

  it("Befund 2: drops a leading intro line ('Hier sind drei Folgefragen:') instead of surfacing it as chip #1", () => {
    const trailer =
      "Hier sind drei mögliche Folgefragen:\n1. Wie wirkt sich das auf die Kosten aus?\n2. Welche Alternativen gibt es?"

    const result = parseFollowUpQuestions(trailer)

    expect(result).not.toContain("Hier sind drei mögliche Folgefragen:")
    expect(result).toEqual([
      "Wie wirkt sich das auf die Kosten aus?",
      "Welche Alternativen gibt es?",
    ])
  })

  it("Befund 2: drops duplicate lines (case-insensitive) instead of producing duplicate chips/React keys", () => {
    const trailer =
      "1. Welche Rolle spielt X dabei?\n2. welche rolle spielt x dabei?\n3. Was folgt daraus für Y?"

    const result = parseFollowUpQuestions(trailer)

    expect(result).toEqual(["Welche Rolle spielt X dabei?", "Was folgt daraus für Y?"])
  })

  it("Befund 2: a trailer that is ONLY an intro line with no real questions parses to the documented empty-chips fallback", () => {
    const trailer = "Hier sind einige Folgefragen:"

    expect(parseFollowUpQuestions(trailer)).toEqual([])
  })

  it("empty trailer returns []", () => {
    expect(parseFollowUpQuestions("")).toEqual([])
  })

  it("Befund 2: drops lines that are too short to be a real question ('Ja.', 'Mehr?')", () => {
    const trailer = "1. Ja.\n2. Mehr?\n3. Wie unterscheiden sich die beiden Ansätze im Detail?"

    expect(parseFollowUpQuestions(trailer)).toEqual([
      "Wie unterscheiden sich die beiden Ansätze im Detail?",
    ])
  })

  it("Befund 2: drops a single-word fragment even if it happens to end in punctuation", () => {
    const trailer = "1. Zusammenfassung.\n2. Was sind die wichtigsten Unterschiede zwischen A und B?"

    expect(parseFollowUpQuestions(trailer)).toEqual([
      "Was sind die wichtigsten Unterschiede zwischen A und B?",
    ])
  })

  it("caps at 3 even when more valid candidate lines are present", () => {
    const trailer = [
      "1. Erste valide Frage hier?",
      "2. Zweite valide Frage hier?",
      "3. Dritte valide Frage hier?",
      "4. Vierte valide Frage hier?",
    ].join("\n")

    expect(parseFollowUpQuestions(trailer)).toHaveLength(3)
  })

  it("ignores blank lines between numbered questions", () => {
    const trailer = "1. Erste Frage dazu?\n\n2. Zweite Frage dazu?\n\n3. Dritte Frage dazu?"

    expect(parseFollowUpQuestions(trailer)).toEqual([
      "Erste Frage dazu?",
      "Zweite Frage dazu?",
      "Dritte Frage dazu?",
    ])
  })
})
