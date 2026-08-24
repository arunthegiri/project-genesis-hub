import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PanelTab } from "@/components/terminal/PanelTabs";
import { cn } from "@/lib/utils";

interface UnderlineTabsProps {
  tabs: PanelTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  className?: string;
}

/**
 * UnderlineTabs (build doc §4.1, variant 2) — in-body filter tabs: 32px high,
 * text-only, px-2.5; the active tab is text-accent-blue with a 2px
 * bg-accent-blue underline (a layout-stable border-b-2, transparent reserved
 * on inactive tabs — no shift). Counts render in-label (`All (34)`) with
 * tabular-nums so the count doesn't jitter. Built on the Radix Tabs primitive
 * (ui/tabs.tsx) — keyboard/ARIA comes free.
 */
export function UnderlineTabs({ tabs, activeTab, onTabChange, className }: UnderlineTabsProps) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className={className}>
      <TabsList className="inline-flex h-8 items-center justify-start gap-0 rounded-none bg-transparent p-0">
        {tabs.map((t) => (
          <TabsTrigger
            key={t.id}
            value={t.id}
            className={cn(
              "h-8 items-center border-b-2 border-transparent px-2.5 py-0",
              "rounded-none text-[13px] font-medium text-text-secondary",
              "hover:text-text-primary",
              "focus-visible:ring-offset-0",
              "data-[state=active]:border-b-accent-blue data-[state=active]:bg-transparent",
              "data-[state=active]:text-accent-blue data-[state=active]:shadow-none",
            )}
          >
            {t.label}
            {t.count != null && <span className="ml-1 tabular-nums">({t.count})</span>}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
