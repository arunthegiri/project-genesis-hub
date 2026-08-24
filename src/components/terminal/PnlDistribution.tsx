import { fmtPnl, fmtSize } from "@/lib/format";
import type { DistributionRow } from "@/lib/pnl-distribution";
import { cn } from "@/lib/utils";

/**
 * B9 distribution renderer (build doc §15.4, plan §4.9) — one renderer, three
 * bindings, zero chart library.
 *
 * Each row is label · proportional bar from a SHARED CENTRE AXIS · value.
 * Positives extend right in dir-up, negatives left in dir-down, so the sign is
 * legible from the shape before the number is read. Bars are plain divs with
 * percentage widths: themeable by construction, and cheap enough to re-render
 * live.
 */

export interface PnlDistributionProps {
  rows: DistributionRow[];
  /** Empty-state line when there is nothing to bucket. */
  emptyMessage?: string;
  className?: string;
}

export function PnlDistribution({ rows, emptyMessage, className }: PnlDistributionProps) {
  if (rows.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-text-muted">
        {emptyMessage ?? "No trades in this run."}
      </p>
    );
  }

  // One scale for the whole panel: bars are comparable across rows, which is
  // the only reason to draw them side by side.
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);

  return (
    <div className={cn("flex flex-col gap-px p-3", className)} data-testid="pnl-distribution">
      {rows.map((row) => {
        const width = (Math.abs(row.value) / max) * 50;
        const up = row.value >= 0;
        return (
          <div key={row.label} className="flex items-center gap-2 py-0.5">
            <span className="w-16 shrink-0 truncate text-right font-mono text-[11px] text-text-secondary">
              {row.label}
            </span>

            <span className="relative h-4 min-w-0 flex-1">
              {/* Centre axis — the zero line every bar is measured from. */}
              <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-border-subtle" />
              <span
                className={cn(
                  "absolute inset-y-0.5 rounded-[1px]",
                  up ? "left-1/2 bg-bull/70" : "right-1/2 bg-bear/70",
                )}
                style={{ width: `${width}%` }}
              />
            </span>

            <span
              className={cn(
                "w-24 shrink-0 text-right tabular font-mono text-[11px]",
                up ? "text-bull" : "text-bear",
              )}
            >
              {fmtPnl(row.value)}
            </span>
            <span className="w-10 shrink-0 text-right tabular font-mono text-[10px] text-text-muted">
              {fmtSize(row.count)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
