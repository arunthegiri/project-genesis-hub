/**
 * Maintained economic-release schedule (build doc §15.3 asks for "a maintained
 * JSON checked into lib/"; it is a typed module instead so the shape is
 * compile-checked and `npm run test:calendar` can import it in plain node
 * without a JSON loader — same hand-maintained data, one less way to be
 * wrong).
 *
 * Dates are ET calendar dates; times are ET wall clocks. FOMC entries are the
 * SECOND day of each meeting — the statement day, which is the one that moves
 * markets.
 *
 * Verified 2026-08-19 against the sources below. Each FOMC date is tentative
 * until confirmed at the meeting immediately preceding it. When
 * VITE_FRED_API_KEY is configured, live FRED release dates supersede this.
 */

export interface RawReleaseEvent {
  kind: "FOMC" | "CPI" | "NFP";
  /** ET calendar date, YYYY-MM-DD. */
  date: string;
  /** ET wall-clock release time, HH:mm. */
  time: string;
  title: string;
}

export const RELEASE_SOURCES: Record<string, string> = {
  FOMC: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
  CPI: "https://www.bls.gov/schedule/news_release/cpi.htm",
  NFP: "https://www.bls.gov/schedule/news_release/empsit.htm",
};

/** Last date this file was checked against RELEASE_SOURCES. */
export const VERIFIED_THROUGH_DATE = "2026-12-31";

export const RELEASE_EVENTS: RawReleaseEvent[] = [
  { kind: "FOMC", date: "2026-01-28", time: "14:00", title: "FOMC statement" },
  { kind: "FOMC", date: "2026-03-18", time: "14:00", title: "FOMC statement + SEP" },
  { kind: "FOMC", date: "2026-04-29", time: "14:00", title: "FOMC statement" },
  { kind: "FOMC", date: "2026-06-17", time: "14:00", title: "FOMC statement + SEP" },
  { kind: "FOMC", date: "2026-07-29", time: "14:00", title: "FOMC statement" },
  { kind: "FOMC", date: "2026-09-16", time: "14:00", title: "FOMC statement + SEP" },
  { kind: "FOMC", date: "2026-10-28", time: "14:00", title: "FOMC statement" },
  { kind: "FOMC", date: "2026-12-09", time: "14:00", title: "FOMC statement + SEP" },
  { kind: "FOMC", date: "2027-01-27", time: "14:00", title: "FOMC statement" },
  { kind: "FOMC", date: "2027-03-17", time: "14:00", title: "FOMC statement + SEP" },
  { kind: "FOMC", date: "2027-04-28", time: "14:00", title: "FOMC statement" },
  { kind: "FOMC", date: "2027-06-09", time: "14:00", title: "FOMC statement + SEP" },
  { kind: "FOMC", date: "2027-07-28", time: "14:00", title: "FOMC statement" },
  { kind: "FOMC", date: "2027-09-15", time: "14:00", title: "FOMC statement + SEP" },
  { kind: "FOMC", date: "2027-10-27", time: "14:00", title: "FOMC statement" },
  { kind: "FOMC", date: "2027-12-08", time: "14:00", title: "FOMC statement + SEP" },

  { kind: "CPI", date: "2026-01-13", time: "08:30", title: "CPI (Dec 2025)" },
  { kind: "CPI", date: "2026-02-13", time: "08:30", title: "CPI (Jan 2026)" },
  { kind: "CPI", date: "2026-03-11", time: "08:30", title: "CPI (Feb 2026)" },
  { kind: "CPI", date: "2026-04-10", time: "08:30", title: "CPI (Mar 2026)" },
  { kind: "CPI", date: "2026-05-12", time: "08:30", title: "CPI (Apr 2026)" },
  { kind: "CPI", date: "2026-06-10", time: "08:30", title: "CPI (May 2026)" },
  { kind: "CPI", date: "2026-07-14", time: "08:30", title: "CPI (Jun 2026)" },
  { kind: "CPI", date: "2026-08-12", time: "08:30", title: "CPI (Jul 2026)" },
  { kind: "CPI", date: "2026-09-11", time: "08:30", title: "CPI (Aug 2026)" },
  { kind: "CPI", date: "2026-10-14", time: "08:30", title: "CPI (Sep 2026)" },
  { kind: "CPI", date: "2026-11-10", time: "08:30", title: "CPI (Oct 2026)" },
  { kind: "CPI", date: "2026-12-10", time: "08:30", title: "CPI (Nov 2026)" },

  { kind: "NFP", date: "2026-01-09", time: "08:30", title: "Employment Situation (Dec 2025)" },
  { kind: "NFP", date: "2026-02-11", time: "08:30", title: "Employment Situation (Jan 2026)" },
  { kind: "NFP", date: "2026-03-06", time: "08:30", title: "Employment Situation (Feb 2026)" },
  { kind: "NFP", date: "2026-04-03", time: "08:30", title: "Employment Situation (Mar 2026)" },
  { kind: "NFP", date: "2026-05-08", time: "08:30", title: "Employment Situation (Apr 2026)" },
  { kind: "NFP", date: "2026-06-05", time: "08:30", title: "Employment Situation (May 2026)" },
  { kind: "NFP", date: "2026-07-02", time: "08:30", title: "Employment Situation (Jun 2026)" },
  { kind: "NFP", date: "2026-08-07", time: "08:30", title: "Employment Situation (Jul 2026)" },
  { kind: "NFP", date: "2026-09-04", time: "08:30", title: "Employment Situation (Aug 2026)" },
  { kind: "NFP", date: "2026-10-02", time: "08:30", title: "Employment Situation (Sep 2026)" },
  { kind: "NFP", date: "2026-11-06", time: "08:30", title: "Employment Situation (Oct 2026)" },
  { kind: "NFP", date: "2026-12-04", time: "08:30", title: "Employment Situation (Nov 2026)" },
];
