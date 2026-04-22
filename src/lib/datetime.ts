/**
 * Convert a <input type="datetime-local"> value (e.g. "2026-04-21T09:30")
 * — which represents the user's LOCAL wall-clock time — into a UTC ISO
 * string with `Z` suffix that the Spring backend's /range endpoint accepts
 * (per README example: `from=2024-01-15T09:30:00Z`).
 */
export function localDateTimeInputToApiParam(value: string): string {
  if (!value) return "";

  const [datePart, timePart = "00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);

  if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) {
    return "";
  }

  // Interpret the input as local time, then serialize as UTC ISO with Z.
  const localDate = new Date(year, month - 1, day, hour, minute, 0, 0);
  return localDate.toISOString().replace(/\.\d{3}Z$/, "Z");
}
