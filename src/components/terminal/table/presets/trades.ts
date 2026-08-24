import type { Trade } from "@/lib/api/types";
import type { BacktestTrade } from "@/lib/api/strategies";
import { num, type ColumnPreset } from "../presets";

/**
 * Trade log columns (build doc §8.2 item 2). The log lives in a narrow rail,
 * so the 3-line card became a single-line row: side badge · in→out times ·
 * P&L. Entry/exit PRICES are the one deliberate drop (settled 2026-08-10 —
 * recorded in the doc's §8.2 amendment): they stay visible as chart markers.
 * The rail was widened 260→280px for this port; widths budget to its
 * interior: 18px grip + 68 + 96 + 90 = 272 ≤ 278px. `mono` cells are
 * JetBrains Mono text-xs (~7.2px/char): "09:35→11:02" is 11 chars ≈ 80px +
 * 16px padding fits the 98px column.
 */

/** Normalized row — Trade (live) and BacktestTrade (strategy) both map here. */
export interface TradeLogRow {
  id: string;
  direction: "long" | "short";
  /** "HH:mm" display strings, already formatted. */
  entry: string;
  exit: string | null;
  pnl: number;
}

const hhmm = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
};

/** `i` is the trade's index in the source array — the log has no selection,
    so index identity is sufficient (rows arrive append-only). */
export function tradeToRow(t: Trade, i: number): TradeLogRow {
  return {
    id: String(i),
    direction: t.side === "LONG" ? "long" : "short",
    entry: hhmm(t.entryTime) ?? "—",
    exit: hhmm(t.exitTime),
    pnl: t.pnl,
  };
}

export function backtestTradeToRow(t: BacktestTrade, i: number): TradeLogRow {
  return {
    id: String(i),
    direction: t.direction === "long" ? "long" : "short",
    entry: hhmm(t.entry_time) ?? "—",
    exit: hhmm(t.exit_time),
    pnl: t.pnl ?? 0,
  };
}

export const TRADE_LOG_COLUMNS: readonly ColumnPreset<TradeLogRow>[] = [
  {
    id: "side",
    header: "Side",
    width: 68,
    align: "left",
    cell: (t) => ({
      type: "badge",
      value: t.direction === "long" ? "LONG" : "SHORT",
      tone: t.direction === "long" ? "up" : "down",
    }),
  },
  {
    id: "times",
    header: "In → Out",
    width: 96,
    align: "left",
    cell: (t) => ({ type: "text", value: `${t.entry}→${t.exit ?? "—"}`, mono: true }),
  },
  {
    id: "pnl",
    header: "P&L",
    width: 90,
    align: "right",
    cell: (t) => ({ type: "dir", value: num(t.pnl), reference: 0, kind: "pnl" }),
  },
];
