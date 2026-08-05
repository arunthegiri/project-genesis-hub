import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
import { useQueries } from "@tanstack/react-query";

import { getSessionInfo, type SessionState } from "@/lib/market-calendar";
import { connectionReducer } from "@/lib/connection-state";
import { getEndpointStatus, subscribeProbe, type EndpointName } from "@/lib/api/health-probe";
import { getRailBarsSnapshot, subscribeRailBars } from "@/lib/stores/last-bar-registry";
import { intervalMs } from "@/lib/interval-policy";
import { pricesApi } from "@/lib/api/prices";
import type { BackfillJob } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const ENDPOINTS: EndpointName[] = ["symbols", "prices", "trades", "metrics"];
const ACTIVE_STATUSES = new Set(["PENDING", "RUNNING"]);

const SESSION_STYLE: Record<SessionState, string> = {
  OPEN: "text-bull",
  PRE: "text-neutral",
  POST: "text-neutral",
  CLOSED: "text-muted-foreground",
};

const NEXT_LABEL: Record<SessionState, string> = {
  OPEN: "to open",
  POST: "to close",
  CLOSED: "to end",
  PRE: "to open",
};

const ET_CLOCK_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hms = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return d > 0 ? `${d}d ${hms}` : hms;
}

function fmtAge(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

/**
 * Status rail (build doc §15) — one-line bottom chrome: session clock,
 * per-symbol staleness, backend health, backfill activity. Staleness and
 * health are AMBIENT (color + timestamp here), never toasts (§H.4 alarm
 * economy).
 *
 * SSR: the shell is fixed height and always rendered; everything that
 * depends on Date.now() renders only after mount, so first paint and
 * hydration agree and the layout never snaps.
 */
export function StatusRail() {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    setMounted(true);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // §2 probe results, re-read on every probe change.
  const probeKey = useSyncExternalStore(
    subscribeProbe,
    () => ENDPOINTS.map(getEndpointStatus).join(","),
    () => "unknown,unknown,unknown,unknown",
  );

  // Five-state connection model — only polling-era states reachable today.
  const [conn, dispatch] = useReducer(connectionReducer, "connecting");
  useEffect(() => {
    if (!mounted) return;
    const prices = getEndpointStatus("prices");
    const symbols = getEndpointStatus("symbols");
    if (prices === "ok" || symbols === "ok") dispatch({ type: "poll-ok" });
    else if (prices === "flagged" && symbols === "flagged") dispatch({ type: "poll-fail" });
  }, [probeKey, mounted]);

  // Per-active-symbol last bar, mirrored from the §7 interaction stores.
  const railBars = useSyncExternalStore(
    subscribeRailBars,
    getRailBarsSnapshot,
    getRailBarsSnapshot,
  );

  // Backfill activity for the symbols on screen — shares the
  // ["backfill-jobs", symbol] cache with BackfillPanel and only polls fast
  // while a job is actually active.
  const jobQueries = useQueries({
    queries: railBars.map((b) => ({
      queryKey: ["backfill-jobs", b.symbol],
      queryFn: () => pricesApi.listJobs(b.symbol),
      enabled: mounted,
      refetchInterval: (query: { state: { data?: BackfillJob[] } }) =>
        (query.state.data ?? []).some((j) => ACTIVE_STATUSES.has(j.status)) ? 2000 : 30_000,
    })),
  });

  const session = mounted ? getSessionInfo(now) : null;
  const flagged = mounted ? ENDPOINTS.filter((e) => getEndpointStatus(e) === "flagged") : [];

  let runningJobs = 0;
  let failedJobs = 0;
  for (const q of jobQueries) {
    for (const j of (q.data as BackfillJob[] | undefined) ?? []) {
      if (ACTIVE_STATUSES.has(j.status)) runningJobs++;
      else if (j.status === "FAILED") failedJobs++;
    }
  }

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-border bg-panel-header px-3 font-mono text-[11px] tabular text-muted-foreground">
      {mounted && session && (
        <>
          {/* Session badge + countdown to next transition */}
          <span data-testid="session-clock" className="flex items-center gap-1.5 whitespace-nowrap">
            <span className={cn("font-semibold tracking-wider", SESSION_STYLE[session.state])}>
              {session.state}
            </span>
            <span>
              {fmtCountdown(session.nextAt - now)} {NEXT_LABEL[session.nextState]}
            </span>
            <span className="text-muted-foreground/60">{ET_CLOCK_FMT.format(now)} ET</span>
          </span>

          {/* Per-symbol staleness: amber past 2× interval, red past 5× */}
          {railBars.length > 0 && (
            <span className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
              {railBars.map((b) => {
                const age = now - b.timeSec * 1000;
                const span = intervalMs(b.interval);
                const tier = age > 5 * span ? "stale" : age > 2 * span ? "aging" : "fresh";
                return (
                  <span
                    key={b.symbol}
                    data-testid="staleness"
                    className={cn(
                      "whitespace-nowrap",
                      tier === "stale" && "text-bear",
                      tier === "aging" && "text-neutral",
                    )}
                    title={`${b.symbol} · ${b.interval} · last bar updated ${fmtAge(age)} ago`}
                  >
                    {b.symbol} {fmtAge(age)} ago
                  </span>
                );
              })}
            </span>
          )}
          {railBars.length === 0 && <span className="flex-1" />}

          {/* Backfill activity */}
          {(runningJobs > 0 || failedJobs > 0) && (
            <span className="whitespace-nowrap">
              {runningJobs > 0 && <span className="text-blue-400">⟳ {runningJobs} backfill</span>}
              {runningJobs > 0 && failedJobs > 0 && " · "}
              {failedJobs > 0 && <span className="text-bear">{failedJobs} failed</span>}
            </span>
          )}

          {/* Backend health: connection state + flagged endpoints by name */}
          <span className="whitespace-nowrap">
            <span
              className={cn(
                conn === "offline" && "text-bear",
                conn === "connecting" && "text-neutral",
              )}
            >
              API {conn}
            </span>
            {flagged.length > 0 && (
              <span className="text-bear"> · flagged: {flagged.join(", ")}</span>
            )}
          </span>
        </>
      )}
    </footer>
  );
}
