"use server"

import { redirect } from "next/navigation"

import { createAuthService } from "@/lib/auth/service"
import { enhanceAction } from "@/lib/server/action"
import { createClient } from "@/lib/supabase/server"

// Default auth gate (`auth: true`) applies here — this action is only ever
// rendered from inside `app/(app)/layout.tsx`, which already guarantees an
// authenticated user before the logout form exists at all.
export const signOutAction = enhanceAction(async () => {
  const client = await createClient()
  const service = createAuthService(client)

  await service.signOut()

  redirect("/login")
})
