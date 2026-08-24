import { useEffect, useMemo, useRef } from "react";
import { type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { PriceBar, Trade } from "@/lib/api/types";
import { useChartBase, toTs } from "@/hooks/useChartBase";
import { CHART_COLORS } from "@/lib/chart-colors";

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

  for (const trade of trades) {
    const entryTs = snap(trade.entryTime);
    if (entryTs !== null) {
      markers.push({
        time: entryTs,
        position: "belowBar",
        color: trade.side === "LONG" ? CHART_COLORS.bull : CHART_COLORS.bear,
        shape: trade.side === "LONG" ? "arrowUp" : "arrowDown",
        text: trade.side === "LONG" ? "L" : "S",
      });
    }

    const exitTs = snap(trade.exitTime);
    if (exitTs !== null) {
      markers.push({
        time: exitTs,
        position: "aboveBar",
        color: trade.pnl >= 0 ? CHART_COLORS.bull : CHART_COLORS.bear,
        shape: "circle",
        text: trade.pnl >= 0 ? "+" : "−",
      });
    }
  }

  // lightweight-charts requires markers sorted ascending by time
  return markers.sort((a, b) => (a.time as number) - (b.time as number));
}

export function BacktestingChart({ bars, visibleCount, trades, height = "100%", onRangeChange, visibleRange }: Props) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const { chartRef }    = useChartBase(containerRef);
  const seriesRef       = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const prevLenRef      = useRef(0);
  const prevFirstTime   = useRef("");
  const onRangeChangeRef = useRef(onRangeChange);
  useEffect(() => { onRangeChangeRef.current = onRangeChange; }, [onRangeChange]);

  // Ascending bar times (ms) for the FULL stable array — memo keys on the
  // array reference, so replay ticks never rebuild it. Marker snapping
  // binary-searches this; targets past the visible window are dropped.
  const barTimesMs = useMemo(() => bars.map(b => new Date(b.time).getTime()), [bars]);
  const lastVisibleMs = visibleCount > 0 && visibleCount <= barTimesMs.length
    ? barTimesMs[visibleCount - 1]
    : -Infinity;

  // Create candlestick series once on mount (chart created by useChartBase)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const series = chart.addCandlestickSeries({
      upColor: CHART_COLORS.bull,
      downColor: CHART_COLORS.bear,
      borderVisible: false,
      wickUpColor: CHART_COLORS.bull,
      wickDownColor: CHART_COLORS.bear,
    });
    seriesRef.current = series;
    return () => {
      seriesRef.current = null;
      prevLenRef.current = 0;
      prevFirstTime.current = "";
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        // Fresh dataset — fit all bars so user sees the full range
        chart.timeScale().fitContent();
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
  }, [bars, visibleCount]);

  // Update trade markers whenever visible trades or bars change
  useEffect(() => {
    seriesRef.current?.setMarkers(buildMarkers(trades, barTimesMs, lastVisibleMs));
  }, [trades, barTimesMs, lastVisibleMs]);

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}
