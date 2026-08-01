import { useEffect, useMemo, useRef } from "react";
import { type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { PriceBar, Trade } from "@/lib/api/types";
import { useChartBase, toTs } from "@/hooks/useChartBase";

interface Props {
  bars: PriceBar[];
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

function buildMarkers(trades: Trade[], sortedBarMs: number[]) {
  if (!sortedBarMs.length || !trades.length) return [];

  const lastMs = sortedBarMs[sortedBarMs.length - 1];

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
        color: trade.side === "LONG" ? "#22c55e" : "#ef4444",
        shape: trade.side === "LONG" ? "arrowUp" : "arrowDown",
        text: trade.side === "LONG" ? "L" : "S",
      });
    }

    const exitTs = snap(trade.exitTime);
    if (exitTs !== null) {
      markers.push({
        time: exitTs,
        position: "aboveBar",
        color: trade.pnl >= 0 ? "#22c55e" : "#ef4444",
        shape: "circle",
        text: trade.pnl >= 0 ? "+" : "−",
      });
    }
  }

  // lightweight-charts requires markers sorted ascending by time
  return markers.sort((a, b) => (a.time as number) - (b.time as number));
}

export function BacktestingChart({ bars, trades, height = "100%", onRangeChange, visibleRange }: Props) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const { chartRef }    = useChartBase(containerRef);
  const seriesRef       = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const prevLenRef      = useRef(0);
  const prevFirstTime   = useRef("");
  const onRangeChangeRef = useRef(onRangeChange);
  useEffect(() => { onRangeChangeRef.current = onRangeChange; }, [onRangeChange]);

  // Ascending bar times (ms), rebuilt only when bars change. Marker snapping
  // binary-searches this instead of scanning all bars per trade on every tick.
  const barTimesMs = useMemo(() => bars.map(b => new Date(b.time).getTime()), [bars]);

  // Create candlestick series once on mount (chart created by useChartBase)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const series = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
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

  // Update series — incremental update when playing, full reset on new data / jump back
  useEffect(() => {
    const series = seriesRef.current;
    const chart  = chartRef.current;
    if (!series || !chart) return;

    if (!bars.length) {
      series.setData([]);
      prevLenRef.current = 0;
      prevFirstTime.current = "";
      return;
    }

    const firstTime    = bars[0].time;
    const isNewDataset = firstTime !== prevFirstTime.current;
    const isJumpBack   = bars.length < prevLenRef.current;

    if (isNewDataset || isJumpBack || prevLenRef.current === 0) {
      series.setData(bars.map(toBar));
      if (isNewDataset || prevLenRef.current === 0) {
        // Fresh dataset — fit all bars so user sees the full range
        chart.timeScale().fitContent();
      } else {
        // Replay restarted — show a window with room for bars to grow into
        // rather than fitContent on 1-2 bars which zooms in microscopically
        chart.timeScale().setVisibleLogicalRange({ from: -5, to: 120 });
      }
    } else {
      // Incremental path — append new bars and scroll to keep latest in view
      for (let i = prevLenRef.current; i < bars.length; i++) {
        series.update(toBar(bars[i]));
      }
      chart.timeScale().scrollToPosition(0, false);
    }

    prevLenRef.current = bars.length;
    prevFirstTime.current = firstTime;
  }, [bars]);

  // Update trade markers whenever visible trades or bars change
  useEffect(() => {
    seriesRef.current?.setMarkers(buildMarkers(trades, barTimesMs));
  }, [trades, barTimesMs]);

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}
