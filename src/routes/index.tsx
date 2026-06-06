import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState, useEffect } from "react";
import { Plus } from "lucide-react";

import { SymbolPicker } from "@/components/SymbolPicker";
import { ChartPanel } from "@/components/ChartPanel";
import { Button } from "@/components/ui/button";

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
  // SSR-safe default; persisted panels are restored after mount (see below) so
  // the server and first client render match and hydration doesn't break.
  const [panels, setPanels] = useState<{ id: number; symbol?: string }[]>([{ id: 1 }]);
  const nextId = useRef(2);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("charts-panels") ?? "null");
      if (Array.isArray(saved) && saved.length > 0) {
        setPanels(saved);
        nextId.current = saved.reduce((m, p) => Math.max(m, p.id), 0) + 1;
      }
    } catch {}
  }, []);

  const skipPersist = useRef(true);
  useEffect(() => {
    if (skipPersist.current) { skipPersist.current = false; return; }
    sessionStorage.setItem("charts-panels", JSON.stringify(panels));
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
