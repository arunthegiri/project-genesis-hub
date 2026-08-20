import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";

import { normalizeSymbols, symbolsApi } from "@/lib/api/symbols";
import { pricesApi } from "@/lib/api/prices";
import { buildUtcApiRange, getPresetRange } from "@/lib/date-range";
import { correlationMatrix } from "@/lib/correlation";
import { CorrelationMatrix } from "@/components/terminal/CorrelationMatrix";
import { PanelState } from "@/components/terminal/PanelState";
import { SegmentedControl } from "@/components/terminal/controls/SegmentedControl";

/**
 * B4 correlation panel (build doc §15.1) — fetches the window, computes the
 * matrix once, hands it to the canvas.
 *
 * The matrix is O(symbols²) Pearson runs over the aligned return series, and
 * it is memoised on the data, so panning between tabs repaints without
 * recomputing. MAX_SYMBOLS caps the grid at a size a human can actually read;
 * past that the answer belongs in a ranked list, not a wall of squares.
 */

const MAX_SYMBOLS = 16;

const RANGE_OPTIONS = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
] as const;

type RangeKey = (typeof RANGE_OPTIONS)[number]["value"];

export function CorrelationPanel() {
  const navigate = useNavigate();
  const [range, setRange] = useState<RangeKey>("3M");

  const symbolsQ = useQuery({ queryKey: ["symbols"], queryFn: symbolsApi.list, retry: false });
  const symbols = useMemo(
    () => normalizeSymbols(symbolsQ.data).slice(0, MAX_SYMBOLS),
    [symbolsQ.data],
  );

  const { from, to } = useMemo(() => {
    const preset = getPresetRange(range);
    return buildUtcApiRange(preset.startDate, preset.endDate);
  }, [range]);

  const barQs = useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ["correlation-bars", symbol, from, to],
      queryFn: () => pricesApi.range(symbol, from, to),
      retry: false,
      staleTime: 5 * 60_000,
    })),
  });

  const dataKey = barQs.map((q) => q.dataUpdatedAt).join("|");
  const loaded = barQs.length > 0 && barQs.every((q) => q.isFetched);

  const matrix = useMemo(
    () => correlationMatrix(barQs.map((q) => q.data ?? [])),
    // dataKey stands in for the query array (structural sharing keeps settled
    // data referentially stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataKey],
  );

  if (symbolsQ.isFetched && symbols.length < 2) {
    return (
      <PanelState
        kind="empty"
        art="search"
        message="Correlation needs at least two tracked symbols."
        action={{ label: "Add symbols on Data →", href: "/data" }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border-subtle bg-surface-2/40 px-3 py-2">
        <span className="text-[10px] uppercase tracking-wider text-text-muted">Window</span>
        <SegmentedControl
          ariaLabel="Correlation window"
          options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          value={range}
          onValueChange={(v) => setRange(v as RangeKey)}
        />
        <span className="ml-auto text-[11px] text-text-muted">
          Log-return correlation · click a cell to chart the pair
        </span>
      </div>

      {!loaded ? (
        <PanelState kind="loading" art="chart" message="Loading price history…" />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <CorrelationMatrix
            symbols={symbols}
            matrix={matrix}
            // Drill-through into the charts page's existing ?symbols= param —
            // two panels, the pair side by side (§18 URL-as-state).
            onSelectPair={(a, b) =>
              navigate({ to: "/", search: { symbols: a === b ? a : `${a},${b}` } })
            }
          />
        </div>
      )}
    </div>
  );
}
