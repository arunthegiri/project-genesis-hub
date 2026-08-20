import type { ColumnPreset } from "../presets";

/**
 * B1 strategy table (build doc §15.2, plan §4.1) — a column preset, not a
 * component. Everything here is data; the table that renders it is the same
 * TerminalTable that renders positions and trades.
 *
 * Per-cell rules (plan §4.1), each answering its own question:
 *   · Sharpe      vs SHARPE_FLOOR (1.0) — "is this worth deploying?", not
 *                 "is it positive?". A 0.4 Sharpe is a positive number and a
 *                 bad strategy, and colouring it green would say otherwise.
 *   · Return      vs 0 — did it make money.
 *   · Max DD      always dir-down past DD_TOLERANCE, never green: a drawdown
 *                 is a cost, and a small one is not an achievement.
 *   · Win rate    vs 50% — the coin-flip line.
 *   · Sparkline   coloured by terminal direction against starting equity.
 */

export type StrategySource = "Python SDK" | "ONNX" | "C++";
export type StrategyMode = "backtest" | "paper" | "live";

export interface StrategyRow {
  /** Stable id — the strategy name, which is also the API key. */
  name: string;
  source: StrategySource;
  mode: StrategyMode;
  symbols: string[];
  sharpe: number | null;
  /** Percent units (12.34 → +12.34%). */
  returnPct: number | null;
  /** Percent units, positive magnitude (8.2 → a 8.2% drawdown). */
  maxDrawdownPct: number | null;
  /** Percent units. */
  winRatePct: number | null;
  trades: number | null;
  /** ISO timestamp of the newest stored run, or null if never run. */
  lastRun: string | null;
  /** Cumulative equity points for the sparkline (may be empty). */
  equity: number[];
}

/** Below this a strategy is not deployable, whatever the sign of its return. */
export const SHARPE_FLOOR = 1;
/** Drawdowns under this are noise; past it the number goes red. */
export const DD_TOLERANCE = 5;

const SOURCE_TONE = {
  "Python SDK": "info",
  ONNX: "warn",
  "C++": "neutral",
} as const;

const MODE_TONE = {
  backtest: "neutral",
  paper: "info",
  // Live money is the loudest state in the product (plan §4.6's rule applied
  // to a badge): it reads as consequence, not as "good".
  live: "down",
} as const;

const fmtDay = (iso: string | null): string => (iso ? iso.slice(0, 10) : "—");

export const STRATEGY_COLUMNS: readonly ColumnPreset<StrategyRow>[] = [
  {
    id: "name",
    header: "Strategy",
    width: 180,
    align: "left",
    cell: (s) => ({ type: "text", value: s.name, mono: true, strong: true }),
    sortValue: (s) => s.name,
  },
  {
    id: "source",
    header: "Source",
    width: 92,
    align: "left",
    cell: (s) => ({ type: "badge", value: s.source, tone: SOURCE_TONE[s.source] }),
    sortValue: (s) => s.source,
  },
  {
    id: "mode",
    header: "Mode",
    // 96, not 82: "BACKTEST" is the longest badge and truncated at the old width.
    width: 96,
    align: "left",
    cell: (s) => ({ type: "badge", value: s.mode.toUpperCase(), tone: MODE_TONE[s.mode] }),
    sortValue: (s) => s.mode,
  },
  {
    id: "symbols",
    header: "Symbols",
    width: 132,
    align: "left",
    cell: (s) => ({ type: "chips", values: s.symbols.slice(0, 3) }),
    sortValue: (s) => s.symbols.join(","),
  },
  {
    id: "sharpe",
    header: "Sharpe",
    width: 78,
    align: "right",
    cell: (s) => ({ type: "dir", value: s.sharpe, reference: SHARPE_FLOOR, kind: "ratio" }),
    sortValue: (s) => s.sharpe,
  },
  {
    id: "return",
    header: "Return",
    width: 88,
    align: "right",
    cell: (s) => ({ type: "pct", value: s.returnPct }),
    sortValue: (s) => s.returnPct,
  },
  {
    id: "maxDd",
    header: "Max DD",
    width: 84,
    align: "right",
    // A drawdown is a percent, and it is never green: past tolerance the
    // reference is +Infinity so toneFor lands on "down"; under tolerance the
    // reference is the value itself, which renders flat grey.
    cell: (s) => ({
      type: "pct",
      value: s.maxDrawdownPct,
      plus: false,
      reference:
        s.maxDrawdownPct !== null && s.maxDrawdownPct > DD_TOLERANCE
          ? Number.POSITIVE_INFINITY
          : (s.maxDrawdownPct ?? 0),
    }),
    sortValue: (s) => s.maxDrawdownPct,
  },
  {
    id: "winRate",
    header: "Win %",
    width: 76,
    align: "right",
    cell: (s) => ({ type: "pct", value: s.winRatePct, plus: false, reference: 50 }),
    sortValue: (s) => s.winRatePct,
  },
  {
    id: "trades",
    header: "Trades",
    width: 74,
    align: "right",
    cell: (s) => ({ type: "num", value: s.trades, kind: "size" }),
    sortValue: (s) => s.trades,
  },
  {
    id: "lastRun",
    header: "Last Run",
    width: 96,
    align: "right",
    cell: (s) => ({ type: "text", value: fmtDay(s.lastRun), mono: true }),
    sortValue: (s) => s.lastRun,
  },
  {
    id: "equity",
    header: "Equity",
    width: 84,
    align: "left",
    cell: (s) => ({ type: "spark", points: s.equity, reference: s.equity[0] ?? null }),
  },
];
