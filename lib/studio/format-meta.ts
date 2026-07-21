import type { GeneratableType, ReportFormat } from "./schema"

/**
 * Client-safe UI-Metadaten der 3 Report-Formate (Dialog-Karten, Spec
 * "create-report-dialog"). Bewusst getrennt von `prompts.ts` (server-only)
 * — analog zur `lib/chat/messages.ts`-vs-`prompt.ts`-Trennung.
 */
export const REPORT_FORMAT_META: Record<
  ReportFormat,
  { label: string; description: string }
> = {
  briefing_doc: {
    label: "Briefing-Dokument",
    description: "Überblick über deine Quellen mit Kernerkenntnissen und Zitaten",
  },
  study_guide: {
    label: "Lernleitfaden",
    description: "Kurzfragen-Quiz, Essay-Fragen und Glossar der Schlüsselbegriffe",
  },
  blog_post: {
    label: "Blog-Post",
    description: "Die wichtigsten Erkenntnisse als gut lesbarer Artikel",
  },
}

/** Kachel-/Provisorik-Labels je generierbarem Artefakt-Typ (Studio-Panel). */
export const STUDIO_TYPE_META: Record<
  GeneratableType,
  { label: string; description: string }
> = {
  report: {
    label: "Bericht",
    description: "Text-Dokument aus deinen Quellen",
  },
  flashcards: {
    label: "Karteikarten",
    description: "Lernkarten zum Durchblättern",
  },
  quiz: {
    label: "Quiz",
    description: "Multiple-Choice mit Erklärungen",
  },
  audio: {
    label: "Audio",
    description: "Gesprochener Beitrag aus deinen Quellen",
  },
}
