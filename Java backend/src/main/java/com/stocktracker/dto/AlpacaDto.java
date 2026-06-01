package com.stocktracker.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Alpaca v2 /stocks/bars response shapes.
 */
public class AlpacaDto {

    /** Root response for multi-symbol bars */
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class BarsResponse {
        /** Map of symbol -> list of bars */
        private Map<String, List<Bar>> bars;
        @JsonProperty("next_page_token")
        private String nextPageToken;
    }

    /** Root response for single-symbol bars */
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class SingleBarsResponse {
        private List<Bar> bars;
        private String symbol;
        @JsonProperty("next_page_token")
        private String nextPageToken;
    }

    /** A single OHLCV bar from Alpaca */
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Bar {
        /** Timestamp */
        @JsonProperty("t")
        private Instant time;

        @JsonProperty("o")
        private BigDecimal open;

        @JsonProperty("h")
        private BigDecimal high;

        @JsonProperty("l")
        private BigDecimal low;

        @JsonProperty("c")
        private BigDecimal close;

        @JsonProperty("v")
        private Long volume;

        @JsonProperty("vw")
        private BigDecimal vwap;

        @JsonProperty("n")
        private Integer tradeCount;
    }

    /** Latest quote / snapshot */
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class SnapshotsResponse {
        /** Map of symbol -> snapshot */
        private Map<String, Snapshot> snapshots;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Snapshot {
        @JsonProperty("latestTrade")
        private LatestTrade latestTrade;
        @JsonProperty("latestQuote")
        private LatestQuote latestQuote;
        @JsonProperty("minuteBar")
        private Bar minuteBar;
        @JsonProperty("dailyBar")
        private Bar dailyBar;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class LatestTrade {
        @JsonProperty("t")
        private Instant time;
        @JsonProperty("p")
        private BigDecimal price;
        @JsonProperty("s")
        private Long size;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class LatestQuote {
        @JsonProperty("t")
        private Instant time;
        @JsonProperty("ap")
        private BigDecimal askPrice;
        @JsonProperty("bp")
        private BigDecimal bidPrice;
    }

    /** Account info from GET /v2/account */
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class AlpacaAccount {
        private String id;
        @JsonProperty("account_number")
        private String accountNumber;
        private String status;
        private String currency;
        @JsonProperty("buying_power")
        private BigDecimal buyingPower;
        private BigDecimal cash;
        @JsonProperty("portfolio_value")
        private BigDecimal portfolioValue;
        private BigDecimal equity;
        @JsonProperty("last_equity")
        private BigDecimal lastEquity;
        @JsonProperty("long_market_value")
        private BigDecimal longMarketValue;
        @JsonProperty("short_market_value")
        private BigDecimal shortMarketValue;
        @JsonProperty("daytrading_buying_power")
        private BigDecimal daytradingBuyingPower;
        @JsonProperty("regt_buying_power")
        private BigDecimal regtBuyingPower;
        @JsonProperty("created_at")
        private Instant createdAt;
    }

    /** A single open position from GET /v2/positions */
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class AlpacaPosition {
        private String symbol;
        private String exchange;
        @JsonProperty("asset_class")
        private String assetClass;
        private BigDecimal qty;
        @JsonProperty("qty_available")
        private BigDecimal qtyAvailable;
        private String side;
        @JsonProperty("market_value")
        private BigDecimal marketValue;
        @JsonProperty("cost_basis")
        private BigDecimal costBasis;
        @JsonProperty("unrealized_pl")
        private BigDecimal unrealizedPl;
        @JsonProperty("unrealized_plpc")
        private BigDecimal unrealizedPlPct;
        @JsonProperty("current_price")
        private BigDecimal currentPrice;
        @JsonProperty("lastday_price")
        private BigDecimal lastdayPrice;
        @JsonProperty("change_today")
        private BigDecimal changeToday;
    }

    /** An asset entry from GET /v2/assets */
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Asset {
        private String symbol;
        private String name;
        private String status;
        @JsonProperty("class")
        private String assetClass;
        private boolean tradable;
    }
}
