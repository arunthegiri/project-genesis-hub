/**
 * Session shading pane primitive (build doc §11 M2, plan §3.6): vertical bands
 * marking extended hours (pre-market 04:00–09:30 ET, after-hours 16:00–20:00
 * ET) behind the regular session, drawn as a v5 pane primitive at
 * `zOrder: "bottom"`. Fill = surface-2 at 35% alpha (fed in by the caller from
 * the token layer). Sun/moon day-boundary glyphs ride the time axis via
 * `sessionTickMarkFormatter`.
 *
 * ET math note: `lib/market-calendar.ts` keeps its wall-clock↔instant
 * converters private, so the boundary math is duplicated here under the same
 * DO-NOT-TOUCH DST rule — no hardcoded -4/-5 offsets, all offsets derived
 * from Intl with an explicit America/New_York timeZone. If market-calendar
 * ever exports its helpers, switch to them and delete the local copies.
 *
 * Perf: segments are computed ONCE per data change (O(days)), and the
 * per-frame renderer only maps cached logical indices through
 * `logicalToCoordinate` (O(visible segments)) — no layout reads, no series
 * data copies, no getComputedStyle in the draw path.
 */

import type { CanvasRenderingTarget2D } from "fancy-canvas";
import {
  TickMarkType,
  type Coordinate,
  type IChartApi,
  type IPanePrimitive,
  type IPanePrimitivePaneView,
  type IPrimitivePaneRenderer,
  type Logical,
  type PaneAttachedParameter,
  type Time,
} from "lightweight-charts";
import { isTradingDay } from "@/lib/market-calendar";

/** One extended-hours run, as inclusive BAR indices [from, to]. */
export interface SessionSegment {
  from: number;
  to: number;
}

// ── ET wall-clock helpers (mirror of lib/market-calendar.ts internals) ──────

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

function etParts(ms: number) {
  const out: Record<string, number> = {};
  for (const part of ET_FMT.formatToParts(new Date(ms))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    y: out.year,
    mo: out.month,
    d: out.day,
    hh: out.hour % 24,
    mm: out.minute,
    ss: out.second,
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const etDateString = (p: { y: number; mo: number; d: number }) =>
  `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`;

/** ET calendar-day key (YYYY-MM-DD) for an epoch-ms instant. */
export function etDayKey(ms: number): string {
  return etDateString(etParts(ms));
}

/**
 * Reference close for direction coloring (§11 M2 price pill): the close of
 * the last bar BEFORE `fromIndex`'s ET day — the previous session's close.
 * Falls back to the immediately preceding bar when the window holds a single
 * session; null when there is no earlier bar at all. `dayKeys` is the
 * etDayKey of each bar, precomputed by the caller so per-tick replay updates
 * stay string-compare cheap.
 */
export function prevSessionClose(
  bars: readonly { close: number }[],
  dayKeys: readonly string[],
  fromIndex: number,
): number | null {
  if (fromIndex <= 0) return null;
  const day = dayKeys[fromIndex];
  for (let i = fromIndex - 1; i >= 0; i--) {
    if (dayKeys[i] !== day) return bars[i].close;
  }
  return bars[fromIndex - 1].close;
}

/**
 * `prevSessionClose` for the LAST bar, without precomputed day keys (§14.1 —
 * the ticker needs a change reference and has only the bar array).
 *
 * Cost note: it resolves the final bar's ET midnight ONCE and then walks back
 * with numeric comparisons, so it is O(bars in the last session) integer
 * compares and exactly one Intl call — not one `etDayKey` per bar. That
 * matters because this runs on every data refresh of a chart that may hold
 * 100k bars.
 */
export function trailingPrevClose(bars: readonly { time: string; close: number }[]): number | null {
  if (bars.length < 2) return null;
  const lastMs = new Date(bars[bars.length - 1].time).getTime();
  if (Number.isNaN(lastMs)) return null;
  const dayStart = etWallToUtcMs(etDayKey(lastMs), 0, 0);
  for (let i = bars.length - 2; i >= 0; i--) {
    if (new Date(bars[i].time).getTime() < dayStart) return bars[i].close;
  }
  // Single-session window: same fallback as prevSessionClose — the bar before.
  return bars[bars.length - 2].close;
}

function etOffsetMs(ms: number): number {
  const p = etParts(ms);
  return Date.UTC(p.y, p.mo - 1, p.d, p.hh, p.mm, p.ss) - ms;
}

/** Instant (epoch ms) of an ET wall time on an ET calendar date (≤2 iterations). */
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

function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/**
 * Extended-hours runs (inclusive bar-index ranges) for an ascending array of
 * bar times (epoch ms). Per trading day the shaded runs are
 * [04:00, 09:30) and [16:00, 20:00) ET; regular hours are the unshaded gap.
 * Overnight/closed bars (rare in this dataset) are unshaded too.
 *
 * Cost is O(days + bars-binary-searches): day boundaries come from the Intl
 * wall-clock math once per day, never per bar, so a 100k-bar dataset costs a
 * few hundred formatter calls total.
 */
export function buildExtendedHourSegments(timesMs: number[]): SessionSegment[] {
  const n = timesMs.length;
  if (n === 0) return [];

  /** First bar index with time >= target (lower bound; times are ascending). */
  const lowerBound = (target: number): number => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (timesMs[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const segments: SessionSegment[] = [];
  const firstDate = etDateString(etParts(timesMs[0]));
  const lastDate = etDateString(etParts(timesMs[n - 1]));

  for (let date = firstDate; ; date = addDays(date, 1)) {
    if (isTradingDay(date)) {
      // Each run: [lowerBound(start), lowerBound(end) - 1], clipped to data.
      const runs: [number, number][] = [
        [etWallToUtcMs(date, 4, 0), etWallToUtcMs(date, 9, 30)], // pre-market
        [etWallToUtcMs(date, 16, 0), etWallToUtcMs(date, 20, 0)], // after-hours
      ];
      for (const [start, end] of runs) {
        const from = lowerBound(start);
        const to = lowerBound(end) - 1;
        if (from <= to && from < n && to >= 0) {
          segments.push({ from: Math.max(0, from), to: Math.min(n - 1, to) });
        }
      }
    }
    if (date === lastDate) break;
  }
  return segments;
}

// ── Pane primitive ──────────────────────────────────────────────────────────

class SessionBandsRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly source: SessionBandsPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    const chart = this.source.chart;
    const segments = this.source.segments;
    const fill = this.source.fill;
    if (!chart || segments.length === 0) return;

    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.fillStyle = fill;
      for (const s of segments) {
        if (s.to < range.from - 1 || s.from > range.to + 1) continue;
        // Band edges sit halfway between bar centres so a run covers exactly
        // its bars. NOTE: v5.2.0's logicalToCoordinate returns 0 (not null!)
        // for FRACTIONAL logicals (verified empirically), so edges are derived
        // from integer bar centres ± half the average bar spacing of the run —
        // per-index division also absorbs conflation's effective spacing.
        const xc1 = ts.logicalToCoordinate(s.from as Logical);
        const xc2 = ts.logicalToCoordinate(s.to as Logical);
        if (xc1 === null || xc2 === null) continue;
        let half: number;
        if (s.to > s.from) {
          half = ((xc2 as number) - (xc1 as number)) / (s.to - s.from) / 2;
        } else {
          // Single-bar run: extrapolate the spacing from the next bar over
          // (integer logicals extrapolate fine past the data edge).
          const xn = ts.logicalToCoordinate((s.to + 1) as Logical);
          if (xn === null) continue;
          half = ((xn as number) - (xc2 as number)) / 2;
        }
        ctx.fillRect(
          (xc1 as number) - half,
          0,
          (xc2 as number) - (xc1 as number) + 2 * half,
          mediaSize.height,
        );
      }
    });
  }
}

