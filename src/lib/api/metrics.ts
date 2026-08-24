import { apiFetch } from "./client";

/**
 * Engine + strategy metrics (build doc §15.4 B7). **Not implemented by the
 * backend yet** — `/api/metrics/engine` is one of the two endpoints the boot
 * health probe deliberately expects to fail, and the panel renders that
 * absence rather than blanking (D5: build frontend-complete behind the pending
 * pattern, never block on backend work).
 *
 * These types are therefore a CONTRACT PROPOSAL as much as a client: this is
 * the shape the latency panel consumes, written down where the backend team
 * can read it. Milliseconds per stage, one sample per order, because that is
 * what a waterfall needs — a single round-trip number cannot say which stage
 * is slow.
 */

export interface LatencySample {
  /** Order/event id — stable row identity. */
  id: string;
  symbol: string;
  /** ISO-8601 UTC of bar arrival (the clock the stages are measured from). */
  ts: string;
  /** Bar arrival → strategy signal. */
  arrivalToSignalMs: number;
  /** Signal → order submitted. */
  signalToOrderMs: number;
  /** Order submitted → fill received. */
  orderToFillMs: number;
}

export interface StrategyMetrics {
  name: string;
  sharpeRatio: number | null;
  maxDrawdown: number | null;
  hitRate: number | null;
  totalTrades: number | null;
}

export const metricsApi = {
  /** Per-order latency samples in a window. */
  engine: (from: string, to: string): Promise<LatencySample[]> =>
    apiFetch(`/api/metrics/engine?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),

  strategy: (name: string, from: string, to: string): Promise<StrategyMetrics> =>
    apiFetch(
      `/api/metrics/strategy?name=${encodeURIComponent(name)}` +
        `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
};

/** Total round-trip for one sample. */
export const totalLatency = (s: LatencySample): number =>
  s.arrivalToSignalMs + s.signalToOrderMs + s.orderToFillMs;

/**
 * Nearest-rank percentile over an unsorted sample set. Nearest-rank (not
 * interpolated) on purpose: a p99 that is a real observed latency is one you
 * can go and find in the log, and with the sample counts this panel sees
 * (dozens, not millions) interpolation invents precision that isn't there.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}
