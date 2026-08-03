import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import {
  useCallback,
  useEffect,
  useMemo,
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
import { toast } from "sonner";

import { BacktestingChart } from "@/components/BacktestingChart";
import { ChartScrollbar } from "@/components/ChartScrollbar";
import { TradeLog, StrategyTradeLog } from "@/components/backtesting/TradeLog";
import { RunHistory } from "@/components/backtesting/RunHistory";
import { HermesModelPanel } from "@/components/backtesting/HermesModelPanel";
import type { RunRecord } from "@/components/backtesting/RunHistory";
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
import { strategiesApi } from "@/lib/api/strategies";
import { tradesApi, type TradesResult } from "@/lib/api/trades";
import type { BacktestTrade, BacktestResults } from "@/lib/api/strategies";
import type { PriceBar, Trade } from "@/lib/api/types";
import { applyCapitalConstraints, calcBuyHold } from "@/lib/backtest-capital";
import { useRafCoalescer } from "@/hooks/useRafCoalescer";
import { cn } from "@/lib/utils";

const SPEEDS = [0.5, 1, 2, 5, 10, 25, 50] as const;
type Speed = (typeof SPEEDS)[number];
type Tab = "data" | "strategies" | "results" | "models";
type TradeFilter = "all" | "winning" | "losing";

// Date defaults resolve relative to *now* — never constants — so a clean URL
// opens on a range ending today. Explicit from/to in the URL still override.
function defaultFrom(): string {
  return format(addDays(new Date(), -5), "yyyy-MM-dd'T'HH:mm");
}
function defaultTo(): string {
  return format(new Date(), "yyyy-MM-dd'T'HH:mm");
}
const DEFAULT_CAPITAL       = 10_000;
const MIN_CAPITAL           = 100;
const MAX_CAPITAL           = 10_000_000;

export const Route = createFileRoute("/backtesting")({
  validateSearch: (search: Record<string, unknown>) => ({
    symbol:            (search.symbol  as string | undefined) ?? "",
    from:              (search.from    as string | undefined) ?? defaultFrom(),
    to:                (search.to      as string | undefined) ?? defaultTo(),
    speed:             (Number(search.speed ?? 1)) as Speed,
    loaded:            search.loaded === "true" || search.loaded === true,
    startingCapital:   clampCapital(Number(search.startingCapital ?? DEFAULT_CAPITAL)),
    comparisonVisible: search.comparisonVisible !== false && search.comparisonVisible !== "false",
  }),
  head: () => ({ meta: [{ title: "Backtesting — Quant Trading Platform" }] }),
  component: BacktestingPage,
});

function clampCapital(n: number): number {
  if (!isFinite(n) || n < MIN_CAPITAL) return DEFAULT_CAPITAL;
  return Math.min(MAX_CAPITAL, Math.max(MIN_CAPITAL, Math.round(n)));
}

function toApiIso(local: string) {
  return new Date(local).toISOString();
}

function formatTs(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function formatPnl(pnl: number) {
  return `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`;
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

  // ── Run history (session only) ───────────────────────────────────────────────
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  // Set by loadRecord so the strategy-reset effect restores state instead of clearing it
  const pendingLoadRef = useRef<{
    runResults: BacktestResults;
    stratSymbol: string;
    stratFrom: string;
    stratTo: string;
    startingCapital: number;
  } | null>(null);
  // Set in onSuccess so the capitalStats effect knows to add a history entry
  const pendingHistoryRef = useRef(false);

  useEffect(() => {
    if (!search.loaded || !search.symbol) {
      try {
        const stored = sessionStorage.getItem(SESSION_KEY);
        if (stored) {
          const restored = JSON.parse(stored) as typeof search;
          if (restored.loaded && restored.symbol) navigate({ search: restored, replace: true });
        }
      } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Tab state ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>("data");

  // ── Symbols ──────────────────────────────────────────────────────────────────
  const { data: rawSymbols } = useQuery({ queryKey: ["symbols"], queryFn: symbolsApi.list });
  const symbols = normalizeSymbols(rawSymbols);

  const { symbol, from, to, speed, loaded, startingCapital, comparisonVisible } = search;

  // ── Capital input local display state (formatted string) ─────────────────────
  const [capitalRaw, setCapitalRaw] = useState(() => startingCapital.toLocaleString("en-US"));
  useEffect(() => { setCapitalRaw(startingCapital.toLocaleString("en-US")); }, [startingCapital]);

  const handleCapitalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9,]/g, "");
    setCapitalRaw(raw);
    const num = parseInt(raw.replace(/,/g, ""), 10);
    if (!isNaN(num) && num >= MIN_CAPITAL && num <= MAX_CAPITAL) {
      setSearch({ startingCapital: num });
    }
  };

  const handleCapitalBlur = () => {
    const num = parseInt(capitalRaw.replace(/,/g, ""), 10);
    const clamped = isNaN(num) ? startingCapital : clampCapital(num);
    setCapitalRaw(clamped.toLocaleString("en-US"));
    setSearch({ startingCapital: clamped });
  };
  const selectedSymbol = symbol || symbols[0] || "";

  const fromIso = toApiIso(from);
  const toIso   = toApiIso(to);

  // ── Price bars ───────────────────────────────────────────────────────────────
  const { data: allBars = [] } = useQuery<PriceBar[]>({
    enabled: loaded && !!selectedSymbol,
    queryKey: ["backtesting-bars", selectedSymbol, fromIso, toIso],
    queryFn: () => pricesApi.range(selectedSymbol, fromIso, toIso),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });

  // ── Replay trades ────────────────────────────────────────────────────────────
  // /api/trades/range is not implemented on the backend (Q10) — rangeSafe never
  // throws; the Data tab renders the failure reason inline instead of an empty
  // table that would read as "no trades."
  const { data: tradesResult } = useQuery<TradesResult>({
    enabled: loaded && !!selectedSymbol,
    queryKey: ["backtesting-trades", selectedSymbol, fromIso, toIso],
    queryFn: () => tradesApi.rangeSafe(selectedSymbol, fromIso, toIso),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });
  const allTrades = tradesResult?.ok ? tradesResult.trades : [];

  // ── Strategies ───────────────────────────────────────────────────────────────
  const { data: strategyList = [] } = useQuery({
    queryKey: ["strategies"],
    queryFn: strategiesApi.list,
  });

  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
  const [tradeFilter, setTradeFilter] = useState<TradeFilter>("all");

  // Strategies tab has its own independent data controls
  const [stratSymbol, setStratSymbol] = useState("");
  const [stratFrom,   setStratFrom]   = useState<string>(defaultFrom);
  const [stratTo,     setStratTo]     = useState<string>(defaultTo);
  const [stratLoaded, setStratLoaded] = useState(false);

  // Replay state for Strategies tab — cursor only; the full stratBars array
  // stays stable and is passed to the chart with a visibleCount. All cursor
  // writes (interval ticks, seeks, resets) go through setStratCursor, which
  // stores the authoritative value in a ref and coalesces React commits to
  // one per animation frame (rAF coalescer, build doc §7/§11).
  const [stratIdx,     setStratIdx]   = useState(-1);
  const [stratPlaying, setStratPlaying] = useState(false);
  const stratTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const stratCursorRef = useRef(-1);
  const flushStratCursor = useRafCoalescer<number>(setStratIdx);
  const setStratCursor = useCallback((v: number) => {
    stratCursorRef.current = v;
    flushStratCursor(v);
  }, [flushStratCursor]);

  // Run mutation — calls POST /api/strategies/{name}/run
  const [runResults, setRunResults] = useState<import("@/lib/api/strategies").BacktestResults | null>(null);
  const [runError,   setRunError]   = useState<string | null>(null);

  const runMutation = useMutation({
    mutationFn: () => strategiesApi.run(
      selectedStrategy!,
      stratSymbol,
      new Date(stratFrom).toISOString(),
      new Date(stratTo).toISOString(),
    ),
    onSuccess: (data) => { pendingHistoryRef.current = true; setRunResults(data); setRunError(null); setStratCursor(-1); setStratPlaying(false); toast.success(`Backtest complete — ${selectedStrategy} on ${stratSymbol}`); },
    onError:   (err: Error) => { setRunError(err.message); toast.error(`Backtest failed: ${err.message}`); },
  });

  const { data: strategyDetail } = useQuery({
    queryKey: ["strategy", selectedStrategy],
    queryFn: () => strategiesApi.get(selectedStrategy!),
    enabled: !!selectedStrategy,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });

  // When strategy changes, reset — or restore a record loaded from history
  useEffect(() => {
    setRunError(null);
    setStratCursor(-1);
    setStratPlaying(false);
    if (pendingLoadRef.current) {
      const p = pendingLoadRef.current;
      pendingLoadRef.current = null;
      // Bars re-fetch through the React Query cache — the "strat-bars" key for
      // this symbol/range was populated by the original run (staleTime:
      // Infinity), so this is a cache hit in the common case.
      setStratSymbol(p.stratSymbol);
      setStratFrom(p.stratFrom);
      setStratTo(p.stratTo);
      setStratLoaded(true);
      setRunResults(p.runResults);
      setSearch({ startingCapital: p.startingCapital });
    } else {
      setRunResults(null);
      setStratLoaded(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStrategy]);

  // Active results = run override ?? stored latest results
  const activeResults = runResults ?? strategyDetail?.latestResults ?? null;
  const allStratTrades = useMemo(() => activeResults?.trades ?? [], [activeResults]);

  const filteredStratTrades = useMemo(() => allStratTrades.filter(t => {
    if (tradeFilter === "winning") return t.win === true;
    if (tradeFilter === "losing")  return t.win === false;
    return true;
  }), [allStratTrades, tradeFilter]);

  // Price bars for Strategies tab (own query)
  const stratFromIso = stratLoaded ? new Date(stratFrom).toISOString() : "";
  const stratToIso   = stratLoaded ? new Date(stratTo).toISOString()   : "";
  const { data: stratBars = [] } = useQuery<PriceBar[]>({
    enabled: stratLoaded && !!stratSymbol,
    queryKey: ["strat-bars", stratSymbol, stratFromIso, stratToIso],
    queryFn:  () => pricesApi.range(stratSymbol, stratFromIso, stratToIso),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });

  // Capital-adjusted stats — recomputed instantly when capital changes, no re-run needed
  const capitalStats = useMemo(
    () => activeResults ? applyCapitalConstraints(activeResults, startingCapital) : null,
    [activeResults, startingCapital],
  );

  // Buy & hold — recomputed when bars or capital changes, no extra API call needed
  const buyHold = useMemo(
    () => stratBars.length >= 2 ? calcBuyHold(stratBars, startingCapital) : null,
    [stratBars, startingCapital],
  );

  // Auto-add to run history after each successful run (fires when capitalStats updates post-run)
  useEffect(() => {
    if (!pendingHistoryRef.current || !capitalStats || !runResults || !selectedStrategy) return;
    pendingHistoryRef.current = false;
    setRunHistory(prev => [{
      id: `${Date.now()}-${Math.random()}`,
      strategyName: selectedStrategy,
      symbol: stratSymbol,
      from: stratFrom,
      to: stratTo,
      startingCapital,
      capitalStats: { ...capitalStats },
      buyHold: buyHold ? { ...buyHold } : null,
      runResults: { ...runResults },
      timestamp: new Date(),
    }, ...prev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capitalStats]);

  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  const loadRecord = useCallback((record: RunRecord) => {
    pendingLoadRef.current = {
      runResults: record.runResults,
      stratSymbol: record.symbol,
      stratFrom: record.from,
      stratTo: record.to,
      startingCapital: record.startingCapital,
    };
    // Changing selectedStrategy fires the reset effect which reads pendingLoadRef
    setSelectedStrategy(record.strategyName);
    setTradeFilter("all");
    setActiveTab("strategies");
  }, []);

  // Replay logic for Strategies tab
  const stopStratTimer = useCallback(() => {
    if (stratTimerRef.current) { clearInterval(stratTimerRef.current); stratTimerRef.current = null; }
  }, []);

  useEffect(() => {
    if (!stratPlaying) { stopStratTimer(); return; }
    const ms = Math.max(16, Math.round(1000 / speed));
    stratTimerRef.current = setInterval(() => {
      // The interval only advances the cursor ref; the rAF coalescer commits
      // to React state at most once per frame regardless of tick rate.
      const cur = stratCursorRef.current === -1 ? 0 : stratCursorRef.current;
      if (cur >= stratBars.length - 1) {
        setStratPlaying(false);
        setStratCursor(stratBars.length - 1);
        return;
      }
      setStratCursor(cur + 1);
    }, ms);
    return stopStratTimer;
  }, [stratPlaying, speed, stratBars.length, stopStratTimer, setStratCursor]);

  const stratResolvedIdx  = stratIdx === -1 ? Math.max(0, stratBars.length - 1) : stratIdx;
  const stratVisibleCount = stratIdx === -1 ? stratBars.length : stratResolvedIdx + 1;
  const stratCurrentTime  = stratBars[stratResolvedIdx]?.time ?? "";

  // Visible trades: trades whose exit_time is within the replay window.
  // Memo keys on the cursor — components below get the stable array, not a
  // fresh slice per render.
  const stratVisibleTrades = useMemo(() => filteredStratTrades.filter(t => {
    if (!t.exit_time) return false;
    return stratIdx === -1 || new Date(t.exit_time).getTime() <= new Date(stratCurrentTime).getTime();
  }), [filteredStratTrades, stratIdx, stratCurrentTime]);

  // Only show markers when results are actually for the chart's symbol.
  // Stored results are for the original export symbol — don't overlay them on a different stock.
  const resultsSymbol = activeResults?.symbol ?? null;
  const markersMatchSymbol =
    runResults !== null ||                          // ran on this specific symbol
    !stratSymbol ||                                 // no symbol chosen yet
    !resultsSymbol ||                               // stored result has no symbol tag
    stratSymbol === resultsSymbol;                  // symbols match

  const strategyChartTrades: Trade[] = useMemo(() => markersMatchSymbol
    ? stratVisibleTrades
        .filter(t => t.status === "closed" && t.exit_time && t.exit_price != null)
        .map(t => ({
          symbol:       stratSymbol || selectedSymbol,
          entryTime:    t.entry_time,
          exitTime:     t.exit_time!,
          entryPrice:   t.entry_price,
          exitPrice:    t.exit_price!,
          quantity:     t.quantity,
          pnl:          t.pnl ?? 0,
          side:         t.direction === "long" ? "LONG" : "SHORT",
          strategyName: selectedStrategy ?? "",
          modelVersion: "",
        }))
    : [], [markersMatchSymbol, stratVisibleTrades, stratSymbol, selectedSymbol, selectedStrategy]);

  // Running P&L for replay status bar
  const stratRunningPnl = useMemo(
    () => stratVisibleTrades.reduce((s, t) => s + (t.pnl ?? 0), 0),
    [stratVisibleTrades],
  );

  // ── Playback state ───────────────────────────────────────────────────────────
  // Cursor-only replay state: the full allBars array stays stable; the chart
  // receives it plus a visibleCount. All cursor writes (interval ticks, seeks,
  // resets) go through setCursor — a ref holds the authoritative value and an
  // rAF coalescer commits to React state at most once per frame.
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [playing, setPlaying]       = useState(false);
  const [jumpTo, setJumpTo]         = useState("");

  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevDataKey = useRef("");
  const cursorRef   = useRef(-1);
  const flushCursor = useRafCoalescer<number>(setCurrentIdx);
  const setCursor   = useCallback((v: number) => {
    cursorRef.current = v;
    flushCursor(v);
  }, [flushCursor]);

  useEffect(() => {
    const key = `${selectedSymbol}|${fromIso}|${toIso}`;
    if (key !== prevDataKey.current && loaded) {
      setCursor(-1);
      setPlaying(false);
      prevDataKey.current = key;
    }
  }, [selectedSymbol, fromIso, toIso, loaded, setCursor]);

  const resolvedIdx = currentIdx === -1 ? Math.max(0, allBars.length - 1) : currentIdx;

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => {
    if (!playing) { stopTimer(); return; }
    const ms = Math.max(16, Math.round(1000 / speed));
    timerRef.current = setInterval(() => {
      // The interval only advances the cursor ref; the rAF coalescer commits
      // to React state at most once per frame regardless of tick rate.
      const cur = cursorRef.current === -1 ? 0 : cursorRef.current;
      if (cur >= allBars.length - 1) {
        setPlaying(false);
        setCursor(allBars.length - 1);
        return;
      }
      setCursor(cur + 1);
    }, ms);
    return stopTimer;
  }, [playing, speed, allBars.length, stopTimer, setCursor]);

  // ── Controls ─────────────────────────────────────────────────────────────────
  const handleLoad = () => {
    setPlaying(false);
    setCursor(-1);
    const next = { symbol: selectedSymbol, from, to, speed, loaded: true };
    setSearch(next);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  };

  const restart     = () => { setPlaying(false); setCursor(0); };
  const stepBack    = () => { setPlaying(false); setCursor(Math.max(0, (cursorRef.current === -1 ? allBars.length - 1 : cursorRef.current) - 1)); };
  const stepForward = () => { setPlaying(false); setCursor(Math.min(allBars.length - 1, (cursorRef.current === -1 ? allBars.length - 1 : cursorRef.current) + 1)); };
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
    setCursor(best);
  };

  // ── Derived ──────────────────────────────────────────────────────────────────
  const visibleCount  = currentIdx === -1 ? allBars.length : resolvedIdx + 1;
  const currentBar    = allBars[resolvedIdx];
  const currentTime   = currentBar?.time ?? "";
  const visibleTrades = useMemo(
    () => allTrades.filter(
      t => new Date(t.exitTime).getTime() <= new Date(currentTime).getTime(),
    ),
    [allTrades, currentTime],
  );

  // ── Chart scrollbar state ────────────────────────────────────────────────────
  const [visibleRange, setVisibleRange] = useState<{ from: number; to: number } | null>(null);
  const handleRangeChange = useCallback((f: number, t: number) => setVisibleRange({ from: f, to: t }), []);

  // Reset visible range when switching tabs so chart re-fits
  useEffect(() => { setVisibleRange(null); }, [activeTab]);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-3">

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 self-start rounded-md border border-border bg-card p-1">
        {(["data", "strategies", "results", "models"] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "rounded px-3 py-1 text-xs font-medium capitalize transition-colors",
              activeTab === tab
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab}
            {tab === "results" && runHistory.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-normal text-primary">
                {runHistory.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══ DATA TAB ═══════════════════════════════════════════════════════════ */}
      {activeTab === "data" && (
        <>
          {/* Controls bar */}
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Symbol</label>
              <Select value={selectedSymbol} onValueChange={v => setSearch({ symbol: v, loaded: false })}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="Symbol" /></SelectTrigger>
                <SelectContent>{symbols.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">From</label>
              <input type="datetime-local" value={from} onChange={e => setSearch({ from: e.target.value, loaded: false })}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">To</label>
              <input type="datetime-local" value={to} onChange={e => setSearch({ to: e.target.value, loaded: false })}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Speed (bars/s)</label>
              <Select value={String(speed)} onValueChange={v => setSearch({ speed: Number(v) as Speed })}>
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{SPEEDS.map(s => <SelectItem key={s} value={String(s)} className="text-xs">{s}×</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={handleLoad} className="h-8 self-end text-xs">Load</Button>
            {loaded && allBars.length > 0 && (
              <div className="ml-auto flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={restart}><RotateCcw className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={stepBack}><ChevronLeft className="h-4 w-4" /></Button>
                <Button size="icon" variant="default" className="h-8 w-8" onClick={togglePlay}>
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={stepForward}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            )}
          </div>

          {/* Status / jump row */}
          {loaded && allBars.length > 0 && (
            <div className="flex flex-wrap items-center gap-4 px-1 text-xs text-muted-foreground">
              <span className="font-mono text-foreground">{currentTime ? formatTs(currentTime) : "—"}</span>
              <span>Bar {resolvedIdx + 1} / {allBars.length}</span>
              {currentBar && (
                <span className="font-mono">
                  O {currentBar.open.toFixed(2)} H {currentBar.high.toFixed(2)}{" "}
                  L {currentBar.low.toFixed(2)} C {currentBar.close.toFixed(2)}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <label className="shrink-0">Jump to</label>
                <input type="datetime-local" value={jumpTo} onChange={e => setJumpTo(e.target.value)}
                  className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleJump}>Go</Button>
              </div>
            </div>
          )}

          {/* Chart + trade log */}
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_260px] gap-3">
            <div className="flex overflow-hidden rounded-md border border-border bg-card">
              {!loaded || allBars.length === 0 ? (
                <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">
                  {!loaded ? "Select a symbol and date range, then click Load." : "Loading data…"}
                </div>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <BacktestingChart bars={allBars} visibleCount={visibleCount} trades={visibleTrades}
                      onRangeChange={handleRangeChange} visibleRange={visibleRange ?? undefined} />
                  </div>
                  {visibleCount > 0 && visibleRange && (
                    <ChartScrollbar totalBars={visibleCount} from={visibleRange.from} to={visibleRange.to}
                      onRangeChange={(f, t) => setVisibleRange({ from: f, to: t })} />
                  )}
                </>
              )}
            </div>
            {tradesResult && !tradesResult.ok ? (
              <div className="flex w-[260px] shrink-0 items-center justify-center rounded-md border border-border bg-card p-3 text-center text-xs text-muted-foreground">
                {tradesResult.reason === "endpoint-missing"
                  ? "Trade data unavailable — /api/trades/range is not implemented on the backend."
                  : "Trade data unavailable — could not reach the backend."}
              </div>
            ) : (
              <TradeLog trades={visibleTrades} />
            )}
          </div>
        </>
      )}

      {/* ══ STRATEGIES TAB ═════════════════════════════════════════════════════ */}
      {activeTab === "strategies" && (
        <>
          {/* Row 1: strategy picker + data controls + run button */}
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
            {/* Strategy */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Strategy</label>
              <Select value={selectedStrategy ?? ""} onValueChange={v => { setSelectedStrategy(v || null); setTradeFilter("all"); }}>
                <SelectTrigger className="h-8 w-52 text-xs">
                  <SelectValue placeholder="Select a strategy…" />
                </SelectTrigger>
                <SelectContent>
                  {strategyList.length === 0 && (
                    <SelectItem value="__none__" disabled className="text-xs">No strategies exported yet</SelectItem>
                  )}
                  {strategyList.map(s => (
                    <SelectItem key={s.id} value={s.name} className="text-xs">{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Symbol */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Symbol</label>
              <Select value={stratSymbol} onValueChange={v => { setStratSymbol(v); setStratLoaded(false); }}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="Symbol" /></SelectTrigger>
                <SelectContent>{symbols.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Date range */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">From</label>
              <input type="datetime-local" value={stratFrom} onChange={e => { setStratFrom(e.target.value); setStratLoaded(false); }}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">To</label>
              <input type="datetime-local" value={stratTo} onChange={e => { setStratTo(e.target.value); setStratLoaded(false); }}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>

            {/* Speed (shared with Data tab) */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Speed</label>
              <Select value={String(speed)} onValueChange={v => setSearch({ speed: Number(v) as Speed })}>
                <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{SPEEDS.map(s => <SelectItem key={s} value={String(s)} className="text-xs">{s}×</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Starting capital */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Starting Capital ($)</label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-muted-foreground">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={capitalRaw}
                  onChange={handleCapitalChange}
                  onBlur={handleCapitalBlur}
                  className="h-8 w-32 rounded-md border border-border bg-background pl-5 pr-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            {/* Run button */}
            <Button
              size="sm"
              className="h-8 self-end text-xs"
              disabled={!selectedStrategy || !stratSymbol || runMutation.isPending}
              onClick={() => { setStratLoaded(true); runMutation.mutate(); }}
            >
              {runMutation.isPending ? "Running…" : "Run"}
            </Button>

            {/* Replay controls (only when bars loaded) */}
            {stratBars.length > 0 && (
              <div className="ml-auto flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setStratPlaying(false); setStratCursor(0); }}><RotateCcw className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setStratPlaying(false); setStratCursor(Math.max(0, (stratCursorRef.current === -1 ? stratBars.length - 1 : stratCursorRef.current) - 1)); }}><ChevronLeft className="h-4 w-4" /></Button>
                <Button size="icon" variant="default" className="h-8 w-8" onClick={() => setStratPlaying(p => !p)}>
                  {stratPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setStratPlaying(false); setStratCursor(Math.min(stratBars.length - 1, (stratCursorRef.current === -1 ? stratBars.length - 1 : stratCursorRef.current) + 1)); }}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            )}
          </div>

          {/* Replay status bar */}
          {stratBars.length > 0 && stratIdx !== -1 && (
            <div className="flex flex-wrap items-center gap-4 px-1 text-xs text-muted-foreground">
              <span className="font-mono text-foreground">{stratCurrentTime ? formatTs(stratCurrentTime) : "—"}</span>
              <span>Bar {stratResolvedIdx + 1} / {stratBars.length}</span>
              {stratBars[stratResolvedIdx] && (
                <span className="font-mono">
                  C {stratBars[stratResolvedIdx].close.toFixed(2)}
                </span>
              )}
              <span className={cn("font-mono font-semibold", stratRunningPnl >= 0 ? "text-bull" : "text-bear")}>
                P&L {formatPnl(stratRunningPnl)}
              </span>
              <span className="text-muted-foreground/60">{stratVisibleTrades.length} trades completed</span>
            </div>
          )}

          {/* Error banner */}
          {runError && (
            <div className="rounded-md border border-bear/30 bg-red-500/10 px-3 py-2 text-xs text-bear">
              {runError.includes("cannot be re-run") || runError.includes("type")
                ? <>Strategy needs re-exporting. Open <code className="bg-red-900/30 px-1 rounded">rsi_strategy.ipynb</code>, re-run all cells, then run the updated export cell with <code className="bg-red-900/30 px-1 rounded">params=</code>.</>
                : runError}
            </div>
          )}

          {/* Run source badge */}
          {activeResults && (
            <div className="flex items-center gap-2 px-1">
              <span className={cn("rounded px-2 py-0.5 text-[10px] font-medium border",
                runResults
                  ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                  : "bg-zinc-500/20 text-zinc-400 border-zinc-500/30"
              )}>
                {runResults ? `Live run · ${activeResults.symbol ?? stratSymbol}` : `Stored · ${activeResults.symbol ?? "original"}`}
              </span>
              {activeResults && (
                <span className="text-[10px] text-muted-foreground">
                  {activeResults.totalTrades} trades · Win {Number(activeResults.winRate ?? 0).toFixed(1)}%
                </span>
              )}
              {buyHold && (
                <button
                  onClick={() => setSearch({ comparisonVisible: !comparisonVisible })}
                  className={cn(
                    "rounded border px-2 py-0.5 text-[10px] font-medium transition-colors",
                    comparisonVisible
                      ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {comparisonVisible ? "B&H ✓" : "vs B&H"}
                </button>
              )}
              {/* Trade filter pills */}
              <div className="ml-auto flex items-center gap-1">
                {(["all", "winning", "losing"] as TradeFilter[]).map(f => (
                  <button key={f} onClick={() => setTradeFilter(f)}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                      tradeFilter === f
                        ? f === "winning" ? "bg-bull/20 text-bull"
                          : f === "losing" ? "bg-bear/20 text-bear"
                          : "bg-primary/20 text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {f === "all" ? "All" : f === "winning" ? "Winning ✓" : "Losing ✗"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Compact stats strip — quick summary without full panel */}
          {capitalStats && (
            <div className="flex items-center gap-4 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">Win Rate</span>
              <span className={cn("font-mono font-medium", capitalStats.winRate >= 50 ? "text-bull" : "text-bear")}>
                {capitalStats.winRate.toFixed(1)}%
              </span>
              <span className="text-border">|</span>
              <span className="text-muted-foreground">Total PnL</span>
              <span className={cn("font-mono font-medium", capitalStats.totalPnl >= 0 ? "text-bull" : "text-bear")}>
                {capitalStats.totalPnl >= 0 ? "+" : ""}${Math.abs(capitalStats.totalPnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-border">|</span>
              <span className="text-muted-foreground">ROC</span>
              <span className={cn("font-mono font-medium", capitalStats.returnOnCapital >= 0 ? "text-bull" : "text-bear")}>
                {capitalStats.returnOnCapital >= 0 ? "+" : ""}{capitalStats.returnOnCapital.toFixed(2)}%
              </span>
              <span className="text-border">|</span>
              <span className="text-muted-foreground">Trades</span>
              <span className="font-mono font-medium">{capitalStats.totalTrades}</span>
              {capitalStats.insufficientCapitalCount > 0 && (
                <>
                  <span className="text-border">|</span>
                  <span className="text-neutral">{capitalStats.insufficientCapitalCount} skipped (cap)</span>
                </>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground/60">
                Full stats in Results tab →
              </span>
            </div>
          )}

          {/* Chart + trade log */}
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_260px] gap-3">
            <div className="flex overflow-hidden rounded-md border border-border bg-card">
              {stratBars.length === 0 ? (
                <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">
                  {!selectedStrategy
                    ? "Select a strategy to view results."
                    : "Pick a symbol and date range, then click Run."}
                </div>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <BacktestingChart
                      bars={stratBars}
                      visibleCount={stratVisibleCount}
                      trades={strategyChartTrades}
                      onRangeChange={handleRangeChange}
                      visibleRange={visibleRange ?? undefined}
                    />
                  </div>
                  {stratVisibleCount > 0 && visibleRange && (
                    <ChartScrollbar
                      totalBars={stratVisibleCount}
                      from={visibleRange.from}
                      to={visibleRange.to}
                      onRangeChange={(f, t) => setVisibleRange({ from: f, to: t })}
                    />
                  )}
                </>
              )}
            </div>
            <StrategyTradeLog trades={stratVisibleTrades} filter={tradeFilter} />
          </div>

          {!selectedStrategy && (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Select a strategy above to get started.
            </div>
          )}
        </>
      )}

      {/* ══ RESULTS TAB ═══════════════════════════════════════════════════════ */}
      {activeTab === "results" && (
        <RunHistory
          runHistory={runHistory}
          selectedRecordId={selectedRecordId}
          onSelectRecord={setSelectedRecordId}
          onClearHistory={() => { setRunHistory([]); setSelectedRecordId(null); }}
          onLoadRecord={loadRecord}
        />
      )}

      {/* ══ MODELS TAB ════════════════════════════════════════════════════════ */}
      {activeTab === "models" && <HermesModelPanel />}
    </div>
  );
}

// ── Sub-components moved to src/components/backtesting/ ──────────────────────
