import { forwardRef, useImperativeHandle, useRef } from "react";
import type { PriceBar } from "@/lib/api/types";
import { resolveChartTheme } from "@/lib/chart-theme";
import { fmtPct, fmtPrice, fmtSize } from "@/lib/format";

export interface LegendIndicatorRow {
  title: string;
  value: number;
  color: string;
}

export interface ChartLegendHandle {
  /**
   * Imperative value write (build doc §8): mutates DOM text nodes directly so
   * crosshair sweeps never touch React state. A null bar keeps the previous
   * values — the legend never blanks.
   */
  write: (bar: PriceBar | null, indicators: LegendIndicatorRow[]) => void;
}

/**
 * Crosshair OHLC legend (build doc §8 / §11 M2): two-line DOM overlay. React
 * renders the frame once; values are written imperatively via the ref handle,
 * routed through the §7 rAF coalescer by the caller.
 *
 * Line 1: `O 25.34  H 25.65  L 25.33  C 25.57  +0.23 (+0.91%)  Vol 1.3M` —
 * each value colored by the bar's direction (close ≥ open → dir-up), the
 * change (absolute + % vs the bar's open) likewise. Line 2: one inline entry
 * per active indicator overlay, name + value in the overlay's color.
 */
export const ChartLegend = forwardRef<ChartLegendHandle>(function ChartLegend(_props, ref) {
  const openRef  = useRef<HTMLSpanElement>(null);
  const highRef  = useRef<HTMLSpanElement>(null);
  const lowRef   = useRef<HTMLSpanElement>(null);
  const closeRef = useRef<HTMLSpanElement>(null);
  const deltaRef = useRef<HTMLSpanElement>(null);
  const volRef   = useRef<HTMLSpanElement>(null);
  const rowsRef  = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    write(bar, indicators) {
      if (!bar) return; // keep last values — never blank
      const theme = resolveChartTheme();
      const dir = bar.close >= bar.open ? theme.up : theme.down;
      if (openRef.current)  { openRef.current.textContent  = fmtPrice(bar.open);  openRef.current.style.color  = dir; }
      if (highRef.current)  { highRef.current.textContent  = fmtPrice(bar.high);  highRef.current.style.color  = dir; }
      if (lowRef.current)   { lowRef.current.textContent   = fmtPrice(bar.low);   lowRef.current.style.color   = dir; }
      if (closeRef.current) { closeRef.current.textContent = fmtPrice(bar.close); closeRef.current.style.color = dir; }
      if (volRef.current)   { volRef.current.textContent   = fmtSize(bar.volume); }
      if (deltaRef.current) {
        const delta = bar.close - bar.open;
        const pct = bar.open !== 0 ? (delta / bar.open) * 100 : 0;
        deltaRef.current.textContent = `${delta >= 0 ? "+" : "-"}${fmtPrice(Math.abs(delta))} (${fmtPct(pct)})`;
        deltaRef.current.style.color = dir;
      }
      const rows = rowsRef.current;
      if (rows) {
        // Entry pool: grow/shrink to the indicator count, then mutate in place.
        while (rows.children.length < indicators.length) {
          rows.appendChild(document.createElement("span"));
        }
        while (rows.children.length > indicators.length) rows.lastElementChild?.remove();
        indicators.forEach((ind, i) => {
          const el = rows.children[i] as HTMLSpanElement;
          el.textContent = `${ind.title} ${fmtPrice(ind.value)}`;
          el.style.color = ind.color;
        });
      }
    },
  }), []);

  return (
    <div
      data-testid="chart-legend"
      className="pointer-events-none absolute left-2 top-2 z-10 font-mono text-[11px] leading-tight"
    >
      <div className="text-muted-foreground">
        O <span ref={openRef} />  H <span ref={highRef} />  L <span ref={lowRef} />  C <span ref={closeRef} />{"  "}
        <span ref={deltaRef} />  Vol <span ref={volRef} className="text-foreground" />
      </div>
      <div ref={rowsRef} className="flex flex-wrap gap-x-3" />
    </div>
  );
});
