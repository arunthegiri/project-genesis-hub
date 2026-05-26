package com.stocktracker.service;

import com.stocktracker.dto.AlpacaDto;
import com.stocktracker.model.BackfillJob;
import com.stocktracker.model.StockPrice;
import com.stocktracker.model.SymbolCoverage;
import com.stocktracker.repository.BackfillJobRepository;
import com.stocktracker.repository.SymbolCoverageRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Runs the actual backfill work in a background thread.
 * Kept in a separate bean from BackfillJobService so @Async is intercepted
 * correctly by Spring's proxy — calling @Async on yourself never works.
 */
@Slf4j
@Component
public class BackfillJobExecutor {

    private final BackfillJobRepository      jobRepo;
    private final SymbolCoverageRepository   coverageRepo;
    private final AlpacaClient               alpacaClient;
    private final JdbcTemplate               jdbc;

    public BackfillJobExecutor(BackfillJobRepository jobRepo,
                               SymbolCoverageRepository coverageRepo,
                               AlpacaClient alpacaClient,
                               JdbcTemplate jdbc) {
        this.jobRepo      = jobRepo;
        this.coverageRepo = coverageRepo;
        this.alpacaClient = alpacaClient;
        this.jdbc         = jdbc;
    }

    @Async
    public void run(UUID jobId, List<Instant[]> chunks) {
        BackfillJob job = jobRepo.findById(jobId).orElseThrow();

        job.setStatus("RUNNING");
        job.setStartedAt(Instant.now());
        job.setUpdatedAt(Instant.now());
        jobRepo.save(job);

        for (int i = job.getCompletedChunks(); i < chunks.size(); i++) {
            // Check for cancellation at the start of every chunk
            String currentStatus = jobRepo.findById(jobId)
                    .map(BackfillJob::getStatus).orElse("");
            if ("CANCELLED".equals(currentStatus)) {
                log.info("Backfill job {} cancelled at chunk {}", jobId, i);
                return;
            }

            Instant chunkFrom = chunks.get(i)[0];
            Instant chunkTo   = chunks.get(i)[1];

            job.setCurrentChunkFrom(chunkFrom);
            job.setCurrentChunkTo(chunkTo);
            job.setUpdatedAt(Instant.now());
            jobRepo.save(job);

            try {
                List<AlpacaDto.Bar> bars = alpacaClient.fetchHistoricalBars(
                        job.getSymbol(), chunkFrom, chunkTo);

                if (!bars.isEmpty()) {
                    batchInsert(job.getSymbol(), bars);
                }

                job.setTotalBars(job.getTotalBars() + bars.size());
                job.setCompletedChunks(i + 1);
                job.setUpdatedAt(Instant.now());
                jobRepo.save(job);

                log.info("Job {} chunk {}/{} done — {} bars fetched",
                        jobId, i + 1, chunks.size(), bars.size());

            } catch (Exception ex) {
                job.setStatus("FAILED");
                job.setErrorMessage(ex.getMessage());
                job.setFailedAtChunk(i);
                job.setUpdatedAt(Instant.now());
                jobRepo.save(job);
                log.error("Job {} failed at chunk {}: {}", jobId, i, ex.getMessage());
                return;
            }
        }

        // All chunks done — update coverage
        updateCoverage(job.getSymbol(), job.getFromTime(), job.getToTime());

        job.setStatus("COMPLETED");
        job.setCompletedAt(Instant.now());
        job.setUpdatedAt(Instant.now());
        jobRepo.save(job);

        log.info("Job {} completed — {} total bars for {}",
                jobId, job.getTotalBars(), job.getSymbol());
    }

    private void batchInsert(String symbol, List<AlpacaDto.Bar> bars) {
        String sql = """
                INSERT INTO stock_prices
                    (time, symbol, open, high, low, close, volume, vwap, trade_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (time, symbol) DO NOTHING
                """;
        jdbc.batchUpdate(sql, bars, 1000, (ps, bar) -> {
            ps.setTimestamp(1, Timestamp.from(bar.getTime()));
            ps.setString(2, symbol);
            ps.setBigDecimal(3, bar.getOpen());
            ps.setBigDecimal(4, bar.getHigh());
            ps.setBigDecimal(5, bar.getLow());
            ps.setBigDecimal(6, bar.getClose());
            ps.setObject(7, bar.getVolume());
            ps.setBigDecimal(8, bar.getVwap());
            ps.setObject(9, bar.getTradeCount());
        });
    }

    private void updateCoverage(String symbol, Instant from, Instant to) {
        coverageRepo.findById(symbol).ifPresentOrElse(c -> {
            if (from.isBefore(c.getFromTime())) c.setFromTime(from);
            if (to.isAfter(c.getToTime()))       c.setToTime(to);
            coverageRepo.save(c);
        }, () -> coverageRepo.save(SymbolCoverage.builder()
                .symbol(symbol).fromTime(from).toTime(to).build()));
    }
}
