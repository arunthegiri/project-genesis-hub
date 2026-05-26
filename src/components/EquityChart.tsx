import { useEffect, useRef } from "react";
import { createChart, type IChartApi, type UTCTimestamp, type Time } from "lightweight-charts";
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
  height?: number;
}

export function EquityChart({ equityCurve, height = 200 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, CHART_OPTIONS);
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !equityCurve.length) return;

    const series = chart.addLineSeries({
      color: "#60a5fa",
      lineWidth: 2,
      priceLineVisible: false,
      title: "Cumulative PnL",
    });

    const data = equityCurve
      .map(p => ({
        time: Math.floor(new Date(p.time).getTime() / 1000) as UTCTimestamp,
        value: p.cumulative_pnl,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    series.setData(data as { time: Time; value: number }[]);

    // Zero reference line
    chart.addLineSeries({
      color: "rgba(255,255,255,0.15)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    }).setData(data.map(d => ({ time: d.time as Time, value: 0 })));

    chart.timeScale().fitContent();
  }, [equityCurve]);

  if (!equityCurve.length) {
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
      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        Equity Curve — Cumulative PnL
      </div>
      <div ref={containerRef} style={{ height }} className="w-full" />
    </div>
  );
}
