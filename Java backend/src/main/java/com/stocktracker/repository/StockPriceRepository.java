package com.stocktracker.repository;

import com.stocktracker.model.StockPrice;
import com.stocktracker.model.StockPriceId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;

@Repository
public interface StockPriceRepository extends JpaRepository<StockPrice, StockPriceId> {

    List<StockPrice> findBySymbolOrderByTimeDesc(String symbol);

    List<StockPrice> findBySymbolAndTimeBetweenOrderByTimeAsc(
            String symbol, Instant from, Instant to);

    @Query("SELECT sp FROM StockPrice sp WHERE sp.symbol = :symbol ORDER BY sp.time DESC LIMIT 1")
    java.util.Optional<StockPrice> findLatestBySymbol(@Param("symbol") String symbol);

    @Query("""
            SELECT sp FROM StockPrice sp
            WHERE sp.symbol = :symbol
              AND sp.time >= :from
            ORDER BY sp.time DESC
            """)
    List<StockPrice> findRecentBySymbol(@Param("symbol") String symbol,
                                        @Param("from")   Instant from);
}
