package com.stocktracker.service;

import com.stocktracker.dto.ApiDto;
import com.stocktracker.model.StockPrice;
import com.stocktracker.model.Strategy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.*;

/**
 * Re-runs a stored strategy definition against a new set of price bars.
 * Mirrors the bar-by-bar logic in ananke-sdk/ananke/kairos.py.
 *
 * Currently supports definition type: "rsi_crossover".
 */
@Slf4j
@Service
public class BacktestEngineService {

    /**
     * Re-run the strategy on the given bars and return a full backtest result.
     * Results are NOT persisted — they are returned directly for live previewing.
     */
    public ApiDto.BacktestResultResponse run(Strategy strategy, List<StockPrice> bars, String symbol) {
        if (bars.isEmpty()) {
            return emptyResult(symbol);
        }

        Map<String, Object> def = strategy.getDefinition();
        String type = str(def, "type", "generic");

        return switch (type) {
            case "rsi_crossover" -> runRsiCrossover(def, bars, symbol);
            case "ema_crossover" -> runEmaCrossover(def, bars, symbol);
            default -> throw new UnsupportedOperationException(
                    "Strategy type '" + type + "' cannot be re-run from the dashboard. " +
                    "Use params={\"type\":\"rsi_crossover\",...} when calling k.export().");
        };
    }

    // ── RSI Crossover ─────────────────────────────────────────────────────────

    private ApiDto.BacktestResultResponse runRsiCrossover(
            Map<String, Object> def, List<StockPrice> bars, String symbol) {

        int    period           = intVal(def, "rsi_period",          14);
        double longEntryBelow   = dblVal(def, "long_entry_rsi_below", Double.NaN);
        double shortEntryAbove  = dblVal(def, "short_entry_rsi_above", Double.NaN);
        double longExitAbove    = dblVal(def, "long_exit_rsi_above",  Double.NaN);
        double shortExitBelow   = dblVal(def, "short_exit_rsi_below", Double.NaN);
        double stopLoss         = dblVal(def, "stop_loss",    Double.NaN);
        double takeProfitPct    = dblVal(def, "take_profit",  Double.NaN);
        double quantity         = dblVal(def, "quantity",     1.0);

        boolean hasLong  = !Double.isNaN(longEntryBelow);
        boolean hasShort = !Double.isNaN(shortEntryAbove);

        // Compute RSI over all closes
        List<BigDecimal> closes = bars.stream().map(StockPrice::getClose).toList();
        double[] rsiVals = TechnicalIndicators.rsi(closes, period);

        // Bar-by-bar simulation
        List<Map<String, Object>> trades = new ArrayList<>();
        List<double[]>            equity = new ArrayList<>(); // [epochSec, cumulativePnl]
        OpenTrade openTrade = null;
        double cumPnl = 0.0;

        for (int i = 0; i < bars.size(); i++) {
            StockPrice current = bars.get(i);
            StockPrice next    = i < bars.size() - 1 ? bars.get(i + 1) : null;
            double rsi         = rsiVals[i];
            boolean rsiReady   = !Double.isNaN(rsi);

            // A. Manage open trade
            if (openTrade != null) {
                boolean closed = false;

                double price = current.getClose().doubleValue();

                // Stop loss
                if (!closed && !Double.isNaN(stopLoss)) {
                    boolean slHit = openTrade.long_
                            ? price < openTrade.entryPrice * (1 - stopLoss)
                            : price > openTrade.entryPrice * (1 + stopLoss);
                    if (slHit) {
                        Map<String, Object> t = closeTrade(openTrade, current.getTime(), price, quantity);
                        trades.add(t);
                        cumPnl += (double) t.get("pnl");
                        openTrade = null;
                        closed = true;
                    }
                }

                // Take profit
                if (!closed && !Double.isNaN(takeProfitPct)) {
                    boolean tpHit = openTrade.long_
                            ? price > openTrade.entryPrice * (1 + takeProfitPct)
                            : price < openTrade.entryPrice * (1 - takeProfitPct);
                    if (tpHit) {
                        Map<String, Object> t = closeTrade(openTrade, current.getTime(), price, quantity);
                        trades.add(t);
                        cumPnl += (double) t.get("pnl");
                        openTrade = null;
                        closed = true;
                    }
                }

                // RSI exit condition
                if (!closed && rsiReady) {
                    boolean exitLong  = openTrade.long_  && !Double.isNaN(longExitAbove)  && rsi > longExitAbove;
                    boolean exitShort = !openTrade.long_ && !Double.isNaN(shortExitBelow) && rsi < shortExitBelow;
                    if (exitLong || exitShort) {
                        Map<String, Object> t = closeTrade(openTrade, current.getTime(), price, quantity);
                        trades.add(t);
                        cumPnl += (double) t.get("pnl");
                        openTrade = null;
                        closed = true;
                    }
                }

                // Last bar — force close
                if (!closed && next == null) {
                    Map<String, Object> t = closeTrade(openTrade, current.getTime(), current.getClose().doubleValue(), quantity);
                    trades.add(t);
                    cumPnl += (double) t.get("pnl");
                    openTrade = null;
                }

            } else if (next != null && rsiReady) {
                // B. Check entry
                double entryPrice = next.getOpen().doubleValue();
                if (hasLong && rsi < longEntryBelow) {
                    openTrade = new OpenTrade(true, next.getTime(), entryPrice, stopLoss, takeProfitPct);
                } else if (hasShort && rsi > shortEntryAbove) {
                    openTrade = new OpenTrade(false, next.getTime(), entryPrice, stopLoss, takeProfitPct);
                }
            }

            // C. Track equity
            equity.add(new double[]{ current.getTime().getEpochSecond(), cumPnl });
        }

        return buildResult(symbol, bars, trades, equity);
    }

