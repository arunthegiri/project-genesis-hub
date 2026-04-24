import { type DateRange } from 'react-day-picker';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatDisplayDate, parseIsoDate } from '@/lib/date-range';

interface Props {
  startDate: string;
  endDate: string;
  onChange: (range: { startDate: string; endDate: string }) => void;
}

export function DateRangePicker({ startDate, endDate, onChange }: Props) {
  const selectedRange: DateRange = {
    from: parseIsoDate(startDate),
    to: parseIsoDate(endDate),
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('h-9 min-w-[220px] justify-start text-left font-normal tabular')}>
          <CalendarIcon className="h-4 w-4" />
          <span>
            {formatDisplayDate(startDate)} - {formatDisplayDate(endDate)}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={selectedRange}
          onSelect={(range) => {
            if (!range?.from) return;
            onChange({
              startDate: range.from.toISOString().slice(0, 10),
              endDate: (range.to ?? range.from).toISOString().slice(0, 10),
            });
          }}
          initialFocus
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}
