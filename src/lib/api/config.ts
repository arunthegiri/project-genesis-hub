/**
 * API configuration. Override at build time with VITE_API_BASE_URL.
 * Defaults to http://localhost:8080 (your local Spring Boot backend).
 *
 * For Lovable preview, set this to your ngrok / Cloudflare tunnel HTTPS URL.
 */
export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:8080";

/**
 * Future WebSocket URL (engine status, live prices, trades, PnL).
 * Endpoint is NOT yet implemented on the backend — this is here so the
 * Live page knows where it WOULD connect once the backend exposes WS.
 */
export const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ??
  API_BASE_URL.replace(/^http/, "ws") + "/ws";
