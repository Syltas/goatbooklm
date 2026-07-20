import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

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
    <div className="flex h-dvh flex-col">
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
