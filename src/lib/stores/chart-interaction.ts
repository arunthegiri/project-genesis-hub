/**
 * Chart interaction store (build doc §7) — the four-channel rule:
 *   data      → setData/update (chart series)
 *   viewport  → time-scale API + THIS store
 *   crosshair → store / DOM writes
 *   UI chrome → React state
 *
 * High-frequency interaction state (visible range at drag frame rate,
 * crosshair at mousemove rate) lives here instead of React state, so panning
 * never re-renders the panel. Consumers select a stable slice with
 * useSyncExternalStore — the snapshot object is only replaced on change, so
 * Object.is holds between unchanged sets.
 */

export type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ChartInteraction = {
  /** Visible logical range (bar indices); null before the first layout. */
  visibleRange: { from: number; to: number } | null;
  /** Crosshair time; null = pointer left the chart. */
  crosshair: { time: number | null } | null;
  lastBar: Bar | null;
};

export interface InteractionStore {
  getSnapshot: () => ChartInteraction;
  subscribe: (listener: () => void) => () => void;
  set: (partial: Partial<ChartInteraction>) => void;
}

export function createInteractionStore(initial?: Partial<ChartInteraction>): InteractionStore {
  let snapshot: ChartInteraction = { visibleRange: null, crosshair: null, lastBar: null, ...initial };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    set(partial) {
      snapshot = { ...snapshot, ...partial };
      listeners.forEach((l) => l());
    },
  };
}
