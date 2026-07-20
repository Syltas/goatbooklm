import type { Element, Root } from "hast"
import { describe, expect, it } from "vitest"

import { rehypeCitations } from "../rehype-citations"

function text(value: string) {
  return { type: "text" as const, value }
}

function el(tagName: string, children: Element["children"]): Element {
  return { type: "element", tagName, properties: {}, children }
}

function root(children: Root["children"]): Root {
  return { type: "root", children }
}

function run(tree: Root, valid: number[] = [1, 2]) {
  rehypeCitations({ valid: new Set(valid) })(tree)
  return tree
}

/** Flattens a subtree back to the shape the assertions care about. */
function shape(node: Root | Element): unknown[] {
  return node.children.map((child) => {
    if (child.type === "text") return child.value
    if (child.type === "element" && child.tagName === "span" && child.children.length === 0) {
      return { cite: child.properties?.dataCitationN }
    }
    if (child.type === "element") return { [child.tagName]: shape(child) }
    return child
  })
}

describe("rehypeCitations", () => {
  it("replaces a marker with a placeholder span and keeps the surrounding text", () => {
    const tree = run(root([el("p", [text("Emma ist nicht die Entscheiderin [1].")])]))

    expect(shape(tree)).toEqual([
      { p: ["Emma ist nicht die Entscheiderin ", { cite: "1" }, "."] },
    ])
  })

  it("inserts chips inside block elements without flattening the structure", () => {
    const tree = run(
      root([
        el("h2", [text("Firmengröße [1]")]),
        el("ul", [
          el("li", [text("11–50 Mitarbeiter [2]")]),
          el("li", [el("strong", [text("Fett [1]")])]),
        ]),
      ])
    )

    // The whole point of running on hast: headings and list items survive as
    // elements, and the chip lands *inside* them rather than tearing the
    // block apart the way a raw-string split would.
    expect(shape(tree)).toEqual([
      { h2: ["Firmengröße ", { cite: "1" }] },
      {
        ul: [
          { li: ["11–50 Mitarbeiter ", { cite: "2" }] },
          { li: [{ strong: ["Fett ", { cite: "1" }] }] },
        ],
      },
    ])
  })

  it("leaves markers inside code and pre untouched", () => {
    const tree = run(
      root([
        el("pre", [el("code", [text("const a = arr[1]")])]),
        el("p", [el("code", [text("arr[2]")])]),
      ])
    )

    expect(shape(tree)).toEqual([
      { pre: [{ code: ["const a = arr[1]"] }] },
      { p: [{ code: ["arr[2]"] }] },
    ])
  })

  it("leaves a marker without a matching citation as literal text", () => {
    const tree = run(root([el("p", [text("Quelle [1] und [9].")])]), [1])

    expect(shape(tree)).toEqual([{ p: ["Quelle ", { cite: "1" }, " und [9]."] }])
  })

  it("handles adjacent markers and a marker at the very start", () => {
    const tree = run(root([el("p", [text("[1][2] Rest")])]))

    expect(shape(tree)).toEqual([{ p: [{ cite: "1" }, { cite: "2" }, " Rest"] }])
  })

  it("is a no-op when there are no citations at all", () => {
    const tree = run(root([el("p", [text("Kein Marker [1] hier.")])]), [])

    expect(shape(tree)).toEqual([{ p: ["Kein Marker [1] hier."] }])
  })
})
