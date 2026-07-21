/**
 * Zerlegt ein Audio-Skript in Text-to-Dialogue-Blöcke (docs/specs/
 * studio-audio.md, v3-Umbau): die Dialogue-API limitiert auf 2.000 Zeichen
 * GESAMT pro Request, also gruppieren wir aufeinanderfolgende Turns greedy
 * bis knapp darunter. Ein Block = ein API-Call = ein Storage-Segment.
 *
 * Pure + deterministisch — der Worker berechnet die Blöcke bei jedem
 * Resume aus dem persistierten Skript neu und muss exakt dieselbe
 * Zerlegung erhalten (Segment-Index = Block-Index).
 */

export interface DialogueTurn {
  speaker: 1 | 2
  text: string
}

/** 2.000er-API-Limit minus Marge (Audio-Tags zählen mit). */
export const DIALOGUE_BLOCK_MAX_CHARS = 1_800

/**
 * Ein Turn über dem Limit wird an Satzgrenzen in Folge-Turns desselben
 * Sprechers zerlegt; eine einzelne Über-Limit-"Satz"-Monstrosität notfalls
 * hart geschnitten.
 */
function explodeOversizedTurn(turn: DialogueTurn, maxChars: number): DialogueTurn[] {
  if (turn.text.length <= maxChars) return [turn]

  const sentences = turn.text.split(/(?<=[.!?…])\s+/)
  const parts: string[] = []
  let current = ""
  for (const sentence of sentences) {
    let chunk = sentence
    // Pathologischer Einzel-"Satz" über dem Limit → hart schneiden.
    while (chunk.length > maxChars) {
      if (current) {
        parts.push(current)
        current = ""
      }
      parts.push(chunk.slice(0, maxChars))
      chunk = chunk.slice(maxChars)
    }
    if (!current) {
      current = chunk
    } else if (current.length + 1 + chunk.length <= maxChars) {
      current = `${current} ${chunk}`
    } else {
      parts.push(current)
      current = chunk
    }
  }
  if (current) parts.push(current)

  return parts.map((text) => ({ speaker: turn.speaker, text }))
}

/** Gruppiert Turns in Blöcke von je maximal `maxChars` Gesamttext. */
export function buildDialogueBlocks(
  turns: DialogueTurn[],
  maxChars: number = DIALOGUE_BLOCK_MAX_CHARS
): DialogueTurn[][] {
  const normalized = turns
    .map((t) => ({ speaker: t.speaker, text: t.text.trim() }))
    .filter((t) => t.text.length > 0)
    .flatMap((t) => explodeOversizedTurn(t, maxChars))

  const blocks: DialogueTurn[][] = []
  let block: DialogueTurn[] = []
  let blockChars = 0
  for (const turn of normalized) {
    if (block.length > 0 && blockChars + turn.text.length > maxChars) {
      blocks.push(block)
      block = []
      blockChars = 0
    }
    block.push(turn)
    blockChars += turn.text.length
  }
  if (block.length > 0) blocks.push(block)

  return blocks
}
