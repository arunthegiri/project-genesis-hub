import { useMemo } from "react";
import type { Trade } from "@/lib/api/types";
import type { BacktestTrade } from "@/lib/api/strategies";
import { PanelState } from "@/components/terminal/PanelState";
import { UnderlineTabs } from "@/components/terminal/UnderlineTabs";
import { TerminalTable } from "@/components/terminal/table/TerminalTable";
import { DensityProvider } from "@/components/terminal/table/density";
import {
  TRADE_LOG_COLUMNS,
  backtestTradeToRow,
  tradeToRow,
  type TradeLogRow,
} from "@/components/terminal/table/presets/trades";
import { fmtPnl } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TradeFilter = "all" | "winning" | "losing";

const rowId = (r: TradeLogRow) => r.id;

/**
 * §8.2 adopter 2 — both trade logs run on TerminalTable + TRADE_LOG_COLUMNS.
 * What used to be a 3-line card per trade is a single-line row (the 260px
 * rail can't host both time@price lines — entry/exit prices stay on the
 * chart as markers; settled in the doc's §8.2 amendment). Compact density,
 * newest-first, unsorted headers: the log's behaviour is unchanged.
 */
export function TradeLog({ trades }: { trades: Trade[] }) {
  // Newest-first, computed once per trades change — not per render.
  const rows = useMemo(() => trades.map(tradeToRow).reverse(), [trades]);
  const { total, wins } = useMemo(
    () => ({
      total: trades.reduce((s, t) => s + t.pnl, 0),
      wins: trades.filter((t) => t.pnl >= 0).length,
    }),
    [trades],
  );

  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Trade Log{" "}
        {trades.length > 0 && <span className="ml-1 text-foreground">{trades.length}</span>}
      </div>
      <DensityProvider density="compact">
        <TerminalTable
          rows={rows}
          columns={TRADE_LOG_COLUMNS}
          getRowId={rowId}
          empty={<PanelState kind="empty" art="table" message="No trades yet" />}
        />
      </DensityProvider>
      {trades.length > 0 && (
        <div className="border-t border-border px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Win rate {Math.round((wins / trades.length) * 100)}%
            </span>
            <span className={cn("font-mono font-semibold", total >= 0 ? "text-bull" : "text-bear")}>
              {fmtPnl(total)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function StrategyTradeLog({
  trades,
  filter,
  counts,
  onFilterChange,
}: {
  trades: BacktestTrade[];
  filter: TradeFilter;
  /** Unfiltered counts shown in-label on the filter tabs: All (n) etc. */
  counts: Record<TradeFilter, number>;
  onFilterChange: (f: TradeFilter) => void;
}) {
  // Newest-first, computed once per trades change — not per render.
  const rows = useMemo(() => trades.map(backtestTradeToRow).reverse(), [trades]);
  const { total, wins } = useMemo(
    () => ({
      total: trades.reduce((s, t) => s + (t.pnl ?? 0), 0),
      wins: trades.filter((t) => t.win === true).length,
    }),
    [trades],
  );

  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
      {/* §4.2: All/Winning/Losing filter = in-body UnderlineTabs with counts. */}
      <div className="border-b border-border px-3">
        <UnderlineTabs
          tabs={[
            { id: "all", label: "All", count: counts.all },
            { id: "winning", label: "Winning", count: counts.winning },
            { id: "losing", label: "Losing", count: counts.losing },
          ]}
          activeTab={filter}
          onTabChange={(id) => onFilterChange(id as TradeFilter)}
        />
      </div>
      <DensityProvider density="compact">
        <TerminalTable
          rows={rows}
          columns={TRADE_LOG_COLUMNS}
          getRowId={rowId}
          empty={
            <PanelState
              kind="empty"
              art="table"
              message={filter === "all" ? "No trades" : `No ${filter} trades`}
            />
          }
        />
      </DensityProvider>
      {trades.length > 0 && (
        <div className="border-t border-border px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Win rate {trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0}%
            </span>
            <span className={cn("font-mono font-semibold", total >= 0 ? "text-bull" : "text-bear")}>
              {fmtPnl(total)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
