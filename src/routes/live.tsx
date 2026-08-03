import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { liveApi, type AccountData, type PositionData, type ActiveStrategy } from "@/lib/api/live";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/live")({
  head: () => ({ meta: [{ title: "Live — Ananke Trading" }] }),
  component: LivePage,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(value: string | number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDollar(value: string | null | undefined): string {
  if (!value) return "—";
  const n = parseFloat(value);
  if (isNaN(n)) return "—";
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(value: string | null | undefined, multiply100 = false): string {
  if (!value) return "—";
  const n = parseFloat(value) * (multiply100 ? 100 : 1);
  if (isNaN(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

function pnlColor(value: string | null | undefined): string {
  if (!value) return "text-muted-foreground";
  return parseFloat(value) >= 0 ? "text-bull" : "text-bear";
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE:   "bg-bull/20 text-bull border-bull/30",
    STANDBY:  "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    STOPPED:  "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    EXPORTED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    ACTIVE_ACCOUNT: "bg-bull/20 text-bull border-bull/30",
  };
  const cls = map[status] ?? "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium", cls)}>
      {status}
    </span>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{title}</h2>
      {children}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-semibold tabular-nums", valueClass)}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Not-configured banner ─────────────────────────────────────────────────────

function NotConfiguredBanner() {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-6 text-center space-y-2">
      <p className="text-sm font-medium text-foreground">Trading API not configured</p>
      <p className="text-xs text-muted-foreground">
        Add <code className="bg-muted px-1 rounded">ALPACA_TRADING_KEY</code> and{" "}
        <code className="bg-muted px-1 rounded">ALPACA_TRADING_SECRET</code> to your{" "}
        <code className="bg-muted px-1 rounded">.env</code> file and restart the backend.
      </p>
    </div>
  );
}

// ── Portfolio overview ────────────────────────────────────────────────────────

function PortfolioOverview({ account }: { account: AccountData | null }) {
  if (!account) return <NotConfiguredBanner />;

  const dailyPnl = account.equity && account.lastEquity
    ? parseFloat(account.equity) - parseFloat(account.lastEquity)
    : null;
  const dailyPnlPct = dailyPnl !== null && account.lastEquity
    ? (dailyPnl / parseFloat(account.lastEquity)) * 100
    : null;
  const dailyPnlStr = dailyPnl !== null ? dailyPnl.toString() : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StatusBadge status={account.status === "ACTIVE" ? "ACTIVE_ACCOUNT" : account.status} />
        <span className="text-xs text-muted-foreground">
          Account {account.accountNumber} · {account.currency}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Portfolio Value" value={fmtDollar(account.portfolioValue)} />
        <StatCard label="Cash" value={fmtDollar(account.cash)} />
        <StatCard label="Buying Power" value={fmtDollar(account.buyingPower)} />
        <StatCard
          label="Day P&L"
          value={fmtDollar(dailyPnlStr)}
          sub={dailyPnlPct !== null ? (dailyPnlPct >= 0 ? "+" : "") + dailyPnlPct.toFixed(2) + "%" : undefined}
          valueClass={pnlColor(dailyPnlStr)}
        />
        <StatCard label="Long Exposure" value={fmtDollar(account.longMarketValue)} />
        <StatCard label="DT Buying Power" value={fmtDollar(account.daytradingBuyingPower)} />
      </div>
    </div>
  );
}

// ── Positions table ───────────────────────────────────────────────────────────

function PositionsTable({ positions }: { positions: PositionData[] }) {
  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
        No open positions
      </div>
    );
  }

  const sorted = [...positions].sort(
    (a, b) => parseFloat(b.marketValue ?? "0") - parseFloat(a.marketValue ?? "0"),
  );

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Symbol</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Side</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Qty</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Price</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Market Value</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">P&L</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">P&L %</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.symbol} className="border-b border-border/50 hover:bg-muted/10">
              <td className="px-3 py-2 font-medium">{p.symbol}</td>
              <td className="px-3 py-2 text-right">
                <span className={p.side === "long" ? "text-bull" : "text-bear"}>
                  {p.side?.toUpperCase()}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(p.qty, 0)}</td>
              <td className="px-3 py-2 text-right tabular-nums">${fmt(p.currentPrice)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtDollar(p.marketValue)}</td>
              <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(p.unrealizedPl))}>
                {fmtDollar(p.unrealizedPl)}
              </td>
              <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(p.unrealizedPlPct))}>
                {fmtPct(p.unrealizedPlPct, true)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Active strategies table ───────────────────────────────────────────────────

function ActiveStrategiesTable({ strategies }: { strategies: ActiveStrategy[] }) {
  if (strategies.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-6 text-center space-y-1">
        <p className="text-sm text-muted-foreground">No active strategies</p>
        <p className="text-xs text-muted-foreground">
          Deploy a strategy from Jupyter using{" "}
          <code className="bg-muted px-1 rounded">k.deploy('strategy_name', mode='paper')</code>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Strategy</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Mode</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Description</th>
          </tr>
        </thead>
        <tbody>
          {strategies.map((s) => (
            <tr key={s.id} className="border-b border-border/50 hover:bg-muted/10">
              <td className="px-3 py-2 font-medium">{s.name}</td>
              <td className="px-3 py-2">
                <StatusBadge status={s.status} />
              </td>
              <td className="px-3 py-2 text-muted-foreground text-xs">
                {s.deployMode ?? "—"}
              </td>
              <td className="px-3 py-2 text-muted-foreground text-xs truncate max-w-xs">
                {s.description ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function LivePage() {
  const accountQ = useQuery({
    queryKey: ["live", "account"],
    queryFn: liveApi.account,
    refetchInterval: 30_000,
    retry: false,
  });

  const positionsQ = useQuery({
    queryKey: ["live", "positions"],
    queryFn: liveApi.positions,
    refetchInterval: 15_000,
    retry: false,
  });

  const strategiesQ = useQuery({
    queryKey: ["live", "activeStrategies"],
    queryFn: liveApi.activeStrategies,
    refetchInterval: 60_000,
    retry: false,
  });

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-y-auto">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Live</h1>
        <span className="text-xs text-muted-foreground">Paper Trading</span>
      </div>

      <div className="flex-1 p-6 space-y-8">
        {/* 4A — Portfolio overview */}
        <Section title="Portfolio">
          {accountQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading account…</div>
          ) : (
            <PortfolioOverview account={accountQ.data ?? null} />
          )}
        </Section>

        {/* 4B — Positions */}
        <Section title="Open Positions">
          {positionsQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading positions…</div>
          ) : (
            <PositionsTable positions={positionsQ.data ?? []} />
          )}
        </Section>

        {/* 4C — Active strategies */}
        <Section title="Active Strategies">
          {strategiesQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading strategies…</div>
          ) : (
            <ActiveStrategiesTable strategies={strategiesQ.data ?? []} />
          )}
        </Section>
      </div>
    </div>
  );
}
