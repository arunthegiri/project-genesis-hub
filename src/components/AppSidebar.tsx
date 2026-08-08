import { Link, useLocation } from "@tanstack/react-router";
import { LineChart, Database, History, Activity, Gauge, Brain, TerminalSquare } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type NavRoute = "/" | "/data" | "/backtesting" | "/live" | "/metrics" | "/models";

type NavItem = {
  to: NavRoute;
  label: string;
  icon: typeof LineChart;
  exact?: boolean;
};

const NAV: NavItem[] = [
  { to: "/", label: "Charts", icon: LineChart, exact: true },
  { to: "/data", label: "Data", icon: Database },
  { to: "/backtesting", label: "Backtesting", icon: History },
  { to: "/live", label: "Live", icon: Activity },
  { to: "/metrics", label: "Metrics", icon: Gauge },
  { to: "/models", label: "Models", icon: Brain },
];

/** Static for now — W4 wires this to the health probe (failing endpoint → dot on its nav icon). */
const NO_NOTIFICATIONS: Partial<Record<NavRoute, boolean>> = {};

interface AppSidebarProps {
  /** Badge dots per nav route: true renders a 6px dir-down dot at the icon's top-right. */
  notifications?: Partial<Record<NavRoute, boolean>>;
}

/**
 * Icon rail (build doc §5.1) — 64px global nav. Labels live in hover tooltips;
 * the active item gets a 2px accent-blue left bar + bg-surface-2. The brand
 * glyph keeps its home at the rail top (48px cell, matching the top bar).
 */
export function AppSidebar({ notifications = NO_NOTIFICATIONS }: AppSidebarProps) {
  const { pathname } = useLocation();
  return (
    <aside className="flex w-16 shrink-0 flex-col border-r border-border-subtle bg-surface-0">
      <div className="flex h-12 shrink-0 items-center justify-center border-b border-border-subtle">
        <TerminalSquare className="h-5 w-5 text-accent-blue" />
      </div>

      <TooltipProvider delayDuration={200}>
        <nav className="flex flex-1 flex-col gap-0.5 py-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <Tooltip key={item.to}>
                <TooltipTrigger asChild>
                  <Link
                    to={item.to}
                    aria-label={item.label}
                    className="relative flex h-10 items-center justify-center"
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r-full bg-accent-blue"
                      />
                    )}
                    <span
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                        "text-text-secondary hover:bg-surface-3 hover:text-text-primary",
                        active && "bg-surface-2 text-text-primary",
                      )}
                    >
                      <span className="relative">
                        <Icon className="h-4 w-4" />
                        {notifications[item.to] && (
                          <span
                            aria-hidden
                            className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-dir-down"
                          />
                        )}
                      </span>
                    </span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  className="border border-border-subtle bg-surface-2 text-text-primary"
                >
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </TooltipProvider>
    </aside>
  );
}
