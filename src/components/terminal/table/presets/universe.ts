import type { ColumnPreset } from "../presets";
import { DD_TOLERANCE, SHARPE_FLOOR } from "./strategies";

/**
 * B2 universe / symbol-ranking table (build doc §15.2, plan §4.2) — the same
 * TerminalTable, a second preset. "Rank by Sharpe, human promotes the winners"
 * is the V2/V3 staircase, so the two things this table must do well are sort
 * and multi-select.
 *
 * Substitution note: the plan asks for a sector chip beside the symbol. The
 * backend's `Symbol` DTO is `{ symbol }` and nothing else — there is no sector
 * anywhere in the system — so the chip column carries RUN STATUS instead
 * (queued / running / failed), which the ranking flow actually produces and
 * the user actually needs while N backtests fill in. A sector chip goes back
 * in the moment the symbols endpoint grows the field.
 */

export type UniverseStatus = "idle" | "queued" | "running" | "done" | "failed";

export interface UniverseRow {
  symbol: string;
  status: UniverseStatus;
  sharpe: number | null;
  returnPct: number | null;
  maxDrawdownPct: number | null;
  winRatePct: number | null;
  trades: number | null;
  equity: number[];
}

const STATUS_TONE = {
  idle: "neutral",
  queued: "neutral",
  running: "info",
  done: "up",
  failed: "down",
} as const;

export const UNIVERSE_COLUMNS: readonly ColumnPreset<UniverseRow>[] = [
  {
    id: "select",
    header: "",
    width: 34,
    align: "left",
    cell: () => ({ type: "check" }),
  },
  {
    id: "symbol",
    header: "Symbol",
    width: 96,
    align: "left",
    cell: (r) => ({ type: "text", value: r.symbol, mono: true, strong: true }),
    sortValue: (r) => r.symbol,
  },
  {
    id: "status",
    header: "Run",
    width: 88,
    align: "left",
    cell: (r) => ({ type: "badge", value: r.status.toUpperCase(), tone: STATUS_TONE[r.status] }),
    sortValue: (r) => r.status,
  },
  {
    id: "sharpe",
    header: "Sharpe",
    width: 82,
    align: "right",
    cell: (r) => ({ type: "dir", value: r.sharpe, reference: SHARPE_FLOOR, kind: "ratio" }),
    sortValue: (r) => r.sharpe,
  },
  {
    id: "return",
    header: "Return",
    width: 90,
    align: "right",
    cell: (r) => ({ type: "pct", value: r.returnPct }),
    sortValue: (r) => r.returnPct,
  },
  {
    id: "maxDd",
    header: "Max DD",
    width: 86,
    align: "right",
    // Same rule as B1: a drawdown past tolerance is always red, never green.
    cell: (r) => ({
      type: "pct",
      value: r.maxDrawdownPct,
      plus: false,
      reference:
        r.maxDrawdownPct !== null && r.maxDrawdownPct > DD_TOLERANCE
          ? Number.POSITIVE_INFINITY
          : (r.maxDrawdownPct ?? 0),
    }),
    sortValue: (r) => r.maxDrawdownPct,
  },
  {
    id: "winRate",
    header: "Win %",
    width: 78,
    align: "right",
    cell: (r) => ({ type: "pct", value: r.winRatePct, plus: false, reference: 50 }),
    sortValue: (r) => r.winRatePct,
  },
  {
    id: "trades",
    header: "Trades",
    width: 76,
    align: "right",
    cell: (r) => ({ type: "num", value: r.trades, kind: "size" }),
    sortValue: (r) => r.trades,
  },
  {
    id: "equity",
    header: "Equity",
    width: 84,
    align: "left",
    cell: (r) => ({ type: "spark", points: r.equity, reference: r.equity[0] ?? null }),
  },
];
