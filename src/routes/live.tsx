import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { liveApi, type AccountData, type PositionData, type ActiveStrategy } from "@/lib/api/live";
import { fmtPct, fmtPnl, fmtPrice, fmtSize } from "@/lib/format";
import { MetaGrid, type MetaGridItem } from "@/components/terminal/MetaGrid";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/live")({
  head: () => ({ meta: [{ title: "Live — Ananke Trading" }] }),
  component: LivePage,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function pnlColor(value: string | null | undefined): string {
  if (!value) return "text-muted-foreground";
  const n = parseFloat(value);
  if (isNaN(n)) return "text-muted-foreground";
  // §3.2 neutral split: an unchanged number is de-emphasized gray, not amber
  return n > 0 ? "text-bull" : n < 0 ? "text-bear" : "text-dir-flat";
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE:   "bg-bull/20 text-bull border-bull/30",
    STANDBY:  "bg-warning/20 text-warning border-warning/30",
    STOPPED:  "bg-muted/50 text-muted-foreground border-border",
    EXPORTED: "bg-accent-blue/20 text-accent-blue border-accent-blue/30",
    ACTIVE_ACCOUNT: "bg-bull/20 text-bull border-bull/30",
  };
  const cls = map[status] ?? "bg-muted/50 text-muted-foreground border-border";
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

  const items: MetaGridItem[] = [
    { label: "Portfolio Value", value: fmtPnl(account.portfolioValue, { plus: false }) },
    { label: "Cash", value: fmtPnl(account.cash, { plus: false }) },
    { label: "Buying Power", value: fmtPnl(account.buyingPower, { plus: false }) },
    {
      label: "Day P&L",
      color: pnlColor(dailyPnlStr),
      value: (
        <>
          {fmtPnl(dailyPnlStr)}
          {dailyPnlPct !== null && (
            <span className="text-text-muted"> {fmtPct(dailyPnlPct)}</span>
          )}
        </>
      ),
    },
    { label: "Long Exposure", value: fmtPnl(account.longMarketValue, { plus: false }) },
    { label: "DT Buying Power", value: fmtPnl(account.daytradingBuyingPower, { plus: false }) },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StatusBadge status={account.status === "ACTIVE" ? "ACTIVE_ACCOUNT" : account.status} />
        <span className="text-xs text-muted-foreground">
          Account {account.accountNumber} · {account.currency}
        </span>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <MetaGrid items={items} className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" />
      </div>
    </div>
  );
}

// ── Positions table ───────────────────────────────────────────────────────────

function PositionsTable({ positions }: { positions: PositionData[] }) {
  if (positions.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        No open positions
      </div>
    );
  }

  const sorted = [...positions].sort(
    (a, b) => parseFloat(b.marketValue ?? "0") - parseFloat(a.marketValue ?? "0"),
  );

  return (
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
            <td className="px-3 py-2 text-right tabular-nums">{fmtSize(p.qty)}</td>
            <td className="px-3 py-2 text-right tabular-nums">${fmtPrice(p.currentPrice)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtPnl(p.marketValue, { plus: false })}</td>
            <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(p.unrealizedPl))}>
              {fmtPnl(p.unrealizedPl)}
            </td>
            <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(p.unrealizedPlPct))}>
              {p.unrealizedPlPct != null ? fmtPct(parseFloat(p.unrealizedPlPct) * 100) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
  // §4.2: Positions/Orders share one TerminalPanel with two PanelTabs. The
  // active tab is arrangement-like (no shared-link requirement), so it stays
  // component-local rather than in the URL.
  const [bookTab, setBookTab] = useState<"positions" | "orders">("positions");

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

        {/* 4B — Positions / Orders (§4.2: one TerminalPanel, two PanelTabs) */}
        <TerminalPanel
          tabs={[
            {
              id: "positions",
              label: "Positions",
              count: positionsQ.data && positionsQ.data.length > 0 ? positionsQ.data.length : undefined,
            },
            { id: "orders", label: "Orders" },
          ]}
          activeTab={bookTab}
          onTabChange={(id) => setBookTab(id as "positions" | "orders")}
        >
          {bookTab === "positions" ? (
            positionsQ.isLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading positions…</div>
            ) : (
              <PositionsTable positions={positionsQ.data ?? []} />
            )
          ) : (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No orders — the backend does not expose an orders endpoint yet.
            </div>
          )}
        </TerminalPanel>

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
