import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  createSeriesMarkers,
  LineStyle,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { PriceBar, Trade } from "@/lib/api/types";
import { useChartBase, toTs } from "@/hooks/useChartBase";
import { useChartTheme } from "@/hooks/useChartTheme";
import { resolveChartTheme } from "@/lib/chart-theme";
import { PricePillPrimitive, pricePillColors } from "@/lib/chart-primitives/price-pill";
import { etDayKey, prevSessionClose } from "@/lib/chart-primitives/session-shading";
import { fmtPrice } from "@/lib/format";

interface Props {
  bars: PriceBar[];
  /**
   * How many leading bars of `bars` are visible. The parent passes the full
   * stable array plus a cursor instead of a per-tick slice: stepping forward
   * emits only delta bars via series.update(), seeking backward is one
   * setData of bars.slice(0, visibleCount) (allocation fine at seek frequency).
   */
  visibleCount: number;
  trades: Trade[];
  height?: number | string;
  onRangeChange?: (from: number, to: number) => void;
  visibleRange?: { from: number; to: number };
  /**
   * §12 M3: range to apply INSTEAD of fitContent when a fresh dataset lands
   * (URL-restored view). Applied imperatively inside the series-data effect so
   * mount-time range events can't race it (they converge ON the restored
   * range), and re-applied on a StrictMode remount for the same reason.
   * Consumed only on the new-dataset path — later pans never retrigger it.
   */
  initialRange?: { from: number; to: number } | null;
}

function toBar(b: PriceBar) {
  return { time: toTs(b.time), open: b.open, high: b.high, low: b.low, close: b.close };
}

/**
 * Index of the entry in an ascending array nearest to `targetMs`, via binary
 * search — O(log n) per lookup instead of a full O(n) scan. Ties resolve to the
 * earlier bar, matching the previous linear-scan behaviour.
 */
function findNearestMs(targetMs: number, sortedMs: number[]): number {
  let lo = 0;
  let hi = sortedMs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedMs[mid] < targetMs) lo = mid + 1;
    else hi = mid;
  }
  // `lo` is the first index >= target; the nearest is either it or its predecessor.
  if (lo > 0 && Math.abs(sortedMs[lo - 1] - targetMs) <= Math.abs(sortedMs[lo] - targetMs)) {
    return sortedMs[lo - 1];
  }
  return sortedMs[lo];
}

function buildMarkers(trades: Trade[], sortedBarMs: number[], lastVisibleMs: number) {
  if (!sortedBarMs.length || !trades.length) return [];

  const lastMs = lastVisibleMs;

  // Snap a trade time to the nearest bar. Bars are ascending (lightweight-charts
  // requires it for setData), so a binary search is valid here.
  function snap(iso: string): UTCTimestamp | null {
    const target = new Date(iso).getTime();
    if (target > lastMs) return null;
    return Math.floor(findNearestMs(target, sortedBarMs) / 1000) as UTCTimestamp;
  }

  const markers: Array<{
    time: UTCTimestamp;
    position: "aboveBar" | "belowBar";
    color: string;
    shape: "arrowUp" | "arrowDown" | "circle";
    text: string;
  }> = [];

  // Called from effects only (client-side) — safe to resolve the theme here.
  const theme = resolveChartTheme();

  for (const trade of trades) {
    const entryTs = snap(trade.entryTime);
    if (entryTs !== null) {
      markers.push({
        time: entryTs,
        position: "belowBar",
        color: trade.side === "LONG" ? theme.up : theme.down,
        shape: trade.side === "LONG" ? "arrowUp" : "arrowDown",
        text: trade.side === "LONG" ? "L" : "S",
      });
    }

    const exitTs = snap(trade.exitTime);
    if (exitTs !== null) {
      markers.push({
        time: exitTs,
        position: "aboveBar",
        color: trade.pnl >= 0 ? theme.up : theme.down,
        shape: "circle",
        text: trade.pnl >= 0 ? "+" : "−",
      });
    }
  }

  // lightweight-charts requires markers sorted ascending by time
  return markers.sort((a, b) => (a.time as number) - (b.time as number));
}

