/**
 * Module-scope rAF coalescer for the realtime hot path (build doc §14.2).
 *
 * Same semantics as the §7 `useRafCoalescer` hook — latest-value-wins, at most
 * one flush per frame, never drops the final value — but hoisted out of React
 * because the transport handler is not a component and must never call
 * setState (working agreement §1.4).
 *
 * One frame callback serves every registered flusher, so N symbol stores
 * updating in the same frame cost one rAF, not N. rAF also self-throttles in
 * background tabs, which is the desired behaviour: a hidden tab stops paying
 * for a stream nobody is looking at, and the next visible frame flushes the
 * latest value rather than replaying the backlog.
 */

type Flusher = () => void;

const pending = new Set<Flusher>();
let frame = 0;

function runFrame() {
  frame = 0;
  // Snapshot before running: a flusher may schedule another flush (a store
  // notifying a subscriber that writes again), and that belongs to the NEXT
  // frame — otherwise a feedback loop would spin inside one callback.
  const batch = [...pending];
  pending.clear();
  for (const flush of batch) flush();
}

/** Queue `flush` for the next frame. Repeat calls in one frame collapse. */
export function scheduleFlush(flush: Flusher): void {
  pending.add(flush);
  if (frame) return;
  // No rAF outside the browser (SSR) — flushing is a client-only concern and
  // there is no paint to align to.
  if (typeof requestAnimationFrame === "undefined") return;
  frame = requestAnimationFrame(runFrame);
}

/**
 * Run every pending flusher immediately. Tests only — the mock feed and the
 * §14 Playwright specs need deterministic delivery without waiting on paint.
 */
export function flushPending(): void {
  if (frame && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(frame);
  runFrame();
}
