import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { normalizeSymbols, symbolsApi } from "@/lib/api/symbols";
import { strategiesApi, type BacktestResults } from "@/lib/api/strategies";
import { buildUtcApiRange, getPresetRange } from "@/lib/date-range";
import { fmtSize } from "@/lib/format";
import { PanelState } from "@/components/terminal/PanelState";
import { TerminalTable } from "@/components/terminal/table/TerminalTable";
import { DensityProvider } from "@/components/terminal/table/density";
import { SegmentedControl } from "@/components/terminal/controls/SegmentedControl";
import { UNIVERSE_COLUMNS, type UniverseRow } from "@/components/terminal/table/presets/universe";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * B2 universe / symbol ranking (build doc §15.2, plan §4.2).
 *
 * "Which symbols does this strategy work on" is answered by actually running
 * it: `POST /api/strategies/{name}/run` backtests one symbol over a window
 * without saving, so ranking the universe is N of those. They are fired
 * through a rolling window of MAX_IN_FLIGHT rather than all at once — a
 * hundred symbols would otherwise land on the backend simultaneously, and the
 * table is more useful filling in progressively than appearing all at once
 * three minutes later.
 *
 * Every run is cached under its own key including the window, so re-ranking
 * the same strategy/date range is free and switching back and forth costs
 * nothing.
 */

const MAX_IN_FLIGHT = 4;

const RANGE_OPTIONS = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "1Y", label: "1Y" },
] as const;

type RangeKey = (typeof RANGE_OPTIONS)[number]["value"];

function equityPoints(results: BacktestResults | undefined): number[] {
  if (!results?.equityCurve?.length) return [];
  const points = results.equityCurve.map((p) => p.cumulative_pnl);
  if (points.length <= 64) return points;
  const step = points.length / 64;
  return Array.from(
    { length: 64 },
    (_, i) => points[Math.min(points.length - 1, Math.round(i * step))],
  );
}

