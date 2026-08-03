import { Trophy } from "lucide-react";
import type { CapitalStats, BuyHoldStats } from "@/lib/backtest-capital";
import { cn } from "@/lib/utils";

interface Props {
  capitalStats: CapitalStats;
  strategyName: string;
  buyHold?: BuyHoldStats | null;
}

export function BacktestStatsPanel({ capitalStats: cs, strategyName, buyHold }: Props) {
  const fmt = (n: number | null | undefined, decimals = 2) =>
    n == null ? "—" : n.toFixed(decimals);
  const fmtDollar = (n: number | null | undefined) =>
    n == null ? "—" : `${n >= 0 ? "+" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const mainStats: { label: string; value: string; color?: string }[] = [
    {
      label: "Win Rate",
      value: `${fmt(cs.winRate)}%`,
      color: (cs.winRate ?? 0) >= 50 ? "text-bull" : "text-bear",
    },
    {
      label: "Total PnL",
      value: fmtDollar(cs.totalPnl),
      color: (cs.totalPnl ?? 0) >= 0 ? "text-bull" : "text-bear",
    },
    {
      label: "Total Return",
      value: `${(cs.totalPnlPct ?? 0) >= 0 ? "+" : ""}${fmt(cs.totalPnlPct)}%`,
      color: (cs.totalPnlPct ?? 0) >= 0 ? "text-bull" : "text-bear",
    },
    {
      label: "Profit Factor",
      value: cs.profitFactor >= 99 ? "∞" : fmt(cs.profitFactor),
      color: (cs.profitFactor ?? 0) >= 1 ? "text-bull" : "text-bear",
    },
    {
      label: "Max Drawdown",
      value: `${fmt(cs.maxDrawdown)}%`,
      color: "text-neutral",
    },
    {
      label: "Sharpe Ratio",
      value: fmt(cs.sharpeRatio),
      color:
        (cs.sharpeRatio ?? 0) >= 1
          ? "text-bull"
          : (cs.sharpeRatio ?? 0) >= 0
          ? "text-neutral"
          : "text-bear",
    },
    {
      label: "Total Trades",
      value: String(cs.totalTrades ?? 0),
    },
    {
      label: "Avg Win / Loss",
      value: `$${fmt(cs.avgWin)} / -$${fmt(Math.abs(cs.avgLoss ?? 0))}`,
    },
  ];

  const capitalStats: { label: string; value: string; color?: string }[] = [
    {
      label: "Starting Capital",
      value: `$${cs.startingCapital.toLocaleString("en-US")}`,
    },
    {
      label: "Ending Capital",
      value: `$${cs.endingCapital.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      color: cs.endingCapital >= cs.startingCapital ? "text-bull" : "text-bear",
    },
    {
      label: "Return on Capital",
      value: `${cs.returnOnCapital >= 0 ? "+" : ""}${fmt(cs.returnOnCapital)}%`,
      color: cs.returnOnCapital >= 0 ? "text-bull" : "text-bear",
    },
    {
      label: "Annualized Ret",
      value: `${cs.annualizedReturn >= 0 ? "+" : ""}${fmt(cs.annualizedReturn)}%`,
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
          stratFmt: fmtDollar(cs.totalPnl),
          bahFmt: fmtDollar(buyHold.totalPnl),
        },
        {
          label: "Return %",
          strat: cs.totalPnlPct,
          bah: buyHold.totalPnlPct,
          higherIsBetter: true,
          stratFmt: `${cs.totalPnlPct >= 0 ? "+" : ""}${fmt(cs.totalPnlPct)}%`,
          bahFmt: `${buyHold.totalPnlPct >= 0 ? "+" : ""}${fmt(buyHold.totalPnlPct)}%`,
        },
        {
          label: "Win Rate",
          strat: cs.winRate,
          bah: null,
          higherIsBetter: true,
          stratFmt: `${fmt(cs.winRate)}%`,
          bahFmt: "N/A",
        },
        {
          label: "Max Drawdown",
          strat: cs.maxDrawdown,
          bah: buyHold.maxDrawdown,
          higherIsBetter: false,
          stratFmt: `${fmt(cs.maxDrawdown)}%`,
          bahFmt: `${fmt(buyHold.maxDrawdown)}%`,
        },
        {
          label: "Sharpe Ratio",
          strat: cs.sharpeRatio,
          bah: buyHold.sharpeRatio,
          higherIsBetter: true,
          stratFmt: fmt(cs.sharpeRatio),
          bahFmt: fmt(buyHold.sharpeRatio),
        },
        {
          label: "Annualized Ret",
          strat: cs.annualizedReturn,
          bah: buyHold.annualizedReturn,
          higherIsBetter: true,
          stratFmt: `${cs.annualizedReturn >= 0 ? "+" : ""}${fmt(cs.annualizedReturn)}%`,
          bahFmt: `${buyHold.annualizedReturn >= 0 ? "+" : ""}${fmt(buyHold.annualizedReturn)}%`,
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
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-neutral">
            {cs.insufficientCapitalCount} trade{cs.insufficientCapitalCount > 1 ? "s" : ""} skipped — insufficient capital
          </span>
        )}
      </div>

      {/* Main stats grid */}
      <div className="grid grid-cols-4 gap-2 lg:grid-cols-8">
        {mainStats.map(s => (
          <StatCell key={s.label} label={s.label} value={s.value} color={s.color} />
        ))}
      </div>

      {/* Capital stats strip */}
      <div className="grid grid-cols-4 gap-2">
        {capitalStats.map(s => (
          <StatCell key={s.label} label={s.label} value={s.value} color={s.color} />
        ))}
      </div>

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
                    {stratTrophy && <Trophy className="h-3 w-3 text-yellow-400" />}
                    Strategy
                  </span>
                </th>
                <th className="pb-1 text-right font-normal">
                  <span className="flex items-center justify-end gap-1">
                    {bahTrophy && <Trophy className="h-3 w-3 text-yellow-400" />}
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
                        "py-0.5 text-right font-mono",
                        stratBetter ? "text-bull" : "text-foreground",
                      )}
                    >
                      {row.stratFmt}
                    </td>
                    <td
                      className={cn(
                        "py-0.5 text-right font-mono",
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

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-muted/30 px-2 py-1.5">
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-xs font-medium", color ?? "text-foreground")}>
        {value}
      </span>
    </div>
  );
}
