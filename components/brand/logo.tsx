import { cn } from "@/lib/utils";

/**
 * GoatbookLM brand mark — Ziegenhörner + aufgeschlagenes Buch.
 * Paths/colors are taken verbatim from
 * `design_handoff_goatbooklm/Logo.dc.html` (maßgebliche Spezifikation).
 */

const INK = "#23211e";
const PAPER = "#fdfdfc";

type LogoMarkProps = {
  size?: number;
  className?: string;
  /** Invertierte Variante für dunkle Flächen (Badge hell, Buch dunkel). */
  inverted?: boolean;
};

export function LogoMark({ size = 34, className, inverted = false }: LogoMarkProps) {
  const badgeFill = inverted ? PAPER : INK;
  const hornStroke = inverted ? INK : PAPER;
  const bookFill = inverted ? INK : PAPER;
  const spineStroke = inverted ? PAPER : INK;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="GoatbookLM"
      className={className}
    >
      <rect x="2" y="2" width="44" height="44" rx="14" fill={badgeFill} />
      <path
        d="M16 15 C13.5 10.5 16 5.5 21 6.5"
        fill="none"
        stroke={hornStroke}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M32 15 C34.5 10.5 32 5.5 27 6.5"
        fill="none"
        stroke={hornStroke}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M24 18.5 C20.5 15.5 15 15.5 12 17.5 V33 C15 31 20.5 31 24 34 C27.5 31 33 31 36 33 V17.5 C33 15.5 27.5 15.5 24 18.5 Z"
        fill={bookFill}
      />
      <path
        d="M24 19 V33.5"
        stroke={spineStroke}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

type LogoLockupProps = {
  markSize?: number;
  className?: string;
  /** Invertierte Variante für dunkle Flächen. */
  inverted?: boolean;
};

export function LogoLockup({
  markSize = 34,
  className,
  inverted = false,
}: LogoLockupProps) {
  const gap = markSize * 0.28;
  const wordmarkSize = markSize * (20 / 34);

  return (
    <span
      className={cn("inline-flex items-center", className)}
      style={{ gap }}
    >
      <LogoMark size={markSize} inverted={inverted} />
      <span
        className="font-heading font-semibold leading-none"
        style={{
          fontSize: wordmarkSize,
          letterSpacing: "-0.01em",
          color: inverted ? PAPER : INK,
        }}
      >
        GoatbookLM
      </span>
    </span>
  );
}
