import type { Interval } from "./api/types";

/**
 * Single interval policy registry (build doc Q4): one table shared by the
 * auto-suggestion logic, the interval picker, query-key bucketing, and —
 * later — the server-side cagg ladder. Change policy here, nowhere else.
 */

export const INTERVAL_MS: Record<Interval, number> = {
  "1Min": 60_000,
  "5Min": 5 * 60_000,
  "15Min": 15 * 60_000,
  "30Min": 30 * 60_000,
  "1Hour": 60 * 60_000,
  "1Day": 24 * 60 * 60_000,
};

export function intervalMs(interval: Interval): number {
  return INTERVAL_MS[interval];
}

/** Span → interval ladder. First rule whose maxDays covers the span wins. */
export const SPAN_TABLE: ReadonlyArray<{ maxDays: number; interval: Interval }> = [
  { maxDays: 3, interval: "1Min" },
  { maxDays: 15, interval: "5Min" },
  { maxDays: 60, interval: "15Min" },
  { maxDays: 200, interval: "1Hour" },
  { maxDays: Infinity, interval: "1Day" },
];

export function intervalForSpanDays(days: number): Interval {
  for (const rule of SPAN_TABLE) {
    if (days <= rule.maxDays) return rule.interval;
  }
  return "1Day";
}

/**
 * Snap an API range OUTWARD to stable bucket boundaries so overlapping pans
 * hit the React Query cache and only bucket-boundary crossings mint a new
 * query key. Intraday intervals snap to UTC days; 1Day snaps to UTC months.
 */
export function snapRange(
  fromIso: string,
  toIso: string,
  interval: Interval,
): { snappedFrom: string; snappedTo: string } {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { snappedFrom: fromIso, snappedTo: toIso };
  }

  if (interval === "1Day") {
    const snappedFrom = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    // First day of the month AFTER `to`, exclusive-ish: end of the `to` month.
    const snappedTo = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 1));
    return { snappedFrom: snappedFrom.toISOString(), snappedTo: snappedTo.toISOString() };
  }

  const snappedFrom = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const snappedTo = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() + 1),
  );
  return { snappedFrom: snappedFrom.toISOString(), snappedTo: snappedTo.toISOString() };
}
