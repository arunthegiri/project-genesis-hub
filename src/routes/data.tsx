import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";

import { SymbolPicker } from "@/components/SymbolPicker";
import { PythonExport } from "@/components/PythonExport";
import { BackfillPanel } from "@/components/BackfillPanel";
import { CoverageTimeline } from "@/components/CoverageTimeline";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { PanelState } from "@/components/terminal/PanelState";
import { pricesApi } from "@/lib/api/prices";
import { symbolsApi, normalizeSymbols } from "@/lib/api/symbols";
import { INTERVALS, type Interval, type PriceBar } from "@/lib/api/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { buildPythonSnippet } from "@/lib/python-export";
import { etDateTimeInputToApiParam } from "@/lib/datetime";
import { etDateTimeInputValue } from "@/lib/market-calendar";
import { cn } from "@/lib/utils";

// Defaults resolve relative to *now* — never constants — so a clean URL opens
// on the last 7 days and the SSR'd first paint already shows the real range
// (no mount-time snap).
//
// They resolve in the LOADER, not in validateSearch, and that distinction is
// the whole point. validateSearch runs twice for one page view — once on the
// server, once again on the client during hydration — so a `new Date()` inside
// it produces two different answers (different clock, and on a UTC server vs a
// local browser, a different wall-clock string entirely). The generated Python
// snippet embeds that range as text, which turned the drift into a real
// hydration mismatch: React discarded and re-rendered the subtree on every
// load of /data. Loader data is computed once on the server and dehydrated
// into the page, so both renders read the same two strings (§1.3).
function defaultFrom(): string {
  return etDateTimeInputValue(Date.now() - 7 * 86_400_000);
}
function defaultTo(): string {
  return etDateTimeInputValue(Date.now());
}

const VALID_INTERVALS = new Set<string>(INTERVALS.map((i) => i.value));

export const Route = createFileRoute("/data")({
  // §13/§18 division of labor: symbol/range/interval are *location* — they
  // belong to the URL, not storage. Column toggles stay arrangement-local
  // (ephemeral in-memory state).
  validateSearch: (search: Record<string, unknown>) => ({
    symbol: typeof search.symbol === "string" ? search.symbol : "",
    // Absent = "use the loader's default", not "resolve now" (see above).
    from:   typeof search.from === "string" && search.from ? search.from : undefined,
    to:     typeof search.to === "string" && search.to ? search.to : undefined,
    interval: VALID_INTERVALS.has(String(search.interval))
      ? (search.interval as Interval)
      : ("1Hour" as Interval),
  }),
  loader: () => ({ from: defaultFrom(), to: defaultTo() }),
  head: () => ({
    meta: [
      { title: "Data — Quant Trading Platform" },
      { name: "description", content: "Inspect, filter, and export raw OHLCV data from TimescaleDB." },
    ],
  }),
  component: DataPage,
});

const ALL_COLUMNS: { key: keyof PriceBar; label: string; sql: string }[] = [
  { key: "time", label: "time (ET)", sql: "time" },
  { key: "symbol", label: "symbol", sql: "symbol" },
  { key: "open", label: "open", sql: "open" },
  { key: "high", label: "high", sql: "high" },
  { key: "low", label: "low", sql: "low" },
  { key: "close", label: "close", sql: "close" },
  { key: "volume", label: "volume", sql: "volume" },
  { key: "vwap", label: "vwap", sql: "vwap" },
  { key: "tradeCount", label: "tradeCount", sql: "trade_count" },
];

const DT_FMT_HINT = "YYYY-MM-DDTHH:MM (ET)";

