package com.stocktracker.repository;

import com.stocktracker.model.BacktestResult;
import com.stocktracker.model.Strategy;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface BacktestResultRepository extends JpaRepository<BacktestResult, Long> {
    List<BacktestResult> findByStrategyOrderByCreatedAtDesc(Strategy strategy);
    Optional<BacktestResult> findTopByStrategyOrderByCreatedAtDesc(Strategy strategy);
}
