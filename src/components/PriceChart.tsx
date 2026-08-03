import { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { Interval, PriceBar } from "@/lib/api/types";
import type { BacktestTrade } from "@/lib/api/strategies";
import { sma, ema, bollinger, rsi, macd } from "@/lib/indicators";
import { intervalForSpan } from "@/lib/price-bars";
import { useChartBase, toTs, CHART_OPTIONS } from "@/hooks/useChartBase";
import { useRafCoalescer } from "@/hooks/useRafCoalescer";
import type { InteractionStore } from "@/lib/stores/chart-interaction";
import { CHART_COLORS } from "@/lib/chart-colors";

export type ChartType = "candlestick" | "line" | "bar" | "area";

/**
 * Viewport intent state machine (build doc §5): 'fit' = follow the data
 * (fitContent on data change); 'anchored' = preserve the user's visible range
 * across data updates. Owned by ChartPanel; data arrival never mutates it.
 */
export type ViewportIntent = "fit" | "anchored";

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
  height?: number | string;
  chartType?: ChartType;
  compareData?: CompareEntry[];
  trades?: BacktestTrade[];
  onAutoInterval?: (interval: Interval) => void;
  /** High-frequency interaction channel (§7) — replaces the old visibleRange/onRangeChange prop round-trip. */
  interactionStore: InteractionStore;
  viewportIntent?: ViewportIntent;
  /** Fired on user pan/zoom gestures (wheel / pointer) — never on programmatic range changes. */
  onViewportGesture?: () => void;
}

type LinePoint = { time: Time; value: number };
type HistPoint = { time: Time; value: number; color: string };

// A single indicator overlay: a stable `key` identifies its shape so series are
// only recreated when the *set* of overlays changes (an indicator toggled), not
// when their data changes.
interface OverlaySpec {
  key: string;
  color: string;
  title: string;
  data: LinePoint[];
}

