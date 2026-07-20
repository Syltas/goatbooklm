import Link from "next/link";

import { LogoLockup } from "@/components/brand/logo";

const NAV_LINKS = [
  { href: "#funktionen", label: "Funktionen", testId: "landing-nav-funktionen" },
  { href: "#so-gehts", label: "So geht's", testId: "landing-nav-so-gehts" },
  { href: "#faq", label: "FAQ", testId: "landing-nav-faq" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b border-[#eceae6] bg-[rgba(253,253,252,0.9)] px-8 py-3.5 backdrop-blur-[8px]">
      <Link
        href="/"
        data-test="landing-logo-link"
        className="flex items-center gap-2.5 text-[#23211e] no-underline hover:no-underline"
      >
        <LogoLockup markSize={34} />
      </Link>
      <nav className="flex items-center gap-6">
        <div className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              data-test={link.testId}
              className="text-[14.5px] font-semibold text-[#57534c] no-underline transition-colors hover:text-[#23211e] hover:no-underline"
            >
              {link.label}
            </a>
          ))}
        </div>
        <Link
          href="/signup"
          data-test="landing-header-cta"
          className="inline-flex h-[38px] items-center rounded-full bg-[#23211e] px-[18px] text-[14.5px] font-bold text-[#fdfdfc] no-underline transition-colors hover:bg-[#3c3934] hover:no-underline"
        >
          Jetzt starten
        </Link>
      </nav>
    </header>
  );
}
