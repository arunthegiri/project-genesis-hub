import type { Interval, PriceBar } from './api/types';

const INTERVAL_TO_MS: Record<Interval, number> = {
  '1Min': 60_000,
  '5Min': 5 * 60_000,
  '15Min': 15 * 60_000,
  '30Min': 30 * 60_000,
  '1Hour': 60 * 60_000,
  '1Day': 24 * 60 * 60_000,
};

export function aggregatePriceBars(bars: PriceBar[], interval: Interval): PriceBar[] {
  if (interval === '1Min') {
    return [...bars].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  }

  const bucketSize = INTERVAL_TO_MS[interval];
  const sortedBars = [...bars].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const buckets = new Map<number, PriceBar>();

  for (const bar of sortedBars) {
    const timestamp = new Date(bar.time).getTime();
    const bucketStart = timestamp - (timestamp % bucketSize);
    const existing = buckets.get(bucketStart);

    if (!existing) {
      buckets.set(bucketStart, {
        ...bar,
        time: new Date(bucketStart).toISOString(),
      });
      continue;
    }

    existing.high = Math.max(existing.high, bar.high);
    existing.low = Math.min(existing.low, bar.low);
    existing.close = bar.close;
    existing.volume += bar.volume;
    existing.vwap = bar.vwap ?? existing.vwap ?? null;
    existing.tradeCount = (existing.tradeCount ?? 0) + (bar.tradeCount ?? 0);
  }

  return Array.from(buckets.values());
}