export function PriceChart({
  bars,
  indicators,
  height = "100%",
  chartType = "candlestick",
  compareData = [],
  trades = [],
  onAutoInterval,
  interactionStore,
  viewportIntent = "fit",
  onViewportGesture,
}: Props) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const { chartRef }   = useChartBase(containerRef);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mainSeriesRef  = useRef<ISeriesApi<any> | null>(null);
  const overlaysRef    = useRef<ISeriesApi<"Line">[]>([]);
  const overlayKeysRef = useRef<string[]>([]);
  const compareSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const rsiSubRef  = useRef<{ chart: IChartApi; series: ISeriesApi<"Line">; container: HTMLDivElement } | null>(null);
  const macdSubRef = useRef<{
    chart: IChartApi;
    lineMacd: ISeriesApi<"Line">;
    lineSignal: ISeriesApi<"Line">;
    hist: ISeriesApi<"Histogram">;
    container: HTMLDivElement;
  } | null>(null);

  // Stable refs to latest callbacks — avoids re-subscribing on every render
  const onAutoIntervalRef  = useRef(onAutoInterval);
  const onGestureRef       = useRef(onViewportGesture);
  useEffect(() => { onAutoIntervalRef.current = onAutoInterval; }, [onAutoInterval]);
  useEffect(() => { onGestureRef.current      = onViewportGesture; }, [onViewportGesture]);

  // Latest bars for the coalesced auto-interval computation.
  const barsRef = useRef(bars);
  useEffect(() => { barsRef.current = bars; }, [bars]);

  // Mirror of the viewport-intent prop for the data effect (which must not
  // re-run when intent flips — only when data does).
  const viewportIntentRef = useRef(viewportIntent);
  useEffect(() => { viewportIntentRef.current = viewportIntent; }, [viewportIntent]);

  // Explicit 'fit' transitions (symbol change, Reset) fit immediately, even
  // without a data change.
  useEffect(() => {
    if (viewportIntent === "fit") chartRef.current?.timeScale().fitContent();
  }, [viewportIntent]); // eslint-disable-line react-hooks/exhaustive-deps

  // User pan/zoom gestures anchor the viewport. DOM events distinguish user
  // gestures from programmatic setVisibleLogicalRange/fitContent calls (which
  // also emit range-change events and must NOT anchor).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const gesture = () => onGestureRef.current?.();
    el.addEventListener("wheel", gesture, { passive: true });
    el.addEventListener("pointerdown", gesture);
    return () => {
      el.removeEventListener("wheel", gesture);
      el.removeEventListener("pointerdown", gesture);
    };
  }, []);

  const isComparing = compareData.length > 0;

  // Derived series-shaped data, recomputed only when its inputs change. Keeping
  // these memoised lets the data-update effects call setData() without ever
  // tearing the series down.
  const times  = useMemo(() => bars.map(b => toTs(b.time)), [bars]);
  const closes = useMemo(() => bars.map(b => b.close), [bars]);

  const overlaySpecs = useMemo<OverlaySpec[]>(() => {
    if (isComparing || !bars.length) return [];
    const specs: OverlaySpec[] = [];
    let ci = 0;
    const pushLine = (key: string, title: string, values: number[], color: string) => {
      specs.push({
        key,
        color,
        title,
        data: values
          .map((v, i) => ({ time: times[i] as Time, value: v }))
          .filter(d => !isNaN(d.value)),
      });
    };
    indicators.sma?.forEach(p =>
      pushLine(`sma-${p}`, `SMA ${p}`, sma(closes, p), CHART_COLORS.indicator[ci++ % CHART_COLORS.indicator.length]));
    indicators.ema?.forEach(p =>
      pushLine(`ema-${p}`, `EMA ${p}`, ema(closes, p), CHART_COLORS.indicator[ci++ % CHART_COLORS.indicator.length]));
    if (indicators.bollinger) {
      const bb = bollinger(closes, indicators.bollinger.period, indicators.bollinger.stdDev);
      pushLine("bb-upper", "BB upper", bb.upper, "#94a3b8");
      pushLine("bb-mid",   "BB mid",   bb.middle, "#cbd5e1");
      pushLine("bb-lower", "BB lower", bb.lower, "#94a3b8");
    }
    return specs;
  }, [bars.length, times, closes, indicators, isComparing]);

  const rsiData = useMemo<LinePoint[]>(() => {
    if (!indicators.rsi || isComparing || !bars.length) return [];
    return rsi(closes, indicators.rsi)
      .map((v, i) => ({ time: times[i] as Time, value: v }))
      .filter(d => !isNaN(d.value));
  }, [bars.length, times, closes, indicators.rsi, isComparing]);

  const macdData = useMemo<{ macd: LinePoint[]; signal: LinePoint[]; hist: HistPoint[] } | null>(() => {
    if (!indicators.macd || isComparing || !bars.length) return null;
    const m = macd(closes, indicators.macd.fast, indicators.macd.slow, indicators.macd.signal);
    return {
      macd: m.macd.map((v, i) => ({ time: times[i] as Time, value: v })).filter(d => !isNaN(d.value)),
      signal: m.signal.map((v, i) => ({ time: times[i] as Time, value: v })).filter(d => !isNaN(d.value)),
      hist: m.histogram
        .map((v, i) => ({ time: times[i] as Time, value: v, color: v >= 0 ? CHART_COLORS.bullDim : CHART_COLORS.bearDim }))
        .filter(d => !isNaN(d.value)),
    };
  }, [bars.length, times, closes, indicators.macd, isComparing]);

  const rsiEnabled  = !!indicators.rsi  && !isComparing;
  const macdEnabled = !!indicators.macd && !isComparing;

  // Cleanup series refs and sub-panes on unmount (chart itself cleaned up by useChartBase)
  useEffect(() => () => {
    mainSeriesRef.current = null;
    overlaysRef.current = [];
    overlayKeysRef.current = [];
    compareSeriesRef.current = [];
    if (rsiSubRef.current)  { rsiSubRef.current.chart.remove();  rsiSubRef.current.container.remove();  rsiSubRef.current = null; }
    if (macdSubRef.current) { macdSubRef.current.chart.remove(); macdSubRef.current.container.remove(); macdSubRef.current = null; }
  }, []);

  // ── Interaction store wiring (§7) ────────────────────────────────────────
  // Producer: chart pans/zooms write the logical range into the store (0.5-bar
  // tolerance so sub-bar noise doesn't fan out to subscribers).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    let last: { from: number; to: number } | null = null;
    const handler = (range: { from: number; to: number } | null) => {
      if (!range) return;
      if (last && Math.abs(last.from - range.from) < 0.5 && Math.abs(last.to - range.to) < 0.5) return;
      last = { from: range.from, to: range.to };
      interactionStore.set({ visibleRange: last });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, [interactionStore]);

  // Consumer: store ranges from OUTSIDE the chart (scrollbar drags, zoom
  // buttons) are applied to the time scale. The epsilon guard kills the echo
  // from chart-originated writes — no feedback loop.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    return interactionStore.subscribe(() => {
      const r = interactionStore.getSnapshot().visibleRange;
      if (!r) return;
      const ts = chart.timeScale();
      const cur = ts.getVisibleLogicalRange();
      if (!cur || Math.abs(cur.from - r.from) > 0.5 || Math.abs(cur.to - r.to) > 0.5) {
        ts.setVisibleLogicalRange(r);
      }
    });
  }, [interactionStore]);

  // Auto-interval suggestion: a coalesced store subscription, not a
  // render-driven effect. Fires only on span-table boundary crossings;
  // ChartPanel applies it only in auto mode.
  const lastSuggestedRef = useRef<Interval | null>(null);
  const pushSuggestion = useRafCoalescer((range: { from: number; to: number }) => {
    const bs = barsRef.current;
    if (!bs.length || !onAutoIntervalRef.current) return;
    const fromIdx = Math.max(0, Math.floor(range.from));
    const toIdx = Math.min(bs.length - 1, Math.floor(range.to));
    if (toIdx <= fromIdx) return;
    const spanDays = (toTs(bs[toIdx].time) - toTs(bs[fromIdx].time)) / 86400;
    const suggested = intervalForSpan(spanDays);
    if (suggested === lastSuggestedRef.current) return;
    lastSuggestedRef.current = suggested;
    onAutoIntervalRef.current(suggested);
  });
  useEffect(() => {
    return interactionStore.subscribe(() => {
      const r = interactionStore.getSnapshot().visibleRange;
      if (r) pushSuggestion(r);
    });
  }, [interactionStore, pushSuggestion]);

  // lastBar producer — feeds the §8 legend and §15 staleness rail.
  useEffect(() => {
    const b = bars[bars.length - 1];
    interactionStore.set({
      lastBar: b
        ? { time: toTs(b.time), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }
        : null,
    });
  }, [bars, interactionStore]);

  // ── Main series LIFECYCLE — recreate only when the series type (or compare
  // mode) changes. Data is applied by a separate effect so a bars change never
  // tears the series down.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let main: ISeriesApi<any>;
    if (isComparing || chartType === "line") {
      main = chart.addLineSeries({ color: CHART_COLORS.accent, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    } else if (chartType === "area") {
      main = chart.addAreaSeries({ lineColor: CHART_COLORS.accent, topColor: "rgba(96,165,250,0.25)", bottomColor: "rgba(96,165,250,0)", lineWidth: 2 });
    } else if (chartType === "bar") {
      main = chart.addBarSeries({ upColor: CHART_COLORS.bull, downColor: CHART_COLORS.bear });
    } else {
      main = chart.addCandlestickSeries({ upColor: CHART_COLORS.bull, downColor: CHART_COLORS.bear, borderVisible: false, wickUpColor: CHART_COLORS.bull, wickDownColor: CHART_COLORS.bear });
    }
    mainSeriesRef.current = main;

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { chart.removeSeries(main as ISeriesApi<any>); } catch {}
      if (mainSeriesRef.current === main) mainSeriesRef.current = null;
    };
  }, [chartType, isComparing]);

  // ── Main series DATA — setData on bars/type change; never recreates.
  useEffect(() => {
    const chart = chartRef.current;
    const main  = mainSeriesRef.current;
    if (!chart || !main) return;

    if (!bars.length) { main.setData([]); return; }

    // Viewport intent machine: 'anchored' preserves the user's visible range
    // across the data swap; 'fit' follows the data. Data arrival never flips
    // the intent — only user gestures, symbol change, and explicit Reset do.
    const ts = chart.timeScale();
    const anchored = viewportIntentRef.current === "anchored" && bars.length > 0;
    const saved = anchored ? ts.getVisibleLogicalRange() : null;

    if (isComparing) {
      // Normalize to % return from first bar
      const firstClose = bars[0].close;
      main.setData(bars.map((b, i) => ({ time: times[i] as Time, value: +((b.close / firstClose - 1) * 100).toFixed(4) })));
    } else if (chartType === "line" || chartType === "area") {
      main.setData(bars.map((b, i) => ({ time: times[i] as Time, value: b.close })));
    } else {
      main.setData(bars.map((b, i) => ({ time: times[i] as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
    }

    if (saved) {
      ts.setVisibleLogicalRange(saved);
    } else {
      ts.fitContent();
    }
  }, [bars, times, chartType, isComparing]);

  // ── Indicator overlays — recreate only when the overlay SET changes; else
  // just push new data into the existing line series (no flicker).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const newKeys = overlaySpecs.map(s => s.key);
    const prevKeys = overlayKeysRef.current;
    const sameShape = prevKeys.length === newKeys.length && prevKeys.every((k, i) => k === newKeys[i]);

    if (sameShape) {
      overlaySpecs.forEach((spec, i) => overlaysRef.current[i]?.setData(spec.data));
      return;
    }

    overlaysRef.current.forEach(s => { try { chart.removeSeries(s); } catch {} });
    overlaysRef.current = overlaySpecs.map(spec => {
      const s = chart.addLineSeries({ color: spec.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: spec.title });
      s.setData(spec.data);
      return s;
    });
    overlayKeysRef.current = newKeys;
  }, [overlaySpecs]);

  // ── Compare series — rebuilt when the compared symbols/data change (not a
  // hot path). Cleared when leaving compare mode.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    compareSeriesRef.current.forEach(s => { try { chart.removeSeries(s); } catch {} });
    compareSeriesRef.current = [];
    if (!isComparing) return;

    compareData.forEach(({ symbol, bars: cb }, idx) => {
      if (!cb.length) return;
      const fc = cb[0].close;
      const ct = cb.map(b => toTs(b.time));
      const s = chart.addLineSeries({
        color: CHART_COLORS.compare[idx % CHART_COLORS.compare.length],
        lineWidth: 2,
        title: symbol,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      s.setData(cb.map((b, i) => ({ time: ct[i] as Time, value: +((b.close / fc - 1) * 100).toFixed(4) })));
      compareSeriesRef.current.push(s);
    });
  }, [compareData, isComparing]);

  // ── RSI sub-pane lifecycle — create/destroy only on enable toggle.
  useEffect(() => {
    const parent = containerRef.current?.parentElement;
    if (!parent) return;
    if (rsiEnabled && !rsiSubRef.current) {
      const div = document.createElement("div");
      div.style.height = "120px";
      div.style.width  = "100%";
      div.style.borderTop = "1px solid rgba(255,255,255,0.06)";
      parent.appendChild(div);
      const chart = createChart(div, CHART_OPTIONS);
      const series = chart.addLineSeries({ color: "#a78bfa", lineWidth: 2, title: "RSI" });
      rsiSubRef.current = { chart, series, container: div };
    } else if (!rsiEnabled && rsiSubRef.current) {
      rsiSubRef.current.chart.remove();
      rsiSubRef.current.container.remove();
      rsiSubRef.current = null;
    }
  }, [rsiEnabled]);

  // RSI data
  useEffect(() => {
    rsiSubRef.current?.series.setData(rsiData);
  }, [rsiData]);

  // ── MACD sub-pane lifecycle — create/destroy only on enable toggle.
  useEffect(() => {
    const parent = containerRef.current?.parentElement;
    if (!parent) return;
    if (macdEnabled && !macdSubRef.current) {
      const div = document.createElement("div");
      div.style.height = "140px";
      div.style.width  = "100%";
      div.style.borderTop = "1px solid rgba(255,255,255,0.06)";
      parent.appendChild(div);
      const chart = createChart(div, CHART_OPTIONS);
      const lineMacd   = chart.addLineSeries({ color: CHART_COLORS.accent, lineWidth: 2, title: "MACD" });
      const lineSignal = chart.addLineSeries({ color: "#f59e0b", lineWidth: 2, title: "Signal" });
      const hist       = chart.addHistogramSeries({ color: "#475569" });
      macdSubRef.current = { chart, lineMacd, lineSignal, hist, container: div };
    } else if (!macdEnabled && macdSubRef.current) {
      macdSubRef.current.chart.remove();
      macdSubRef.current.container.remove();
      macdSubRef.current = null;
    }
  }, [macdEnabled]);

  // MACD data
  useEffect(() => {
    const sub = macdSubRef.current;
    if (!sub) return;
    sub.lineMacd.setData(macdData?.macd ?? []);
    sub.lineSignal.setData(macdData?.signal ?? []);
    sub.hist.setData(macdData?.hist ?? []);
  }, [macdData]);

  // ── Trade markers — re-applied after the main series is (re)created, so they
  // survive a chartType/compare switch.
  useEffect(() => {
    const series = mainSeriesRef.current;
    if (!series) return;

    if (!trades.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (series as ISeriesApi<any>).setMarkers([]);
      return;
    }

    const markers: SeriesMarker<Time>[] = [];
    for (const t of trades) {
      const isLong = t.direction === "long";
      markers.push({
        time: toTs(t.entry_time) as Time,
        position: isLong ? "belowBar" : "aboveBar",
        color: isLong ? CHART_COLORS.bull : CHART_COLORS.bear,
        shape: isLong ? "arrowUp" : "arrowDown",
        text: isLong ? "L" : "S",
      });
      if (t.status === "closed" && t.exit_time && t.exit_price != null) {
        markers.push({
          time: toTs(t.exit_time) as Time,
          position: isLong ? "aboveBar" : "belowBar",
          color: t.win ? CHART_COLORS.bull : CHART_COLORS.bear,
          shape: "circle",
          text: t.win ? "+" : "-",
        });
      }
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (series as ISeriesApi<any>).setMarkers(markers);
  }, [trades, bars, chartType, isComparing]);

  return (
    <div className="flex flex-col h-full" style={{ height }}>
      <div ref={containerRef} className="w-full flex-1 min-h-0" />
    </div>
  );
}
