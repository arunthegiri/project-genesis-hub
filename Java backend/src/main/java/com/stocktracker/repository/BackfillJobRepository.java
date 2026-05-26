package com.stocktracker.repository;

import com.stocktracker.model.BackfillJob;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface BackfillJobRepository extends JpaRepository<BackfillJob, UUID> {
    List<BackfillJob> findBySymbolOrderByCreatedAtDesc(String symbol);
    List<BackfillJob> findByStatusOrderByCreatedAtDesc(String status);
    Optional<BackfillJob> findTopBySymbolAndStatusOrderByCreatedAtDesc(String symbol, String status);
    boolean existsBySymbolAndStatusIn(String symbol, List<String> statuses);
}