export function UniversePanel({ strategy: initialStrategy }: { strategy: string | null }) {
  const [strategy, setStrategy] = useState<string | null>(initialStrategy);
  const [range, setRange] = useState<RangeKey>("3M");
  const [ranked, setRanked] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const strategiesQ = useQuery({
    queryKey: ["strategies"],
    queryFn: strategiesApi.list,
    retry: false,
  });
  const symbolsQ = useQuery({ queryKey: ["symbols"], queryFn: symbolsApi.list, retry: false });
  const symbols = useMemo(() => normalizeSymbols(symbolsQ.data), [symbolsQ.data]);

  const { from, to } = useMemo(() => {
    const preset = getPresetRange(range);
    return buildUtcApiRange(preset.startDate, preset.endDate);
  }, [range]);

  // Rolling window: a query is only enabled once `settled` has advanced far
  // enough to reach it, so at most MAX_IN_FLIGHT runs are ever outstanding.
  // `settled` trails the results by one render — which is exactly the point at
  // which the next run should start anyway.
  const [settled, setSettled] = useState(0);

  const gatedQs = useQueries({
    queries: symbols.map((symbol, i) => ({
      queryKey: ["universe-run", strategy, symbol, from, to],
      queryFn: () => strategiesApi.run(strategy!, symbol, from, to),
      enabled: ranked && !!strategy && i < settled + MAX_IN_FLIGHT,
      retry: false,
      staleTime: Infinity,
      gcTime: 10 * 60_000,
    })),
  });

  const settledNow = gatedQs.filter((q) => q.isSuccess || q.isError).length;
  useEffect(() => {
    // Also resets to 0 when the strategy or window changes: new query keys
    // mean nothing is settled, which restarts the window from the top.
    if (settledNow !== settled) setSettled(settledNow);
  }, [settledNow, settled]);

  // Status flags + data timestamps are the only parts of the query array the
  // rows depend on; joining them gives a fixed-length dependency.
  const runKey = gatedQs.map((q) => `${q.status}:${q.fetchStatus}:${q.dataUpdatedAt}`).join("|");

  const rows = useMemo<UniverseRow[]>(
    () =>
      symbols.map((symbol, i) => {
        const q = gatedQs[i];
        const results = q?.data;
        const status: UniverseRow["status"] = !ranked
          ? "idle"
          : q?.isError
            ? "failed"
            : q?.isSuccess
              ? "done"
              : q?.isFetching
                ? "running"
                : "queued";
        return {
          symbol,
          status,
          sharpe: results?.sharpeRatio ?? null,
          returnPct: results?.totalPnlPct ?? null,
          maxDrawdownPct: results?.maxDrawdown ?? null,
          winRatePct: results?.winRate ?? null,
          trades: results?.totalTrades ?? null,
          equity: equityPoints(results),
        };
      }),
    // gatedQs is a new array every render; runKey covers the parts that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbols, ranked, runKey],
  );

  const getRowId = useCallback((r: UniverseRow) => r.symbol, []);
  const doneCount = gatedQs.filter((q) => q.isSuccess).length;

  const promote = () => {
    // B6 (the deploy panel) is not scheduled in this build doc and the deploy
    // API does not exist, so the promotion names the endpoint it is waiting on
    // instead of pretending to have written somewhere (D5 pending pattern).
    toast.info(`${selected.size} symbol${selected.size === 1 ? "" : "s"} ready to promote`, {
      description: "Waiting on POST /api/deploy — the deploy panel (plan B6) is not built yet.",
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end gap-3 border-b border-border-subtle bg-surface-2/40 px-3 py-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-text-muted">Strategy</label>
          <Select
            value={strategy ?? ""}
            onValueChange={(v) => {
              setStrategy(v || null);
              setRanked(false);
            }}
          >
            <SelectTrigger className="h-8 w-52 text-xs">
              <SelectValue placeholder="Select a strategy…" />
            </SelectTrigger>
            <SelectContent>
              {(strategiesQ.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.name} className="text-xs">
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-text-muted">Window</label>
          <SegmentedControl
            ariaLabel="Ranking window"
            options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={range}
            onValueChange={(v) => {
              setRange(v as RangeKey);
              setRanked(false);
            }}
          />
        </div>

        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={!strategy || symbols.length === 0}
          onClick={() => setRanked(true)}
          data-testid="rank-universe"
        >
          {ranked ? "Re-rank" : `Rank ${fmtSize(symbols.length)} symbols`}
        </Button>

        {ranked && (
          <span className="text-[11px] tabular text-text-muted" data-testid="rank-progress">
            {fmtSize(doneCount)} / {fmtSize(symbols.length)} complete
          </span>
        )}
      </div>

      <DensityProvider density="compact">
        <TerminalTable
          rows={rows}
          columns={UNIVERSE_COLUMNS}
          getRowId={getRowId}
          selected={selected}
          onSelectedChange={setSelected}
          initialSorting={[{ id: "sharpe", desc: true }]}
          className="min-h-0 flex-1"
          empty={
            <PanelState
              kind="empty"
              art="search"
              message="No symbols tracked yet — add one on the Data page."
              action={{ label: "Go to Data →", href: "/data" }}
            />
          }
        />
      </DensityProvider>

      {/* Sticky promote footer — appears only with a selection (plan §4.2). */}
      {selected.size > 0 && (
        <div
          data-testid="promote-footer"
          className="flex shrink-0 items-center justify-between border-t border-accent-blue/30 bg-surface-2 px-3 py-2"
        >
          <span className="text-xs text-text-secondary">
            <span className="tabular font-medium text-text-primary">{selected.size}</span> symbol
            {selected.size === 1 ? "" : "s"} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-[11px] text-text-muted hover:text-text-primary"
            >
              Clear
            </button>
            <Button size="sm" className="h-7 text-xs" onClick={promote}>
              Promote {selected.size} to deploy list →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
