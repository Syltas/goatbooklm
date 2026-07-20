import { FaqAccordion } from "@/app/_components/landing/faq-accordion";

export function FaqSection() {
  return (
    <section
      id="faq"
      className="mx-auto max-w-[720px] px-8 pb-[88px] scroll-mt-20"
    >
      <h2 className="m-0 mb-8 text-center font-heading text-[36px] font-bold tracking-[-0.01em] text-[#23211e]">
        Häufige Fragen
      </h2>
      <FaqAccordion />
    </section>
  );
}
