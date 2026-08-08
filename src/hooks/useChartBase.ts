import { useEffect, useRef } from "react";
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { RefObject } from "react";
import {
  registerChartTheme,
  resolveChartTheme,
  withAlpha,
  type ChartTheme,
} from "@/lib/chart-theme";

/**
 * Chart surface options, fed from the §3.4 chart theme registry (tokens are
 * the source of truth — no literals here). This is a FUNCTION because token
 * resolution touches getComputedStyle: it must run lazily inside chart
 * effects, never at module scope (SSR).
 *
 * v5 (build doc §10): `layout.panes` styles the separators between native
 * panes (price / volume / RSI / MACD all live on one chart instance).
 */
export function chartOptions(theme: ChartTheme = resolveChartTheme()) {
  return {
    autoSize: true,
    layout: {
      background: { color: "transparent" as const },
      textColor: theme.text,
      fontFamily: "JetBrains Mono, ui-monospace, monospace",
      panes: {
        separatorColor: theme.scaleBorder,
        separatorHoverColor: withAlpha(theme.text, 0.3),
        enableResize: true,
      },
    },
    grid: {
      vertLines: { color: theme.grid },
      horzLines: { color: theme.grid },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: theme.scaleBorder },
    timeScale: {
      borderColor: theme.scaleBorder,
      timeVisible: true,
      secondsVisible: false,
      // §10: the 100k+-bar story. NOTE the doc's "leave it enabled" assumed a
      // default-on flag — in 5.2.0 enableConflation defaults to FALSE
      // (typings), so it must be opted into explicitly. Threshold factor stays
      // at the 1.0 default (higher values are for continuous series, not candles).
      enableConflation: true,
    },
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
    // §13.4: register for theme changes — the registry re-applies the full
    // chart-level options (layout/grid/scales) via applyOptions on the LIVE
    // instance; the chart is never recreated and keeps its data + viewport.
    // Series-level colors re-apply through the useChartTheme hook.
    const unregister = registerChartTheme((theme) => chart.applyOptions(chartOptions(theme)));
    return () => {
      unregister();
      chart.remove();
      chartRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { chartRef };
}
