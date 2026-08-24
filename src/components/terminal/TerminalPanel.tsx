import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { List } from "lucide-react";

import { IconButton } from "@/components/terminal/IconButton";
import { PanelTabs, type PanelTab } from "@/components/terminal/PanelTabs";
import { cn } from "@/lib/utils";

export type { PanelTab };

export interface TerminalPanelProps extends ComponentPropsWithoutRef<"section"> {
  /** ≥1; a single tab renders as a plain title strip (no tab interactivity). */
  tabs: PanelTab[];
  activeTab: string;
  /** Optional because single-tab panels never change tabs. */
  onTabChange?: (id: string) => void;
  /** Hamburger pinned far right; omitted = no icon. */
  onOptions?: () => void;
  /** Optional extra header-right content, rendered left of the hamburger. */
  actions?: ReactNode;
  /** Extra classes for the body container (padding, gaps, scroll behavior). */
  bodyClassName?: string;
}

/**
 * TerminalPanel (build doc §4.1) — the shell every region mounts into: a 36px
 * header strip (bg-surface-2) over a surface-1 body, framed by a 1px
 * border-subtle. The strip's bottom border line is painted *behind* the tabs
 * (absolute line first, strip content positioned above it) so the active
 * tab's opaque surface-1 background merges into the panel body while the line
 * shows through the transparent inactive tabs. Tab overflow chevrons live in
 * PanelTabs; the options hamburger sits in the header-right slot. Extra
 * section props (e.g. onPointerDownCapture) pass through to the root.
 */
export function TerminalPanel({
  tabs,
  activeTab,
  onTabChange,
  onOptions,
  actions,
  bodyClassName,
  className,
  children,
  ...rest
}: TerminalPanelProps) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-md border border-border-subtle bg-surface-1",
        className,
      )}
      {...rest}
    >
      {/* Header strip — 36px, surface-2, 1px border-subtle bottom edge. */}
      <div className="relative flex h-9 shrink-0 items-stretch bg-surface-2">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border-subtle"
        />
        {tabs.length <= 1 ? (
          <div className="relative flex items-center px-3 text-[13px] font-medium text-text-primary">
            {tabs[0]?.label}
            {tabs[0]?.count != null && (
              <span className="ml-1 tabular-nums text-text-muted">({tabs[0].count})</span>
            )}
          </div>
        ) : (
          <PanelTabs
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(id) => onTabChange?.(id)}
            className="relative min-w-0 flex-1"
          />
        )}
        {(actions || onOptions) && (
          <div className="relative ml-auto flex items-center gap-1 px-1.5">
            {actions}
            {onOptions && <IconButton icon={List} label="Panel options" onClick={onOptions} />}
          </div>
        )}
      </div>

      {/* Body */}
      <div className={cn("flex min-h-0 flex-1 flex-col", bodyClassName)}>{children}</div>
    </section>
  );
}
