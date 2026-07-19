import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

/**
 * Scoped status-poll endpoint (specs/02-ingestion.md §4 Punkt 5, OV8) — the
 * Sources-Panel polls this every 2s while ≥1 source is non-final instead of
 * calling `router.refresh()`, which would re-render the *whole*
 * `[notebookId]/page.tsx` tree including a possibly-mid-stream `ChatPanel`
 * (Spec 03) and visibly interrupt it. Returns only the handful of fields
 * the panel needs to patch local state: id/status/error_message/updated_at
 * (client applies the AC-46 stale-guard itself, see
 * `lib/ingestion/source-status.ts`) + chunk count via one grouped query
 * (AC-43/F12 — no N+1 per-source count queries).
 *
 * Auth: request-scoped client + `getUser()`, same as every other read in
 * this app — RLS (`sources_owner`) already scopes the result to the caller's
 * own rows, so a foreign `notebookId` in the URL just yields an empty array,
 * not a 403 (consistent with `NotebookService.getById`'s "don't leak
 * existence" behavior elsewhere in this codebase).
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
    .from("sources")
    .select("id, status, error_message, updated_at, chunks(count)")
    .eq("notebook_id", notebookId)

  if (error) {
    console.error("[sources-status-route]", error)
    return NextResponse.json(
      { error: "Etwas ist schiefgelaufen." },
      { status: 500 }
    )
  }

  const rows = (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    errorMessage: row.error_message,
    updatedAt: row.updated_at,
    chunkCount: row.chunks?.[0]?.count ?? 0,
  }))

  return NextResponse.json(rows)
}
