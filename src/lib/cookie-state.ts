// Build doc §13 — division of labor:
//   URL = where you are; cookie = how the workspace is arranged; server = what the data is.
// Layout-critical, non-sensitive UI state (panel list, splitter sizes, chart
// height) lives in small JSON cookies (≤ ~1kB) so the server can render the
// real shell on first paint. Client reads/writes go through document.cookie;
// route loaders read the same cookies server-side via readUiCookieServerFn,
// which runs inside the incoming request's context during SSR.
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import type { LayoutStorage } from "react-resizable-panels";

const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

// Cookie names — kept here so writers and the server-side reader can't drift.
export const CHARTS_UI_COOKIE = "ui.charts";
export const BACKTESTING_UI_COOKIE = "ui.backtesting";
export const panelUiCookie = (persistKey: string) => `ui.panel.${persistKey}`;

export function readUiCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
  }
  return null;
}

export function writeUiCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  document.cookie =
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE}; samesite=lax`;
}

export function readUiCookieJson<T>(name: string): T | null {
  const raw = readUiCookie(name);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Read-modify-write merge so independent writers (the / page owns `panels`,
// ChartPanel owns `chartHeight`) can share one cookie without clobbering
// each other's keys.
export function mergeUiCookie(name: string, patch: Record<string, unknown>): void {
  const base = readUiCookieJson<Record<string, unknown>>(name) ?? {};
  writeUiCookie(name, JSON.stringify({ ...base, ...patch }));
}

// Adapter for react-resizable-panels v4's useDefaultLayout (§14): splitter
// layouts persist into the same cookie jar. LayoutStorage is synchronous
// (Pick<Storage, "getItem" | "setItem">), so cookies are legal — and because
// the / route loader reads ui.* cookies server-side, the persisted layout is
// what the first client render reveals.
export const layoutCookieStorage: LayoutStorage = {
  getItem: (key) => readUiCookie(key),
  setItem: (key, value) => writeUiCookie(key, value),
};

// Server-side read for route loaders. During SSR the handler executes inside
// the request context, so getCookie sees the incoming request's cookies; the
// loader result is dehydrated into the page, making the client's hydration
// render byte-identical to the server's. On client-side navigation it falls
// back to a tiny RPC fetch.
export const readUiCookieServerFn = createServerFn({ method: "GET" })
  .inputValidator((name: string) => name)
  .handler(({ data: name }) => getCookie(name) ?? null);
