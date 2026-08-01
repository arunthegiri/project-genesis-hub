package com.stocktracker.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.AllArgsConstructor;
import lombok.Data;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;

public class ApiDto {

    /** Request body to register or remove a symbol */
    @Data
    public static class SymbolRequest {
        @NotBlank(message = "symbol must not be blank")
        @Pattern(regexp = "^[A-Za-z]{1,10}$", message = "symbol must be 1–10 letters")
        private String symbol;
    }

    /** Response payload for a tracked symbol */
    @Data
    public static class SymbolResponse {
        private Long    id;
        private String  symbol;
        private boolean enabled;
        private Instant createdAt;
    }

    /** Response payload for a single price record */
    @Data
    public static class PriceResponse {
        private Instant    time;
        private String     symbol;
        private BigDecimal open;
        private BigDecimal high;
        private BigDecimal low;
        private BigDecimal close;
        private Long       volume;
        private BigDecimal vwap;
        private Integer    tradeCount;
    }

    /** Generic paginated list wrapper */
    @Data
    public static class PagedResponse<T> {
        private List<T> data;
        private int     count;

        public PagedResponse(List<T> data) {
            this.data  = data;
            this.count = data.size();
        }
    }

    /** Request body sent from Jupyter via s.export() */
    @Data
    public static class StrategyRequest {
        @NotBlank(message = "name must not be blank")
        private String name;
        private String description;
        @NotNull(message = "definition must not be null")
        private Map<String, Object> definition;
        @NotNull(message = "results must not be null")
        private Map<String, Object> results;
        private String symbol;
        private String fromTs;
        private String toTs;
        private String interval;
    }

    /** Summary response — used in list endpoint */
    @Data
    public static class StrategyResponse {
        private Long    id;
        private String  name;
        private String  description;
        private String  status;
        private String  deployMode;
        private Instant createdAt;
    }

    /** Account snapshot from the Alpaca trading API */
    @Data
    public static class AccountResponse {
        private String     id;
        private String     accountNumber;
        private String     status;
        private String     currency;
        private BigDecimal buyingPower;
        private BigDecimal cash;
        private BigDecimal portfolioValue;
        private BigDecimal equity;
        private BigDecimal lastEquity;
        private BigDecimal longMarketValue;
        private BigDecimal shortMarketValue;
        private BigDecimal daytradingBuyingPower;
        private BigDecimal regtBuyingPower;
    }

    /** Single open position from the Alpaca trading API */
    @Data
    public static class PositionResponse {
        private String     symbol;
        private String     side;
        private BigDecimal qty;
        private BigDecimal marketValue;
        private BigDecimal costBasis;
        private BigDecimal unrealizedPl;
        private BigDecimal unrealizedPlPct;
        private BigDecimal currentPrice;
        private BigDecimal lastdayPrice;
        private BigDecimal changeToday;
    }

    /** Full strategy with latest backtest results */
    @Data
    public static class StrategyDetailResponse {
        private Long                   id;
        private String                 name;
        private String                 description;
        private Map<String, Object>    definition;
        private BacktestResultResponse latestResults;
        private Instant                createdAt;
    }

    /** Single backtest run with all stats and trade list */
    @Data
    public static class BacktestResultResponse {
        private Long                       id;
        private String                     symbol;
        private Instant                    fromTs;
        private Instant                    toTs;
        private Integer                    totalTrades;
        private Integer                    winningTrades;
        private Integer                    losingTrades;
        private BigDecimal                 winRate;
        private BigDecimal                 totalPnl;
        private BigDecimal                 totalPnlPct;
        private BigDecimal                 avgWin;
        private BigDecimal                 avgLoss;
        private BigDecimal                 largestWin;
        private BigDecimal                 largestLoss;
        private BigDecimal                 profitFactor;
        private BigDecimal                 maxDrawdown;
        private BigDecimal                 sharpeRatio;
        private List<Map<String, Object>>  trades;
        private List<Map<String, Object>>  equityCurve;
        private Instant                    createdAt;
    }

    /** Response for async backfill job status */
    @Data
    public static class BackfillJobResponse {
        private java.util.UUID jobId;
        private String         symbol;
        private Instant        fromTime;
        private Instant        toTime;
        private String         status;
        private int            totalChunks;
        private int            completedChunks;
        private int            totalBars;
        private double         progressPct;
        private String         errorMessage;
        private Instant        createdAt;
        private Instant        startedAt;
        private Instant        completedAt;
        private Instant        currentChunkFrom;
        private Instant        currentChunkTo;
    }

    /**
     * One contiguous block of stored bars, as detected by the scan-based
     * gap-detection endpoint ({@code GET /api/prices/{symbol}/coverage-blocks}).
     * A block runs from the first to the last stored bar before the next
     * &gt; COVERAGE_GAP_THRESHOLD_HOURS hole. The SDK subtracts these blocks from
     * the requested range to compute the gaps it needs to backfill.
     */
    @Data
    @AllArgsConstructor
    public static class CoverageBlock {
        private Instant fromTime;
        private Instant toTime;
        private long    barCount;
    }

    /** Request body for re-running a strategy on a different symbol/range */
    @Data
    public static class RunBacktestRequest {
        @NotBlank(message = "symbol must not be blank")
        private String symbol;
        @NotNull(message = "fromTs must not be null")
        private String fromTs;
        @NotNull(message = "toTs must not be null")
        private String toTs;
    }

    /** Symbol search result from the Alpaca assets list */
    @Data
    @AllArgsConstructor
    public static class AssetResult {
        private String symbol;
        private String name;
    }

    /** Error body */
    @Data
    public static class ErrorResponse {
        private String message;
        private int    status;

        public ErrorResponse(String message, int status) {
            this.message = message;
            this.status  = status;
        }
    }
}
