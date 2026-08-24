/**
 * NYSE session calendar (build doc §15) — pure data + Intl-based ET math.
 *
 * DST rule (DO-NOT-TOUCH): no Date-offset timezone arithmetic anywhere in
 * here. ET wall-clock components come from Intl.DateTimeFormat with an
 * explicit `timeZone: "America/New_York"`; converting an ET wall time back
 * to an instant derives the UTC offset from Intl too (iterating to a fixed
 * point), never from a hardcoded -4/-5.
 *
 * Holidays are static observed-date data (full + early-close days are NOT
 * modelled — early closes still read OPEN until 16:00 ET; acceptable for a
 * status rail). Covers 2026–2028; extend the table, don't generate it.
 */

export type SessionState = "PRE" | "OPEN" | "POST" | "CLOSED";

export interface SessionInfo {
  state: SessionState;
  /** Epoch ms of the transition the countdown targets. */
  nextAt: number;
  /** State entered at `nextAt`. */
  nextState: SessionState;
}

/** NYSE full-day closures, observed dates, ET calendar dates (YYYY-MM-DD). */
const HOLIDAYS: ReadonlySet<string> = new Set([
  // 2026
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Jr.
  "2026-02-16", // Presidents' Day
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed; Jul 4 is Sat)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
  // 2027
  "2027-01-01", // New Year's Day
  "2027-01-18", // MLK Jr.
  "2027-02-15", // Presidents' Day
  "2027-03-26", // Good Friday
  "2027-05-31", // Memorial Day
  "2027-06-18", // Juneteenth (observed; Jun 19 is Sat)
  "2027-07-05", // Independence Day (observed; Jul 4 is Sun)
  "2027-09-06", // Labor Day
  "2027-11-25", // Thanksgiving
  "2027-12-24", // Christmas (observed; Dec 25 is Sat)
  "2027-12-31", // New Year's Day 2028 (observed; Jan 1 is Sat)
  // 2028
  "2028-01-17", // MLK Jr.
  "2028-02-21", // Presidents' Day
  "2028-04-14", // Good Friday
  "2028-05-29", // Memorial Day
  "2028-06-19", // Juneteenth
  "2028-07-04", // Independence Day
  "2028-09-04", // Labor Day
  "2028-11-23", // Thanksgiving
  "2028-12-25", // Christmas
]);

// Session boundaries as minutes after ET midnight.
const PRE_START = 4 * 60; // 04:00
const OPEN_START = 9 * 60 + 30; // 09:30
const POST_START = 16 * 60; // 16:00
const POST_END = 20 * 60; // 20:00

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface EtParts {
  y: number;
  mo: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

/** ET wall-clock components for an instant. The only TZ source of truth. */
function etParts(ms: number): EtParts {
  const out: Record<string, number> = {};
  for (const part of ET_FMT.formatToParts(new Date(ms))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  // h23 can report midnight as hour 24 on some engines — normalise to 0.
  return {
    y: out.year,
    mo: out.month,
    d: out.day,
    hh: out.hour % 24,
    mm: out.minute,
    ss: out.second,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function etDateString(p: { y: number; mo: number; d: number }): string {
  return `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`;
}

/** ET offset (ms) in force at instant `ms`, derived from Intl parts. */
function etOffsetMs(ms: number): number {
  const p = etParts(ms);
  return Date.UTC(p.y, p.mo - 1, p.d, p.hh, p.mm, p.ss) - ms;
}

/**
 * Instant (epoch ms) of an ET wall time on an ET calendar date. Guesses UTC,
 * then corrects with the Intl-derived offset; converges in ≤2 iterations
 * (the offset only changes across a DST boundary).
 */
function etWallToUtcMs(date: string, hh: number, mm: number): number {
  const naive = Date.parse(`${date}T${pad2(hh)}:${pad2(mm)}:00Z`);
  let guess = naive;
  for (let i = 0; i < 3; i++) {
    const next = naive - etOffsetMs(guess);
    if (next === guess) return next;
    guess = next;
  }
  return guess;
}

/** Calendar date `days` after an ET date string (pure calendar math, no TZ). */
function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Weekday of an ET calendar date: 0 = Sunday … 6 = Saturday. */
function weekdayOf(date: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

export function isTradingDay(date: string): boolean {
  const dow = weekdayOf(date);
  return dow !== 0 && dow !== 6 && !HOLIDAYS.has(date);
}

function nextTradingDayAfter(date: string): string {
  let d = addDays(date, 1);
  while (!isTradingDay(d)) d = addDays(d, 1);
  return d;
}

/**
 * Session state + countdown target for an instant.
 *
 * Countdown policy (doc §15 verify: "on a Saturday it reads CLOSED with
 * countdown to Monday 09:30"): PRE/OPEN/POST count to their own next
 * boundary; CLOSED counts straight to the next regular OPEN (09:30 ET on
 * the next trading day) rather than the 04:00 pre-market boundary.
 */
export function getSessionInfo(nowMs: number): SessionInfo {
  const p = etParts(nowMs);
  const date = etDateString(p);
  const minutes = p.hh * 60 + p.mm;
  const trading = isTradingDay(date);

  if (trading) {
    if (minutes >= OPEN_START && minutes < POST_START) {
      return { state: "OPEN", nextAt: etWallToUtcMs(date, 16, 0), nextState: "POST" };
    }
    if (minutes >= POST_START && minutes < POST_END) {
      return { state: "POST", nextAt: etWallToUtcMs(date, 20, 0), nextState: "CLOSED" };
    }
    if (minutes >= PRE_START && minutes < OPEN_START) {
      return { state: "PRE", nextAt: etWallToUtcMs(date, 9, 30), nextState: "OPEN" };
    }
  }

  const openDate = trading && minutes < POST_END ? date : nextTradingDayAfter(date);
  return { state: "CLOSED", nextAt: etWallToUtcMs(openDate, 9, 30), nextState: "OPEN" };
}
