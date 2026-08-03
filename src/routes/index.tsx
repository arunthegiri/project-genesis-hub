import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState, useEffect } from "react";
import { Plus } from "lucide-react";

import { SymbolPicker } from "@/components/SymbolPicker";
import { ChartPanel } from "@/components/ChartPanel";
import { Button } from "@/components/ui/button";
import { takePendingSymbol } from "@/lib/active-chart-panel";
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

export const Route = createFileRoute("/")({
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
  const [panels, setPanels] = useState<PanelSpec[]>(() =>
    Array.isArray(cookie.panels) && cookie.panels.length > 0 ? cookie.panels : [{ id: 1 }]);
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
            initialChartHeight={cookie.chartHeight}
            onSymbolChange={sym =>
              setPanels(prev => prev.map(x => x.id === p.id ? { ...x, symbol: sym } : x))}
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
