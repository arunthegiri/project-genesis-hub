import { Trash2 } from "lucide-react";
import { BacktestStatsPanel } from "@/components/BacktestStatsPanel";
import { EquityChart } from "@/components/EquityChart";
import { PanelState } from "@/components/terminal/PanelState";
import { cn } from "@/lib/utils";
import type { CapitalStats, BuyHoldStats } from "@/lib/backtest-capital";
import type { BacktestResults } from "@/lib/api/strategies";

export interface RunRecord {
  id: string;
  strategyName: string;
  symbol: string;
  from: string;
  to: string;
  startingCapital: number;
  capitalStats: CapitalStats;
  buyHold: BuyHoldStats | null;
  runResults: BacktestResults;
  timestamp: Date;
}

interface Props {
  runHistory: RunRecord[];
  selectedRecordId: string | null;
  onSelectRecord: (id: string | null) => void;
  onClearHistory: () => void;
  onLoadRecord: (record: RunRecord) => void;
}

function fmtDateShort(local: string) {
  try { return new Date(local).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }); }
  catch { return local; }
}

export function RunHistory({ runHistory, selectedRecordId, onSelectRecord, onClearHistory, onLoadRecord }: Props) {
  const selectedRecord = runHistory.find(r => r.id === selectedRecordId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-muted-foreground">
          {runHistory.length > 0 &&
            `${runHistory.length} run${runHistory.length > 1 ? "s" : ""} this session · click a row to inspect`}
        </span>
        {runHistory.length > 0 && (
          <button
            onClick={onClearHistory}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-bear"
          >
            <Trash2 className="h-3 w-3" /> Clear History
          </button>
        )}
      </div>

      {runHistory.length === 0 && (
        <div className="min-h-0 flex-1 rounded-md border border-border bg-card">
          <PanelState
            kind="empty"
            art="table"
            message="No runs yet — run a strategy to see results here."
          />
        </div>
      )}

      {runHistory.length > 0 && (
        <div className={cn("overflow-auto rounded-md border border-border", selectedRecord ? "max-h-48 shrink-0" : "min-h-0 flex-1")}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left font-normal">Strategy</th>
                <th className="px-3 py-2 text-left font-normal">Symbol</th>
                <th className="px-3 py-2 text-left font-normal">From</th>
                <th className="px-3 py-2 text-left font-normal">To</th>
                <th className="px-3 py-2 text-right font-normal">Capital</th>
                <th className="px-3 py-2 text-right font-normal">End Capital</th>
                <th className="px-3 py-2 text-right font-normal">ROC %</th>
                <th className="px-3 py-2 text-right font-normal">Win Rate</th>
                <th className="px-3 py-2 text-right font-normal">Trades</th>
                <th className="px-3 py-2 text-right font-normal">Profit F.</th>
                <th className="px-3 py-2 text-right font-normal">Drawdown</th>
                <th className="px-3 py-2 text-right font-normal">Sharpe</th>
                <th className="px-3 py-2 text-right font-normal">B&H Ret %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {runHistory.map(record => {
                const cs = record.capitalStats;
                const bh = record.buyHold;
                const stratBeatsBH = bh ? cs.returnOnCapital > bh.totalPnlPct : null;
                const isSelected = record.id === selectedRecordId;
                return (
                  <tr
                    key={record.id}
                    onClick={() => onSelectRecord(isSelected ? null : record.id)}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-muted/40",
                      isSelected && "bg-primary/10",
                    )}
                  >
                    <td className="px-3 py-2 font-mono text-foreground">{record.strategyName}</td>
                    <td className="px-3 py-2 font-mono text-foreground">{record.symbol}</td>
                    <td className="px-3 py-2 text-muted-foreground">{fmtDateShort(record.from)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{fmtDateShort(record.to)}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      ${cs.startingCapital.toLocaleString("en-US")}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      ${cs.endingCapital.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </td>
                    <td className={cn("px-3 py-2 text-right font-mono font-medium", cs.returnOnCapital >= 0 ? "text-bull" : "text-bear")}>
                      {cs.returnOnCapital >= 0 ? "+" : ""}{cs.returnOnCapital.toFixed(2)}%
                    </td>
                    <td className={cn("px-3 py-2 text-right font-mono", cs.winRate >= 50 ? "text-bull" : "text-bear")}>
                      {cs.winRate.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{cs.totalTrades}</td>
                    <td className={cn("px-3 py-2 text-right font-mono", cs.profitFactor >= 1 ? "text-bull" : "text-bear")}>
                      {cs.profitFactor >= 99 ? "∞" : cs.profitFactor.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-warning">{cs.maxDrawdown.toFixed(1)}%</td>
                    <td className={cn("px-3 py-2 text-right font-mono", cs.sharpeRatio >= 1 ? "text-bull" : cs.sharpeRatio >= 0 ? "text-dir-flat" : "text-bear")}>
                      {cs.sharpeRatio.toFixed(2)}
                    </td>
                    <td className={cn("px-3 py-2 text-right font-mono", bh == null ? "text-muted-foreground" : stratBeatsBH ? "text-bull" : "text-bear")}>
                      {bh == null ? "—" : `${bh.totalPnlPct >= 0 ? "+" : ""}${bh.totalPnlPct.toFixed(2)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedRecord && (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-foreground">
              {selectedRecord.strategyName} · {selectedRecord.symbol} · ${selectedRecord.startingCapital.toLocaleString("en-US")}
            </span>
            <button
              onClick={() => onLoadRecord(selectedRecord)}
              className="rounded border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary/20"
            >
              Load into Strategies →
            </button>
          </div>
          <BacktestStatsPanel
            capitalStats={selectedRecord.capitalStats}
            strategyName={selectedRecord.strategyName}
            buyHold={selectedRecord.buyHold}
          />
          {(selectedRecord.capitalStats.equityCurve.length > 0 || (selectedRecord.buyHold?.equityCurve?.length ?? 0) > 0) && (
            <EquityChart
              equityCurve={selectedRecord.capitalStats.equityCurve}
              buyHoldCurve={selectedRecord.buyHold?.equityCurve}
              height={180}
            />
          )}
        </div>
      )}
    </div>
  );
}
