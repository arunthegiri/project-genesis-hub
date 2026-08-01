package com.stocktracker.service;

import com.stocktracker.dto.ApiDto;
import com.stocktracker.model.BacktestResult;
import com.stocktracker.model.StockPrice;
import com.stocktracker.model.Strategy;
import com.stocktracker.repository.BacktestResultRepository;
import com.stocktracker.repository.StockPriceRepository;
import com.stocktracker.repository.StrategyRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

@Slf4j
@Service
public class StrategyService {

    private final StrategyRepository      strategyRepo;
    private final BacktestResultRepository resultRepo;
    private final StockPriceRepository    priceRepo;
    private final BacktestEngineService   engine;

    public StrategyService(StrategyRepository strategyRepo,
                           BacktestResultRepository resultRepo,
                           StockPriceRepository priceRepo,
                           BacktestEngineService engine) {
        this.strategyRepo = strategyRepo;
        this.resultRepo   = resultRepo;
        this.priceRepo    = priceRepo;
        this.engine       = engine;
    }

    // ── Save (upsert) ─────────────────────────────────────────────────────────

    @Transactional
    public ApiDto.StrategyResponse saveStrategy(ApiDto.StrategyRequest req) {
        Strategy strategy = strategyRepo.findByName(req.getName())
                .map(existing -> {
                    existing.setDescription(req.getDescription());
                    existing.setDefinition(req.getDefinition());
                    existing.setUpdatedAt(Instant.now());
                    return existing;
                })
                .orElseGet(() -> Strategy.builder()
                        .name(req.getName())
                        .description(req.getDescription())
                        .definition(req.getDefinition())
                        .build());

        strategy = strategyRepo.save(strategy);

        BacktestResult result = buildBacktestResult(strategy, req);
        resultRepo.save(result);

        log.info("Strategy '{}' saved (id={})", strategy.getName(), strategy.getId());
        return toStrategyResponse(strategy);
    }

