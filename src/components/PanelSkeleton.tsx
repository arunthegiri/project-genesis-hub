import { GripHorizontal, Loader2 } from "lucide-react";

// Panel geometry constants, co-located with the skeleton (build doc §13) so
// the placeholder and the real ChartPanel can't drift apart. ChartPanel
// imports these — never duplicate the numbers there.
export const MIN_CHART_HEIGHT     = 300;
export const DEFAULT_CHART_HEIGHT = 520;
export const DEFAULT_DATA_PCT     = 40;   // data panel width when open (~60/40 split)
export const MIN_DATA_PCT         = 15;
export const MAX_DATA_PCT         = 70;

export const maxChartHeight = () =>
  typeof window === "undefined" ? 900 : Math.round(window.innerHeight * 0.9);
export const clampHeight = (h: number) =>
  Math.min(maxChartHeight(), Math.max(MIN_CHART_HEIGHT, h));

/**
 * Geometry-stable placeholder for ChartPanel (build doc §13): rendered during
 * SSR and hydration, swapped for the real panel in the same commit that
 * restores persisted panel internals post-mount. Every block mirrors the real
 * panel's boxes (header strip, controls strip, fixed-height chart region,
 * bottom handle) so the swap produces no layout shift and no wrong-content
 * flash.
 */
export function PanelSkeleton({ symbol, height }: { symbol?: string; height: number }) {
  return (
    <div className="flex animate-pulse flex-col rounded-md border border-border bg-card">
      {/* Header strip — px-3 py-2 with an h-8 control, same as the real header. */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex h-8 w-36 items-center rounded-md border border-input px-3 font-mono text-sm text-muted-foreground">
          {symbol || "Symbol…"}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="h-7 w-32 rounded-md bg-border/20" />
          <div className="h-7 w-14 rounded-md bg-border/20" />
        </div>
      </div>

      {/* Controls strip — label + h-8 field rows, same block heights as the real controls. */}
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-3">
        {[280, 170, 130, 190, 120].map((w, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="h-3 w-10 rounded bg-border/20" />
            <div className="h-8 rounded-md bg-border/20" style={{ width: w }} />
          </div>
        ))}
      </div>

      {/* Chart region — fixed height identical to the live panel; the bottom
          resize handle lives inside it, exactly like the real layout. */}
      <div className="relative flex flex-col" style={{ height }}>
        <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground/50">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
        <div className="flex h-2 shrink-0 items-center justify-center border-t border-border bg-border/10">
          <GripHorizontal className="h-3 w-3 text-muted-foreground/50" />
        </div>
      </div>
    </div>
  );
}
