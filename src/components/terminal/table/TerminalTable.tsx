import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronUp } from "lucide-react";
import { TerminalRow, ROW_GUTTER_PX } from "./TerminalRow";
import { useDensity } from "./density";
import type { ColumnPreset } from "./presets";
import type { CellRender } from "./cells";
import { PerfProfiler } from "@/lib/perf/react-profiler";
import { cn } from "@/lib/utils";

export interface TerminalTableProps<T> {
  rows: readonly T[];
  columns: readonly ColumnPreset<T>[];
  /** Stable row identity — selection and memo keys both depend on it. */
  getRowId: (row: T) => string;
  /**
   * Selection state lifted to the table owner (§8.1). Uncontrolled when
   * omitted; the table still manages the set internally so callers that do not
   * care about selection do not have to wire it.
   */
  selected?: ReadonlySet<string>;
  onSelectedChange?: (next: Set<string>) => void;
  /** Empty-state node, rendered in place of the row area. */
  empty?: React.ReactNode;
  className?: string;
  /** Overscan rows; raise for very fast scrolling. */
  overscan?: number;
  /** Default sort. Uncontrolled from here on — a header click takes over. */
  initialSorting?: SortingState;
  /**
   * Cap the scrolling body at this many px and let it shrink to content below
   * that. Without it the body fills its flex parent, which leaves a large void
   * under a short table (two positions in a 420px box).
   */
  maxBodyHeight?: number;
}

/**
 * Virtualized, per-cell coloured, memoized table (build doc §8).
 *
 * TanStack Table 8.21.3 (D3a — NOT 9.x) owns sorting and the row model;
 * react-virtual owns windowing; TerminalRow owns the memo boundary. The three
 * responsibilities stay separate on purpose: the row never touches the table
 * instance, so sorting or selecting cannot cascade into a full re-render.
 *
 * Rendering contract (§8.1): no vertical gridlines, a 1px border-subtle header
 * underline and row dividers, numerics right-aligned tabular-nums at fixed
 * precision, per-cell colour computed inside the cell.
 */
