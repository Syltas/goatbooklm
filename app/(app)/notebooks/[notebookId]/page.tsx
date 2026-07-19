import { notFound } from "next/navigation"

import { createNotebookService } from "@/lib/notebooks/service"
import { createClient } from "@/lib/supabase/server"

import { NotebookDetailShell } from "./_components/notebook-detail-shell"
import type { SourceWithChunkCount } from "./sources/types"

export default async function NotebookDetailPage({
  params,
}: {
  params: Promise<{ notebookId: string }>
}) {
  const { notebookId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const service = createNotebookService(supabase)
  const notebook = await service.getById(notebookId, user?.id ?? "")

  if (!notebook) {
    notFound()
  }

  // One grouped query for every source + its chunk count (AC-43/F12) — no
  // N+1 per-source count query.
  const { data: sourcesData, error: sourcesError } = await supabase
    .from("sources")
    .select("*, chunks(count)")
    .eq("notebook_id", notebookId)
    .order("created_at", { ascending: true })

  if (sourcesError) throw sourcesError

  return (
    <NotebookDetailShell
      notebook={notebook}
      initialSources={(sourcesData ?? []) as SourceWithChunkCount[]}
    />
  )
}
