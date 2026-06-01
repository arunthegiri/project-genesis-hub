package com.stocktracker.service;

import java.math.BigDecimal;
import java.util.List;

/**
 * Stateless indicator computations that mirror the Python ananke.indicators module.
 * All methods return double arrays aligned to the input; NaN fills the warm-up period.
 */
public final class TechnicalIndicators {

    private TechnicalIndicators() {}

    /**
     * Wilder's RSI (same algorithm as ananke.indicators.rsi).
     *
     * Warm-up: first {@code period} values are NaN.
     * After warm-up, the first RSI is the simple average of the first {@code period} gains/losses.
     * Subsequent values use Wilder's smoothing: avgGain = (prevAvgGain*(N-1) + gain) / N.
     */
    public static double[] rsi(List<BigDecimal> closes, int period) {
        int n = closes.size();
        double[] result = new double[n];
        for (int i = 0; i < n; i++) result[i] = Double.NaN;
        if (n <= period) return result;

        double[] close = new double[n];
        for (int i = 0; i < n; i++) close[i] = closes.get(i).doubleValue();

        // Seed: simple average of first `period` changes
        double gainSum = 0, lossSum = 0;
        for (int i = 1; i <= period; i++) {
            double change = close[i] - close[i - 1];
            if (change > 0) gainSum += change;
            else            lossSum += -change;
        }
        double avgGain = gainSum / period;
        double avgLoss = lossSum / period;
        result[period] = rsiFromAvg(avgGain, avgLoss);

        // Wilder's smoothing for the rest
        for (int i = period + 1; i < n; i++) {
            double change = close[i] - close[i - 1];
            double gain = change > 0 ? change : 0.0;
            double loss = change < 0 ? -change : 0.0;
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
            result[i] = rsiFromAvg(avgGain, avgLoss);
        }

        return result;
    }

    private static double rsiFromAvg(double avgGain, double avgLoss) {
        if (avgLoss == 0) return 100.0;
        double rs = avgGain / avgLoss;
        return 100.0 - (100.0 / (1.0 + rs));
    }

    /**
     * EMA with alpha = 2/(period+1), matching ananke.indicators.ema (adjust=False).
     * Seeded with the first price; no NaN warm-up period.
     */
    public static double[] ema(List<BigDecimal> closes, int period) {
        int n = closes.size();
        double[] result = new double[n];
        if (n == 0) return result;

        double alpha = 2.0 / (period + 1);
        result[0] = closes.get(0).doubleValue();
        for (int i = 1; i < n; i++) {
            result[i] = alpha * closes.get(i).doubleValue() + (1 - alpha) * result[i - 1];
        }
        return result;
    }
}
