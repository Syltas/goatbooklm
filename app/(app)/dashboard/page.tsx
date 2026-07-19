import { createClient } from "@/lib/supabase/server"

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-muted-foreground" data-test="dashboard-user-email">
        Signed in as {user?.email}
      </p>
      <div className="mt-8 rounded-xl border border-dashed p-8 text-center text-muted-foreground">
        Your notebooks will live here.
      </div>
    </div>
  )
}
