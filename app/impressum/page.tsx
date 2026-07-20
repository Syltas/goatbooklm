import type { Metadata } from "next";
import Link from "next/link";

import { LogoLockup } from "@/components/brand/logo";

/**
 * Statisches, öffentliches Impressum.
 * Inhalt & Werte 1:1 aus `design_handoff_goatbooklm/Impressum.dc.html`
 * (maßgebliche Spezifikation) übernommen.
 */

export const metadata: Metadata = {
  title: "Impressum — GoatbookLM",
};

export default function ImpressumPage() {
  return (
    <div
      className="flex min-h-dvh flex-col text-[#23211e]"
      style={{ background: "#fdfdfc" }}
    >
      <header
        className="flex items-center justify-between px-8 py-3.5"
        style={{ borderBottom: "1px solid #eceae6" }}
      >
        <Link
          href="/"
          className="flex items-center text-[#23211e] no-underline"
          data-test="impressum-header-logo-link"
        >
          <LogoLockup markSize={30} />
        </Link>
        <Link
          href="/"
          className="text-[14px] font-semibold text-[#57534c] no-underline hover:text-[#23211e] hover:underline"
          data-test="impressum-back-link"
        >
          ← Zurück zur Startseite
        </Link>
      </header>

      <main className="mx-auto w-full max-w-[680px] flex-1 px-8 pt-16 pb-24">
        <h1 className="font-heading mb-10 text-[40px] leading-none font-bold tracking-[-0.015em]">
          Impressum
        </h1>

        <section className="mb-9">
          <h2 className="mb-3 text-lg font-bold">Angaben gemäß § 5 DDG</h2>
          <p className="m-0 text-base leading-[1.75] text-[#3c3934]">
            Andreas Köckeis
            <br />
            Hirschauer Weg 12
            <br />
            85462 Eittingermoos
            <br />
            Deutschland
          </p>
        </section>

        <section className="mb-9">
          <h2 className="mb-3 text-lg font-bold">Kontakt</h2>
          <p className="m-0 text-base leading-[1.75] text-[#3c3934]">
            E-Mail:{" "}
            <a
              href="mailto:contact@andreaskoeckeis.com"
              className="text-[#2563eb]"
              data-test="impressum-contact-email-link"
            >
              contact@andreaskoeckeis.com
            </a>
          </p>
        </section>

        <section className="mb-9">
          <h2 className="mb-3 text-lg font-bold">
            Verantwortlich für den Inhalt gemäß § 18 Abs. 2 MStV
          </h2>
          <p className="m-0 text-base leading-[1.75] text-[#3c3934]">
            Andreas Köckeis
            <br />
            Hirschauer Weg 12
            <br />
            85462 Eittingermoos
          </p>
        </section>

        <section className="mb-9">
          <h2 className="mb-3 text-lg font-bold">Haftung für Inhalte</h2>
          <p className="m-0 text-[15px] leading-[1.75] text-[#57534c]">
            Die Inhalte dieser Seiten wurden mit größter Sorgfalt erstellt.
            Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte
            kann jedoch keine Gewähr übernommen werden. Als Diensteanbieter
            bin ich gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten
            nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10
            DDG bin ich als Diensteanbieter jedoch nicht verpflichtet,
            übermittelte oder gespeicherte fremde Informationen zu
            überwachen.
          </p>
        </section>

        <section className="mb-9">
          <h2 className="mb-3 text-lg font-bold">Haftung für Links</h2>
          <p className="m-0 text-[15px] leading-[1.75] text-[#57534c]">
            Dieses Angebot enthält Links zu externen Websites Dritter, auf
            deren Inhalte kein Einfluss besteht. Für die Inhalte der
            verlinkten Seiten ist stets der jeweilige Anbieter oder
            Betreiber der Seiten verantwortlich. Die verlinkten Seiten
            wurden zum Zeitpunkt der Verlinkung auf mögliche
            Rechtsverstöße überprüft.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-bold">Urheberrecht</h2>
          <p className="m-0 text-[15px] leading-[1.75] text-[#57534c]">
            Die durch den Seitenbetreiber erstellten Inhalte und Werke auf
            diesen Seiten unterliegen dem deutschen Urheberrecht. Der
            Quellcode von GoatbookLM ist als Open-Source-Software unter der
            jeweils angegebenen Lizenz frei verfügbar.
          </p>
        </section>
      </main>

      <footer style={{ borderTop: "1px solid #eceae6", background: "#faf9f7" }}>
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-3 px-8 py-6">
          <span className="text-[13.5px] text-[#a8a29b]">
            © 2026 GoatbookLM
          </span>
          <nav className="flex items-center gap-5">
            <a
              href="https://github.com/Syltas/goatbooklm"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[14px] font-semibold text-[#57534c] no-underline hover:text-[#23211e] hover:underline"
              data-test="impressum-footer-github-link"
            >
              GitHub
            </a>
            <Link
              href="/impressum"
              className="text-[14px] font-semibold text-[#57534c] no-underline hover:text-[#23211e] hover:underline"
              data-test="impressum-footer-impressum-link"
            >
              Impressum
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
