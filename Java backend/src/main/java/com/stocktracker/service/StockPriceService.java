package com.stocktracker.service;

import com.stocktracker.dto.AlpacaDto;
import com.stocktracker.dto.ApiDto;
import com.stocktracker.model.StockPrice;
import com.stocktracker.model.SymbolCoverage;
import com.stocktracker.repository.StockPriceRepository;
import com.stocktracker.repository.SymbolCoverageRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;

@Slf4j
@Service
public class StockPriceService {

    /**
     * Two consecutive stored bars more than this many hours apart are treated as
     * the boundary between two contiguous coverage blocks (i.e. a gap worth
     * backfilling). 96h (4 days) clears the longest real market closure — a
     * holiday long weekend (Fri close → Tue open ≈ 88h) — while staying below the
     * smallest gap actually worth detecting (a missing trading week ≈ 6+ days).
     *
     * Tunable in ONE place. See {@code getCoverageBlocks}. Note the documented V1
     * limitation: any threshold that ignores weekends also necessarily ignores a
     * single isolated missing midweek day (~41h) — that hole is not detected.
     */
    public static final int COVERAGE_GAP_THRESHOLD_HOURS = 96;

    private final StockPriceRepository   priceRepo;
    private final SymbolCoverageRepository coverageRepo;
    private final AlpacaClient           alpacaClient;
    private final SymbolService          symbolService;
    private final JdbcTemplate           jdbc;

    public StockPriceService(StockPriceRepository priceRepo,
                             SymbolCoverageRepository coverageRepo,
                             AlpacaClient alpacaClient,
                             SymbolService symbolService,
                             JdbcTemplate jdbc) {
        this.priceRepo    = priceRepo;
        this.coverageRepo = coverageRepo;
        this.alpacaClient = alpacaClient;
        this.symbolService = symbolService;
        this.jdbc         = jdbc;
    }

    // ── Scheduler hook ────────────────────────────────────────────────────────

    @Transactional
    public void fetchAndStore() {
        List<String> symbols = symbolService.enabledSymbols();
        if (symbols.isEmpty()) {
            log.debug("No enabled symbols to fetch.");
            return;
        }

        log.info("Fetching latest prices for {} symbol(s): {}", symbols.size(), symbols);

        var barsBySymbol = alpacaClient.fetchLatestBars(symbols);

        barsBySymbol.forEach((symbol, bars) -> {
            List<StockPrice> entities = bars.stream()
                    .map(bar -> toEntity(symbol, bar))
                    .toList();
            batchInsert(entities);
        });
    }

    // ── On-demand range query (used by the chart / data pages) ───────────────

