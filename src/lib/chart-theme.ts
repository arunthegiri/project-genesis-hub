/**
 * Chart theme registry (build doc §3.4) — the single color source for every
 * canvas chart surface, replacing chart-colors.ts.
 *
 * The tokens in styles.css are the source of truth. Canvas can't read var(),
 * so values are resolved once from getComputedStyle(document.documentElement)
 * and cached; invalidateChartTheme() drops the cache on theme change (§13 M4
 * re-applies it to every registered chart).
 *
 * getComputedStyle returns sRGB-family strings (canvas-parseable) for both
 * hex and oklch token values in all supported browsers — this removes the
 * original reason chart-colors.ts pinned rgb literals (the dual-maintenance
 * hazard behind the painted-black-charts bug).
 *
 * SSR: resolution is lazy — resolveChartTheme() is called from chart effects
 * and imperative DOM writes only, never at module scope or during render.
 *
 * Exempt from the §3.3 literal-sweep grep: this registry and styles.css are
 * the two places raw color values are allowed to live.
 */

export interface ChartTheme {
  /** --dir-up — bullish candles, wicks, markers. */
  up: string;
  /** --dir-down — bearish candles, wicks, markers. */
  down: string;
  /** ~55% alpha variants of up/down — volume bars, MACD histogram. */
  upDim: string;
  downDim: string;
  /** --dir-flat — unchanged/neutral series (BB bands, MACD hist base). */
  flat: string;
  /** --accent-blue — main line/area series, equity curve, MACD line. */
  accent: string;
  /** --warning — caution amber. */
  warning: string;
  /** Indicator + compare-symbol overlay lines, cycled by index. */
  overlays: string[];
  /** Chart grid lines. */
  grid: string;
  /** Axis text. */
  text: string;
  /** Price/time scale borders. */
  scaleBorder: string;
}

/** Reads a custom property's computed value; injectable for tests. */
export type ChartThemeTokenReader = (name: string) => string;

let cache: ChartTheme | null = null;

export function resolveChartTheme(): ChartTheme {
  if (cache) return cache;
  const cs = getComputedStyle(document.documentElement);
  cache = buildChartTheme((n) => cs.getPropertyValue(n).trim());
  return cache;
}

export function invalidateChartTheme(): void {
  cache = null;
}

/* ── §13.4 ChartThemeRegistry ──────────────────────────────────────────────
   Every live chart registers an applier; when a theme attribute on <html>
   changes (data-theme / data-convention / data-cb), a MutationObserver calls
   applyAllChartThemes(): invalidate the cache, re-resolve once, then push the
   new theme into every applier (chart-level applyOptions from useChartBase)
   and notify subscribers (the useChartTheme hook — components re-run their
   theme-colored SERIES effects). Retheme is applyOptions on live instances:
   no chart recreation, no state loss.

   Kept react-free and DOM-guarded: the node smoke test imports this module. */

/** Applies a freshly resolved theme to one chart (chart- or series-level). */
export type ChartThemeApplier = (theme: ChartTheme) => void;

const appliers = new Set<ChartThemeApplier>();
const themeListeners = new Set<() => void>();

/** Registers a chart's applier; returns the unregister (call on chart destroy). */
export function registerChartTheme(apply: ChartThemeApplier): () => void {
  appliers.add(apply);
  startChartThemeSync();
  return () => {
    appliers.delete(apply);
  };
}

/** For non-chart consumers (the useChartTheme hook): called after every
    applyAll — resolveChartTheme() is guaranteed re-resolved by then. */
export function subscribeChartTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

export function applyAllChartThemes(): void {
  invalidateChartTheme();
  const theme = resolveChartTheme();
  for (const apply of appliers) apply(theme);
  for (const l of themeListeners) l();
}

const THEME_ATTRIBUTES = ["data-theme", "data-convention", "data-cb"];

let observer: MutationObserver | null = null;

/** Starts the <html> attribute watcher (idempotent, client-only). Called
    lazily by registerChartTheme so no app-shell wiring is required. */
export function startChartThemeSync(): void {
  if (observer) return;
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  observer = new MutationObserver(() => applyAllChartThemes());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: THEME_ATTRIBUTES,
  });
}

/**
 * Pure builder, injectable so the smoke test can run without a DOM (node has
 * no getComputedStyle). Token values are read by name; the extended overlay
 * entries are pinned literals by design (build doc §3.4 sketch).
 */
export function buildChartTheme(v: ChartThemeTokenReader): ChartTheme {
  const up = v("--dir-up");
  const down = v("--dir-down");
  return {
    up,
    down,
    upDim: withAlpha(up, 0.55),
    downDim: withAlpha(down, 0.55),
    flat: v("--dir-flat"),
    accent: v("--accent-blue"),
    warning: v("--warning"),
    overlays: [
      v("--overlay-primary"),
      v("--overlay-secondary"),
      "#34d399",
      "#f59e0b",
      "#fb923c",
      "#f472b6",
    ],
    grid: v("--grid-line") || "rgba(255,255,255,0.04)",
    text: v("--text-secondary"),
    scaleBorder: "rgba(255,255,255,0.06)",
  };
}

/**
 * Returns `color` at the given alpha as an rgba() string. Handles #RGB,
 * #RRGGBB, #RRGGBBAA and rgb()/rgba() inputs (computed custom-property
 * values arrive as hex as-specified, but a browser is allowed to hand back
 * rgb()); anything unrecognized is returned unchanged.
 */
export function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    const full =
      hex.length <= 4
        ? hex
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return `rgba(${r},${g},${b},${alpha})`;
    }
    return color;
  }
  const m = c.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;
  return color;
}
