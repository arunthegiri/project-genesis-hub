import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { strategiesApi } from "@/lib/api/strategies";
import { pnlByDayOfWeek, pnlByHourOfDay, pnlByOutcome } from "@/lib/pnl-distribution";
import { PanelState } from "@/components/terminal/PanelState";
import { PnlDistribution } from "@/components/terminal/PnlDistribution";
import { UnderlineTabs } from "@/components/terminal/UnderlineTabs";

/**
 * B9 PnL distributions (build doc §15.4) — three bindings over the selected
 * strategy's latest stored run, switched by in-body filter tabs (§4.1 variant
 * 2, the same chrome the trade log uses for All/Winning/Losing).
 *
 * The trades come from the SAME `["strategy", name]` cache the strategy table
 * fills, so selecting a row on the Strategies tab and switching here costs no
 * request at all.
 */

type Binding = "time" | "day" | "outcome";

const TABS = [
  { id: "time", label: "Time of day" },
  { id: "day", label: "Day of week" },
  { id: "outcome", label: "Outcome" },
];

export function DistributionsPanel({ strategy }: { strategy: string | null }) {
  const [binding, setBinding] = useState<Binding>("time");

  const detailQ = useQuery({
    queryKey: ["strategy", strategy],
    queryFn: () => strategiesApi.get(strategy!),
    enabled: !!strategy,
    retry: false,
    staleTime: 60_000,
  });

  const trades = detailQ.data?.latestResults?.trades;

  const rows = useMemo(() => {
    // `?? []` lives inside the memo: outside it, an empty run would allocate a
    // fresh array every render and re-bucket every trade on each one.
    const list = trades ?? [];
    if (binding === "day") return pnlByDayOfWeek(list);
    if (binding === "outcome") return pnlByOutcome(list);
    return pnlByHourOfDay(list);
  }, [binding, trades]);

  if (!strategy) {
    return (
      <PanelState
        kind="empty"
        art="chart"
        message="Select a strategy on the Strategies tab to see where its PnL comes from."
      />
    );
  }

  if (detailQ.isError) {
    return (
      <PanelState
        kind="pending"
        art="plug"
        message="Could not load this strategy's stored run."
        detail={["GET /api/strategies/{name}"]}
      />
    );
  }

  if (!detailQ.isFetched) {
    return <PanelState kind="loading" art="chart" message="Loading run…" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border-subtle px-3">
        <UnderlineTabs
          tabs={TABS}
          activeTab={binding}
          onTabChange={(id) => setBinding(id as Binding)}
        />
        <span className="ml-auto text-[11px] text-text-muted">
          {strategy} · {trades?.length ?? 0} trades
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <PnlDistribution
          rows={rows}
          emptyMessage={
            !trades?.length
              ? "This strategy has no stored run yet — run it on the Backtesting page."
              : "No trades fall in these buckets."
          }
        />
      </div>
    </div>
  );
}
