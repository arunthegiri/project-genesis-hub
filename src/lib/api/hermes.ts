// Loader for the Hermes C++ backtest output.
//
// This deliberately does NOT use the apiFetch() helper (which targets the Spring
// backend). The Hermes backtest result is a STATIC JSON file served by the
// frontend's own Vite dev server from `public/hermes/rf_v1_backtest.json`.

export interface HermesModel {
  name: string;
  version: string;
  strategyName: string;
  status: string;
  featureCount: number;
  symbols: string[];
  buyThreshold: number;
  sellThreshold: number;
  engine: string;
  generatedAt: string;
}

export interface HermesPerformance {
  symbol: string;
  fromTs: string;
  toTs: string;
  startingCapital: number;
  endingCapital: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number; // 0..1
  totalPnl: number;
  totalPnlPct: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
}

export interface HermesEquityPoint {
  t: string; // ISO time
  equity: number;
}

export interface HermesTrade {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  pnlPct: number;
  reason: string;
}

export interface HermesBacktest {
  model: HermesModel;
  performance: HermesPerformance;
  equity: HermesEquityPoint[];
  trades: HermesTrade[];
  /** Present (true) only in the development sample fixture; absent in real C++ output. */
  _sample?: boolean;
}

/** Thrown when the static backtest file is missing (404). */
export class HermesNotFoundError extends Error {
  constructor(message = "Hermes backtest file not found") {
    super(message);
    this.name = "HermesNotFoundError";
  }
}

const HERMES_BACKTEST_URL = "/hermes/rf_v1_backtest.json";

export async function fetchHermesBacktest(): Promise<HermesBacktest> {
  let res: Response;
  try {
    res = await fetch(HERMES_BACKTEST_URL, { headers: { Accept: "application/json" } });
  } catch (e) {
    throw new Error(`Network error loading Hermes backtest: ${(e as Error).message}`);
  }

  if (res.status === 404) {
    throw new HermesNotFoundError();
  }
  if (!res.ok) {
    throw new Error(`Failed to load Hermes backtest: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as HermesBacktest;
}
