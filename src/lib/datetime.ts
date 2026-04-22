export function localDateTimeInputToApiParam(value: string): string {
  if (!value) return "";

  const [datePart, timePart = "00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);

  if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) {
    return "";
  }

  const normalizedDate = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  const normalizedTime = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:00`;

  return `${normalizedDate}T${normalizedTime}`;
}
