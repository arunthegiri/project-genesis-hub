import { API_BASE_URL } from "./config";
import { apiFetch } from "./client";

export interface AccountData {
  id: string;
  accountNumber: string;
  status: string;
  currency: string;
  buyingPower: string;
  cash: string;
  portfolioValue: string;
  equity: string;
  lastEquity: string;
  longMarketValue: string;
  shortMarketValue: string;
  daytradingBuyingPower: string;
  regtBuyingPower: string;
}

export interface PositionData {
  symbol: string;
  side: string;
  qty: string;
  marketValue: string;
  costBasis: string;
  unrealizedPl: string;
  unrealizedPlPct: string;
  currentPrice: string;
  lastdayPrice: string;
  changeToday: string;
}

export interface ActiveStrategy {
  id: number;
  name: string;
  description: string;
  status: string;
  deployMode: string | null;
  createdAt: string;
}

export const liveApi = {
  /** Returns null when trading keys are not configured (204 response). */
  account: async (): Promise<AccountData | null> => {
    const res = await fetch(`${API_BASE_URL}/api/account`, {
      headers: { Accept: "application/json" },
    });
    if (res.status === 204) return null;
    if (!res.ok) return null;
    return res.json() as Promise<AccountData>;
  },

  /** Returns [] when trading keys are not configured. */
  positions: () => apiFetch<PositionData[]>("/api/positions"),

  /** Returns [] when no strategies are ACTIVE or STANDBY. */
  activeStrategies: () => apiFetch<ActiveStrategy[]>("/api/strategies/active"),
};
