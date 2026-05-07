package com.stocktracker.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

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
