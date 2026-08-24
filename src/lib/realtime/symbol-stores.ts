import { scheduleFlush } from "./coalesce";

/**
 * Per-symbol external stores (build doc §14.2, plan §5.6).
 *
 * The hot path in one sentence: the transport writes prices in here, cells
 * subscribe to the ONE symbol they render, and React sees at most one commit
 * per frame per changed cell. TanStack Query never sees a stream message —
 * it stays the cold path (working agreement §1.4), and the only place the two
 * meet is `seed()`, where a REST snapshot initialises a symbol before deltas
 * start arriving.
 *
 * Why a store per symbol rather than one store with a map: `useSyncExternalStore`
 * re-runs `getSnapshot` for every subscriber on every notification. With one
 * shared store, a NVDA tick would wake every mounted cell in the app to
 * conclude that nothing of theirs changed. Per-symbol stores make that
 * fan-out structural instead of conventional.
 */

export interface CellSnapshot {
  /** Latest traded/close price. null until seeded. */
  last: number | null;
  /** The value `last` replaced — the flash direction, not a session reference. */
  prev: number | null;
  /** Session reference for change %, from the cold snapshot (previous close). */
  prevClose: number | null;
  /** Epoch ms of the newest write. 0 = never written. */
  ts: number;
  /** Where this value came from — the ticker labels a cold value differently. */
  source: "none" | "cold" | "hot";
}

const EMPTY: CellSnapshot = { last: null, prev: null, prevClose: null, ts: 0, source: "none" };

interface Cell {
  snapshot: CellSnapshot;
  /** Staged write, applied on the next frame. Latest-value-wins. */
  staged: { last: number; ts: number } | null;
  listeners: Set<() => void>;
  flush: () => void;
  /**
   * Per-symbol subscribe function, created once. useSyncExternalStore
   * re-subscribes whenever this identity changes, so handing back a fresh
   * closure per call would tear down and rebuild the subscription on every
   * render of every live cell.
   */
  subscribe: (listener: () => void) => () => void;
}

const cells = new Map<string, Cell>();

function cellFor(symbol: string): Cell {
  const cell = cells.get(symbol);
  if (cell) return cell;
  const created: Cell = {
    snapshot: EMPTY,
    staged: null,
    listeners: new Set(),
    subscribe: (listener) => {
      created.listeners.add(listener);
      return () => {
        created.listeners.delete(listener);
      };
    },
    flush: () => {
      const staged = created.staged;
      created.staged = null;
      if (!staged) return;
      const prevSnapshot = created.snapshot;
      if (staged.last === prevSnapshot.last) return; // no visible change
      created.snapshot = {
        last: staged.last,
        prev: prevSnapshot.last,
        prevClose: prevSnapshot.prevClose,
        ts: staged.ts,
        source: "hot",
      };
      created.listeners.forEach((l) => l());
    },
  };
  cells.set(symbol, created);
  return created;
}

/**
 * Hot write. Never notifies synchronously — the value is staged and flushed
 * once on the next frame, so a burst of 20 messages for one symbol produces
 * one React commit, not 20.
 */
export function applyQuote(symbol: string, last: number, ts = Date.now()): void {
  if (!Number.isFinite(last)) return;
  const cell = cellFor(symbol);
  cell.staged = { last, ts };
  scheduleFlush(cell.flush);
}

/**
 * Cold seed from a REST snapshot (build doc §14.2: "snapshot-then-delta").
 * Applied synchronously — it runs from a query effect, not from the transport,
 * so it is already outside the per-frame budget — and it never overwrites a
 * hot value with a staler polled one.
 */
export function seedQuote(
  symbol: string,
  values: { last: number | null; prevClose: number | null },
  ts = Date.now(),
): void {
  const cell = cellFor(symbol);
  const prevSnapshot = cell.snapshot;
  if (prevSnapshot.source === "hot" && values.last !== null) {
    // A live stream owns `last`; the seed may still refresh the session
    // reference (previous close changes once a day, and only via REST).
    if (values.prevClose === prevSnapshot.prevClose) return;
    cell.snapshot = { ...prevSnapshot, prevClose: values.prevClose };
    cell.listeners.forEach((l) => l());
    return;
  }
  if (values.last === prevSnapshot.last && values.prevClose === prevSnapshot.prevClose) return;
  cell.snapshot = {
    last: values.last,
    prev: prevSnapshot.last,
    prevClose: values.prevClose,
    ts,
    source: values.last === null ? "none" : "cold",
  };
  cell.listeners.forEach((l) => l());
}

/**
 * The subscribe function for one symbol — stable across calls, so a component
 * can pass `subscribeQuote(symbol)` straight into useSyncExternalStore without
 * memoising it first.
 */
export function subscribeQuote(symbol: string): (listener: () => void) => () => void {
  return cellFor(symbol).subscribe;
}

/**
 * Current snapshot for a symbol. The object identity only changes when a
 * field changed, which is what keeps `useSyncExternalStore`'s Object.is check
 * from tearing or looping.
 */
export function getQuote(symbol: string): CellSnapshot {
  return cells.get(symbol)?.snapshot ?? EMPTY;
}

/** SSR snapshot — always the empty cell, so server and client first paint agree. */
export function getServerQuote(): CellSnapshot {
  return EMPTY;
}

/** Symbols the store knows about. The mock feed walks these. */
export function knownSymbols(): string[] {
  return [...cells.keys()];
}

/** Test seam: drop everything. Never called by app code. */
export function resetQuotes(): void {
  cells.clear();
}
