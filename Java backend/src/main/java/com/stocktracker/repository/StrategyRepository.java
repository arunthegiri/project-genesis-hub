package com.stocktracker.repository;

import com.stocktracker.model.Strategy;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface StrategyRepository extends JpaRepository<Strategy, Long> {
    Optional<Strategy> findByName(String name);
    boolean existsByName(String name);
    List<Strategy> findAllByOrderByCreatedAtDesc();
    List<Strategy> findByStatusInOrderByUpdatedAtDesc(List<String> statuses);
}
