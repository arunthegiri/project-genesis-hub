import { apiFetch } from "./client";
import type { Symbol } from "./types";

export const symbolsApi = {
  list: () => apiFetch<Symbol[] | string[]>("/api/symbols"),
  add: (symbol: string) =>
    apiFetch<Symbol>("/api/symbols", { method: "POST", body: { symbol } }),
  remove: (symbol: string) =>
    apiFetch<void>(`/api/symbols/${encodeURIComponent(symbol)}`, { method: "DELETE" }),
};

/** Normalize backend response (could be string[], {symbol}[], or wrapped {symbols:[...]}) */
export function normalizeSymbols(raw: unknown): string[] {
  if (!raw) return [];
  // Unwrap common envelope shapes
  let arr: unknown = raw;
  if (!Array.isArray(arr) && typeof arr === "object") {
    const obj = arr as Record<string, unknown>;
    arr = obj.symbols ?? obj.data ?? obj.content ?? obj.items ?? [];
  }
  if (!Array.isArray(arr)) {
    console.warn("[symbols] Unexpected response shape:", raw);
    return [];
  }
  return arr
    .map((s) => (typeof s === "string" ? s : (s as Symbol)?.symbol))
    .filter((s): s is string => Boolean(s));
}
