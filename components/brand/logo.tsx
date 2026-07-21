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
  const paperShape = inverted ? INK : PAPER; // Hörner, Ohren, Kopf, Buch
  const inkDetail = inverted ? PAPER : INK; // Augen, Buchrücken, Punkte

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
      {/* Hörner */}
      <path
        d="M16.5 12.5 C13.5 8.5 15.5 4.5 20 5.5"
        fill="none"
        stroke={paperShape}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M31.5 12.5 C34.5 8.5 32.5 4.5 28 5.5"
        fill="none"
        stroke={paperShape}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Ohren */}
      <path
        d="M16 14.5 C12.5 13.5 11 16.5 13.5 18.5"
        fill="none"
        stroke={paperShape}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M32 14.5 C35.5 13.5 37 16.5 34.5 18.5"
        fill="none"
        stroke={paperShape}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Ziegenkopf */}
      <path
        d="M24 8 C19.2 8 16 11.5 16 16.5 C16 21.5 19.2 25.5 24 25.5 C28.8 25.5 32 21.5 32 16.5 C32 11.5 28.8 8 24 8 Z"
        fill={paperShape}
      />
      <circle cx="20.8" cy="15.5" r="1.7" fill={inkDetail} />
      <circle cx="27.2" cy="15.5" r="1.7" fill={inkDetail} />
      {/* Buch */}
      <path
        d="M24 26 C20.5 23.5 15.5 23.5 12.5 25.5 V37.5 C15.5 35.5 20.5 35.5 24 38.5 C27.5 35.5 32.5 35.5 35.5 37.5 V25.5 C32.5 23.5 27.5 23.5 24 26 Z"
        fill={paperShape}
      />
      <path
        d="M24 27.5 V38"
        stroke={inkDetail}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="15" cy="24.6" r="1.8" fill={inkDetail} />
      <circle cx="18.6" cy="24" r="1.3" fill={inkDetail} />
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
