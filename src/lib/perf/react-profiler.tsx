import { Profiler, type ReactNode } from "react";

/**
 * Dev-only React commit instrumentation — the measuring stick for the §8.3
 * "≤ 8 ms React work per scroll tick" budget, and the companion to the LoAF
 * ruler in ./loaf.ts (LoAF only surfaces frames over ~50 ms, so it cannot see
 * an 8 ms budget being blown at 9 ms).
 *
 * Enabled only when BOTH hold, exactly like the LoAF instrumentation:
 *   1. `import.meta.env.DEV`
 *   2. the URL contains `?perf=1`
 *
 * `import.meta.env.DEV` is statically replaced at build time, so the whole
 * Profiler tree — and the `window.__perfCommits` buffer — is dead code in a
 * production bundle rather than a runtime branch.
 */

export interface PerfCommit {
  id: string;
  phase: "mount" | "update" | "nested-update";
  /** ms React spent rendering the committed update — the budgeted number. */
  actualDuration: number;
  /** ms the same work would take with no memoization at all (the baseline). */
  baseDuration: number;
  commitTime: number;
}

declare global {
  interface Window {
    __perfCommits?: PerfCommit[];
  }
}

function enabled(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("perf") === "1";
}

/**
 * Wrap a subtree to record its commits. Renders children untouched (no extra
 * DOM, no extra context) when instrumentation is off.
 */
export function PerfProfiler({ id, children }: { id: string; children: ReactNode }) {
  if (!enabled()) return <>{children}</>;
  return (
    <Profiler
      id={id}
      onRender={(profilerId, phase, actualDuration, baseDuration, _start, commitTime) => {
        const buf = (window.__perfCommits ??= []);
        buf.push({ id: profilerId, phase, actualDuration, baseDuration, commitTime });
        // Bounded: a fast scroll can emit thousands of commits and the buffer
        // must not become the thing that makes the page slow.
        if (buf.length > 5000) buf.splice(0, buf.length - 5000);
      }}
    >
      {children}
    </Profiler>
  );
}
