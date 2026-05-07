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
}
