import { apiFetch } from "./client";
import type { Trade } from "./types";

export const tradesApi = {
  range: (symbol: string, from: string, to: string) =>
    apiFetch<Trade[]>("/api/trades/range", {
      query: { symbol, from, to },
    }),
};
