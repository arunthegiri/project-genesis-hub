import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState, useEffect } from "react";
import { Plus } from "lucide-react";

import { SymbolPicker } from "@/components/SymbolPicker";
import { ChartPanel } from "@/components/ChartPanel";
import { Button } from "@/components/ui/button";
import { takePendingSymbol } from "@/lib/active-chart-panel";
import { INTERVALS, type Interval } from "@/lib/api/types";
import {
  CHARTS_UI_COOKIE,
  mergeUiCookie,
  readUiCookieServerFn,
} from "@/lib/cookie-state";

interface PanelSpec { id: number; symbol?: string }
interface ChartsUiCookie {
  panels?: PanelSpec[];
  chartHeight?: number;
}

const VALID_INTERVALS = new Set<string>(INTERVALS.map(i => i.value));

// §18: the schema keeps comma-separated params as plain strings so a shared
// URL reads as ?symbols=AAPL,NVDA&intervals=1Hour,1Day — no JSON encoding.
function parseSymbols(raw: string): string[] {
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}
// Positional, parallel to the panel list: intervals[i] applies to panel i;
// invalid entries keep their slot as null so positions never shift.
function parseIntervals(raw: string): (Interval | null)[] {
  if (!raw) return [];
  return raw.split(",").map(s => {
    const v = s.trim();
    return VALID_INTERVALS.has(v) ? (v as Interval) : null;
  });
}

export const Route = createFileRoute("/")({
  // §13/§18 division of labor — precedence: URL beats cookie beats defaults.
  // Location (which symbols/intervals the panels show) lives in the URL;
  // arrangement (panel set for empty panels, chart height) stays in the
  // ui.charts cookie; anything missing falls back to defaults. Runs on the
  // server too — string-only, no window/document.
  validateSearch: (search: Record<string, unknown>): { symbols?: string; intervals?: string } => ({
    symbols:   typeof search.symbols === "string" && search.symbols ? search.symbols : undefined,
    intervals: typeof search.intervals === "string" && search.intervals ? search.intervals : undefined,
  }),
  // §13: the panel set + chart height are workspace arrangement — they live in
  // the ui.charts cookie. The loader reads it inside the SSR request context,
  // so the first painted frame already shows the persisted panel set; the
  // dehydrated loader data keeps the hydration render identical.
  loader: async (): Promise<ChartsUiCookie> => {
    const raw = await readUiCookieServerFn({ data: CHARTS_UI_COOKIE });
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed as ChartsUiCookie : {};
    } catch {
      return {};
    }
  },
  head: () => ({
    meta: [
      { title: "Charts — Quant Trading Platform" },
      { name: "description", content: "Interactive price charts with SMA, EMA, RSI, MACD, Bollinger Bands." },
    ],
  }),
  component: ChartsPage,
});

function ChartsPage() {
  const cookie = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  // §18 parse-on-load: URL symbols beat the cookie panel set, so a shared URL
  // reproduces the view in a fresh session. With no URL params the §13 cookie
  // shell is untouched — panels fall back to the cookie, then the default.
  const [panels, setPanels] = useState<PanelSpec[]>(() => {
    const urlSymbols = parseSymbols(search.symbols ?? "");
    if (urlSymbols.length > 0) return urlSymbols.map((symbol, i) => ({ id: i + 1, symbol }));
    return Array.isArray(cookie.panels) && cookie.panels.length > 0 ? cookie.panels : [{ id: 1 }];
  });
  // URL intervals are positional (intervals[i] → panel i); ChartPanel treats
  // a provided initial interval as pinned (URL beats the panel cookie).
  // Later user picks flow back through onIntervalChange for the write-back.
  const [panelIntervals, setPanelIntervals] = useState<Record<number, Interval>>(() => {
    const urlIntervals = parseIntervals(search.intervals ?? "");
    const seed: Record<number, Interval> = {};
    panels.forEach((p, i) => {
      const iv = urlIntervals[i];
      if (iv) seed[p.id] = iv;
    });
    return seed;
  });
  // Render-time init (SSR-deterministic): next id derives from the same
  // loader data on server and client.
  const nextId = useRef(0);
  if (nextId.current === 0) nextId.current = panels.reduce((m, p) => Math.max(m, p.id), 0) + 1;

  // Persist the panel set to the cookie. No first-run guard needed: the
  // initial state IS the cookie value, and mergeUiCookie preserves keys
  // owned by other writers (ChartPanel's chartHeight).
  useEffect(() => {
    mergeUiCookie(CHARTS_UI_COOKIE, { panels });
  }, [panels]);

  const handleIntervalChange = useCallback(
    (id: number, interval: Interval) =>
      setPanelIntervals(prev => (prev[id] === interval ? prev : { ...prev, [id]: interval })),
    [],
  );

  // §18 write-back: the URL mirrors the live panel set (replace — no history
  // spam), so copying the address bar at any moment reproduces the view.
  const symbolsParam = panels.map(p => p.symbol).filter(Boolean).join(",");
  const intervalSlots = panels.map<Interval | "">(p => panelIntervals[p.id] ?? "");
  while (intervalSlots.length > 0 && intervalSlots[intervalSlots.length - 1] === "") intervalSlots.pop();
  const intervalsParam = intervalSlots.join(",");
  useEffect(() => {
    // undefined means "param absent" — compare against the empty join.
    if (symbolsParam === (search.symbols ?? "") && intervalsParam === (search.intervals ?? "")) return;
    navigate({
      search: {
        symbols:   symbolsParam   || undefined,
        intervals: intervalsParam || undefined,
      },
      replace: true,
    });
  }, [symbolsParam, intervalsParam, search.symbols, search.intervals, navigate]);

  const addPanel = (symbol?: string) => {
    setPanels(prev => [...prev, { id: nextId.current++, symbol }]);
  };

  const removePanel = (id: number) => {
    setPanels(prev => prev.filter(p => p.id !== id));
  };

  const handleSymbolSelect = (sym: string) => {
    const emptyIdx = panels.findIndex(p => !p.symbol);
    if (emptyIdx !== -1) {
      setPanels(prev => prev.map((p, i) => i === emptyIdx ? { ...p, symbol: sym } : p));
    } else {
      addPanel(sym);
    }
  };

  // §17: a palette symbol jump made off-route stashes a pending symbol and
  // navigates here; consume it once through the normal select path.
  useEffect(() => {
    const sym = takePendingSymbol();
    if (sym) handleSymbolSelect(sym);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid h-full grid-cols-[220px_1fr] gap-3 p-3">
      <aside className="flex flex-col gap-3 overflow-auto rounded-md border border-border bg-card p-3">
        <SymbolPicker onSelect={handleSymbolSelect} />
      </aside>

      <section className="flex flex-col gap-3 overflow-auto">
        {panels.map(p => (
          <ChartPanel
            key={p.id}
            persistKey={`charts-panel-${p.id}`}
            initialSymbol={p.symbol}
            initialInterval={panelIntervals[p.id]}
            initialChartHeight={cookie.chartHeight}
            onSymbolChange={sym =>
              setPanels(prev => prev.map(x => x.id === p.id ? { ...x, symbol: sym } : x))}
            onIntervalChange={iv => handleIntervalChange(p.id, iv)}
            onRemove={() => removePanel(p.id)}
            canRemove={panels.length > 1}
          />
        ))}
        <Button
          variant="outline"
          className="w-full gap-2 text-sm"
          onClick={() => addPanel()}
        >
          <Plus className="h-4 w-4" />
          Add Chart
        </Button>
      </section>
    </div>
  );
}
