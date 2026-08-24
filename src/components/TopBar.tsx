import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { liveApi } from "@/lib/api/live";
import { getEndpointStatus, subscribeProbe } from "@/lib/api/health-probe";
import { togglePalette } from "@/lib/command-registry";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeSettings } from "@/components/ThemeSettings";
import { cn } from "@/lib/utils";

/**
 * Top bar (build doc §5.3) — 48px global chrome above the rail + main split.
 * Left: the §13.3 theme/display settings popover (its reserved home).
 * Center: a search-field replica (button styled like an input) that toggles
 * the §17 command palette. Right: account equity + day PnL readouts.
 * The brand glyph's one home is the rail top.
 *
 * SSR: fixed height; the readout cluster renders its skeleton server-side, so
 * first paint and hydration agree and nothing shifts.
 */
export function TopBar() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border-subtle bg-surface-0 px-3">
      <div className="flex flex-1 items-center">
        <ThemeSettings />
      </div>
      <button
        type="button"
        data-testid="global-search"
        onClick={() => togglePalette()}
        aria-label="Search symbols (⌘K)"
        className={cn(
          "flex h-8 w-full max-w-md items-center gap-2 rounded-md border border-border-subtle",
          "bg-surface-1 px-3 text-sm text-text-muted transition-colors",
          "hover:bg-surface-2 hover:text-text-secondary",
        )}
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate text-left">Search symbols…</span>
        <kbd className="pointer-events-none flex select-none items-center gap-0.5 rounded border border-border-subtle bg-surface-2 px-1.5 font-mono text-[10px] text-text-muted">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>
      <div className="flex flex-1 items-center justify-end">
        <AccountReadout />
      </div>
    </header>
  );
}

function fmtDollar(n: number): string {
  if (Number.isNaN(n)) return "—";
  return (
    (n < 0 ? "-$" : "$") +
    Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function fmtSignedDollar(n: number): string {
  if (Number.isNaN(n)) return "—";
  return (
    (n >= 0 ? "+$" : "-$") +
    Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/**
 * Equity + day PnL, fed by the same polled ["live", "account"] query /live
 * uses (shared cache, no second poller). Hidden entirely when the endpoint is
 * unreachable: the §2 health-probe result is reused (no second probe) — both
 * core endpoints flagged means the API is down — and a query error (404,
 * network) or null payload (204, trading keys unconfigured) hides it too.
 */
function AccountReadout() {
  const apiDown = useSyncExternalStore(
    subscribeProbe,
    () => getEndpointStatus("symbols") === "flagged" && getEndpointStatus("prices") === "flagged",
    () => false,
  );

  const accountQ = useQuery({
    queryKey: ["live", "account"],
    queryFn: liveApi.account,
    refetchInterval: 30_000,
    retry: false,
    enabled: !apiDown,
  });

  if (apiDown) return null;

  if (accountQ.isLoading) {
    return (
      <div data-testid="account-readout" aria-hidden className="flex items-center gap-3">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3.5 w-24" />
      </div>
    );
  }

  const account = accountQ.data;
  if (accountQ.isError || !account) return null;

  const equity = parseFloat(account.equity);
  const lastEquity = parseFloat(account.lastEquity);
  const dayPnl = equity - lastEquity;
  const dayPnlPct = lastEquity ? (dayPnl / lastEquity) * 100 : NaN;
  const pnlColor = dayPnl > 0 ? "text-dir-up" : dayPnl < 0 ? "text-dir-down" : "text-dir-flat";

  return (
    <div
      data-testid="account-readout"
      className="flex items-center gap-4 text-xs tabular-nums whitespace-nowrap"
    >
      <span className="flex items-baseline gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-text-muted">Equity</span>
        <span className="font-medium text-text-primary">{fmtDollar(equity)}</span>
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-text-muted">Day P&L</span>
        <span className={cn("font-medium", pnlColor)}>
          {fmtSignedDollar(dayPnl)}
          {!Number.isNaN(dayPnlPct) && (
            <span className="text-text-muted">
              {" "}
              ({dayPnlPct >= 0 ? "+" : ""}
              {dayPnlPct.toFixed(2)}%)
            </span>
          )}
        </span>
      </span>
    </div>
  );
}
