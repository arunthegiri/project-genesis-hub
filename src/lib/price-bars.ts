import type { Interval, PriceBar } from './api/types';

export function intervalForSpan(days: number): Interval {
  if (days > 365) return '1Day';
  if (days > 90)  return '1Hour';
  if (days > 14)  return '15Min';
  if (days > 3)   return '5Min';
  return '1Min';
}

const INTERVAL_TO_MS: Record<Interval, number> = {
  '1Min': 60_000,
  '5Min': 5 * 60_000,
  '15Min': 15 * 60_000,
  '30Min': 30 * 60_000,
  '1Hour': 60 * 60_000,
  '1Day': 24 * 60 * 60_000,
};

/**
 * Formats the New York (ET) calendar date for an instant, e.g. "2026-03-10".
 * `en-CA` yields the ISO `YYYY-MM-DD` ordering; the `America/New_York` time
 * zone makes the boundary DST-correct without a third-party tz library.
 */
const ET_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Bucket key (epoch ms) for a bar at `ms` under the given interval.
 *
 * Daily bars are grouped by ET trading session, not UTC midnight: an entire
 * session (regular + extended hours) shares one ET calendar date, so keying on
 * that date anchors each daily bar — and its VWAP reset — at the 9:30 AM ET open
 * while remaining DST-safe. Intraday intervals use plain epoch-modulo bucketing,
 * which already aligns with ET because ET's offset from UTC is a whole number of
 * hours.
 */
function bucketKeyFor(ms: number, interval: Interval): number {
  if (interval === '1Day') {
    return Date.parse(`${ET_DATE_FMT.format(new Date(ms))}T00:00:00Z`);
  }
  const bucketSize = INTERVAL_TO_MS[interval];
  return ms - (ms % bucketSize);
}

export function aggregatePriceBars(bars: PriceBar[], interval: Interval): PriceBar[] {
  if (interval === '1Min') {
    return [...bars].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  }

  const sortedBars = [...bars].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const buckets = new Map<number, PriceBar>();
  // Σ(typicalPrice × volume) and Σ(volume) per bucket, kept alongside the bar so
  // VWAP can be finalised as a true volume-weighted average once folding is done.
  const vwapAcc = new Map<number, { num: number; den: number }>();

  for (const bar of sortedBars) {
    const timestamp = new Date(bar.time).getTime();
    const bucketStart = bucketKeyFor(timestamp, interval);
    // Typical price (HLC3) is the price TradingView weights VWAP by.
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    const existing = buckets.get(bucketStart);

    if (!existing) {
      buckets.set(bucketStart, {
        ...bar,
        time: new Date(bucketStart).toISOString(),
      });
      vwapAcc.set(bucketStart, { num: typicalPrice * bar.volume, den: bar.volume });
      continue;
    }

    existing.high = Math.max(existing.high, bar.high);
    existing.low = Math.min(existing.low, bar.low);
    existing.close = bar.close;
    existing.volume += bar.volume;
    existing.tradeCount = (existing.tradeCount ?? 0) + (bar.tradeCount ?? 0);

    const acc = vwapAcc.get(bucketStart)!;
    acc.num += typicalPrice * bar.volume;
    acc.den += bar.volume;
  }

  // Finalise VWAP from the accumulators. With zero traded volume in a bucket
  // there is no weighting to apply, so fall back to the seed bar's own vwap.
  for (const [key, bar] of buckets) {
    const acc = vwapAcc.get(key)!;
    bar.vwap = acc.den > 0 ? acc.num / acc.den : (bar.vwap ?? null);
  }

  return Array.from(buckets.values());
}
