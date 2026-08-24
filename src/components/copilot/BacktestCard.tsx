import { fmtPct, fmtPnl, fmtRatio } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BacktestResults } from "@/lib/api/strategies";

/**
 * Compact metrics card shown when the copilot's `backtest` event lands
 * (build doc M5). Directional colouring uses the bull/bear tokens, which is
 * exactly what they mean — P&L direction.
 */

interface Props {
  results: BacktestResults;
  /** True when the engine could not re-run the definition and the SDK's own run was used. */
  usedExportedResult?: boolean;
  className?: string;
}

export function BacktestCard({ results, usedExportedResult, className }: Props) {
  const cells: { label: string; value: string; tone?: string }[] = [
    { label: "Trades", value: String(results.totalTrades ?? 0) },
    {
      label: "Win rate",
      value: fmtPct(results.winRate),
      tone: (results.winRate ?? 0) >= 50 ? "text-bull" : "text-bear",
    },
    {
      label: "Total P&L",
      value: fmtPnl(results.totalPnl, { plus: true }),
      tone: (results.totalPnl ?? 0) >= 0 ? "text-bull" : "text-bear",
    },
    {
      label: "Return",
      value: fmtPct(results.totalPnlPct, { plus: true }),
      tone: (results.totalPnlPct ?? 0) >= 0 ? "text-bull" : "text-bear",
    },
    {
      label: "Profit factor",
      value: fmtRatio(results.profitFactor),
      tone: (results.profitFactor ?? 0) >= 1 ? "text-bull" : "text-bear",
    },
    { label: "Max drawdown", value: fmtPct(results.maxDrawdown), tone: "text-bear" },
    { label: "Sharpe", value: fmtRatio(results.sharpeRatio) },
    { label: "Won / lost", value: `${results.winningTrades ?? 0} / ${results.losingTrades ?? 0}` },
  ];

  return (
    <div className={cn("rounded-md border border-subtle bg-surface-0", className)}>
      <div className="flex items-center justify-between border-b border-subtle bg-surface-2 px-2 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Backtest{results.symbol ? ` · ${results.symbol}` : ""}
        </span>
        {usedExportedResult && (
          <span
            className="font-mono text-[10px] text-muted-foreground"
            title="The Java engine could not re-run this definition, so the SDK's own run is shown."
          >
            SDK run
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 p-2 sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="min-w-0">
            <dt className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
              {c.label}
            </dt>
            <dd
              className={cn("truncate font-mono text-xs tabular-nums", c.tone ?? "text-foreground")}
            >
              {c.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
