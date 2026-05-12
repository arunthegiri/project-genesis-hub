import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Plus, X } from "lucide-react";

import { SymbolPicker } from "@/components/SymbolPicker";
import { PriceChart, type IndicatorConfig, type ChartType } from "@/components/PriceChart";
import { PythonExport } from "@/components/PythonExport";
import { DateRangePicker } from "@/components/DateRangePicker";
import { pricesApi } from "@/lib/api/prices";
import { API_BASE_URL } from "@/lib/api/config";
import { INTERVALS, type Interval } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildPythonSnippet } from "@/lib/python-export";
import {
  buildUtcApiRange,
  formatDisplayDate,
  getPresetRange,
  type ChartRangePreset,
} from "@/lib/date-range";
import { aggregatePriceBars } from "@/lib/price-bars";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Charts — Quant Trading Platform" },
      { name: "description", content: "Interactive price charts with SMA, EMA, RSI, MACD, Bollinger Bands." },
    ],
  }),
  component: ChartsPage,
});

const RANGE_PRESETS: Exclude<ChartRangePreset, "CUSTOM">[] = ["1D", "5D", "1M", "3M", "6M", "1Y"];
const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "candlestick", label: "Candle" },
  { value: "bar",         label: "Bar"    },
  { value: "line",        label: "Line"   },
  { value: "area",        label: "Area"   },
];
const COMPARE_COLORS = ["#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#fb923c"];

