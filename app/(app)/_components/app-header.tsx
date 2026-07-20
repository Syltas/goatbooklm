import Link from "next/link"

import { LogoLockup, LogoMark } from "@/components/brand/logo"
import { createClient } from "@/lib/supabase/server"

import { SignOutButton } from "./sign-out-button"

/**
 * Single ~56px app chrome bar shared by every screen under `app/(app)`.
 * Listing (no `title`): full LogoLockup, same as before. Detail (`title`
 * set): LogoMark only (as the back-to-listing link) + the notebook title,
 * replacing what used to be a second title row stacked below a full-width
 * header (Fix 1, design_handoff_goatbooklm/Notebook Detail v2.dc.html).
 */
export async function AppHeader({ title }: { title?: string }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <header className="flex shrink-0 items-center justify-between gap-4 px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {title ? (
          <>
            <Link
              href="/notebooks"
              className="inline-flex shrink-0 items-center text-foreground"
              data-test="app-header-home-link"
            >
              <LogoMark size={30} />
            </Link>
            <h1 className="truncate text-[17px] font-bold tracking-[-0.005em] text-foreground">
              {title}
            </h1>
          </>
        ) : (
          <Link
            href="/notebooks"
            className="inline-flex items-center text-foreground"
            data-test="app-header-home-link"
          >
            <LogoLockup markSize={30} />
          </Link>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <span
          className="hidden max-w-[220px] truncate text-[13.5px] text-muted-foreground sm:inline-block"
          data-test="app-header-user-email"
        >
          {user?.email}
        </span>
        <SignOutButton />
      </div>
    </header>
  )
}
