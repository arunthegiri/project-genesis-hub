import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, subMonths } from "date-fns";
import { ChevronDown, ChevronRight, Loader2, RotateCcw, X } from "lucide-react";
import { pricesApi } from "@/lib/api/prices";
import type { BackfillJob, BackfillStatus } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const ACTIVE_STATUSES: BackfillStatus[] = ["PENDING", "RUNNING"];

const STATUS_STYLE: Record<BackfillStatus, string> = {
  PENDING:   "text-amber-400 bg-amber-400/10",
  RUNNING:   "text-blue-400 bg-blue-400/10",
  COMPLETED: "text-emerald-400 bg-emerald-400/10",
  FAILED:    "text-red-400 bg-red-400/10",
  CANCELLED: "text-zinc-400 bg-zinc-400/10",
};

interface Props {
  symbol: string;
}

export function BackfillPanel({ symbol }: Props) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() =>
    format(subMonths(new Date(), 6), "yyyy-MM-dd'T'HH:mm"),
  );
  const [to, setTo] = useState(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"));

  const qc = useQueryClient();

  const { data: jobs = [], isLoading } = useQuery({
    enabled: open && !!symbol,
    queryKey: ["backfill-jobs", symbol],
    queryFn: () => pricesApi.listJobs(symbol),
    refetchInterval: (query) => {
      const list = query.state.data ?? [];
      return list.some((j) => ACTIVE_STATUSES.includes(j.status)) ? 2000 : false;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["backfill-jobs", symbol] });

  const submitMut = useMutation({
    mutationFn: () => {
      const fromIso = new Date(from).toISOString();
      const toIso   = new Date(to).toISOString();
      return pricesApi.backfillAsync(symbol, fromIso, toIso);
    },
    onSuccess: invalidate,
  });

  const cancelMut = useMutation({
    mutationFn: (jobId: string) => pricesApi.cancelJob(jobId),
    onSuccess: invalidate,
  });

  const retryMut = useMutation({
    mutationFn: (jobId: string) => pricesApi.retryJob(jobId),
    onSuccess: invalidate,
  });

  return (
    <div className="rounded-md border border-border bg-card">
      {/* Header toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="uppercase tracking-wider">Async Backfill</span>
        {jobs.some((j) => ACTIVE_STATUSES.includes(j.status)) && (
          <Loader2 className="ml-1 h-3 w-3 animate-spin text-blue-400" />
        )}
        {symbol && (
          <span className="ml-1 font-mono text-foreground/60">{symbol}</span>
        )}
      </button>

      {open && (
        <div className="border-t border-border px-3 pb-3 pt-2.5 flex flex-col gap-4">
          {/* Submit form */}
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (symbol) submitMut.mutate();
            }}
          >
            <Field label="From">
              <Input
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 tabular text-xs"
              />
            </Field>
            <Field label="To">
              <Input
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 tabular text-xs"
              />
            </Field>
            <Button
              type="submit"
              size="sm"
              className="h-8"
              disabled={!symbol || submitMut.isPending}
            >
              {submitMut.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                "Submit Job"
              )}
            </Button>
            {submitMut.isError && (
              <p className="text-xs text-destructive">
                {(submitMut.error as Error).message}
              </p>
            )}
            {!symbol && (
              <p className="text-xs text-muted-foreground">Select a symbol first.</p>
            )}
          </form>

          {/* Job list */}
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading jobs…
            </div>
          )}

          {!isLoading && jobs.length === 0 && symbol && (
            <p className="text-xs text-muted-foreground">No backfill jobs yet for {symbol}.</p>
          )}

          {jobs.length > 0 && (
            <ul className="flex flex-col gap-2">
              {jobs.map((job) => (
                <JobRow
                  key={job.jobId}
                  job={job}
                  onCancel={() => cancelMut.mutate(job.jobId)}
                  onRetry={() => retryMut.mutate(job.jobId)}
                  cancelling={cancelMut.isPending && cancelMut.variables === job.jobId}
                  retrying={retryMut.isPending && retryMut.variables === job.jobId}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function JobRow({
  job,
  onCancel,
  onRetry,
  cancelling,
  retrying,
}: {
  job: BackfillJob;
  onCancel: () => void;
  onRetry: () => void;
  cancelling: boolean;
  retrying: boolean;
}) {
  const isActive  = ACTIVE_STATUSES.includes(job.status);
  const isFailed  = job.status === "FAILED";
  const pct       = Math.round(job.progressPct);

  return (
    <li className="rounded border border-border/60 bg-background/40 p-2.5 text-xs">
      {/* Top row: dates + status + actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-foreground/70 tabular">
          {fmtDate(job.fromTime)} → {fmtDate(job.toTime)}
        </span>

        <span
          className={cn(
            "ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            STATUS_STYLE[job.status],
          )}
        >
          {job.status}
        </span>

        {isActive && (
          <button
            onClick={onCancel}
            disabled={cancelling}
            title="Cancel"
            className="text-muted-foreground hover:text-destructive disabled:opacity-40"
          >
            {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
          </button>
        )}

        {isFailed && (
          <button
            onClick={onRetry}
            disabled={retrying}
            title="Retry from failed chunk"
            className="text-muted-foreground hover:text-amber-400 disabled:opacity-40"
          >
            {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          </button>
        )}
      </div>

      {/* Progress bar (PENDING + RUNNING + COMPLETED) */}
      {job.totalChunks > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-border">
            <div
              className={cn(
                "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
                job.status === "COMPLETED" ? "bg-emerald-500" :
                job.status === "FAILED"    ? "bg-red-500" :
                                             "bg-blue-500",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="tabular text-[10px] text-muted-foreground whitespace-nowrap">
            {job.completedChunks}/{job.totalChunks} chunks · {job.totalBars.toLocaleString()} bars · {pct}%
          </span>
        </div>
      )}

      {/* Current chunk range while running */}
      {job.status === "RUNNING" && job.currentChunkFrom && (
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          chunk {fmtDate(job.currentChunkFrom)} → {job.currentChunkTo ? fmtDate(job.currentChunkTo) : "…"}
        </p>
      )}

      {/* Error message */}
      {job.errorMessage && (
        <p className="mt-1 text-[10px] text-red-400 break-all">{job.errorMessage}</p>
      )}

      {/* Footer timestamps */}
      <p className="mt-1 text-[10px] text-muted-foreground/60">
        submitted {fmtTs(job.createdAt)}
        {job.completedAt && ` · completed ${fmtTs(job.completedAt)}`}
      </p>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function fmtDate(iso: string): string {
  return format(new Date(iso), "yyyy-MM-dd");
}

function fmtTs(iso: string): string {
  return format(new Date(iso), "MMM d HH:mm");
}
