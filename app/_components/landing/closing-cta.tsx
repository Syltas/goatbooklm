import Link from "next/link";

export function ClosingCta() {
  return (
    <section className="mx-auto max-w-[1080px] px-8 pb-24 text-center">
      <h2 className="m-0 mb-3 font-heading text-[40px] font-bold tracking-[-0.015em] text-[#23211e]">
        Bereit? Die Ziege wartet. 🐐
      </h2>
      <p className="m-0 mb-7 text-[17px] text-[#57534c]">
        Kostenlos, quelloffen und in wenigen Minuten aufgesetzt.
      </p>
      <Link
        href="/signup"
        data-test="landing-final-cta"
        className="inline-flex h-[52px] items-center rounded-full bg-[#23211e] px-8 text-[17px] font-bold text-[#fdfdfc] no-underline transition-colors hover:bg-[#3c3934] hover:no-underline"
      >
        Jetzt starten
      </Link>
    </section>
  );
}
