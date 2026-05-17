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

import { ReplayChart } from "@/components/ReplayChart";
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

export const Route = createFileRoute("/replay")({
  head: () => ({ meta: [{ title: "Replay — Quant Trading Platform" }] }),
  component: ReplayPage,
});

const SPEEDS = [0.5, 1, 2, 5, 10, 25, 50] as const;
type Speed = (typeof SPEEDS)[number];

const DEFAULT_FROM = "2026-05-12T00:00";
const DEFAULT_TO   = "2026-05-17T00:00";

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

function ReplayPage() {
  const { data: rawSymbols } = useQuery({
    queryKey: ["symbols"],
    queryFn: symbolsApi.list,
  });
  const symbols = normalizeSymbols(rawSymbols);

  const [symbol, setSymbol]   = useState<string>("");
  const [from, setFrom]       = useState(DEFAULT_FROM);
  const [to, setTo]           = useState(DEFAULT_TO);
  const [speed, setSpeed]     = useState<Speed>(1);
  const [jumpTo, setJumpTo]   = useState("");

  const [allBars, setAllBars]     = useState<PriceBar[]>([]);
  const [allTrades, setAllTrades] = useState<Trade[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying]     = useState(false);
  const [loaded, setLoaded]       = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedSymbol = symbol || symbols[0] || "";

  // ── Load ────────────────────────────────────────────────────────────────────
  const handleLoad = useCallback(async () => {
    if (!selectedSymbol) return;
    setPlaying(false);
    setLoaded(false);

    const fromIso = toApiIso(from);
    const toIso   = toApiIso(to);

    const bars = await pricesApi.range(selectedSymbol, fromIso, toIso);
    setAllBars(bars);
    setCurrentIdx(0);

    let trades: Trade[] = [];
    try {
      trades = await tradesApi.range(selectedSymbol, fromIso, toIso);
    } catch {
      // endpoint not yet deployed — silently fall back to no markers
    }
    setAllTrades(trades);
    setLoaded(true);
  }, [selectedSymbol, from, to]);

  // ── Timer ───────────────────────────────────────────────────────────────────
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!playing) {
      stopTimer();
      return;
    }

    const ms = Math.max(16, Math.round(1000 / speed));
    timerRef.current = setInterval(() => {
      setCurrentIdx(prev => {
        if (prev >= allBars.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, ms);

    return stopTimer;
  }, [playing, speed, allBars.length, stopTimer]);

  // ── Controls ────────────────────────────────────────────────────────────────
  const restart = () => {
    setPlaying(false);
    setCurrentIdx(0);
  };

  const stepBack = () => {
    setPlaying(false);
    setCurrentIdx(i => Math.max(0, i - 1));
  };

  const stepForward = () => {
    setPlaying(false);
    setCurrentIdx(i => Math.min(allBars.length - 1, i + 1));
  };

  const togglePlay = () => setPlaying(p => !p);

  const handleJump = () => {
    if (!jumpTo || !allBars.length) return;
    const target = new Date(jumpTo).getTime();
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < allBars.length; i++) {
      const diff = Math.abs(new Date(allBars[i].time).getTime() - target);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    setPlaying(false);
    setCurrentIdx(best);
  };

  // ── Derived data ─────────────────────────────────────────────────────────────
  const visibleBars   = allBars.slice(0, currentIdx + 1);
  const currentBar    = allBars[currentIdx];
  const currentTime   = currentBar?.time ?? "";

  const visibleTrades = allTrades.filter(
    t => new Date(t.exitTime).getTime() <= new Date(currentTime).getTime()
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-3">

      {/* ── Controls bar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">

        {/* Symbol */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Symbol</label>
          <Select value={selectedSymbol} onValueChange={setSymbol}>
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
            onChange={e => setFrom(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* To */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">To</label>
          <input
            type="datetime-local"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Speed */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Speed (bars/s)</label>
          <Select value={String(speed)} onValueChange={v => setSpeed(Number(v) as Speed)}>
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
        {loaded && (
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
      {loaded && (
        <div className="flex flex-wrap items-center gap-4 px-1 text-xs text-muted-foreground">
          <span className="font-mono text-foreground">{currentTime ? formatTs(currentTime) : "—"}</span>
          <span>Bar {currentIdx + 1} / {allBars.length}</span>
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
          {!loaded ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a symbol and date range, then click Load.
            </div>
          ) : (
            <ReplayChart bars={visibleBars} trades={visibleTrades} />
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