function ChartsPage() {
  const initialRange = getPresetRange("5D");
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [startDate, setStartDate]   = useState<string>(initialRange.startDate);
  const [endDate, setEndDate]       = useState<string>(initialRange.endDate);
  const [interval, setInterval]     = useState<Interval>("1Hour");
  const [rangePreset, setRangePreset] = useState<ChartRangePreset>("5D");
  const [chartType, setChartType]   = useState<ChartType>("candlestick");

  // Compare overlay
  const [compareSymbols, setCompareSymbols] = useState<string[]>([]);
  const [compareInput, setCompareInput]     = useState("");

  // Resizable chart
  const [chartHeight, setChartHeight] = useState(480);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: chartHeight };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setChartHeight(Math.max(200, Math.min(1400, dragRef.current.startH + ev.clientY - dragRef.current.startY)));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Indicators
  const [showSMA,  setShowSMA]  = useState(true);
  const [showEMA,  setShowEMA]  = useState(false);
  const [showBB,   setShowBB]   = useState(false);
  const [showRSI,  setShowRSI]  = useState(false);
  const [showMACD, setShowMACD] = useState(false);

  const { from: fromApi, to: toApi } = useMemo(
    () => buildUtcApiRange(startDate, endDate),
    [startDate, endDate],
  );

  const queryUrl = useMemo(() => {
    if (!selectedSymbol) return "";
    const url = new URL(`${API_BASE_URL}/api/prices/${encodeURIComponent(selectedSymbol)}/range`);
    url.searchParams.set("from", fromApi);
    url.searchParams.set("to", toApi);
    return url.toString();
  }, [selectedSymbol, fromApi, toApi]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.log("[chart-state]", { selectedSymbol, startDate, endDate, interval, finalApiUrl: queryUrl });
  }, [selectedSymbol, startDate, endDate, interval, queryUrl]);

  // Primary symbol query
  const { data: rawBars = [], isLoading, error, isFetching } = useQuery({
    enabled: !!selectedSymbol,
    queryKey: ["prices", selectedSymbol, fromApi, toApi, interval],
    queryFn: () => pricesApi.range(selectedSymbol, fromApi, toApi),
  });

  const bars = useMemo(() => aggregatePriceBars(rawBars, interval), [rawBars, interval]);

  // Compare symbol queries
  const compareQueries = useQueries({
    queries: compareSymbols.map(sym => ({
      queryKey: ["prices", sym, fromApi, toApi],
      queryFn: () => pricesApi.range(sym, fromApi, toApi),
      enabled: !!sym,
    })),
  });

  const compareData = useMemo(
    () => compareSymbols.map((symbol, i) => ({
      symbol,
      bars: aggregatePriceBars(compareQueries[i]?.data ?? [], interval),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compareSymbols, interval, ...compareQueries.map(q => q.data)],
  );

  const indicators: IndicatorConfig = useMemo(
    () => ({
      sma:      showSMA  ? [20, 50] : [],
      ema:      showEMA  ? [9, 21]  : [],
      bollinger: showBB  ? { period: 20, stdDev: 2 } : null,
      rsi:      showRSI  ? 14       : null,
      macd:     showMACD ? { fast: 12, slow: 26, signal: 9 } : null,
    }),
    [showSMA, showEMA, showBB, showRSI, showMACD],
  );

  const pythonCode = useMemo(
    () => buildPythonSnippet({ symbol: selectedSymbol || "AAPL", from: fromApi, to: toApi, interval }),
    [selectedSymbol, fromApi, toApi, interval],
  );

  const applyPreset = (preset: Exclude<ChartRangePreset, "CUSTOM">) => {
    const nextRange = getPresetRange(preset);
    setRangePreset(preset);
    setStartDate(nextRange.startDate);
    setEndDate(nextRange.endDate);
  };

  const addCompare = (sym: string) => {
    const s = sym.toUpperCase().trim();
    if (s && s !== selectedSymbol && !compareSymbols.includes(s) && compareSymbols.length < 4) {
      setCompareSymbols(prev => [...prev, s]);
    }
    setCompareInput("");
  };

  const isComparing = compareData.length > 0;

  return (
    <div className="grid h-full grid-cols-[220px_1fr_360px] gap-3 p-3">
      <aside className="flex flex-col gap-3 overflow-auto rounded-md border border-border bg-card p-3">
        <SymbolPicker selected={selectedSymbol} onSelect={setSelectedSymbol} />
      </aside>

      <section className="flex flex-col gap-3 overflow-hidden">
        {/* Controls */}
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
          <Field label="Range">
            <div className="flex flex-wrap gap-2">
              {RANGE_PRESETS.map(preset => (
                <Button
                  key={preset}
                  size="sm"
                  variant={rangePreset === preset ? "default" : "outline"}
                  onClick={() => applyPreset(preset)}
                  className="h-8 min-w-12 text-xs"
                >
                  {preset}
                </Button>
              ))}
              <Button
                size="sm"
                variant={rangePreset === "CUSTOM" ? "default" : "outline"}
                onClick={() => setRangePreset("CUSTOM")}
                className="h-8 text-xs"
              >
                Custom
              </Button>
            </div>
          </Field>

          <Field label="Dates">
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onChange={({ startDate: s, endDate: e }) => { setRangePreset("CUSTOM"); setStartDate(s); setEndDate(e); }}
            />
          </Field>

          <Field label="Interval">
            <Select value={interval} onValueChange={v => setInterval(v as Interval)}>
              <SelectTrigger className="h-9 w-[160px] text-xs">
                <SelectValue placeholder="Select interval" />
              </SelectTrigger>
              <SelectContent>
                {INTERVALS.map(item => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Chart type">
            <div className="flex gap-1">
              {CHART_TYPES.map(ct => (
                <Button
                  key={ct.value}
                  size="sm"
                  variant={chartType === ct.value ? "default" : "outline"}
                  onClick={() => setChartType(ct.value)}
                  disabled={isComparing}
                  className="h-8 text-xs"
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
                  style={{ backgroundColor: `${COMPARE_COLORS[i % COMPARE_COLORS.length]}22`, color: COMPARE_COLORS[i % COMPARE_COLORS.length] }}
                >
                  {sym}
                  <button onClick={() => setCompareSymbols(prev => prev.filter(s => s !== sym))} className="hover:opacity-70">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              {compareSymbols.length < 4 && (
                <form
                  className="flex gap-1"
                  onSubmit={e => { e.preventDefault(); addCompare(compareInput); }}
                >
                  <Input
                    value={compareInput}
                    onChange={e => setCompareInput(e.target.value.toUpperCase())}
                    placeholder="TSLA"
                    className="h-8 w-20 font-mono text-xs uppercase"
                  />
                  <Button type="submit" size="sm" className="h-8 px-2" variant="outline">
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

        {/* Chart area */}
        <div
          className="relative overflow-auto rounded-md border border-border bg-card"
          style={{ height: chartHeight }}
        >
          {!selectedSymbol && <Empty>Select a symbol from the left panel to begin.</Empty>}
          {selectedSymbol && isLoading && <Empty><Loader2 className="h-4 w-4 animate-spin" /> Querying backend…</Empty>}
          {selectedSymbol && error && (
            <Empty><span className="text-destructive">{(error as Error).message}</span></Empty>
          )}
          {selectedSymbol && !isLoading && !error && bars.length === 0 && (
            <Empty>No data found for {selectedSymbol} between {formatDisplayDate(startDate)} and {formatDisplayDate(endDate)}.</Empty>
          )}
          {selectedSymbol && bars.length > 0 && (
            <PriceChart
              bars={bars}
              indicators={indicators}
              height={chartHeight}
              chartType={chartType}
              compareData={compareData}
            />
          )}
          {isFetching && selectedSymbol && (
            <div className="absolute right-3 top-3 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> refreshing
            </div>
          )}
        </div>

        {/* Resize handle */}
        <div
          className="flex cursor-row-resize items-center justify-center py-1 opacity-30 transition-opacity hover:opacity-80"
          onMouseDown={onResizeStart}
          title="Drag to resize chart"
        >
          <div className="h-1 w-20 rounded-full bg-border" />
        </div>
      </section>

      <aside className="flex min-h-0 flex-col gap-3 overflow-auto">
        <div className="flex flex-1 flex-col rounded-md border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Dataframe preview
            </span>
            <span className="tabular text-[10px] text-muted-foreground">
              {bars.length} rows · {interval}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
            <span>{selectedSymbol || "No symbol selected"}</span>
            <span>{formatDisplayDate(startDate)} - {formatDisplayDate(endDate)}</span>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="tabular w-full text-[11px]">
              <thead className="sticky top-0 bg-panel-header text-muted-foreground">
                <tr>
                  {["time", "O", "H", "L", "C", "V"].map(h => (
                    <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bars.slice(0, 200).map((b, i) => (
                  <tr key={`${b.time}-${i}`} className="border-t border-border/50">
                    <td className="px-2 py-1 text-muted-foreground">{format(new Date(b.time), "MM/dd/yy HH:mm")}</td>
                    <td className="px-2 py-1">{b.open.toFixed(2)}</td>
                    <td className="px-2 py-1 text-bull">{b.high.toFixed(2)}</td>
                    <td className="px-2 py-1 text-bear">{b.low.toFixed(2)}</td>
                    <td className="px-2 py-1">{b.close.toFixed(2)}</td>
                    <td className="px-2 py-1 text-muted-foreground">{b.volume.toLocaleString()}</td>
                  </tr>
                ))}
                {bars.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <PythonExport code={pythonCode} filename={`${selectedSymbol || "query"}_${interval}.py`} />
      </aside>
    </div>
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
      <Checkbox
        checked={checked}
        onCheckedChange={v => onChange(!!v)}
        disabled={disabled}
        className="h-3.5 w-3.5"
      />
      <span className="text-foreground/90">{label}</span>
    </label>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[300px] items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
