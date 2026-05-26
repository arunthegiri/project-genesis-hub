import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";

import { BacktestingChart } from "@/components/BacktestingChart";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pricesApi } from "@/lib/api/prices";
import { symbolsApi, normalizeSymbols } from "@/lib/api/symbols";
import { tradesApi } from "@/lib/api/trades";
import type { PriceBar, Trade } from "@/lib/api/types";

const SPEEDS = [0.5, 1, 2, 5, 10, 25, 50] as const;
type Speed = (typeof SPEEDS)[number];

const DEFAULT_FROM = "2026-05-12T00:00";
const DEFAULT_TO   = "2026-05-17T00:00";

export const Route = createFileRoute("/backtesting")({
  validateSearch: (search: Record<string, unknown>) => ({
    symbol:  (search.symbol  as string | undefined) ?? "",
    from:    (search.from    as string | undefined) ?? DEFAULT_FROM,
    to:      (search.to      as string | undefined) ?? DEFAULT_TO,
    speed:   (Number(search.speed ?? 1)) as Speed,
    // true once the user has clicked Load at least once
    loaded:  search.loaded === "true" || search.loaded === true,
  }),
  head: () => ({ meta: [{ title: "Backtesting — Quant Trading Platform" }] }),
  component: BacktestingPage,
});

function toApiIso(local: string) {
  return new Date(local).toISOString();
}

