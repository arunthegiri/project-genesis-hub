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
import { TradeLog, StrategyTradeLog, type TradeFilter } from "@/components/backtesting/TradeLog";
import { TerminalPanel, type PanelTab } from "@/components/terminal/TerminalPanel";
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
import { SegmentedControl } from "@/components/terminal/controls/SegmentedControl";
import { UnitInput } from "@/components/terminal/controls/UnitInput";
import { QuickFillRow } from "@/components/terminal/controls/QuickFillRow";
import { pricesApi } from "@/lib/api/prices";
import { symbolsApi, normalizeSymbols } from "@/lib/api/symbols";
import { strategiesApi } from "@/lib/api/strategies";
import { tradesApi, type TradesResult } from "@/lib/api/trades";
import type { BacktestTrade, BacktestResults } from "@/lib/api/strategies";
import type { PriceBar, Trade } from "@/lib/api/types";
import { applyCapitalConstraints, calcBuyHold } from "@/lib/backtest-capital";
import { BACKTESTING_UI_COOKIE, readUiCookieJson, writeUiCookie } from "@/lib/cookie-state";
import { fmtPct, fmtPnl, fmtPrice, fmtSize } from "@/lib/format";
import { useRafCoalescer } from "@/hooks/useRafCoalescer";
import { cn } from "@/lib/utils";

const SPEEDS = [0.5, 1, 2, 5, 10, 25, 50] as const;
type Speed = (typeof SPEEDS)[number];
// W7: replay speed is a SegmentedControl (build doc §9) — enumerated, so no Select.
const SPEED_OPTIONS = SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }));
const CAPITAL_PRESETS = [
  { label: "1k", value: 1_000 },
  { label: "10k", value: 10_000 },
  { label: "100k", value: 100_000 },
  { label: "1M", value: 1_000_000 },
] as const;
type Tab = "data" | "strategies" | "results" | "models";
const TABS: Tab[] = ["data", "strategies", "results", "models"];

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

// §12 M3: cursor = absolute bar index (never a timestamp, so it survives zoom
// and interval changes). Omitted from the URL at the default (-1 = live end).
function parseCursor(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return isFinite(n) ? Math.max(0, Math.floor(n)) : undefined;
}

// §12 M3: view = "from.to" — two logical-index floats fixed to 2dp and joined
// by a dot ("10.50.20.75"). Logical indices are what getVisibleLogicalRange
// already speaks, so restore needs no time→index mapping.
function parseView(v: unknown): { from: number; to: number } | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.match(/^(-?\d+(?:\.\d+)?)\.(-?\d+(?:\.\d+)?)$/);
  if (!m) return undefined;
  const from = Number(m[1]);
  const to = Number(m[2]);
  return isFinite(from) && isFinite(to) && to > from ? { from, to } : undefined;
}

