import { useState, useEffect } from 'react';
import { format, parse, isValid } from 'date-fns';
import { type DateRange } from 'react-day-picker';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { parseIsoDate } from '@/lib/date-range';

interface Props {
  startDate: string;
  endDate: string;
  onChange: (range: { startDate: string; endDate: string }) => void;
  minDate?: string;
  maxDate?: string;
  disabled?: boolean;
}

const TEXT_FMT = 'MM/dd/yyyy';

function toText(isoDate: string): string {
  try {
    return format(parseIsoDate(isoDate), TEXT_FMT);
  } catch {
    return '';
  }
}

function fromText(text: string): Date | null {
  if (text.length !== 10) return null;
  const d = parse(text, TEXT_FMT, new Date());
  return isValid(d) ? d : null;
}

export function DateRangePicker({ startDate, endDate, onChange, minDate, maxDate, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [startText, setStartText] = useState(() => toText(startDate));
  const [endText, setEndText] = useState(() => toText(endDate));
  const [startError, setStartError] = useState('');
  const [endError, setEndError] = useState('');

  // Keep text fields in sync when props change (e.g. preset buttons)
  useEffect(() => { setStartText(toText(startDate)); setStartError(''); }, [startDate]);
  useEffect(() => { setEndText(toText(endDate)); setEndError(''); }, [endDate]);

  const selectedRange: DateRange = {
    from: parseIsoDate(startDate),
    to: parseIsoDate(endDate),
  };

  const minDateObj = minDate ? parseIsoDate(minDate) : undefined;
  const maxDateObj = maxDate ? parseIsoDate(maxDate) : undefined;

  function applyDateText(
    text: string,
    setErr: (e: string) => void,
    apply: (iso: string) => void,
    showRequired: boolean,
  ) {
    if (!text) { if (showRequired) setErr('Required'); return; }
    const d = fromText(text);
    if (!d) { setErr('Use MM/DD/YYYY'); return; }
    if (minDateObj && d < minDateObj) { setErr(`After ${toText(minDate!)}`); return; }
    if (maxDateObj && d > maxDateObj) { setErr(`Before ${toText(maxDate!)}`); return; }
    setErr('');
    apply(format(d, 'yyyy-MM-dd'));
  }

  function handleStartChange(text: string) {
    setStartText(text);
    if (text.length < 10) { setStartError(''); return; }
    applyDateText(text, setStartError, (iso) => onChange({ startDate: iso, endDate }), false);
  }

  function handleEndChange(text: string) {
    setEndText(text);
    if (text.length < 10) { setEndError(''); return; }
    applyDateText(text, setEndError, (iso) => onChange({ startDate, endDate: iso }), false);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              disabled={disabled}
              aria-label="Open calendar"
            >
              <CalendarIcon className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={selectedRange}
              onSelect={(range) => {
                if (!range?.from) return;
                const s = format(range.from, 'yyyy-MM-dd');
                const e = format(range.to ?? range.from, 'yyyy-MM-dd');
                setStartText(format(range.from, TEXT_FMT));
                setEndText(format(range.to ?? range.from, TEXT_FMT));
                setStartError('');
                setEndError('');
                onChange({ startDate: s, endDate: e });
                if (range.to) setOpen(false);
              }}
              disabled={
                minDateObj || maxDateObj
                  ? (date) =>
                      (minDateObj ? date < minDateObj : false) ||
                      (maxDateObj ? date > maxDateObj : false)
                  : undefined
              }
              initialFocus
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>

        <Input
          value={startText}
          onChange={(e) => handleStartChange(e.target.value)}
          onBlur={() =>
            applyDateText(startText, setStartError, (iso) => onChange({ startDate: iso, endDate }), true)
          }
          placeholder="MM/DD/YYYY"
          disabled={disabled}
          aria-invalid={!!startError}
          className={cn(
            'h-8 w-[116px] px-2 font-mono tabular text-xs',
            startError && 'border-destructive focus-visible:ring-destructive',
          )}
        />
        <span className="select-none text-xs text-muted-foreground">—</span>
        <Input
          value={endText}
          onChange={(e) => handleEndChange(e.target.value)}
          onBlur={() =>
            applyDateText(endText, setEndError, (iso) => onChange({ startDate, endDate: iso }), true)
          }
          placeholder="MM/DD/YYYY"
          disabled={disabled}
          aria-invalid={!!endError}
          className={cn(
            'h-8 w-[116px] px-2 font-mono tabular text-xs',
            endError && 'border-destructive focus-visible:ring-destructive',
          )}
        />
      </div>
      {(startError || endError) && (
        <p className="text-[10px] leading-tight text-destructive">
          {startError && `Start: ${startError}`}
          {startError && endError && ' · '}
          {endError && `End: ${endError}`}
        </p>
      )}
    </div>
  );
}
