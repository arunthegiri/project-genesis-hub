import { nanoid } from "nanoid";
import { technicalIndicators } from "./technicalIndicators";

export type TradeRecord = {
  trade_id: string;
  direction: "long" | "short";
  entry_time: string;
  entry_price: number;
  exit_time: string;
  exit_price: number;
  quantity: number;
  stop_loss: number | null;
  take_profit: number | null;
  status: string;
  pnl: number;
  pnl_pct: number;
  win: boolean;
};

export type BacktestResult = {
  symbol: string;
  fromTs: string | null;
  toTs: string | null;
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
  profitFactor: number | null;
  maxDrawdown: number;
  sharpeRatio: number;
  trades: TradeRecord[];
  equityCurve: { time: string; cumulativePnl: number }[];
};

export type BarData = {
  time: Date | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type OpenTrade = {
  isLong: boolean;
  entryTime: Date;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
};

// --- Math & Output Builders ---

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function calcMaxDrawdown(equity: number[]): number {
  let peak = 0;
  let maxDd = 0;
  for (const val of equity) {
    if (val > peak) peak = val;
    const dd = peak > 0 ? ((peak - val) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return round4(maxDd);
}

function calcSharpe(trades: TradeRecord[]): number {
  if (trades.length < 2) return 0.0;
  const returns = trades.map((t) => t.pnl_pct / 100.0);
  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / (n - 1);
  const std = Math.sqrt(variance);
  return std === 0 ? 0.0 : round4((mean / std) * Math.sqrt(252));
}

function closeTrade(
  t: OpenTrade,
  exitTime: Date,
  exitPrice: number,
  quantity: number
): TradeRecord {
  const rawPnl = t.isLong
    ? (exitPrice - t.entryPrice) * quantity
    : (t.entryPrice - exitPrice) * quantity;

  const pnl = round4(rawPnl);
  const pnlPct = round4(((exitPrice - t.entryPrice) / t.entryPrice) * 100 * (t.isLong ? 1 : -1));

  return {
    trade_id: nanoid(),
    direction: t.isLong ? "long" : "short",
    entry_time: t.entryTime.toISOString(),
    entry_price: round4(t.entryPrice),
    exit_time: exitTime.toISOString(),
    exit_price: round4(exitPrice),
    quantity,
    stop_loss: Number.isNaN(t.stopLoss) ? null : t.stopLoss,
    take_profit: Number.isNaN(t.takeProfit) ? null : t.takeProfit,
    status: "closed",
    pnl,
    pnl_pct: pnlPct,
    win: pnl >= 0,
  };
}

function buildResult(
  symbol: string,
  bars: BarData[],
  trades: TradeRecord[],
  equityData: { time: Date; pnl: number }[]
): BacktestResult {
  const total = trades.length;
  const winning = trades.filter((t) => t.win).length;
  const losing = total - winning;
  const winRate = total > 0 ? round4((winning * 100.0) / total) : 0.0;

  const pnls = trades.map((t) => t.pnl);
  const winPnls = trades.filter((t) => t.win).map((t) => t.pnl);
  const losPnls = trades.filter((t) => !t.win).map((t) => t.pnl);

  const totalPnl = round4(pnls.reduce((a, b) => a + b, 0));
  const avgWin = winPnls.length ? round4(winPnls.reduce((a, b) => a + b, 0) / winPnls.length) : 0;
  const avgLoss = losPnls.length ? round4(losPnls.reduce((a, b) => a + b, 0) / losPnls.length) : 0;
  const largestWin = pnls.length ? round4(Math.max(...pnls)) : 0;
  const largestLoss = pnls.length ? round4(Math.min(...pnls)) : 0;

  const winSum = winPnls.reduce((a, b) => a + b, 0);
  const lossAbs = Math.abs(losPnls.reduce((a, b) => a + b, 0));

  let profitFactor: number | null = null;
  if (winPnls.length && losPnls.length) {
    profitFactor = round4(winSum / lossAbs);
  } else if (winPnls.length && !losPnls.length) {
    profitFactor = null; // Only wins, mathematically infinite or undefined per Java spec mappings
  } else {
    profitFactor = 0;
  }

  const equityValues = equityData.map((e) => e.pnl);
  const maxDrawdown = calcMaxDrawdown(equityValues);
  const sharpe = calcSharpe(trades);
  const totalPnlPct = round4(trades.reduce((a, b) => a + b.pnl_pct, 0));

  const equityCurve = equityData.map((e) => ({
    time: e.time.toISOString(),
    cumulativePnl: round4(e.pnl),
  }));

  const fromTs = bars.length ? new Date(bars[0].time).toISOString() : null;
  const toTs = bars.length ? new Date(bars[bars.length - 1].time).toISOString() : null;

  return {
    symbol,
    fromTs,
    toTs,
    totalTrades: total,
    winningTrades: winning,
    losingTrades: losing,
    winRate,
    totalPnl,
    totalPnlPct,
    avgWin,
    avgLoss,
    largestWin,
    largestLoss,
    profitFactor,
    maxDrawdown,
    sharpeRatio: sharpe,
    trades,
    equityCurve,
  };
}

// --- Engines ---

function runRsiCrossover(
  def: Record<string, any>,
  bars: BarData[],
  symbol: string
): BacktestResult {
  const period = def.rsi_period ?? 14;
  const longEntryBelow = def.long_entry_rsi_below ?? NaN;
  const shortEntryAbove = def.short_entry_rsi_above ?? NaN;
  const longExitAbove = def.long_exit_rsi_above ?? NaN;
  const shortExitBelow = def.short_exit_rsi_below ?? NaN;
  const stopLoss = def.stop_loss ?? NaN;
  const takeProfitPct = def.take_profit ?? NaN;
  const quantity = def.quantity ?? 1.0;

  const hasLong = !Number.isNaN(longEntryBelow);
  const hasShort = !Number.isNaN(shortEntryAbove);

  const closes = bars.map((b) => b.close);
  const rsiVals = technicalIndicators.rsi(closes, period);

  const trades: TradeRecord[] = [];
  const equityData: { time: Date; pnl: number }[] = [];

  let openTrade: OpenTrade | null = null;
  let cumPnl = 0.0;

  for (let i = 0; i < bars.length; i++) {
    const current = bars[i];
    const currentTime = new Date(current.time);
    const next = i < bars.length - 1 ? bars[i + 1] : null;
    const rsi = rsiVals[i];
    const rsiReady = !Number.isNaN(rsi);

    if (openTrade) {
      const trade = openTrade;
      let closed = false;
      const price = current.close;

      // Stop Loss Check
      if (!closed && !Number.isNaN(stopLoss)) {
        const slHit = trade.isLong
          ? price < trade.entryPrice * (1 - stopLoss)
          : price > trade.entryPrice * (1 + stopLoss);
        if (slHit) {
          const t = closeTrade(trade, currentTime, price, quantity);
          trades.push(t);
          cumPnl += t.pnl;
          openTrade = null;
          closed = true;
        }
      }

      // Take Profit Check
      if (!closed && !Number.isNaN(takeProfitPct)) {
        const tpHit = trade.isLong
          ? price > trade.entryPrice * (1 + takeProfitPct)
          : price < trade.entryPrice * (1 - takeProfitPct);
        if (tpHit) {
          const t = closeTrade(trade, currentTime, price, quantity);
          trades.push(t);
          cumPnl += t.pnl;
          openTrade = null;
          closed = true;
        }
      }

      // RSI Exit Checks
      if (!closed && rsiReady) {
        const exitLong = trade.isLong && !Number.isNaN(longExitAbove) && rsi > longExitAbove;
        const exitShort = !trade.isLong && !Number.isNaN(shortExitBelow) && rsi < shortExitBelow;
        if (exitLong || exitShort) {
          const t = closeTrade(trade, currentTime, price, quantity);
          trades.push(t);
          cumPnl += t.pnl;
          openTrade = null;
          closed = true;
        }
      }

      // Force close on last bar
      if (!closed && !next) {
        const t = closeTrade(trade, currentTime, price, quantity);
        trades.push(t);
        cumPnl += t.pnl;
        openTrade = null;
      }
    } else if (next && rsiReady) {
      const entryPrice = next.open;
      const nextTime = new Date(next.time);

      if (hasLong && rsi < longEntryBelow) {
        openTrade = { isLong: true, entryTime: nextTime, entryPrice, stopLoss, takeProfit: takeProfitPct };
      } else if (hasShort && rsi > shortEntryAbove) {
        openTrade = { isLong: false, entryTime: nextTime, entryPrice, stopLoss, takeProfit: takeProfitPct };
      }
    }

    equityData.push({ time: currentTime, pnl: cumPnl });
  }

  return buildResult(symbol, bars, trades, equityData);
}

function runEmaCrossover(
  def: Record<string, any>,
  bars: BarData[],
  symbol: string
): BacktestResult {
  const fastPeriod = def.fast_period ?? 9;
  const slowPeriod = def.slow_period ?? 21;
  const stopLoss = def.stop_loss ?? NaN;
  const takeProfit = def.take_profit ?? NaN;
  const quantity = def.quantity ?? 1.0;

  const closes = bars.map((b) => b.close);
  const fast = technicalIndicators.ema(closes, fastPeriod);
  const slow = technicalIndicators.ema(closes, slowPeriod);

  const trades: TradeRecord[] = [];
  const equityData: { time: Date; pnl: number }[] = [];
  let openTrade: OpenTrade | null = null;
  let cumPnl = 0.0;

  for (let i = 0; i < bars.length; i++) {
    const current = bars[i];
    const currentTime = new Date(current.time);
    const next = i < bars.length - 1 ? bars[i + 1] : null;

    const goldenCross = i > 0 && fast[i] > slow[i] && fast[i - 1] <= slow[i - 1];
    const deathCross = i > 0 && fast[i] < slow[i] && fast[i - 1] >= slow[i - 1];

    if (openTrade) {
      const trade = openTrade;
      let closed = false;
      const price = current.close;

      if (!closed && !Number.isNaN(stopLoss)) {
        const slHit = trade.isLong
          ? price < trade.entryPrice * (1 - stopLoss)
          : price > trade.entryPrice * (1 + stopLoss);
        if (slHit) {
          const t = closeTrade(trade, currentTime, price, quantity);
          trades.push(t);
          cumPnl += t.pnl;
          openTrade = null;
          closed = true;
        }
      }

      if (!closed && !Number.isNaN(takeProfit)) {
        const tpHit = trade.isLong
          ? price > trade.entryPrice * (1 + takeProfit)
          : price < trade.entryPrice * (1 - takeProfit);
        if (tpHit) {
          const t = closeTrade(trade, currentTime, price, quantity);
          trades.push(t);
          cumPnl += t.pnl;
          openTrade = null;
          closed = true;
        }
      }

      if (!closed && ((trade.isLong && deathCross) || (!trade.isLong && goldenCross))) {
        const t = closeTrade(trade, currentTime, price, quantity);
        trades.push(t);
        cumPnl += t.pnl;
        openTrade = null;
        closed = true;
      }

      if (!closed && !next) {
        const t = closeTrade(trade, currentTime, price, quantity);
        trades.push(t);
        cumPnl += t.pnl;
        openTrade = null;
      }
    } else if (next) {
      const entryPrice = next.open;
      const nextTime = new Date(next.time);

      if (goldenCross) {
        openTrade = { isLong: true, entryTime: nextTime, entryPrice, stopLoss, takeProfit };
      } else if (deathCross) {
        openTrade = { isLong: false, entryTime: nextTime, entryPrice, stopLoss, takeProfit };
      }
    }

    equityData.push({ time: currentTime, pnl: cumPnl });
  }

  return buildResult(symbol, bars, trades, equityData);
}

// --- Main Engine Interface ---

export const backtestEngine = {
  /**
   * Re-runs a stored strategy definition against a new set of price bars.
   * Mirrors the bar-by-bar logic in ananke-sdk/ananke/kairos.py.
   *
   * @param strategyDefinition The raw definition config object.
   * @param bars Formatted chronological bars sequence.
   * @param symbol The trading symbol to be evaluated.
   */
  run(
    strategyDefinition: Record<string, any>,
    bars: BarData[],
    symbol: string
  ): BacktestResult {
    const type = strategyDefinition.type || "generic";

    if (bars.length === 0) {
      return buildResult(symbol, [], [], []);
    }

    if (type === "rsi_crossover") {
      return runRsiCrossover(strategyDefinition, bars, symbol);
    } else if (type === "ema_crossover") {
      return runEmaCrossover(strategyDefinition, bars, symbol);
    } else {
      throw new Error(
        `Strategy type '${type}' cannot be re-run from the dashboard. ` +
        `Use params={"type":"rsi_crossover",...} when calling k.export().`
      );
    }
  },
};