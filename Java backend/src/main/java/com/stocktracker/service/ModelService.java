package com.stocktracker.service;

import com.stocktracker.dto.ModelDto;
import com.stocktracker.model.BacktestResult;
import com.stocktracker.model.Strategy;
import com.stocktracker.repository.BacktestResultRepository;
import com.stocktracker.repository.StrategyRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Model registry service.
 *
 * <p><b>Architecture decision (Track D2):</b> the registry is a read-oriented
 * <em>projection</em> over the existing {@code strategies} + {@code backtest_results}
 * tables — it deliberately does NOT introduce a new {@code Model} JPA entity/table.
 *
 * <p>Reasons:
 * <ul>
 *   <li>{@code spring.jpa.hibernate.ddl-auto=validate} + Flyway means a new entity
 *       needs a new migration <em>and</em> a writer. Nothing in the pipeline writes
 *       model rows — {@code train.py} ships artifacts to GCS, the SDK's
 *       {@code export()}/{@code deploy()} write {@code Strategy} rows. A standalone
 *       {@code models} table would be permanently empty.</li>
 *   <li>Every field the registry needs already lives on {@code Strategy} (name,
 *       status, deployMode, timestamps, and the deploy contract inside the
 *       {@code definition} jsonb) and its latest {@code BacktestResult} (sharpe,
 *       win rate, pnl, profit factor, drawdown, trade counts).</li>
 *   <li>Model version is derived from the strategy name via the {@code _v<N>}
 *       convention embedded in the contract's {@code strategy_name} (e.g.
 *       {@code rf_v1}); names without the suffix default to {@code v1}.</li>
 * </ul>
 *
 * <p>Deploy/archive status flips are performed here against {@code StrategyRepository}
 * directly — this service never touches {@code StrategyService} (owned by Track C).
 */
@Slf4j
@Service
public class ModelService {

    private static final Pattern VERSION_SUFFIX = Pattern.compile("^(.*)_v(\\d+)$");
    private static final Set<String> VALID_MODES = Set.of("paper", "live");
    private static final String STATUS_ARCHIVED = "ARCHIVED";
    private static final String STATUS_ACTIVE = "ACTIVE";

    private final StrategyRepository       strategyRepo;
    private final BacktestResultRepository resultRepo;

    public ModelService(StrategyRepository strategyRepo, BacktestResultRepository resultRepo) {
        this.strategyRepo = strategyRepo;
        this.resultRepo   = resultRepo;
    }

