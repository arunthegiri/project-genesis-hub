import type { CellRender } from "./cells";

/**
 * Column presets as DATA (build doc §8.2 item 3) — the whole reason W6 precedes
 * M6. A table is a `ColumnPreset[]` plus a row array; B1 (strategy table) and
 * B2 (ranking table) must be new preset arrays, never new table components. If
 * a future table needs a `.tsx` file to exist, W6 did not land.
 *
 * The shape is deliberately narrow:
 *   · `cell` returns PRIMITIVES only (a CellRender), so the §8.1 memo contract
 *     survives whatever a preset author does;
 *   · `sortValue` is separate from `cell` because the sort key is almost never
 *     the rendered string — "$1,234.50" sorts as text, 1234.5 sorts correctly;
 *   · `width` is fixed px, not flex, because virtualized rows are absolutely
 *     positioned and a fractional width would reflow per row.
 */
export interface ColumnPreset<T> {
  /** Stable id — also the sorting key and the React key. */
  id: string;
  header: string;
  width: number;
  align: "left" | "right";
  /** Render instruction for this cell. Primitives only. */
  cell: (row: T) => CellRender;
  /**
   * Sort key. Omit to make the column unsortable. Numbers sort numerically,
   * strings with localeCompare; nulls always sort last regardless of direction.
   */
  sortValue?: (row: T) => number | string | null;
}

/** Parse the loose `string | number | null` shapes the Spring API returns. */
export function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? parseFloat(value) : value;
  return Number.isNaN(n) ? null : n;
}
