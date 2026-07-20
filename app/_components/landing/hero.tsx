import Link from "next/link";

export function Hero() {
  return (
    <section className="mx-auto max-w-[1080px] px-8 pt-[88px] pb-14 text-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-[#eceae6] bg-white px-3.5 py-1.5 text-[13px] font-bold text-[#57534c]">
        <span className="h-2 w-2 rounded-full bg-[#188038]" />
        Open Source — nutzen oder selbst hosten
      </div>
      <h1 className="mx-auto mt-6 max-w-[720px] text-balance font-heading text-[38px] leading-[1.08] font-bold tracking-[-0.02em] text-[#23211e] sm:text-[48px] md:text-[60px]">
        Frag einfach deine Dokumente.
      </h1>
      <p className="mx-auto mt-5 max-w-[560px] text-pretty text-[18px] leading-[1.65] text-[#57534c]">
        GoatbookLM ist dein offener Recherche-Assistent: PDFs, Texte und
        Webseiten hochladen, Fragen stellen — und Antworten bekommen, die
        jede Aussage mit deinen Quellen belegen.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Link
          href="/signup"
          data-test="landing-signup-link"
          className="inline-flex h-12 items-center rounded-full bg-[#23211e] px-[26px] text-base font-bold text-[#fdfdfc] no-underline transition-colors hover:bg-[#3c3934] hover:no-underline"
        >
          Kostenlos starten
        </Link>
        <Link
          href="/login"
          data-test="landing-login-link"
          className="inline-flex h-12 items-center rounded-full border border-[#e2dfda] bg-white px-[26px] text-base font-bold text-[#23211e] no-underline transition-colors hover:bg-[#f6f5f2] hover:no-underline"
        >
          Anmelden
        </Link>
      </div>
    </section>
  );
}
