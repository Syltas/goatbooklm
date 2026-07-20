const FEATURES = [
  {
    bg: "#e8eaf6",
    title: "Deine Quellen",
    body: "PDF, Text und Web in einem Notizbuch. Der Status jeder Quelle ist jederzeit sichtbar — inklusive Reader-Modus zum Nachlesen.",
  },
  {
    bg: "#e6f4ea",
    title: "Chat, der nichts erfindet",
    body: "Antworten sind streng an deine Quellen gebunden. Ohne Beleg gibt es eine ehrliche Kennzeichnung statt Halluzination.",
  },
  {
    bg: "#fef7e0",
    title: "Zitate zum Anklicken",
    body: "Jede Zahl im Text ist ein Sprung zur Original-Passage — markiert und hervorgehoben, damit du sofort prüfen kannst.",
  },
] as const;

export function Features() {
  return (
    <section
      id="funktionen"
      className="mx-auto max-w-[1080px] px-8 pb-[88px] scroll-mt-20"
    >
      <h2 className="m-0 mb-10 text-center font-heading text-[36px] font-bold tracking-[-0.01em] text-[#23211e]">
        Alles drin, nichts drumherum
      </h2>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="rounded-[18px] p-7"
            style={{ background: feature.bg }}
          >
            <h3 className="m-0 mb-2 text-[19px] font-bold text-[#23211e]">
              {feature.title}
            </h3>
            <p className="m-0 text-[15px] leading-[1.65] text-[rgba(35,33,30,0.75)]">
              {feature.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
