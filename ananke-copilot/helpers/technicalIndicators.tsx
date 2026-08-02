export const technicalIndicators = {
  /**
   * Wilder's Relative Strength Index (RSI).
   * Matches Python's ananke.indicators.rsi implementation.
   *
   * @param closes Array of closing prices
   * @param period Lookback period
   * @returns Array of RSI values, first `period` elements are NaN.
   */
  rsi(closes: number[], period: number): number[] {
    const n = closes.length;
    const result = new Array(n).fill(NaN);
    if (n <= period) return result;

    let gainSum = 0;
    let lossSum = 0;

    // Seed: simple average of first `period` changes
    for (let i = 1; i <= period; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gainSum += change;
      else lossSum -= change; // Add magnitude of loss
    }

    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;

    const calculateRsi = (ag: number, al: number) => {
      if (al === 0) return 100.0;
      const rs = ag / al;
      return 100.0 - (100.0 / (1.0 + rs));
    };

    result[period] = calculateRsi(avgGain, avgLoss);

    // Wilder's smoothing for the remainder
    for (let i = period + 1; i < n; i++) {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0.0;
      const loss = change < 0 ? -change : 0.0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      result[i] = calculateRsi(avgGain, avgLoss);
    }

    return result;
  },

  /**
   * Exponential Moving Average (EMA).
   * Matches Python's ananke.indicators.ema implementation (adjust=False).
   *
   * @param closes Array of closing prices
   * @param period Period over which EMA is calculated
   * @returns Array of EMA values, seeded with the first price.
   */
  ema(closes: number[], period: number): number[] {
    const n = closes.length;
    const result = new Array(n).fill(0);
    if (n === 0) return result;

    const alpha = 2.0 / (period + 1);
    result[0] = closes[0];

    for (let i = 1; i < n; i++) {
      result[i] = alpha * closes[i] + (1 - alpha) * result[i - 1];
    }

    return result;
  },
};