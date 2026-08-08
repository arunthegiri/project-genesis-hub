import { useEffect, useRef } from "react";
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { RefObject } from "react";
import { resolveChartTheme, type ChartTheme } from "@/lib/chart-theme";

/**
 * Chart surface options, fed from the §3.4 chart theme registry (tokens are
 * the source of truth — no literals here). This is a FUNCTION because token
 * resolution touches getComputedStyle: it must run lazily inside chart
 * effects, never at module scope (SSR).
 */
export function chartOptions(theme: ChartTheme = resolveChartTheme()) {
  return {
    autoSize: true,
    layout: {
      background: { color: "transparent" as const },
      textColor: theme.text,
      fontFamily: "JetBrains Mono, ui-monospace, monospace",
    },
    grid: {
      vertLines: { color: theme.grid },
      horzLines: { color: theme.grid },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: theme.scaleBorder },
    timeScale: { borderColor: theme.scaleBorder, timeVisible: true, secondsVisible: false },
  };
}

export function toTs(isoString: string): UTCTimestamp {
  return Math.floor(new Date(isoString).getTime() / 1000) as UTCTimestamp;
}

export function useChartBase(containerRef: RefObject<HTMLDivElement | null>) {
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, chartOptions());
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { chartRef };
}
