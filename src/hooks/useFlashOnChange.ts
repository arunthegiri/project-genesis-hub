import { useEffect, useRef, type RefObject } from "react";

const FLASH_CLASSES = ["flash-up-a", "flash-up-b", "flash-down-a", "flash-down-b"];

/**
 * Flash-on-change (build doc §14.3) — attach the returned ref to the element
 * that should wash green/red when its number moves.
 *
 * Why an effect and a classList write rather than a class computed in render:
 * the "did it change" test needs the PREVIOUS value, and keeping that in a ref
 * mutated during render is not idempotent — React's dev double-render sets the
 * ref on pass 1 and then sees no change on pass 2, so the flash silently never
 * appears (it did exactly that before this hook existed). An effect runs once
 * per committed value, which is precisely the cardinality of "the price moved".
 *
 * The class alternates `-a`/`-b` because both variants are bound to different
 * keyframe names: an element whose computed animation-name is unchanged
 * CONTINUES its running animation instead of restarting, so a single class
 * flashes once and then goes quiet under a fast feed. Alternating restarts it
 * without the remove/read-offsetWidth/re-add trick, which would force a
 * synchronous layout on the hot path.
 */
export function useFlashOnChange<T extends HTMLElement>(value: number | null): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const prevRef = useRef<number | null>(null);
  const flipRef = useRef(false);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    const el = ref.current;
    if (!el || prev === null || value === null || value === prev) return;
    flipRef.current = !flipRef.current;
    el.classList.remove(...FLASH_CLASSES);
    el.classList.add(`flash-${value > prev ? "up" : "down"}-${flipRef.current ? "a" : "b"}`);
  }, [value]);

  return ref;
}
