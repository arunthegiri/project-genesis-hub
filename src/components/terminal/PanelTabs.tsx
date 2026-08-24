import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface PanelTab {
  id: string;
  label: string;
  count?: number;
}

interface PanelTabsProps {
  tabs: PanelTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  className?: string;
}

/**
 * PanelTabs (build doc §4.1, variant 1) — structural raised tabs for a
 * TerminalPanel header strip. 36px tabs, 13px medium labels, text-secondary;
 * the active tab is bg-surface-1 with rounded-t-md top corners and a 1px
 * bottom border in the body color so it visually opens into the panel body
 * (the strip's border line is painted behind the tabs by TerminalPanel).
 * Inactive tabs reserve the same 1px bottom border transparently — no shift.
 *
 * Overflow: a ResizeObserver on the scroll strip (and its list) plus a scroll
 * listener fade 24px chevron buttons in/out at both ends; clicking scrolls by
 * 0.75 × clientWidth. Layout is read only inside observer/scroll/activation
 * callbacks, never per frame. Built on the Radix Tabs primitive (ui/tabs.tsx)
 * — keyboard/ARIA come free.
 */
export function PanelTabs({ tabs, activeTab, onTabChange, className }: PanelTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Overflow detection — ResizeObserver (strip + list size) and scroll events
  // are the only places layout is read.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setOverflowing(el.scrollWidth > el.clientWidth + 1);
      setCanScrollLeft(el.scrollLeft > 1);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // The list is w-max, so its width tracks the tab set — observing it
    // catches tab additions/removals that don't change the strip's own size.
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);

  // Keep the active tab reachable when the strip is scrolled.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>("[data-state='active']");
    if (!active) return;
    const a = active.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    if (a.left < c.left) {
      el.scrollBy({ left: a.left - c.left - 8, behavior: "smooth" });
    } else if (a.right > c.right) {
      el.scrollBy({ left: a.right - c.right + 8, behavior: "smooth" });
    }
  }, [activeTab]);

  const scrollStrip = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.75, behavior: "smooth" });
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={onTabChange}
      className={cn("flex h-full min-w-0 items-stretch", className)}
    >
      <ScrollButton
        side="left"
        visible={overflowing}
        disabled={!canScrollLeft}
        onClick={() => scrollStrip(-1)}
      />
      <div
        ref={scrollRef}
        className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <TabsList className="flex h-full w-max min-w-full items-stretch justify-start gap-0 rounded-none bg-transparent p-0">
          {tabs.map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              className={cn(
                "h-9 shrink-0 items-center border-b border-transparent px-3 py-0",
                "rounded-none text-[13px] font-medium text-text-secondary",
                "hover:text-text-primary",
                "focus-visible:ring-inset focus-visible:ring-offset-0",
                "data-[state=active]:rounded-t-md data-[state=active]:border-b-surface-1",
                "data-[state=active]:bg-surface-1 data-[state=active]:text-text-primary",
                "data-[state=active]:shadow-none",
              )}
            >
              {t.label}
              {t.count != null && (
                <span className="ml-1 tabular-nums text-text-muted">({t.count})</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <ScrollButton
        side="right"
        visible={overflowing}
        disabled={!canScrollRight}
        onClick={() => scrollStrip(1)}
      />
    </Tabs>
  );
}

/** 24px strip-end scroll button; fades/collapses in when the strip overflows. */
function ScrollButton({
  side,
  visible,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  visible: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <div
      className={cn(
        "flex items-center overflow-hidden transition-all duration-150",
        visible ? "w-6 opacity-100" : "w-0 opacity-0",
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={side === "left" ? "Scroll tabs left" : "Scroll tabs right"}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center text-text-secondary",
          "transition-colors hover:text-text-primary focus-visible:outline-none",
          "disabled:pointer-events-none disabled:opacity-30",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
