import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { pricesApi } from "@/lib/api/prices";
import { symbolsApi, normalizeSymbols } from "@/lib/api/symbols";
import type { BackfillJob, CoverageBlock, CoverageBlockState } from "@/lib/api/types";
import { cn } from "@/lib/utils";

interface Props {
  from: string; // ISO API param ("" while the datetime input is incomplete)
  to: string;
}

interface Segment {
  fromMs: number;
  toMs: number;
  state: CoverageBlockState;
  barCount?: number;
}

const ACTIVE_STATUSES = new Set(["PENDING", "RUNNING"]);

// One rendering per state — 'backfilling' (animated) and 'covered-but-empty'
// (outlined) are dark until the backend ships the per-block state field (§16).
const SEGMENT_STYLE: Record<CoverageBlockState, string> = {
  covered:             "bg-bull/60",
  gap:                 "bg-transparent",
  backfilling:         "animate-pulse bg-accent-blue/50",
  "covered-but-empty": "border border-dashed border-warning/60 bg-transparent",
};

export function CoverageTimeline({ from, to }: Props) {
  const qc = useQueryClient();
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const rangeValid = !!from && !!to && Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs < toMs;

  const { data: symbolsRaw } = useQuery({ queryKey: ["symbols"], queryFn: symbolsApi.list });
  const symbols = useMemo(() => normalizeSymbols(symbolsRaw), [symbolsRaw]);

  // Symbols with a backfill job started from a gap click: symbol → jobId.
  // Coverage polls at 2s while an entry exists; the entry is dropped when the
  // job settles (see effect below).
  const [filling, setFilling] = useState<Map<string, string>>(new Map());

  const coverageQueries = useQueries({
    queries: symbols.map((s) => ({
      enabled: rangeValid,
      queryKey: ["coverage", s, from, to],
      queryFn: () => pricesApi.coverageBlocks(s, from, to),
      refetchInterval: () => (filling.has(s) ? 2000 : false),
    })),
  });

  // Watch jobs only for filling symbols so polling stops when the job settles.
  const fillingEntries = useMemo(() => [...filling.entries()], [filling]);
  const jobQueries = useQueries({
    queries: fillingEntries.map(([s]) => ({
      queryKey: ["backfill-jobs", s],
      queryFn: () => pricesApi.listJobs(s),
      refetchInterval: 2000,
    })),
  });

  useEffect(() => {
    fillingEntries.forEach(([s, jobId], i) => {
      const jobs = jobQueries[i]?.data as BackfillJob[] | undefined;
      const job = jobs?.find((j) => j.jobId === jobId);
      if (job && !ACTIVE_STATUSES.has(job.status)) {
        setFilling((prev) => {
          const next = new Map(prev);
          next.delete(s);
          return next;
        });
        // Final read so the segment fills in once the job is done.
        qc.invalidateQueries({ queryKey: ["coverage", s] });
      }
    });
  }, [jobQueries, fillingEntries, qc]);

  const backfillMut = useMutation({
    mutationFn: ({ symbol, gapFrom, gapTo }: { symbol: string; gapFrom: string; gapTo: string }) =>
      pricesApi.backfillAsync(symbol, gapFrom, gapTo),
    onSuccess: (job, { symbol, gapFrom, gapTo }) => {
      setFilling((prev) => new Map(prev).set(symbol, job.jobId));
      qc.invalidateQueries({ queryKey: ["backfill-jobs", symbol] });
      toast.success(`Backfill started for ${symbol}`, {
        description: `${fmtTs(gapFrom)} → ${fmtTs(gapTo)}`,
      });
    },
    onError: (e: Error, { symbol }) => toast.error(`Backfill failed for ${symbol}: ${e.message}`),
  });

  if (symbols.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Coverage</span>
        <span className="text-[10px] text-muted-foreground/60">click a gap to backfill</span>
        {filling.size > 0 && <Loader2 className="h-3 w-3 animate-spin self-center text-accent-blue" />}
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {symbols.map((s, i) => {
          const q = coverageQueries[i];
          const isFilling = filling.has(s);
          const segments = rangeValid && q?.data ? buildSegments(q.data, fromMs, toMs) : [];
          return (
            <div key={s} className="flex items-center gap-2">
              <span className="w-16 shrink-0 truncate font-mono text-[11px] text-foreground/80" title={s}>
                {s}
              </span>
              <div className="relative h-3.5 flex-1 overflow-hidden rounded-sm bg-border/30">
                {q?.isError && (
                  <span className="absolute inset-0 flex items-center px-1.5 text-[9px] text-destructive">
                    coverage unavailable
                  </span>
                )}
                {segments.map((seg, j) => {
                  const isGap = seg.state === "gap" && !isFilling;
                  const state: CoverageBlockState =
                    seg.state === "gap" && isFilling ? "backfilling" : seg.state;
                  const left = ((seg.fromMs - fromMs) / (toMs - fromMs)) * 100;
                  const width = ((seg.toMs - seg.fromMs) / (toMs - fromMs)) * 100;
                  return (
                    <div
                      key={j}
                      role={isGap ? "button" : undefined}
                      title={
                        seg.state === "gap"
                          ? `Gap ${fmtMs(seg.fromMs)} → ${fmtMs(seg.toMs)} — click to backfill`
                          : `${fmtMs(seg.fromMs)} → ${fmtMs(seg.toMs)} · ${(seg.barCount ?? 0).toLocaleString()} bars`
                      }
                      onClick={
                        isGap
                          ? () =>
                              backfillMut.mutate({
                                symbol: s,
                                gapFrom: new Date(seg.fromMs).toISOString(),
                                gapTo: new Date(seg.toMs).toISOString(),
                              })
                          : undefined
                      }
                      className={cn(
                        "absolute inset-y-0",
                        SEGMENT_STYLE[state],
                        isGap && "cursor-pointer hover:bg-bear/25",
                      )}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Covered blocks → full segment list for [fromMs, toMs]: gaps are the
 * complement of the (sorted, clamped) covered blocks within the range.
 */
function buildSegments(blocks: CoverageBlock[], fromMs: number, toMs: number): Segment[] {
  const segs: Segment[] = [];
  let cursor = fromMs;
  const sorted = [...blocks].sort((a, b) => +new Date(a.from) - +new Date(b.from));
  for (const b of sorted) {
    const bs = Math.max(+new Date(b.from), fromMs);
    const be = Math.min(+new Date(b.to), toMs);
    if (be <= bs) continue;
    if (bs > cursor) segs.push({ fromMs: cursor, toMs: bs, state: "gap" });
    segs.push({ fromMs: bs, toMs: be, state: b.state ?? "covered", barCount: b.barCount });
    cursor = Math.max(cursor, be);
  }
  if (cursor < toMs) segs.push({ fromMs: cursor, toMs, state: "gap" });
  return segs;
}

function fmtMs(ms: number): string {
  return format(new Date(ms), "yyyy-MM-dd HH:mm");
}

function fmtTs(iso: string): string {
  return format(new Date(iso), "yyyy-MM-dd HH:mm");
}
