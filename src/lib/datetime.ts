export function localDateTimeInputToUtcIso(value: string): string {
  if (!value) return "";

  const [datePart, timePart = "00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);

  if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) {
    return "";
  }

  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}
