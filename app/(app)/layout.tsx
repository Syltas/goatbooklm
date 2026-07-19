import Link from "next/link"
import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/server"

import { signOutAction } from "./actions"

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Fail closed: no session, no access to anything under this layout.
  if (!user) {
    redirect("/login")
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link
          href="/dashboard"
          className="font-semibold tracking-tight"
          data-test="app-header-home-link"
        >
          GoatbookLM
        </Link>
        <div className="flex items-center gap-3">
          <span
            className="text-sm text-muted-foreground"
            data-test="app-header-user-email"
          >
            {user.email}
          </span>
          <form
            action={async () => {
              "use server"
              await signOutAction(undefined)
            }}
          >
            <Button
              type="submit"
              variant="outline"
              size="sm"
              data-test="app-header-logout-button"
            >
              Log out
            </Button>
          </form>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
