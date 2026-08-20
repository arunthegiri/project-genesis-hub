import { useEffect, useMemo, useState } from "react";

import {
  VERIFIED_THROUGH,
  blackoutWindows,
  scheduleIsStale,
  upcomingEvents,
  type EventKind,
} from "@/lib/event-calendar";
import { PanelState } from "@/components/terminal/PanelState";
import { UnderlineTabs } from "@/components/terminal/UnderlineTabs";
import { cn } from "@/lib/utils";

/**
 * B5 event calendar (build doc §15.3, plan §4.5) — the agenda view over
 * `lib/event-calendar.ts`.
 *
 * The panel deliberately shows the BLACKOUT WINDOW next to each event, not
 * just the release time: the window is what the risk manager acts on, and
 * showing it here is how a human checks that the feed says what they think it
 * says.
 *
 * SSR: every value here is relative to now, so the body renders only after
 * mount (the §6/§13 gate) — the server has no business guessing what "next" is.
 */

const TABS = [
  { id: "all", label: "All" },
  { id: "FOMC", label: "Fed" },
  { id: "CPI", label: "CPI" },
  { id: "NFP", label: "NFP" },
];

const KIND_TONE: Record<EventKind, string> = {
  FOMC: "bg-overlay-secondary/20 text-overlay-secondary border-overlay-secondary/30",
  CPI: "bg-warning/20 text-warning border-warning/30",
  NFP: "bg-accent-blue/20 text-accent-blue border-accent-blue/30",
};

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "2-digit",
});

const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function relativeDays(at: number, now: number): string {
  const days = Math.round((at - now) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 30) return `in ${days}d`;
  return `in ${Math.round(days / 30)}mo`;
}

export function EventCalendar({ className }: { className?: string }) {
  const [filter, setFilter] = useState<string>("all");
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    // Minute resolution is plenty for a calendar; the countdown that needs
    // seconds is the session clock in the status rail.
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const events = useMemo(() => (now ? upcomingEvents(now, 12) : []), [now]);
  const visible = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.kind === filter)),
    [events, filter],
  );
  // The machine-readable half, shown so the human can audit it.
  const windows = useMemo(() => blackoutWindows(visible), [visible]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)} data-testid="event-calendar">
      <div className="flex items-center gap-3 border-b border-border-subtle px-3">
        <UnderlineTabs tabs={TABS} activeTab={filter} onTabChange={setFilter} />
        {now > 0 && scheduleIsStale(now) && (
          <span className="ml-auto text-[10px] text-warning" title="lib/data/economic-releases.ts">
            schedule unverified past {VERIFIED_THROUGH}
          </span>
        )}
      </div>

      {now === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-text-muted">Loading calendar…</div>
      ) : visible.length === 0 ? (
        <PanelState
          kind="empty"
          art="clock"
          message="No scheduled releases ahead in this filter."
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto">
          {visible.map((event, i) => {
            const window = windows[i];
            return (
              <li
                key={event.id}
                data-testid="calendar-row"
                className="flex items-center gap-3 border-b border-border-subtle/60 px-3 py-1.5 last:border-b-0"
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    event.impact === "high" ? "bg-bear" : "bg-warning",
                  )}
                  title={`${event.impact} impact`}
                />
                <span className="w-24 shrink-0 font-mono text-[11px] text-text-secondary">
                  {DATE_FMT.format(event.at)}
                </span>
                <span className="w-16 shrink-0 tabular font-mono text-[11px] text-text-primary">
                  {TIME_FMT.format(event.at)} ET
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-[2px] border px-1.5 py-px text-[10px] font-medium",
                    KIND_TONE[event.kind],
                  )}
                >
                  {event.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-text-secondary">
                  {event.title}
                </span>
                <span
                  className="shrink-0 tabular font-mono text-[10px] text-text-muted"
                  title={
                    window
                      ? `blackout ${TIME_FMT.format(window.from)}–${TIME_FMT.format(window.to)} ET`
                      : undefined
                  }
                >
                  {window ? `⛔ ${TIME_FMT.format(window.from)}–${TIME_FMT.format(window.to)}` : ""}
                </span>
                <span className="w-16 shrink-0 text-right text-[10px] text-text-muted">
                  {relativeDays(event.at, now)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
