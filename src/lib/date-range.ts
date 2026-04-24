import { addDays, format, isAfter, subDays, subMonths, subYears } from 'date-fns';

export type ChartRangePreset = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | 'CUSTOM';

export interface SelectedDateRange {
  startDate: string;
  endDate: string;
}

export function formatIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function normalizeDateRange(startDate: string, endDate: string): SelectedDateRange {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);

  if (isAfter(start, end)) {
    return { startDate: endDate, endDate: startDate };
  }

  return { startDate, endDate };
}

export function getPresetRange(preset: Exclude<ChartRangePreset, 'CUSTOM'>, anchor = new Date()): SelectedDateRange {
  const end = formatIsoDate(anchor);

  switch (preset) {
    case '1D':
      return { startDate: end, endDate: end };
    case '5D':
      return { startDate: formatIsoDate(subDays(anchor, 4)), endDate: end };
    case '1M':
      return { startDate: formatIsoDate(subMonths(anchor, 1)), endDate: end };
    case '3M':
      return { startDate: formatIsoDate(subMonths(anchor, 3)), endDate: end };
    case '6M':
      return { startDate: formatIsoDate(subMonths(anchor, 6)), endDate: end };
    case '1Y':
      return { startDate: formatIsoDate(subYears(anchor, 1)), endDate: end };
  }
}

export function buildUtcApiRange(startDate: string, endDate: string): { from: string; to: string } {
  const normalized = normalizeDateRange(startDate, endDate);
  const from = `${normalized.startDate}T00:00:00Z`;
  const to = `${formatIsoDate(addDays(parseIsoDate(normalized.endDate), 1))}T00:00:00Z`;

  return { from, to };
}

export function formatDisplayDate(value: string): string {
  return format(parseIsoDate(value), 'MM/dd/yy');
}