    // ── EMA Crossover ─────────────────────────────────────────────────────────

    private ApiDto.BacktestResultResponse runEmaCrossover(
            Map<String, Object> def, List<StockPrice> bars, String symbol) {

        int    fastPeriod    = intVal(def, "fast_period", 9);
        int    slowPeriod    = intVal(def, "slow_period", 21);
        double stopLoss      = dblVal(def, "stop_loss",   Double.NaN);
        double takeProfit    = dblVal(def, "take_profit", Double.NaN);
        double quantity      = dblVal(def, "quantity",    1.0);

        List<BigDecimal> closes = bars.stream().map(StockPrice::getClose).toList();
        double[] fast = TechnicalIndicators.ema(closes, fastPeriod);
        double[] slow = TechnicalIndicators.ema(closes, slowPeriod);

        List<Map<String, Object>> trades = new ArrayList<>();
        List<double[]>            equity = new ArrayList<>();
        OpenTrade openTrade = null;
        double cumPnl = 0.0;

        for (int i = 0; i < bars.size(); i++) {
            StockPrice current = bars.get(i);
            StockPrice next    = i < bars.size() - 1 ? bars.get(i + 1) : null;

            boolean goldenCross = i > 0 && fast[i] > slow[i] && fast[i - 1] <= slow[i - 1];
            boolean deathCross  = i > 0 && fast[i] < slow[i] && fast[i - 1] >= slow[i - 1];

            // A. Manage open trade
            if (openTrade != null) {
                boolean closed = false;
                double price = current.getClose().doubleValue();

                // Stop loss
                if (!closed && !Double.isNaN(stopLoss)) {
                    boolean slHit = openTrade.long_
                            ? price < openTrade.entryPrice * (1 - stopLoss)
                            : price > openTrade.entryPrice * (1 + stopLoss);
                    if (slHit) {
                        Map<String, Object> t = closeTrade(openTrade, current.getTime(), price, quantity);
                        trades.add(t); cumPnl += (double) t.get("pnl"); openTrade = null; closed = true;
                    }
                }

                // Take profit
                if (!closed && !Double.isNaN(takeProfit)) {
                    boolean tpHit = openTrade.long_
                            ? price > openTrade.entryPrice * (1 + takeProfit)
                            : price < openTrade.entryPrice * (1 - takeProfit);
                    if (tpHit) {
                        Map<String, Object> t = closeTrade(openTrade, current.getTime(), price, quantity);
                        trades.add(t); cumPnl += (double) t.get("pnl"); openTrade = null; closed = true;
                    }
                }

                // Crossover exit (opposite signal)
                if (!closed && ((openTrade.long_ && deathCross) || (!openTrade.long_ && goldenCross))) {
                    Map<String, Object> t = closeTrade(openTrade, current.getTime(), price, quantity);
                    trades.add(t); cumPnl += (double) t.get("pnl"); openTrade = null; closed = true;
                }

                // Last bar — force close
                if (!closed && next == null) {
                    Map<String, Object> t = closeTrade(openTrade, current.getTime(), current.getClose().doubleValue(), quantity);
                    trades.add(t); cumPnl += (double) t.get("pnl"); openTrade = null;
                }

            } else if (next != null) {
                // B. Check entry on crossover
                double entryPrice = next.getOpen().doubleValue();
                if (goldenCross) {
                    openTrade = new OpenTrade(true,  next.getTime(), entryPrice, stopLoss, takeProfit);
                } else if (deathCross) {
                    openTrade = new OpenTrade(false, next.getTime(), entryPrice, stopLoss, takeProfit);
                }
            }

            // C. Track equity
            equity.add(new double[]{ current.getTime().getEpochSecond(), cumPnl });
        }

        return buildResult(symbol, bars, trades, equity);
    }

