import { etWallToUtcMs } from "@/lib/market-calendar";

/**
 * Convert a `<input type="datetime-local">` value ("2026-04-21T09:30") into the
 * UTC ISO string the Spring `/range` endpoint accepts
 * (`from=2024-01-15T09:30:00Z`).
 *
 * The input is interpreted in EASTERN time, not the runtime's local zone, and
 * both halves of that sentence matter:
 *
 *  · Product: this is a US-equities terminal. Every other timestamp in the app
 *    — session clock, calendar, chart axis, trade log — is ET, so "09:30"
 *    means the opening bell here, not 09:30 wherever the laptop happens to be.
 *
 *  · Correctness: `new Date(y, m, d, h, min)` reads the RUNTIME's timezone, so
 *    the same string produced one ISO instant during SSR (node's zone) and a
 *    different one during hydration (the browser's zone). That drift reached
 *    the rendered Python snippet and made /data mismatch on every load. ET is
 *    a fixed reference both sides agree on.
 */
export function etDateTimeInputToApiParam(value: string): string {
  if (!value) return "";

  const [datePart, timePart = "00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);

  if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) {
    return "";
  }

  return new Date(etWallToUtcMs(datePart, hour, minute)).toISOString().replace(/\.\d{3}Z$/, "Z");
}
