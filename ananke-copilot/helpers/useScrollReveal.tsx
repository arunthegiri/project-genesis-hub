import { useCallback, useEffect, useRef } from "react";

interface Options {
  threshold?: number;
  rootMargin?: string;
  /** Selector for the items to reveal, matched against each container's subtree. */
  selector?: string;
}

const REVEALED_ATTR = "data-revealed";

function reveal(el: Element) {
  el.setAttribute(REVEALED_ATTR, "true");
}

/**
 * Returns a ref callback that may be attached to any number of containers. Every
 * descendant matching `selector` starts at `opacity: 0` and is marked
 * `data-revealed="true"` once it scrolls into view; anything already on screen at
 * mount is revealed on the observer's first callback.
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>({
  threshold = 0.1,
  rootMargin = "0px",
  selector = "[data-reveal]",
}: Options = {}) {
  const containers = useRef(new Set<T>());
  const observerRef = useRef<IntersectionObserver | null>(null);

  const observeContainer = useCallback(
    (container: T) => {
      const observer = observerRef.current;
      if (!observer) return;
      container.querySelectorAll(selector).forEach((el) => observer.observe(el));
    },
    [selector],
  );

  useEffect(() => {
    // Respect reduced-motion: show everything, animate nothing.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      containers.current.forEach((container) => {
        container.querySelectorAll(selector).forEach(reveal);
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target);
          observer.unobserve(entry.target);
        }
      },
      { threshold, rootMargin },
    );
    observerRef.current = observer;

    // Containers attach during commit, before this effect runs, so pick up
    // everything registered so far. This also covers StrictMode's simulated
    // remount, where the effect re-runs but the ref callbacks do not.
    containers.current.forEach(observeContainer);

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [threshold, rootMargin, selector, observeContainer]);

  return useCallback(
    (node: T | null) => {
      if (node) {
        containers.current.add(node);
        observeContainer(node);
        return;
      }
      // React reports detachment as a bare null, so drop whatever left the DOM.
      containers.current.forEach((el) => {
        if (!el.isConnected) containers.current.delete(el);
      });
    },
    [observeContainer],
  );
}