function formatTs(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatPnl(pnl: number) {
  const sign = pnl >= 0 ? "+" : "";
  return `${sign}$${pnl.toFixed(2)}`;
}

const SESSION_KEY = "backtesting-state";

function BacktestingPage() {
  const search   = Route.useSearch();
  const navigate = Route.useNavigate();

  const setSearch = useCallback(
    (updates: Partial<typeof search>) =>
      navigate({ search: (prev) => ({ ...prev, ...updates }), replace: true }),
    [navigate],
  );

  // On mount: if the sidebar stripped our URL params, restore from sessionStorage.
  useEffect(() => {
    if (!search.loaded || !search.symbol) {
      try {
        const stored = sessionStorage.getItem(SESSION_KEY);
        if (stored) {
          const restored = JSON.parse(stored) as typeof search;
          if (restored.loaded && restored.symbol) {
            navigate({ search: restored, replace: true });
          }
        }
      } catch { /* ignore parse errors */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally only on first mount

  const { data: rawSymbols } = useQuery({
    queryKey: ["symbols"],
    queryFn: symbolsApi.list,
  });
  const symbols = normalizeSymbols(rawSymbols);

  const { symbol, from, to, speed, loaded } = search;
  const selectedSymbol = symbol || symbols[0] || "";

  const fromIso = toApiIso(from);
  const toIso   = toApiIso(to);

  // ── Bars — cached in React Query; only enabled once user clicks Load ────────
  const { data: allBars = [] } = useQuery<PriceBar[]>({
    enabled: loaded && !!selectedSymbol,
    queryKey: ["backtesting-bars", selectedSymbol, fromIso, toIso],
    queryFn: () => pricesApi.range(selectedSymbol, fromIso, toIso),
    staleTime: Infinity,
    gcTime:   30 * 60 * 1000,
  });

  // ── Trades — cached the same way ────────────────────────────────────────────
  const { data: allTrades = [] } = useQuery<Trade[]>({
    enabled: loaded && !!selectedSymbol,
    queryKey: ["backtesting-trades", selectedSymbol, fromIso, toIso],
    queryFn: async () => {
      try {
        return await tradesApi.range(selectedSymbol, fromIso, toIso);
      } catch {
        return [];
      }
    },
    staleTime: Infinity,
    gcTime:   30 * 60 * 1000,
  });

  // ── Playback state ──────────────────────────────────────────────────────────
  // -1 = sentinel for "show all bars" — used on mount and after nav so the
  // chart immediately renders the full dataset from cache instead of 1 bar.
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [playing, setPlaying]       = useState(false);
  const [jumpTo, setJumpTo]         = useState("");

  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevDataKey = useRef("");

  // Only reset playhead when the actual dataset changes (not on nav back).
  useEffect(() => {
    const key = `${selectedSymbol}|${fromIso}|${toIso}`;
    if (key !== prevDataKey.current && loaded) {
      setCurrentIdx(-1);
      setPlaying(false);
      prevDataKey.current = key;
    }
  }, [selectedSymbol, fromIso, toIso, loaded]);

  // Resolved index: -1 collapses to the last bar so all data is visible.
  const resolvedIdx  = currentIdx === -1 ? Math.max(0, allBars.length - 1) : currentIdx;

  // ── Timer ───────────────────────────────────────────────────────────────────
  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => {
    if (!playing) { stopTimer(); return; }
    const ms = Math.max(16, Math.round(1000 / speed));
    timerRef.current = setInterval(() => {
      setCurrentIdx(prev => {
        // If we're in "show all" mode, replay starts from bar 0.
        const cur = prev === -1 ? 0 : prev;
        if (cur >= allBars.length - 1) { setPlaying(false); return allBars.length - 1; }
        return cur + 1;
      });
    }, ms);
    return stopTimer;
  }, [playing, speed, allBars.length, stopTimer]);

  // ── Controls ────────────────────────────────────────────────────────────────
  const handleLoad = () => {
    setPlaying(false);
    setCurrentIdx(-1);
    const next = { symbol: selectedSymbol, from, to, speed, loaded: true };
    setSearch(next);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  };

  const restart     = () => { setPlaying(false); setCurrentIdx(0); };
  const stepBack    = () => { setPlaying(false); setCurrentIdx(i => Math.max(0, (i === -1 ? allBars.length - 1 : i) - 1)); };
  const stepForward = () => { setPlaying(false); setCurrentIdx(i => Math.min(allBars.length - 1, (i === -1 ? allBars.length - 1 : i) + 1)); };
  const togglePlay  = () => setPlaying(p => !p);

  const handleJump = () => {
    if (!jumpTo || !allBars.length) return;
    const target = new Date(jumpTo).getTime();
    let best = 0, bestDiff = Infinity;
    for (let i = 0; i < allBars.length; i++) {
      const diff = Math.abs(new Date(allBars[i].time).getTime() - target);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    setPlaying(false);
    setCurrentIdx(best);
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const visibleBars   = allBars.slice(0, resolvedIdx + 1);
  const currentBar    = allBars[resolvedIdx];
  const currentTime   = currentBar?.time ?? "";
  const visibleTrades = allTrades.filter(
    t => new Date(t.exitTime).getTime() <= new Date(currentTime).getTime(),
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-3">

      {/* ── Controls bar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">

        {/* Symbol */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Symbol</label>
          <Select
            value={selectedSymbol}
            onValueChange={v => setSearch({ symbol: v, loaded: false })}
          >
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue placeholder="Symbol" />
            </SelectTrigger>
            <SelectContent>
              {symbols.map(s => (
                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* From */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">From</label>
          <input
            type="datetime-local"
            value={from}
            onChange={e => setSearch({ from: e.target.value, loaded: false })}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* To */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">To</label>
          <input
            type="datetime-local"
            value={to}
            onChange={e => setSearch({ to: e.target.value, loaded: false })}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Speed */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Speed (bars/s)</label>
          <Select
            value={String(speed)}
            onValueChange={v => setSearch({ speed: Number(v) as Speed })}
          >
            <SelectTrigger className="h-8 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPEEDS.map(s => (
                <SelectItem key={s} value={String(s)} className="text-xs">{s}×</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Load */}
        <Button size="sm" onClick={handleLoad} className="h-8 self-end text-xs">
          Load
        </Button>

        {/* Playback buttons */}
        {loaded && allBars.length > 0 && (
          <div className="ml-auto flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={restart} title="Restart">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={stepBack} title="Step back">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="default" className="h-8 w-8" onClick={togglePlay} title={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={stepForward} title="Step forward">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* ── Status / jump row ────────────────────────────────────────────── */}
      {loaded && allBars.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 px-1 text-xs text-muted-foreground">
          <span className="font-mono text-foreground">{currentTime ? formatTs(currentTime) : "—"}</span>
          <span>Bar {resolvedIdx + 1} / {allBars.length}</span>
          {currentBar && (
            <span className="font-mono">
              O {currentBar.open.toFixed(2)}
              {" "}H {currentBar.high.toFixed(2)}
              {" "}L {currentBar.low.toFixed(2)}
              {" "}C {currentBar.close.toFixed(2)}
            </span>
          )}

          {/* Jump */}
          <div className="ml-auto flex items-center gap-2">
            <label className="shrink-0">Jump to</label>
            <input
              type="datetime-local"
              value={jumpTo}
              onChange={e => setJumpTo(e.target.value)}
              className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleJump}>
              Go
            </Button>
          </div>
        </div>
      )}

      {/* ── Main content: chart + trade log ──────────────────────────────── */}
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_260px] gap-3">

        {/* Chart */}
        <div className="overflow-hidden rounded-md border border-border bg-card">
          {!loaded || allBars.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {!loaded
                ? "Select a symbol and date range, then click Load."
                : "Loading data…"}
            </div>
          ) : (
            <BacktestingChart bars={visibleBars} trades={visibleTrades} />
          )}
        </div>

        {/* Trade log */}
        <div className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Trade Log
            {visibleTrades.length > 0 && (
              <span className="ml-2 text-foreground">{visibleTrades.length}</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {visibleTrades.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                No trades yet
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {[...visibleTrades].reverse().map((t, i) => (
                  <li key={i} className="flex flex-col gap-0.5 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-semibold ${t.side === "LONG" ? "text-green-400" : "text-red-400"}`}>
                        {t.side}
                      </span>
                      <span className={`text-xs font-mono ${t.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {formatPnl(t.pnl)}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      <span>In: {formatTs(t.entryTime)} @ {t.entryPrice.toFixed(2)}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      <span>Out: {formatTs(t.exitTime)} @ {t.exitPrice.toFixed(2)}</span>
                    </div>
                    {t.strategyName && (
                      <div className="text-[10px] text-muted-foreground truncate">{t.strategyName}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* PnL summary */}
          {visibleTrades.length > 0 && (
            <div className="border-t border-border px-3 py-2">
              {(() => {
                const total = visibleTrades.reduce((s, t) => s + t.pnl, 0);
                const wins  = visibleTrades.filter(t => t.pnl >= 0).length;
                return (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Win rate {Math.round((wins / visibleTrades.length) * 100)}%
                    </span>
                    <span className={`font-mono font-semibold ${total >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {formatPnl(total)}
                    </span>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
