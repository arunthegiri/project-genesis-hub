/**
 * Dev-only long-animation-frame (LoAF) instrumentation — the "ruler" every
 * perf section in the build doc measures against.
 *
 * Enabled only when BOTH conditions hold:
 *   1. `import.meta.env.DEV` (never in production builds)
 *   2. the URL contains `?perf=1`
 *
 * Chromium-only API — everything is feature-detected and silently no-ops
 * elsewhere. Logs each long frame ({ duration, scripts }) to the console and
 * renders a tiny fixed-position HUD with the running count, the worst frame,
 * and the last offending script.
 */

interface LoafScript {
  name?: string;
  duration?: number;
}

interface LoafEntry extends PerformanceEntry {
  duration: number;
  scripts?: LoafScript[];
}

const state = {
  count: 0,
  worstMs: 0,
  lastOffender: "—",
};

function isEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("perf") === "1";
}

function mountHud(): () => void {
  const hud = document.createElement("div");
  // EXEMPT from the §3.3 literal-color sweep (build doc W1): this HUD is a
  // dev-only (?perf=1) perf overlay, not product UI — its raw hex literals
  // are intentional and it is the one allowed grep hit under src/.
  hud.style.cssText = [
    "position:fixed",
    "bottom:8px",
    "left:8px",
    "z-index:99999",
    "padding:4px 8px",
    "font:11px/1.4 ui-monospace,monospace",
    "color:#e2e4e9",
    "background:rgba(10,12,16,0.85)",
    "border:1px solid #333",
    "border-radius:4px",
    "pointer-events:none",
    "white-space:pre",
  ].join(";");
  document.body.appendChild(hud);

  const render = () => {
    hud.textContent = `LoAF ${state.count} · worst ${state.worstMs.toFixed(0)}ms · ${state.lastOffender}`;
  };
  render();

  return (() => {
    const interval = window.setInterval(render, 500);
    return () => {
      window.clearInterval(interval);
      hud.remove();
    };
  })();
}

/** Start observing long animation frames. Returns a teardown function. */
export function startLoafInstrumentation(): () => void {
  if (!isEnabled()) return () => {};
  if (typeof PerformanceObserver === "undefined") return () => {};
  if (!PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) {
    console.info("[perf] long-animation-frame not supported in this browser");
    return () => {};
  }

  const teardownHud = mountHud();

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as LoafEntry[]) {
      state.count += 1;
      state.worstMs = Math.max(state.worstMs, entry.duration);
      const scripts = (entry.scripts ?? []).map((s) => ({
        name: s.name ?? "anonymous",
        duration: Math.round(s.duration ?? 0),
      }));
      const top = scripts.sort((a, b) => b.duration - a.duration)[0];
      if (top) state.lastOffender = top.name.split("/").pop() ?? top.name;
      console.info("[perf] LoAF", {
        duration: Math.round(entry.duration),
        scripts,
      });
    }
  });

  try {
    observer.observe({ type: "long-animation-frame", buffered: false });
  } catch {
    console.info("[perf] failed to observe long-animation-frame");
    teardownHud();
    return () => {};
  }

  return () => {
    observer.disconnect();
    teardownHud();
  };
}