    // ── List (excludes archived) ────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<ModelDto.ModelSummary> listModels() {
        return strategyRepo.findAllByOrderByCreatedAtDesc().stream()
                .filter(s -> !STATUS_ARCHIVED.equalsIgnoreCase(s.getStatus()))
                .map(this::toSummary)
                .toList();
    }

    // ── All versions of a given model name ──────────────────────────────────────

    @Transactional(readOnly = true)
    public List<ModelDto.ModelSummary> listVersions(String name) {
        List<ModelDto.ModelSummary> versions = strategyRepo.findAllByOrderByCreatedAtDesc().stream()
                .filter(s -> !STATUS_ARCHIVED.equalsIgnoreCase(s.getStatus()))
                .filter(s -> baseName(s.getName()).equals(name))
                .map(this::toSummary)
                .toList();
        if (versions.isEmpty()) {
            throw new NoSuchElementException("Model not found: " + name);
        }
        return versions;
    }

    // ── Detail for one version ──────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public ModelDto.ModelDetail getModel(String name, String version) {
        return toDetail(resolveStrategy(name, version));
    }

    // ── Performance metrics for one version ─────────────────────────────────────

    @Transactional(readOnly = true)
    public ModelDto.PerformanceMetrics getPerformance(String name, String version) {
        Strategy strategy = resolveStrategy(name, version);
        return resultRepo.findTopByStrategyOrderByCreatedAtDesc(strategy)
                .map(this::toPerformance)
                .orElse(null);
    }

    // ── Deploy (EXPORTED/… → ACTIVE) ────────────────────────────────────────────

    @Transactional
    public ModelDto.ModelDetail deploy(String name, String version, String mode) {
        if (mode == null || !VALID_MODES.contains(mode.toLowerCase())) {
            throw new IllegalArgumentException("mode must be one of: paper, live");
        }
        Strategy strategy = resolveStrategy(name, version);
        strategy.setStatus(STATUS_ACTIVE);
        strategy.setDeployMode(mode.toLowerCase());
        strategy.setUpdatedAt(Instant.now());
        strategy = strategyRepo.save(strategy);
        log.info("Model '{}' {} deployed ({}) → strategy '{}' ACTIVE",
                name, version, mode, strategy.getName());
        return toDetail(strategy);
    }

    // ── Archive (soft-delete: status → ARCHIVED, never a hard delete) ───────────

    @Transactional
    public ModelDto.ModelDetail archive(String name, String version) {
        Strategy strategy = resolveStrategy(name, version);
        strategy.setStatus(STATUS_ARCHIVED);
        strategy.setUpdatedAt(Instant.now());
        strategy = strategyRepo.save(strategy);
        log.info("Model '{}' {} archived → strategy '{}' ARCHIVED",
                name, version, strategy.getName());
        return toDetail(strategy);
    }

    // ── Resolution helpers ──────────────────────────────────────────────────────

    private Strategy resolveStrategy(String name, String version) {
        return strategyRepo.findAllByOrderByCreatedAtDesc().stream()
                .filter(s -> baseName(s.getName()).equals(name) && version(s.getName()).equals(version))
                .findFirst()
                .orElseThrow(() -> new NoSuchElementException(
                        "Model not found: " + name + " " + version));
    }

    private static String baseName(String strategyName) {
        Matcher m = VERSION_SUFFIX.matcher(strategyName);
        return m.matches() ? m.group(1) : strategyName;
    }

    private static String version(String strategyName) {
        Matcher m = VERSION_SUFFIX.matcher(strategyName);
        return m.matches() ? "v" + m.group(2) : "v1";
    }

    // ── Mappers ─────────────────────────────────────────────────────────────────

    private ModelDto.ModelSummary toSummary(Strategy s) {
        ModelDto.ModelSummary out = new ModelDto.ModelSummary();
        out.setId(s.getId());
        out.setName(baseName(s.getName()));
        out.setVersion(version(s.getName()));
        out.setStrategyName(s.getName());
        out.setStatus(s.getStatus());
        out.setDeployMode(s.getDeployMode());
        out.setFeatureCount(featureCount(s.getDefinition()));
        out.setCreatedAt(s.getCreatedAt());
        out.setUpdatedAt(s.getUpdatedAt());

        resultRepo.findTopByStrategyOrderByCreatedAtDesc(s).ifPresent(r -> {
            out.setSharpeRatio(r.getSharpeRatio());
            out.setWinRate(r.getWinRate());
            out.setTotalPnlPct(r.getTotalPnlPct());
            out.setProfitFactor(r.getProfitFactor());
            out.setMaxDrawdown(r.getMaxDrawdown());
            out.setTotalTrades(r.getTotalTrades());
        });
        return out;
    }

    private ModelDto.ModelDetail toDetail(Strategy s) {
        ModelDto.ModelDetail out = new ModelDto.ModelDetail();
        out.setId(s.getId());
        out.setName(baseName(s.getName()));
        out.setVersion(version(s.getName()));
        out.setStrategyName(s.getName());
        out.setDescription(s.getDescription());
        out.setStatus(s.getStatus());
        out.setDeployMode(s.getDeployMode());
        out.setCreatedAt(s.getCreatedAt());
        out.setUpdatedAt(s.getUpdatedAt());
        out.setFeatureCount(featureCount(s.getDefinition()));
        out.setContract(toContract(s.getDefinition()));
        out.setPerformance(resultRepo.findTopByStrategyOrderByCreatedAtDesc(s)
                .map(this::toPerformance)
                .orElse(null));
        return out;
    }

    @SuppressWarnings("unchecked")
    private ModelDto.ContractSummary toContract(Map<String, Object> def) {
        ModelDto.ContractSummary c = new ModelDto.ContractSummary();
        if (def == null) return c;

        Object features = def.get("features");
        if (features instanceof List<?> list) {
            c.setFeatures(list.stream().map(String::valueOf).toList());
            c.setFeatureCount(list.size());
        }
        Object outputClasses = def.get("output_classes");
        if (outputClasses instanceof List<?> list) {
            c.setOutputClasses((List<Object>) list);
        }
        Object symbols = def.get("symbols");
        if (symbols instanceof List<?> list) {
            c.setSymbols((List<Object>) list);
        }
        c.setBuyThreshold(def.get("buy_threshold"));
        c.setSellThreshold(def.get("sell_threshold"));
        Object dm = def.get("deploy_mode");
        c.setDeployMode(dm != null ? String.valueOf(dm) : null);
        return c;
    }

    private Integer featureCount(Map<String, Object> def) {
        if (def == null) return null;
        Object features = def.get("features");
        return features instanceof List<?> list ? list.size() : null;
    }

    private ModelDto.PerformanceMetrics toPerformance(BacktestResult r) {
        ModelDto.PerformanceMetrics p = new ModelDto.PerformanceMetrics();
        p.setSymbol(r.getSymbol());
        p.setFromTs(r.getFromTs());
        p.setToTs(r.getToTs());
        p.setTotalTrades(r.getTotalTrades());
        p.setWinningTrades(r.getWinningTrades());
        p.setLosingTrades(r.getLosingTrades());
        p.setWinRate(r.getWinRate());
        p.setTotalPnl(r.getTotalPnl());
        p.setTotalPnlPct(r.getTotalPnlPct());
        p.setAvgWin(r.getAvgWin());
        p.setAvgLoss(r.getAvgLoss());
        p.setLargestWin(r.getLargestWin());
        p.setLargestLoss(r.getLargestLoss());
        p.setProfitFactor(r.getProfitFactor());
        p.setMaxDrawdown(r.getMaxDrawdown());
        p.setSharpeRatio(r.getSharpeRatio());
        p.setCreatedAt(r.getCreatedAt());
        return p;
    }
}
