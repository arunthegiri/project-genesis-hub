import { useCallback, useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import { liveApi } from "@/lib/api/live";
import { strategiesApi, type BacktestResults, type StrategyDetail } from "@/lib/api/strategies";
import { PanelState } from "@/components/terminal/PanelState";
import { TerminalTable } from "@/components/terminal/table/TerminalTable";
import { DensityProvider } from "@/components/terminal/table/density";
import {
  STRATEGY_COLUMNS,
  type StrategyRow,
  type StrategySource,
} from "@/components/terminal/table/presets/strategies";

/**
 * B1 strategy table (build doc §15.2) — the panel that feeds the preset.
 *
 * Data shape note (the one real gap): `GET /api/strategies` returns
 * `{id, name, description, createdAt}` and no metrics at all, so Sharpe /
 * return / drawdown come from `GET /api/strategies/{name}`, whose
 * `latestResults` block carries the full BacktestResults. That is an N+1, and
 * it is the honest one: N is the number of strategies a person has exported
 * (single digits), every response is cached under the SAME `["strategy", name]`
 * key /backtesting already uses, and the alternative — inventing summary fields
 * the backend does not serve — would be a table that lies. When the list
 * endpoint grows metrics, delete the useQueries block and nothing else.
 */

interface Props {
  selected: string | null;
  onSelect: (name: string | null) => void;
}

/**
 * Source badge. The backend has no `source` field, so it is read out of the
 * strategy definition, which does record how the thing was produced. A
 * heuristic in one place beats a heuristic scattered across cells; when the
 * DTO grows the field, this function becomes one property read.
 */
function inferSource(definition: Record<string, unknown> | undefined): StrategySource {
  if (!definition) return "Python SDK";
  const type = String(definition.type ?? definition.strategy_type ?? "").toLowerCase();
  if (type.includes("onnx") || definition.onnx_path || definition.model_path) return "ONNX";
  if (type.includes("cpp") || type.includes("hermes") || definition.engine === "hermes") {
    return "C++";
  }
  return "Python SDK";
}

function symbolsOf(detail: StrategyDetail | undefined, results: BacktestResults | null): string[] {
  const fromDefinition = detail?.definition?.symbols;
  if (Array.isArray(fromDefinition)) return fromDefinition.map(String);
  const single = detail?.definition?.symbol ?? results?.symbol;
  return single ? [String(single)] : [];
}

/** Cumulative-PnL curve → sparkline points. Empty curve → empty sparkline. */
function equityPoints(results: BacktestResults | null): number[] {
  if (!results?.equityCurve?.length) return [];
  const points = results.equityCurve.map((p) => p.cumulative_pnl);
  // A sparkline is 64px wide; more than ~64 points is invisible detail that
  // still costs an array compare per row per parent render (§8.1 cellsEqual).
  if (points.length <= 64) return points;
  const step = points.length / 64;
  return Array.from(
    { length: 64 },
    (_, i) => points[Math.min(points.length - 1, Math.round(i * step))],
  );
}

export function StrategiesPanel({ selected, onSelect }: Props) {
  const listQ = useQuery({
    queryKey: ["strategies"],
    queryFn: strategiesApi.list,
    retry: false,
  });

  const names = useMemo(() => (listQ.data ?? []).map((s) => s.name), [listQ.data]);

  const detailQs = useQueries({
    queries: names.map((name) => ({
      queryKey: ["strategy", name],
      queryFn: () => strategiesApi.get(name),
      retry: false,
      staleTime: 60_000,
    })),
  });

  const activeQ = useQuery({
    queryKey: ["live", "activeStrategies"],
    queryFn: liveApi.activeStrategies,
    retry: false,
  });

  // Structural sharing keeps settled query data referentially stable, so a
  // dataUpdatedAt join is a fixed-length dependency (the same trick ChartPanel
  // uses for compare series).
  const detailKey = detailQs.map((q) => q.dataUpdatedAt).join("|");

  const rows = useMemo<StrategyRow[]>(() => {
    // Mode comes from the deployment record, and ONLY from a real deployMode:
    // a STANDBY strategy with no deployMode has been loaded, not deployed, and
    // labelling that "PAPER" would claim it is trading something.
    const modeByName = new Map<string, "paper" | "live">();
    for (const a of activeQ.data ?? []) {
      const mode = (a.deployMode ?? "").toLowerCase();
      if (mode === "live") modeByName.set(a.name, "live");
      else if (mode === "paper") modeByName.set(a.name, "paper");
    }
    return names.map((name, i) => {
      const detail = detailQs[i]?.data as StrategyDetail | undefined;
      const results = detail?.latestResults ?? null;
      return {
        name,
        source: inferSource(detail?.definition),
        mode: modeByName.get(name) ?? "backtest",
        symbols: symbolsOf(detail, results),
        sharpe: results?.sharpeRatio ?? null,
        returnPct: results?.totalPnlPct ?? null,
        maxDrawdownPct: results?.maxDrawdown ?? null,
        winRatePct: results?.winRate ?? null,
        trades: results?.totalTrades ?? null,
        lastRun: results?.createdAt ?? null,
        equity: equityPoints(results),
      };
    });
    // detailKey stands in for the detail query array (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, detailKey, activeQ.data]);

  const getRowId = useCallback((r: StrategyRow) => r.name, []);
  const selection = useMemo(() => new Set(selected ? [selected] : []), [selected]);
  const handleSelection = useCallback(
    (next: Set<string>) => onSelect(next.size ? [...next][0] : null),
    [onSelect],
  );

  if (listQ.isError) {
    return (
      <PanelState
        kind="pending"
        art="plug"
        message="The strategy list endpoint is not answering."
        detail={["GET /api/strategies", "GET /api/strategies/{name}"]}
      />
    );
  }

  if (!listQ.isFetched) {
    return <PanelState kind="loading" art="table" message="Loading strategies…" />;
  }

  return (
    <DensityProvider density="default">
      <TerminalTable
        rows={rows}
        columns={STRATEGY_COLUMNS}
        getRowId={getRowId}
        selected={selection}
        onSelectedChange={handleSelection}
        initialSorting={[{ id: "sharpe", desc: true }]}
        empty={
          <PanelState
            kind="empty"
            art="chart"
            message="No strategies exported yet."
            action={{ label: "Run your first backtest →", href: "/backtesting" }}
          />
        }
      />
    </DensityProvider>
  );
}