function DataPage() {
  // URL = where you are: symbol/from/to/interval come from validateSearch.
  const { symbol, from: fromParam, to: toParam, interval: barInterval } = Route.useSearch();
  // URL wins; the loader's server-resolved default fills the gap (§13
  // precedence, and the reason both renders agree).
  const defaults = Route.useLoaderData();
  const from = fromParam ?? defaults.from;
  const to = toParam ?? defaults.to;
  const navigate = Route.useNavigate();
  const setSearch = useCallback(
    (updates: Partial<{ symbol: string; from: string; to: string; interval: Interval }>) =>
      navigate({ search: (prev) => ({ ...prev, ...updates }), replace: true }),
    [navigate],
  );
  const setSymbol = useCallback((s: string) => setSearch({ symbol: s }), [setSearch]);
  const [fromError, setFromError] = useState("");
  const [toError, setToError] = useState("");
  const [enabledCols, setEnabledCols] = useState<Set<string>>(
    () => new Set(ALL_COLUMNS.map((c) => c.key as string)),
  );
  const fromApi = etDateTimeInputToApiParam(from);
  const toApi = etDateTimeInputToApiParam(to);

  const { data: bars = [], isLoading, error, refetch } = useQuery({
    enabled: !!symbol && !!fromApi && !!toApi,
    queryKey: ["prices", symbol, fromApi, toApi],
    queryFn: () => pricesApi.range(symbol, fromApi, toApi),
  });

  // §6 coverage-empty/degraded: shares the ["symbols"] cache key with
  // CoverageTimeline/SymbolPicker, so this adds no extra request. Only
  // settled states (isSuccess/isError) swap the panel body, so the first
  // client render always matches SSR (CoverageTimeline's own empty body).
  const symbolsQ = useQuery({ queryKey: ["symbols"], queryFn: symbolsApi.list });
  const coverageSymbols = normalizeSymbols(symbolsQ.data);

  const visibleCols = ALL_COLUMNS.filter((c) => enabledCols.has(c.key as string));

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: bars.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 12,
  });

  const pythonCode = useMemo(
    () =>
      buildPythonSnippet({
        symbol: symbol || "AAPL",
        from: fromApi,
        to: toApi,
        interval: barInterval,
        columns: ALL_COLUMNS.filter((c) => enabledCols.has(c.key as string)).map((c) => c.sql),
      }),
    [symbol, fromApi, toApi, barInterval, enabledCols],
  );

  return (
    <div className="grid h-full grid-cols-[220px_1fr] gap-3 p-3">
      <aside className="overflow-auto rounded-md border border-border bg-card p-3">
        <SymbolPicker selected={symbol} onSelect={setSymbol} />
      </aside>

      <section className="flex flex-col gap-3 overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
          <Field label="From (ET)" hint={DT_FMT_HINT}>
            <Input
              type="datetime-local"
              value={from}
              onChange={(e) => { setSearch({ from: e.target.value }); if (e.target.value) setFromError(""); }}
              onBlur={(e) => { if (!e.target.value) setFromError("Required"); }}
              aria-invalid={!!fromError}
              className={cn("h-8 tabular text-xs", fromError && "border-destructive")}
            />
            {fromError && <p className="text-[10px] text-destructive">{fromError}</p>}
          </Field>
          <Field label="To (ET)" hint={DT_FMT_HINT}>
            <Input
              type="datetime-local"
              value={to}
              onChange={(e) => { setSearch({ to: e.target.value }); if (e.target.value) setToError(""); }}
              onBlur={(e) => { if (!e.target.value) setToError("Required"); }}
              aria-invalid={!!toError}
              className={cn("h-8 tabular text-xs", toError && "border-destructive")}
            />
            {toError && <p className="text-[10px] text-destructive">{toError}</p>}
          </Field>
          <Field label="Interval">
            <select
              value={barInterval}
              onChange={(e) => setSearch({ interval: e.target.value as Interval })}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            >
              {INTERVALS.map((i) => (
                <option key={i.value} value={i.value}>{i.label}</option>
              ))}
            </select>
          </Field>
          <div className="ml-auto flex flex-wrap items-center gap-2.5 text-xs">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Columns</span>
            {ALL_COLUMNS.map((c) => (
              <label key={c.key as string} className="flex items-center gap-1 cursor-pointer">
                <Checkbox
                  checked={enabledCols.has(c.key as string)}
                  onCheckedChange={(v) => {
                    setEnabledCols((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(c.key as string);
                      else next.delete(c.key as string);
                      return next;
                    });
                  }}
                  className="h-3.5 w-3.5"
                />
                <span className="font-mono text-foreground/90">{c.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* §4.2: coverage and backfill regions each mount in a TerminalPanel.
            [&>*]:border-0 drops the wrapped component's own card border so
            the panel chrome is the single frame (bg-card aliases surface-1). */}
        <TerminalPanel
          tabs={[{ id: "coverage", label: "Coverage" }]}
          activeTab="coverage"
          bodyClassName="[&>*]:rounded-none [&>*]:border-0"
        >
          {symbolsQ.isError ? (
            <PanelState
              kind="error"
              art="plug"
              message="Coverage unavailable — the symbols endpoint is not responding."
              detail={["GET /api/symbols"]}
            />
          ) : symbolsQ.isSuccess && coverageSymbols.length === 0 ? (
            <PanelState
              kind="empty"
              art="chart"
              message="No symbols tracked yet — add one to see coverage."
            />
          ) : (
            <CoverageTimeline from={fromApi} to={toApi} />
          )}
        </TerminalPanel>

        <div className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              {symbol ? `${bars.length.toLocaleString()} rows for ${symbol}` : "Select a symbol"}
            </span>
          </div>

          <div className="grid grid-cols-[1fr] border-b border-border bg-panel-header text-[11px] text-muted-foreground">
            <div className="grid" style={{ gridTemplateColumns: `repeat(${visibleCols.length}, minmax(80px, 1fr))` }}>
              {visibleCols.map((c) => (
                <div key={c.key as string} className="px-3 py-1.5 font-mono">{c.label}</div>
              ))}
            </div>
          </div>

          <div ref={parentRef} className="flex-1 overflow-auto">
            {isLoading && (
              <PanelState kind="loading" art="table" message={`Loading ${symbol}…`} />
            )}
            {error && (
              <PanelState
                kind="error"
                art="plug"
                message={(error as Error).message}
                detail={[`GET /api/prices/${symbol}/range`]}
                action={{ label: "Retry", onClick: () => refetch() }}
              />
            )}
            {!isLoading && !error && !symbol && (
              <PanelState kind="empty" art="search" message="Select a symbol to load data." />
            )}
            {!isLoading && !error && symbol && bars.length === 0 && (
              <PanelState kind="empty" art="table" message="No data for this filter." />
            )}
            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const bar = bars[vi.index];
                return (
                  <div
                    key={vi.key}
                    className={cn(
                      "absolute left-0 right-0 grid border-b border-border/40 text-[11px] hover:bg-accent/40",
                    )}
                    style={{
                      transform: `translateY(${vi.start}px)`,
                      height: vi.size,
                      gridTemplateColumns: `repeat(${visibleCols.length}, minmax(80px, 1fr))`,
                    }}
                  >
                    {visibleCols.map((c) => (
                      <div key={c.key as string} className="tabular flex items-center px-3 text-foreground/90">
                        {formatCell(bar[c.key], c.key as string)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <TerminalPanel
          tabs={[{ id: "backfill", label: "Backfill" }]}
          activeTab="backfill"
          bodyClassName="[&>*]:rounded-none [&>*]:border-0"
        >
          <BackfillPanel symbol={symbol} />
        </TerminalPanel>

        <PythonExport code={pythonCode} filename={`${symbol || "query"}_data.py`} />
      </section>
    </div>
  );
}

function formatCell(v: unknown, key: string): string {
  if (v == null) return "—";
  // ET, like the range inputs above it and every other timestamp in the app.
  // Showing bar times in the viewer's local zone next to ET range inputs was
  // two clocks in one panel.
  if (key === "time") return etDateTimeInputValue(new Date(String(v)).getTime()).replace("T", " ");
  if (typeof v === "number") {
    if (key === "volume" || key === "tradeCount") return v.toLocaleString();
    return v.toFixed(4);
  }
  return String(v);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-1.5">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
        {hint && <span className="font-mono text-[9px] text-muted-foreground/50">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
