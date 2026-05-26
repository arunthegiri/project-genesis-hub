import { useEffect, useRef } from "react";
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { PriceBar } from "@/lib/api/types";
import type { BacktestTrade } from "@/lib/api/strategies";
import { sma, ema, bollinger, rsi, macd } from "@/lib/indicators";

export type ChartType = "candlestick" | "line" | "bar" | "area";

export interface IndicatorConfig {
  sma?: number[];
  ema?: number[];
  bollinger?: { period: number; stdDev: number } | null;
  rsi?: number | null;
  macd?: { fast: number; slow: number; signal: number } | null;
}

export interface CompareEntry {
  symbol: string;
  bars: PriceBar[];
}

interface Props {
  bars: PriceBar[];
  indicators: IndicatorConfig;
  height?: number;
  chartType?: ChartType;
  compareData?: CompareEntry[];
  trades?: BacktestTrade[];
}

const INDICATOR_COLORS = ["#60a5fa", "#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#fb923c"];
const COMPARE_COLORS  = ["#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#fb923c"];

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
  timeScale: { borderColor: "rgba(255,255,255,0.06)", timeVisible: true, secondsVisible: false },
} as const;

function toTs(isoString: string): UTCTimestamp {
  return Math.floor(new Date(isoString).getTime() / 1000) as UTCTimestamp;
}

