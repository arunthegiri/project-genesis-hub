import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { keepPreviousData, useQuery, useQueries } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import { ChevronDown, ChevronUp, GripHorizontal, Loader2, Plus, X } from "lucide-react";

import { PriceChart, type IndicatorConfig, type ChartType, type ViewportIntent } from "@/components/PriceChart";
import { ChartScrollbar } from "@/components/ChartScrollbar";
import { PythonExport } from "@/components/PythonExport";
import { DateRangePicker } from "@/components/DateRangePicker";
import { StrategySelector } from "@/components/StrategySelector";
import { BacktestStatsPanel } from "@/components/BacktestStatsPanel";
import { EquityChart } from "@/components/EquityChart";
import { pricesApi } from "@/lib/api/prices";
import { symbolsApi, normalizeSymbols } from "@/lib/api/symbols";
import { strategiesApi } from "@/lib/api/strategies";
import { INTERVALS, type Interval } from "@/lib/api/types";
import { applyCapitalConstraints } from "@/lib/backtest-capital";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { buildPythonSnippet } from "@/lib/python-export";
import {
  buildUtcApiRange,
  formatDisplayDate,
  getPresetRange,
  type ChartRangePreset,
} from "@/lib/date-range";
import { aggregatePriceBars, intervalForSpan } from "@/lib/price-bars";
import { intervalMs, snapRange } from "@/lib/interval-policy";
import { CHART_COLORS } from "@/lib/chart-colors";
import { createInteractionStore, type InteractionStore } from "@/lib/stores/chart-interaction";
import { CHARTS_UI_COOKIE, mergeUiCookie, panelUiCookie, readUiCookieJson, writeUiCookie } from "@/lib/cookie-state";
import {
  PanelSkeleton,
  clampHeight,
  DEFAULT_CHART_HEIGHT,
  DEFAULT_DATA_PCT,
  MIN_DATA_PCT,
  MAX_DATA_PCT,
} from "@/components/PanelSkeleton";
import { cn } from "@/lib/utils";

interface Props {
  onRemove: () => void;
  canRemove: boolean;
  initialSymbol?: string;
  persistKey?: string;
  // SSR-correct arrangement from the / route loader (ui.charts cookie).
  initialChartHeight?: number;
  onSymbolChange?: (symbol: string) => void;
}

const RANGE_PRESETS: Exclude<ChartRangePreset, "CUSTOM">[] = ["1D", "5D", "1M", "3M", "6M", "1Y"];
const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "candlestick", label: "Candle" },
  { value: "bar",         label: "Bar"    },
  { value: "line",        label: "Line"   },
  { value: "area",        label: "Area"   },
];

// Chart+data region sizing lives in PanelSkeleton.tsx (co-located with the
// skeleton so the placeholder and the real panel can't drift, §13).
//
// Panel internals persist in the ui.panel.<persistKey> cookie: layout-
// critical, non-sensitive, small JSON. SSR never sees per-panel internals —
// it renders PanelSkeleton until mount, so nothing paints one way and snaps.
interface PanelUiCookie {
  symbol?: string;
  startDate?: string;
  endDate?: string;
  interval?: Interval;
  rangePreset?: ChartRangePreset;
  chartType?: ChartType;
  compareSymbols?: string[];
  showData?: boolean;
  dataPanelPct?: number;
  showSMA?: boolean;
  showEMA?: boolean;
  showBB?: boolean;
  showRSI?: boolean;
  showMACD?: boolean;
  strategy?: string;
}

