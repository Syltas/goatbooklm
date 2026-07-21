import type { QuizContent } from "./content-schema"

/**
 * Fisher-Yates-Shuffle: liefert eine neue, zufällig permutierte Kopie von
 * `items` — der Input bleibt unangetastet (reine Funktion).
 */
function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * Mischt je Frage die `options` und remappt `correct_index` auf die neue
 * Position der bisher korrekten Option (#9: das Modell emittiert
 * `correct_index` systematisch biased auf 0 — im Viewer war die richtige
 * Antwort dadurch praktisch immer Option A). Reine Funktion, kein In-Place-
 * Mutieren von `content`; die neue Position wird über Objekt-Identität der
 * bisher korrekten Option ermittelt, nicht über einen mitgeführten Index.
 */
export function shuffleQuizOptions(content: QuizContent): QuizContent {
  return {
    ...content,
    questions: content.questions.map((question) => {
      const correctOption = question.options[question.correct_index]
      const options = shuffled(question.options)
      return {
        ...question,
        options,
        correct_index: options.indexOf(correctOption),
      }
    }),
  }
}
