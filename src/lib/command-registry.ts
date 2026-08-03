import { useSyncExternalStore } from "react";

/**
 * Decentralized command registry + palette controller (build doc §17).
 *
 * Feature components register their commands on mount and unregister on
 * cleanup via registerCommands(). IDs are STABLE across label changes so the
 * recents list (last 8 executed IDs, localStorage) keeps pointing at real
 * commands after e.g. a panel's symbol changes its labels.
 *
 * The palette open/close state and the hotkey scope stack also live here so
 * the root route, the chart hotkeys, and the palette share one source of
 * truth without prop threading. Everything is SSR-safe: module state only,
 * DOM/localStorage access behind guards or effects.
 */

export interface CommandSpec {
  /** Stable ID — recents store these, so never derive from the label. */
  id: string;
  label: string;
  keywords: string[];
  category: string;
  /** Display-only hint rendered on the right of the row (e.g. "R", "⌘K"). */
  shortcut?: string;
  action: () => void;
}

// ── Registry ────────────────────────────────────────────────────────────────

const registry = new Map<string, CommandSpec>();
const listeners = new Set<() => void>();
let snapshot: CommandSpec[] = [];

function emit() {
  snapshot = Array.from(registry.values());
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Register a batch of commands; returns the unregister cleanup. */
export function registerCommands(cmds: CommandSpec[]): () => void {
  cmds.forEach((c) => registry.set(c.id, c));
  emit();
  return () => {
    cmds.forEach((c) => registry.delete(c.id));
    emit();
  };
}

export function getCommand(id: string): CommandSpec | undefined {
  return registry.get(id);
}

const EMPTY: CommandSpec[] = [];

export function useCommands(): CommandSpec[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
}

// ── Recents — last 8 executed IDs, pinned atop an empty query ───────────────

const RECENTS_KEY = "ananke.cmd.recents";
const RECENTS_MAX = 8;

export function getRecentIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function recordRecent(id: string): void {
  if (typeof window === "undefined") return;
  const next = [id, ...getRecentIds().filter((x) => x !== id)].slice(0, RECENTS_MAX);
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // storage full / private mode — recents are best-effort
  }
}

// ── Palette open state + launch options ─────────────────────────────────────

export interface PaletteState {
  open: boolean;
  /** Seed for the input (a bare letter typed on the chart, TradingView-style). */
  query: string;
  /** Category pre-filter ("/" on the chart opens the palette on Indicators). */
  category: string | null;
}

let paletteState: PaletteState = { open: false, query: "", category: null };
const PALETTE_CLOSED: PaletteState = { open: false, query: "", category: null };

function emitPalette() {
  listeners.forEach((l) => l());
}

export function openPalette(opts: { query?: string; category?: string } = {}) {
  paletteState = { open: true, query: opts.query ?? "", category: opts.category ?? null };
  emitPalette();
}

export function closePalette() {
  paletteState = PALETTE_CLOSED;
  emitPalette();
}

export function togglePalette() {
  if (paletteState.open) closePalette();
  else openPalette();
}

export function isPaletteOpen(): boolean {
  return paletteState.open;
}

export function usePaletteState(): PaletteState {
  return useSyncExternalStore(
    subscribe,
    () => paletteState,
    () => PALETTE_CLOSED,
  );
}

// ── Hotkey scope stack (§17) ────────────────────────────────────────────────
// The chart container pushes its scope while focused; the palette pushes
// "palette" while open. Chart hotkeys fire only when their own scope is on
// top, which keeps them inert while the palette (or anything else) owns keys.

const scopeStack: string[] = [];

export function pushScope(id: string): () => void {
  scopeStack.push(id);
  return () => {
    const i = scopeStack.lastIndexOf(id);
    if (i !== -1) scopeStack.splice(i, 1);
  };
}

export function topScope(): string | null {
  return scopeStack.length ? scopeStack[scopeStack.length - 1] : null;
}
