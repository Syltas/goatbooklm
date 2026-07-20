import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/database.types"

import type { ContextSource } from "./context"
import type { ReportFormat } from "./schema"

export type StudioArtifact = Database["public"]["Tables"]["studio_artifacts"]["Row"]

/**
 * Backstop-Fenster (Spec "Leerer Zustand / Status / Retry"): eine
 * `generating`-Row, deren `updated_at` älter ist, gilt als abgestürzt
 * (Server-Crash, `after()` kam nie durch) — die UI zeigt sie als
 * fehlgeschlagen, die Route lässt sie per Retry zurücksetzen. Bewusst
 * `updated_at` (Trigger), nicht `created_at`: eine per Retry zurückgesetzte
 * Row wäre sonst sofort wieder "stale".
 */
export const STALE_GENERATING_MINUTES = 5

/**
 * Studio-Service — pure Logik über injizierten RLS-scoped Client
 * (service-builder-Pattern wie `lib/chat/service.ts`). Der Anthropic-Call
 * selbst lebt NICHT hier, sondern in der Streaming-Route — dieser Service
 * verantwortet ausschließlich den Row-Lifecycle + Quellen-Laden.
 */
export interface StudioServiceDeps {
  /** Request-scoped Supabase client (RLS applies) — nie der Admin-Client. */
  db: SupabaseClient<Database>
}

export function createStudioService(deps: StudioServiceDeps) {
  return new StudioService(deps)
}

class StudioService {
  private readonly client: SupabaseClient<Database>

  constructor(deps: StudioServiceDeps) {
    this.client = deps.db
  }

  /**
   * Owner-Check via RLS (Chat-Pattern `assertNotebookOwned`): fremde und
   * nicht existierende IDs lösen beide zu `null` auf → die Route antwortet
   * einheitlich 404, ohne zu verraten, welcher Fall vorlag.
   */
  async assertNotebookOwned(notebookId: string): Promise<{ id: string } | null> {
    const { data, error } = await this.client
      .from("notebooks")
      .select("id")
      .eq("id", notebookId)
      .maybeSingle()
    if (error) throw error
    return data
  }

  /**
   * v1-Quellen-Scope (Spec Premise 4): ALLE ready-Quellen des Notebooks mit
   * nicht-leerem `content_text`. Leere/`null`-Texte fallen raus — sie
   * hätten im Prompt nichts beizutragen und würden das "≥1 Quelle"-Gate
   * fälschlich passieren lassen.
   */
  async loadReadySources(notebookId: string): Promise<ContextSource[]> {
    const { data, error } = await this.client
      .from("sources")
      .select("id, title, content_text")
      .eq("notebook_id", notebookId)
      .eq("status", "ready")
      .order("created_at", { ascending: true })
    if (error) throw error
    return (data ?? [])
      .filter((row) => (row.content_text ?? "").trim().length > 0)
      .map((row) => ({
        id: row.id,
        title: row.title,
        contentText: row.content_text as string,
      }))
  }

  async createGeneratingArtifact(input: {
    notebookId: string
    userId: string
    format: ReportFormat
    provisionalTitle: string
    sourceIds: string[]
  }): Promise<StudioArtifact> {
    const { data, error } = await this.client
      .from("studio_artifacts")
      .insert({
        notebook_id: input.notebookId,
        user_id: input.userId,
        type: "report",
        format: input.format,
        title: input.provisionalTitle,
        status: "generating",
        source_ids: input.sourceIds,
      })
      .select()
      .single()
    if (error) throw error
    return data
  }

  async getOwnedArtifact(artifactId: string): Promise<StudioArtifact | null> {
    const { data, error } = await this.client
      .from("studio_artifacts")
      .select()
      .eq("id", artifactId)
      .maybeSingle()
    if (error) throw error
    return data
  }

  /**
   * Retry-Guard (Review-Fix R2-4): dieselbe Row wird nur zurückgesetzt,
   * wenn sie `failed` ist ODER als abgestürzt gilt (`generating` +
   * `updated_at` älter als das Stale-Fenster). Konditionales Update — trifft
   * es 0 Rows, läuft die Generierung noch (oder die Row gehört nicht zum
   * Notebook) → die Route antwortet 409, nichts wird geclobbert.
   * `sourceIds` werden vom Aufrufer frisch geladen (Spec: nicht der alte
   * Snapshot — inzwischen ingestete Quellen sollen rein).
   */
  async claimRetry(input: {
    artifactId: string
    notebookId: string
    sourceIds: string[]
    provisionalTitle: string
  }): Promise<StudioArtifact | null> {
    const staleCutoff = new Date(
      Date.now() - STALE_GENERATING_MINUTES * 60_000
    ).toISOString()
    const { data, error } = await this.client
      .from("studio_artifacts")
      .update({
        status: "generating",
        content: null,
        error_message: null,
        title: input.provisionalTitle,
        source_ids: input.sourceIds,
      })
      .eq("id", input.artifactId)
      .eq("notebook_id", input.notebookId)
      .eq("type", "report")
      .or(`status.eq.failed,and(status.eq.generating,updated_at.lt.${staleCutoff})`)
      .select()
      .maybeSingle()
    if (error) throw error
    return data
  }

  async finalizeReady(input: {
    artifactId: string
    title: string
    markdown: string
    truncated: boolean
  }): Promise<void> {
    const { error } = await this.client
      .from("studio_artifacts")
      .update({
        status: "ready",
        title: input.title,
        content: input.truncated
          ? { markdown: input.markdown, truncated: true }
          : { markdown: input.markdown },
        error_message: null,
      })
      .eq("id", input.artifactId)
    if (error) throw error
  }

  async finalizeFailed(input: {
    artifactId: string
    errorMessage: string
  }): Promise<void> {
    const { error } = await this.client
      .from("studio_artifacts")
      .update({ status: "failed", error_message: input.errorMessage })
      .eq("id", input.artifactId)
    if (error) throw error
  }

  async listArtifacts(notebookId: string): Promise<StudioArtifact[]> {
    const { data, error } = await this.client
      .from("studio_artifacts")
      .select()
      .eq("notebook_id", notebookId)
      .order("created_at", { ascending: false })
    if (error) throw error
    return data ?? []
  }

  /** 0 getroffene Rows (fremd/nicht existent — RLS) → `null`, Aufrufer mappt auf "nicht gefunden". */
  async renameArtifact(input: {
    artifactId: string
    title: string
  }): Promise<StudioArtifact | null> {
    const { data, error } = await this.client
      .from("studio_artifacts")
      .update({ title: input.title })
      .eq("id", input.artifactId)
      .select()
      .maybeSingle()
    if (error) throw error
    return data
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    const { error } = await this.client
      .from("studio_artifacts")
      .delete()
      .eq("id", artifactId)
    if (error) throw error
  }
}
