package com.stocktracker.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Maps to the TimescaleDB hypertable {@code stock_prices}.
 * The composite primary key is (time, symbol).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "stock_prices")
@IdClass(StockPriceId.class)
public class StockPrice {

    @Id
    @Column(nullable = false)
    private Instant time;

    @Id
    @Column(nullable = false, length = 20)
    private String symbol;

    private BigDecimal open;
    private BigDecimal high;
    private BigDecimal low;

    @Column(nullable = false)
    private BigDecimal close;

    private Long volume;
    private BigDecimal vwap;

    @Column(name = "trade_count")
    private Integer tradeCount;
}
