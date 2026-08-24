import { useMemo } from "react";

import { percentile, totalLatency, type LatencySample } from "@/lib/api/metrics";
import { cn } from "@/lib/utils";

/**
 * B7 latency waterfall (build doc §15.4, plan §4.7).
 *
 * One horizontal stacked bar per order, newest first: arrival → signal →
 * order → fill, each segment a stage duration on a cool→warm scale (blue is
 * "we thought about it", amber is "the exchange had it"). p50/p95/p99 chips in
 * the header answer "is this normal?" before any individual bar is read.
 *
 * Sparse data — which is what this will see for a long time — collapses to a
 * single AGGREGATE bar of mean stage times rather than three lonely rows
 * pretending to be a distribution.
 */

const SPARSE_THRESHOLD = 5;
const MAX_ROWS = 40;

const STAGES = [
  { key: "arrivalToSignalMs", label: "Arrival → Signal", cls: "bg-accent-blue" },
  { key: "signalToOrderMs", label: "Signal → Order", cls: "bg-overlay-secondary" },
  { key: "orderToFillMs", label: "Order → Fill", cls: "bg-warning" },
] as const;

const ET_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function Chip({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[2px] border border-border-subtle bg-surface-2 px-1.5 py-px">
      <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      <span className="tabular font-mono text-[11px] text-text-primary">
        {value === null ? "—" : `${Math.round(value)}ms`}
      </span>
    </span>
  );
}

function StackedBar({
  sample,
  scale,
}: {
  sample: Pick<LatencySample, "arrivalToSignalMs" | "signalToOrderMs" | "orderToFillMs">;
  scale: number;
}) {
  return (
    <span className="relative flex h-3 min-w-0 flex-1 overflow-hidden rounded-[1px] bg-surface-2">
      {STAGES.map((stage) => {
        const ms = sample[stage.key];
        if (!ms || ms <= 0) return null;
        return (
          <span
            key={stage.key}
            className={cn("h-full", stage.cls)}
            style={{ width: `${(ms / scale) * 100}%` }}
            title={`${stage.label}: ${Math.round(ms)}ms`}
          />
        );
      })}
    </span>
  );
}

export function LatencyWaterfall({
  samples,
  className,
}: {
  samples: LatencySample[];
  className?: string;
}) {
  const { totals, scale, rows, aggregate } = useMemo(() => {
    const totals = samples.map(totalLatency);
    // Scale to p95, not to max: one 4-second outlier must not squash every
    // normal bar into an invisible sliver. Bars past the scale simply fill it.
    const scale = Math.max(percentile(totals, 95) ?? 1, 1);
    const rows = [...samples]
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
      .slice(0, MAX_ROWS);
    const n = samples.length || 1;
    const aggregate = {
      arrivalToSignalMs: samples.reduce((s, x) => s + x.arrivalToSignalMs, 0) / n,
      signalToOrderMs: samples.reduce((s, x) => s + x.signalToOrderMs, 0) / n,
      orderToFillMs: samples.reduce((s, x) => s + x.orderToFillMs, 0) / n,
    };
    return { totals, scale, rows, aggregate };
  }, [samples]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)} data-testid="latency-waterfall">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-surface-2/40 px-3 py-2">
        <Chip label="p50" value={percentile(totals, 50)} />
        <Chip label="p95" value={percentile(totals, 95)} />
        <Chip label="p99" value={percentile(totals, 99)} />
        <span className="ml-auto flex items-center gap-3">
          {STAGES.map((stage) => (
            <span key={stage.key} className="flex items-center gap-1 text-[10px] text-text-muted">
              <span aria-hidden className={cn("h-2 w-2 rounded-[1px]", stage.cls)} />
              {stage.label}
            </span>
          ))}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {samples.length < SPARSE_THRESHOLD ? (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-text-muted">
              {samples.length === 0
                ? "No orders in this window."
                : `Only ${samples.length} order${samples.length === 1 ? "" : "s"} in this window — showing the mean breakdown.`}
            </p>
            {samples.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="w-24 shrink-0 font-mono text-[11px] text-text-secondary">
                  Mean
                </span>
                <StackedBar
                  sample={aggregate}
                  scale={Math.max(
                    aggregate.arrivalToSignalMs +
                      aggregate.signalToOrderMs +
                      aggregate.orderToFillMs,
                    1,
                  )}
                />
                <span className="w-16 shrink-0 text-right tabular font-mono text-[11px] text-text-primary">
                  {Math.round(
                    aggregate.arrivalToSignalMs +
                      aggregate.signalToOrderMs +
                      aggregate.orderToFillMs,
                  )}
                  ms
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-px">
            {rows.map((sample) => (
              <div key={sample.id} className="flex items-center gap-2 py-0.5">
                <span className="w-20 shrink-0 tabular font-mono text-[10px] text-text-muted">
                  {ET_TIME.format(Date.parse(sample.ts))}
                </span>
                <span className="w-14 shrink-0 truncate font-mono text-[11px] text-text-secondary">
                  {sample.symbol}
                </span>
                <StackedBar sample={sample} scale={scale} />
                <span className="w-16 shrink-0 text-right tabular font-mono text-[11px] text-text-primary">
                  {Math.round(totalLatency(sample))}ms
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
