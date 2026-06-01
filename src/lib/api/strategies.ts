import { apiFetch } from "./client";

// Trades come from the Python SDK (snake_case keys passed through as-is)
export interface BacktestTrade {
  trade_id: string;
  direction: "long" | "short";
  entry_time: string;
  entry_price: number;
  exit_time: string | null;
  exit_price: number | null;
  quantity: number;
  stop_loss: number | null;
  take_profit: number | null;
  status: "open" | "closed";
  pnl: number | null;
  pnl_pct: number | null;
  win: boolean | null;
}

export interface EquityPoint {
  time: string;
  cumulative_pnl: number;
}

// Outer fields are camelCase (Java/Spring JSON serialization)
export interface BacktestResults {
  id: number;
  symbol: string | null;
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
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  createdAt: string;
}

export interface StrategyListItem {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface StrategyDetail {
  id: number;
  name: string;
  description: string | null;
  definition: Record<string, unknown>;
  latestResults: BacktestResults | null;
  createdAt: string;
}

export const strategiesApi = {
  list: (): Promise<StrategyListItem[]> =>
    apiFetch("/api/strategies"),

  get: (name: string): Promise<StrategyDetail> =>
    apiFetch(`/api/strategies/${encodeURIComponent(name)}`),

  /** Re-run the strategy on a new symbol/date range. Results are NOT saved. */
  run: (name: string, symbol: string, fromTs: string, toTs: string): Promise<BacktestResults> =>
    apiFetch(`/api/strategies/${encodeURIComponent(name)}/run`, {
      method: "POST",
      body: { symbol, fromTs, toTs },
    }),
};
