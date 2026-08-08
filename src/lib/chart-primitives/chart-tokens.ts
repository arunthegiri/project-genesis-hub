/**
 * Token reads for canvas-facing chart primitives (build doc §11 M2). The M4
 * chart theme registry (`lib/chart-theme.ts`) covers series colors; the M2
 * primitives additionally need `--surface-2` (session band base, replay pill
 * fill) and `--background` (text on the direction-colored price pill). Read
 * lazily from computed style, exactly like the registry — call from effects
 * or primitive setters, never at module scope (SSR) and never in a draw path
 * (getComputedStyle is a layout-adjacent read).
 */

export function readCssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
