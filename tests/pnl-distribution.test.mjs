/**
 * §15.4 unit test — the B9 distribution bindings.
 *
 * The thing worth testing here is the TIME ZONE: buckets are Eastern, so a
 * trade stamped 20:45 UTC belongs to the 16:00 ET hour, and a Friday-evening
 * UTC timestamp can be a Friday ET afternoon. Run: npm run test:distribution
 */

import assert from "node:assert/strict";
import {
  pnlByDayOfWeek,
  pnlByHourOfDay,
  pnlByOutcome,
} from "../src/lib/pnl-distribution.ts";

const trade = (entry, pnl, pct = 1) => ({
  trade_id: `${entry}-${pnl}`,
  direction: "long",
  entry_time: entry,
  entry_price: 100,
  exit_time: entry,
  exit_price: 101,
  quantity: 1,
  stop_loss: null,
  take_profit: null,
  status: "closed",
  pnl,
  pnl_pct: pct,
  win: pnl > 0,
});

// ── Time of day is ET, not UTC ──────────────────────────────────────────────
// 2026-08-12 is EDT (UTC−4): 13:45Z → 09:45 ET (the open), 20:15Z → 16:15 ET.
const hours = pnlByHourOfDay([
  trade("2026-08-12T13:45:00Z", 100),
  trade("2026-08-12T13:50:00Z", 50),
  trade("2026-08-12T20:15:00Z", -30),
]);
assert.deepEqual(
  hours,
  [
    { label: "09:00", value: 150, count: 2 },
    { label: "16:00", value: -30, count: 1 },
  ],
  "hours must bucket in ET and drop empty buckets",
);

// Winter timestamp, EST (UTC−5): 14:45Z → 09:45 ET, same 09:00 bucket.
const winter = pnlByHourOfDay([trade("2026-01-13T14:45:00Z", 10)]);
assert.equal(winter[0].label, "09:00", "DST must be derived, not assumed");

// ── Day of week, ET, weekdays only ──────────────────────────────────────────
// 2026-08-12 is a Wednesday; 2026-08-15 is a Saturday (no session → dropped).
const days = pnlByDayOfWeek([
  trade("2026-08-12T14:00:00Z", 20),
  trade("2026-08-14T14:00:00Z", -5),
  trade("2026-08-15T14:00:00Z", 999),
]);
assert.deepEqual(days, [
  { label: "Wed", value: 20, count: 1 },
  { label: "Fri", value: -5, count: 1 },
]);
assert.ok(!days.some((d) => d.value === 999), "weekend trades have no weekday bucket");

// A Monday-morning ET trade stamped the previous UTC day would be misfiled by
// a naive UTC bucketer; 2026-08-17T00:30Z is Sunday 20:30 ET → dropped.
assert.deepEqual(pnlByDayOfWeek([trade("2026-08-17T00:30:00Z", 1)]), []);

// ── Outcome buckets ─────────────────────────────────────────────────────────
const outcome = pnlByOutcome([
  trade("2026-08-12T14:00:00Z", -500, -7),
  trade("2026-08-12T14:01:00Z", -100, -1.2),
  trade("2026-08-12T14:02:00Z", 40, 0.5),
  trade("2026-08-12T14:03:00Z", 900, 8),
  trade("2026-08-12T14:04:00Z", 300, 3),
]);
assert.deepEqual(outcome.map((r) => r.label), ["≤ −5%", "−2…0%", "0…2%", "2…5%", "≥ 5%"]);
assert.equal(outcome.find((r) => r.label === "≥ 5%").value, 900);
assert.equal(outcome.reduce((s, r) => s + r.count, 0), 5, "every trade lands in exactly one bucket");

// Boundaries are [min, max): exactly 2% belongs to "2…5%", not "0…2%".
const edge = pnlByOutcome([trade("2026-08-12T14:00:00Z", 1, 2)]);
assert.equal(edge[0].label, "2…5%");

// ── Missing data is skipped, never counted as zero ──────────────────────────
const withNulls = pnlByHourOfDay([
  trade("2026-08-12T13:45:00Z", null),
  trade("not-a-date", 100),
  trade("2026-08-12T13:46:00Z", 25),
]);
assert.deepEqual(withNulls, [{ label: "09:00", value: 25, count: 1 }]);

console.log("pnl-distribution: OK");
