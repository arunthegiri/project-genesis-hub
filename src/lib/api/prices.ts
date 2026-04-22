import { apiFetch } from "./client";
import type { PriceBar } from "./types";

export const pricesApi = {
  latest: (symbol: string, hours = 1) =>
    apiFetch<PriceBar[]>(`/api/prices/${encodeURIComponent(symbol)}/latest`, {
      query: { hours },
    }),

  range: (symbol: string, from: string, to: string) =>
    apiFetch<PriceBar[]>(`/api/prices/${encodeURIComponent(symbol)}/range`, {
      query: { from, to },
    }),

  fetchNow: () => apiFetch<void>("/api/prices/fetch", { method: "POST" }),

  backfill: (symbol: string, from: string, to: string) =>
    apiFetch<void>(`/api/prices/${encodeURIComponent(symbol)}/backfill`, {
      method: "POST",
      query: { from, to },
    }),
};
