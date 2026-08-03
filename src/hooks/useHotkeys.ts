import { useEffect, useRef, type RefObject } from "react";

import type { Interval } from "@/lib/api/types";
import { isPaletteOpen, openPalette, pushScope, topScope } from "@/lib/command-registry";

/**
 * Chart-surface hotkeys (build doc §17, research §G.2).
 *
 * keydown listener on the chart container (which is tabIndex={0} and takes
 * focus on click / symbol load). SCOPED three ways:
 *   1. the palette scope stack — inert unless this chart's scope is on top
 *      (the palette pushes its own scope while open);
 *   2. activeElement guard — inert when an input/textarea/select or any
 *      contentEditable has focus;
 *   3. reserved-key denylist — Space, Esc, Tab, Enter, F-keys, bare modifiers.
 *
 * Key map:
 *   1 / 5 / 15   → interval 1m / 5m / 15m ("1" applies 1m immediately, a "5"
 *                  within 700ms upgrades to 15m — TradingView compose)
 *   Shift+H / Shift+D → interval 1h / 1d
 *   Shift+R      → viewport reset (the §5 explicit 'fit' transition)
 *   Shift+V      → volume toggle
 *   ArrowLeft/Right → step one bar (anchors the viewport, like a pan)
 *   /            → palette pre-filtered to Indicators
 *   any other bare letter → palette in symbol mode with the letter typed
 *
 * Letter COMMANDS require Shift so plain letters always reach symbol search —
 * the chart surface has no text inputs, so a bare "n v d a" builds "nvda" in
 * the palette (and Visa stays searchable despite V being the volume key).
 */

export interface ChartHotkeyHandlers {
  /** Interval pick — must go through the §5 pin path (handleIntervalSelect). */
  onInterval: (interval: Interval) => void;
  /** Viewport reset — the §5 'fit' transition. */
  onResetViewport: () => void;
  onToggleVolume: () => void;
  /** Step the visible range one bar left/right (implemented by the chart). */
  onStep: (dir: 1 | -1) => void;
}

interface Options {
  /** Fired once per hotkey use — lets the chart fade its footer hint line. */
  onUse?: () => void;
}

const DENYLIST = new Set([
  " ",
  "Spacebar",
  "Escape",
  "Tab",
  "Enter",
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
]);

const COMPOSE_WINDOW_MS = 700;
let scopeSeq = 0;

function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el as HTMLElement).isContentEditable
  );
}

export function useChartHotkeys(
  containerRef: RefObject<HTMLElement | null>,
  handlers: ChartHotkeyHandlers,
  opts?: Options,
): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);
  const onUseRef = useRef(opts?.onUse);
  useEffect(() => {
    onUseRef.current = opts?.onUse;
  }, [opts?.onUse]);

  // One scope id per hook instance — stable across renders.
  const scopeRef = useRef<string>("");
  if (!scopeRef.current) scopeRef.current = `chart-hotkeys:${++scopeSeq}`;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const scope = scopeRef.current;

    const onFocus = () => pushScope(scope);
    let popScope: (() => void) | null = null;
    const handleFocus = () => {
      popScope = onFocus();
    };
    const handleBlur = () => {
      popScope?.();
      popScope = null;
    };

    // If the container is already focused when the effect attaches (e.g. the
    // symbol-load focus landed first), adopt the scope immediately.
    if (document.activeElement === el) handleFocus();

    // "1" then "5" within the compose window → 15m instead of 1m then 5m.
    let composeTimer: ReturnType<typeof setTimeout> | null = null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isPaletteOpen()) return;
      if (topScope() !== scope) return;
      if (isEditableTarget(document.activeElement)) return;
      if (DENYLIST.has(e.key)) return;
      // Bare keys only — no Ctrl/Meta/Alt chords here (⌘K is global, in root).
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const h = handlersRef.current;
      const used = () => onUseRef.current?.();

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        h.onStep(e.key === "ArrowRight" ? 1 : -1);
        used();
        return;
      }

      if (e.key === "1" || e.key === "5") {
        e.preventDefault();
        if (e.key === "5" && composeTimer) {
          clearTimeout(composeTimer);
          composeTimer = null;
          h.onInterval("15Min");
        } else {
          h.onInterval(e.key === "1" ? "1Min" : "5Min");
          if (e.key === "1") {
            composeTimer = setTimeout(() => {
              composeTimer = null;
            }, COMPOSE_WINDOW_MS);
          }
        }
        used();
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        openPalette({ category: "Indicators" });
        used();
        return;
      }

      // Reserved letter commands — Shift required (uppercase in the spec).
      if (e.shiftKey) {
        const k = e.key.toUpperCase();
        if (k === "H") {
          e.preventDefault();
          h.onInterval("1Hour");
          used();
          return;
        }
        if (k === "D") {
          e.preventDefault();
          h.onInterval("1Day");
          used();
          return;
        }
        if (k === "R") {
          e.preventDefault();
          h.onResetViewport();
          used();
          return;
        }
        if (k === "V") {
          e.preventDefault();
          h.onToggleVolume();
          used();
          return;
        }
        return;
      }

      // Any other bare letter → palette in symbol mode, letter pre-typed.
      if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        openPalette({ query: e.key });
        used();
      }
    };

    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("focus", handleFocus);
    el.addEventListener("blur", handleBlur);
    return () => {
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("focus", handleFocus);
      el.removeEventListener("blur", handleBlur);
      handleBlur();
      if (composeTimer) clearTimeout(composeTimer);
    };
  }, [containerRef]);
}
