import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { TerminalPanel, type PanelTab } from "@/components/terminal/TerminalPanel";
import { StrategiesPanel } from "@/components/metrics/StrategiesPanel";
import { UniversePanel } from "@/components/metrics/UniversePanel";
import { CorrelationPanel } from "@/components/metrics/CorrelationPanel";
import { DistributionsPanel } from "@/components/metrics/DistributionsPanel";
import { LatencyPanel } from "@/components/metrics/LatencyPanel";

/**
 * /metrics — the analysis workspace (build doc §15, M6–M8).
 *
 * This route used to be a single `pending` card whose copy read "Sharpe,
 * drawdown, hit-rate, latency percentiles, fill quality". M6–M8 build exactly
 * that list, so the placeholder is replaced by the panels it was describing:
 * B1 strategy table, B2 universe ranking, B4 correlation heatmap, B9 PnL
 * distributions, B7 latency waterfall.
 *
 * State division (§13): the tab and the selected strategy are both
 * location-like — a link to "the Sharpe ranking for rsi_mean_reversion" has to
 * survive being pasted into Slack — so both live in the URL, written with
 * `replace` so tab flipping does not fill the history stack.
 */

const TABS = ["strategies", "universe", "correlation", "distributions", "latency"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/metrics")({
  validateSearch: (search: Record<string, unknown>): { tab: Tab; strategy?: string } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : "strategies",
    strategy: typeof search.strategy === "string" && search.strategy ? search.strategy : undefined,
  }),
  head: () => ({ meta: [{ title: "Metrics — Ananke Trading" }] }),
  component: MetricsPage,
});

const PANEL_TABS: PanelTab[] = [
  { id: "strategies", label: "Strategies" },
  { id: "universe", label: "Universe" },
  { id: "correlation", label: "Correlation" },
  { id: "distributions", label: "Distributions" },
  { id: "latency", label: "Latency" },
];

function MetricsPage() {
  const { tab, strategy } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const setSearch = (next: Partial<{ tab: Tab; strategy?: string }>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });

  return (
    <div className="flex h-full flex-col p-3">
      <TerminalPanel
        tabs={PANEL_TABS}
        activeTab={tab}
        onTabChange={(id) => setSearch({ tab: id as Tab })}
        className="flex-1"
        bodyClassName="flex min-h-0 flex-col"
      >
        {tab === "strategies" && (
          <StrategiesPanel
            selected={strategy ?? null}
            onSelect={(name) => setSearch({ strategy: name ?? undefined })}
          />
        )}
        {tab === "universe" && <UniversePanel strategy={strategy ?? null} />}
        {tab === "correlation" && <CorrelationPanel />}
        {tab === "distributions" && <DistributionsPanel strategy={strategy ?? null} />}
        {tab === "latency" && <LatencyPanel />}
      </TerminalPanel>
    </div>
  );
}
