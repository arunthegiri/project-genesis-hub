import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { EquityChart } from "@/components/EquityChart";
import {
  fetchHermesBacktest,
  HermesNotFoundError,
  type HermesBacktest,
  type HermesTrade,
} from "@/lib/api/hermes";
import type { EquityPoint } from "@/lib/api/strategies";
import { cn } from "@/lib/utils";

function fmtTs(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtDay(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtDollar(n: number) {
  return `${n >= 0 ? "+" : ""}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtCapital(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function HermesModelPanel() {
  const { data, isLoading, error } = useQuery<HermesBacktest, Error>({
    queryKey: ["hermes", "rf_v1"],
    queryFn: fetchHermesBacktest,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const equityCurve: EquityPoint[] = useMemo(() => {
    if (!data) return [];
    const start = data.performance.startingCapital;
    return data.equity.map((p) => ({ time: p.t, cumulative_pnl: p.equity - start }));
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading Hermes backtest…
      </div>
    );
  }

  if (error instanceof HermesNotFoundError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">
          No Hermes backtest found — run the C++ backtest to generate it.
        </p>
        <p className="text-xs text-muted-foreground/60">
          Expected at <span className="font-mono">public/hermes/rf_v1_backtest.json</span>
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-bear">Failed to load Hermes backtest.</p>
        <p className="text-xs text-muted-foreground/60">{error?.message}</p>
      </div>
    );
  }

  const { model, performance: perf, trades } = data;
  const winRatePct = perf.winRate * 100;

  const metrics: { label: string; value: string; color?: string }[] = [
    { label: "Total Trades", value: String(perf.totalTrades) },
    { label: "Winning", value: String(perf.winningTrades), color: "text-bull" },
    { label: "Losing", value: String(perf.losingTrades), color: "text-bear" },
    {
      label: "Win Rate",
      value: `${winRatePct.toFixed(1)}%`,
      color: winRatePct >= 50 ? "text-bull" : "text-bear",
    },
    {
      label: "Total PnL",
      value: fmtDollar(perf.totalPnl),
      color: perf.totalPnl >= 0 ? "text-bull" : "text-bear",
    },
    {
      label: "Total PnL %",
      value: `${perf.totalPnlPct >= 0 ? "+" : ""}${perf.totalPnlPct.toFixed(2)}%`,
      color: perf.totalPnlPct >= 0 ? "text-bull" : "text-bear",
    },
    {
      label: "Profit Factor",
      value: perf.profitFactor >= 99 ? "∞" : perf.profitFactor.toFixed(2),
      color: perf.profitFactor >= 1 ? "text-bull" : "text-bear",
    },
    { label: "Max Drawdown", value: `${perf.maxDrawdown.toFixed(2)}%`, color: "text-warning" },
    {
      label: "Sharpe Ratio",
      value: perf.sharpeRatio.toFixed(2),
      color:
        perf.sharpeRatio >= 1
          ? "text-bull"
          : perf.sharpeRatio >= 0
            ? "text-dir-flat"
            : "text-bear",
    },
    { label: "Avg Win", value: fmtDollar(perf.avgWin), color: "text-bull" },
    { label: "Avg Loss", value: fmtDollar(perf.avgLoss), color: "text-bear" },
    { label: "Largest Win", value: fmtDollar(perf.largestWin), color: "text-bull" },
    { label: "Largest Loss", value: fmtDollar(perf.largestLoss), color: "text-bear" },
    { label: "Starting Capital", value: fmtCapital(perf.startingCapital) },
    {
      label: "Ending Capital",
      value: fmtCapital(perf.endingCapital),
      color: perf.endingCapital >= perf.startingCapital ? "text-bull" : "text-bear",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
      {/* ── Header / summary card ─────────────────────────────────────────── */}
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">
            {model.name}_{model.version}
          </h2>
          <span className="rounded border border-accent-blue/30 bg-accent-blue/20 px-2 py-0.5 text-[10px] font-medium text-accent-blue">
            {model.engine}
          </span>
          <span className="rounded border border-dir-up/30 bg-dir-up/10 px-2 py-0.5 text-[10px] font-medium text-dir-up">
            {model.status}
          </span>
          {data._sample && (
            <span className="rounded border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
              SAMPLE DATA — awaiting real C++ run
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            Generated {fmtTs(model.generatedAt)}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
          <MetaField label="Strategy" value={model.strategyName} mono />
          <MetaField label="Symbols" value={model.symbols.join(", ") || "—"} mono />
          <MetaField label="Features" value={String(model.featureCount)} mono />
          <MetaField label="Buy Threshold" value={model.buyThreshold.toFixed(4)} mono />
          <MetaField label="Sell Threshold" value={model.sellThreshold.toFixed(4)} mono />
          <MetaField
            label="Period"
            value={`${new Date(perf.fromTs).toLocaleDateString()} → ${new Date(perf.toTs).toLocaleDateString()}`}
          />
        </div>
      </div>

      {/* ── Performance metrics ───────────────────────────────────────────── */}
      <div className="rounded-md border border-border bg-card p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Performance — {perf.symbol}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {metrics.map((m) => (
            <StatCell key={m.label} label={m.label} value={m.value} color={m.color} />
          ))}
        </div>
      </div>

      {/* ── Equity curve ──────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <EquityChart equityCurve={equityCurve} height={240} />
      </div>

      {/* ── Trades table ──────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Trades{" "}
          {trades.length > 0 && <span className="ml-1 text-foreground">{trades.length}</span>}
        </div>
        <TradesTable trades={trades} />
      </div>
    </div>
  );
}

function TradesTable({ trades }: { trades: HermesTrade[] }) {
  if (trades.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
        No trades
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 text-left font-normal">Entry</th>
            <th className="px-3 py-2 text-left font-normal">Exit</th>
            <th className="px-3 py-2 text-right font-normal">Entry $</th>
            <th className="px-3 py-2 text-right font-normal">Exit $</th>
            <th className="px-3 py-2 text-right font-normal">Qty</th>
            <th className="px-3 py-2 text-right font-normal">PnL</th>
            <th className="px-3 py-2 text-right font-normal">PnL %</th>
            <th className="px-3 py-2 text-left font-normal">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {trades.map((t, i) => (
            <tr key={i} className="hover:bg-muted/20">
              <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                {fmtDay(t.entryTime)}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                {fmtDay(t.exitTime)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono">{t.entryPrice.toFixed(2)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{t.exitPrice.toFixed(2)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{t.qty}</td>
              <td
                className={cn(
                  "px-3 py-1.5 text-right font-mono",
                  t.pnl >= 0 ? "text-bull" : "text-bear",
                )}
              >
                {fmtDollar(t.pnl)}
              </td>
              <td
                className={cn(
                  "px-3 py-1.5 text-right font-mono",
                  t.pnlPct >= 0 ? "text-bull" : "text-bear",
                )}
              >
                {t.pnlPct >= 0 ? "+" : ""}
                {t.pnlPct.toFixed(2)}%
              </td>
              <td className="px-3 py-1.5 text-left">
                <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {t.reason}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetaField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("text-xs text-foreground", mono && "font-mono")}>{value}</span>
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
