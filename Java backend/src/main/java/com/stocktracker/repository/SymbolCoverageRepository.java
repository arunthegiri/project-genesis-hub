package com.stocktracker.repository;

import com.stocktracker.model.SymbolCoverage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface SymbolCoverageRepository extends JpaRepository<SymbolCoverage, String> {}
