import { WS_ENABLED, WS_URL } from "@/lib/api/config";
import { applyQuote, getQuote, knownSymbols } from "./symbol-stores";

/**
 * Realtime transport (build doc §14.2) — feature-flagged, backend-gated (D5).
 *
 * With `VITE_WS_ENABLED` unset this module connects nothing and the app keeps
 * its existing `refetchInterval` polling, byte for byte. That is the whole
 * point of the flag: no item in this build may block on backend work, and the
 * cold path must stay the fallback rather than become a degraded mode.
 *
 * The handler never calls setState and never touches the Query cache — it
 * writes into the per-symbol stores, which coalesce to one flush per frame.
 */

type ConnState = "idle" | "connecting" | "open" | "backoff";

let socket: WebSocket | null = null;
let state: ConnState = "idle";
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let mockTimer: ReturnType<typeof setInterval> | null = null;
let stopped = true;

const listeners = new Set<() => void>();

/** Exponential backoff with jitter, capped — 0.5s, 1s, 2s, 4s, 8s, 8s… */
function backoffMs(): number {
  const base = Math.min(8000, 500 * 2 ** attempt);
  return base * (0.75 + Math.random() * 0.5);
}

// Named setConnState, not setState: the working agreement (§1.4) is literally
// "the transport handler never calls setState", and a module-local helper with
// that name turns a compliance grep into a false positive.
function setConnState(next: ConnState) {
  if (state === next) return;
  state = next;
  listeners.forEach((l) => l());
}

/**
 * Message contract. Deliberately permissive: the backend does not implement a
 * price socket yet (D5), so this accepts the two shapes any such endpoint ends
 * up emitting rather than betting on one. Anything else is ignored, not
 * thrown — a stream is not a place to crash the UI.
 */
interface QuoteMessage {
  type?: string;
  symbol?: string;
  s?: string;
  price?: number | string;
  last?: number | string;
  p?: number | string;
  close?: number | string;
  ts?: number;
  t?: number;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value !== "") {
    const n = parseFloat(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Route one message into the stores. Exported for the §14 tests. */
export function routeMessage(raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const batch = Array.isArray(parsed) ? parsed : [parsed];
  for (const item of batch) {
    const msg = item as QuoteMessage;
    if (msg.type && msg.type !== "quote" && msg.type !== "trade" && msg.type !== "bar") continue;
    const symbol = msg.symbol ?? msg.s;
    const price = numeric(msg.price ?? msg.last ?? msg.p ?? msg.close);
    if (!symbol || price === null) continue;
    applyQuote(symbol, price, msg.ts ?? msg.t ?? Date.now());
  }
}

function connect() {
  if (stopped || typeof WebSocket === "undefined") return;
  setConnState("connecting");
  let ws: WebSocket;
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    scheduleRetry();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    attempt = 0;
    setConnState("open");
    // Subscribe to whatever the UI is already showing. Symbols enter the store
    // via the cold seed, so this is "resume what was on screen", not a guess.
    const symbols = knownSymbols();
    if (symbols.length) ws.send(JSON.stringify({ action: "subscribe", symbols }));
  };
  ws.onmessage = (event) => {
    if (typeof event.data === "string") routeMessage(event.data);
  };
  ws.onerror = () => ws.close();
  ws.onclose = () => {
    if (socket === ws) socket = null;
    scheduleRetry();
  };
}

function scheduleRetry() {
  if (stopped) {
    setConnState("idle");
    return;
  }
  setConnState("backoff");
  const delay = backoffMs();
  attempt += 1;
  retryTimer = setTimeout(connect, delay);
}

/**
 * Dev-only mock feed (`?wsMock=1`, build doc §14 verify) — ~20 messages/sec
 * spread across the symbols already on screen, so the profiler check has
 * something to measure without a backend. Guarded by import.meta.env.DEV so
 * it cannot ship.
 */
function startMockFeed() {
  if (mockTimer) return;
  setConnState("open");
  // 50ms × 1 message = 20 msg/s, the rate the §14 verify block names.
  mockTimer = setInterval(() => {
    const symbols = knownSymbols();
    if (!symbols.length) return;
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    // Random-walk from whatever is in the store, so the mock stays anchored to
    // the cold seed's real price range instead of inventing a level.
    const anchor = getQuote(symbol).last;
    if (anchor === null) return;
    const step = (Math.random() - 0.5) * anchor * 0.002;
    applyQuote(symbol, Math.round((anchor + step) * 100) / 100);
  }, 50);
}

/**
 * Start the realtime transport. Returns a stop function.
 *
 * Called once from the root layout. Safe to call when the flag is off — it
 * returns a no-op, which is how the polling fallback stays untouched.
 */
export function startRealtime(): () => void {
  const mock =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("wsMock") === "1";

  if (!mock && (!WS_ENABLED || typeof window === "undefined")) return () => {};

  stopped = false;
  attempt = 0;
  if (mock) startMockFeed();
  else connect();

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    if (mockTimer) clearInterval(mockTimer);
    mockTimer = null;
    const ws = socket;
    socket = null;
    // Drop the close handler first: a deliberate teardown must not look like a
    // dropped connection and schedule a reconnect.
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    setConnState("idle");
  };
}

/** Transport state for the status rail. */
export function getRealtimeState(): ConnState {
  return state;
}

export function subscribeRealtime(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
