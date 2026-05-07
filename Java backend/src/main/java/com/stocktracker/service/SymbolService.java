package com.stocktracker.service;

import com.stocktracker.dto.ApiDto;
import com.stocktracker.model.TrackedSymbol;
import com.stocktracker.repository.TrackedSymbolRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Slf4j
@Service
@Transactional
public class SymbolService {

    private final TrackedSymbolRepository repo;

    public SymbolService(TrackedSymbolRepository repo) {
        this.repo = repo;
    }

    @Transactional(readOnly = true)
    public List<ApiDto.SymbolResponse> listAll() {
        return repo.findAll().stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<String> enabledSymbols() {
        return repo.findAllByEnabledTrue().stream()
                .map(TrackedSymbol::getSymbol)
                .toList();
    }

    public ApiDto.SymbolResponse addSymbol(String symbol) {
        String upper = symbol.toUpperCase();

        if (repo.existsBySymbolIgnoreCase(upper)) {
            // Re-enable if it was disabled
            TrackedSymbol existing = repo.findBySymbolIgnoreCase(upper).orElseThrow();
            existing.setEnabled(true);
            log.info("Re-enabled symbol: {}", upper);
            return toResponse(repo.save(existing));
        }

        TrackedSymbol ts = TrackedSymbol.builder()
                .symbol(upper)
                .enabled(true)
                .build();

        log.info("Adding new tracked symbol: {}", upper);
        return toResponse(repo.save(ts));
    }

    public void removeSymbol(String symbol) {
        repo.findBySymbolIgnoreCase(symbol.toUpperCase()).ifPresent(ts -> {
            ts.setEnabled(false);
            repo.save(ts);
            log.info("Disabled symbol: {}", symbol.toUpperCase());
        });
    }

    private ApiDto.SymbolResponse toResponse(TrackedSymbol ts) {
        ApiDto.SymbolResponse r = new ApiDto.SymbolResponse();
        r.setId(ts.getId());
        r.setSymbol(ts.getSymbol());
        r.setEnabled(ts.isEnabled());
        r.setCreatedAt(ts.getCreatedAt());
        return r;
    }
}
