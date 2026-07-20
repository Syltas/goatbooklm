"use client"

import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { signOutAction } from "../actions"

/**
 * `signOutAction` used to let a failed sign-out escape as an uncaught
 * exception — ugly, but visible. Now that `enhanceAction` catches errors
 * centrally and returns `{ error }`, the old inline `<form action={...}>`
 * (which just `await`ed the result and threw it away) would swallow that
 * error completely: the user clicks "Abmelden", nothing happens, and they
 * stay signed in with zero feedback. This checks `"error" in result` (same
 * pattern as `delete-notebook-dialog.tsx`) and surfaces it as a toast
 * instead — the session is still valid on failure, so no optimistic
 * redirect or local "signed out" UI state is shown.
 *
 * The success path needs no branch here: `redirect("/login")` inside the
 * action throws Next's redirect signal before the handler ever returns, so
 * `await signOutAction(...)` navigates away instead of resolving — this
 * line is only ever reached on failure.
 */
export function SignOutButton() {
  const [pending, startTransition] = useTransition()

  function handleSignOut() {
    startTransition(async () => {
      const result = await signOutAction(undefined)
      if ("error" in result) {
        toast.error(result.error)
      }
    })
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleSignOut}
      disabled={pending}
      className="h-8 rounded-full border-border bg-card px-3.5 text-[13px] font-bold text-foreground hover:bg-muted"
      data-test="app-header-logout-button"
    >
      Abmelden
    </Button>
  )
}
