import { memo } from "react";
import { fmtPct, fmtPnl, fmtPrice, fmtSize } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Cell renderers (build doc §8.1). Every cell is a pure function of PRIMITIVE
 * inputs — that is what lets TerminalRow's memo boundary hold.
 *
 * The colouring rule is the one that makes this feel like a terminal and the
 * one most likely to be "fixed" by mistake: colour is computed INSIDE the cell
 * from that cell's OWN comparison, never from a row-level verdict. A position
 * can be up on the day and down against its entry at the same time, so `last`
 * renders green while `unrealized PnL` renders red IN THE SAME ROW. That is
 * correct (§8.3 reference behaviour) — it is information, not inconsistency.
 */

export type Tone = "up" | "down" | "flat" | "neutral" | "warn" | "info";

/**
 * A cell's render instruction: a discriminated union of PRIMITIVES only.
 * Arrays are allowed (sparkline points, chip labels) but are compared
 * element-wise by `cellsEqual` below, never by identity.
 */
export type CellRender =
  | { type: "text"; value: string; mono?: boolean; strong?: boolean }
  | { type: "num"; value: number | null; kind: "price" | "size" | "pnl"; prefix?: string }
  /** value is already in percent units (12.34 → +12.34%). */
  | { type: "pct"; value: number | null; plus?: boolean; reference?: number }
  /**
   * Direction-coloured number: `value` is what prints, `reference` is what it
   * is compared against. Passing the comparison in (rather than a pre-computed
   * colour) is what keeps the rule per-cell and auditable.
   */
  | { type: "dir"; value: number | null; reference: number | null; kind: "price" | "size" | "pnl" }
  | { type: "badge"; value: string; tone: Tone }
  | { type: "spark"; points: number[]; reference: number | null }
  | { type: "chips"; values: string[] };

// ── Tone → token ─────────────────────────────────────────────────────────────

const TONE_TEXT: Record<Tone, string> = {
  up: "text-bull",
  down: "text-bear",
  // §3.2 neutral split: unchanged is de-emphasised gray, never amber.
  flat: "text-dir-flat",
  neutral: "text-text-primary",
  warn: "text-warning",
  info: "text-accent-blue",
};

const TONE_BADGE: Record<Tone, string> = {
  up: "bg-bull/20 text-bull border-bull/30",
  down: "bg-bear/20 text-bear border-bear/30",
  flat: "bg-surface-3 text-dir-flat border-border-subtle",
  neutral: "bg-surface-3 text-text-secondary border-border-subtle",
  warn: "bg-warning/20 text-warning border-warning/30",
  info: "bg-accent-blue/20 text-accent-blue border-accent-blue/30",
};

/** The per-cell comparison. Exported so the §8.3 audit can assert on it. */
export function toneFor(value: number | null, reference: number | null): Tone {
  if (value === null || reference === null) return "flat";
  if (value > reference) return "up";
  if (value < reference) return "down";
  return "flat";
}

function formatNum(value: number | null, kind: "price" | "size" | "pnl"): string {
  if (value === null) return "—";
  if (kind === "price") return fmtPrice(value);
  if (kind === "size") return fmtSize(value);
  return fmtPnl(value);
}

// ── Sparkline ────────────────────────────────────────────────────────────────

const SPARK_W = 64;
const SPARK_H = 18;

/**
 * Inline SVG polyline + dotted baseline at the reference price (§8.1) — no
 * chart library per cell. `currentColor` inherits the direction colour set by
 * the wrapper, so the stroke costs no extra token lookup.
 */
const Sparkline = memo(function Sparkline({
  points,
  reference,
}: {
  points: number[];
  reference: number | null;
}) {
  if (points.length < 2) return <span className="text-dir-flat">—</span>;
  let min = points[0];
  let max = points[0];
  for (const p of points) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  if (reference !== null) {
    if (reference < min) min = reference;
    if (reference > max) max = reference;
  }
  const span = max - min || 1;
  const y = (v: number) => SPARK_H - 1 - ((v - min) / span) * (SPARK_H - 2);
  const step = SPARK_W / (points.length - 1);
  const d = points.map((p, i) => `${(i * step).toFixed(1)},${y(p).toFixed(1)}`).join(" ");

  return (
    <svg width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} aria-hidden>
      {reference !== null && (
        <line
          x1={0}
          x2={SPARK_W}
          y1={y(reference)}
          y2={y(reference)}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 2"
          opacity={0.35}
        />
      )}
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth={1.25} />
    </svg>
  );
});

// ── The renderer ─────────────────────────────────────────────────────────────

/**
 * Render one cell as ONE element, into the layout span the row already needs.
 *
 * Deliberately a plain function, not a component: it is called from inside
 * TerminalRow, which is already the memo boundary — wrapping each cell in its
 * own memo would add N reconciler nodes per row for nothing. For the same
 * reason `layout` (width/alignment, owned by the row) is merged into the cell's
 * own class rather than wrapped around it: a nested span per cell doubled the
 * element count per row and showed up directly in the §8.3 scroll budget.
 *
 * Badge and chips are the exceptions — they need a box inside the cell, so they
 * keep an inner element.
 */
