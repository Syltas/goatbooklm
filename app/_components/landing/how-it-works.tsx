const STEPS = [
  {
    number: 1,
    badgeBg: "#e8eaf6",
    title: "Quellen hinzufügen",
    body: "PDFs hochladen, Text einfügen oder eine URL angeben — dein Notizbuch verarbeitet alles automatisch.",
  },
  {
    number: 2,
    badgeBg: "#e6f4ea",
    title: "Fragen stellen",
    body: "Chatte ganz normal — GoatbookLM antwortet ausschließlich auf Basis deiner eigenen Quellen.",
  },
  {
    number: 3,
    badgeBg: "#fef7e0",
    title: "Belege prüfen",
    body: null,
  },
] as const;

export function HowItWorks() {
  return (
    <section
      id="so-gehts"
      className="mx-auto max-w-[1080px] px-8 pb-[88px] scroll-mt-20"
    >
      <h2 className="m-0 mb-10 text-center font-heading text-[36px] font-bold tracking-[-0.01em] text-[#23211e]">
        In drei Schritten zur belegten Antwort
      </h2>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {STEPS.map((step) => (
          <div
            key={step.number}
            className="rounded-[18px] border border-[#eceae6] bg-white p-[26px]"
          >
            <span
              className="inline-flex h-10 w-10 items-center justify-center rounded-full font-heading text-lg font-bold text-[#23211e]"
              style={{ background: step.badgeBg }}
            >
              {step.number}
            </span>
            <h3 className="mt-4 mb-2 text-[19px] font-bold text-[#23211e]">
              {step.title}
            </h3>
            <p className="m-0 text-[15px] leading-[1.65] text-[#57534c]">
              {step.number === 3 ? (
                <>
                  Jede Aussage trägt ein Zitat{" "}
                  <sup className="text-[12px] font-bold text-[#2563eb]">1</sup>{" "}
                  — ein Klick springt direkt an die Stelle in der Quelle.
                </>
              ) : (
                step.body
              )}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