export function ChartPanel({ onRemove, canRemove, initialSymbol = "", persistKey, initialChartHeight, onSymbolChange }: Props) {
  const initialRange = getPresetRange("5D");

  const initialInterval = intervalForSpan(
    (new Date(initialRange.endDate).getTime() - new Date(initialRange.startDate).getTime()) / 86_400_000);

  // SSR/hydration render these defaults inside PanelSkeleton; the real panel
  // only mounts after the post-mount effect below restores the persisted
  // internals from the panel cookie, so no value ever paints then snaps.
  const [mounted, setMounted]           = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialSymbol);
  const [startDate, setStartDate]     = useState<string>(initialRange.startDate);
  const [endDate, setEndDate]         = useState<string>(initialRange.endDate);
  const [interval, updateInterval]       = useState<Interval>(initialInterval);
  const [rangePreset, setRangePreset] = useState<ChartRangePreset>("5D");
  const [chartType, setChartType]     = useState<ChartType>("candlestick");
  const [compareSymbols, setCompareSymbols] = useState<string[]>([]);
  const [compareInput, setCompareInput]     = useState("");
  const [showData, setShowData]       = useState<boolean>(false);
  const [showSMA,  setShowSMA]        = useState<boolean>(true);
  const [showEMA,  setShowEMA]        = useState<boolean>(false);
  const [showBB,   setShowBB]         = useState<boolean>(false);
  const [showRSI,  setShowRSI]        = useState<boolean>(false);
  const [showMACD, setShowMACD]       = useState<boolean>(false);
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);

  // Viewport & interval intent state machine (build doc §5). Explicit user
  // intent only — data arrival never mutates either field.
  const [viewportIntent, setViewportIntent] = useState<ViewportIntent>("fit");
  const [intervalMode, setIntervalMode]     = useState<"auto" | "pinned">("auto");

  // Layout: vertical height of the whole chart+data region (drag handle at the
  // bottom edge) and the horizontal chart/data split ratio. `dragging` disables
  // the layout CSS transition so panels track the cursor 1:1 while dragging.
  // chartHeight is SSR-known from the ui.charts cookie (via the / loader), so
  // the skeleton and the live panel share the same outer geometry.
  const [chartHeight, setChartHeight]   = useState<number>(() =>
    clampHeight(initialChartHeight ?? DEFAULT_CHART_HEIGHT));
  const [dataPanelPct, setDataPanelPct] = useState<number>(DEFAULT_DATA_PCT);
  const [dragging, setDragging]         = useState<null | "h" | "v">(null);
  const chartRowRef = useRef<HTMLDivElement>(null);

  // Restore persisted internals after mount (client only, post-hydration),
  // then reveal the real panel. All setters batch into one commit — the
  // skeleton swaps straight to fully-restored content.
  const restoredRef = useRef(false);
  useEffect(() => {
    const s = (persistKey ? readUiCookieJson<PanelUiCookie>(panelUiCookie(persistKey)) : null) ?? {};
    if (typeof s.symbol === "string") setSelectedSymbol(s.symbol);
    if (typeof s.startDate === "string") setStartDate(s.startDate);
    if (typeof s.endDate === "string") setEndDate(s.endDate);
    if (typeof s.interval === "string") updateInterval(s.interval);
    if (typeof s.rangePreset === "string") setRangePreset(s.rangePreset);
    if (typeof s.chartType === "string") setChartType(s.chartType);
    if (Array.isArray(s.compareSymbols)) setCompareSymbols(s.compareSymbols);
    if (typeof s.showData === "boolean") setShowData(s.showData);
    if (typeof s.dataPanelPct === "number") setDataPanelPct(s.dataPanelPct);
    if (typeof s.showSMA === "boolean") setShowSMA(s.showSMA);
    if (typeof s.showEMA === "boolean") setShowEMA(s.showEMA);
    if (typeof s.showBB === "boolean") setShowBB(s.showBB);
    if (typeof s.showRSI === "boolean") setShowRSI(s.showRSI);
    if (typeof s.showMACD === "boolean") setShowMACD(s.showMACD);
    if (typeof s.strategy === "string") setSelectedStrategy(s.strategy);
    restoredRef.current = true;
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-pick interval whenever the date range changes — but only in auto
  // mode; a pinned (manually selected) interval survives range nudges.
  useEffect(() => {
    if (intervalMode !== "auto") return;
    const days = (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000;
    updateInterval(intervalForSpan(days));
  }, [startDate, endDate, intervalMode]);

  // Zoom-driven suggestion (from PriceChart's span-table boundary crossings):
  // applies only in auto mode, and only when it actually changes the bucket.
  const handleAutoInterval = useCallback((i: Interval) => {
    if (intervalMode !== "auto") return;
    updateInterval(prev => (prev === i ? prev : i));
  }, [intervalMode]);

  // Manual interval pick pins the policy; the AUTO chip un-pins it and
  // immediately re-derives the interval from the current span.
  const handleIntervalSelect = useCallback((i: Interval) => {
    updateInterval(i);
    setIntervalMode("pinned");
  }, []);

  const handleUnpinInterval = useCallback(() => {
    setIntervalMode("auto");
    const days = (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000;
    updateInterval(intervalForSpan(days));
  }, [startDate, endDate]);

  const handleSymbolChange = useCallback((s: string) => {
    setSelectedSymbol(s);
    setViewportIntent("fit");
    onSymbolChange?.(s);
  }, [onSymbolChange]);

  // Interaction store (§7): visible range / crosshair / lastBar live OUTSIDE
  // React state so panning never re-renders this panel. One store per panel.
  const interactionStoreRef = useRef<InteractionStore | null>(null);
  if (!interactionStoreRef.current) interactionStoreRef.current = createInteractionStore();
  const interactionStore = interactionStoreRef.current;

  // Horizontal splitter — drag to adjust the chart/data width ratio.
  const startHDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const row = chartRowRef.current;
    if (!row) return;
    const rowWidth = row.getBoundingClientRect().width;
    const startX = e.clientX;
    const startPct = dataPanelPct;
    setDragging("h");
    const onMove = (ev: MouseEvent) => {
      // Dragging left widens the data panel.
      const delta = ((startX - ev.clientX) / rowWidth) * 100;
      setDataPanelPct(Math.min(MAX_DATA_PCT, Math.max(MIN_DATA_PCT, startPct + delta)));
    };
    const onUp = () => {
      setDragging(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [dataPanelPct]);

  // Vertical handle — drag the bottom edge to grow/shrink the whole region.
  const startVDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = chartHeight;
    let current = startH;
    setDragging("v");
    const onMove = (ev: MouseEvent) => {
      current = clampHeight(startH + (ev.clientY - startY));
      setChartHeight(current);
    };
    const onUp = () => {
      setDragging(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      mergeUiCookie(CHARTS_UI_COOKIE, { chartHeight: current });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [chartHeight]);

  // Persist configuration so the panel survives reloads and tab navigation.
  // The restore effect flips restoredRef in the same commit it applies the
  // cookie, so the first write here already carries the restored values —
  // saved state is never overwritten with defaults.
  useEffect(() => {
    if (!persistKey || !restoredRef.current) return;
    writeUiCookie(panelUiCookie(persistKey), JSON.stringify({
      symbol: selectedSymbol, startDate, endDate, interval, rangePreset, chartType,
      compareSymbols, showData, dataPanelPct,
      showSMA, showEMA, showBB, showRSI, showMACD, strategy: selectedStrategy,
    }));
  }, [persistKey, selectedSymbol, startDate, endDate, interval, rangePreset, chartType,
      compareSymbols, showData, dataPanelPct, showSMA, showEMA, showBB, showRSI, showMACD,
      selectedStrategy]);

  const { data: strategyDetail } = useQuery({
    queryKey: ["strategy", selectedStrategy],
    queryFn: () => strategiesApi.get(selectedStrategy!),
    enabled: !!selectedStrategy,
  });

  const capitalStats = strategyDetail?.latestResults
    ? applyCapitalConstraints(strategyDetail.latestResults, 10_000)
    : null;
  const strategyTrades = strategyDetail?.latestResults?.trades ?? [];
  const equityCurve    = capitalStats?.equityCurve ?? [];

  const { from: fromApi, to: toApi } = useMemo(
    () => buildUtcApiRange(startDate, endDate),
    [startDate, endDate],
  );

  const { data: symbolsData } = useQuery({ queryKey: ["symbols"], queryFn: symbolsApi.list });
  const symbols = normalizeSymbols(symbolsData);

  // Snap the API range outward to stable bucket boundaries so overlapping pans
  // hit the cache — only bucket-boundary crossings mint a new query key (§4).
  const { snappedFrom, snappedTo } = useMemo(
    () => snapRange(fromApi, toApi, interval),
    [fromApi, toApi, interval],
  );

  const {
    data: rawBars = [],
    error,
    isFetching,
    isPending,
    isPlaceholderData,
  } = useQuery({
    enabled: !!selectedSymbol,
    queryKey: ["prices", selectedSymbol, interval, snappedFrom, snappedTo],
    queryFn: () => pricesApi.range(selectedSymbol, snappedFrom, snappedTo),
    placeholderData: keepPreviousData,
    staleTime: intervalMs(interval),
    gcTime:   3 * 60_000,
  });
  const isInitialLoad = isPending && !isPlaceholderData;

  const bars = useMemo(() => aggregatePriceBars(rawBars, interval), [rawBars, interval]);

  // Virtualized data table (§12): rows are pinned to a fixed 25px
  // (text-[11px] + leading-4 + py-1 + 1px border) so the spacer-row
  // padding math stays exact across the full range.
  const dataTableRef = useRef<HTMLDivElement>(null);
  const dataRowVirtualizer = useVirtualizer({
    count: bars.length,
    getScrollElement: () => dataTableRef.current,
    estimateSize: () => 25,
    overscan: 12,
  });
  const dataVirtualRows = dataRowVirtualizer.getVirtualItems();
  const dataRowsPaddingTop = dataVirtualRows.length > 0 ? dataVirtualRows[0].start : 0;
  const dataRowsPaddingBottom = dataVirtualRows.length > 0
    ? dataRowVirtualizer.getTotalSize() - dataVirtualRows[dataVirtualRows.length - 1].end
    : 0;

  const compareQueries = useQueries({
    queries: compareSymbols.map(sym => ({
      queryKey: ["prices", sym, interval, snappedFrom, snappedTo],
      queryFn: () => pricesApi.range(sym, snappedFrom, snappedTo),
      enabled: !!sym,
      placeholderData: keepPreviousData,
      staleTime: intervalMs(interval),
      gcTime:   3 * 60_000,
    })),
  });

  // TanStack Query's structural sharing keeps unchanged query data
  // referentially stable, so a dataUpdatedAt join is a faithful,
  // fixed-length invalidation key (no variable-length dep array).
  const compareDataKey = compareQueries.map((q) => q.dataUpdatedAt).join("|");
  const compareData = useMemo(
    () => compareSymbols.map((symbol, i) => ({
      symbol,
      bars: aggregatePriceBars(compareQueries[i]?.data ?? [], interval),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compareSymbols, interval, compareDataKey],
  );

  const indicators: IndicatorConfig = useMemo(() => ({
    sma:      showSMA  ? [20, 50] : [],
    ema:      showEMA  ? [9, 21]  : [],
    bollinger: showBB  ? { period: 20, stdDev: 2 } : null,
    rsi:      showRSI  ? 14 : null,
    macd:     showMACD ? { fast: 12, slow: 26, signal: 9 } : null,
  }), [showSMA, showEMA, showBB, showRSI, showMACD]);

  const pythonCode = useMemo(
    () => buildPythonSnippet({ symbol: selectedSymbol || "AAPL", from: fromApi, to: toApi, interval }),
    [selectedSymbol, fromApi, toApi, interval],
  );

  const applyPreset = (preset: Exclude<ChartRangePreset, "CUSTOM">) => {
    const r = getPresetRange(preset);
    setRangePreset(preset);
    setStartDate(r.startDate);
    setEndDate(r.endDate);
  };

  const addCompare = (sym: string) => {
    const s = sym.toUpperCase().trim();
    if (s && s !== selectedSymbol && !compareSymbols.includes(s) && compareSymbols.length < 4) {
      setCompareSymbols(prev => [...prev, s]);
    }
    setCompareInput("");
  };

  const isComparing = compareData.length > 0;

  // §13 skeleton gate: SSR and hydration paint a geometry-identical
  // placeholder; the first post-mount commit swaps in the fully-restored
  // panel. No wrong-content flash, no layout shift.
  if (!mounted) {
    return <PanelSkeleton symbol={initialSymbol} height={chartHeight} />;
  }

  return (
    <div className="flex flex-col rounded-md border border-border bg-card">
      {/* Panel header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Select value={selectedSymbol} onValueChange={handleSymbolChange}>
          <SelectTrigger className="h-8 w-36 font-mono text-sm">
            <SelectValue placeholder="Symbol…" />
          </SelectTrigger>
          <SelectContent>
            {symbols.length === 0 && (
              <SelectItem value="__none__" disabled>No symbols tracked</SelectItem>
            )}
            {symbols.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {bars.length > 0 && (
          <span className="text-[11px] text-muted-foreground tabular">
            {bars.length} bars · {formatDisplayDate(startDate)} – {formatDisplayDate(endDate)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <StrategySelector
            selectedStrategy={selectedStrategy}
            onSelect={setSelectedStrategy}
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs"
            onClick={() => setShowData(p => !p)}
          >
            {showData ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Data
          </Button>
          {canRemove && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={onRemove}
              title="Remove panel"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-3">
        <Field label="Range">
          <div className="flex flex-wrap gap-1">
            {RANGE_PRESETS.map(preset => (
              <Button
                key={preset}
                size="sm"
                variant={rangePreset === preset ? "default" : "outline"}
                onClick={() => applyPreset(preset)}
                className="h-7 min-w-10 text-xs"
              >
                {preset}
              </Button>
            ))}
            <Button
              size="sm"
              variant={rangePreset === "CUSTOM" ? "default" : "outline"}
              onClick={() => setRangePreset("CUSTOM")}
              className="h-7 text-xs"
            >
              Custom
            </Button>
          </div>
        </Field>

        <Field label="Dates">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={({ startDate: s, endDate: e }) => {
              setRangePreset("CUSTOM");
              setStartDate(s);
              setEndDate(e);
            }}
          />
        </Field>

        <Field label="Interval">
          <div className="flex items-center gap-1">
            <Select value={interval} onValueChange={v => handleIntervalSelect(v as Interval)}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVALS.map(item => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {intervalMode === "pinned" && (
              <button
                type="button"
                onClick={handleUnpinInterval}
                title="Return to automatic interval selection"
                className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                Auto
              </button>
            )}
          </div>
        </Field>

        <Field label="Type">
          <div className="flex gap-1">
            {CHART_TYPES.map(ct => (
              <Button
                key={ct.value}
                size="sm"
                variant={chartType === ct.value ? "default" : "outline"}
                onClick={() => setChartType(ct.value)}
                disabled={isComparing}
                className="h-7 text-xs"
              >
                {ct.label}
              </Button>
            ))}
            {isComparing && (
              <span className="ml-1 self-center rounded bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                % return
              </span>
            )}
          </div>
        </Field>

        <Field label="Compare">
          <div className="flex flex-wrap items-center gap-1">
            {compareSymbols.map((sym, i) => (
              <span
                key={sym}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-mono"
                style={{ backgroundColor: `${CHART_COLORS.compare[i % CHART_COLORS.compare.length]}22`, color: CHART_COLORS.compare[i % CHART_COLORS.compare.length] }}
              >
                {sym}
                <button onClick={() => setCompareSymbols(prev => prev.filter(s => s !== sym))}>
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            {compareSymbols.length < 4 && (
              <form className="flex gap-1" onSubmit={e => { e.preventDefault(); addCompare(compareInput); }}>
                <Input
                  value={compareInput}
                  onChange={e => setCompareInput(e.target.value.toUpperCase())}
                  placeholder="TSLA"
                  className="h-7 w-16 font-mono text-xs uppercase"
                />
                <Button type="submit" size="sm" className="h-7 px-2" variant="outline">
                  <Plus className="h-3 w-3" />
                </Button>
              </form>
            )}
          </div>
        </Field>

        <div className="ml-auto flex items-center gap-3 text-xs">
          <Toggle checked={showSMA}  onChange={setShowSMA}  label="SMA"  disabled={isComparing} />
          <Toggle checked={showEMA}  onChange={setShowEMA}  label="EMA"  disabled={isComparing} />
          <Toggle checked={showBB}   onChange={setShowBB}   label="BB"   disabled={isComparing} />
          <Toggle checked={showRSI}  onChange={setShowRSI}  label="RSI"  disabled={isComparing} />
          <Toggle checked={showMACD} onChange={setShowMACD} label="MACD" disabled={isComparing} />
        </div>
      </div>

      {/* Chart + data region.
          A fixed-height wrapper (drag the bottom handle to resize, persisted in
          the ui.charts cookie) that also gives the chart a *definite* height to
          resolve its canvas against. Inside, a horizontal flex split: the chart
          column flex-grows while the data column's width animates open/closed
          and is drag-adjustable via the splitter. */}
      <div
        className="relative flex flex-col"
        style={{
          height: chartHeight,
          userSelect: dragging ? "none" : undefined,
          cursor: dragging === "v" ? "row-resize" : dragging === "h" ? "col-resize" : undefined,
        }}
      >
        <div ref={chartRowRef} className="flex min-h-0 flex-1 overflow-hidden">
          {/* Chart column — grows to fill whatever the data column leaves free. */}
          <div className="relative flex min-w-0 flex-1 flex-col">
            <div className="relative flex flex-1 overflow-hidden">
              {/* Chart content */}
              <div className="relative flex-1 min-w-0">
                {!selectedSymbol && <Empty>Select a symbol above to begin.</Empty>}
                {selectedSymbol && isInitialLoad && <Empty><Loader2 className="h-4 w-4 animate-spin" /> Loading…</Empty>}
                {selectedSymbol && error && (
                  <Empty><span className="text-destructive">{(error as Error).message}</span></Empty>
                )}
                {selectedSymbol && !isInitialLoad && !error && bars.length === 0 && (
                  <Empty>No data for {selectedSymbol} in this range.</Empty>
                )}
                {selectedSymbol && bars.length > 0 && (
                  <PriceChart
                    bars={bars}
                    indicators={indicators}
                    height="100%"
                    chartType={chartType}
                    compareData={compareData}
                    trades={strategyTrades}
                    onAutoInterval={handleAutoInterval}
                    interactionStore={interactionStore}
                    viewportIntent={viewportIntent}
                    onViewportGesture={() => setViewportIntent("anchored")}
                  />
                )}
                {isFetching && selectedSymbol && (
                  <div className="absolute right-3 top-3 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> {isPlaceholderData ? "refining…" : "refreshing"}
                  </div>
                )}
                {viewportIntent === "anchored" && (
                  <button
                    type="button"
                    onClick={() => setViewportIntent("fit")}
                    title="Reset viewport to fit all data (R)"
                    className="absolute left-3 top-3 rounded border border-border bg-card/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    Reset
                  </button>
                )}
              </div>

              {/* Vertical scrollbar on right — reads/writes the interaction
                  store directly, so dragging never re-renders this panel. */}
              {bars.length > 0 && (
                <StoreConnectedScrollbar
                  store={interactionStore}
                  totalBars={bars.length}
                  onUserRange={() => setViewportIntent("anchored")}
                />
              )}
            </div>
          </div>

          {/* Draggable horizontal splitter (only when the data panel is open). */}
          {showData && (
            <div
              onMouseDown={startHDrag}
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize"
              className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-border/20 transition-colors hover:bg-border/60 active:bg-primary/40"
            />
          )}

          {/* Data column — width animates on open/close and tracks the splitter. */}
          <div
            className="flex min-w-0 flex-col overflow-hidden border-l border-border"
            style={{
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: showData ? `${dataPanelPct}%` : "0%",
              opacity: showData ? 1 : 0,
              pointerEvents: showData ? undefined : "none",
              transition: dragging === "h"
                ? "none"
                : "flex-basis 200ms ease, opacity 200ms ease",
            }}
          >
            {showData && (
              <>
                <div ref={dataTableRef} className="overflow-auto flex-1">
                  <table className="tabular w-full text-[11px]">
                    <thead className="sticky top-0 bg-card text-muted-foreground">
                      <tr>
                        {["time", "O", "H", "L", "C", "V"].map(h => (
                          <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dataVirtualRows.length > 0 && (
                        <tr aria-hidden="true">
                          <td colSpan={6} style={{ height: dataRowsPaddingTop, padding: 0, border: 0 }} />
                        </tr>
                      )}
                      {dataVirtualRows.map((vi) => {
                        const b = bars[vi.index];
                        return (
                          <tr key={vi.key} className="border-t border-border/50">
                            <td className="px-2 py-1 leading-4 text-muted-foreground">{format(new Date(b.time), "yyyy-MM-dd HH:mm")}</td>
                            <td className="px-2 py-1 leading-4">{b.open.toFixed(2)}</td>
                            <td className="px-2 py-1 leading-4 text-bull">{b.high.toFixed(2)}</td>
                            <td className="px-2 py-1 leading-4 text-bear">{b.low.toFixed(2)}</td>
                            <td className="px-2 py-1 leading-4">{b.close.toFixed(2)}</td>
                            <td className="px-2 py-1 leading-4 text-muted-foreground">{b.volume.toLocaleString()}</td>
                          </tr>
                        );
                      })}
                      {dataVirtualRows.length > 0 && (
                        <tr aria-hidden="true">
                          <td colSpan={6} style={{ height: dataRowsPaddingBottom, padding: 0, border: 0 }} />
                        </tr>
                      )}
                      {bars.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No data</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="shrink-0 border-t border-border p-2">
                  <PythonExport code={pythonCode} filename={`${selectedSymbol || "query"}_${interval}.py`} />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Vertical resize handle at the bottom edge — drag to change the
            region's height (clamped 300px … 90vh, persisted in the ui.charts cookie). */}
        <div
          onMouseDown={startVDrag}
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize height"
          className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center border-t border-border bg-border/10 transition-colors hover:bg-border/40 active:bg-primary/30"
        >
          <GripHorizontal className="h-3 w-3 text-muted-foreground/50 group-hover:text-muted-foreground" />
        </div>
      </div>
      {/* Strategy stats panel */}
      {selectedStrategy && capitalStats && (
        <BacktestStatsPanel
          capitalStats={capitalStats}
          strategyName={selectedStrategy}
        />
      )}

      {/* Equity curve */}
      {selectedStrategy && equityCurve.length > 0 && (
        <EquityChart equityCurve={equityCurve} height={180} />
      )}
    </div>
  );
}

/**
 * Store-connected scrollbar (§7): subscribes to the interaction store itself
 * so only this tiny component re-renders at drag frame rate — the panel
 * doesn't. Writes go straight back to the store; PriceChart applies them via
 * its epsilon-guarded subscription.
 */
function StoreConnectedScrollbar({
  store,
  totalBars,
  onUserRange,
}: {
  store: InteractionStore;
  totalBars: number;
  onUserRange: () => void;
}) {
  const range = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().visibleRange,
  );
  if (!range) return null;
  return (
    <ChartScrollbar
      totalBars={totalBars}
      from={range.from}
      to={range.to}
      onRangeChange={(f, t) => {
        store.set({ visibleRange: { from: f, to: t } });
        onUserRange();
      }}
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Toggle({
  checked, onChange, label, disabled,
}: {
  checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-1.5", disabled && "cursor-not-allowed opacity-40")}>
      <Checkbox checked={checked} onCheckedChange={v => onChange(!!v)} disabled={disabled} className="h-3.5 w-3.5" />
      <span className="text-foreground/90">{label}</span>
    </label>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
