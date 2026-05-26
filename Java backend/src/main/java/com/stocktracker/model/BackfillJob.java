package com.stocktracker.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "backfill_jobs")
public class BackfillJob {

    @Id
    @GeneratedValue
    @Column(columnDefinition = "uuid")
    private UUID id;

    @Column(nullable = false, length = 20)
    private String symbol;

    @Column(name = "from_time", nullable = false)
    private Instant fromTime;

    @Column(name = "to_time", nullable = false)
    private Instant toTime;

    @Column(nullable = false)
    @Builder.Default
    private String status = "PENDING";

    @Column(name = "total_chunks")
    @Builder.Default
    private int totalChunks = 0;

    @Column(name = "completed_chunks")
    @Builder.Default
    private int completedChunks = 0;

    @Column(name = "total_bars")
    @Builder.Default
    private int totalBars = 0;

    @Column(name = "current_chunk_from")
    private Instant currentChunkFrom;

    @Column(name = "current_chunk_to")
    private Instant currentChunkTo;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "failed_at_chunk")
    private Integer failedAtChunk;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();

    public double progressPct() {
        if (totalChunks == 0) return 0.0;
        return (completedChunks * 100.0) / totalChunks;
    }
}
