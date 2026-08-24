import { forwardRef, useImperativeHandle, useRef } from "react";
import type { PriceBar } from "@/lib/api/types";
import { CHART_COLORS } from "@/lib/chart-colors";

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

const fmt = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtVol = (v: number) =>
  v >= 1e9 ? (v / 1e9).toFixed(2) + "B"
  : v >= 1e6 ? (v / 1e6).toFixed(2) + "M"
  : v >= 1e3 ? (v / 1e3).toFixed(1) + "K"
  : String(v);

/**
 * Crosshair OHLC legend (build doc §8): React renders the frame once; values
 * are written imperatively via the ref handle, routed through the §7 rAF
 * coalescer by the caller. Rows: O H L C · Δ% · Vol, plus one row per active
 * indicator overlay, colored to its series.
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
      if (openRef.current)  openRef.current.textContent  = fmt(bar.open);
      if (highRef.current)  highRef.current.textContent  = fmt(bar.high);
      if (lowRef.current)   lowRef.current.textContent   = fmt(bar.low);
      if (closeRef.current) closeRef.current.textContent = fmt(bar.close);
      if (volRef.current)   volRef.current.textContent   = fmtVol(bar.volume);
      if (deltaRef.current) {
        const pct = bar.open !== 0 ? ((bar.close - bar.open) / bar.open) * 100 : 0;
        deltaRef.current.textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
        deltaRef.current.style.color = bar.close >= bar.open ? CHART_COLORS.bull : CHART_COLORS.bear;
      }
      const rows = rowsRef.current;
      if (rows) {
        // Row pool: grow/shrink to the indicator count, then mutate in place.
        while (rows.children.length < indicators.length) {
          const div = document.createElement("div");
          const t = document.createElement("span");
          const v = document.createElement("span");
          v.className = "ml-1.5";
          div.append(t, v);
          rows.appendChild(div);
        }
        while (rows.children.length > indicators.length) rows.lastElementChild?.remove();
        indicators.forEach((ind, i) => {
          const div = rows.children[i] as HTMLElement;
          const t = div.children[0] as HTMLSpanElement;
          const v = div.children[1] as HTMLSpanElement;
          t.textContent = ind.title;
          t.style.color = ind.color;
          v.textContent = fmt(ind.value);
          v.style.color = ind.color;
        });
      }
    },
  }), []);

  return (
    <div className="pointer-events-none absolute left-2 top-2 z-10 font-mono text-[11px] leading-tight">
      <div className="text-muted-foreground">
        O <span ref={openRef} className="text-foreground" /> H <span ref={highRef} className="text-foreground" /> L <span ref={lowRef} className="text-foreground" /> C <span ref={closeRef} className="text-foreground" />{" "}
        <span ref={deltaRef} /> · Vol <span ref={volRef} className="text-foreground" />
      </div>
      <div ref={rowsRef} />
    </div>
  );
});
