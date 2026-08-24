import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { fmtPct, fmtPrice } from "@/lib/format";
import { getQuote, getServerQuote, subscribeQuote } from "@/lib/realtime/symbol-stores";
import type { TickerItem } from "@/hooks/useTickerItems";
import { useFlashOnChange } from "@/hooks/useFlashOnChange";
import { cn } from "@/lib/utils";

/**
 * Ticker tape (build doc §14.1, plan §3.3) — the flexible middle of the status
 * rail.
 *
 * Motion: the track content is rendered TWICE inside a wrapper animated
 * `translateX(0 → -50%)`. At -50% copy 2 sits exactly where copy 1 started, so
 * the loop is seamless and the whole thing is one compositor-only transform —
 * no layout, no paint, no JS per frame. Speed is content-independent: the
 * duration is computed once from the measured width of a single copy at
 * TICKER_PX_PER_SEC. Hover pauses via one CSS rule; reduced-motion drops the
 * animation and leaves a scrollable strip.
 *
 * Data: each item subscribes to its OWN symbol store, so a NVDA tick re-renders
 * one leaf — the list, the rail, and every other item are untouched. The
 * flash rides that same render (see TickerCell) rather than an effect.
 */

const TICKER_PX_PER_SEC = 60;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * One item. The ONLY component in the app that re-renders at stream rate, and
 * it renders three spans.
 *
 * Flash-on-change (§14.3): the direction class alternates between an `-a` and
 * `-b` variant on every change. Both variants are identical CSS bound to
 * DIFFERENT keyframe names on purpose — per the animations spec an element
 * whose computed `animation-name` is unchanged CONTINUES its running
 * animation instead of restarting it, so a single class would flash once and
 * then sit still under a fast feed. Alternating avoids the usual
 * remove-class/read-offsetWidth/add-class trick, which forces a synchronous
 * layout on the hot path — precisely what §14 says never to do.
 */
const TickerCell = memo(function TickerCell({ item }: { item: TickerItem }) {
  const quote = useSyncExternalStore(
    subscribeQuote(item.symbol),
    () => getQuote(item.symbol),
    getServerQuote,
  );

  const last = quote.last ?? item.last;
  const prevClose = quote.prevClose ?? item.prevClose;
  const change = last !== null && prevClose !== null ? last - prevClose : null;
  const changePct = change !== null && prevClose ? (change / prevClose) * 100 : null;
  const flashRef = useFlashOnChange<HTMLSpanElement>(last);

  const dir = change === null || change === 0 ? "flat" : change > 0 ? "up" : "down";

  return (
    <span
      ref={flashRef}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[2px] px-2"
      data-testid="ticker-item"
      title={item.origin === "position" ? `${item.symbol} — open position` : item.symbol}
    >
      <span className="font-semibold text-text-primary">{item.symbol}</span>
      <span className="tabular text-text-secondary">{last === null ? "—" : fmtPrice(last)}</span>
      <span
        className={cn(
          "tabular",
          dir === "up" && "text-bull",
          dir === "down" && "text-bear",
          dir === "flat" && "text-dir-flat",
        )}
      >
        {changePct === null ? "—" : fmtPct(changePct)}
      </span>
    </span>
  );
});

export function TickerTape({ items, className }: { items: TickerItem[]; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const copyRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // Measure once per content change (ResizeObserver callback — never per
  // frame) and write the duration as a custom property, so the animation
  // itself stays declarative and the JS never touches transform.
  useLayoutEffect(() => {
    const copy = copyRef.current;
    const track = trackRef.current;
    if (!copy || !track) return;
    const apply = () => {
      const width = copy.getBoundingClientRect().width;
      if (width <= 0) return;
      track.style.setProperty("--ticker-duration", `${Math.max(8, width / TICKER_PX_PER_SEC)}s`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(copy);
    return () => ro.disconnect();
  }, [items.length]);

  if (items.length === 0) return <span className={cn("flex-1", className)} />;

  const copy = (ref?: React.Ref<HTMLSpanElement>, ariaHidden?: boolean) => (
    <span ref={ref} aria-hidden={ariaHidden} className="flex items-center gap-1">
      {items.map((item) => (
        <TickerCell key={item.symbol} item={item} />
      ))}
    </span>
  );

  return (
    <div
      data-testid="ticker"
      className={cn(
        "ticker min-w-0 flex-1 overflow-hidden",
        reduced && "overflow-x-auto",
        className,
      )}
    >
      <div ref={trackRef} className={cn("flex w-max items-center", !reduced && "ticker-track")}>
        {copy(copyRef)}
        {/* Second copy: the seamless half of the -50% loop. Hidden from a11y —
            it is the same data twice. Omitted under reduced motion, where the
            strip scrolls manually and a duplicate would be confusing. */}
        {!reduced && copy(undefined, true)}
      </div>
    </div>
  );
}
