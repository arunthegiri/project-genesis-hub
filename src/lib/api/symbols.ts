import { apiFetch } from "./client";
import type { Symbol } from "./types";

export const symbolsApi = {
  list: () => apiFetch<Symbol[] | string[]>("/api/symbols"),
  add: (symbol: string) =>
    apiFetch<Symbol>("/api/symbols", { method: "POST", body: { symbol } }),
  remove: (symbol: string) =>
    apiFetch<void>(`/api/symbols/${encodeURIComponent(symbol)}`, { method: "DELETE" }),
};

/** Normalize backend response (could be string[] or {symbol}[]) */
export function normalizeSymbols(raw: Symbol[] | string[] | null | undefined): string[] {
  if (!raw) return [];
  return raw.map((s) => (typeof s === "string" ? s : s.symbol)).filter(Boolean);
}