export function PriceChart({
  bars,
  indicators,
  height = 480,
  chartType = "candlestick",
  compareData = [],
  trades = [],
}: Props) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const chartRef       = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mainSeriesRef  = useRef<ISeriesApi<any> | null>(null);
  const overlaysRef    = useRef<ISeriesApi<"Line">[]>([]);
  const compareSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const subChartsRef   = useRef<{ chart: IChartApi; container: HTMLDivElement }[]>([]);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, CHART_OPTIONS);
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
      overlaysRef.current = [];
      compareSeriesRef.current = [];
    };
  }, []);

  // Main series + indicators
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove stale series
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (mainSeriesRef.current) { try { chart.removeSeries(mainSeriesRef.current as ISeriesApi<any>); } catch {} mainSeriesRef.current = null; }
    overlaysRef.current.forEach(s => { try { chart.removeSeries(s); } catch {} });
    overlaysRef.current = [];
    compareSeriesRef.current.forEach(s => { try { chart.removeSeries(s); } catch {} });
    compareSeriesRef.current = [];

    if (!bars.length) return;

    const times = bars.map(b => toTs(b.time));
    const isComparing = compareData.length > 0;

    if (isComparing) {
      // Normalize everything to % return from first bar
      const firstClose = bars[0].close;
      const main = chart.addLineSeries({ color: "#60a5fa", lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
      main.setData(bars.map((b, i) => ({ time: times[i] as Time, value: +((b.close / firstClose - 1) * 100).toFixed(4) })));
      mainSeriesRef.current = main;

      compareData.forEach(({ symbol, bars: cb }, idx) => {
        if (!cb.length) return;
        const fc = cb[0].close;
        const ct = cb.map(b => toTs(b.time));
        const s = chart.addLineSeries({
          color: COMPARE_COLORS[idx % COMPARE_COLORS.length],
          lineWidth: 2,
          title: symbol,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        s.setData(cb.map((b, i) => ({ time: ct[i] as Time, value: +((b.close / fc - 1) * 100).toFixed(4) })));
        compareSeriesRef.current.push(s);
      });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let main: ISeriesApi<any>;

      if (chartType === "line") {
        main = chart.addLineSeries({ color: "#60a5fa", lineWidth: 2, priceLineVisible: false });
        main.setData(bars.map((b, i) => ({ time: times[i] as Time, value: b.close })));
      } else if (chartType === "area") {
        main = chart.addAreaSeries({ lineColor: "#60a5fa", topColor: "rgba(96,165,250,0.25)", bottomColor: "rgba(96,165,250,0)", lineWidth: 2 });
        main.setData(bars.map((b, i) => ({ time: times[i] as Time, value: b.close })));
      } else if (chartType === "bar") {
        main = chart.addBarSeries({ upColor: "#22c55e", downColor: "#ef4444" });
        main.setData(bars.map((b, i) => ({ time: times[i] as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
      } else {
        main = chart.addCandlestickSeries({ upColor: "#22c55e", downColor: "#ef4444", borderVisible: false, wickUpColor: "#22c55e", wickDownColor: "#ef4444" });
        main.setData(bars.map((b, i) => ({ time: times[i] as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
      }
      mainSeriesRef.current = main;

      // Indicator overlays
      const closes = bars.map(b => b.close);
      let ci = 0;
      const addLine = (values: number[], color: string, title: string) => {
        const s = chart.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title });
        s.setData(values.map((v, i) => ({ time: times[i] as Time, value: v })).filter(d => !isNaN(d.value)));
        overlaysRef.current.push(s);
      };
      indicators.sma?.forEach(p => addLine(sma(closes, p), INDICATOR_COLORS[ci++ % INDICATOR_COLORS.length], `SMA ${p}`));
      indicators.ema?.forEach(p => addLine(ema(closes, p), INDICATOR_COLORS[ci++ % INDICATOR_COLORS.length], `EMA ${p}`));
      if (indicators.bollinger) {
        const bb = bollinger(closes, indicators.bollinger.period, indicators.bollinger.stdDev);
        addLine(bb.upper, "#94a3b8", "BB upper");
        addLine(bb.middle, "#cbd5e1", "BB mid");
        addLine(bb.lower, "#94a3b8", "BB lower");
      }
    }

    chart.timeScale().fitContent();
  }, [bars, indicators, chartType, compareData]);

  // Sub-charts: RSI + MACD (hidden in compare mode)
  useEffect(() => {
    const container = containerRef.current?.parentElement;
    if (!container) return;
    subChartsRef.current.forEach(({ chart, container: c }) => { chart.remove(); c.remove(); });
    subChartsRef.current = [];

    if (!bars.length || compareData.length > 0) return;

    const closes = bars.map(b => b.close);
    const times  = bars.map(b => toTs(b.time));

    const mkSub = (h: number, build: (chart: IChartApi) => void) => {
      const div = document.createElement("div");
      div.style.height = `${h}px`;
      div.style.width  = "100%";
      div.style.borderTop = "1px solid rgba(255,255,255,0.06)";
      container.appendChild(div);
      const c = createChart(div, CHART_OPTIONS);
      build(c);
      subChartsRef.current.push({ chart: c, container: div });
    };

    if (indicators.rsi) {
      mkSub(120, c => {
        const s = c.addLineSeries({ color: "#a78bfa", lineWidth: 2, title: `RSI ${indicators.rsi}` });
        s.setData(rsi(closes, indicators.rsi!).map((v, i) => ({ time: times[i] as Time, value: v })).filter(d => !isNaN(d.value)));
      });
    }
    if (indicators.macd) {
      mkSub(140, c => {
        const m = macd(closes, indicators.macd!.fast, indicators.macd!.slow, indicators.macd!.signal);
        c.addLineSeries({ color: "#60a5fa", lineWidth: 2, title: "MACD" })
          .setData(m.macd.map((v, i) => ({ time: times[i] as Time, value: v })).filter(d => !isNaN(d.value)));
        c.addLineSeries({ color: "#f59e0b", lineWidth: 2, title: "Signal" })
          .setData(m.signal.map((v, i) => ({ time: times[i] as Time, value: v })).filter(d => !isNaN(d.value)));
        c.addHistogramSeries({ color: "#475569" })
          .setData(m.histogram.map((v, i) => ({ time: times[i] as Time, value: v, color: v >= 0 ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)" })).filter(d => !isNaN(d.value)));
      });
    }

    return () => {
      subChartsRef.current.forEach(({ chart, container: c }) => { chart.remove(); c.remove(); });
      subChartsRef.current = [];
    };
  }, [bars, indicators.rsi, indicators.macd, compareData]);

  // Trade markers — runs after the series effect so mainSeriesRef is populated
  useEffect(() => {
    const series = mainSeriesRef.current;
    if (!series) return;

    if (!trades.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (series as ISeriesApi<any>).setMarkers([]);
      return;
    }

    const toTs = (iso: string) =>
      Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;

    const markers: SeriesMarker<Time>[] = [];

    for (const t of trades) {
      const isLong = t.direction === "long";

      markers.push({
        time: toTs(t.entry_time) as Time,
        position: isLong ? "belowBar" : "aboveBar",
        color: isLong ? "#22c55e" : "#ef4444",
        shape: isLong ? "arrowUp" : "arrowDown",
        text: isLong ? "L" : "S",
      });

      if (t.status === "closed" && t.exit_time && t.exit_price != null) {
        markers.push({
          time: toTs(t.exit_time) as Time,
          position: isLong ? "aboveBar" : "belowBar",
          color: t.win ? "#22c55e" : "#ef4444",
          shape: "circle",
          text: t.win ? "+" : "-",
        });
      }
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (series as ISeriesApi<any>).setMarkers(markers);
  }, [trades, bars]);

  return (
    <div className="flex flex-col">
      <div ref={containerRef} style={{ height }} className="w-full" />
    </div>
  );
}
