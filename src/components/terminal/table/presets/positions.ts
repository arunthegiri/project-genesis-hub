import type { PositionData } from "@/lib/api/live";
import { num, type ColumnPreset } from "../presets";

/**
 * Live positions columns (build doc §8.2 item 1) — pure data, no JSX. This is
 * the reference for what a preset looks like; B1/B2 (M6) are new arrays in this
 * folder, not new components.
 *
 * Per-cell colouring, and why adjacent columns disagree on purpose:
 *   · `last`   is compared against the PREVIOUS CLOSE  → today's direction
 *   · `chg`    is the same comparison, expressed as a % → same colour as `last`
 *   · `pnl`/`pnl%` are compared against ZERO           → direction since ENTRY
 *
 * Those are different questions, so a position bought above the current price
 * during a green day renders green `last` and red `pnl` in one row. §8.3 calls
 * this the reference behaviour explicitly: it looks like a bug and is not one.
 */
export const POSITION_COLUMNS: readonly ColumnPreset<PositionData>[] = [
  {
    id: "symbol",
    header: "Symbol",
    width: 96,
    align: "left",
    cell: (p) => ({ type: "text", value: p.symbol, mono: true, strong: true }),
    sortValue: (p) => p.symbol,
  },
  {
    id: "side",
    header: "Side",
    width: 64,
    align: "left",
    cell: (p) => ({
      type: "badge",
      value: (p.side ?? "").toUpperCase() || "—",
      tone: p.side === "long" ? "up" : p.side === "short" ? "down" : "neutral",
    }),
    sortValue: (p) => p.side ?? "",
  },
  {
    id: "qty",
    header: "Qty",
    width: 84,
    align: "right",
    cell: (p) => ({ type: "num", value: num(p.qty), kind: "size" }),
    sortValue: (p) => num(p.qty),
  },
  {
    id: "avgEntry",
    header: "Avg Entry",
    width: 96,
    align: "right",
    // Not a backend field — cost basis over quantity, computed here so the
    // preset stays the single place that knows the column exists.
    cell: (p) => {
      const qty = num(p.qty);
      const basis = num(p.costBasis);
      const avg = qty && basis !== null && qty !== 0 ? basis / qty : null;
      return { type: "num", value: avg, kind: "price", prefix: "$" };
    },
    sortValue: (p) => {
      const qty = num(p.qty);
      const basis = num(p.costBasis);
      return qty && basis !== null && qty !== 0 ? basis / qty : null;
    },
  },
  {
    id: "last",
    header: "Last",
    width: 96,
    align: "right",
    // Compared against the previous close — this cell answers "up today?".
    //
    // §14.4: this is the hot column. It renders the streamed price when the
    // socket is on and the polled `fallback` when it is off — same preset,
    // same row component, no second code path for "live mode".
    cell: (p) => ({
      type: "live",
      symbol: p.symbol,
      fallback: num(p.currentPrice),
      reference: num(p.lastdayPrice),
      kind: "price",
    }),
    sortValue: (p) => num(p.currentPrice),
  },
  {
    id: "marketValue",
    header: "Market Value",
    width: 120,
    align: "right",
    // Deliberately uncoloured: size is not a direction.
    cell: (p) => ({ type: "num", value: num(p.marketValue), kind: "price", prefix: "$" }),
    sortValue: (p) => num(p.marketValue),
  },
  {
    id: "pnl",
    header: "Unrealized P&L",
    width: 124,
    align: "right",
    // Compared against zero — this cell answers "up since entry?".
    cell: (p) => ({ type: "dir", value: num(p.unrealizedPl), reference: 0, kind: "pnl" }),
    sortValue: (p) => num(p.unrealizedPl),
  },
  {
    id: "pnlPct",
    header: "P&L %",
    width: 88,
    align: "right",
    // Backend sends a fraction; the cell wants percent units.
    cell: (p) => {
      const v = num(p.unrealizedPlPct);
      return { type: "pct", value: v === null ? null : v * 100 };
    },
    sortValue: (p) => num(p.unrealizedPlPct),
  },
  {
    id: "changeToday",
    header: "Chg Today",
    width: 96,
    align: "right",
    cell: (p) => {
      const v = num(p.changeToday);
      return { type: "pct", value: v === null ? null : v * 100 };
    },
    sortValue: (p) => num(p.changeToday),
  },
];
