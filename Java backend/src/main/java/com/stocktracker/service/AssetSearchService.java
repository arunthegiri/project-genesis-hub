package com.stocktracker.service;

import com.stocktracker.dto.AlpacaDto;
import com.stocktracker.dto.ApiDto;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

@Slf4j
@Service
public class AssetSearchService {

    private final RestClient brokerClient;

    private record AssetEntry(String symbol, String name) {}

    private final AtomicReference<List<AssetEntry>> cache =
            new AtomicReference<>(List.of());

    public AssetSearchService(RestClient alpacaBrokerClient) {
        this.brokerClient = alpacaBrokerClient;
    }

    @PostConstruct
    public void init() {
        // Load in background so slow startup doesn't block the app
        Thread t = new Thread(this::refresh, "asset-loader");
        t.setDaemon(true);
        t.start();
    }

    @Scheduled(cron = "0 0 6 * * *")
    public void refresh() {
        try {
            AlpacaDto.Asset[] assets = brokerClient.get()
                    .uri("/v2/assets?status=active&asset_class=us_equity")
                    .retrieve()
                    .body(AlpacaDto.Asset[].class);

            if (assets == null) {
                log.warn("Asset list from Alpaca was null");
                return;
            }

            List<AssetEntry> entries = Arrays.stream(assets)
                    .filter(a -> a.getSymbol() != null && a.getName() != null && a.isTradable())
                    .map(a -> new AssetEntry(a.getSymbol(), a.getName()))
                    .toList();

            cache.set(entries);
            log.info("Loaded {} tradable assets from Alpaca", entries.size());

        } catch (Exception e) {
            log.error("Failed to load assets from Alpaca: {}", e.getMessage());
        }
    }

    public List<ApiDto.AssetResult> search(String q) {
        if (q == null || q.isBlank()) return List.of();
        String lower = q.strip().toLowerCase();

        return cache.get().stream()
                .filter(a -> a.symbol().toLowerCase().startsWith(lower)
                          || a.name().toLowerCase().contains(lower))
                .sorted((a, b) -> {
                    boolean aExact = a.symbol().equalsIgnoreCase(lower);
                    boolean bExact = b.symbol().equalsIgnoreCase(lower);
                    if (aExact && !bExact) return -1;
                    if (!aExact && bExact) return 1;
                    boolean aSym = a.symbol().toLowerCase().startsWith(lower);
                    boolean bSym = b.symbol().toLowerCase().startsWith(lower);
                    if (aSym && !bSym) return -1;
                    if (!aSym && bSym) return 1;
                    return a.symbol().compareTo(b.symbol());
                })
                .limit(10)
                .map(a -> new ApiDto.AssetResult(a.symbol(), a.name()))
                .toList();
    }
}
