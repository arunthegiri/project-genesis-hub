package com.stocktracker.repository;

import com.stocktracker.model.TrackedSymbol;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface TrackedSymbolRepository extends JpaRepository<TrackedSymbol, Long> {

    List<TrackedSymbol> findAllByEnabledTrue();

    Optional<TrackedSymbol> findBySymbolIgnoreCase(String symbol);

    boolean existsBySymbolIgnoreCase(String symbol);
}
