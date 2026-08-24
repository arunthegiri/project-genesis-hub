// Relative imports WITH the .ts extension (tsconfig sets
// allowImportingTsExtensions), so `npm run test:calendar` can load this module
// in plain node — which resolves neither the @/ alias nor extensionless paths.
import { etWallToUtcMs } from "./market-calendar.ts";
import {
  RELEASE_EVENTS,
  RELEASE_SOURCES,
  VERIFIED_THROUGH_DATE,
  type RawReleaseEvent,
} from "./data/economic-releases.ts";

/**
 * Economic event calendar + blackout feed (build doc §15.3, plan §4.5).
 *
 * The panel is the visible half; THIS is the product. A risk manager does not
 * want a list of dates, it wants "do not trade between 08:15 and 08:45 on
 * 2026-09-11", and that is what `blackoutWindows()` emits. The panel is a view
 * on this feed, never the source of it.
 *
 * Data policy, in order of authority:
 *   1. FRED (`fred/releases/dates`, free key) when VITE_FRED_API_KEY is set —
 *      official, includes future scheduled dates. Fetched by the panel, merged
 *      through `mergeFredDates` below.
 *   2. The maintained schedule in lib/data/economic-releases.ts — FOMC dates
 *      from the Fed's own calendar, CPI/NFP from the BLS schedule.
 *
 * There is deliberately NO third fallback that guesses. "First Friday of the
 * month" is the folklore rule for payrolls and 2026 alone broke it three times
 * (Jan 9, Feb 11, May 8); a blackout window derived from folklore is worse
 * than no window, because it will be trusted. Past `verifiedThrough` the feed
 * reports that it is unverified and the panel says so out loud.
 */

export type EventKind = "FOMC" | "CPI" | "NFP";

export interface EconomicEvent {
  /** Stable id: kind + date. */
  id: string;
  kind: EventKind;
  title: string;
  /** ET calendar date, YYYY-MM-DD. */
  date: string;
  /** ET wall-clock release time, HH:mm. */
  time: string;
  /** Release instant, epoch ms. */
  at: number;
  impact: "high" | "medium";
}

export interface BlackoutWindow {
  /** The event that produced this window. */
  eventId: string;
  kind: EventKind;
  /** Epoch ms, inclusive start. */
  from: number;
  /** Epoch ms, exclusive end. */
  to: number;
}

/** Everything here moves the whole tape; nothing is "low impact". */
const IMPACT: Record<EventKind, "high" | "medium"> = {
  FOMC: "high",
  CPI: "high",
  NFP: "high",
};

const isKind = (k: string): k is EventKind => k === "FOMC" || k === "CPI" || k === "NFP";

function toEvent(raw: RawReleaseEvent): EconomicEvent | null {
  if (!isKind(raw.kind)) return null;
  const [hh, mm] = raw.time.split(":").map(Number);
  return {
    id: `${raw.kind}-${raw.date}`,
    kind: raw.kind,
    title: raw.title,
    date: raw.date,
    time: raw.time,
    at: etWallToUtcMs(raw.date, hh, mm),
    impact: IMPACT[raw.kind],
  };
}

/** The maintained schedule, chronological. */
export function allEvents(): EconomicEvent[] {
  return RELEASE_EVENTS.map(toEvent)
    .filter((e): e is EconomicEvent => e !== null)
    .sort((a, b) => a.at - b.at);
}

/** Last date the checked-in schedule was verified against its sources. */
export const VERIFIED_THROUGH = VERIFIED_THROUGH_DATE;
export const SOURCES = RELEASE_SOURCES;

/** True when `now` is past the verified horizon — the panel warns on this. */
export function scheduleIsStale(now: number): boolean {
  return now > etWallToUtcMs(VERIFIED_THROUGH_DATE, 23, 59);
}

/** Upcoming events (and the ones still inside their own blackout). */
export function upcomingEvents(now: number, limit = 20): EconomicEvent[] {
  return allEvents()
    .filter((e) => e.at >= now - 60 * 60_000)
    .slice(0, limit);
}

export interface BlackoutOptions {
  /** Minutes before the release. Default 15. */
  beforeMin?: number;
  /** Minutes after the release. Default 15. */
  afterMin?: number;
  /** Restrict to these kinds; default all. */
  kinds?: EventKind[];
}

/**
 * The machine-readable half: one window per event, release time ± margin.
 *
 * This is the exact shape the risk manager consumes — epoch ms, half-open
 * [from, to), sorted, non-overlapping per kind. Pure: no clock, no network, no
 * DOM, so it is unit-testable (tests/event-calendar.test.mjs) and callable
 * from anywhere, including a future server-side guard.
 */
export function blackoutWindows(
  events: readonly EconomicEvent[],
  options: BlackoutOptions = {},
): BlackoutWindow[] {
  const before = (options.beforeMin ?? 15) * 60_000;
  const after = (options.afterMin ?? 15) * 60_000;
  const kinds = options.kinds;
  return events
    .filter((e) => !kinds || kinds.includes(e.kind))
    .map((e) => ({ eventId: e.id, kind: e.kind, from: e.at - before, to: e.at + after }))
    .sort((a, b) => a.from - b.from);
}

/** Is `instant` inside any window? The one-line question a risk check asks. */
export function inBlackout(windows: readonly BlackoutWindow[], instant: number): boolean {
  return windows.some((w) => instant >= w.from && instant < w.to);
}

/**
 * Merge FRED release dates (`fred/releases/dates` payload) over the maintained
 * schedule. FRED gives dates, not times, so the ET release time comes from the
 * kind (BLS publishes both CPI and the Employment Situation at 08:30 ET) —
 * that part is stable in a way the DATES are not, which is the whole reason
 * this merge exists.
 */
export function mergeFredDates(
  base: readonly EconomicEvent[],
  fred: readonly { kind: EventKind; date: string }[],
): EconomicEvent[] {
  const byId = new Map(base.map((e) => [e.id, e]));
  for (const row of fred) {
    const id = `${row.kind}-${row.date}`;
    if (byId.has(id)) continue;
    const time = row.kind === "FOMC" ? "14:00" : "08:30";
    const [hh, mm] = time.split(":").map(Number);
    byId.set(id, {
      id,
      kind: row.kind,
      title: `${row.kind} release`,
      date: row.date,
      time,
      at: etWallToUtcMs(row.date, hh, mm),
      impact: IMPACT[row.kind],
    });
  }
  return [...byId.values()].sort((a, b) => a.at - b.at);
}
