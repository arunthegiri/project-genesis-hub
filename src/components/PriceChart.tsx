import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  type IPaneApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { Interval, PriceBar } from "@/lib/api/types";
import type { BacktestTrade } from "@/lib/api/strategies";
import { sma, ema, bollinger, rsi, macd } from "@/lib/indicators";
import { intervalForSpan } from "@/lib/price-bars";
import { useChartBase, toTs } from "@/hooks/useChartBase";
import { useChartTheme } from "@/hooks/useChartTheme";
import { useRafCoalescer } from "@/hooks/useRafCoalescer";
import { useChartHotkeys, type ChartHotkeyHandlers } from "@/hooks/useHotkeys";
import type { InteractionStore } from "@/lib/stores/chart-interaction";
import { withAlpha } from "@/lib/chart-theme";
import { ChartLegend, type ChartLegendHandle, type LegendIndicatorRow } from "@/components/ChartLegend";
import {
  SessionBandsPrimitive,
  buildExtendedHourSegments,
  etDayKey,
  prevSessionClose,
} from "@/lib/chart-primitives/session-shading";
import { PricePillPrimitive, pricePillColors } from "@/lib/chart-primitives/price-pill";
import { readCssToken } from "@/lib/chart-primitives/chart-tokens";
import { fmtPrice } from "@/lib/format";

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
  /** Panel symbol — used to focus the chart surface on symbol load (§17). */
  symbol?: string;
  /** §17 V hotkey / palette command — volume is otherwise always-on since §9. */
  showVolume?: boolean;
  /** §17 panel-owned hotkey actions; onStep is implemented here on the chart. */
  hotkeys?: Omit<ChartHotkeyHandlers, "onStep">;
  /** Fired once per hotkey use — the panel fades its footer hint line (§11 M2:
      the hint lives in the bottom toolbar, so the state is hoisted there). */
  onHotkeyUse?: () => void;
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
  symbol,
  showVolume = true,
  hotkeys,
  onHotkeyUse,
}: Props) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const { chartRef }   = useChartBase(containerRef);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mainSeriesRef  = useRef<ISeriesApi<any> | null>(null);
  const overlaysRef    = useRef<ISeriesApi<"Line">[]>([]);
  const overlayKeysRef = useRef<string[]>([]);
  const compareSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const hostRef          = useRef<HTMLDivElement>(null);
  const volumeSeriesRef  = useRef<ISeriesApi<"Histogram"> | null>(null);
  const legendRef        = useRef<ChartLegendHandle>(null);
  // §10 (lwc v5): volume/RSI/MACD are native panes on the ONE chart instance —
  // crosshair + visible-range sync across them is built in, so the v4
  // ChartSyncGroup and the separate sub-chart DOM divs/instances are gone.
  // Pane order is canonical (volume, RSI, MACD) regardless of toggle order.
  const volumePaneRef = useRef<IPaneApi<Time> | null>(null);
  const rsiPaneRef = useRef<{ pane: IPaneApi<Time>; series: ISeriesApi<"Line"> } | null>(null);
  const macdPaneRef = useRef<{
    pane: IPaneApi<Time>;
    lineMacd: ISeriesApi<"Line">;
    lineSignal: ISeriesApi<"Line">;
    hist: ISeriesApi<"Histogram">;
  } | null>(null);
  // v5 markers plugin attached to the main series (was series.setMarkers in v4).
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  // §11 M2 primitives: extended-hours bands on pane 0, direction-colored
  // price pill on the main series (replaces the native last-value label).
  const sessionBandsRef = useRef<SessionBandsPrimitive | null>(null);
  const pricePillRef    = useRef<PricePillPrimitive | null>(null);
  // §11 M2: explicit dotted last-price line with its axis label off (the pill
  // owns the gutter) — created/updated by the pill state effect.
  const priceLineRef    = useRef<IPriceLine | null>(null);

  // §3.4 chart theme, resolved from computed style (SSR-guarded: this
  // component only mounts behind ChartPanel's mounted gate). REACTIVE (§13.4
  // useChartTheme): a theme/convention/cb switch re-resolves it, and every
  // theme-colored series effect below re-runs — the main series is recreated
  // with new colors and refed in the same commit (its data effect now also
  // depends on `theme`), overlays re-apply color in place, panes/markers
  // rebuild. Being available in the mount commit still matters: the
  // main-series lifecycle effect creates the series and the data effect feeds
  // it in the same commit — resolving any later would leave the series empty
  // (the blank-chart bug).
  const theme = useChartTheme();

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

  // ── §17 hotkeys, focus ───────────────────────────────────────────────────
  // The chart surface is focusable (tabIndex on the container below): it
  // takes focus on click and on symbol load so single-keys work immediately.
  useEffect(() => {
    if (symbol) containerRef.current?.focus({ preventScroll: true });
  }, [symbol]);

  // Arrow-step: shift the visible logical range one bar and anchor the
  // viewport, exactly like a small pan gesture.
  const handleStep = (dir: 1 | -1) => {
    const chart = chartRef.current;
    if (!chart) return;
    const ts = chart.timeScale();
    const r = ts.getVisibleLogicalRange();
    if (!r) return;
    ts.setVisibleLogicalRange({ from: r.from + dir, to: r.to + dir });
    onGestureRef.current?.();
  };

  // §11 M2: the footer hint moved into the panel's bottom toolbar — hotkey
  // use is reported upward (onHotkeyUse) so the panel can fade it there.
  useChartHotkeys(
    containerRef,
    {
      onInterval: i => hotkeys?.onInterval(i),
      onResetViewport: () => hotkeys?.onResetViewport(),
      onToggleVolume: () => hotkeys?.onToggleVolume(),
      onStep: handleStep,
    },
    { onUse: onHotkeyUse },
  );

  const isComparing = compareData.length > 0;

  // Derived series-shaped data, recomputed only when its inputs change. Keeping
  // these memoised lets the data-update effects call setData() without ever
  // tearing the series down.
  const times  = useMemo(() => bars.map(b => toTs(b.time)), [bars]);
  const closes = useMemo(() => bars.map(b => b.close), [bars]);
  // ET day key per bar — session-band segments and the price pill's
  // previous-session close both compare these (strings, not Intl calls).
  const timesMs  = useMemo(() => bars.map(b => new Date(b.time).getTime()), [bars]);
  const dayKeys  = useMemo(() => timesMs.map(etDayKey), [timesMs]);

  const overlaySpecs = useMemo<OverlaySpec[]>(() => {
    if (!theme || isComparing || !bars.length) return [];
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
      pushLine(`sma-${p}`, `SMA ${p}`, sma(closes, p), theme.overlays[ci++ % theme.overlays.length]));
    indicators.ema?.forEach(p =>
      pushLine(`ema-${p}`, `EMA ${p}`, ema(closes, p), theme.overlays[ci++ % theme.overlays.length]));
    if (indicators.bollinger) {
      const bb = bollinger(closes, indicators.bollinger.period, indicators.bollinger.stdDev);
      pushLine("bb-upper", "BB upper", bb.upper, theme.flat);
      pushLine("bb-mid",   "BB mid",   bb.middle, theme.text);
      pushLine("bb-lower", "BB lower", bb.lower, theme.flat);
    }
    return specs;
  }, [theme, bars.length, times, closes, indicators, isComparing]);

  const rsiData = useMemo<LinePoint[]>(() => {
    if (!indicators.rsi || isComparing || !bars.length) return [];
    return rsi(closes, indicators.rsi)
      .map((v, i) => ({ time: times[i] as Time, value: v }))
      .filter(d => !isNaN(d.value));
  }, [bars.length, times, closes, indicators.rsi, isComparing]);

  const macdData = useMemo<{ macd: LinePoint[]; signal: LinePoint[]; hist: HistPoint[] } | null>(() => {
    if (!theme || !indicators.macd || isComparing || !bars.length) return null;
    const m = macd(closes, indicators.macd.fast, indicators.macd.slow, indicators.macd.signal);
    return {
      macd: m.macd.map((v, i) => ({ time: times[i] as Time, value: v })).filter(d => !isNaN(d.value)),
      signal: m.signal.map((v, i) => ({ time: times[i] as Time, value: v })).filter(d => !isNaN(d.value)),
      hist: m.histogram
        .map((v, i) => ({ time: times[i] as Time, value: v, color: v >= 0 ? theme.upDim : theme.downDim }))
        .filter(d => !isNaN(d.value)),
    };
  }, [theme, bars.length, times, closes, indicators.macd, isComparing]);

  const rsiEnabled  = !!indicators.rsi  && !isComparing;
  const macdEnabled = !!indicators.macd && !isComparing;

  // ── §8 legend lookups — bars keyed by time seconds (crosshair param.time is
  // a UTCTimestamp), and per-overlay value maps for the indicator rows. Empty
  // in compare mode (overlaySpecs already is), so no indicator rows render.
  const barByTime = useMemo(() => {
    const m = new Map<number, PriceBar>();
    bars.forEach((b, i) => m.set(times[i] as number, b));
    return m;
  }, [bars, times]);
  const overlayValueMaps = useMemo(
    () => overlaySpecs.map(s => {
      const values = new Map<number, number>();
      s.data.forEach(d => values.set(d.time as number, d.value));
      return { title: s.title, color: s.color, values };
    }),
    [overlaySpecs],
  );
  const barByTimeRef        = useRef(barByTime);
  const overlayValueMapsRef = useRef(overlayValueMaps);
  useEffect(() => { barByTimeRef.current = barByTime; }, [barByTime]);
  useEffect(() => { overlayValueMapsRef.current = overlayValueMaps; }, [overlayValueMaps]);

  // Legend value writes are imperative DOM mutations, coalesced to one rAF
  // flush per frame — never setState per mousemove.
  const pushLegend = useRafCoalescer((payload: { bar: PriceBar | null; rows: LegendIndicatorRow[] }) => {
    legendRef.current?.write(payload.bar, payload.rows);
  });
  const legendRowsAt = (t: number): LegendIndicatorRow[] => {
    const rows: LegendIndicatorRow[] = [];
    for (const s of overlayValueMapsRef.current) {
      const v = s.values.get(t);
      if (v !== undefined) rows.push({ title: s.title, value: v, color: s.color });
    }
    return rows;
  };

  // Seed the legend with the latest bar so it's populated before the first hover.
  useEffect(() => {
    const bar = bars.length ? bars[bars.length - 1] : null;
    pushLegend({ bar, rows: bar ? legendRowsAt(toTs(bar.time) as number) : [] });
  }, [bars, overlayValueMaps, pushLegend]);

  // Crosshair: bar under cursor from the local map; mouse-out (or a whitespace
  // time with no bar) falls back to the LAST bar — never blank. Also feeds the
  // §7 crosshair channel.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = (param: MouseEventParams) => {
      const t = param.time !== undefined ? (param.time as number) : null;
      const bs = barsRef.current;
      const last = bs.length ? bs[bs.length - 1] : null;
      const bar = t !== null ? (barByTimeRef.current.get(t) ?? last) : last;
      pushLegend({ bar, rows: bar ? legendRowsAt(toTs(bar.time) as number) : [] });
      interactionStore.set({ crosshair: t !== null ? { time: t } : null });
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [interactionStore, pushLegend]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup series refs on unmount (the chart itself — and its panes with it —
  // is cleaned up by useChartBase; each pane lifecycle effect also has its own
  // removePane cleanup)
  useEffect(() => () => {
    mainSeriesRef.current = null;
    overlaysRef.current = [];
    overlayKeysRef.current = [];
    compareSeriesRef.current = [];
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
    if (!chart || !theme) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let main: ISeriesApi<any>;
    if (isComparing || chartType === "line") {
      main = chart.addSeries(LineSeries, {
        color: theme.accent,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
    } else if (chartType === "area") {
      main = chart.addSeries(AreaSeries, {
        lineColor: theme.accent,
        topColor: withAlpha(theme.accent, 0.25),
        bottomColor: withAlpha(theme.accent, 0),
        lineWidth: 2,
      });
    } else if (chartType === "bar") {
      main = chart.addSeries(BarSeries, { upColor: theme.up, downColor: theme.down });
    } else {
      main = chart.addSeries(CandlestickSeries, {
        upColor: theme.up,
        downColor: theme.down,
        borderVisible: false,
        wickUpColor: theme.up,
        wickDownColor: theme.down,
      });
    }
    mainSeriesRef.current = main;

    // §9: last-price line from the last bar (compare mode keeps its own
    // tags). §10: volume is a real pane now, so the price scale keeps its
    // DEFAULT margins — the v4 bottom-30% overlay reservation is deleted.
    // §11 M2: the PricePillPrimitive owns the gutter label, so the native
    // last-value label AND the built-in price line go off (v5 has no
    // separate price-line-label visibility switch — its label would peek out
    // from under the pill). The dotted line itself is re-added by the pill
    // state effect as an explicit createPriceLine with axisLabelVisible:false.
    if (!isComparing) {
      main.applyOptions({
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const pill = new PricePillPrimitive(pricePillColors(theme));
      main.attachPrimitive(pill);
      pricePillRef.current = pill;
    }

    return () => {
      // Detach a lazily-attached markers plugin before its series dies (the
      // markers effect below owns creation; detach is idempotent-guarded here).
      try {
        markersRef.current?.detach();
      } catch {
        /* plugin already gone */
      }
      markersRef.current = null;
      const pill = pricePillRef.current;
      if (pill) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (main as ISeriesApi<any>).detachPrimitive(pill);
        } catch {
          /* series already gone */
        }
        pricePillRef.current = null;
      }
      // The explicit price line dies with its series — just drop the ref.
      priceLineRef.current = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chart.removeSeries(main as ISeriesApi<any>);
      } catch {
        /* series already gone (chart removed) */
      }
      if (mainSeriesRef.current === main) mainSeriesRef.current = null;
    };
  }, [chartType, isComparing, theme, chartRef]);

  // ── Main series DATA — setData on bars/type change; never recreates.
  useEffect(() => {
    const chart = chartRef.current;
    const main  = mainSeriesRef.current;
    if (!chart || !main) return;

    if (!bars.length) { main.setData([]); return; }

    // Viewport intent machine: 'anchored' preserves the user's visible range
    // across the data swap; 'fit' follows the data. Data arrival never flips
    // the intent — only user gestures, symbol change, and explicit Reset do.
    // The range is saved as TIMES (not logical indices): bar indices are
    // meaningless across datasets (interval/symbol change alters bar counts),
    // and restoring them lands the chart in whitespace — the blank-chart bug.
    const ts = chart.timeScale();
    const anchored = viewportIntentRef.current === "anchored" && bars.length > 0;
    const saved = anchored ? ts.getVisibleRange() : null;

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
      // Clamp the saved time range to the new dataset's span; if the user's
      // range no longer overlaps the data at all, fall back to fit.
      const first = times[0] as number;
      const last  = times[times.length - 1] as number;
      const from  = Math.max(saved.from as number, first);
      const to    = Math.min(saved.to as number, last);
      if (to > from) {
        ts.setVisibleRange({ from: from as Time, to: to as Time });
      } else {
        ts.fitContent();
      }
    } else {
      ts.fitContent();
    }
    // `theme` in deps: a §13.4 theme switch recreates the main series (its
    // lifecycle effect depends on theme), so this effect must refeed it in
    // the same commit — otherwise the recreated series stays empty. With
    // 'anchored' intent the visible range is saved/restored as usual, so a
    // retheme preserves the user's zoom.
  }, [bars, times, chartType, isComparing, theme]);

  // ── §11 M2 session bands — extended-hours shading painted behind the price
  // pane (zOrder "bottom"). The lifecycle effect (re)attaches the primitive on
  // theme change and feeds the fill from the token layer; the data effect
  // pushes segments, refed in the same commit after a re-attach.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !theme) return;
    const prim = new SessionBandsPrimitive();
    const pane = chart.panes()[0];
    pane.attachPrimitive(prim);
    prim.setFill(withAlpha(readCssToken("--surface-2"), 0.35));
    sessionBandsRef.current = prim;
    return () => {
      try {
        pane.detachPrimitive(prim);
      } catch {
        /* pane already gone (chart removed) */
      }
      if (sessionBandsRef.current === prim) sessionBandsRef.current = null;
    };
  }, [theme, chartRef]);

  // Intraday guard: at daily aggregation a "pre-market" run would swallow a
  // whole day-width bar, regular session included — so bands only exist when
  // the average bar spacing is under a day.
  useEffect(() => {
    const prim = sessionBandsRef.current;
    if (!prim) return;
    const n = timesMs.length;
    const intraday = n > 1 && (timesMs[n - 1] - timesMs[0]) / (n - 1) < 86_400_000;
    prim.setSegments(intraday ? buildExtendedHourSegments(timesMs) : []);
  }, [timesMs, theme]);

  // ── §11 M2 price pill state — last close, direction vs the previous
  // session's close (prev bar as fallback) — and the dotted last-price line
  // (explicit createPriceLine with axisLabelVisible:false so its label can't
  // peek out from under the pill; the built-in price line stays off). The
  // replay pill stays hidden on the live chart; BacktestingChart feeds it the
  // replay position instead. Deps mirror the main-series lifecycle
  // (theme/chartType/compare) so a re-attached pill is refed in the same
  // commit; a recreated series gets a fresh price line (refs nulled by the
  // lifecycle cleanup).
  useEffect(() => {
    const pill = pricePillRef.current;
    if (!pill || !theme) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const series = mainSeriesRef.current as ISeriesApi<any> | null;
    if (!bars.length) {
      pill.update({ price: null });
      if (series && priceLineRef.current) {
        try {
          series.removePriceLine(priceLineRef.current);
        } catch {
          /* series already gone */
        }
        priceLineRef.current = null;
      }
      return;
    }
    const last = bars[bars.length - 1];
    const prevClose = prevSessionClose(bars, dayKeys, bars.length - 1);
    const up = prevClose !== null ? last.close >= prevClose : true;
    pill.update({
      price: last.close,
      up,
      text: fmtPrice(last.close),
      replayText: null,
    });
    if (series) {
      const color = up ? theme.upDim : theme.downDim;
      if (priceLineRef.current) {
        priceLineRef.current.applyOptions({ price: last.close, color });
      } else {
        priceLineRef.current = series.createPriceLine({
          price: last.close,
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: "",
        });
      }
    }
  }, [bars, dayKeys, theme, chartType, isComparing]);

  // ── Volume PANE lifecycle (§10) — a real pane directly under the price pane
  // on the same chart instance (replaces the v4 blank-priceScale overlay +
  // scaleMargins hack). Toggled by the §17 V hotkey / palette command; hidden
  // in compare mode (percent-normalized data has no volume meaning).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !showVolume || isComparing || !theme) return;
    const pane = chart.addPane();
    pane.moveTo(1); // canonical order: volume sits directly under price
    // v5 gotcha: pane 0's default stretch factor is 2 (DEFAULT_STRETCH_FACTOR
    // * 2), not 1 — 0.85 gives volume ~30% of total height, matching the old
    // in-pane band.
    pane.setStretchFactor(0.85);
    const vol = pane.addSeries(HistogramSeries, {
      // Custom scale id = overlay scale (v5 idiom): autoscaled inside its pane,
      // no axis labels for the series. NOTE: hiding the pane's right price
      // scale outright (visible:false) crashes v5.2.0's layout pass
      // (adjustSizeImpl ensureNotNull on the missing axis widget → "Value is
      // null"), so the axis stays visible-but-empty instead.
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumePaneRef.current = pane;
    volumeSeriesRef.current = vol;
    return () => {
      try {
        chart.removePane(pane.paneIndex());
      } catch {
        /* pane already gone (chart removed) */
      }
      if (volumePaneRef.current === pane) volumePaneRef.current = null;
      if (volumeSeriesRef.current === vol) volumeSeriesRef.current = null;
    };
  }, [showVolume, isComparing, theme, chartRef]);

  // Volume DATA — own effect, never touches the time scale. Runs after the
  // lifecycle effect in the same commit on toggle/theme change, so a recreated
  // pane gets its data immediately.
  useEffect(() => {
    const vol = volumeSeriesRef.current;
    if (!vol || !theme) return;
    vol.setData(
      bars.map((b, i) => ({
        time: times[i] as Time,
        value: b.volume,
        color: b.close >= b.open ? theme.upDim : theme.downDim,
      })),
    );
  }, [bars, times, showVolume, isComparing, theme]);

  // ── Scale-mode toggle (§9) — A/L/% applied to the right price scale. In
  // compare mode the series are already %-normalized: Percentage is forced and
  // the toggle is hidden; Normal is restored on exit. Log is disabled while
  // the MACD histogram (crosses zero) is visible.
  const [scaleMode, setScaleMode] = useState<PriceScaleMode>(PriceScaleMode.Normal);
  useEffect(() => {
    chartRef.current?.priceScale("right").applyOptions({ mode: scaleMode });
  }, [scaleMode]);
  useEffect(() => {
    setScaleMode(isComparing ? PriceScaleMode.Percentage : PriceScaleMode.Normal);
  }, [isComparing]);
  useEffect(() => {
    if (macdEnabled && scaleMode === PriceScaleMode.Logarithmic) setScaleMode(PriceScaleMode.Normal);
  }, [macdEnabled, scaleMode]);

  // ── Indicator overlays — recreate only when the overlay SET changes; else
  // just push new data into the existing line series (no flicker). A §13.4
  // theme switch changes only the COLORS (same keys) — re-applied via
  // applyOptions on the live series.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const newKeys = overlaySpecs.map(s => s.key);
    const prevKeys = overlayKeysRef.current;
    const sameShape = prevKeys.length === newKeys.length && prevKeys.every((k, i) => k === newKeys[i]);

    if (sameShape) {
      overlaySpecs.forEach((spec, i) => {
        overlaysRef.current[i]?.applyOptions({ color: spec.color });
        overlaysRef.current[i]?.setData(spec.data);
      });
      return;
    }

    overlaysRef.current.forEach(s => { try { chart.removeSeries(s); } catch {} });
    overlaysRef.current = overlaySpecs.map(spec => {
      const s = chart.addSeries(LineSeries, { color: spec.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: spec.title });
      s.setData(spec.data);
      return s;
    });
    overlayKeysRef.current = newKeys;
  }, [overlaySpecs]);

  // ── Compare series — rebuilt when the compared symbols/data change (not a
  // hot path). Cleared when leaving compare mode.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !theme) return;

    compareSeriesRef.current.forEach(s => { try { chart.removeSeries(s); } catch {} });
    compareSeriesRef.current = [];
    if (!isComparing) return;

    compareData.forEach(({ symbol, bars: cb }, idx) => {
      if (!cb.length) return;
      const fc = cb[0].close;
      const ct = cb.map(b => toTs(b.time));
      const s = chart.addSeries(LineSeries, {
        color: theme.overlays[idx % theme.overlays.length],
        lineWidth: 2,
        title: symbol,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      s.setData(cb.map((b, i) => ({ time: ct[i] as Time, value: +((b.close / fc - 1) * 100).toFixed(4) })));
      compareSeriesRef.current.push(s);
    });
  }, [compareData, isComparing, theme]);

  // ── RSI PANE lifecycle (§10) — a native pane on the main chart instance.
  // Crosshair + visible-range sync across panes is built into v5, so no sync
  // group and no separate chart/div. Idempotent pair: cleanup removes exactly
  // the pane this run created (StrictMode double-mount safe).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !rsiEnabled || !theme) return;
    const pane = chart.addPane();
    // Canonical sub-pane order (volume, RSI, MACD) even when toggles fire in
    // arbitrary order — refs of the panes above are live at this point.
    pane.moveTo(Math.min(1 + (volumePaneRef.current ? 1 : 0), chart.panes().length - 1));
    pane.setStretchFactor(0.8);
    const series = pane.addSeries(LineSeries, {
      color: theme.overlays[1],
      lineWidth: 2,
      title: "RSI",
    });
    rsiPaneRef.current = { pane, series };
    return () => {
      try {
        chart.removePane(pane.paneIndex());
      } catch {
        /* pane already gone (chart removed) */
      }
      rsiPaneRef.current = null;
    };
  }, [rsiEnabled, theme, chartRef]);

  // RSI data — theme/enabled in deps so a recreated pane is refilled in the
  // same commit (the data effect runs after the lifecycle effect).
  useEffect(() => {
    rsiPaneRef.current?.series.setData(rsiData);
  }, [rsiData, rsiEnabled, theme]);

  // ── MACD PANE lifecycle (§10) — same native-pane pattern as RSI.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !macdEnabled || !theme) return;
    const pane = chart.addPane();
    pane.moveTo(
      Math.min(
        1 + (volumePaneRef.current ? 1 : 0) + (rsiPaneRef.current ? 1 : 0),
        chart.panes().length - 1,
      ),
    );
    pane.setStretchFactor(0.9);
    const lineMacd = pane.addSeries(LineSeries, {
      color: theme.accent,
      lineWidth: 2,
      title: "MACD",
    });
    const lineSignal = pane.addSeries(LineSeries, {
      color: theme.overlays[3],
      lineWidth: 2,
      title: "Signal",
    });
    const hist = pane.addSeries(HistogramSeries, { color: theme.flat });
    macdPaneRef.current = { pane, lineMacd, lineSignal, hist };
    return () => {
      try {
        chart.removePane(pane.paneIndex());
      } catch {
        /* pane already gone (chart removed) */
      }
      macdPaneRef.current = null;
    };
  }, [macdEnabled, theme, chartRef]);

  // MACD data
  useEffect(() => {
    const sub = macdPaneRef.current;
    if (!sub) return;
    sub.lineMacd.setData(macdData?.macd ?? []);
    sub.lineSignal.setData(macdData?.signal ?? []);
    sub.hist.setData(macdData?.hist ?? []);
  }, [macdData, macdEnabled, theme]);

  // ── Trade markers (§10: createSeriesMarkers plugin) — re-applied after the
  // main series is (re)created, so they survive a chartType/compare switch.
  // The plugin attaches LAZILY, only while trades exist: in v5.2.0 its pane
  // view calls series.data() on EVERY update cycle — an O(bars) allocation per
  // pan/zoom frame even with zero markers — so an idle plugin is a real perf
  // tax at high bar counts (verified via CDP profile at 100k bars).
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const series = mainSeriesRef.current as ISeriesApi<any> | null;
    if (!series || !theme) return;

    if (!trades.length) {
      try {
        markersRef.current?.detach();
      } catch {
        /* plugin already gone */
      }
      markersRef.current = null;
      return;
    }

    if (!markersRef.current) markersRef.current = createSeriesMarkers(series, []);
    const plugin = markersRef.current;

    const markers: SeriesMarker<Time>[] = [];
    for (const t of trades) {
      const isLong = t.direction === "long";
      markers.push({
        time: toTs(t.entry_time) as Time,
        position: isLong ? "belowBar" : "aboveBar",
        color: isLong ? theme.up : theme.down,
        shape: isLong ? "arrowUp" : "arrowDown",
        text: isLong ? "L" : "S",
      });
      if (t.status === "closed" && t.exit_time && t.exit_price != null) {
        markers.push({
          time: toTs(t.exit_time) as Time,
          position: isLong ? "aboveBar" : "belowBar",
          color: t.win ? theme.up : theme.down,
          shape: "circle",
          text: t.win ? "+" : "-",
        });
      }
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    plugin.setMarkers(markers);
  }, [trades, bars, chartType, isComparing, theme]);

  return (
    <div ref={hostRef} className="flex flex-col h-full" style={{ height }}>
      <div className="relative w-full flex-1 min-h-0">
        {/* Chart surface — focusable so §17 single-key hotkeys have a scope.
            Clicking anywhere on the chart focuses it; symbol load also
            focuses it (effect above). */}
        <div
          ref={containerRef}
          data-testid="chart-surface"
          className="w-full h-full outline-none"
          tabIndex={0}
          onPointerDown={() => containerRef.current?.focus({ preventScroll: true })}
        />
        <ChartLegend ref={legendRef} />
        {!isComparing && (
          <div className="absolute bottom-8 right-16 z-10 flex overflow-hidden rounded border border-border bg-card/80">
            {([
              { label: "A", mode: PriceScaleMode.Normal,      title: "Arithmetic scale", disabled: false },
              { label: "L", mode: PriceScaleMode.Logarithmic, title: "Logarithmic scale", disabled: macdEnabled },
              { label: "%", mode: PriceScaleMode.Percentage,  title: "Percentage scale", disabled: false },
            ] as const).map(m => (
              <button
                key={m.label}
                type="button"
                title={m.title}
                disabled={m.disabled}
                onClick={() => setScaleMode(m.mode)}
                className={`px-1.5 py-0.5 font-mono text-[10px] disabled:opacity-40 ${scaleMode === m.mode ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
