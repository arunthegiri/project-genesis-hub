import { useEffect, useRef } from "react";
import {
  createChart,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type Time,
} from "lightweight-charts";
import type { EquityPoint } from "@/lib/api/strategies";

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
  rightPriceScale: { borderColor: "rgba(255,255,255,0.06)" },
  timeScale: { borderColor: "rgba(255,255,255,0.06)", timeVisible: true, secondsVisible: false },
} as const;

interface Props {
  equityCurve: EquityPoint[];
  buyHoldCurve?: EquityPoint[];
  height?: number;
}

export function EquityChart({ equityCurve, buyHoldCurve, height = 200 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<"Line"> | null>(null);
  const zeroRef      = useRef<ISeriesApi<"Line"> | null>(null);
  const bahRef       = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, CHART_OPTIONS);

    seriesRef.current = chart.addLineSeries({
      color: "#60a5fa",
      lineWidth: 2,
      priceLineVisible: false,
      title: "Strategy",
    });
    zeroRef.current = chart.addLineSeries({
      color: "rgba(255,255,255,0.15)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    bahRef.current = chart.addLineSeries({
      color: "rgba(156,163,175,0.65)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      title: "Buy & Hold",
    });

    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      zeroRef.current = null;
      bahRef.current = null;
    };
  }, []);

  // Strategy equity curve
  useEffect(() => {
    const chart  = chartRef.current;
    const series = seriesRef.current;
    const zero   = zeroRef.current;
    if (!chart || !series || !zero) return;

    if (!equityCurve.length) {
      series.setData([]);
      zero.setData([]);
      return;
    }

    const data = toChartData(equityCurve);
    series.setData(data);
    zero.setData(data.map(d => ({ time: d.time, value: 0 })));
    chart.timeScale().fitContent();
  }, [equityCurve]);

  // Buy & hold overlay
  useEffect(() => {
    const bah = bahRef.current;
    if (!bah) return;
    if (!buyHoldCurve?.length) {
      bah.setData([]);
      return;
    }
    bah.setData(toChartData(buyHoldCurve));
  }, [buyHoldCurve]);

  const hasData = equityCurve.length > 0 || (buyHoldCurve?.length ?? 0) > 0;

  if (!hasData) {
    return (
      <div
        className="flex items-center justify-center border-t border-border text-xs text-muted-foreground"
        style={{ height }}
      >
        No equity curve data
      </div>
    );
  }

  return (
    <div className="border-t border-border">
      <div className="flex items-center gap-3 px-3 py-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Equity Curve — Cumulative PnL
        </span>
        <span className="flex items-center gap-1 text-[10px] text-blue-400">
          <span className="inline-block h-0.5 w-4 bg-blue-400" /> Strategy
        </span>
        {(buyHoldCurve?.length ?? 0) > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-zinc-400">
            <span className="inline-block h-0.5 w-4 border-t border-dashed border-zinc-400" /> Buy &amp; Hold
          </span>
        )}
      </div>
      <div ref={containerRef} style={{ height }} className="w-full" />
    </div>
  );
}

function toChartData(curve: EquityPoint[]): { time: Time; value: number }[] {
  return curve
    .map(p => ({
      time: Math.floor(new Date(p.time).getTime() / 1000) as UTCTimestamp,
      value: p.cumulative_pnl,
    }))
    .sort((a, b) => (a.time as number) - (b.time as number));
}
