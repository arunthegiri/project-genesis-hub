import { useEffect, useRef } from "react";
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { PriceBar, Trade } from "@/lib/api/types";

interface Props {
  bars: PriceBar[];
  trades: Trade[];
  height?: number | string;
  onRangeChange?: (from: number, to: number) => void;
  visibleRange?: { from: number; to: number };
}

const CHART_OPTIONS = {
  autoSize: true,
  layout: {
    background: { color: "transparent" },
    textColor: "#9ca3af",
    fontFamily: "JetBrains Mono, ui-monospace, monospace",
  },
  grid: {
    vertLines: { color: "rgba(255,255,255,0.04)" },
    horzLines: { color: "rgba(255,255,255,0.04)" },
  },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: "rgba(255,255,255,0.06)" },
  timeScale: {
    borderColor: "rgba(255,255,255,0.06)",
    timeVisible: true,
    secondsVisible: false,
  },
} as const;

function toTs(iso: string): UTCTimestamp {
  return Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;
}

function toBar(b: PriceBar) {
  return { time: toTs(b.time), open: b.open, high: b.high, low: b.low, close: b.close };
}

function buildMarkers(trades: Trade[], bars: PriceBar[]) {
  if (!bars.length || !trades.length) return [];

  // Build a lookup of bar timestamps for snapping trade times to valid bar times
  const barTimes = bars.map(b => ({ ms: new Date(b.time).getTime(), ts: toTs(b.time) }));
  const lastMs = barTimes[barTimes.length - 1].ms;

  function snap(iso: string): UTCTimestamp | null {
    const target = new Date(iso).getTime();
    if (target > lastMs) return null;
    let best = barTimes[0];
    for (const bt of barTimes) {
      if (Math.abs(bt.ms - target) < Math.abs(best.ms - target)) best = bt;
    }
    return best.ts;
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
  const chartRef        = useRef<IChartApi | null>(null);
  const seriesRef       = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const prevLenRef      = useRef(0);
  const prevFirstTime   = useRef("");
  const onRangeChangeRef = useRef(onRangeChange);
  useEffect(() => { onRangeChangeRef.current = onRangeChange; }, [onRangeChange]);

  // Create chart + series once on mount
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, CHART_OPTIONS);
    const series = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      prevLenRef.current = 0;
      prevFirstTime.current = "";
    };
  }, []);

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
    seriesRef.current?.setMarkers(buildMarkers(trades, bars));
  }, [trades, bars]);

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}
