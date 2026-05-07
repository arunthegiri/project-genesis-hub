package com.stocktracker.controller;

import com.stocktracker.dto.ApiDto;
import com.stocktracker.service.StockPriceService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/prices")
public class PriceController {

    private final StockPriceService stockPriceService;

    public PriceController(StockPriceService stockPriceService) {
        this.stockPriceService = stockPriceService;
    }

    /**
     * GET /api/prices/{symbol}/latest?hours=1
     * Returns the most recent bars for a symbol within the last N hours.
     */
    @GetMapping("/{symbol}/latest")
    public ApiDto.PagedResponse<ApiDto.PriceResponse> getLatest(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "1") int hours) {
        return new ApiDto.PagedResponse<>(stockPriceService.getLatest(symbol, hours));
    }

    /**
     * GET /api/prices/{symbol}/range?from=...&to=...
     * Returns bars within an explicit time range (ISO-8601 instants).
     */
    @GetMapping("/{symbol}/range")
    public ApiDto.PagedResponse<ApiDto.PriceResponse> getRange(
            @PathVariable String symbol,
            @RequestParam Instant from,
            @RequestParam Instant to) {
        return new ApiDto.PagedResponse<>(stockPriceService.getRange(symbol, from, to));
    }

    /**
     * POST /api/prices/{symbol}/fetch
     * Immediately triggers a price fetch for all enabled symbols (admin / manual trigger).
     */
    @PostMapping("/fetch")
    public ResponseEntity<String> triggerFetch() {
        stockPriceService.fetchAndStore();
        return ResponseEntity.ok("Fetch triggered successfully.");
    }

    /**
     * POST /api/prices/{symbol}/backfill?from=...&to=...
     * Backfills historical minute bars from Alpaca for a given symbol and range.
     */
    @PostMapping("/{symbol}/backfill")
    public ResponseEntity<String> backfill(
            @PathVariable String symbol,
            @RequestParam Instant from,
            @RequestParam Instant to) {
        int count = stockPriceService.backfill(symbol, from, to);
        return ResponseEntity.ok("Backfilled " + count + " records for " + symbol.toUpperCase());
    }

    /**
     * POST /api/prices/backfill-all?from=...&to=...
     * Backfills all enabled symbols over a given range.
     */
    @PostMapping("/backfill-all")
    public ResponseEntity<String> backfillAll(
            @RequestParam Instant from,
            @RequestParam Instant to) {
        stockPriceService.backfillAll(from, to);
        return ResponseEntity.ok("Backfill triggered for all enabled symbols.");
    }
}
