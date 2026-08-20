import { useCallback, useEffect, useRef, useState } from "react";

import { useChartTheme } from "@/hooks/useChartTheme";
import { readCssToken } from "@/lib/chart-primitives/chart-tokens";
import { cn } from "@/lib/utils";

/**
 * B4 correlation heatmap (build doc §15.1, plan §4.4) — hand-rolled canvas.
 *
 * Decision D3c rejected ECharts for this panel: the matrix is computed once
 * per run and painted once, so a ~1MB dependency would buy nothing that ~150
 * lines of canvas does not already do. What canvas is bad at is text, so the
 * LABELS are DOM (crisp at any DPR, selectable, themeable) and only the cells
 * are painted. Hover is DOM too — an absolutely-positioned highlight pair, so
 * moving the pointer never repaints the grid.
 *
 * Scale: diverging dir-down → surface-1 → dir-up across −1…+1, which makes the
 * diagonal (+1) the brightest thing on screen and anticorrelation unmistakable.
 */

export interface CorrelationMatrixProps {
  symbols: string[];
  /** Square matrix, matrix[i][j] = corr(symbols[i], symbols[j]) ∈ [-1, 1]. */
  matrix: number[][];
  /** Drill-through: the pair behind a clicked cell. */
  onSelectPair?: (a: string, b: string) => void;
  className?: string;
}

const LABEL_W = 64;
const LABEL_H = 22;
const MIN_CELL = 22;
const MAX_CELL = 52;

/** Parse "#rrggbb" / "rgb(a)" into [r,g,b]; the registry hands back both. */
function toRgb(color: string): [number, number, number] {
  const c = color.trim();
  if (c.startsWith("#")) {
    const hex =
      c.length <= 5
        ? c
            .slice(1)
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : c.slice(1);
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  const nums = c.match(/[\d.]+/g);
  if (nums && nums.length >= 3) return [Number(nums[0]), Number(nums[1]), Number(nums[2])];
  return [128, 128, 128];
}

const mix = (a: [number, number, number], b: [number, number, number], t: number): string => {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
};

export function CorrelationMatrix({
  symbols,
  matrix,
  onSelectPair,
  className,
}: CorrelationMatrixProps) {
  const theme = useChartTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(MIN_CELL);
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);
  // Scale midpoint = the panel body colour, so ρ≈0 reads as "nothing here".
  // Not in the ChartTheme registry (that covers series colours); read the same
  // way the §11 M2 canvas primitives read --surface-2, and re-read whenever the
  // registry says the theme changed.
  const [mid, setMid] = useState(() =>
    typeof window === "undefined" ? "" : readCssToken("--surface-1"),
  );
  useEffect(() => setMid(readCssToken("--surface-1")), [theme]);

  const n = symbols.length;

  // Cell size from the available width — measured in a ResizeObserver, never
  // per frame.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || n === 0) return;
    const apply = () => {
      const available = wrap.getBoundingClientRect().width - LABEL_W - 8;
      if (available <= 0) return;
      setCell(Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(available / n))));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [n]);

  // One paint per data/theme/size change. No animation, no per-frame work.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !theme || !mid || n === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const size = n * cell;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const up = toRgb(theme.up);
    const down = toRgb(theme.down);
    const midRgb = toRgb(mid);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = matrix[i]?.[j];
        if (v === undefined || Number.isNaN(v)) {
          ctx.fillStyle = mid;
        } else {
          const t = Math.min(1, Math.abs(v));
          ctx.fillStyle = v >= 0 ? mix(midRgb, up, t) : mix(midRgb, down, t);
        }
        ctx.fillRect(j * cell, i * cell, cell - 1, cell - 1);
      }
    }
  }, [matrix, symbols, cell, theme, mid, n]);

  const pick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const j = Math.floor((e.clientX - rect.left) / cell);
      const i = Math.floor((e.clientY - rect.top) / cell);
      if (i < 0 || j < 0 || i >= n || j >= n) return null;
      return { i, j };
    },
    [cell, n],
  );

  if (n === 0) return null;

  const value = hover ? matrix[hover.i]?.[hover.j] : undefined;

  return (
    <div ref={wrapRef} className={cn("relative select-none p-3", className)}>
      {/* Column labels — rotated, DOM text so they stay crisp. */}
      <div className="flex" style={{ paddingLeft: LABEL_W }}>
        {symbols.map((s, j) => (
          <div
            key={s}
            className={cn(
              "shrink-0 truncate text-center font-mono text-[10px]",
              hover?.j === j ? "text-text-primary" : "text-text-muted",
            )}
            style={{ width: cell, height: LABEL_H, lineHeight: `${LABEL_H}px` }}
          >
            {s.length > 4 ? s.slice(0, 4) : s}
          </div>
        ))}
      </div>

      <div className="flex">
        <div className="shrink-0" style={{ width: LABEL_W }}>
          {symbols.map((s, i) => (
            <div
              key={s}
              className={cn(
                "truncate pr-2 text-right font-mono text-[10px]",
                hover?.i === i ? "text-text-primary" : "text-text-muted",
              )}
              style={{ height: cell, lineHeight: `${cell}px` }}
            >
              {s}
            </div>
          ))}
        </div>

        <div className="relative">
          <canvas
            ref={canvasRef}
            data-testid="correlation-canvas"
            className="block cursor-crosshair"
            onMouseMove={(e) => setHover(pick(e))}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => {
              const hit = pick(e);
              if (hit && onSelectPair) onSelectPair(symbols[hit.i], symbols[hit.j]);
            }}
          />
          {/* Row/column crosshair: two absolutely-positioned divs, so hovering
              costs a style write and never a canvas repaint. */}
          {hover && (
            <>
              <div
                className="pointer-events-none absolute left-0 border-y border-accent-blue/70"
                style={{ top: hover.i * cell, height: cell, width: n * cell }}
              />
              <div
                className="pointer-events-none absolute top-0 border-x border-accent-blue/70"
                style={{ left: hover.j * cell, width: cell, height: n * cell }}
              />
            </>
          )}
        </div>
      </div>

      {/* Readout + legend */}
      <div className="mt-3 flex items-center gap-4 pl-1 text-[11px]">
        <span data-testid="correlation-readout" className="tabular text-text-secondary">
          {hover && value !== undefined
            ? `${symbols[hover.i]} · ${symbols[hover.j]}  ρ = ${value.toFixed(2)}`
            : "Hover a cell for the pair correlation"}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-text-muted">
          <span>−1</span>
          <span
            aria-hidden
            className="h-2 w-28 rounded-[2px]"
            style={{
              background:
                theme && mid
                  ? `linear-gradient(90deg, ${theme.down}, ${mid}, ${theme.up})`
                  : undefined,
            }}
          />
          <span>+1</span>
        </span>
      </div>
    </div>
  );
}
