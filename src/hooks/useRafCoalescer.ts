import { useCallback, useEffect, useRef } from "react";

/**
 * rAF coalescer (build doc §7): each push stores the latest value and
 * schedules at most one requestAnimationFrame; the frame callback flushes the
 * latest value. Never drops the final value (unlike throttle), never delays
 * it (unlike debounce). Used for the auto-interval trigger, legend DOM
 * writes, and the replay pump.
 */
export function useRafCoalescer<T>(flush: (value: T) => void): (value: T) => void {
  const latestRef  = useRef<T>(undefined as T);
  const tickingRef = useRef(false);
  const rafRef     = useRef(0);
  const flushRef   = useRef(flush);
  useEffect(() => { flushRef.current = flush; });

  useEffect(() => () => {
    tickingRef.current = false;
    cancelAnimationFrame(rafRef.current);
  }, []);

  return useCallback((value: T) => {
    latestRef.current = value;
    if (tickingRef.current) return;
    tickingRef.current = true;
    rafRef.current = requestAnimationFrame(() => {
      tickingRef.current = false;
      flushRef.current(latestRef.current);
    });
  }, []);
}
