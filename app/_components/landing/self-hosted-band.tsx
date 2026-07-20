import Link from "next/link";
import { Check } from "lucide-react";

const GITHUB_URL = "https://github.com/Syltas/goatbooklm";

const BULLETS = [
  "Sofort starten — Konto anlegen, fertig",
  "Quelloffener Code, MIT-Lizenz",
  "Optional self-hosted auf deinem Server",
  "Keine Tracker, keine Werbung",
];

export function SelfHostedBand() {
  return (
    <section className="mx-auto max-w-[1080px] px-8 pb-[88px]">
      <div className="grid grid-cols-1 items-center gap-12 rounded-[24px] bg-[#23211e] p-14 text-[#fdfdfc] md:grid-cols-[1.2fr_1fr]">
        <div>
          <h2 className="m-0 mb-4 font-heading text-[34px] leading-[1.15] font-bold tracking-[-0.01em]">
            Einfach loslegen — oder selbst hosten.
          </h2>
          <p className="m-0 mb-6 text-base leading-[1.7] text-[rgba(253,253,252,0.72)]">
            Registriere dich und leg direkt los. Und weil GoatbookLM Open
            Source ist, kannst du es jederzeit auch komplett auf deiner
            eigenen Infrastruktur betreiben — du entscheidest, wo deine
            Dokumente liegen.
          </p>
          <Link
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-test="landing-github-cta"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-[#fdfdfc] px-[22px] text-[15px] font-bold text-[#23211e] no-underline transition-colors hover:bg-[#eceae6] hover:no-underline"
          >
            Auf GitHub ansehen
          </Link>
        </div>
        <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
          {BULLETS.map((bullet) => (
            <li
              key={bullet}
              className="flex items-center gap-3 text-[15.5px] font-semibold"
            >
              <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[rgba(253,253,252,0.12)]">
                <Check className="h-[13px] w-[13px]" />
              </span>
              {bullet}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
