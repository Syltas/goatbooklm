import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
