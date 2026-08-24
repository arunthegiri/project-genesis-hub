/**
 * CHART_COLORS — the single color system for every chart and P&L surface
 * (build doc §6).
 *
 * These rgb() values are the sRGB equivalents of the oklch design tokens in
 * styles.css (--bull / --bear / --neutral), computed once and pinned here as
 * literals on purpose: canvas fillStyle silently IGNORES color strings it
 * can't parse (oklch() fails in several browsers, notably Safari ≤ 17),
 * which left series painted in the default black — invisible on the dark
 * terminal background. rgb()/rgba() parse everywhere, in DOM and canvas,
 * with zero SSR or lazy-init concerns. If the styles.css tokens ever change,
 * recompute these (oklch → sRGB) and update both places.
 *
 *   --bull    oklch(0.72 0.18 150)  →  rgb(50, 195, 100)
 *   --bear    oklch(0.65 0.22 25)   →  rgb(249, 65, 68)
 *   --neutral oklch(0.78 0.13 85)   →  rgb(221, 176, 73)
 */

export const CHART_COLORS = {
  bull: "rgb(50, 195, 100)",
  bear: "rgb(249, 65, 68)",
  neutral: "rgb(221, 176, 73)",
  /** ~55% alpha variants — volume bars, MACD histogram. */
  bullDim: "rgba(50, 195, 100, 0.55)",
  bearDim: "rgba(249, 65, 68, 0.55)",
  /** Accent palette for indicator overlays (SMA/EMA/MACD lines…). */
  indicator: ["#60a5fa", "#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#fb923c"],
  /** Accent palette for compare-symbol lines. */
  compare: ["#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#fb923c"],
  /** Primary line/area accent (main series in line mode, equity curve). */
  accent: "#60a5fa",
} as const;
