import type { ReportFormat } from "./schema"

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
