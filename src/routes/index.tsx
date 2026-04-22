import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { Loader2 } from "lucide-react";

import { SymbolPicker } from "@/components/SymbolPicker";
import { PriceChart, type IndicatorConfig } from "@/components/PriceChart";
import { PythonExport } from "@/components/PythonExport";
import { pricesApi } from "@/lib/api/prices";
import { INTERVALS, type Interval } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { buildPythonSnippet } from "@/lib/python-export";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Charts — Quant Trading Platform" },
      { name: "description", content: "Interactive price charts with SMA, EMA, RSI, MACD, Bollinger Bands." },
    ],
  }),
  component: ChartsPage,
});

function ChartsPage() {
  const [symbol, setSymbol] = useState<string>("");
  // Use a stable epoch on first render so SSR and client hydrate identically;
  // we refresh to "now" in a useEffect after mount.
  const [from, setFrom] = useState<string>("2024-01-01T09:30");
  const [to, setTo] = useState<string>("2024-01-08T16:00");
  const [interval, setInterval] = useState<Interval>("1Hour");

  useEffect(() => {
    setFrom(format(subDays(new Date(), 7), "yyyy-MM-dd'T'HH:mm"));
    setTo(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  }, []);

  const [showSMA, setShowSMA] = useState(true);
  const [showEMA, setShowEMA] = useState(false);
  const [showBB, setShowBB] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);

  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();

  const { data: bars = [], isLoading, error, isFetching } = useQuery({
    enabled: !!symbol,
    queryKey: ["prices", symbol, fromIso, toIso],
    queryFn: () => pricesApi.range(symbol, fromIso, toIso),
  });

  const indicators: IndicatorConfig = useMemo(
    () => ({
      sma: showSMA ? [20, 50] : [],
      ema: showEMA ? [9, 21] : [],
      bollinger: showBB ? { period: 20, stdDev: 2 } : null,
      rsi: showRSI ? 14 : null,
      macd: showMACD ? { fast: 12, slow: 26, signal: 9 } : null,
    }),
    [showSMA, showEMA, showBB, showRSI, showMACD],
  );

  const pythonCode = useMemo(
    () => buildPythonSnippet({ symbol: symbol || "AAPL", from: fromIso, to: toIso, interval }),
    [symbol, fromIso, toIso, interval],
  );

  const pickRandomDay = () => {
    const daysBack = Math.floor(Math.random() * 60) + 1;
    const day = subDays(new Date(), daysBack);
    setFrom(format(new Date(day.setHours(9, 30, 0, 0)), "yyyy-MM-dd'T'HH:mm"));
    setTo(format(new Date(day.setHours(16, 0, 0, 0)), "yyyy-MM-dd'T'HH:mm"));
  };

  return (
    <div className="grid h-full grid-cols-[220px_1fr_360px] gap-3 p-3">
      <aside className="flex flex-col gap-3 overflow-auto rounded-md border border-border bg-card p-3">
        <SymbolPicker selected={symbol} onSelect={setSymbol} />
      </aside>

      <section className="flex flex-col gap-3 overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-card p-3">
          <Field label="From">
            <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 tabular text-xs" />
          </Field>
          <Field label="To">
            <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 tabular text-xs" />
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
          <Button size="sm" variant="outline" onClick={pickRandomDay} className="h-8 text-xs">
            Random day
          </Button>
          <div className="ml-auto flex items-center gap-3 text-xs">
            <Toggle checked={showSMA} onChange={setShowSMA} label="SMA" />
            <Toggle checked={showEMA} onChange={setShowEMA} label="EMA" />
            <Toggle checked={showBB} onChange={setShowBB} label="BB" />
            <Toggle checked={showRSI} onChange={setShowRSI} label="RSI" />
            <Toggle checked={showMACD} onChange={setShowMACD} label="MACD" />
          </div>
        </div>

        <div className="relative flex-1 overflow-auto rounded-md border border-border bg-card">
          {!symbol && (
            <Empty>Select a symbol from the left panel to begin.</Empty>
          )}
          {symbol && isLoading && <Empty><Loader2 className="h-4 w-4 animate-spin" /> Loading bars…</Empty>}
          {symbol && error && (
            <Empty>
              <span className="text-destructive">{(error as Error).message}</span>
            </Empty>
          )}
          {symbol && !isLoading && !error && bars.length === 0 && (
            <Empty>No bars in this range. Try widening the date range or backfilling on the backend.</Empty>
          )}
          {symbol && bars.length > 0 && <PriceChart bars={bars} indicators={indicators} />}
          {isFetching && symbol && (
            <div className="absolute right-3 top-3 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> updating
            </div>
          )}
        </div>
      </section>

      <aside className="flex min-h-0 flex-col gap-3 overflow-auto">
        <div className="flex flex-1 flex-col rounded-md border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Dataframe preview
            </span>
            <span className="tabular text-[10px] text-muted-foreground">
              {bars.length} rows
            </span>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="tabular w-full text-[11px]">
              <thead className="sticky top-0 bg-panel-header text-muted-foreground">
                <tr>
                  {["time", "O", "H", "L", "C", "V"].map((h) => (
                    <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bars.slice(0, 200).map((b, i) => (
                  <tr key={`${b.time}-${i}`} className="border-t border-border/50">
                    <td className="px-2 py-1 text-muted-foreground">{format(new Date(b.time), "MM-dd HH:mm")}</td>
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

        <PythonExport code={pythonCode} filename={`${symbol || "query"}_${interval}.py`} />
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

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} className="h-3.5 w-3.5" />
      <span className="text-foreground/90">{label}</span>
    </label>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[300px] items-center justify-center gap-2 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