export function BacktestingChart({ bars, visibleCount, trades, height = "100%", onRangeChange, visibleRange, initialRange }: Props) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const { chartRef }    = useChartBase(containerRef);
  const seriesRef       = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  // §11 M2 price pill: direction-colored last-price gutter label + the replay
  // position pill (`Bar 14,832 / 21,000`) pinned 24px below it.
  const pillRef         = useRef<PricePillPrimitive | null>(null);
  // Explicit dotted last-price line (axis label off — the pill owns the
  // gutter; v5 has no separate price-line-label switch) + its last direction
  // for theme-change recolors.
  const priceLineRef    = useRef<IPriceLine | null>(null);
  const lastDirUpRef    = useRef(true);
  const prevLenRef      = useRef(0);
  const prevFirstTime   = useRef("");
  const onRangeChangeRef = useRef(onRangeChange);
  // initialRange is consumed only on the new-dataset path, so it must NOT be an
  // effect dep (a pan updates it via the URL and would retrigger the effect).
  const initialRangeRef = useRef(initialRange);
  useEffect(() => { initialRangeRef.current = initialRange; }, [initialRange]);
  // §13.4 reactive chart theme — drives the in-place re-theme effect below.
  const theme = useChartTheme();
  useEffect(() => { onRangeChangeRef.current = onRangeChange; }, [onRangeChange]);

  // Ascending bar times (ms) for the FULL stable array — memo keys on the
  // array reference, so replay ticks never rebuild it. Marker snapping
  // binary-searches this; targets past the visible window are dropped.
  const barTimesMs = useMemo(() => bars.map(b => new Date(b.time).getTime()), [bars]);
  // ET day key per bar — the pill's previous-session close scans these
  // (string compares, cheap enough at replay tick rate).
  const dayKeys = useMemo(() => barTimesMs.map(etDayKey), [barTimesMs]);
  const lastVisibleMs = visibleCount > 0 && visibleCount <= barTimesMs.length
    ? barTimesMs[visibleCount - 1]
    : -Infinity;

  // Create candlestick series once on mount (chart created by useChartBase)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const initialTheme = resolveChartTheme();
    const series = chart.addSeries(CandlestickSeries, {
      upColor: initialTheme.up,
      downColor: initialTheme.down,
      borderVisible: false,
      wickUpColor: initialTheme.up,
      wickDownColor: initialTheme.down,
      // §11 M2: the PricePillPrimitive owns the gutter label (native label
      // off) — and the built-in price line stays off too: its axis label has
      // no separate visibility switch in v5 and would duplicate the pill in
      // the gutter. The dotted line is re-added per tick as an explicit
      // createPriceLine with axisLabelVisible:false.
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const pill = new PricePillPrimitive(pricePillColors(initialTheme));
    series.attachPrimitive(pill);
    pillRef.current = pill;
    seriesRef.current = series;
    return () => {
      try {
        markersRef.current?.detach();
      } catch {
        /* plugin already gone */
      }
      markersRef.current = null;
      pillRef.current = null;
      priceLineRef.current = null;
      seriesRef.current = null;
      prevLenRef.current = 0;
      prevFirstTime.current = "";
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // §13.4: re-theme the live series in place — recreating it here would
  // reset the replay cursor bookkeeping (prevLenRef) and the user's range.
  // The markers effect below re-resolves marker colors via its theme dep.
  useEffect(() => {
    if (!theme) return;
    seriesRef.current?.applyOptions({
      upColor: theme.up,
      downColor: theme.down,
      wickUpColor: theme.up,
      wickDownColor: theme.down,
    });
    pillRef.current?.setColors(pricePillColors(theme));
    priceLineRef.current?.applyOptions({
      color: lastDirUpRef.current ? theme.upDim : theme.downDim,
    });
  }, [theme]);

  // Emit logical range for scrollbar
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = (range: { from: number; to: number } | null) => {
      if (range) onRangeChangeRef.current?.(range.from, range.to);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply visibleRange from scrollbar → chart
  useEffect(() => {
    if (!visibleRange || !chartRef.current) return;
    const ts  = chartRef.current.timeScale();
    const cur = ts.getVisibleLogicalRange();
    if (cur && Math.abs(cur.from - visibleRange.from) < 0.5 && Math.abs(cur.to - visibleRange.to) < 0.5) return;
    ts.setVisibleLogicalRange(visibleRange);
  }, [visibleRange]);

  // Update series — incremental delta updates when stepping forward, one full
  // setData on new data / seek back. `visibleCount` is the replay cursor; the
  // parent never slices per tick.
  useEffect(() => {
    const series = seriesRef.current;
    const chart  = chartRef.current;
    if (!series || !chart) return;

    const visibleLen = Math.min(Math.max(0, visibleCount), bars.length);

    if (visibleLen === 0) {
      series.setData([]);
      pillRef.current?.update({ price: null, replayText: null });
      if (priceLineRef.current) {
        try {
          series.removePriceLine(priceLineRef.current);
        } catch {
          /* series already gone */
        }
        priceLineRef.current = null;
      }
      prevLenRef.current = 0;
      prevFirstTime.current = "";
      return;
    }

    const firstTime    = bars[0].time;
    const isNewDataset = firstTime !== prevFirstTime.current;
    const isJumpBack   = visibleLen < prevLenRef.current;

    if (isNewDataset || isJumpBack || prevLenRef.current === 0) {
      // Seek / reset path — one setData of the window (allocation fine at
      // seek frequency; it's the per-tick allocation that was the defect).
      series.setData(bars.slice(0, visibleLen).map(toBar));
      if (isNewDataset || prevLenRef.current === 0) {
        // §12 M3: a URL-restored view replaces fitContent on a fresh dataset
        // (clamped to the loaded window; negative `from` is legit whitespace).
        if (initialRangeRef.current) {
          const to = Math.min(initialRangeRef.current.to, bars.length - 1);
          const from = Math.min(initialRangeRef.current.from, to);
          if (from < to) chart.timeScale().setVisibleLogicalRange({ from, to });
          else chart.timeScale().fitContent();
        } else {
          // Fresh dataset — fit all bars so user sees the full range
          chart.timeScale().fitContent();
        }
      } else {
        // Replay restarted — show a window with room for bars to grow into
        // rather than fitContent on 1-2 bars which zooms in microscopically
        chart.timeScale().setVisibleLogicalRange({ from: -5, to: 120 });
      }
    } else {
      // Delta path — append only the new bars and scroll to keep latest in view
      for (let i = prevLenRef.current; i < visibleLen; i++) {
        series.update(toBar(bars[i]));
      }
      chart.timeScale().scrollToPosition(0, false);
    }

    prevLenRef.current = visibleLen;
    prevFirstTime.current = firstTime;

    // §11 M2 pill — tracks the replay cursor: last VISIBLE close (direction
    // vs the previous session's close) + the absolute replay position. Field
    // writes + the library's own requestUpdate; no React involvement per tick.
    const last = bars[visibleLen - 1];
    const prevClose = prevSessionClose(bars, dayKeys, visibleLen - 1);
    const up = prevClose !== null ? last.close >= prevClose : true;
    pillRef.current?.update({
      price: last.close,
      up,
      text: fmtPrice(last.close),
      replayText: `Bar ${visibleLen.toLocaleString("en-US")} / ${bars.length.toLocaleString("en-US")}`,
    });

    // Dotted last-price line at the cursor's close — explicit createPriceLine
    // with axisLabelVisible:false (the pill owns the gutter label).
    lastDirUpRef.current = up;
    const lineColor = up ? resolveChartTheme().upDim : resolveChartTheme().downDim;
    if (priceLineRef.current) {
      priceLineRef.current.applyOptions({ price: last.close, color: lineColor });
    } else {
      priceLineRef.current = series.createPriceLine({
        price: last.close,
        color: lineColor,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
        title: "",
      });
    }
  }, [bars, visibleCount, dayKeys]);

  // Update trade markers whenever visible trades or bars change. The v5
  // markers plugin attaches LAZILY, only while there are markers to show:
  // in v5.2.0 its pane view calls series.data() on every update cycle (an
  // O(bars) copy per pan/zoom/replay frame even with zero markers), so an
  // idle plugin is a perf tax at replay bar counts. `theme` dep: a §13.4
  // retheme rebuilds marker colors (buildMarkers re-resolves post-invalidate).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const markers = buildMarkers(trades, barTimesMs, lastVisibleMs);
    if (!markers.length) {
      try {
        markersRef.current?.detach();
      } catch {
        /* plugin already gone */
      }
      markersRef.current = null;
      return;
    }
    if (!markersRef.current) markersRef.current = createSeriesMarkers(series, []);
    markersRef.current.setMarkers(markers);
  }, [trades, barTimesMs, lastVisibleMs, theme]);

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}
