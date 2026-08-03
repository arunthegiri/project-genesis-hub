/**
 * Five-state connection model (build doc §15 / research §I.2).
 *
 * Ships as enum + reducer NOW so the status rail and future consumers are
 * shaped for realtime; only the polling-era states (connecting / polling /
 * offline) are reachable until the backend WS proxy lands — `ws-open` /
 * `ws-close` events simply have no producer yet. When the RealtimeClient
 * arrives it feeds this reducer; consumers don't change.
 *
 *   connecting → polling    first successful poll after boot
 *   polling    → offline    polls failing (backend down)
 *   offline    → polling    poll recovers
 *   polling    → realtime   WS opens          (unreachable today)
 *   realtime   → degraded   WS drops, polling continues as fallback
 *   degraded   → realtime   WS recovers
 *   degraded   → offline    polls also failing
 */

export type ConnectionState = "connecting" | "polling" | "realtime" | "degraded" | "offline";

export type ConnectionEvent =
  | { type: "poll-ok" }
  | { type: "poll-fail" }
  | { type: "ws-open" }
  | { type: "ws-close" };

export function connectionReducer(state: ConnectionState, event: ConnectionEvent): ConnectionState {
  switch (event.type) {
    case "poll-ok":
      // A healthy poll lifts connecting/offline into polling; it never
      // demotes a live socket.
      return state === "realtime" || state === "degraded" ? state : "polling";
    case "poll-fail":
      // With a live socket, failed polls mean the fallback is gone too.
      return state === "realtime" || state === "degraded" ? "degraded" : "offline";
    case "ws-open":
      return "realtime";
    case "ws-close":
      // Socket dropped: polling (still healthy) carries us as degraded;
      // if polls were already failing there is no fallback left.
      return state === "offline" ? "offline" : "degraded";
  }
}
