package com.stocktracker.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "backtest_results")
public class BacktestResult {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "strategy_id")
    private Strategy strategy;

    private String symbol;

    @Column(name = "from_ts")
    private Instant fromTs;

    @Column(name = "to_ts")
    private Instant toTs;

    @Builder.Default
    private String interval = "1Min";

    private Integer totalTrades;
    private Integer winningTrades;
    private Integer losingTrades;
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

    @Column(columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> trades;

    @Column(name = "equity_curve", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> equityCurve;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();
}
