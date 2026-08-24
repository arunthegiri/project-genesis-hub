import type { Interval } from "../api/types";

/**
 * Last-bar registry (build doc §15) — how the status rail learns each active
 * symbol's newest bar without knowing anything about ChartPanel internals.
 *
 * Each mounted ChartPanel mirrors its §7 interaction store's `lastBar` here
 * (keyed by panel instance), and unregisters on unmount. The rail subscribes
 * and reads a per-symbol merge (freshest bar wins when two panels share a
 * symbol). Same hand-rolled store pattern as chart-interaction.ts: the
 * snapshot is cached and only replaced when an entry actually changes, so
 * useSyncExternalStore's Object.is check holds between unrelated renders.
 */

export interface RailBarInfo {
  symbol: string;
  interval: Interval;
  /** Bar bucket start, epoch SECONDS (same unit as the §7 Bar). */
  timeSec: number;
  /** Last close (§14.1 — the ticker tape prints this). */
  close: number;
  /** Previous-session close, the change reference. null when unknowable. */
  prevClose: number | null;
}

const byPanel = new Map<string, RailBarInfo>();
const listeners = new Set<() => void>();

let snapshot: RailBarInfo[] = [];

function rebuild() {
  const bySymbol = new Map<string, RailBarInfo>();
  for (const info of byPanel.values()) {
    const existing = bySymbol.get(info.symbol);
    if (!existing || info.timeSec > existing.timeSec) bySymbol.set(info.symbol, info);
  }
  snapshot = [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  listeners.forEach((l) => l());
}

/** Publish (or clear, with null) a panel's last-bar info. */
export function setPanelLastBar(panelId: string, info: RailBarInfo | null): void {
  if (info === null) {
    if (!byPanel.delete(panelId)) return;
  } else {
    const prev = byPanel.get(panelId);
    if (
      prev &&
      prev.symbol === info.symbol &&
      prev.interval === info.interval &&
      prev.timeSec === info.timeSec &&
      prev.close === info.close &&
      prev.prevClose === info.prevClose
    )
      return;
    byPanel.set(panelId, info);
  }
  rebuild();
}

export function subscribeRailBars(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRailBarsSnapshot(): RailBarInfo[] {
  return snapshot;
}
