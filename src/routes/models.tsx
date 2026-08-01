import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  modelsApi,
  type DeployMode,
  type ModelDetail,
  type ModelSummary,
} from "@/lib/api/models";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/models")({
  head: () => ({ meta: [{ title: "Models — Ananke Trading" }] }),
  component: ModelsPage,
});

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtNum(value: string | number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function pnlColor(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n)) return "";
  return n >= 0 ? "text-green-400" : "text-red-400";
}

// ── Status badge (mirrors the Live page) ──────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE:   "bg-green-500/20 text-green-400 border-green-500/30",
    STANDBY:  "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    STOPPED:  "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    EXPORTED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    ARCHIVED: "bg-zinc-500/20 text-zinc-500 border-zinc-500/30",
  };
  const cls = map[status] ?? "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium", cls)}>
      {status}
    </span>
  );
}

// ── Models list table ─────────────────────────────────────────────────────────

function ModelsTable({
  models,
  onSelect,
}: {
  models: ModelSummary[];
  onSelect: (m: ModelSummary) => void;
}) {
  if (models.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-6 text-center space-y-1">
        <p className="text-sm text-muted-foreground">No registered models</p>
        <p className="text-xs text-muted-foreground">
          Export a model from Jupyter with{" "}
          <code className="bg-muted px-1 rounded">k.export(...)</code>; deployed versions
          appear here and on the Live page.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Model</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Version</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Mode</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Features</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Sharpe</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Win Rate</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">P&L %</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Trades</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Created</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr
              key={m.id}
              onClick={() => onSelect(m)}
              className="border-b border-border/50 hover:bg-muted/10 cursor-pointer"
            >
              <td className="px-3 py-2 font-medium">{m.name}</td>
              <td className="px-3 py-2 text-muted-foreground tabular-nums">{m.version}</td>
              <td className="px-3 py-2"><StatusBadge status={m.status} /></td>
              <td className="px-3 py-2 text-muted-foreground text-xs">{m.deployMode ?? "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{m.featureCount ?? "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(m.sharpeRatio)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {m.winRate != null ? fmtPct(parseFloat(m.winRate) * 100) : "—"}
              </td>
              <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(m.totalPnlPct))}>
                {fmtPct(m.totalPnlPct)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{m.totalTrades ?? "—"}</td>
              <td className="px-3 py-2 text-right text-muted-foreground text-xs tabular-nums">
                {fmtDate(m.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Small labelled metric ─────────────────────────────────────────────────────

function Metric({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-0.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-semibold tabular-nums", valueClass)}>{value}</p>
    </div>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function ModelDetailDrawer({
  selected,
  open,
  onOpenChange,
}: {
  selected: ModelSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<DeployMode>("paper");
  const [actionError, setActionError] = useState<string | null>(null);

  const detailQ = useQuery({
    queryKey: ["models", "detail", selected?.name, selected?.version],
    queryFn: () => modelsApi.detail(selected!.name, selected!.version),
    enabled: open && !!selected,
    retry: false,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["models"] });
    queryClient.invalidateQueries({ queryKey: ["live", "activeStrategies"] });
  };

  const deployM = useMutation({
    mutationFn: () => modelsApi.deploy(selected!.name, selected!.version, mode),
    onSuccess: invalidate,
    onError: (e: Error) => setActionError(e.message),
  });

  const archiveM = useMutation({
    mutationFn: () => modelsApi.archive(selected!.name, selected!.version),
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
    },
    onError: (e: Error) => setActionError(e.message),
  });

  const detail: ModelDetail | undefined = detailQ.data;
  const perf = detail?.performance;
  const contract = detail?.contract;
  const busy = deployM.isPending || archiveM.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto bg-background">
        {selected && (
          <>
            <SheetHeader className="space-y-2 text-left">
              <SheetTitle className="flex items-center gap-2 text-foreground">
                <span className="font-semibold">{selected.name}</span>
                <span className="text-sm text-muted-foreground tabular-nums">{selected.version}</span>
                {detail && <StatusBadge status={detail.status} />}
              </SheetTitle>
              <SheetDescription>
                {detail?.description || (
                  <span className="text-muted-foreground">
                    Strategy <code className="bg-muted px-1 rounded">{selected.strategyName}</code>
                  </span>
                )}
              </SheetDescription>
            </SheetHeader>

            {detailQ.isLoading ? (
              <p className="mt-6 text-sm text-muted-foreground">Loading model…</p>
            ) : detailQ.isError ? (
              <p className="mt-6 text-sm text-red-400">
                {(detailQ.error as Error)?.message ?? "Failed to load model detail."}
              </p>
            ) : (
              <div className="mt-6 space-y-6">
                {/* Performance metrics */}
                <section className="space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Performance {perf?.symbol ? `· ${perf.symbol}` : ""}
                  </h3>
                  {perf ? (
                    <div className="grid grid-cols-3 gap-2">
                      <Metric label="Sharpe" value={fmtNum(perf.sharpeRatio)} />
                      <Metric
                        label="Win Rate"
                        value={perf.winRate != null ? fmtPct(parseFloat(perf.winRate) * 100) : "—"}
                      />
                      <Metric
                        label="Total P&L %"
                        value={fmtPct(perf.totalPnlPct)}
                        valueClass={pnlColor(perf.totalPnlPct)}
                      />
                      <Metric label="Profit Factor" value={fmtNum(perf.profitFactor)} />
                      <Metric
                        label="Max Drawdown"
                        value={perf.maxDrawdown != null ? fmtPct(parseFloat(perf.maxDrawdown) * 100) : "—"}
                      />
                      <Metric label="Total Trades" value={perf.totalTrades ?? "—"} />
                      <Metric label="Winning" value={perf.winningTrades ?? "—"} />
                      <Metric label="Losing" value={perf.losingTrades ?? "—"} />
                      <Metric
                        label="Total P&L"
                        value={perf.totalPnl != null ? `$${fmtNum(perf.totalPnl)}` : "—"}
                        valueClass={pnlColor(perf.totalPnl)}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No backtest results recorded.</p>
                  )}
                </section>

                {/* Contract summary */}
                <section className="space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Contract
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    <Metric label="Features" value={detail?.featureCount ?? "—"} />
                    <Metric label="Buy Thr." value={fmtNum(contract?.buyThreshold ?? null)} />
                    <Metric label="Sell Thr." value={fmtNum(contract?.sellThreshold ?? null)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border border-border bg-card p-3 space-y-0.5">
                      <p className="text-[11px] text-muted-foreground">Output Classes</p>
                      <p className="text-foreground">
                        {contract?.outputClasses?.length
                          ? contract.outputClasses.map(String).join(", ")
                          : "—"}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-card p-3 space-y-0.5">
                      <p className="text-[11px] text-muted-foreground">Symbols</p>
                      <p className="text-foreground">
                        {contract?.symbols?.length ? contract.symbols.map(String).join(", ") : "—"}
                      </p>
                    </div>
                  </div>
                  {contract?.features?.length ? (
                    <div className="rounded-md border border-border bg-card p-3">
                      <p className="text-[11px] text-muted-foreground mb-1.5">
                        Feature list ({contract.features.length})
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {contract.features.map((f) => (
                          <code
                            key={f}
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground/80"
                          >
                            {f}
                          </code>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>

                {/* Deploy / archive actions */}
                <section className="space-y-3 border-t border-border pt-4">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Actions
                  </h3>
                  <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-md border border-border overflow-hidden">
                      {(["paper", "live"] as DeployMode[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMode(m)}
                          className={cn(
                            "px-3 py-1.5 text-xs font-medium transition-colors",
                            mode === m
                              ? "bg-primary text-primary-foreground"
                              : "bg-background text-muted-foreground hover:bg-muted/40",
                          )}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      disabled={busy || detail?.status === "ARCHIVED"}
                      onClick={() => {
                        setActionError(null);
                        deployM.mutate();
                      }}
                    >
                      {deployM.isPending ? "Deploying…" : "Deploy"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || detail?.status === "ARCHIVED"}
                      onClick={() => {
                        setActionError(null);
                        archiveM.mutate();
                      }}
                    >
                      {archiveM.isPending ? "Archiving…" : "Archive"}
                    </Button>
                  </div>
                  {deployM.isSuccess && (
                    <p className="text-xs text-green-400">
                      Deployed as {mode}. Now visible on the Live page.
                    </p>
                  )}
                  {actionError && <p className="text-xs text-red-400">{actionError}</p>}
                </section>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function ModelsPage() {
  const [selected, setSelected] = useState<ModelSummary | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const modelsQ = useQuery({
    queryKey: ["models", "list"],
    queryFn: modelsApi.list,
    refetchInterval: 60_000,
    retry: false,
  });

  const openDetail = (m: ModelSummary) => {
    setSelected(m);
    setDrawerOpen(true);
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-y-auto">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Models</h1>
        <span className="text-xs text-muted-foreground">Registry</span>
      </div>

      <div className="flex-1 p-6 space-y-4">
        {modelsQ.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading models…</div>
        ) : modelsQ.isError ? (
          <div className="rounded-lg border border-border bg-card/50 p-6 text-sm text-red-400">
            {(modelsQ.error as Error)?.message ?? "Failed to load models."}
          </div>
        ) : (
          <ModelsTable models={modelsQ.data ?? []} onSelect={openDetail} />
        )}
      </div>

      <ModelDetailDrawer selected={selected} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}
