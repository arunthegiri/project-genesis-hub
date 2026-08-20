import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";

import { liveApi, type PositionData } from "@/lib/api/live";
import { getRailBarsSnapshot, subscribeRailBars } from "@/lib/stores/last-bar-registry";
import { seedQuote } from "@/lib/realtime/symbol-stores";

/**
 * What the ticker tape shows (build doc §14.1, plan §3.3).
 *
 * The two sources reconcile a difference between the two documents, and the
 * order encodes the answer: the PLAN says the tape shows live positions (this
 * is a trading terminal — the tape should be your money, not a market feed);
 * the BUILD DOC says feed it the polled last-bar registry (that source works
 * today with no backend). Both are right, so positions come first and the
 * symbols you are charting fill the rest. Flat with one chart open still gives
 * a tape; a funded account gets its book.
 *
 * Every item is also SEEDED into the per-symbol realtime stores here. That is
 * the one sanctioned meeting point between Query and the stream (§14.2
 * snapshot-then-delta) — after the seed, a live socket owns the value and the
 * poll only refreshes the session reference.
 */
export interface TickerItem {
  symbol: string;
  /** Cold last price. The store holds the value actually rendered. */
  last: number | null;
  /** Change reference — previous close. */
  prevClose: number | null;
  origin: "position" | "chart";
}

const parse = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
};

export function useTickerItems(enabled: boolean): TickerItem[] {
  // Same query key as /live, so the two observers share one cache entry and
  // one in-flight request; the rail just polls it more gently.
  const positionsQ = useQuery({
    queryKey: ["live", "positions"],
    queryFn: liveApi.positions,
    refetchInterval: 30_000,
    retry: false,
    enabled,
  });

  const railBars = useSyncExternalStore(
    subscribeRailBars,
    getRailBarsSnapshot,
    getRailBarsSnapshot,
  );

  // Read inside the memo, not above it: `positionsQ.data ?? []` allocates a new
  // array on every render while the query is empty, which would give `items` a
  // new identity every render and re-run the seeding effect forever.
  const items = useMemo<TickerItem[]>(() => {
    const positions: PositionData[] = positionsQ.data ?? [];
    const out: TickerItem[] = [];
    const seen = new Set<string>();
    for (const p of positions) {
      if (!p.symbol || seen.has(p.symbol)) continue;
      seen.add(p.symbol);
      out.push({
        symbol: p.symbol,
        last: parse(p.currentPrice),
        prevClose: parse(p.lastdayPrice),
        origin: "position",
      });
    }
    for (const b of railBars) {
      if (seen.has(b.symbol)) continue;
      seen.add(b.symbol);
      out.push({ symbol: b.symbol, last: b.close, prevClose: b.prevClose, origin: "chart" });
    }
    return out;
  }, [positionsQ.data, railBars]);

  // Seed after render, not during: seedQuote notifies subscribers, and a store
  // write inside a render body would notify mid-commit.
  useEffect(() => {
    for (const item of items) {
      seedQuote(item.symbol, { last: item.last, prevClose: item.prevClose });
    }
  }, [items]);

  return items;
}