    /**
     * Returns price bars for the requested range.
     * Automatically fetches from Alpaca any sub-range not yet in the DB,
     * saves it, and updates the coverage record for this symbol.
     */
    @Transactional
    public List<ApiDto.PriceResponse> getRange(String symbol, Instant from, Instant to) {
        String sym = symbol.toUpperCase();
        fillGaps(sym, from, to);
        return priceRepo.findBySymbolAndTimeBetweenOrderByTimeAsc(sym, from, to)
                .stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<ApiDto.PriceResponse> getLatest(String symbol, int hours) {
        Instant from = Instant.now().minus(hours, ChronoUnit.HOURS);
        return priceRepo.findRecentBySymbol(symbol.toUpperCase(), from)
                .stream()
                .map(this::toResponse)
                .toList();
    }

    // ── Pure read (no auto-fill) — backs GET /{symbol}/raw ───────────────────

    /**
     * Returns stored 1-minute bars for the range, ordered by time. PURE READ:
     * unlike {@link #getRange}, it never calls {@link #fillGaps}, never triggers
     * an Alpaca fetch, and never writes. Used by the SDK's {@code get_data()},
     * which does its own scan-based gap detection and explicit backfill and would
     * fight a read that silently span-fills.
     */
    @Transactional(readOnly = true)
    public List<ApiDto.PriceResponse> getRaw(String symbol, Instant from, Instant to) {
        return priceRepo.findBySymbolAndTimeBetweenOrderByTimeAsc(symbol.toUpperCase(), from, to)
                .stream()
                .map(this::toResponse)
                .toList();
    }

    // ── Scan-based gap detection — backs GET /{symbol}/coverage-blocks ───────

    /**
     * Scans {@code stock_prices} for the symbol within [from, to] ordered by time
     * and returns the contiguous covered blocks, splitting wherever consecutive
     * bars are more than {@link #COVERAGE_GAP_THRESHOLD_HOURS} apart.
     *
     * <p>PURE READ: never reads {@code symbol_coverage}, never triggers an Alpaca
     * fetch. The break detection and grouping are done entirely in SQL with
     * window functions ({@code LAG} + a running sum of break markers), so only the
     * block boundaries — not millions of rows — come back to the JVM.
     *
     * <p>An empty list means no bars in range; the SDK then treats the entire
     * requested range as one gap.
     */
    @Transactional(readOnly = true)
    public List<ApiDto.CoverageBlock> getCoverageBlocks(String symbol, Instant from, Instant to) {
        String sql = """
                WITH ordered AS (
                    SELECT time,
                           LAG(time) OVER (ORDER BY time) AS prev_time
                    FROM stock_prices
                    WHERE symbol = ?
                      AND time >= ?
                      AND time <= ?
                ),
                marked AS (
                    SELECT time,
                           CASE
                               WHEN prev_time IS NULL
                                 OR time - prev_time > make_interval(hours => ?)
                               THEN 1 ELSE 0
                           END AS is_break
                    FROM ordered
                ),
                grouped AS (
                    SELECT time,
                           SUM(is_break) OVER (ORDER BY time) AS block_id
                    FROM marked
                )
                SELECT MIN(time) AS from_time,
                       MAX(time) AS to_time,
                       COUNT(*)  AS bar_count
                FROM grouped
                GROUP BY block_id
                ORDER BY from_time
                """;

        return jdbc.query(sql,
                (rs, rowNum) -> new ApiDto.CoverageBlock(
                        rs.getTimestamp("from_time").toInstant(),
                        rs.getTimestamp("to_time").toInstant(),
                        rs.getLong("bar_count")),
                symbol.toUpperCase(),
                Timestamp.from(from),
                Timestamp.from(to),
                COVERAGE_GAP_THRESHOLD_HOURS);
    }

    // ── Admin backfill ────────────────────────────────────────────────────────

    @Transactional
    public int backfill(String symbol, Instant from, Instant to) {
        String sym = symbol.toUpperCase();
        List<AlpacaDto.Bar> bars = alpacaClient.fetchHistoricalBars(sym, from, to);
        List<StockPrice> entities = bars.stream()
                .map(bar -> toEntity(sym, bar))
                .toList();
        batchInsert(entities);

        // Expand coverage to include the manually backfilled range
        coverageRepo.findById(sym).ifPresentOrElse(c -> {
            if (from.isBefore(c.getFromTime())) c.setFromTime(from);
            if (to.isAfter(c.getToTime()))       c.setToTime(to);
            coverageRepo.save(c);
        }, () -> coverageRepo.save(SymbolCoverage.builder()
                .symbol(sym).fromTime(from).toTime(to).build()));

        log.info("Backfilled {} records for {}", entities.size(), sym);
        return entities.size();
    }

    @Transactional
    public void backfillAll(Instant from, Instant to) {
        List<String> symbols = symbolService.enabledSymbols();
        log.info("Backfilling {} symbol(s) from {} to {}", symbols.size(), from, to);
        for (String symbol : symbols) {
            try {
                backfill(symbol, from, to);
            } catch (Exception ex) {
                log.error("Backfill failed for {}: {}", symbol, ex.getMessage(), ex);
            }
        }
    }

    // ── Gap detection & fill ──────────────────────────────────────────────────

    private void fillGaps(String symbol, Instant from, Instant to) {
        Optional<SymbolCoverage> opt = coverageRepo.findById(symbol);

        if (opt.isEmpty()) {
            // Never fetched this symbol before — get the whole range
            fetchAndSave(symbol, from, to);
            coverageRepo.save(SymbolCoverage.builder()
                    .symbol(symbol).fromTime(from).toTime(to).build());
            return;
        }

        SymbolCoverage coverage = opt.get();
        boolean changed = false;

        // Gap on the left: requested start is earlier than what we have
        if (from.isBefore(coverage.getFromTime())) {
            fetchAndSave(symbol, from, coverage.getFromTime());
            coverage.setFromTime(from);
            changed = true;
        }

        // Gap on the right: requested end is later than what we have
        if (to.isAfter(coverage.getToTime())) {
            fetchAndSave(symbol, coverage.getToTime(), to);
            coverage.setToTime(to);
            changed = true;
        }

        if (changed) {
            coverageRepo.save(coverage);
        }
    }

    private void fetchAndSave(String symbol, Instant from, Instant to) {
        log.info("Fetching gap [{} -> {}] for {}", from, to, symbol);
        List<AlpacaDto.Bar> bars = alpacaClient.fetchHistoricalBars(symbol, from, to);
        if (bars.isEmpty()) {
            log.info("No bars returned for {} [{} -> {}]", symbol, from, to);
            return;
        }
        List<StockPrice> entities = bars.stream()
                .map(bar -> toEntity(symbol, bar))
                .toList();
        batchInsert(entities);
        log.info("Saved {} bars for {} [{} -> {}]", entities.size(), symbol, from, to);
    }

    // ── Batch insert (ON CONFLICT DO NOTHING — safe to re-run) ───────────────

    private void batchInsert(List<StockPrice> bars) {
        if (bars.isEmpty()) return;
        String sql = """
                INSERT INTO stock_prices
                    (time, symbol, open, high, low, close, volume, vwap, trade_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (time, symbol) DO NOTHING
                """;
        jdbc.batchUpdate(sql, bars, 1000, (ps, bar) -> {
            ps.setTimestamp(1, Timestamp.from(bar.getTime()));
            ps.setString(2, bar.getSymbol());
            ps.setBigDecimal(3, bar.getOpen());
            ps.setBigDecimal(4, bar.getHigh());
            ps.setBigDecimal(5, bar.getLow());
            ps.setBigDecimal(6, bar.getClose());
            ps.setObject(7, bar.getVolume());
            ps.setBigDecimal(8, bar.getVwap());
            ps.setObject(9, bar.getTradeCount());
        });
    }

    // ── Mapping ───────────────────────────────────────────────────────────────

    private StockPrice toEntity(String symbol, AlpacaDto.Bar bar) {
        return StockPrice.builder()
                .time(bar.getTime())
                .symbol(symbol)
                .open(bar.getOpen())
                .high(bar.getHigh())
                .low(bar.getLow())
                .close(bar.getClose())
                .volume(bar.getVolume())
                .vwap(bar.getVwap())
                .tradeCount(bar.getTradeCount())
                .build();
    }

    private ApiDto.PriceResponse toResponse(StockPrice sp) {
        ApiDto.PriceResponse r = new ApiDto.PriceResponse();
        r.setTime(sp.getTime());
        r.setSymbol(sp.getSymbol());
        r.setOpen(sp.getOpen());
        r.setHigh(sp.getHigh());
        r.setLow(sp.getLow());
        r.setClose(sp.getClose());
        r.setVolume(sp.getVolume());
        r.setVwap(sp.getVwap());
        r.setTradeCount(sp.getTradeCount());
        return r;
    }
}
