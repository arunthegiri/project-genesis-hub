import { useEffect, useRef } from "react";
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { PriceBar } from "@/lib/api/types";
import { sma, ema, bollinger, rsi, macd } from "@/lib/indicators";

export interface IndicatorConfig {
  sma?: number[];   // periods, e.g. [20, 50]
  ema?: number[];
  bollinger?: { period: number; stdDev: number } | null;
  rsi?: number | null;
  macd?: { fast: number; slow: number; signal: number } | null;
}

interface Props {
  bars: PriceBar[];
  indicators: IndicatorConfig;
  height?: number;
}

const COLORS = [
  "#60a5fa", "#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#fb923c",
];

export function PriceChart({ bars, indicators, height = 480 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlaysRef = useRef<ISeriesApi<"Line">[]>([]);
  const subChartsRef = useRef<{ chart: IChartApi; container: HTMLDivElement }[]>([]);

  // Create main chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
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
      timeScale: { borderColor: "rgba(255,255,255,0.06)", timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    candleRef.current = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      overlaysRef.current = [];
    };
  }, []);

  // Update data + indicators when inputs change
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleRef.current;
    if (!chart || !candle) return;

    const candleData: CandlestickData<Time>[] = bars.map((b) => ({
      time: (Math.floor(new Date(b.time).getTime() / 1000) as UTCTimestamp),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    candle.setData(candleData);

    // Clear old overlays
    overlaysRef.current.forEach((s) => chart.removeSeries(s));
    overlaysRef.current = [];

    const closes = bars.map((b) => b.close);
    const times = candleData.map((d) => d.time);
    let colorIdx = 0;
    const addLine = (values: number[], color: string, title: string) => {
      const series = chart.addLineSeries({
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        title,
      });
      const data: LineData<Time>[] = [];
      for (let i = 0; i < values.length; i++) {
        if (!isNaN(values[i])) data.push({ time: times[i], value: values[i] });
      }
      series.setData(data);
      overlaysRef.current.push(series);
    };

    indicators.sma?.forEach((p) => addLine(sma(closes, p), COLORS[colorIdx++ % COLORS.length], `SMA ${p}`));
    indicators.ema?.forEach((p) => addLine(ema(closes, p), COLORS[colorIdx++ % COLORS.length], `EMA ${p}`));
    if (indicators.bollinger) {
      const { period, stdDev } = indicators.bollinger;
      const bb = bollinger(closes, period, stdDev);
      addLine(bb.upper, "#94a3b8", `BB upper`);
      addLine(bb.middle, "#cbd5e1", `BB mid`);
      addLine(bb.lower, "#94a3b8", `BB lower`);
    }

    chart.timeScale().fitContent();
  }, [bars, indicators]);

  // Sub-charts (RSI, MACD) — separate panes
  useEffect(() => {
    const container = containerRef.current?.parentElement;
    if (!container) return;
    // Remove old sub-charts
    subChartsRef.current.forEach(({ chart, container: c }) => {
      chart.remove();
      c.remove();
    });
    subChartsRef.current = [];

    const closes = bars.map((b) => b.close);
    const times: UTCTimestamp[] = bars.map(
      (b) => Math.floor(new Date(b.time).getTime() / 1000) as UTCTimestamp,
    );

    const mkSub = (h: number, build: (chart: IChartApi) => void) => {
      const div = document.createElement("div");
      div.style.height = `${h}px`;
      div.style.width = "100%";
      div.style.borderTop = "1px solid rgba(255,255,255,0.06)";
      container.appendChild(div);
      const chart = createChart(div, {
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
      });
      build(chart);
      subChartsRef.current.push({ chart, container: div });
    };

    if (indicators.rsi) {
      mkSub(120, (chart) => {
        const s = chart.addLineSeries({ color: "#a78bfa", lineWidth: 2, title: `RSI ${indicators.rsi}` });
        const v = rsi(closes, indicators.rsi!);
        s.setData(v.map((value, i) => ({ time: times[i], value })).filter((d) => !isNaN(d.value)));
      });
    }

    if (indicators.macd) {
      mkSub(140, (chart) => {
        const m = macd(closes, indicators.macd!.fast, indicators.macd!.slow, indicators.macd!.signal);
        const macdSeries = chart.addLineSeries({ color: "#60a5fa", lineWidth: 2, title: "MACD" });
        const sigSeries = chart.addLineSeries({ color: "#f59e0b", lineWidth: 2, title: "Signal" });
        const histSeries = chart.addHistogramSeries({ color: "#475569" });
        macdSeries.setData(m.macd.map((value, i) => ({ time: times[i], value })).filter((d) => !isNaN(d.value)));
        sigSeries.setData(m.signal.map((value, i) => ({ time: times[i], value })).filter((d) => !isNaN(d.value)));
        histSeries.setData(
          m.histogram
            .map((value, i) => ({
              time: times[i],
              value,
              color: value >= 0 ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)",
            }))
            .filter((d) => !isNaN(d.value)),
        );
      });
    }

    return () => {
      subChartsRef.current.forEach(({ chart, container: c }) => {
        chart.remove();
        c.remove();
      });
      subChartsRef.current = [];
    };
  }, [bars, indicators.rsi, indicators.macd]);

  return (
    <div className="flex flex-col">
      <div ref={containerRef} style={{ height }} className="w-full" />
    </div>
  );
}
