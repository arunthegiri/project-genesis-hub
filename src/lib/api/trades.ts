import { apiFetch, ApiError } from "./client";
import type { Trade } from "./types";

/**
 * Quarantined client for `/api/trades/range` — the endpoint is NOT implemented
 * on the backend (see build doc Q10). Callers must handle the failure modes
 * explicitly instead of receiving a silent empty array that reads as
 * "no trades."
 */
export type TradesResult =
  | { ok: true; trades: Trade[] }
  | { ok: false; reason: "endpoint-missing" | "network" };

export const tradesApi = {
  range: (symbol: string, from: string, to: string) =>
    apiFetch<Trade[]>("/api/trades/range", {
      query: { symbol, from, to },
    }),

  /** Never throws — failures come back as a discriminated result. */
  rangeSafe: async (symbol: string, from: string, to: string): Promise<TradesResult> => {
    try {
      const trades = await tradesApi.range(symbol, from, to);
      return { ok: true, trades };
    } catch (e) {
      // 404/501 → the route doesn't exist on the backend; anything else
      // (status 0 network failure, 5xx) is an environment problem.
      const reason =
        e instanceof ApiError && (e.status === 404 || e.status === 501)
          ? "endpoint-missing"
          : "network";
      return { ok: false, reason };
    }
  },
};
