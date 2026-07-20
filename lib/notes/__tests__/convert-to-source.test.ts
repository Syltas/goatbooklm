import type { JSONContent } from "@tiptap/react"
import { describe, expect, it } from "vitest"

import { EMPTY_NOTE_CONTENT } from "../serialize"
import {
  EmptyNoteError,
  isNoteContentEmpty,
  NOTE_SOURCE_MAX_CHARS,
  NoteTooLongForSourceError,
  prepareNoteSourceText,
} from "../convert-to-source"

describe("prepareNoteSourceText", () => {
  it("erfolgreiche Umwandlung: returns the note's rendered plaintext", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Überschrift" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Fett", marks: [{ type: "bold" }] },
                    { type: "text", text: " markierter Listenpunkt" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }

    expect(prepareNoteSourceText(doc)).toBe("Überschrift\n\n- Fett markierter Listenpunkt")
  })

  it("leere Notiz blockiert: the DB default ('{}') throws EmptyNoteError", () => {
    expect(() => prepareNoteSourceText({})).toThrow(EmptyNoteError)
  })

  it("leere Notiz blockiert: a fresh doc with one empty paragraph throws EmptyNoteError", () => {
    expect(() => prepareNoteSourceText(EMPTY_NOTE_CONTENT)).toThrow(EmptyNoteError)
  })

  it("leere Notiz blockiert: whitespace-only content throws EmptyNoteError", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "   " }] }],
    }
    expect(() => prepareNoteSourceText(doc)).toThrow(EmptyNoteError)
  })

  it("Text über dem Limit blockiert: content longer than NOTE_SOURCE_MAX_CHARS throws NoteTooLongForSourceError", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "a".repeat(NOTE_SOURCE_MAX_CHARS + 1) }],
        },
      ],
    }
    expect(() => prepareNoteSourceText(doc)).toThrow(NoteTooLongForSourceError)
  })

  it("Text über dem Limit blockiert: content exactly at the cap is still accepted", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "a".repeat(NOTE_SOURCE_MAX_CHARS) }],
        },
      ],
    }
    expect(prepareNoteSourceText(doc)).toHaveLength(NOTE_SOURCE_MAX_CHARS)
  })
})

describe("isNoteContentEmpty", () => {
  it("matches prepareNoteSourceText's emptiness check without throwing", () => {
    expect(isNoteContentEmpty({})).toBe(true)
    expect(isNoteContentEmpty(EMPTY_NOTE_CONTENT)).toBe(true)

    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hallo" }] }],
    }
    expect(isNoteContentEmpty(doc)).toBe(false)
  })
})
