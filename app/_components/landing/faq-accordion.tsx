"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

type Faq = { q: string; a: string };

const FAQS: Faq[] = [
  {
    q: "Was kostet GoatbookLM?",
    a: "Die Nutzung ist kostenlos — einfach registrieren und loslegen. Wer möchte, kann GoatbookLM als Open-Source-Software auch selbst hosten und zahlt dann nur die eigene Infrastruktur.",
  },
  {
    q: "Wo liegen meine Dokumente?",
    a: "In der gehosteten Version sicher in unserer Datenbank — ohne Tracker und ohne Weitergabe an Dritte. Beim Self-Hosting liegen sie komplett auf deinem eigenen Server.",
  },
  {
    q: "Welche Quellen kann ich hinzufügen?",
    a: "PDFs, eingefügten Text und Webseiten per URL. Alle Quellen werden automatisch verarbeitet und stehen danach im Chat und Reader-Modus zur Verfügung.",
  },
  {
    q: "Erfindet die KI Antworten?",
    a: "Antworten sind streng an deine Quellen gebunden. Aussagen ohne Beleg werden sichtbar als „Nicht quellenbelegt“ markiert — statt still zu halluzinieren.",
  },
  {
    q: "Warum eine Ziege?",
    a: "GOAT — Greatest Of All Time. Außerdem frisst eine Ziege bekanntlich alles: PDFs, Texte, Webseiten.",
  },
];

export function FaqAccordion() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <div className="flex flex-col gap-2.5">
      {FAQS.map((faq, index) => {
        const isOpen = openIndex === index;
        return (
          <div
            key={faq.q}
            className="overflow-hidden rounded-[14px] border border-[#eceae6] bg-white"
          >
            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? -1 : index)}
              aria-expanded={isOpen}
              data-test={`landing-faq-toggle-${index}`}
              className="flex w-full cursor-pointer items-center justify-between gap-4 bg-transparent px-5 py-4 text-left text-base font-bold text-[#23211e]"
            >
              {faq.q}
              <ChevronDown
                className={`h-[18px] w-[18px] shrink-0 text-[#a8a29b] transition-transform duration-150 ${
                  isOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {isOpen && (
              <p className="m-0 px-5 pb-[18px] text-[15px] leading-[1.7] text-[#57534c]">
                {faq.a}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
