import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verification/prod builds must never clobber a running dev server's
  // `.next` (Investigate-Fix 2026-07-19: `pnpm build` while `next dev` was
  // serving corrupted the shared `.next` → every request answered
  // "Internal Server Error" with ENOENT build-manifest errors). The build
  // script sets NEXT_DIST_DIR=.next-build so dev and build use disjoint
  // output dirs; dev keeps the default `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: {
      // Default is 1MB — raised so a 500,000-character Text-source payload
      // (lib/ingestion/schema.ts AddTextSourceSchema, max 500_000 chars ~=
      // up to ~2MB of UTF-8 depending on content) safely clears the limit,
      // comfortably under Vercel's hard ~4.5MB platform ceiling for Server
      // Actions (specs/02-ingestion.md Annahme 14).
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
