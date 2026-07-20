"use client"

import { ArrowLeft, ArrowRight, Check, MessageCircleQuestion, X } from "lucide-react"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import type { FlashcardsContent } from "@/lib/studio/content-schema"

interface FlashcardsViewerProps {
  title: string
  cards: FlashcardsContent["cards"]
  onBack: () => void
  menu?: ReactNode
  /** Explain-Bridge in den Chat (NotebookLM-Parität) — fehlt der Callback
   *  (z. B. kein Chat montiert), verschwindet der Button einfach. */
  onExplain?: (prompt: string) => void
}

function buildExplainPrompt(front: string, back: string): string {
  return (
    "Ich wiederhole gerade Karteikarten zu meinen Quellen und möchte eine davon besser verstehen.\n\n" +
    `Vorderseite: „${front}“\n` +
    `Rückseite: „${back}“\n\n` +
    "Erkläre dieses Thema ausführlicher."
  )
}

/**
 * Karteikarten-Viewer (Spec-Nachtrag Flash Cards, Screenshots 2026-07-20):
 * Flip-Karte (Klick oder Leertaste), ←/→ navigiert, ✗/✓ zählt
 * session-lokal falsch/richtig (nicht persistiert — bewusst, kein
 * Lernfortschritts-Feature in v1), Explain auf der Rückseite.
 */
export function FlashcardsViewer({
  title,
  cards,
  onBack,
  menu,
  onExplain,
}: FlashcardsViewerProps) {
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [rightCount, setRightCount] = useState(0)
  const [wrongCount, setWrongCount] = useState(0)

  const card = cards[index]
  const atStart = index === 0
  const atEnd = index === cards.length - 1

  function goTo(nextIndex: number) {
    setIndex(Math.min(Math.max(nextIndex, 0), cards.length - 1))
    setFlipped(false)
  }

  function markWrong() {
    setWrongCount((count) => count + 1)
    if (!atEnd) goTo(index + 1)
  }

  function markRight() {
    setRightCount((count) => count + 1)
    if (!atEnd) goTo(index + 1)
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Nicht in Eingabefelder oder offene Dialoge grätschen (Rename etc.).
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [role="dialog"], [role="menu"]')) return

      if (event.key === " ") {
        event.preventDefault()
        setFlipped((value) => !value)
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        setIndex((value) => Math.min(value + 1, cards.length - 1))
        setFlipped(false)
      } else if (event.key === "ArrowLeft") {
        event.preventDefault()
        setIndex((value) => Math.max(value - 1, 0))
        setFlipped(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [cards.length])

  if (!card) return null

  return (
    <div className="flex h-full flex-col" data-test="flashcards-viewer">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Zurück zum Studio"
          data-test="flashcards-viewer-back"
        >
          <ArrowLeft />
        </Button>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          Studio <span aria-hidden="true">›</span> Karteikarten
        </p>
        {menu}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
        <h3
          className="mb-1 text-[17px] leading-snug font-semibold text-foreground"
          data-test="flashcards-viewer-title"
        >
          {title}
        </h3>
        <p className="mb-4 hidden text-xs text-muted-foreground md:block">
          Leertaste zum Umdrehen, ←/→ zum Navigieren
        </p>

        <button
          type="button"
          onClick={() => setFlipped((value) => !value)}
          aria-label={flipped ? "Karte zurückdrehen" : "Antwort anzeigen"}
          className={`relative flex min-h-64 w-full flex-col rounded-3xl p-6 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
            flipped
              ? "border border-border bg-[var(--surface)]"
              : "bg-foreground text-background"
          }`}
          data-test="flashcard"
          data-flipped={flipped ? "" : undefined}
        >
          <span
            className={`text-xs ${flipped ? "text-muted-foreground" : "opacity-70"}`}
            data-test="flashcard-counter"
          >
            {index + 1} / {cards.length}
          </span>
          <span className="flex flex-1 items-center justify-center px-2 py-6 text-center text-base leading-relaxed">
            {flipped ? card.back : card.front}
          </span>
          {!flipped && (
            <span className="text-center text-xs opacity-70">Antwort anzeigen</span>
          )}
          {flipped && onExplain && (
            <span className="flex justify-center">
              {/* span statt verschachteltem button (invalid HTML) — die
                  Karte selbst ist der Flip-Button. */}
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation()
                  onExplain(buildExplainPrompt(card.front, card.back))
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.stopPropagation()
                    onExplain(buildExplainPrompt(card.front, card.back))
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40"
                data-test="flashcard-explain"
              >
                <MessageCircleQuestion className="size-3.5" aria-hidden="true" />
                Erklären
              </span>
            </span>
          )}
        </button>

        <div className="mt-4 flex items-center justify-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="rounded-full"
            onClick={() => goTo(index - 1)}
            disabled={atStart}
            aria-label="Vorherige Karte"
            data-test="flashcards-prev"
          >
            <ArrowLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-1.5 rounded-full text-[var(--danger)]"
            onClick={markWrong}
            aria-label="Als falsch markieren"
            data-test="flashcards-mark-wrong"
          >
            <X className="size-4" /> {wrongCount}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-1.5 rounded-full text-[var(--ok)]"
            onClick={markRight}
            aria-label="Als richtig markieren"
            data-test="flashcards-mark-right"
          >
            {rightCount} <Check className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="rounded-full"
            onClick={() => goTo(index + 1)}
            disabled={atEnd}
            aria-label="Nächste Karte"
            data-test="flashcards-next"
          >
            <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  )
}
