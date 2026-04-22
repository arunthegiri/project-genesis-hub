import { createFileRoute } from "@tanstack/react-router";
import { PendingPage } from "@/components/PendingPage";

export const Route = createFileRoute("/models")({
  head: () => ({ meta: [{ title: "Models — Quant Trading Platform" }] }),
  component: () => (
    <PendingPage
      title="Models"
      description="Model registry, versions, backtest performance, and live deployment status."
      pendingEndpoints={[
        "GET    /api/models",
        "GET    /api/models/{name}/versions",
        "GET    /api/models/{name}/{version}/performance",
        "POST   /api/models/{name}/{version}/deploy",
      ]}
    />
  ),
});
