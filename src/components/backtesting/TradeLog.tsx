import type { Trade } from "@/lib/api/types";
import type { BacktestTrade } from "@/lib/api/strategies";
import { cn } from "@/lib/utils";

type TradeFilter = "all" | "winning" | "losing";

function formatTs(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function formatPnl(pnl: number) {
  return `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`;
}

export function TradeLog({ trades }: { trades: Trade[] }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Trade Log {trades.length > 0 && <span className="ml-1 text-foreground">{trades.length}</span>}
      </div>
      <div className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No trades yet</div>
        ) : (
          <ul className="divide-y divide-border">
            {[...trades].reverse().map((t, i) => (
              <li key={i} className="flex flex-col gap-0.5 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className={cn("text-xs font-semibold", t.side === "LONG" ? "text-bull" : "text-bear")}>{t.side}</span>
                  <span className={cn("font-mono text-xs", t.pnl >= 0 ? "text-bull" : "text-bear")}>{formatPnl(t.pnl)}</span>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">In: {formatTs(t.entryTime)} @ {t.entryPrice.toFixed(2)}</div>
                <div className="font-mono text-[10px] text-muted-foreground">Out: {formatTs(t.exitTime)} @ {t.exitPrice.toFixed(2)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {trades.length > 0 && (
        <div className="border-t border-border px-3 py-2">
          {(() => {
            const total = trades.reduce((s, t) => s + t.pnl, 0);
            const wins  = trades.filter(t => t.pnl >= 0).length;
            return (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Win rate {Math.round((wins / trades.length) * 100)}%</span>
                <span className={cn("font-mono font-semibold", total >= 0 ? "text-bull" : "text-bear")}>{formatPnl(total)}</span>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export function StrategyTradeLog({ trades, filter }: { trades: BacktestTrade[]; filter: TradeFilter }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {filter === "all" ? "All Trades" : filter === "winning" ? "Winning Trades" : "Losing Trades"}
        {trades.length > 0 && <span className="ml-1 text-foreground">{trades.length}</span>}
      </div>
      <div className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {filter === "all" ? "No trades" : `No ${filter} trades`}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {[...trades].reverse().map((t, i) => (
              <li key={i} className="flex flex-col gap-0.5 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className={cn("text-xs font-semibold capitalize", t.direction === "long" ? "text-bull" : "text-bear")}>
                    {t.direction}
                  </span>
                  <span className={cn("font-mono text-xs", (t.pnl ?? 0) >= 0 ? "text-bull" : "text-bear")}>
                    {formatPnl(t.pnl ?? 0)}
                  </span>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  In: {t.entry_time ? formatTs(t.entry_time) : "—"} @ {t.entry_price.toFixed(2)}
                </div>
                {t.exit_time && t.exit_price != null && (
                  <div className="font-mono text-[10px] text-muted-foreground">
                    Out: {formatTs(t.exit_time)} @ {t.exit_price.toFixed(2)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {trades.length > 0 && (
        <div className="border-t border-border px-3 py-2">
          {(() => {
            const total = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
            const wins  = trades.filter(t => t.win === true).length;
            return (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Win rate {trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0}%</span>
                <span className={cn("font-mono font-semibold", total >= 0 ? "text-bull" : "text-bear")}>{formatPnl(total)}</span>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
