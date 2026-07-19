import { notFound } from "next/navigation"

import { createNotebookService } from "@/lib/notebooks/service"
import { createClient } from "@/lib/supabase/server"

import { NotebookDetailShell } from "./_components/notebook-detail-shell"

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

  return <NotebookDetailShell notebook={notebook} />
}
