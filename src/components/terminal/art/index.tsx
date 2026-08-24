import type { ReactNode, SVGProps } from "react";

/**
 * PanelState art set (build doc §6.2) — hand-drawn 96×96 illustrations, one
 * per panel-state flavor. Every shape is a 1.5px stroke in `currentColor`
 * (the parent sets `text-text-muted`, so the art rides the theme tokens and
 * works in all four themes); each drawing carries exactly ONE accent-blue
 * detail (a `text-accent-blue` child — currentColor resolves per element).
 * No stock illustration library (plan §3.8 — they fight the dark terminal).
 */

export type PanelArtName =
  | "chart"
  | "table"
  | "plug"
  | "warning"
  | "lock"
  | "clock"
  | "search"
  | "wallet";

type ArtProps = Omit<SVGProps<SVGSVGElement>, "width" | "height" | "viewBox">;

function ArtSvg({ children, ...props }: ArtProps & { children: ReactNode }) {
  return (
    <svg
      width={96}
      height={96}
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Axes with four candlesticks; the last (winning) candle is the accent detail. */
export function ChartArt(props: ArtProps) {
  return (
    <ArtSvg {...props}>
      <path d="M20 12 V76 H84" />
      <line x1={34} y1={30} x2={34} y2={52} />
      <rect x={30} y={34} width={8} height={14} rx={1} />
      <line x1={48} y1={24} x2={48} y2={46} />
      <rect x={44} y={28} width={8} height={12} rx={1} />
      <line x1={62} y1={34} x2={62} y2={56} />
      <rect x={58} y={38} width={8} height={14} rx={1} />
      <g className="text-accent-blue">
        <line x1={76} y1={18} x2={76} y2={42} />
        <rect x={72} y={22} width={8} height={14} rx={1} />
      </g>
    </ArtSvg>
  );
}

/** Table card with a header separator and three rows; the middle row is accent. */
export function TableArt(props: ArtProps) {
  return (
    <ArtSvg {...props}>
      <rect x={16} y={22} width={64} height={52} rx={6} />
      <line x1={16} y1={36} x2={80} y2={36} />
      <line x1={26} y1={46} x2={70} y2={46} />
      <line className="text-accent-blue" x1={26} y1={56} x2={70} y2={56} />
      <line x1={26} y1={66} x2={56} y2={66} />
    </ArtSvg>
  );
}

/** Unplugged connector: plug, socket, cords; an accent spark marks the gap. */
export function PlugArt(props: ArtProps) {
  return (
    <ArtSvg {...props}>
      <rect x={18} y={38} width={20} height={20} rx={4} />
      <line x1={38} y1={44} x2={48} y2={44} />
      <line x1={38} y1={52} x2={48} y2={52} />
      <rect x={58} y={38} width={20} height={20} rx={4} />
      <line x1={65} y1={44} x2={65} y2={52} />
      <line x1={71} y1={44} x2={71} y2={52} />
      <path d="M18 48 C 12 48 10 56 10 64" />
      <path d="M78 48 C 84 48 86 56 86 64" />
      <path className="text-accent-blue" d="M54 40 L50 48 L54 48 L50 56" />
    </ArtSvg>
  );
}

/** Warning triangle with an exclamation mark; the dot is the accent detail. */
export function WarningArt(props: ArtProps) {
  return (
    <ArtSvg {...props}>
      <path d="M48 18 L82 74 H14 Z" />
      <line x1={48} y1={38} x2={48} y2={54} />
      <circle
        className="text-accent-blue"
        cx={48}
        cy={63}
        r={2.5}
        fill="currentColor"
        stroke="none"
      />
    </ArtSvg>
  );
}

/** Padlock; the keyhole is the accent detail. */
export function LockArt(props: ArtProps) {
  return (
    <ArtSvg {...props}>
      <rect x={26} y={42} width={44} height={32} rx={6} />
      <path d="M34 42 V32 A14 14 0 0 1 62 32 V42" />
      <g className="text-accent-blue">
        <circle cx={48} cy={55} r={3.5} />
        <line x1={48} y1={58.5} x2={48} y2={64} />
      </g>
    </ArtSvg>
  );
}

/** Clock face with ticks and two hands; the minute hand is the accent detail. */
export function ClockArt(props: ArtProps) {
  return (
    <ArtSvg {...props}>
      <circle cx={48} cy={48} r={30} />
      <line x1={48} y1={24} x2={48} y2={28} />
      <line x1={72} y1={48} x2={68} y2={48} />
      <line x1={48} y1={72} x2={48} y2={68} />
      <line x1={24} y1={48} x2={28} y2={48} />
      <line x1={48} y1={48} x2={48} y2={32} />
      <line className="text-accent-blue" x1={48} y1={48} x2={61} y2={55} />
      <circle cx={48} cy={48} r={2} fill="currentColor" stroke="none" />
    </ArtSvg>
  );
}

/** Magnifier with an empty-result dash in the lens; the handle is accent. */
export function SearchArt(props: ArtProps) {
  return (
    <ArtSvg {...props}>
      <circle cx={42} cy={42} r={18} />
      <line x1={34} y1={42} x2={50} y2={42} />
      <line className="text-accent-blue" x1={55} y1={55} x2={71} y2={71} />
    </ArtSvg>
  );
}

/** Wallet with a clasp pouch; the clasp dot is the accent detail. */
export function WalletArt(props: ArtProps) {
  return (
    <ArtSvg {...props}>
      <rect x={16} y={30} width={64} height={40} rx={8} />
      <rect x={54} y={42} width={26} height={16} rx={4} />
      <circle
        className="text-accent-blue"
        cx={62}
        cy={50}
        r={2.5}
        fill="currentColor"
        stroke="none"
      />
    </ArtSvg>
  );
}