export const Route = createFileRoute("/backtesting")({
  validateSearch: (search: Record<string, unknown>) => ({
    symbol:            (search.symbol  as string | undefined) ?? "",
    from:              (search.from    as string | undefined) ?? defaultFrom(),
    to:                (search.to      as string | undefined) ?? defaultTo(),
    speed:             (Number(search.speed ?? 1)) as Speed,
    loaded:            search.loaded === "true" || search.loaded === true,
    startingCapital:   clampCapital(Number(search.startingCapital ?? DEFAULT_CAPITAL)),
    comparisonVisible: search.comparisonVisible !== false && search.comparisonVisible !== "false",
    // §4.2: the main tab is location-like state — a shared link lands on it.
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : ("data" as Tab),
    // §12 M3 replay state — additive, all optional, all omitted when default.
    cursor:            parseCursor(search.cursor),
    view:              typeof search.view === "string" && parseView(search.view) ? search.view : undefined,
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

  // Last loaded replay config survives reloads via the ui.backtesting cookie
  // (arrangement → cookie, §13); the URL stays the source of truth once set.
  useEffect(() => {
    if (!search.loaded || !search.symbol) {
      const restored = readUiCookieJson<typeof search>(BACKTESTING_UI_COOKIE);
      if (restored?.loaded && restored.symbol) navigate({ search: restored, replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Tab state — location-like, lives in the URL (§4.2); writes replace. ────
  const activeTab = search.tab;
  const setActiveTab = useCallback((tab: Tab) => setSearch({ tab }), [setSearch]);

  // ── Symbols ──────────────────────────────────────────────────────────────────
  const { data: rawSymbols } = useQuery({ queryKey: ["symbols"], queryFn: symbolsApi.list });
  const symbols = normalizeSymbols(rawSymbols);

  const { symbol, from, to, speed, loaded, startingCapital, comparisonVisible } = search;

  // ── Capital input local display state (formatted string) ─────────────────────
  const [capitalRaw, setCapitalRaw] = useState(() => startingCapital.toLocaleString("en-US"));
  useEffect(() => { setCapitalRaw(startingCapital.toLocaleString("en-US")); }, [startingCapital]);

  // W7: UnitInput owns the input; its onChange passes the raw string (no event).
  const handleCapitalChange = (value: string) => {
    const raw = value.replace(/[^0-9,]/g, "");
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

  // Unfiltered counts for the TradeLog UnderlineTabs (in-label counts, §4.1).
  const tradeCounts = useMemo(
    () => ({
      all: allStratTrades.length,
      winning: allStratTrades.filter((t) => t.win === true).length,
      losing: allStratTrades.filter((t) => t.win === false).length,
    }),
    [allStratTrades],
  );

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
  }, [setActiveTab]);

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
  // §12 M3: the same rAF flush mirrors the cursor into the URL (`cursor` is an
  // absolute bar index; -1 = live end = param omitted). One history REPLACEMENT
  // per frame at most — playback never pushes.
  const initialCursor = search.loaded && search.cursor != null ? search.cursor : -1;
  const [currentIdx, setCurrentIdx] = useState(initialCursor);
  const [playing, setPlaying]       = useState(false);
  const [jumpTo, setJumpTo]         = useState("");

  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevDataKey = useRef("");
  const cursorRef   = useRef(initialCursor);
  const flushCursor = useRafCoalescer<number>((v) => {
    setCurrentIdx(v);
    setSearch({ cursor: v >= 0 ? v : undefined });
  });
  const setCursor   = useCallback((v: number) => {
    cursorRef.current = v;
    flushCursor(v);
  }, [flushCursor]);

  useEffect(() => {
    const key = `${selectedSymbol}|${fromIso}|${toIso}`;
    // Mount: adopt the key WITHOUT resetting — a §12 URL-restored cursor
    // (?loaded=true&cursor=N) must survive the first data load.
    if (prevDataKey.current === "") { prevDataKey.current = key; return; }
    if (key !== prevDataKey.current && loaded) {
      setCursor(-1);
      setPlaying(false);
      prevDataKey.current = key;
    }
  }, [selectedSymbol, fromIso, toIso, loaded, setCursor]);

  // §12 guard: a cursor beyond the (re)loaded dataset clamps to the last bar.
  useEffect(() => {
    if (loaded && allBars.length > 0 && currentIdx >= allBars.length) {
      setCursor(allBars.length - 1);
    }
  }, [loaded, allBars.length, currentIdx, setCursor]);

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
    // A fresh run starts at the live end at fit-content — stale replay params
    // from a previous run must not leak into the new URL.
    setSearch({ ...next, cursor: undefined, view: undefined });
    writeUiCookie(BACKTESTING_UI_COOKIE, JSON.stringify(next));
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

  // §12 M3: view mirrors to the URL debounced 300 ms, replace-only. Omitted at
  // the fit-content default (range covers the loaded window). Playback's
  // per-tick scrollToPosition is not a user pan/zoom — suppressed while playing.
  const viewTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playingRef       = useRef(playing);
  // "Fit-content default" is judged against the FULL loaded window, not the
  // replay cursor's visibleCount — a paused mid-replay window (e.g. from -5 to
  // 120 on 500 bars) is a real view worth restoring, not the default.
  const barCountRef      = useRef(allBars.length);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { barCountRef.current = allBars.length; }, [allBars.length]);

  const writeViewParam = useCallback(
    (range: { from: number; to: number } | null) => {
      if (viewTimerRef.current) clearTimeout(viewTimerRef.current);
      viewTimerRef.current = setTimeout(() => {
        if (range === null) { setSearch({ view: undefined }); return; }
        const last = Math.max(0, barCountRef.current - 1);
        const isFull = range.from <= 0.75 && range.to >= last - 0.75;
        setSearch({ view: isFull ? undefined : `${range.from.toFixed(2)}.${range.to.toFixed(2)}` });
      }, 300);
    },
    [setSearch],
  );

  const handleRangeChange = useCallback(
    (f: number, t: number) => {
      setVisibleRange({ from: f, to: t });
      if (!playingRef.current) writeViewParam({ from: f, to: t });
    },
    [writeViewParam],
  );

  // Reset visible range when switching tabs so chart re-fits (skip the mount
  // run — that would clear a §12 URL view before the restore effect applies it).
  const tabMountedRef = useRef(false);
  useEffect(() => {
    if (!tabMountedRef.current) { tabMountedRef.current = true; return; }
    setVisibleRange(null);
    writeViewParam(null);
  }, [activeTab, writeViewParam]);

  // §12 M3 restore: the URL view flows to the chart as initialRange — applied
  // imperatively in the series-data effect INSTEAD of fitContent when a fresh
  // dataset lands. Routing it through visibleRange state loses a race against
  // the mount/StrictMode range events, which would overwrite the restored
  // value before the chart ever applies it.
  const initialView = parseView(search.view) ?? null;

  // ── Render ────────────────────────────────────────────────────────────────────
  // §4.2: the Data/Strategies/Results/Models tab block is a TerminalPanel with
  // PanelTabs; the active tab is URL state (validateSearch), so a shared link
  // lands on the right tab and switches replace history instead of pushing.
  const panelTabs: PanelTab[] = [
    { id: "data", label: "Data" },
    { id: "strategies", label: "Strategies" },
    { id: "results", label: "Results", count: runHistory.length || undefined },
    { id: "models", label: "Models" },
  ];

  // Strategies tab pans are LOCAL only — §12 URL replay state is scoped to the
  // Data-tab run (its restore path is the loaded=true flow; the restore key is
  // the Data-tab symbol/range, so a strat-dataset range would never apply).
  const handleStratRangeChange = useCallback(
    (f: number, t: number) => setVisibleRange({ from: f, to: t }),
    [],
  );

  return (
    <TerminalPanel
      tabs={panelTabs}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as Tab)}
      className="h-full"
      bodyClassName="gap-3 overflow-hidden p-3"
    >
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
              <SegmentedControl
                ariaLabel="Replay speed"
                options={SPEED_OPTIONS}
                value={String(speed)}
                onValueChange={(v) => setSearch({ speed: Number(v) as Speed })}
              />
            </div>
            <Button size="sm" onClick={handleLoad} className="h-8 self-end text-xs">Load</Button>
            {loaded && allBars.length > 0 && (
              <div className="ml-auto flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Restart replay" onClick={restart}><RotateCcw className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Step back" onClick={stepBack}><ChevronLeft className="h-4 w-4" /></Button>
                <Button size="icon" variant="default" className="h-8 w-8" aria-label={playing ? "Pause replay" : "Play replay"} onClick={togglePlay}>
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Step forward" onClick={stepForward}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            )}
          </div>

          {/* Status / jump row */}
          {loaded && allBars.length > 0 && (
            <div className="flex flex-wrap items-center gap-4 px-1 text-xs text-muted-foreground">
              <span className="font-mono text-foreground">{currentTime ? formatTs(currentTime) : "—"}</span>
              <span className="tabular-nums">Bar {fmtSize(resolvedIdx + 1)} / {fmtSize(allBars.length)}</span>
              {currentBar && (
                <span className="font-mono">
                  O {fmtPrice(currentBar.open)} H {fmtPrice(currentBar.high)}{" "}
                  L {fmtPrice(currentBar.low)} C {fmtPrice(currentBar.close)}
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
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_280px] gap-3">
            <div className="flex overflow-hidden rounded-md border border-border bg-card">
              {!loaded || allBars.length === 0 ? (
                <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">
                  {!loaded ? "Select a symbol and date range, then click Load." : "Loading data…"}
                </div>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <BacktestingChart bars={allBars} visibleCount={visibleCount} trades={visibleTrades}
                      onRangeChange={handleRangeChange} visibleRange={visibleRange ?? undefined} initialRange={initialView} />
                  </div>
                  {/* §12 M3: the scrollbar mounts WITH the chart (not gated on
                      the first range event) so its width is already priced into
                      the geometry when a URL view restores — a late mount would
                      resize the pane and clobber the restored range. */}
                  {visibleCount > 0 && (
                    <ChartScrollbar totalBars={visibleCount} from={visibleRange?.from ?? 0} to={visibleRange?.to ?? visibleCount - 1}
                      onRangeChange={(f, t) => { setVisibleRange({ from: f, to: t }); writeViewParam({ from: f, to: t }); }} />
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
              <SegmentedControl
                ariaLabel="Replay speed"
                options={SPEED_OPTIONS}
                value={String(speed)}
                onValueChange={(v) => setSearch({ speed: Number(v) as Speed })}
              />
            </div>

            {/* Starting capital — W7 UnitInput + QuickFillRow presets (§9) */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Starting Capital</label>
              <UnitInput
                ariaLabel="Starting capital"
                prefix="$"
                value={capitalRaw}
                onChange={handleCapitalChange}
                onBlur={handleCapitalBlur}
                inputClassName="w-32"
              />
              <QuickFillRow
                ariaLabel="Capital presets"
                presets={CAPITAL_PRESETS}
                onFill={(v) => setSearch({ startingCapital: v })}
              />
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
              <span className="tabular-nums">Bar {fmtSize(stratResolvedIdx + 1)} / {fmtSize(stratBars.length)}</span>
              {stratBars[stratResolvedIdx] && (
                <span className="font-mono">
                  C {fmtPrice(stratBars[stratResolvedIdx].close)}
                </span>
              )}
              <span className={cn("font-mono font-semibold", stratRunningPnl >= 0 ? "text-bull" : "text-bear")}>
                P&L {fmtPnl(stratRunningPnl)}
              </span>
              <span className="text-muted-foreground/60 tabular-nums">{fmtSize(stratVisibleTrades.length)} trades completed</span>
            </div>
          )}

          {/* Error banner */}
          {runError && (
            <div className="rounded-md border border-bear/30 bg-bear/10 px-3 py-2 text-xs text-bear">
              {runError.includes("cannot be re-run") || runError.includes("type")
                ? <>Strategy needs re-exporting. Open <code className="bg-bear/20 px-1 rounded">rsi_strategy.ipynb</code>, re-run all cells, then run the updated export cell with <code className="bg-bear/20 px-1 rounded">params=</code>.</>
                : runError}
            </div>
          )}

          {/* Run source badge */}
          {activeResults && (
            <div className="flex items-center gap-2 px-1">
              <span className={cn("rounded px-2 py-0.5 text-[10px] font-medium border",
                runResults
                  ? "bg-accent-blue/20 text-accent-blue border-accent-blue/30"
                  : "bg-muted/50 text-muted-foreground border-border"
              )}>
                {runResults ? `Live run · ${activeResults.symbol ?? stratSymbol}` : `Stored · ${activeResults.symbol ?? "original"}`}
              </span>
              {activeResults && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {fmtSize(activeResults.totalTrades)} trades · Win {fmtPct(Number(activeResults.winRate ?? 0), { plus: false })}
                </span>
              )}
              {buyHold && (
                <button
                  onClick={() => setSearch({ comparisonVisible: !comparisonVisible })}
                  className={cn(
                    "rounded border px-2 py-0.5 text-[10px] font-medium transition-colors",
                    comparisonVisible
                      ? "border-warning/40 bg-warning/10 text-warning"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {comparisonVisible ? "B&H ✓" : "vs B&H"}
                </button>
              )}
            </div>
          )}

          {/* Compact stats strip — quick summary without full panel */}
          {capitalStats && (
            <div className="flex items-center gap-4 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">Win Rate</span>
              <span className={cn("font-mono font-medium", capitalStats.winRate >= 50 ? "text-bull" : "text-bear")}>
                {fmtPct(capitalStats.winRate, { plus: false })}
              </span>
              <span className="text-border">|</span>
              <span className="text-muted-foreground">Total PnL</span>
              <span className={cn("font-mono font-medium", capitalStats.totalPnl >= 0 ? "text-bull" : "text-bear")}>
                {fmtPnl(capitalStats.totalPnl)}
              </span>
              <span className="text-border">|</span>
              <span className="text-muted-foreground">ROC</span>
              <span className={cn("font-mono font-medium", capitalStats.returnOnCapital >= 0 ? "text-bull" : "text-bear")}>
                {fmtPct(capitalStats.returnOnCapital)}
              </span>
              <span className="text-border">|</span>
              <span className="text-muted-foreground">Trades</span>
              <span className="font-mono font-medium">{fmtSize(capitalStats.totalTrades)}</span>
              {capitalStats.insufficientCapitalCount > 0 && (
                <>
                  <span className="text-border">|</span>
                  <span className="text-warning">{capitalStats.insufficientCapitalCount} skipped (cap)</span>
                </>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground/60">
                Full stats in Results tab →
              </span>
            </div>
          )}

          {/* Chart + trade log */}
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_280px] gap-3">
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
                      onRangeChange={handleStratRangeChange}
                      visibleRange={visibleRange ?? undefined}
                    />
                  </div>
                  {stratVisibleCount > 0 && (
                    <ChartScrollbar
                      totalBars={stratVisibleCount}
                      from={visibleRange?.from ?? 0}
                      to={visibleRange?.to ?? stratVisibleCount - 1}
                      onRangeChange={(f, t) => setVisibleRange({ from: f, to: t })}
                    />
                  )}
                </>
              )}
            </div>
            <StrategyTradeLog
              trades={stratVisibleTrades}
              filter={tradeFilter}
              counts={tradeCounts}
              onFilterChange={setTradeFilter}
            />
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
    </TerminalPanel>
  );
}

// ── Sub-components moved to src/components/backtesting/ ──────────────────────
