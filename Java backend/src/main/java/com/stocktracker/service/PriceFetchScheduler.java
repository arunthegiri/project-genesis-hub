package com.stocktracker.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Slf4j
@Component
public class PriceFetchScheduler {

    private final StockPriceService stockPriceService;

    public PriceFetchScheduler(StockPriceService stockPriceService) {
        this.stockPriceService = stockPriceService;
    }

    /**
     * Fetch & store prices at a fixed rate.
     * Rate is controlled by {@code alpaca.fetch.interval-ms} (default 60 s).
     */
    @Scheduled(fixedRateString = "${alpaca.fetch.interval-ms:60000}",
               initialDelayString = "${alpaca.fetch.interval-ms:60000}")
    public void scheduledFetch() {
        log.debug("Scheduled price fetch triggered.");
        try {
            stockPriceService.fetchAndStore();
        } catch (Exception ex) {
            // Catch all so the scheduler thread is never killed
            log.error("Scheduled fetch failed: {}", ex.getMessage(), ex);
        }
    }
}
