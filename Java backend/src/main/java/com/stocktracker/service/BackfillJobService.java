package com.stocktracker.service;

import com.stocktracker.dto.ApiDto;
import com.stocktracker.model.BackfillJob;
import com.stocktracker.repository.BackfillJobRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.UUID;

@Slf4j
@Service
public class BackfillJobService {

    private final BackfillJobRepository jobRepo;
    private final BackfillJobExecutor   executor;

    public BackfillJobService(BackfillJobRepository jobRepo,
                              BackfillJobExecutor executor) {
        this.jobRepo  = jobRepo;
        this.executor = executor;
    }

    // ── Submit a new job ──────────────────────────────────────────────────────

    public ApiDto.BackfillJobResponse submitJob(String symbol, Instant from, Instant to) {
        String sym = symbol.toUpperCase();

        if (from.isAfter(to) || from.equals(to)) {
            throw new IllegalArgumentException("'from' must be before 'to'");
        }

        if (jobRepo.existsBySymbolAndStatusIn(sym, List.of("PENDING", "RUNNING"))) {
            throw new IllegalStateException(
                    "A backfill job is already running for " + sym +
                    ". Check status with GET /api/prices/jobs/{jobId}");
        }

        List<Instant[]> chunks = buildMonthlyChunks(from, to);

        BackfillJob job = BackfillJob.builder()
                .symbol(sym)
                .fromTime(from)
                .toTime(to)
                .status("PENDING")
                .totalChunks(chunks.size())
                .build();
        // saveAndFlush commits immediately so the background thread can find the job in DB
        job = jobRepo.saveAndFlush(job);

        executor.run(job.getId(), chunks);

        log.info("Submitted backfill job {} for {} ({} chunks)", job.getId(), sym, chunks.size());
        return toResponse(job);
    }

    // ── Get status ────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public ApiDto.BackfillJobResponse getJobStatus(UUID jobId) {
        return jobRepo.findById(jobId)
                .map(this::toResponse)
                .orElseThrow(() -> new NoSuchElementException("Job not found: " + jobId));
    }

    // ── List jobs for a symbol ────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<ApiDto.BackfillJobResponse> getJobsForSymbol(String symbol) {
        return jobRepo.findBySymbolOrderByCreatedAtDesc(symbol.toUpperCase())
                .stream()
                .map(this::toResponse)
                .toList();
    }

    // ── Retry a failed job ────────────────────────────────────────────────────

    @Transactional
    public ApiDto.BackfillJobResponse retryJob(UUID jobId) {
        BackfillJob job = jobRepo.findById(jobId)
                .orElseThrow(() -> new NoSuchElementException("Job not found: " + jobId));

        if (!"FAILED".equals(job.getStatus())) {
            throw new IllegalStateException("Only FAILED jobs can be retried. Current status: " + job.getStatus());
        }

        List<Instant[]> allChunks    = buildMonthlyChunks(job.getFromTime(), job.getToTime());
        int             startChunk   = job.getFailedAtChunk() != null ? job.getFailedAtChunk() : 0;
        List<Instant[]> remaining    = allChunks.subList(startChunk, allChunks.size());

        job.setStatus("PENDING");
        job.setErrorMessage(null);
        job.setFailedAtChunk(null);
        job.setUpdatedAt(Instant.now());
        job = jobRepo.save(job);

        executor.run(job.getId(), allChunks);

        log.info("Retrying job {} from chunk {}", jobId, startChunk);
        return toResponse(job);
    }

    // ── Cancel a job ─────────────────────────────────────────────────────────

    @Transactional
    public void cancelJob(UUID jobId) {
        BackfillJob job = jobRepo.findById(jobId)
                .orElseThrow(() -> new NoSuchElementException("Job not found: " + jobId));

        if (!List.of("PENDING", "RUNNING").contains(job.getStatus())) {
            throw new IllegalStateException("Only PENDING or RUNNING jobs can be cancelled.");
        }

        job.setStatus("CANCELLED");
        job.setUpdatedAt(Instant.now());
        jobRepo.save(job);
        log.info("Job {} marked as CANCELLED", jobId);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private List<Instant[]> buildMonthlyChunks(Instant from, Instant to) {
        List<Instant[]> chunks = new ArrayList<>();
        ZonedDateTime current = from.atZone(ZoneOffset.UTC).toLocalDate()
                .atStartOfDay(ZoneOffset.UTC);
        ZonedDateTime end = to.atZone(ZoneOffset.UTC);

        while (current.toInstant().isBefore(to)) {
            ZonedDateTime next = current.plusMonths(1);
            if (next.isAfter(end)) next = end;
            chunks.add(new Instant[]{current.toInstant(), next.toInstant()});
            current = next;
        }
        return chunks;
    }

    private ApiDto.BackfillJobResponse toResponse(BackfillJob job) {
        ApiDto.BackfillJobResponse r = new ApiDto.BackfillJobResponse();
        r.setJobId(job.getId());
        r.setSymbol(job.getSymbol());
        r.setFromTime(job.getFromTime());
        r.setToTime(job.getToTime());
        r.setStatus(job.getStatus());
        r.setTotalChunks(job.getTotalChunks());
        r.setCompletedChunks(job.getCompletedChunks());
        r.setTotalBars(job.getTotalBars());
        r.setProgressPct(job.progressPct());
        r.setErrorMessage(job.getErrorMessage());
        r.setCreatedAt(job.getCreatedAt());
        r.setStartedAt(job.getStartedAt());
        r.setCompletedAt(job.getCompletedAt());
        r.setCurrentChunkFrom(job.getCurrentChunkFrom());
        r.setCurrentChunkTo(job.getCurrentChunkTo());
        return r;
    }
}
