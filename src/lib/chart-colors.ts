/**
 * CHART_COLORS — the single color system for every chart and P&L surface
 * (build doc §6). Bull/bear/neutral are read from the CSS custom properties
 * in styles.css so charts and Tailwind classes can never drift apart.
 *
 * Deliberate simplification: the app is dark-only, so tokens are read once
 * (lazily, on first client access — getComputedStyle needs a document; SSR
 * callers get the fallback constants) and no theme-change listener exists.
 */

const FALLBACK = {
  bull: "oklch(0.72 0.18 150)",
  bear: "oklch(0.65 0.22 25)",
  neutral: "oklch(0.78 0.13 85)",
} as const;

/** Append ~55% alpha to an oklch() color string (dim volume bars, MACD hist). */
function dim(color: string): string {
  if (color.startsWith("oklch(") && color.endsWith(")")) {
    return `oklch(${color.slice(6, -1)} / 0.55)`;
  }
  return color;
}

function readToken(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

interface Tokens {
  bull: string;
  bear: string;
  neutral: string;
  bullDim: string;
  bearDim: string;
}

let cached: Tokens | null = null;

function tokens(): Tokens {
  if (!cached) {
    const bull = readToken("--bull", FALLBACK.bull);
    const bear = readToken("--bear", FALLBACK.bear);
    cached = {
      bull,
      bear,
      neutral: readToken("--neutral", FALLBACK.neutral),
      bullDim: dim(bull),
      bearDim: dim(bear),
    };
  }
  return cached;
}

export const CHART_COLORS = {
  get bull(): string { return tokens().bull; },
  get bear(): string { return tokens().bear; },
  get neutral(): string { return tokens().neutral; },
  get bullDim(): string { return tokens().bullDim; },
  get bearDim(): string { return tokens().bearDim; },
  /** Accent palette for indicator overlays (SMA/EMA/MACD lines…). */
  indicator: ["#60a5fa", "#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#fb923c"],
  /** Accent palette for compare-symbol lines. */
  compare: ["#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#fb923c"],
  /** Primary line/area accent (main series in line mode, equity curve). */
  accent: "#60a5fa",
} as const;
