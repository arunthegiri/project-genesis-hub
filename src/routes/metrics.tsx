import { createFileRoute } from "@tanstack/react-router";
import { PendingPage } from "@/components/PendingPage";

export const Route = createFileRoute("/metrics")({
  head: () => ({ meta: [{ title: "Metrics — Quant Trading Platform" }] }),
  component: () => (
    <PendingPage
      title="Metrics"
      description="Strategy and engine metrics — Sharpe, drawdown, hit-rate, latency percentiles, fill quality."
      pendingEndpoints={[
        "GET /api/metrics/strategy?name=&from=&to=",
        "GET /api/metrics/engine?from=&to=",
      ]}
    />
  ),
});
