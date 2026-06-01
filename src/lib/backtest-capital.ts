import type { BacktestResults, BacktestTrade, EquityPoint } from "@/lib/api/strategies";
import type { PriceBar } from "@/lib/api/types";

export interface CapitalStats {
  startingCapital: number;
  endingCapital: number;
  returnOnCapital: number;
  insufficientCapitalCount: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  totalPnlPct: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  annualizedReturn: number;
  equityCurve: EquityPoint[];
  symbol?: string | null;
}

export interface BuyHoldStats {
  shares: number;
  entryPrice: number;
  exitPrice: number;
  totalPnl: number;
  totalPnlPct: number;
  maxDrawdown: number;
  sharpeRatio: number;
  annualizedReturn: number;
  equityCurve: EquityPoint[];
}

export function applyCapitalConstraints(
  results: BacktestResults,
  startingCapital: number,
): CapitalStats {
  const trades = (results.trades ?? []).filter(
    (t): t is BacktestTrade & { exit_price: number; exit_time: string } =>
      t.status === "closed" && t.exit_price != null && !!t.exit_time,
  );

  let capital = startingCapital;
  let insufficientCount = 0;
  const equityPts: EquityPoint[] = [];
  const scaledPnls: number[] = [];
  const scaledWins: number[] = [];
  const scaledLosses: number[] = [];

  for (const trade of trades) {
    const { entry_price, exit_price, quantity: origQty, direction, exit_time } = trade;
    const maxAffordable = entry_price > 0 ? Math.floor(capital / entry_price) : 0;

    if (maxAffordable === 0) {
      insufficientCount++;
      equityPts.push({ time: exit_time, cumulative_pnl: capital - startingCapital });
      continue;
    }

    const effectiveQty = Math.min(origQty, maxAffordable);
    const dir = direction === "long" ? 1 : -1;
    const scaledPnl = (exit_price - entry_price) * effectiveQty * dir;

    capital += scaledPnl;
    scaledPnls.push(scaledPnl);
    if (scaledPnl > 0) scaledWins.push(scaledPnl);
    else scaledLosses.push(scaledPnl);
    equityPts.push({ time: exit_time, cumulative_pnl: capital - startingCapital });
  }

  const endingCapital = capital;
  const totalPnl = round2(scaledPnls.reduce((s, v) => s + v, 0));
  const totalPnlPct = startingCapital > 0 ? round2((totalPnl / startingCapital) * 100) : 0;
  const returnOnCapital = round2(((endingCapital - startingCapital) / startingCapital) * 100);

  const winCount = scaledWins.length;
  const lossCount = scaledLosses.length;
  const totalCount = scaledPnls.length;
  const winRate = totalCount > 0 ? round2((winCount / totalCount) * 100) : 0;
  const avgWin = winCount > 0 ? round2(scaledWins.reduce((s, v) => s + v, 0) / winCount) : 0;
  const avgLoss = lossCount > 0 ? round2(scaledLosses.reduce((s, v) => s + v, 0) / lossCount) : 0;
  const largestWin = winCount > 0 ? round2(Math.max(...scaledWins)) : 0;
  const largestLoss = lossCount > 0 ? round2(Math.min(...scaledLosses)) : 0;
  const winSum = scaledWins.reduce((s, v) => s + v, 0);
  const lossAbs = Math.abs(scaledLosses.reduce((s, v) => s + v, 0));
  const profitFactor = winCount > 0 && lossCount > 0 ? round2(winSum / lossAbs) : winCount > 0 ? 99 : 0;
  const maxDrawdown = round2(calcEquityDrawdown(equityPts, startingCapital));
  const sharpeRatio = round2(calcSharpeFromPnls(scaledPnls));

  // Annualized return from date range
  const startDate = results.fromTs
    ? new Date(results.fromTs)
    : trades.length > 0 ? new Date(trades[0].entry_time) : null;
  const endDate = results.toTs
    ? new Date(results.toTs)
    : trades.length > 0 ? new Date(trades[trades.length - 1].exit_time) : null;
  const years = startDate && endDate
    ? (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    : 0;
  const annualizedReturn = years > 0.01 && startingCapital > 0
    ? round2((Math.pow(endingCapital / startingCapital, 1 / years) - 1) * 100)
    : 0;

  return {
    startingCapital,
    endingCapital,
    returnOnCapital,
    insufficientCapitalCount: insufficientCount,
    totalTrades: totalCount,
    winningTrades: winCount,
    losingTrades: lossCount,
    winRate,
    totalPnl,
    totalPnlPct,
    avgWin,
    avgLoss,
    largestWin,
    largestLoss,
    profitFactor,
    maxDrawdown,
    sharpeRatio,
    annualizedReturn,
    equityCurve: equityPts,
    symbol: results.symbol,
  };
}

export function calcBuyHold(bars: PriceBar[], startingCapital: number): BuyHoldStats | null {
  if (bars.length < 2) return null;

  const entryPrice = bars[0].open;
  const exitPrice = bars[bars.length - 1].close;
  if (entryPrice <= 0) return null;

  const shares = Math.floor(startingCapital / entryPrice);
  if (shares === 0) return null;

  const invested = shares * entryPrice;
  const totalPnl = round2((exitPrice - entryPrice) * shares);
  const totalPnlPct = round2(((exitPrice - entryPrice) / entryPrice) * 100);

  // Downsample to max 500 points for chart performance
  const step = Math.max(1, Math.floor(bars.length / 500));
  const equityCurve: EquityPoint[] = bars
    .filter((_, i) => i % step === 0 || i === bars.length - 1)
    .map(b => ({
      time: b.time,
      cumulative_pnl: round2((b.close - entryPrice) * shares),
    }));

  // Max drawdown from close-based cumPnl
  const pnlSeries = bars.map(b => (b.close - entryPrice) * shares);
  const maxDrawdown = round2(calcRawDrawdown(pnlSeries));

  // Sharpe from bar-to-bar close returns
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    if (bars[i - 1].close > 0) returns.push((bars[i].close - bars[i - 1].close) / bars[i - 1].close);
  }
  const sharpeRatio = round2(calcSharpeFromReturns(returns));

  // Annualized return
  const startDate = new Date(bars[0].time);
  const endDate = new Date(bars[bars.length - 1].time);
  const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const annualizedReturn = years > 0.01 && invested > 0
    ? round2((Math.pow((invested + totalPnl) / invested, 1 / years) - 1) * 100)
    : 0;

  return { shares, entryPrice, exitPrice, totalPnl, totalPnlPct, maxDrawdown, sharpeRatio, annualizedReturn, equityCurve };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcEquityDrawdown(curve: EquityPoint[], startingCapital: number): number {
  let peak = startingCapital;
  let maxDd = 0;
  for (const pt of curve) {
    const val = startingCapital + pt.cumulative_pnl;
    if (val > peak) peak = val;
    const dd = peak > 0 ? ((peak - val) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

function calcRawDrawdown(pnls: number[]): number {
  let peak = 0;
  let maxDd = 0;
  for (const pnl of pnls) {
    if (pnl > peak) peak = pnl;
    const dd = peak > 0 ? ((peak - pnl) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

function calcSharpeFromPnls(pnls: number[]): number {
  if (pnls.length < 2) return 0;
  const mean = pnls.reduce((s, v) => s + v, 0) / pnls.length;
  const variance = pnls.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (pnls.length - 1);
  const std = Math.sqrt(variance);
  return std === 0 ? 0 : (mean / std) * Math.sqrt(252);
}

function calcSharpeFromReturns(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  return std === 0 ? 0 : (mean / std) * Math.sqrt(252);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
