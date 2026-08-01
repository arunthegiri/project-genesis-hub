package com.stocktracker.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * DTOs for the /models registry.
 *
 * <p>A "model version" is a projection over an existing {@code Strategy} row (plus its
 * latest {@code BacktestResult}). The registry does NOT own a table — see
 * {@code ModelService} for the rationale. The {@code (name, version)} pair is derived
 * from the strategy name via the trailing {@code _v<N>} convention (e.g. {@code rf_v1}
 * → name {@code rf}, version {@code v1}); names without that suffix default to
 * version {@code v1}.
 */
public class ModelDto {

    /** Row in the models list / one entry of a versions list. */
    @Data
    public static class ModelSummary {
        private Long       id;
        private String     name;          // base model name, e.g. "rf"
        private String     version;       // "v1"
        private String     strategyName;  // full underlying strategy name, e.g. "rf_v1"
        private String     status;        // EXPORTED | ACTIVE | STANDBY | STOPPED | ARCHIVED
        private String     deployMode;    // paper | live | null
        private Integer    featureCount;  // from contract definition, null if absent
        // key metrics from the latest backtest result — all nullable
        private BigDecimal sharpeRatio;
        private BigDecimal winRate;
        private BigDecimal totalPnlPct;
        private BigDecimal profitFactor;
        private BigDecimal maxDrawdown;
        private Integer    totalTrades;
        private Instant    createdAt;
        private Instant    updatedAt;
    }

    /** Contract summary distilled from the strategy definition jsonb. All fields nullable. */
    @Data
    public static class ContractSummary {
        private List<String> features;
        private Integer      featureCount;
        private List<Object> outputClasses;
        private Object       buyThreshold;
        private Object       sellThreshold;
        private List<Object> symbols;
        private String       deployMode;
    }

    /** Full detail for a single model version. */
    @Data
    public static class ModelDetail {
        private Long               id;
        private String             name;
        private String             version;
        private String             strategyName;
        private String             description;
        private String             status;
        private String             deployMode;
        private Instant            createdAt;
        private Instant            updatedAt;
        private Integer            featureCount;
        private ContractSummary    contract;
        private PerformanceMetrics performance;  // latest backtest, null if none
    }

    /** Backtest / validation metrics for a model version. */
    @Data
    public static class PerformanceMetrics {
        private String     symbol;
        private Instant    fromTs;
        private Instant    toTs;
        private Integer    totalTrades;
        private Integer    winningTrades;
        private Integer    losingTrades;
        private BigDecimal winRate;
        private BigDecimal totalPnl;
        private BigDecimal totalPnlPct;
        private BigDecimal avgWin;
        private BigDecimal avgLoss;
        private BigDecimal largestWin;
        private BigDecimal largestLoss;
        private BigDecimal profitFactor;
        private BigDecimal maxDrawdown;
        private BigDecimal sharpeRatio;
        private Instant    createdAt;
    }

    /** Body for POST /api/models/{name}/{version}/deploy. */
    @Data
    public static class DeployRequest {
        @NotBlank(message = "mode must not be blank")
        private String mode;  // paper | live
    }
}
