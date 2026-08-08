import { Trophy } from "lucide-react";
import type { CapitalStats, BuyHoldStats } from "@/lib/backtest-capital";
import { fmtPct, fmtPnl, fmtPrice, fmtSize } from "@/lib/format";
import { MetaGrid, type MetaGridItem } from "@/components/terminal/MetaGrid";
import { cn } from "@/lib/utils";

interface Props {
  capitalStats: CapitalStats;
  strategyName: string;
  buyHold?: BuyHoldStats | null;
}

export function BacktestStatsPanel({ capitalStats: cs, strategyName, buyHold }: Props) {
  const mainStats: MetaGridItem[] = [
    {
      label: "Win Rate",
      value: fmtPct(cs.winRate, { plus: false }),
      color: (cs.winRate ?? 0) >= 50 ? "text-bull" : "text-bear",
    },
    {
      label: "Total PnL",
      value: fmtPnl(cs.totalPnl),
      color: (cs.totalPnl ?? 0) >= 0 ? "text-bull" : "text-bear",
    },
    {
      label: "Total Return",
      value: fmtPct(cs.totalPnlPct),
      color: (cs.totalPnlPct ?? 0) >= 0 ? "text-bull" : "text-bear",
    },
    {
      label: "Profit Factor",
      value: cs.profitFactor >= 99 ? "∞" : fmtPrice(cs.profitFactor),
      color: (cs.profitFactor ?? 0) >= 1 ? "text-bull" : "text-bear",
    },
    {
      label: "Max Drawdown",
      value: fmtPct(cs.maxDrawdown, { plus: false }),
      color: "text-warning",
    },
    {
      label: "Sharpe Ratio",
      value: fmtPrice(cs.sharpeRatio),
      color:
        (cs.sharpeRatio ?? 0) >= 1
          ? "text-bull"
          : (cs.sharpeRatio ?? 0) >= 0
            ? "text-dir-flat"
            : "text-bear",
    },
    {
      label: "Total Trades",
      value: fmtSize(cs.totalTrades ?? 0),
    },
    {
      label: "Avg Win / Loss",
      value: `$${fmtPrice(cs.avgWin)} / -$${fmtPrice(Math.abs(cs.avgLoss ?? 0))}`,
    },
  ];

  const capitalStats: MetaGridItem[] = [
    {
      label: "Starting Capital",
      value: `$${cs.startingCapital.toLocaleString("en-US")}`,
    },
    {
      label: "Ending Capital",
      value: `$${fmtPrice(cs.endingCapital)}`,
      color: cs.endingCapital >= cs.startingCapital ? "text-bull" : "text-bear",
    },
    {
      label: "Return on Capital",
      value: fmtPct(cs.returnOnCapital),
      color: cs.returnOnCapital >= 0 ? "text-bull" : "text-bear",
    },
    {
      label: "Annualized Ret",
      value: fmtPct(cs.annualizedReturn),
      color: cs.annualizedReturn >= 0 ? "text-bull" : "text-bear",
    },
  ];

  // ── Buy & hold comparison ──────────────────────────────────────────────────
  const comparisonRows: {
    label: string;
    strat: number | null;
    bah: number | null;
    higherIsBetter: boolean;
    stratFmt: string;
    bahFmt: string;
  }[] = buyHold
    ? [
        {
          label: "Total Return ($)",
          strat: cs.totalPnl,
          bah: buyHold.totalPnl,
          higherIsBetter: true,
          stratFmt: fmtPnl(cs.totalPnl),
          bahFmt: fmtPnl(buyHold.totalPnl),
        },
        {
          label: "Return %",
          strat: cs.totalPnlPct,
          bah: buyHold.totalPnlPct,
          higherIsBetter: true,
          stratFmt: fmtPct(cs.totalPnlPct),
          bahFmt: fmtPct(buyHold.totalPnlPct),
        },
        {
          label: "Win Rate",
          strat: cs.winRate,
          bah: null,
          higherIsBetter: true,
          stratFmt: fmtPct(cs.winRate, { plus: false }),
          bahFmt: "N/A",
        },
        {
          label: "Max Drawdown",
          strat: cs.maxDrawdown,
          bah: buyHold.maxDrawdown,
          higherIsBetter: false,
          stratFmt: fmtPct(cs.maxDrawdown, { plus: false }),
          bahFmt: fmtPct(buyHold.maxDrawdown, { plus: false }),
        },
        {
          label: "Sharpe Ratio",
          strat: cs.sharpeRatio,
          bah: buyHold.sharpeRatio,
          higherIsBetter: true,
          stratFmt: fmtPrice(cs.sharpeRatio),
          bahFmt: fmtPrice(buyHold.sharpeRatio),
        },
        {
          label: "Annualized Ret",
          strat: cs.annualizedReturn,
          bah: buyHold.annualizedReturn,
          higherIsBetter: true,
          stratFmt: fmtPct(cs.annualizedReturn),
          bahFmt: fmtPct(buyHold.annualizedReturn),
        },
      ]
    : [];

  // Determine trophy winner
  let stratWins = 0;
  let bahWins = 0;
  for (const row of comparisonRows) {
    if (row.bah == null) { stratWins++; continue; }
    const stratBetter = row.higherIsBetter
      ? (row.strat ?? -Infinity) > (row.bah ?? -Infinity)
      : (row.strat ?? Infinity) < (row.bah ?? Infinity);
    const bahBetter = row.higherIsBetter
      ? (row.bah ?? -Infinity) > (row.strat ?? -Infinity)
      : (row.bah ?? Infinity) < (row.strat ?? Infinity);
    if (stratBetter) stratWins++;
    else if (bahBetter) bahWins++;
  }
  const stratTrophy = stratWins > bahWins;
  const bahTrophy = bahWins > stratWins;

  return (
    <div className="border-t border-border px-3 py-2 space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Strategy
        </span>
        <span className="font-mono text-xs text-foreground">{strategyName}</span>
        <span className="text-[10px] text-muted-foreground">
          {cs.totalTrades} trades · {cs.symbol ?? "—"}
        </span>
        {cs.insufficientCapitalCount > 0 && (
          <span className="rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
            {cs.insufficientCapitalCount} trade{cs.insufficientCapitalCount > 1 ? "s" : ""} skipped — insufficient capital
          </span>
        )}
      </div>

      {/* Main stats grid */}
      <MetaGrid items={mainStats} className="grid-cols-2 lg:grid-cols-4" />

      {/* Capital stats strip */}
      <MetaGrid items={capitalStats} className="grid-cols-2 lg:grid-cols-4" />

      {/* Buy & hold comparison */}
      {buyHold && comparisonRows.length > 0 && (
        <div className="mt-1">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            vs Buy &amp; Hold
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-1 text-left font-normal">Metric</th>
                <th className="pb-1 text-right font-normal">
                  <span className="flex items-center justify-end gap-1">
                    {stratTrophy && <Trophy className="h-3 w-3 text-warning" />}
                    Strategy
                  </span>
                </th>
                <th className="pb-1 text-right font-normal">
                  <span className="flex items-center justify-end gap-1">
                    {bahTrophy && <Trophy className="h-3 w-3 text-warning" />}
                    Buy &amp; Hold
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {comparisonRows.map(row => {
                const stratBetter =
                  row.bah == null
                    ? true
                    : row.higherIsBetter
                      ? (row.strat ?? -Infinity) > (row.bah ?? -Infinity)
                      : (row.strat ?? Infinity) < (row.bah ?? Infinity);
                const bahBetter =
                  row.bah == null
                    ? false
                    : row.higherIsBetter
                      ? (row.bah ?? -Infinity) > (row.strat ?? -Infinity)
                      : (row.bah ?? Infinity) < (row.strat ?? Infinity);

                return (
                  <tr key={row.label}>
                    <td className="py-0.5 text-[10px] text-muted-foreground">{row.label}</td>
                    <td
                      className={cn(
                        "py-0.5 text-right tabular-nums",
                        stratBetter ? "text-bull" : "text-foreground",
                      )}
                    >
                      {row.stratFmt}
                    </td>
                    <td
                      className={cn(
                        "py-0.5 text-right tabular-nums",
                        bahBetter ? "text-bull" : "text-muted-foreground",
                      )}
                    >
                      {row.bahFmt}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