export function renderCell(
  cell: CellRender,
  key: number,
  layout: string,
  style: React.CSSProperties,
) {
  switch (cell.type) {
    case "text":
      return (
        <span
          key={key}
          className={cn(
            layout,
            cell.mono && "font-mono",
            cell.strong ? "text-text-primary" : "text-text-secondary",
          )}
          style={style}
        >
          {cell.value}
        </span>
      );

    case "num":
      return (
        <span key={key} className={cn(layout, "tabular font-mono text-text-primary")} style={style}>
          {cell.prefix}
          {formatNum(cell.value, cell.kind)}
        </span>
      );

    case "pct": {
      const tone = toneFor(cell.value, cell.reference ?? 0);
      return (
        <span key={key} className={cn(layout, "tabular font-mono", TONE_TEXT[tone])} style={style}>
          {cell.value === null ? "—" : fmtPct(cell.value, { plus: cell.plus ?? true })}
        </span>
      );
    }

    case "dir": {
      const tone = toneFor(cell.value, cell.reference);
      return (
        <span key={key} className={cn(layout, "tabular font-mono", TONE_TEXT[tone])} style={style}>
          {formatNum(cell.value, cell.kind)}
        </span>
      );
    }

    case "badge":
      return (
        <span key={key} className={layout} style={style}>
          <span
            className={cn(
              "inline-flex items-center rounded-[2px] border px-1.5 py-px text-[10px] font-medium leading-tight",
              TONE_BADGE[cell.tone],
            )}
          >
            {cell.value}
          </span>
        </span>
      );

    case "spark": {
      const last = cell.points.length ? cell.points[cell.points.length - 1] : null;
      return (
        <span
          key={key}
          className={cn(
            layout,
            "inline-flex items-center",
            TONE_TEXT[toneFor(last, cell.reference)],
          )}
          style={style}
        >
          <Sparkline points={cell.points} reference={cell.reference} />
        </span>
      );
    }

    case "chips":
      return (
        <span key={key} className={cn(layout, "inline-flex flex-wrap gap-1")} style={style}>
          {cell.values.map((v) => (
            <span
              key={v}
              className="rounded-[2px] border border-border-subtle bg-surface-3 px-1 text-[10px] leading-tight text-text-secondary"
            >
              {v}
            </span>
          ))}
        </span>
      );
  }
}

/**
 * Element-wise cell comparison — the heart of the §8.1 memo contract.
 *
 * §8.1 says "everything in is a primitive", but a row's cells necessarily
 * arrive as an array of small objects. Comparing that array by IDENTITY would
 * re-render every row whenever the parent recomputes, which is precisely the
 * failure the contract exists to prevent. So the array is compared by VALUE:
 * O(columns) primitive compares per row per parent render, against a full
 * subtree reconcile if it were skipped. Arrays inside a cell (spark points,
 * chip labels) are compared element-wise for the same reason.
 *
 * Every variant is spelled out rather than looped over with Object.keys. This
 * runs for every visible row on every scroll frame, and Object.keys allocates
 * an array per call — at 22 rows × 9 columns that was ~400 throwaway arrays per
 * tick, which was visible in the §8.3 measurement. Adding a field to CellRender
 * means adding it here; the exhaustive switch makes the compiler say so.
 */
export function cellsEqual(a: readonly CellRender[], b: readonly CellRender[]): boolean {
  // Fast path: TerminalTable caches cell arrays by row identity, so an
  // unchanged row is settled here without touching a single field.
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.type !== y.type) return false;
    switch (x.type) {
      case "spark": {
        const z = y as Extract<CellRender, { type: "spark" }>;
        if (x.reference !== z.reference || x.points.length !== z.points.length) return false;
        for (let j = 0; j < x.points.length; j++) {
          if (x.points[j] !== z.points[j]) return false;
        }
        break;
      }
      case "chips": {
        const z = y as Extract<CellRender, { type: "chips" }>;
        if (x.values.length !== z.values.length) return false;
        for (let j = 0; j < x.values.length; j++) {
          if (x.values[j] !== z.values[j]) return false;
        }
        break;
      }
      case "text": {
        const z = y as Extract<CellRender, { type: "text" }>;
        if (x.value !== z.value || x.mono !== z.mono || x.strong !== z.strong) return false;
        break;
      }
      case "num": {
        const z = y as Extract<CellRender, { type: "num" }>;
        if (x.value !== z.value || x.kind !== z.kind || x.prefix !== z.prefix) return false;
        break;
      }
      case "pct": {
        const z = y as Extract<CellRender, { type: "pct" }>;
        if (x.value !== z.value || x.plus !== z.plus || x.reference !== z.reference) return false;
        break;
      }
      case "dir": {
        const z = y as Extract<CellRender, { type: "dir" }>;
        if (x.value !== z.value || x.reference !== z.reference || x.kind !== z.kind) return false;
        break;
      }
      case "badge": {
        const z = y as Extract<CellRender, { type: "badge" }>;
        if (x.value !== z.value || x.tone !== z.tone) return false;
        break;
      }
    }
  }
  return true;
}
