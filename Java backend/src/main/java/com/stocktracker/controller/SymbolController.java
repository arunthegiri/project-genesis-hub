package com.stocktracker.controller;

import com.stocktracker.dto.ApiDto;
import com.stocktracker.service.SymbolService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/symbols")
public class SymbolController {

    private final SymbolService symbolService;

    public SymbolController(SymbolService symbolService) {
        this.symbolService = symbolService;
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
}