    // ── Trade helpers ─────────────────────────────────────────────────────────

    private record OpenTrade(boolean long_, Instant entryTime, double entryPrice,
                             double stopLoss, double takeProfit) {}

    private static Map<String, Object> closeTrade(
            OpenTrade t, Instant exitTime, double exitPrice, double quantity) {

        double rawPnl = t.long_
                ? (exitPrice - t.entryPrice) * quantity
                : (t.entryPrice - exitPrice) * quantity;
        double pnl    = round4(rawPnl);
        double pnlPct = round4((exitPrice - t.entryPrice) / t.entryPrice * 100 * (t.long_ ? 1 : -1));

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("trade_id",    UUID.randomUUID().toString());
        m.put("direction",   t.long_ ? "long" : "short");
        m.put("entry_time",  t.entryTime.toString());
        m.put("entry_price", round4(t.entryPrice));
        m.put("exit_time",   exitTime.toString());
        m.put("exit_price",  round4(exitPrice));
        m.put("quantity",    quantity);
        m.put("stop_loss",   Double.isNaN(t.stopLoss) ? null : t.stopLoss);
        m.put("take_profit", Double.isNaN(t.takeProfit) ? null : t.takeProfit);
        m.put("status",      "closed");
        m.put("pnl",         pnl);
        m.put("pnl_pct",     pnlPct);
        m.put("win",         pnl >= 0);
        return m;
    }

    // ── Stats builder ─────────────────────────────────────────────────────────

    private static ApiDto.BacktestResultResponse buildResult(
            String symbol, List<StockPrice> bars,
            List<Map<String, Object>> trades, List<double[]> equity) {

        int total    = trades.size();
        int winning  = (int) trades.stream().filter(t -> Boolean.TRUE.equals(t.get("win"))).count();
        int losing   = total - winning;
        double winRate = total > 0 ? round4(winning * 100.0 / total) : 0.0;

        List<Double> pnls    = trades.stream().map(t -> (double) t.get("pnl")).toList();
        List<Double> winPnls = trades.stream().filter(t -> Boolean.TRUE.equals(t.get("win"))).map(t -> (double) t.get("pnl")).toList();
        List<Double> losPnls = trades.stream().filter(t -> Boolean.FALSE.equals(t.get("win"))).map(t -> (double) t.get("pnl")).toList();

        double totalPnl    = round4(pnls.stream().mapToDouble(d -> d).sum());
        double avgWin      = winPnls.isEmpty() ? 0 : round4(winPnls.stream().mapToDouble(d->d).average().orElse(0));
        double avgLoss     = losPnls.isEmpty() ? 0 : round4(losPnls.stream().mapToDouble(d->d).average().orElse(0));
        double largestWin  = pnls.isEmpty() ? 0 : round4(pnls.stream().mapToDouble(d->d).max().orElse(0));
        double largestLoss = pnls.isEmpty() ? 0 : round4(pnls.stream().mapToDouble(d->d).min().orElse(0));

        double winSum      = winPnls.stream().mapToDouble(d->d).sum();
        double lossAbs     = Math.abs(losPnls.stream().mapToDouble(d->d).sum());
        double profitFactor = (!winPnls.isEmpty() && !losPnls.isEmpty()) ? round4(winSum / lossAbs)
                             : winPnls.isEmpty() ? 0.0 : Double.MAX_VALUE; // ∞ capped

        double maxDrawdown = calcMaxDrawdown(equity);
        double sharpe      = calcSharpe(trades);
        double totalPnlPct = round4(trades.stream().mapToDouble(t -> (double)t.get("pnl_pct")).sum());

        List<Map<String, Object>> equityCurve = equity.stream().map(e -> {
            Map<String, Object> pt = new LinkedHashMap<>();
            pt.put("time",           Instant.ofEpochSecond((long) e[0]).toString());
            pt.put("cumulative_pnl", round4(e[1]));
            return pt;
        }).toList();

        ApiDto.BacktestResultResponse r = new ApiDto.BacktestResultResponse();
        r.setSymbol(symbol);
        r.setFromTs(bars.isEmpty() ? null : bars.get(0).getTime());
        r.setToTs(bars.isEmpty() ? null : bars.get(bars.size() - 1).getTime());
        r.setTotalTrades(total);
        r.setWinningTrades(winning);
        r.setLosingTrades(losing);
        r.setWinRate(new BigDecimal(String.valueOf(winRate)));
        r.setTotalPnl(new BigDecimal(String.valueOf(totalPnl)));
        r.setTotalPnlPct(new BigDecimal(String.valueOf(totalPnlPct)));
        r.setAvgWin(new BigDecimal(String.valueOf(avgWin)));
        r.setAvgLoss(new BigDecimal(String.valueOf(avgLoss)));
        r.setLargestWin(new BigDecimal(String.valueOf(largestWin)));
        r.setLargestLoss(new BigDecimal(String.valueOf(largestLoss)));
        r.setProfitFactor(profitFactor == Double.MAX_VALUE ? null : new BigDecimal(String.valueOf(profitFactor)));
        r.setMaxDrawdown(new BigDecimal(String.valueOf(maxDrawdown)));
        r.setSharpeRatio(new BigDecimal(String.valueOf(sharpe)));
        r.setTrades(trades);
        r.setEquityCurve(equityCurve);
        r.setCreatedAt(Instant.now());
        return r;
    }