class SessionBandsPaneView implements IPanePrimitivePaneView {
  private readonly bandRenderer: SessionBandsRenderer;
  constructor(source: SessionBandsPrimitive) {
    this.bandRenderer = new SessionBandsRenderer(source);
  }
  zOrder() {
    return "bottom" as const;
  }
  renderer() {
    return this.bandRenderer;
  }
}

/**
 * Pane primitive painting extended-hours bands. Attach to pane 0; feed
 * segments on data change and the fill color on theme change (both go through
 * `requestUpdate`, so redraws are library-scheduled, never manual).
 */
export class SessionBandsPrimitive implements IPanePrimitive<Time> {
  chart: IChartApi | null = null;
  segments: readonly SessionSegment[] = [];
  fill = "rgba(0,0,0,0)";
  private requestUpdate: () => void = () => undefined;
  private readonly views: readonly IPanePrimitivePaneView[];

  constructor() {
    this.views = [new SessionBandsPaneView(this)];
  }

  attached(param: PaneAttachedParameter<Time>): void {
    this.chart = param.chart as IChartApi;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.requestUpdate = () => undefined;
  }

  paneViews(): readonly IPanePrimitivePaneView[] {
    return this.views; // stable reference — the library caches views by identity
  }

  setSegments(segments: readonly SessionSegment[]): void {
    this.segments = segments;
    this.requestUpdate();
  }

  setFill(fill: string): void {
    this.fill = fill;
    this.requestUpdate();
  }
}

// ── Time-axis glyphs ────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * tickMarkFormatter with sun/moon glyphs at day boundaries (§11 M2): a
 * DayOfMonth tick is prefixed with ☀ when the ET calendar day opening within
 * the following hours is a trading day (regular session ahead), ☾ otherwise
 * (weekend/holiday — the chart's next stretch is closed-market). The probe is
 * instant + 12h: a UTC-midnight tick then lands in that day's ET morning.
 * All other tick types keep the library's default UTC-based text so labels
 * match the unthemed axis exactly.
 */
export function sessionTickMarkFormatter(time: Time, tickMarkType: TickMarkType): string {
  const ms = (time as number) * 1000;
  const d = new Date(ms);
  switch (tickMarkType) {
    case TickMarkType.Year:
      return String(d.getUTCFullYear());
    case TickMarkType.Month:
      return MONTHS[d.getUTCMonth()];
    case TickMarkType.DayOfMonth: {
      const dayAhead = etDateString(etParts(ms + 12 * 3_600_000));
      return `${isTradingDay(dayAhead) ? "☀" : "☾"} ${d.getUTCDate()}`;
    }
    case TickMarkType.TimeWithSeconds:
      return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
    case TickMarkType.Time:
    default:
      return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  }
}
