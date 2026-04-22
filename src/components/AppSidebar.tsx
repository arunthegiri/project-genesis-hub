import { Link, useLocation } from "@tanstack/react-router";
import {
  LineChart,
  Database,
  History,
  Activity,
  Gauge,
  Brain,
  TerminalSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  to: "/" | "/data" | "/replay" | "/live" | "/metrics" | "/models";
  label: string;
  icon: typeof LineChart;
  exact?: boolean;
};

const NAV: NavItem[] = [
  { to: "/", label: "Charts", icon: LineChart, exact: true },
  { to: "/data", label: "Data", icon: Database },
  { to: "/replay", label: "Replay", icon: History },
  { to: "/live", label: "Live", icon: Activity },
  { to: "/metrics", label: "Metrics", icon: Gauge },
  { to: "/models", label: "Models", icon: Brain },
];

export function AppSidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <TerminalSquare className="h-5 w-5 text-primary" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-sidebar-foreground">QUANT</span>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Trading Terminal
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 p-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                active && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3 text-[10px] text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>Backend</span>
          <code className="tabular text-[10px]">
            {(import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "localhost:8080"}
          </code>
        </div>
      </div>
    </aside>
  );
}
