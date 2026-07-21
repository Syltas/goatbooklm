#!/usr/bin/env node
// Applies an INGESTION_WORKER_URL override on top of the 3100 default that
// `supabase/seed.sql` already seeded (see that file's header comment for
// why the override can't just live inside seed.sql itself: `supabase db
// reset` sends it to Postgres as a plain SQL batch — no psql, no `env()`
// interpolation, no way for raw SQL to read an OS env var without an
// extension). Run this AFTER `supabase db reset`/`supabase start`, e.g.
// `pnpm db:reset` (see package.json) — a no-op if INGESTION_WORKER_URL isn't
// set, leaving seed.sql's 3100 default in place untouched.
//
// Deliberately reads only real `process.env` (not `.env.local`) — same as
// `supabase db reset` itself, which has no `.env.local` awareness either
// (see .env.example's comment on this var). Uses `supabase db query
// --local`, the same elevated local-Postgres access `supabase db reset`'s
// own seed step uses, since `ingestion_worker_config` intentionally has no
// grants for the app's normal (RLS-scoped or even service_role) clients —
// see that table's migration header comment. No new dependency: shells out
// to the `supabase` CLI already required for local dev, via Node's own
// `child_process`.

import { execFileSync } from "node:child_process"

// Merge studio-quick-wins: gleiche Mechanik für BEIDE Worker-Config-Tabellen
// (studio_worker_config kam mit docs/specs/studio-audio.md dazu).
const overrides = [
  { env: "INGESTION_WORKER_URL", table: "ingestion_worker_config" },
  { env: "STUDIO_WORKER_URL", table: "studio_worker_config" },
]

for (const { env, table } of overrides) {
  const url = process.env[env]
  if (!url) {
    // Nothing to do — seed.sql's own 3100 default already stands.
    continue
  }

  // Single-quote SQL string literal, with embedded single quotes doubled —
  // standard SQL escaping, not a template/ORM concern.
  const escaped = url.replace(/'/g, "''")

  execFileSync(
    "supabase",
    [
      "db",
      "query",
      "--local",
      `update public.${table} set url = '${escaped}' where id = true;`,
    ],
    { stdio: "inherit" }
  )
}
