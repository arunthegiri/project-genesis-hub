/**
 * §15.3 unit test — "blackout windows serialize to the exact shape the risk
 * manager consumes" (build doc §15 verify block).
 *
 * Runs in plain node against the TS source (node 24 strips types natively),
 * which is why lib/event-calendar.ts imports its siblings relatively.
 *
 * Run: npm run test:calendar
 */

import assert from "node:assert/strict";
import {
  allEvents,
  blackoutWindows,
  inBlackout,
  mergeFredDates,
  scheduleIsStale,
  upcomingEvents,
  VERIFIED_THROUGH,
} from "../src/lib/event-calendar.ts";

const events = allEvents();

// ── The schedule itself ─────────────────────────────────────────────────────
assert.ok(events.length >= 40, `expected the maintained schedule, got ${events.length} events`);
for (const e of events) {
  assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, `bad date: ${e.date}`);
  assert.match(e.time, /^\d{2}:\d{2}$/, `bad time: ${e.time}`);
  assert.ok(Number.isFinite(e.at), `unresolved instant for ${e.id}`);
  assert.equal(e.id, `${e.kind}-${e.date}`);
}
// Chronological, no duplicate ids.
for (let i = 1; i < events.length; i++) assert.ok(events[i].at >= events[i - 1].at);
assert.equal(new Set(events.map((e) => e.id)).size, events.length, "duplicate event id");

// ── DST is derived, never hardcoded ─────────────────────────────────────────
// 08:30 ET is 12:30 UTC under EDT and 13:30 UTC under EST. Both must appear,
// which is only true if the offset comes from Intl rather than a constant.
const cpiUtcHours = new Set(
  events.filter((e) => e.kind === "CPI").map((e) => new Date(e.at).getUTCHours()),
);
assert.deepEqual([...cpiUtcHours].sort(), [12, 13], `CPI UTC hours were ${[...cpiUtcHours]}`);

// A summer release (Aug 12 2026, EDT) is 12:30 UTC exactly.
const augCpi = events.find((e) => e.id === "CPI-2026-08-12");
assert.ok(augCpi, "missing the August 2026 CPI release");
assert.equal(new Date(augCpi.at).toISOString(), "2026-08-12T12:30:00.000Z");

// ── Window shape: the contract the risk manager consumes ────────────────────
const windows = blackoutWindows(events);
assert.equal(windows.length, events.length);
for (const w of windows) {
  assert.deepEqual(Object.keys(w).sort(), ["eventId", "from", "kind", "to"]);
  assert.equal(typeof w.from, "number");
  assert.equal(typeof w.to, "number");
  assert.ok(w.to > w.from, "window must be non-empty");
  assert.equal(w.to - w.from, 30 * 60_000, "default margin is ±15 minutes");
}
for (let i = 1; i < windows.length; i++) {
  assert.ok(windows[i].from >= windows[i - 1].from, "windows must be sorted by start");
}

// Configurable margin, asymmetric on purpose (a release keeps moving after it
// lands, so `after` is usually the larger side).
const wide = blackoutWindows([augCpi], { beforeMin: 5, afterMin: 45 });
assert.equal(wide[0].from, augCpi.at - 5 * 60_000);
assert.equal(wide[0].to, augCpi.at + 45 * 60_000);

// Kind filter.
const fedOnly = blackoutWindows(events, { kinds: ["FOMC"] });
assert.ok(fedOnly.length > 0);
assert.ok(fedOnly.every((w) => w.kind === "FOMC"));

// ── inBlackout: half-open [from, to) ────────────────────────────────────────
const one = blackoutWindows([augCpi])[0];
assert.equal(inBlackout([one], one.from), true, "start is inside");
assert.equal(inBlackout([one], one.to - 1), true);
assert.equal(inBlackout([one], one.to), false, "end is exclusive");
assert.equal(inBlackout([one], one.from - 1), false);
assert.equal(inBlackout([], augCpi.at), false, "no windows means never blacked out");

// ── upcomingEvents ──────────────────────────────────────────────────────────
const anchor = Date.parse("2026-08-19T12:00:00Z");
const upcoming = upcomingEvents(anchor, 5);
assert.equal(upcoming.length, 5);
assert.ok(upcoming.every((e) => e.at >= anchor - 60 * 60_000));
assert.ok(upcoming[0].at <= upcoming[4].at);

// ── FRED merge: adds unknown dates, never overwrites a known one ────────────
const merged = mergeFredDates(events, [
  { kind: "CPI", date: "2027-01-13" },
  { kind: "CPI", date: "2026-08-12" }, // already known — must not duplicate
]);
assert.equal(merged.length, events.length + 1);
assert.equal(merged.filter((e) => e.id === "CPI-2026-08-12").length, 1);
const added = merged.find((e) => e.id === "CPI-2027-01-13");
assert.equal(added.time, "08:30", "BLS releases at 08:30 ET; FRED gives no time");

// ── Staleness horizon ───────────────────────────────────────────────────────
assert.equal(scheduleIsStale(Date.parse(`${VERIFIED_THROUGH}T00:00:00Z`)), false);
assert.equal(scheduleIsStale(Date.parse("2099-01-01T00:00:00Z")), true);

console.log(
  `event-calendar: OK (${events.length} events, ${windows.length} windows, verified through ${VERIFIED_THROUGH})`,
);
