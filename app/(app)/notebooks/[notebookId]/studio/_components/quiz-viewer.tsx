"use client"

import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  MessageCircleQuestion,
  X,
} from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import type { QuizContent } from "@/lib/studio/content-schema"

interface QuizViewerProps {
  title: string
  questions: QuizContent["questions"]
  onBack: () => void
  menu?: ReactNode
  onExplain?: (prompt: string) => void
}

const OPTION_LETTERS = ["A", "B", "C", "D"] as const

function buildExplainPrompt(
  question: QuizContent["questions"][number],
  chosenIndex: number
): string {
  const correct = question.options[question.correct_index].text
  const chosen = question.options[chosenIndex].text
  if (chosenIndex === question.correct_index) {
    return (
      "Ich mache gerade ein Quiz zu meinen Quellen und hatte diese Frage: " +
      `„${question.question}“\n\n` +
      `Ich habe richtig geantwortet: „${correct}“.\n\n` +
      "Erkläre das Thema dahinter ausführlicher."
    )
  }
  return (
    "Ich mache gerade ein Quiz zu meinen Quellen und hatte diese Frage: " +
    `„${question.question}“\n\n` +
    `Meine Antwort war: „${chosen}“.\n` +
    `Diese Antwort war falsch. Die richtige Antwort ist: „${correct}“.\n\n` +
    "Hilf mir zu verstehen, warum meine Antwort falsch war."
  )
}

/**
 * Quiz-Viewer (Spec-Nachtrag Quiz, Screenshots 2026-07-20): Frage mit 4
 * Optionen, Hint-Toggle VOR der Antwort, nach der Antwort Feedback-Färbung
 * (richtig = grüne Pastell-Karte `--card-3`, falsch gewählt = rote
 * `--card-1`, Design-Token statt Ad-hoc-Farben) + Erklärung unter JEDER
 * Option, Explain-Bridge in den Chat. Antworten session-lokal, nicht
 * persistiert.
 */
export function QuizViewer({ title, questions, onBack, menu, onExplain }: QuizViewerProps) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [hintOpen, setHintOpen] = useState(false)

  const question = questions[index]
  const chosenIndex = answers[index]
  const answered = chosenIndex !== undefined

  function goTo(nextIndex: number) {
    setIndex(Math.min(Math.max(nextIndex, 0), questions.length - 1))
    setHintOpen(false)
  }

  function choose(optionIndex: number) {
    if (answered) return
    setAnswers((prev) => ({ ...prev, [index]: optionIndex }))
  }

  if (!question) return null

  return (
    <div className="flex h-full flex-col" data-test="quiz-viewer">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Zurück zum Studio"
          data-test="quiz-viewer-back"
        >
          <ArrowLeft />
        </Button>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          Studio <span aria-hidden="true">›</span> Quiz
        </p>
        {menu}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto w-full max-w-2xl">
          <h3
            className="mb-3 text-[17px] leading-snug font-semibold text-foreground"
            data-test="quiz-viewer-title"
          >
            {title}
          </h3>

          <p className="mb-1 text-xs text-muted-foreground" data-test="quiz-counter">
            {index + 1} / {questions.length}
          </p>
          <p className="mb-4 text-[15px] leading-relaxed font-medium text-foreground" data-test="quiz-question">
            {question.question}
          </p>

          <div className="space-y-2" data-test="quiz-options">
            {question.options.map((option, optionIndex) => {
              const isCorrect = optionIndex === question.correct_index
              const isChosen = optionIndex === chosenIndex
              const surface = !answered
                ? "bg-[var(--surface-2)] hover:bg-border/60"
                : isCorrect
                  ? "bg-[var(--card-3)]"
                  : isChosen
                    ? "bg-[var(--card-1)]"
                    : "bg-[var(--surface-2)] opacity-80"
              return (
                <button
                  key={optionIndex}
                  type="button"
                  onClick={() => choose(optionIndex)}
                  disabled={answered}
                  className={`w-full rounded-xl px-3.5 py-2.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default ${surface}`}
                  data-test={`quiz-option-${optionIndex}`}
                  data-correct={answered && isCorrect ? "" : undefined}
                  data-chosen={isChosen ? "" : undefined}
                >
                  <span className="flex gap-2 text-foreground">
                    <span className="font-medium">{OPTION_LETTERS[optionIndex]}.</span>
                    <span className="min-w-0 flex-1">{option.text}</span>
                  </span>
                  {answered && (
                    <span className="mt-1.5 block pl-6">
                      {isCorrect ? (
                        <span
                          className="flex items-center gap-1 text-xs font-medium text-[var(--ok)]"
                          data-test="quiz-feedback-correct"
                        >
                          <Check className="size-3.5" aria-hidden="true" />
                          {isChosen ? "Richtig!" : "Richtige Antwort"}
                        </span>
                      ) : isChosen ? (
                        <span
                          className="flex items-center gap-1 text-xs font-medium text-[var(--danger)]"
                          data-test="quiz-feedback-wrong"
                        >
                          <X className="size-3.5" aria-hidden="true" />
                          Nicht ganz
                        </span>
                      ) : null}
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {option.explanation}
                      </span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {!answered && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setHintOpen((value) => !value)}
                className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                aria-expanded={hintOpen}
                data-test="quiz-hint-toggle"
              >
                Hinweis
                {hintOpen ? (
                  <ChevronUp className="size-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                )}
              </button>
              {hintOpen && (
                <p
                  className="mt-2 flex items-start gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2.5 text-xs leading-relaxed text-foreground"
                  data-test="quiz-hint"
                >
                  <Lightbulb
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  {question.hint}
                </p>
              )}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-2">
            {answered && onExplain ? (
              <button
                type="button"
                onClick={() => onExplain(buildExplainPrompt(question, chosenIndex))}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                data-test="quiz-explain"
              >
                <MessageCircleQuestion className="size-3.5" aria-hidden="true" />
                Erklären
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => goTo(index - 1)}
                disabled={index === 0}
                data-test="quiz-prev"
              >
                Zurück
              </Button>
              <Button
                type="button"
                onClick={() => goTo(index + 1)}
                disabled={index === questions.length - 1}
                data-test="quiz-next"
              >
                Weiter
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
