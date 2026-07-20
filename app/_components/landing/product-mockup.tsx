import { ArrowUp } from "lucide-react";

const SOURCES = [
  { title: "Interview-Transkripte.pdf", meta: "Bereit · 42 Chunks", active: true },
  { title: "Mobilitätsbericht (Web)", meta: "Bereit · 18 Chunks", active: false },
  { title: "Eigene Notizen", meta: "Bereit · 6 Chunks", active: false },
] as const;

/**
 * Rein dekoratives, statisches 2-Panel-Mockup — keine echten Controls,
 * daher bewusst ohne data-test/Interaktivität (siehe README "Interactions").
 */
export function ProductMockup() {
  return (
    <section className="mx-auto max-w-[1080px] px-8 pb-[88px]">
      <div className="overflow-x-auto rounded-[20px] border border-[#eceae6] bg-white shadow-[0_24px_60px_-30px_rgba(35,33,30,0.25)]">
        <div className="min-w-[640px]">
          <div className="flex items-center gap-1.5 border-b border-[#eceae6] bg-[#faf9f7] px-3.5 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#e2dfda]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#e2dfda]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#e2dfda]" />
            <span className="mx-auto rounded-md border border-[#eceae6] bg-white px-6 py-0.5 text-xs text-[#a8a29b]">
              goatbook.deine-domain.de
            </span>
            <span className="w-[38px]" />
          </div>
          <div className="flex min-h-[380px]">
            <div className="flex w-[230px] shrink-0 flex-col gap-2.5 border-r border-[#eceae6] p-3.5">
              <div className="flex h-8 items-center justify-center gap-1.5 rounded-full bg-[#23211e] text-[13px] font-bold text-[#fdfdfc]">
                + Quellen hinzufügen
              </div>
              <div className="flex flex-col gap-1">
                {SOURCES.map((source) => (
                  <div
                    key={source.title}
                    className={`rounded-[10px] px-2.5 py-2 ${source.active ? "bg-[#f0f4ff]" : ""}`}
                  >
                    <p className="m-0 text-[13px] font-bold text-[#23211e]">
                      {source.title}
                    </p>
                    <p className="m-0 mt-0.5 text-[11.5px] text-[#188038]">
                      {source.meta}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-3.5 px-[22px] py-[18px] text-left">
              <div className="max-w-[70%] self-end rounded-[14px] bg-[#f6f5f2] px-3.5 py-2 text-sm text-[#23211e]">
                Was sind die wichtigsten Erkenntnisse aus den Interviews?
              </div>
              <div className="max-w-[85%] text-sm leading-[1.7] text-[#23211e]">
                Die Interviews zeigen drei zentrale Erkenntnisse: Fehlende
                sichere Radinfrastruktur bremst den Umstieg{" "}
                <sup className="text-[11px] font-bold text-[#2563eb]">1</sup>,
                Pendler priorisieren die ÖPNV-Taktung vor dem Preis{" "}
                <sup className="text-[11px] font-bold text-[#2563eb]">2</sup>{" "}
                und multimodale Wege werden akzeptiert, wenn Umstiege planbar
                sind <sup className="text-[11px] font-bold text-[#2563eb]">3</sup>.
              </div>
              <div className="mt-auto flex items-center gap-2">
                <div className="flex h-10 flex-1 items-center rounded-[10px] border border-[#eceae6] px-3 text-[13px] text-[#a8a29b]">
                  Stellen Sie eine Frage zu Ihren Quellen…
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#23211e]">
                  <ArrowUp className="h-4 w-4 text-[#fdfdfc]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
