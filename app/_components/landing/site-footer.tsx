import Link from "next/link";

import { LogoMark } from "@/components/brand/logo";

const GITHUB_URL = "https://github.com/Syltas/goatbooklm";

export function SiteFooter() {
  return (
    <footer className="border-t border-[#eceae6] bg-[#faf9f7]">
      <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-4 px-8 py-8">
        <Link
          href="/"
          data-test="landing-footer-logo-link"
          className="flex items-center gap-2.5 text-[#23211e] no-underline hover:no-underline"
        >
          <LogoMark size={26} />
          <span className="font-heading text-base font-semibold">
            GoatbookLM
          </span>
          <span className="text-[13.5px] text-[#a8a29b]">© 2026</span>
        </Link>
        <nav className="flex items-center gap-5">
          <Link
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-test="landing-footer-github"
            className="text-sm font-semibold text-[#57534c] no-underline transition-colors hover:text-[#23211e] hover:no-underline"
          >
            GitHub
          </Link>
          <Link
            href="/login"
            data-test="landing-footer-login"
            className="text-sm font-semibold text-[#57534c] no-underline transition-colors hover:text-[#23211e] hover:no-underline"
          >
            Anmelden
          </Link>
          <Link
            href="/impressum"
            data-test="landing-footer-impressum"
            className="text-sm font-semibold text-[#57534c] no-underline transition-colors hover:text-[#23211e] hover:no-underline"
          >
            Impressum
          </Link>
        </nav>
      </div>
    </footer>
  );
}
