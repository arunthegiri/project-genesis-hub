import { API_BASE_URL } from "./config";

/**
 * Boot-time health probe for the endpoints the frontend depends on.
 *
 * Fires one GET per registered endpoint after mount and records the result in
 * a module-level map. Non-2xx = flagged. This powers inline "endpoint not
 * implemented" notices (e.g. /api/trades/range) and, later, the status rail.
 * Deliberately no toasts here — probe results are an ongoing state, not an
 * event (see build doc §2 taxonomy).
 */

export type ProbeStatus = "unknown" | "ok" | "flagged";

export type EndpointName = "symbols" | "prices" | "trades" | "metrics";

const statusMap = new Map<EndpointName, ProbeStatus>();

const listeners = new Set<() => void>();

function setStatus(name: EndpointName, status: ProbeStatus) {
  if (statusMap.get(name) === status) return;
  statusMap.set(name, status);
  listeners.forEach((l) => l());
}

export function getEndpointStatus(name: EndpointName): ProbeStatus {
  return statusMap.get(name) ?? "unknown";
}

/** Subscribe to probe status changes. Returns an unsubscribe function. */
export function subscribeProbe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function probeUrls(): Record<EndpointName, string> {
  // A 1-minute window keeps the prices probe cheap even if the backend
  // treats it as a fillable range.
  const now = new Date();
  const from = new Date(now.getTime() - 60_000).toISOString();
  const to = now.toISOString();
  return {
    symbols: `${API_BASE_URL}/api/symbols`,
    prices: `${API_BASE_URL}/api/prices/AAPL/range?from=${from}&to=${to}`,
    trades: `${API_BASE_URL}/api/trades/range?symbol=AAPL&from=${from}&to=${to}`,
    metrics: `${API_BASE_URL}/api/metrics/engine?from=${from}&to=${to}`,
  };
}

let started = false;

/** Fire all probes once. Safe to call repeatedly — only the first call runs. */
export function runHealthProbe(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  for (const [name, url] of Object.entries(probeUrls()) as [EndpointName, string][]) {
    fetch(url, { headers: { Accept: "application/json" } })
      .then((res) => setStatus(name, res.ok ? "ok" : "flagged"))
      .catch(() => setStatus(name, "flagged"));
  }
}
