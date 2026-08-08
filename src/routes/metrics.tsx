import { createFileRoute } from "@tanstack/react-router";
import { PanelState } from "@/components/terminal/PanelState";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";

export const Route = createFileRoute("/metrics")({
  head: () => ({ meta: [{ title: "Metrics — Quant Trading Platform" }] }),
  // §6: the old PendingPage card becomes a PanelState kind="pending" mounted
  // inside a TerminalPanel, with the exact endpoints it waits on as detail.
  component: () => (
    <div className="flex h-full flex-col p-3">
      <TerminalPanel
        tabs={[{ id: "metrics", label: "Metrics" }]}
        activeTab="metrics"
        className="flex-1"
      >
        <PanelState
          kind="pending"
          art="clock"
          message="Strategy and engine metrics — Sharpe, drawdown, hit-rate, latency percentiles, fill quality."
          detail={[
            "GET /api/metrics/strategy?name=&from=&to=",
            "GET /api/metrics/engine?from=&to=",
          ]}
        />
      </TerminalPanel>
    </div>
  ),
});