export function TerminalTable<T>({
  rows,
  columns,
  getRowId,
  selected,
  onSelectedChange,
  empty,
  className,
  overscan = 12,
  initialSorting,
  maxBodyHeight,
}: TerminalTableProps<T>) {
  const { rowHeight, headerHeight } = useDensity();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sorting, setSorting] = useState<SortingState>(() => initialSorting ?? []);

  // Uncontrolled selection fallback — controlled when `selected` is supplied.
  const [ownSelected, setOwnSelected] = useState<ReadonlySet<string>>(() => new Set());
  const selection = selected ?? ownSelected;
  const setSelection = useCallback(
    (next: Set<string>) => {
      if (onSelectedChange) onSelectedChange(next);
      else setOwnSelected(next);
    },
    [onSelectedChange],
  );

  // Column widths/aligns are stable per preset array — passed to rows by
  // identity so the memo comparator can skip them with a reference check.
  const widths = useMemo(() => columns.map((c) => c.width), [columns]);
  const aligns = useMemo(() => columns.map((c) => c.align), [columns]);
  const totalWidth = useMemo(() => widths.reduce((a, b) => a + b, ROW_GUTTER_PX), [widths]);

  // TanStack column defs exist for sorting/row-model only — the presets, not
  // these, describe how a cell paints.
  const tableColumns = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.header,
        accessorFn: c.sortValue ? (row: T) => c.sortValue!(row) : () => null,
        enableSorting: !!c.sortValue,
        sortUndefined: "last",
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows as T[],
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const modelRows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: modelRows.length,
    getScrollElement: () => scrollRef.current,
    // Fixed heights: exact estimate, and measureElement deliberately unused.
    estimateSize: () => rowHeight,
    overscan,
  });

  // Shift-click range needs the anchor to survive re-renders but must never
  // trigger one — a ref, not state.
  const anchorRef = useRef<string | null>(null);

  const handleSelect = useCallback(
    (rowId: string, modifiers: { shift: boolean; meta: boolean }) => {
      const order = table.getRowModel().rows.map((r) => r.id);
      const next = new Set(selection);
      if (modifiers.shift && anchorRef.current) {
        // Range select over the CURRENT visual order, so a range taken after
        // sorting means what the user sees, not the original array order.
        const from = order.indexOf(anchorRef.current);
        const to = order.indexOf(rowId);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          for (let i = lo; i <= hi; i++) next.add(order[i]);
        }
      } else if (modifiers.meta) {
        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);
        anchorRef.current = rowId;
      } else {
        next.clear();
        next.add(rowId);
        anchorRef.current = rowId;
      }
      setSelection(next);
    },
    [selection, setSelection, table],
  );

  // Cells are computed per visible row only — the virtualizer decides how many
  // that is, so this is O(viewport), not O(rows).
  //
  // …and memoized by ROW IDENTITY. Without the cache every scroll frame rebuilt
  // ~9 cell objects for all ~22 visible rows, ~200 allocations a tick, only for
  // cellsEqual to conclude that almost none of them changed. With it, an
  // unchanged row hands back the SAME array, so TerminalRow's comparator
  // short-circuits on a pointer compare instead of walking every field.
  //
  // A WeakMap is the right structure: query data replaces row objects wholesale
  // on refetch, so a genuinely-changed row arrives as a new object and misses
  // the cache by construction — which is exactly the §8.3 memo-audit semantics,
  // not a coincidence. Entries for replaced rows are collectable immediately.
  const cellsCache = useRef(new WeakMap<object, CellRender[]>());
  useEffect(() => {
    // Column set changed → every cached row is stale.
    cellsCache.current = new WeakMap();
  }, [columns]);

  const cellsFor = useCallback(
    (row: T): CellRender[] => {
      const key = row as unknown as object;
      const hit = cellsCache.current.get(key);
      if (hit) return hit;
      const built = columns.map((c) => c.cell(row));
      cellsCache.current.set(key, built);
      return built;
    },
    [columns],
  );

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {/* Header — 1px border-subtle underline, no vertical gridlines. */}
      <div
        role="row"
        className="flex shrink-0 items-center border-b border-border-subtle bg-surface-2"
        // minWidth, not width: columns keep their fixed px (§8.1 — absolutely
        // positioned rows cannot take fractional widths), but the header and
        // row dividers still run the full width of the panel instead of
        // stopping short and leaving a ragged edge.
        style={{ height: headerHeight, minWidth: totalWidth }}
      >
        <span aria-hidden className="shrink-0" style={{ width: ROW_GUTTER_PX }} />
        {table.getHeaderGroups()[0]?.headers.map((header, i) => {
          const sortable = header.column.getCanSort();
          const dir = header.column.getIsSorted();
          return (
            <button
              key={header.id}
              type="button"
              disabled={!sortable}
              onClick={header.column.getToggleSortingHandler()}
              className={cn(
                "flex shrink-0 items-center gap-1 truncate px-2 text-[10px] font-medium uppercase tracking-wider",
                "text-text-muted transition-colors",
                sortable && "hover:text-text-primary",
                aligns[i] === "right" && "justify-end",
                dir && "text-text-primary",
              )}
              style={{ width: widths[i] }}
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
              {dir === "asc" && <ChevronUp className="h-2.5 w-2.5" />}
              {dir === "desc" && <ChevronDown className="h-2.5 w-2.5" />}
            </button>
          );
        })}
      </div>

      {modelRows.length === 0 ? (
        <div className="min-h-0 flex-1">{empty}</div>
      ) : (
        <div
          ref={scrollRef}
          className={cn("overflow-auto", maxBodyHeight === undefined && "min-h-0 flex-1")}
          style={maxBodyHeight === undefined ? undefined : { maxHeight: maxBodyHeight }}
          data-testid="terminal-table-scroll"
        >
          <div
            className="relative"
            style={{ height: virtualizer.getTotalSize(), minWidth: totalWidth }}
          >
            <PerfProfiler id="terminal-table-rows">
              {virtualRows.map((v) => {
                const row = modelRows[v.index];
                return (
                  <TerminalRow
                    key={row.id}
                    rowId={row.id}
                    cells={cellsFor(row.original)}
                    widths={widths}
                    aligns={aligns}
                    isSelected={selection.has(row.id)}
                    height={rowHeight}
                    start={v.start}
                    onSelect={handleSelect}
                  />
                );
              })}
            </PerfProfiler>
          </div>
        </div>
      )}
    </div>
  );
}
