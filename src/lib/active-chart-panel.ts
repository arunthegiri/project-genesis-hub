/**
 * Active chart panel signal (build doc §17).
 *
 * The command palette is global, but a symbol jump has to land SOMEWHERE.
 * Each ChartPanel registers a setSymbol handler here on mount and marks
 * itself active on pointer interaction; the palette applies symbol picks to
 * the active panel. When no panel exists (any other route), the pick is
 * stashed as a pending symbol and the palette navigates to "/", where the
 * charts page consumes it through its normal fill-first-empty-panel path.
 *
 * Module-level by design — same pattern as the §7 interaction store family,
 * no React context threading through the root layout.
 */

export interface ChartPanelHandle {
  setSymbol: (symbol: string) => void;
}

const panels = new Map<string, ChartPanelHandle>();
let activeKey: string | null = null;

/** Register a panel's handle; the first registered panel becomes active. */
export function registerChartPanel(key: string, handle: ChartPanelHandle): () => void {
  panels.set(key, handle);
  if (activeKey === null) activeKey = key;
  return () => {
    panels.delete(key);
    if (activeKey === key) {
      activeKey = panels.keys().next().value ?? null;
    }
  };
}

/** Mark a panel active (called on pointerdown within the panel). */
export function setActiveChartPanel(key: string): void {
  if (panels.has(key)) activeKey = key;
}

/** The panel a palette symbol jump should apply to, or null off "/". */
export function getActiveChartPanel(): ChartPanelHandle | null {
  if (activeKey && panels.has(activeKey)) return panels.get(activeKey)!;
  const first = panels.values().next().value;
  return first ?? null;
}

// ── Pending symbol — hand-off to the charts page when no panel exists ───────

let pendingSymbol: string | null = null;

export function setPendingSymbol(symbol: string): void {
  pendingSymbol = symbol;
}

/** Read-and-clear; the charts page calls this once on mount. */
export function takePendingSymbol(): string | null {
  const s = pendingSymbol;
  pendingSymbol = null;
  return s;
}
