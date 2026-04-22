import { createFileRoute } from "@tanstack/react-router";
import { PendingPage } from "@/components/PendingPage";

export const Route = createFileRoute("/live")({
  head: () => ({ meta: [{ title: "Live — Quant Trading Platform" }] }),
  component: () => (
    <PendingPage
      title="Live"
      description="Real-time prices, open positions, recent trades, engine status, current PnL, active strategy/model, and order flow widgets. Requires a WebSocket endpoint on the backend."
      pendingEndpoints={[
        "WS   /ws/prices                  (price ticks)",
        "WS   /ws/trades                  (executed trades from C++ engine)",
        "WS   /ws/engine                  (engine heartbeat / status)",
        "WS   /ws/pnl                     (live PnL updates)",
        "GET  /api/positions              (open positions snapshot)",
        "GET  /api/engine/status          (engine status snapshot)",
        "GET  /api/strategies/active      (currently active strategy + model version)",
      ]}
    />
  ),
});
