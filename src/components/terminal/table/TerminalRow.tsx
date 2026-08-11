import { memo } from "react";
import { cellsEqual, renderCell, type CellRender } from "./cells";
import { cn } from "@/lib/utils";

/** Left gutter reserved for the drag handle — always present so nothing shifts. */
export const ROW_GUTTER_PX = 18;

// Module constants: the per-cell layout classes never vary, so cn() has
// nothing to concatenate on the hot path.
const CELL_LAYOUT_LEFT = "shrink-0 truncate px-2 text-xs text-left";
const CELL_LAYOUT_RIGHT = "shrink-0 truncate px-2 text-xs text-right";

/**
 * Dev-only render tally for the §8.3 memo audit ("ticking one cell re-renders
 * exactly one row"). `import.meta.env.DEV` is statically replaced, so both the
 * counter and the window handle vanish from a production bundle — this is not
 * a runtime branch shipped to users.
 */
declare global {
  interface Window {
    __terminalRowRenders?: number;
  }
}

export interface TerminalRowProps {
  rowId: string;
  cells: readonly CellRender[];
  /** Column widths, parallel to `cells` (px). */
  widths: readonly number[];
  /** Column alignments, parallel to `cells`. */
  aligns: readonly ("left" | "right")[];
  /**
   * Selection is passed IN as a boolean (build doc §8.1). Calling
   * row.getIsSelected() inside would subscribe the row to the table instance
   * and defeat the memo — every selection change would re-render every row.
   */
  isSelected: boolean;
  height: number;
  /** Virtual offset in px. */
  start: number;
  onSelect?: (rowId: string, modifiers: { shift: boolean; meta: boolean }) => void;
}

/**
 * The ONE memo boundary in the table (build doc §8.1). Absolutely positioned at
 * translateY(start) so the virtualizer never reflows the list.
 *
 * Everything crossing this boundary is a primitive or an array compared by
 * value (see cellsEqual). No context reads, no table-instance access, no
 * callbacks that change identity per render — `onSelect` must be stable
 * (useCallback in the owner) or the memo is pointless.
 */
function TerminalRowImpl({
  rowId,
  cells,
  widths,
  aligns,
  isSelected,
  height,
  start,
  onSelect,
}: TerminalRowProps) {
  if (import.meta.env.DEV && typeof window !== "undefined") {
    window.__terminalRowRenders = (window.__terminalRowRenders ?? 0) + 1;
  }
  return (
    <div
      role="row"
      aria-selected={isSelected}
      data-testid="terminal-row"
      data-row-id={rowId}
      onMouseDown={(e) => onSelect?.(rowId, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })}
      className={cn(
        "group absolute left-0 top-0 flex w-full items-center border-b border-border-subtle",
        // Selected wins over hover; both are surface steps, never accent fills.
        isSelected ? "bg-surface-3" : "hover:bg-surface-2/60",
      )}
      style={{ height, transform: `translateY(${start}px)` }}
    >
      {/* Reserved drag-handle gutter — occupies space at all times, reveals on
          row hover, so hovering never nudges the columns (§8.1).
          Drawn in CSS (`terminal-grip`, styles.css) rather than as an icon
          component: at ~22 visible rows an SVG component per row was pure mount
          cost in the §8.3 scroll budget, for a decoration that is invisible
          until hover. */}
      <span
        aria-hidden
        className="terminal-grip shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ width: ROW_GUTTER_PX }}
      />

      {cells.map((cell, i) =>
        renderCell(
          cell,
          i,
          aligns[i] === "right" ? CELL_LAYOUT_RIGHT : CELL_LAYOUT_LEFT,
          // One style object per cell per render is unavoidable, but the class
          // strings above are module constants so cn() has nothing to join.
          { width: widths[i] },
        ),
      )}
    </div>
  );
}

export const TerminalRow = memo(TerminalRowImpl, (prev, next) => {
  if (
    prev.rowId !== next.rowId ||
    prev.isSelected !== next.isSelected ||
    prev.height !== next.height ||
    prev.start !== next.start ||
    prev.onSelect !== next.onSelect
  ) {
    return false;
  }
  // Widths/aligns come from the column preset and are stable per table, so an
  // identity check is the right cost here; cells are compared by value.
  if (prev.widths !== next.widths || prev.aligns !== next.aligns) return false;
  return cellsEqual(prev.cells, next.cells);
});