    // ── List all ──────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<ApiDto.StrategyResponse> getAllStrategies() {
        return strategyRepo.findAllByOrderByCreatedAtDesc()
                .stream()
                .map(this::toStrategyResponse)
                .toList();
    }

    // ── Get one with latest results ───────────────────────────────────────────

    @Transactional(readOnly = true)
    public ApiDto.StrategyDetailResponse getStrategy(String name) {
        Strategy strategy = strategyRepo.findByName(name)
                .orElseThrow(() -> new NoSuchElementException("Strategy not found: " + name));

        ApiDto.BacktestResultResponse latestResults = resultRepo
                .findTopByStrategyOrderByCreatedAtDesc(strategy)
                .map(this::toBacktestResultResponse)
                .orElse(null);

        ApiDto.StrategyDetailResponse resp = new ApiDto.StrategyDetailResponse();
        resp.setId(strategy.getId());
        resp.setName(strategy.getName());
        resp.setDescription(strategy.getDescription());
        resp.setDefinition(strategy.getDefinition());
        resp.setLatestResults(latestResults);
        resp.setCreatedAt(strategy.getCreatedAt());
        return resp;
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    @Transactional
    public void deleteStrategy(String name) {
        Strategy strategy = strategyRepo.findByName(name)
                .orElseThrow(() -> new NoSuchElementException("Strategy not found: " + name));
        strategyRepo.delete(strategy);
        log.info("Strategy '{}' deleted", name);
    }

    // ── Re-run on new symbol / date range ────────────────────────────────────

    @Transactional(readOnly = true)
    public ApiDto.BacktestResultResponse runBacktest(String name, ApiDto.RunBacktestRequest req) {
        Strategy strategy = strategyRepo.findByName(name)
                .orElseThrow(() -> new NoSuchElementException("Strategy not found: " + name));

        Instant from = Instant.parse(req.getFromTs());
        Instant to   = Instant.parse(req.getToTs());

        List<StockPrice> bars = priceRepo.findBySymbolAndTimeBetweenOrderByTimeAsc(
                req.getSymbol(), from, to);

        log.info("Re-running strategy '{}' on {} bars for {} [{} → {}]",
                name, bars.size(), req.getSymbol(), from, to);

        return engine.run(strategy, bars, req.getSymbol());
    }

    // ── Active strategies (ACTIVE or STANDBY) ────────────────────────────────

    @Transactional(readOnly = true)
    public List<ApiDto.StrategyResponse> getActiveStrategies() {
        return strategyRepo.findByStatusInOrderByUpdatedAtDesc(List.of("ACTIVE", "STANDBY"))
                .stream()
                .map(this::toStrategyResponse)
                .toList();
    }

    // ── Deploy (flip EXPORTED → ACTIVE) ──────────────────────────────────────

    private static final List<String> VALID_DEPLOY_MODES = List.of("paper", "live");

    @Transactional
    public ApiDto.StrategyResponse deployStrategy(String name, String mode) {
        if (mode == null || !VALID_DEPLOY_MODES.contains(mode)) {
            throw new IllegalArgumentException("mode must be one of: paper, live");
        }

        Strategy strategy = strategyRepo.findByName(name)
                .orElseThrow(() -> new NoSuchElementException("Strategy not found: " + name));

        strategy.setStatus("ACTIVE");
        strategy.setDeployMode(mode);
        strategy.setUpdatedAt(Instant.now());
        strategy = strategyRepo.save(strategy);

        log.info("Strategy '{}' deployed (mode={})", name, mode);
        return toStrategyResponse(strategy);
    }

    // ── All backtest runs for a strategy ─────────────────────────────────────

    @Transactional(readOnly = true)
    public List<ApiDto.BacktestResultResponse> getBacktestResults(String name) {
        Strategy strategy = strategyRepo.findByName(name)
                .orElseThrow(() -> new NoSuchElementException("Strategy not found: " + name));
        return resultRepo.findByStrategyOrderByCreatedAtDesc(strategy)
                .stream()
                .map(this::toBacktestResultResponse)
                .toList();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private BacktestResult buildBacktestResult(Strategy strategy, ApiDto.StrategyRequest req) {
        Map<String, Object> r = req.getResults();

        Instant fromTs = req.getFromTs() != null ? Instant.parse(req.getFromTs()) : null;
        Instant toTs   = req.getToTs()   != null ? Instant.parse(req.getToTs())   : null;

        List<Map<String, Object>> trades      = (List<Map<String, Object>>) r.get("trades");
        List<Map<String, Object>> equityCurve = (List<Map<String, Object>>) r.get("equity_curve");

        return BacktestResult.builder()
                .strategy(strategy)
                .symbol(req.getSymbol())
                .fromTs(fromTs)
                .toTs(toTs)
                .interval(req.getInterval() != null ? req.getInterval() : "1Min")
                .totalTrades(getInt(r, "total_trades"))
                .winningTrades(getInt(r, "winning_trades"))
                .losingTrades(getInt(r, "losing_trades"))
                .winRate(getBD(r, "win_rate"))
                .totalPnl(getBD(r, "total_pnl"))
                .totalPnlPct(getBD(r, "total_pnl_pct"))
                .avgWin(getBD(r, "avg_win"))
                .avgLoss(getBD(r, "avg_loss"))
                .largestWin(getBD(r, "largest_win"))
                .largestLoss(getBD(r, "largest_loss"))
                .profitFactor(getBD(r, "profit_factor"))
                .maxDrawdown(getBD(r, "max_drawdown"))
                .sharpeRatio(getBD(r, "sharpe_ratio"))
                .trades(trades)
                .equityCurve(equityCurve)
                .build();
    }

    private ApiDto.StrategyResponse toStrategyResponse(Strategy s) {
        ApiDto.StrategyResponse resp = new ApiDto.StrategyResponse();
        resp.setId(s.getId());
        resp.setName(s.getName());
        resp.setDescription(s.getDescription());
        resp.setStatus(s.getStatus());
        resp.setDeployMode(s.getDeployMode());
        resp.setCreatedAt(s.getCreatedAt());
        return resp;
    }

    private ApiDto.BacktestResultResponse toBacktestResultResponse(BacktestResult r) {
        ApiDto.BacktestResultResponse resp = new ApiDto.BacktestResultResponse();
        resp.setId(r.getId());
        resp.setSymbol(r.getSymbol());
        resp.setFromTs(r.getFromTs());
        resp.setToTs(r.getToTs());
        resp.setTotalTrades(r.getTotalTrades());
        resp.setWinningTrades(r.getWinningTrades());
        resp.setLosingTrades(r.getLosingTrades());
        resp.setWinRate(r.getWinRate());
        resp.setTotalPnl(r.getTotalPnl());
        resp.setTotalPnlPct(r.getTotalPnlPct());
        resp.setAvgWin(r.getAvgWin());
        resp.setAvgLoss(r.getAvgLoss());
        resp.setLargestWin(r.getLargestWin());
        resp.setLargestLoss(r.getLargestLoss());
        resp.setProfitFactor(r.getProfitFactor());
        resp.setMaxDrawdown(r.getMaxDrawdown());
        resp.setSharpeRatio(r.getSharpeRatio());
        resp.setTrades(r.getTrades());
        resp.setEquityCurve(r.getEquityCurve());
        resp.setCreatedAt(r.getCreatedAt());
        return resp;
    }

    private static BigDecimal getBD(Map<String, Object> m, String key) {
        Object v = m.get(key);
        if (v == null) return null;
        return new BigDecimal(v.toString());
    }

    private static Integer getInt(Map<String, Object> m, String key) {
        Object v = m.get(key);
        if (v == null) return null;
        return ((Number) v).intValue();
    }
}
