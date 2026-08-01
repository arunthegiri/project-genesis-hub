package com.stocktracker.service;

import com.stocktracker.dto.ApiDto;
import com.stocktracker.model.StockPrice;
import com.stocktracker.repository.StockPriceRepository;
import com.stocktracker.repository.SymbolCoverageRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import javax.sql.DataSource;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Integration tests for the scan-based gap detection ({@code getCoverageBlocks})
 * and the pure-read ({@code getRaw}) service methods that back the two new Part-1
 * endpoints.
 *
 * <p>Runs against a real Postgres via Testcontainers because the gap query uses
 * window functions and {@code make_interval}, which an embedded H2 cannot
 * execute. Flyway is disabled (the production V1 migration is TimescaleDB-only);
 * Hibernate creates the plain {@code stock_prices} / {@code symbol_coverage}
 * tables from the entities, which is all the SQL under test needs.
 *
 * <p>The service is constructed directly with the Alpaca client and symbol
 * service left {@code null}: the read paths must never touch them, so any
 * accidental fetch would surface as an NPE.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Testcontainers
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
class CoverageBlocksIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    private static final String SYMBOL = "NVDA";

    @Autowired private StockPriceRepository     priceRepo;
    @Autowired private SymbolCoverageRepository coverageRepo;
    @Autowired private DataSource               dataSource;

    private StockPriceService service;

    @BeforeEach
    void setUp() {
        priceRepo.deleteAll();
        priceRepo.flush();
        // Alpaca client + symbol service are null on purpose: the read paths must
        // never call them.
        service = new StockPriceService(priceRepo, coverageRepo, null, null,
                new JdbcTemplate(dataSource));
    }

    // ── getCoverageBlocks ────────────────────────────────────────────────────

    @Test
    void contiguousRangeReturnsSingleBlock() {
        Instant start = Instant.parse("2026-01-05T14:30:00Z");
        insertMinuteBars(start, 60);   // 60 consecutive 1-min bars

        List<ApiDto.CoverageBlock> blocks = service.getCoverageBlocks(
                SYMBOL, start.minus(1, ChronoUnit.DAYS), start.plus(1, ChronoUnit.DAYS));

        assertThat(blocks).hasSize(1);
        assertThat(blocks.get(0).getFromTime()).isEqualTo(start);
        assertThat(blocks.get(0).getToTime()).isEqualTo(start.plus(59, ChronoUnit.MINUTES));
        assertThat(blocks.get(0).getBarCount()).isEqualTo(60);
    }

    @Test
    void holeLargerThanThresholdSplitsIntoTwoBlocks() {
        Instant blockA = Instant.parse("2026-01-05T14:30:00Z");
        insertMinuteBars(blockA, 10);
        // 5 days (120h) later — well beyond the 96h threshold.
        Instant blockB = blockA.plus(5, ChronoUnit.DAYS);
        insertMinuteBars(blockB, 10);

        List<ApiDto.CoverageBlock> blocks = service.getCoverageBlocks(
                SYMBOL, blockA.minus(1, ChronoUnit.DAYS), blockB.plus(1, ChronoUnit.DAYS));

        assertThat(blocks).hasSize(2);
        assertThat(blocks.get(0).getFromTime()).isEqualTo(blockA);
        assertThat(blocks.get(0).getToTime()).isEqualTo(blockA.plus(9, ChronoUnit.MINUTES));
        assertThat(blocks.get(1).getFromTime()).isEqualTo(blockB);
        assertThat(blocks.get(1).getToTime()).isEqualTo(blockB.plus(9, ChronoUnit.MINUTES));
    }

    @Test
    void weekendGapDoesNotSplit() {
        // Friday close 21:00Z → Monday open 14:30Z ≈ 65.5h, under the 96h
        // threshold, so it must remain a single contiguous block.
        Instant friClose = Instant.parse("2026-01-09T21:00:00Z"); // Fri
        insertMinuteBars(friClose.minus(9, ChronoUnit.MINUTES), 10); // ...->21:00
        Instant monOpen = Instant.parse("2026-01-12T14:30:00Z");     // Mon
        insertMinuteBars(monOpen, 10);

        List<ApiDto.CoverageBlock> blocks = service.getCoverageBlocks(
                SYMBOL, friClose.minus(1, ChronoUnit.DAYS), monOpen.plus(1, ChronoUnit.DAYS));

        assertThat(blocks).hasSize(1);
        assertThat(blocks.get(0).getBarCount()).isEqualTo(20);
    }

    @Test
    void noBarsReturnsEmptyList() {
        List<ApiDto.CoverageBlock> blocks = service.getCoverageBlocks(
                SYMBOL,
                Instant.parse("2026-01-01T00:00:00Z"),
                Instant.parse("2026-02-01T00:00:00Z"));

        assertThat(blocks).isEmpty();
    }

    @Test
    void blocksAreScopedToTheRequestedRange() {
        Instant inside  = Instant.parse("2026-01-05T14:30:00Z");
        Instant outside = Instant.parse("2026-03-01T14:30:00Z");
        insertMinuteBars(inside, 10);
        insertMinuteBars(outside, 10);

        List<ApiDto.CoverageBlock> blocks = service.getCoverageBlocks(
                SYMBOL,
                Instant.parse("2026-01-01T00:00:00Z"),
                Instant.parse("2026-01-31T00:00:00Z"));

        assertThat(blocks).hasSize(1);
        assertThat(blocks.get(0).getFromTime()).isEqualTo(inside);
    }

    // ── getRaw ───────────────────────────────────────────────────────────────

    @Test
    void getRawReturnsStoredBarsAndNeverFetches() {
        Instant start = Instant.parse("2026-01-05T14:30:00Z");
        insertMinuteBars(start, 30);
        long before = priceRepo.count();

        List<ApiDto.PriceResponse> bars = service.getRaw(
                SYMBOL, start.minus(1, ChronoUnit.DAYS), start.plus(1, ChronoUnit.DAYS));

        // Returned everything stored, ordered, with no NPE (proving the null
        // Alpaca client / symbol service were never invoked).
        assertThat(bars).hasSize(30);
        assertThat(bars.get(0).getTime()).isEqualTo(start);
        assertThat(bars).isSortedAccordingTo(
                (a, b) -> a.getTime().compareTo(b.getTime()));
        // Pure read: row count is unchanged — no gap fill ran.
        assertThat(priceRepo.count()).isEqualTo(before);
    }

    @Test
    void getRawOverEmptyRangeReturnsEmptyWithoutFetching() {
        // No data and a null Alpaca client: a span-filling read would NPE here.
        assertThat(service.getRaw(SYMBOL,
                Instant.parse("2026-01-01T00:00:00Z"),
                Instant.parse("2026-02-01T00:00:00Z"))).isEmpty();
    }

    @Test
    void getRangeWouldFetch_confirmingGetRawIsTheDifference() {
        // Sanity guard on the contrast documented in the spec: /range runs
        // fillGaps (needs the Alpaca client), /raw does not. With a null client,
        // getRange must blow up while getRaw stays clean.
        assertThatThrownBy(() -> service.getRange(SYMBOL,
                Instant.parse("2026-01-01T00:00:00Z"),
                Instant.parse("2026-02-01T00:00:00Z")))
                .isInstanceOf(NullPointerException.class);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private void insertMinuteBars(Instant start, int count) {
        for (int i = 0; i < count; i++) {
            priceRepo.save(StockPrice.builder()
                    .time(start.plus(i, ChronoUnit.MINUTES))
                    .symbol(SYMBOL)
                    .open(BigDecimal.valueOf(100))
                    .high(BigDecimal.valueOf(101))
                    .low(BigDecimal.valueOf(99))
                    .close(BigDecimal.valueOf(100.5))
                    .volume(1_000L)
                    .vwap(BigDecimal.valueOf(100.2))
                    .tradeCount(42)
                    .build());
        }
        priceRepo.flush();
    }
}