    private static double calcMaxDrawdown(List<double[]> equity) {
        double peak = 0, maxDd = 0;
        for (double[] pt : equity) {
            double val = pt[1];
            if (val > peak) peak = val;
            double dd = peak > 0 ? (peak - val) / peak * 100 : 0;
            if (dd > maxDd) maxDd = dd;
        }
        return round4(maxDd);
    }

    private static double calcSharpe(List<Map<String, Object>> trades) {
        if (trades.size() < 2) return 0.0;
        List<Double> returns = trades.stream()
                .map(t -> (double) t.get("pnl_pct") / 100.0)
                .toList();
        int n = returns.size();
        double mean = returns.stream().mapToDouble(d -> d).average().orElse(0);
        double variance = returns.stream().mapToDouble(r -> (r - mean) * (r - mean)).sum() / (n - 1);
        double std = Math.sqrt(variance);
        return std == 0 ? 0.0 : round4((mean / std) * Math.sqrt(252));
    }

    private static ApiDto.BacktestResultResponse emptyResult(String symbol) {
        ApiDto.BacktestResultResponse r = new ApiDto.BacktestResultResponse();
        r.setSymbol(symbol);
        r.setTotalTrades(0);
        r.setWinningTrades(0);
        r.setLosingTrades(0);
        r.setWinRate(BigDecimal.ZERO);
        r.setTotalPnl(BigDecimal.ZERO);
        r.setTotalPnlPct(BigDecimal.ZERO);
        r.setAvgWin(BigDecimal.ZERO);
        r.setAvgLoss(BigDecimal.ZERO);
        r.setLargestWin(BigDecimal.ZERO);
        r.setLargestLoss(BigDecimal.ZERO);
        r.setProfitFactor(BigDecimal.ZERO);
        r.setMaxDrawdown(BigDecimal.ZERO);
        r.setSharpeRatio(BigDecimal.ZERO);
        r.setTrades(List.of());
        r.setEquityCurve(List.of());
        r.setCreatedAt(Instant.now());
        return r;
    }

    // ── Definition param readers ──────────────────────────────────────────────

    private static String str(Map<String, Object> m, String key, String fallback) {
        Object v = m.get(key);
        return v instanceof String s ? s : fallback;
    }

    private static int intVal(Map<String, Object> m, String key, int fallback) {
        Object v = m.get(key);
        if (v == null) return fallback;
        return ((Number) v).intValue();
    }

    private static double dblVal(Map<String, Object> m, String key, double fallback) {
        Object v = m.get(key);
        if (v == null) return fallback;
        return ((Number) v).doubleValue();
    }

    private static double round4(double v) {
        return Math.round(v * 10000.0) / 10000.0;
    }
}
