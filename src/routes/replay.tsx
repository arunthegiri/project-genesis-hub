import { createFileRoute } from "@tanstack/react-router";
import { PendingPage } from "@/components/PendingPage";

export const Route = createFileRoute("/replay")({
  head: () => ({ meta: [{ title: "Replay — Quant Trading Platform" }] }),
  component: () => (
    <PendingPage
      title="Replay"
      description="Historical replay of price data with playback controls and trade overlays. The price-replay portion can be built on top of /api/prices/range, but trade overlays and replay-engine APIs need backend work."
      pendingEndpoints={[
        "GET  /api/trades/range?symbol=&from=&to=     (trade markers from C++ engine)",
        "GET  /api/replay/sessions                     (replay engine sessions)",
        "POST /api/replay/sessions                     (create a session)",
        "POST /api/replay/sessions/{id}/play|pause|step|seek",
        "WS   /ws/replay/{id}                          (streaming replay events)",
      ]}
    />
  ),
});
