import { useEffect, useRef } from "react";

interface Options {
  threshold?: number;
  rootMargin?: string;
  /** Class toggled on each observed child once it enters the viewport. */
  revealClass?: string;
}

/**
 * Returns a ref for a container whose direct children fade in as they scroll
 * into view. Children start at `opacity: 0` and are released one at a time;
 * anything already on screen at mount is revealed immediately.
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>({
  threshold = 0.1,
  rootMargin = "0px",
  revealClass = "is-revealed",
}: Options = {}) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const targets = Array.from(root.children) as HTMLElement[];
    if (targets.length === 0) return;

    // Respect reduced-motion: show everything, animate nothing.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      targets.forEach((el) => el.classList.add(revealClass));
      return;
    }

    targets.forEach((el) => el.classList.add("scroll-reveal"));

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add(revealClass);
          observer.unobserve(entry.target);
        }
      },
      { threshold, rootMargin },
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [threshold, rootMargin, revealClass]);

  return ref;
}
