/**
 * Correlation math for the B4 heatmap (build doc §15.1). Pure functions, no
 * React, no DOM — so the panel is a view on this and the numbers are testable
 * on their own (tests/correlation.test.mjs).
 *
 * Correlation is computed on RETURNS, never on prices. Two rising price series
 * correlate near +1 whatever they do day to day (both are dominated by their
 * trend), which is the classic way to produce a matrix that is entirely red-
 * hot and says nothing. Log returns also make the number scale-free, so a $600
 * stock and a $12 stock are comparable.
 */

export interface Bar {
  time: string;
  close: number;
}

/** Pearson correlation of two equal-length samples; null if undefined. */
export function pearson(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  // A flat series has zero variance and no correlation with anything — null,
  // not 0, because "no relationship" and "not defined" are different answers.
  if (varA === 0 || varB === 0) return null;
  return cov / Math.sqrt(varA * varB);
}

/**
 * Align N bar series onto their COMMON timestamps and return log returns per
 * series. Symbols with different histories (a late IPO, a gap-filled backfill)
 * would otherwise be compared bar-index to bar-index, which silently
 * correlates Tuesday against Thursday.
 */
export function alignedLogReturns(series: readonly (readonly Bar[])[]): number[][] {
  if (series.length === 0) return [];
  const maps = series.map((bars) => {
    const m = new Map<string, number>();
    for (const bar of bars) if (bar.close > 0) m.set(bar.time, bar.close);
    return m;
  });

  // Intersect on the smallest series — the common grid can be no larger.
  let smallest = 0;
  for (let i = 1; i < maps.length; i++) if (maps[i].size < maps[smallest].size) smallest = i;

  const common: string[] = [];
  for (const time of maps[smallest].keys()) {
    if (maps.every((m) => m.has(time))) common.push(time);
  }
  common.sort();
  if (common.length < 3) return series.map(() => []);

  return maps.map((m) => {
    const out: number[] = [];
    for (let i = 1; i < common.length; i++) {
      out.push(Math.log(m.get(common[i])! / m.get(common[i - 1])!));
    }
    return out;
  });
}

/**
 * Symbol×symbol correlation matrix. NaN marks an undefined pair (too little
 * overlap, or a flat series) so the renderer can paint it as "no data" rather
 * than as zero — a fabricated 0 would read as "uncorrelated", which is a claim.
 */
export function correlationMatrix(series: readonly (readonly Bar[])[]): number[][] {
  const returns = alignedLogReturns(series);
  const n = returns.length;
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(NaN));
  for (let i = 0; i < n; i++) {
    out[i][i] = returns[i].length >= 2 ? 1 : NaN;
    for (let j = i + 1; j < n; j++) {
      const r = pearson(returns[i], returns[j]);
      out[i][j] = r === null ? NaN : r;
      out[j][i] = out[i][j];
    }
  }
  return out;
}
