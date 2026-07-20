import type { JSONContent } from "@tiptap/react"
import { describe, expect, it } from "vitest"

import {
  EMPTY_NOTE_CONTENT,
  noteContentToPlainText,
  plainTextToNoteContent,
  toEditorContent,
} from "../serialize"

describe("noteContentToPlainText", () => {
  it("empty note: the DB default ('{}') becomes an empty string", () => {
    expect(noteContentToPlainText({})).toBe("")
  })

  it("empty note: a doc with a single empty paragraph also becomes an empty string", () => {
    expect(noteContentToPlainText(EMPTY_NOTE_CONTENT)).toBe("")
  })

  it("empty note: null/garbage input never throws", () => {
    expect(noteContentToPlainText(null)).toBe("")
    expect(noteContentToPlainText(undefined)).toBe("")
    expect(noteContentToPlainText("not a doc")).toBe("")
    expect(noteContentToPlainText(42)).toBe("")
  })

  it("nested lists: indents child items one level and keeps numbering per list", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Parent 1" }] },
                {
                  type: "orderedList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "Child 1" }],
                        },
                      ],
                    },
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "Child 2" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Parent 2" }] },
              ],
            },
          ],
        },
      ],
    }

    expect(noteContentToPlainText(doc)).toBe(
      "- Parent 1\n  1. Child 1\n  2. Child 2\n- Parent 2"
    )
  })

  it("codeblock: preserves internal newlines verbatim, as its own block", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "See below:" }] },
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const x = 1\nconsole.log(x)" }],
        },
      ],
    }

    expect(noteContentToPlainText(doc)).toBe(
      "See below:\n\nconst x = 1\nconsole.log(x)"
    )
  })

  it("link: appends the href in parentheses next to the visible text", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Read the " },
            {
              type: "text",
              text: "docs",
              marks: [{ type: "link", attrs: { href: "https://example.com/docs" } }],
            },
          ],
        },
      ],
    }

    expect(noteContentToPlainText(doc)).toBe("Read the docs (https://example.com/docs)")
  })

  it("link: an autolinked bare URL is not duplicated", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "https://example.com",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    }

    expect(noteContentToPlainText(doc)).toBe("https://example.com")
  })
})

describe("plainTextToNoteContent", () => {
  it("empty note: an empty string becomes the same shape editor.getJSON() produces for a blank doc", () => {
    expect(plainTextToNoteContent("")).toEqual(EMPTY_NOTE_CONTENT)
    expect(plainTextToNoteContent("   \n\n  ")).toEqual(EMPTY_NOTE_CONTENT)
  })

  it("nested lists (plaintext has none): a multi-line list-like text becomes one paragraph per blank-separated chunk, lines joined by hard breaks — not reconstructed list nodes", () => {
    const text = "- Parent 1\n  - Child 1\n- Parent 2"
    expect(plainTextToNoteContent(text)).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "- Parent 1" },
            { type: "hardBreak" },
            { type: "text", text: "  - Child 1" },
            { type: "hardBreak" },
            { type: "text", text: "- Parent 2" },
          ],
        },
      ],
    })
  })

  it("codeblock (plaintext has none): code-shaped text stays literal text with hard breaks, no codeBlock node", () => {
    const text = "const x = 1\nconsole.log(x)"
    expect(plainTextToNoteContent(text)).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "const x = 1" },
            { type: "hardBreak" },
            { type: "text", text: "console.log(x)" },
          ],
        },
      ],
    })
  })

  it("link (plaintext has none): a URL stays literal text, no link mark is reconstructed", () => {
    expect(plainTextToNoteContent("See https://example.com for details")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "See https://example.com for details" }],
        },
      ],
    })
  })

  it("multiple paragraphs: blank lines split into separate paragraph nodes", () => {
    expect(plainTextToNoteContent("Erster Absatz.\n\nZweiter Absatz.")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Erster Absatz." }] },
        { type: "paragraph", content: [{ type: "text", text: "Zweiter Absatz." }] },
      ],
    })
  })

  it("collapses runs of 2+ blank lines into a single paragraph break", () => {
    expect(plainTextToNoteContent("A\n\n\n\nB")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A" }] },
        { type: "paragraph", content: [{ type: "text", text: "B" }] },
      ],
    })
  })
})

describe("toEditorContent", () => {
  it("falls back to EMPTY_NOTE_CONTENT for the DB default and other non-doc values", () => {
    expect(toEditorContent({})).toEqual(EMPTY_NOTE_CONTENT)
    expect(toEditorContent(null)).toEqual(EMPTY_NOTE_CONTENT)
    expect(toEditorContent(undefined)).toEqual(EMPTY_NOTE_CONTENT)
    expect(toEditorContent({ type: "doc", content: [] })).toEqual(EMPTY_NOTE_CONTENT)
  })

  it("passes a real document through unchanged", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hallo" }] }],
    }
    expect(toEditorContent(doc)).toEqual(doc)
  })
})

describe("round-trip via plaintext (lossy by design, but stable for the empty case)", () => {
  it("empty content survives a full round trip", () => {
    const asText = noteContentToPlainText(EMPTY_NOTE_CONTENT)
    expect(plainTextToNoteContent(asText)).toEqual(EMPTY_NOTE_CONTENT)
  })
})
