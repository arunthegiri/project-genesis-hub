package com.stocktracker.controller;

import com.stocktracker.dto.ApiDto;
import com.stocktracker.service.AssetSearchService;
import com.stocktracker.service.SymbolService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/symbols")
public class SymbolController {

    private final SymbolService        symbolService;
    private final AssetSearchService   assetSearchService;

    public SymbolController(SymbolService symbolService, AssetSearchService assetSearchService) {
        this.symbolService       = symbolService;
        this.assetSearchService  = assetSearchService;
    }

    /** GET /api/symbols — list all tracked symbols */
    @GetMapping
    public ApiDto.PagedResponse<ApiDto.SymbolResponse> listSymbols() {
        return new ApiDto.PagedResponse<>(symbolService.listAll());
    }

    /** POST /api/symbols — add a symbol to track */
    @PostMapping
    public ResponseEntity<ApiDto.SymbolResponse> addSymbol(
            @Valid @RequestBody ApiDto.SymbolRequest request) {
        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(symbolService.addSymbol(request.getSymbol()));
    }

    /** DELETE /api/symbols/{symbol} — stop tracking a symbol */
    @DeleteMapping("/{symbol}")
    public ResponseEntity<Void> removeSymbol(@PathVariable String symbol) {
        symbolService.removeSymbol(symbol);
        return ResponseEntity.noContent().build();
    }

    /** GET /api/symbols/search?q=nvidia — search all tradable US equities by symbol or name */
    @GetMapping("/search")
    public List<ApiDto.AssetResult> searchAssets(@RequestParam String q) {
        return assetSearchService.search(q);
    }
}
