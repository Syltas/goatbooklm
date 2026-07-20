import { ClosingCta } from "@/app/_components/landing/closing-cta";
import { FaqSection } from "@/app/_components/landing/faq-section";
import { Features } from "@/app/_components/landing/features";
import { Hero } from "@/app/_components/landing/hero";
import { HowItWorks } from "@/app/_components/landing/how-it-works";
import { ProductMockup } from "@/app/_components/landing/product-mockup";
import { SelfHostedBand } from "@/app/_components/landing/self-hosted-band";
import { SiteFooter } from "@/app/_components/landing/site-footer";
import { SiteHeader } from "@/app/_components/landing/site-header";

/**
 * Marketing-Landingpage — pixelgenauer Nachbau von
 * `design_handoff_goatbooklm/Landing Page.dc.html` (maßgebliche Spezifikation).
 */
export default function Home() {
  return (
    <div className="bg-[#fdfdfc] text-[#23211e]">
      <SiteHeader />
      <Hero />
      <ProductMockup />
      <HowItWorks />
      <Features />
      <SelfHostedBand />
      <FaqSection />
      <ClosingCta />
      <SiteFooter />
    </div>
  );
}
