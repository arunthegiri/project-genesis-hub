import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format, subDays } from "date-fns";
import { Loader2 } from "lucide-react";

import { SymbolPicker } from "@/components/SymbolPicker";
import { PythonExport } from "@/components/PythonExport";
import { pricesApi } from "@/lib/api/prices";
import { INTERVALS, type Interval, type PriceBar } from "@/lib/api/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { buildPythonSnippet } from "@/lib/python-export";
import { localDateTimeInputToApiParam } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/data")({
  head: () => ({
    meta: [
      { title: "Data — Quant Trading Platform" },
      { name: "description", content: "Inspect, filter, and export raw OHLCV data from TimescaleDB." },
    ],
  }),
  component: DataPage,
});

const ALL_COLUMNS: { key: keyof PriceBar; label: string; sql: string }[] = [
  { key: "time", label: "time", sql: "time" },
  { key: "symbol", label: "symbol", sql: "symbol" },
  { key: "open", label: "open", sql: "open" },
  { key: "high", label: "high", sql: "high" },
  { key: "low", label: "low", sql: "low" },
  { key: "close", label: "close", sql: "close" },
  { key: "volume", label: "volume", sql: "volume" },
  { key: "vwap", label: "vwap", sql: "vwap" },
  { key: "tradeCount", label: "tradeCount", sql: "trade_count" },
];

const PAGE_SIZE = 100;

function DataPage() {
  const [symbol, setSymbol] = useState("");
  // Stable initial values for SSR; refreshed to "now" on mount.
  const [from, setFrom] = useState("2024-01-01T09:30");
  const [to, setTo] = useState("2024-01-08T16:00");
  const [interval, setInterval] = useState<Interval>("1Hour");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setFrom(format(subDays(new Date(), 7), "yyyy-MM-dd'T'HH:mm"));
    setTo(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  }, []);
  const [enabledCols, setEnabledCols] = useState<Set<string>>(
    () => new Set(ALL_COLUMNS.map((c) => c.key as string)),
  );
  const [page, setPage] = useState(0);

  const fromApi = mounted ? localDateTimeInputToApiParam(from) : `${from}:00`;
  const toApi = mounted ? localDateTimeInputToApiParam(to) : `${to}:00`;

  const { data: bars = [], isLoading, error } = useQuery({
    enabled: mounted && !!symbol && !!fromApi && !!toApi,
    queryKey: ["prices", symbol, fromApi, toApi],
    queryFn: () => pricesApi.range(symbol, fromApi, toApi),
  });

  const visibleCols = ALL_COLUMNS.filter((c) => enabledCols.has(c.key as string));
  const totalPages = Math.max(1, Math.ceil(bars.length / PAGE_SIZE));
  const pageBars = useMemo(
    () => bars.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [bars, page],
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: pageBars.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 12,
  });

  const pythonCode = useMemo(
    () =>
      buildPythonSnippet({
        symbol: symbol || "AAPL",
        from: fromIso,
        to: toIso,
        interval,
        columns: ALL_COLUMNS.filter((c) => enabledCols.has(c.key as string)).map((c) => c.sql),
      }),
    [symbol, fromIso, toIso, interval, enabledCols],
  );

  return (
    <div className="grid h-full grid-cols-[220px_1fr] gap-3 p-3">
      <aside className="overflow-auto rounded-md border border-border bg-card p-3">
        <SymbolPicker selected={symbol} onSelect={(s) => { setSymbol(s); setPage(0); }} />
      </aside>

      <section className="flex flex-col gap-3 overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
          <Field label="From">
            <Input type="datetime-local" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className="h-8 tabular text-xs" />
          </Field>
          <Field label="To">
            <Input type="datetime-local" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} className="h-8 tabular text-xs" />
          </Field>
          <Field label="Interval">
            <select
              value={interval}
              onChange={(e) => setInterval(e.target.value as Interval)}
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

        <div className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              {symbol ? `${bars.length.toLocaleString()} rows for ${symbol}` : "Select a symbol"}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded border border-border px-2 py-0.5 disabled:opacity-30"
              >Prev</button>
              <span className="tabular text-muted-foreground">
                {page + 1} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                className="rounded border border-border px-2 py-0.5 disabled:opacity-30"
              >Next</button>
            </div>
          </div>

          <div className="grid grid-cols-[1fr] border-b border-border bg-panel-header text-[11px] text-muted-foreground">
            <div className="grid" style={{ gridTemplateColumns: `repeat(${visibleCols.length}, minmax(80px, 1fr))` }}>
              {visibleCols.map((c) => (
                <div key={c.key as string} className="px-3 py-1.5 font-mono">{c.label}</div>
              ))}
            </div>
          </div>

          <div ref={parentRef} className="flex-1 overflow-auto">
            {isLoading && <div className="p-6 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>}
            {error && <div className="p-6 text-center text-sm text-destructive">{(error as Error).message}</div>}
            {!isLoading && !error && bars.length === 0 && symbol && (
              <div className="p-6 text-center text-sm text-muted-foreground">No data for this filter.</div>
            )}
            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const bar = pageBars[vi.index];
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

        <PythonExport code={pythonCode} filename={`${symbol || "query"}_data.py`} />
      </section>
    </div>
  );
}

function formatCell(v: unknown, key: string): string {
  if (v == null) return "—";
  if (key === "time") return format(new Date(String(v)), "yyyy-MM-dd HH:mm:ss");
  if (typeof v === "number") {
    if (key === "volume" || key === "tradeCount") return v.toLocaleString();
    return v.toFixed(4);
  }
  return String(v);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
