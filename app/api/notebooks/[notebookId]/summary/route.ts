import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

/**
 * Scoped poll endpoint for the empty-chat notebook summary (Part A) —
 * mirrors `app/api/notebooks/[notebookId]/sources/status/route.ts`'s own
 * reasoning almost exactly: the summary is generated in the ingestion
 * worker, asynchronously, some time after the LAST source reaches `ready`
 * (a real Claude call on top of the 15s cron tick). The client has no other
 * way to learn it exists — `notebooks.summary`/`summary_stale` aren't part
 * of the sources-status payload and there is no other live channel — so
 * `use-notebook-summary-polling.ts` hits this small endpoint on an
 * interval instead of calling `router.refresh()` repeatedly, which would
 * re-render the *whole* `[notebookId]/page.tsx` tree (including a possibly
 * mid-stream `ChatPanel`) on every tick.
 *
 * Auth: request-scoped client + `getUser()`, same as every other read in
 * this app — RLS (`notebooks_owner`) already scopes the result to the
 * caller's own row, so a foreign `notebookId` in the URL just yields
 * `data: null` (not a 403), consistent with `NotebookService.getById`'s
 * "don't leak existence" behavior elsewhere in this codebase.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ notebookId: string }> }
) {
  const { notebookId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data, error } = await supabase
    .from("notebooks")
    .select("summary, summary_stale")
    .eq("id", notebookId)
    .maybeSingle()

  if (error) {
    console.error("[notebook-summary-status-route]", error)
    return NextResponse.json({ error: "Etwas ist schiefgelaufen." }, { status: 500 })
  }

  return NextResponse.json({
    summary: data?.summary ?? null,
    summaryStale: data?.summary_stale ?? true,
  })
}
