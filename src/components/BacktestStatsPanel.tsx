import type { BacktestResults } from "@/lib/api/strategies";
import { cn } from "@/lib/utils";

interface Props {
  results: BacktestResults;
  strategyName: string;
}

export function BacktestStatsPanel({ results, strategyName }: Props) {
  const fmt = (n: number | null | undefined, decimals = 2) =>
    n == null ? "—" : n.toFixed(decimals);

  const stats: { label: string; value: string; color?: string }[] = [
    {
      label: "Win Rate",
      value: `${fmt(results.winRate)}%`,
      color: (results.winRate ?? 0) >= 50 ? "text-green-400" : "text-red-400",
    },
    {
      label: "Total PnL",
      value: `$${fmt(results.totalPnl)}`,
      color: (results.totalPnl ?? 0) >= 0 ? "text-green-400" : "text-red-400",
    },
    {
      label: "Total Return",
      value: `${(results.totalPnlPct ?? 0) >= 0 ? "+" : ""}${fmt(results.totalPnlPct)}%`,
      color: (results.totalPnlPct ?? 0) >= 0 ? "text-green-400" : "text-red-400",
    },
    {
      label: "Profit Factor",
      value: fmt(results.profitFactor),
      color: (results.profitFactor ?? 0) >= 1 ? "text-green-400" : "text-red-400",
    },
    {
      label: "Max Drawdown",
      value: `${fmt(results.maxDrawdown)}%`,
      color: "text-amber-400",
    },
    {
      label: "Sharpe Ratio",
      value: fmt(results.sharpeRatio),
      color:
        (results.sharpeRatio ?? 0) >= 1
          ? "text-green-400"
          : (results.sharpeRatio ?? 0) >= 0
          ? "text-amber-400"
          : "text-red-400",
    },
    {
      label: "Total Trades",
      value: String(results.totalTrades ?? 0),
    },
    {
      label: "Avg Win / Loss",
      value: `$${fmt(results.avgWin)} / -$${fmt(Math.abs(results.avgLoss ?? 0))}`,
    },
  ];

  return (
    <div className="border-t border-border px-3 py-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Strategy
        </span>
        <span className="font-mono text-xs text-foreground">{strategyName}</span>
        <span className="text-[10px] text-muted-foreground">
          {results.totalTrades} trades · {results.symbol ?? "—"}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 lg:grid-cols-8">
        {stats.map(s => (
          <div key={s.label} className="flex flex-col gap-0.5 rounded-md bg-muted/30 px-2 py-1.5">
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{s.label}</span>
            <span className={cn("font-mono text-xs font-medium", s.color ?? "text-foreground")}>
              {s.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
