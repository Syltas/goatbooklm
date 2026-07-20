import { createNotebookService } from "@/lib/notebooks/service"
import { createClient } from "@/lib/supabase/server"

import { AppHeader } from "../_components/app-header"
import { NotebookGrid } from "./_components/notebook-grid"

export default async function NotebooksPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const service = createNotebookService(supabase)
  const notebooks = await service.list(user?.id ?? "")

  return (
    <>
      <AppHeader />
      <NotebookGrid initialNotebooks={notebooks} />
    </>
  )
}
