import type { BacktestTrade } from "@/lib/api/strategies";

/**
 * B9 PnL distribution bindings (build doc §15.4, plan §4.9) — one renderer,
 * three data bindings. All pure, so the numbers are testable without a DOM
 * (tests/pnl-distribution.test.mjs).
 *
 * Everything buckets on EASTERN time. A trade at 21:30 UTC is a 16:30 ET
 * after-hours trade, and bucketing it in the UTC hour would put the closing
 * bell in the middle of the night — the whole point of a time-of-day
 * distribution is where it sits in the SESSION.
 */

export interface DistributionRow {
  label: string;
  /** Sum of PnL in the bucket (currency units). */
  value: number;
  /** Trades in the bucket — shown as the secondary number. */
  count: number;
}

const ET_HOUR = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  hourCycle: "h23",
});

const ET_WEEKDAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
});

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const pnlOf = (t: BacktestTrade): number | null =>
  t.pnl === null || t.pnl === undefined || Number.isNaN(t.pnl) ? null : t.pnl;

function accumulate(
  trades: readonly BacktestTrade[],
  keyOf: (t: BacktestTrade) => string | null,
  order: string[],
): DistributionRow[] {
  const sums = new Map<string, { value: number; count: number }>();
  for (const trade of trades) {
    const pnl = pnlOf(trade);
    if (pnl === null) continue;
    const key = keyOf(trade);
    if (key === null) continue;
    const bucket = sums.get(key) ?? { value: 0, count: 0 };
    bucket.value += pnl;
    bucket.count += 1;
    sums.set(key, bucket);
  }
  return order
    .map((label) => ({ label, ...(sums.get(label) ?? { value: 0, count: 0 }) }))
    .filter((row) => row.count > 0);
}

/** PnL by ET hour of ENTRY — "when in the session does this strategy work". */
export function pnlByHourOfDay(trades: readonly BacktestTrade[]): DistributionRow[] {
  const order = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
  return accumulate(
    trades,
    (t) => {
      const ms = Date.parse(t.entry_time);
      if (Number.isNaN(ms)) return null;
      return `${ET_HOUR.format(ms)}:00`;
    },
    order,
  );
}

/** PnL by ET weekday of entry. Weekends are dropped — no session, no bucket. */
export function pnlByDayOfWeek(trades: readonly BacktestTrade[]): DistributionRow[] {
  return accumulate(
    trades,
    (t) => {
      const ms = Date.parse(t.entry_time);
      if (Number.isNaN(ms)) return null;
      const day = ET_WEEKDAY.format(ms);
      return WEEKDAYS.includes(day) ? day : null;
    },
    WEEKDAYS,
  );
}

/**
 * Trade-outcome distribution: PnL summed into return buckets. This is the one
 * that shows whether the edge is a few large winners or many small ones — the
 * question a win-rate percentage cannot answer.
 */
const OUTCOME_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "≤ −5%", min: -Infinity, max: -5 },
  { label: "−5…−2%", min: -5, max: -2 },
  { label: "−2…0%", min: -2, max: 0 },
  { label: "0…2%", min: 0, max: 2 },
  { label: "2…5%", min: 2, max: 5 },
  { label: "≥ 5%", min: 5, max: Infinity },
];

export function pnlByOutcome(trades: readonly BacktestTrade[]): DistributionRow[] {
  return accumulate(
    trades,
    (t) => {
      const pct = t.pnl_pct;
      if (pct === null || pct === undefined || Number.isNaN(pct)) return null;
      // pnl_pct arrives in percent units from the SDK (2.5 = +2.5%).
      const bucket = OUTCOME_BUCKETS.find((b) => pct >= b.min && pct < b.max);
      return bucket?.label ?? OUTCOME_BUCKETS[OUTCOME_BUCKETS.length - 1].label;
    },
    OUTCOME_BUCKETS.map((b) => b.label),
  );
}
