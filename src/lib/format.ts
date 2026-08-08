/**
 * Terminal numeric formatting (build doc §7.3, plan §5.5).
 *
 * One formatter family for every numeric cell/readout, replacing the divergent
 * per-file fmt* helpers. Fixed precision per column type is what makes tabular
 * figures align: prices 2dp, percents 2dp with an explicit sign, sizes grouped,
 * PnL signed dollars. Pure functions, no deps. Every helper accepts the loose
 * string | number | null shapes the Spring API returns and renders "—" for
 * null/NaN.
 */

export type NumLike = number | string | null | undefined;

function toNumber(value: NumLike): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? parseFloat(value) : value;
  return Number.isNaN(n) ? null : n;
}

const grouped2dp = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const groupedInt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Price-like value: grouped, exactly 2 decimals (`25.30`, `1,319.80`). */
export function fmtPrice(value: NumLike): string {
  const n = toNumber(value);
  return n === null ? "—" : grouped2dp.format(n);
}

/**
 * Percent value already in % units (12.34 → "+12.34%"): 2dp with an explicit
 * `+` for non-negative values. Pass `{ plus: false }` for non-delta percents
 * (win rate, max drawdown) where a leading plus reads wrong.
 */
export function fmtPct(value: NumLike, opts?: { plus?: boolean }): string {
  const n = toNumber(value);
  if (n === null) return "—";
  const sign = (opts?.plus ?? true) && n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/**
 * Size / qty / volume / count: Intl grouping below 1M (`12,345`), compact
 * notation at 1M and above (`1.3M`) so the two never compete in adjacent cells.
 */
export function fmtSize(value: NumLike): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return Math.abs(n) >= 1_000_000 ? compact.format(n) : groupedInt.format(n);
}

/**
 * PnL dollars: explicit sign before the `$`, grouped 2dp
 * (`+$1,234.56` / `-$1,234.56`). `{ plus: false }` drops the positive sign for
 * plain dollar amounts that aren't a gain/loss (`$1,234.56`).
 */
export function fmtPnl(value: NumLike, opts?: { plus?: boolean }): string {
  const n = toNumber(value);
  if (n === null) return "—";
  const sign = n < 0 ? "-" : (opts?.plus ?? true) ? "+" : "";
  return `${sign}$${grouped2dp.format(Math.abs(n))}`;
}
