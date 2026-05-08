package com.stocktracker.service;

import com.stocktracker.dto.AlpacaDto;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Thin wrapper around the Alpaca Market Data v2 REST API.
 */
@Slf4j
@Service
public class AlpacaClient {

    private static final String BARS_PATH      = "/v2/stocks/bars";
    private static final String SNAPSHOTS_PATH = "/v2/stocks/snapshots";

    private final RestClient restClient;

    public AlpacaClient(RestClient alpacaRestClient) {
        this.restClient = alpacaRestClient;
    }

    /**
     * Fetch the latest minute bar for every symbol in the list.
     * Uses the multi-symbol endpoint so one HTTP call handles all symbols.
     *
     * @param symbols non-empty list of ticker symbols
     * @return map of symbol -> list of bars (usually just the most recent bar)
     */
    public Map<String, List<AlpacaDto.Bar>> fetchLatestBars(List<String> symbols) {
        if (symbols.isEmpty()) {
            return Map.of();
        }

        String symbolsCsv = String.join(",", symbols);
        Instant start     = Instant.now().minus(5, ChronoUnit.MINUTES);

        String uri = UriComponentsBuilder.fromPath(BARS_PATH)
                .queryParam("symbols",   symbolsCsv)
                .queryParam("timeframe", "1Min")
                .queryParam("start",     start.toString())
                .queryParam("limit",     10)
                .queryParam("feed",      "iex")
                .queryParam("sort",      "desc")
                .toUriString();

        log.debug("Fetching bars: {}", uri);

        AlpacaDto.BarsResponse response = restClient.get()
                .uri(uri)
                .retrieve()
                .body(AlpacaDto.BarsResponse.class);

        if (response == null || response.getBars() == null) {
            log.warn("Empty bars response from Alpaca for symbols: {}", symbolsCsv);
            return Map.of();
        }

        return response.getBars();
    }

    /**
     * Fetch historical minute bars for a single symbol over a time range.
     * Paginates automatically using next_page_token until all bars are retrieved.
     */
    public List<AlpacaDto.Bar> fetchHistoricalBars(String symbol, Instant from, Instant to) {
        List<AlpacaDto.Bar> allBars = new ArrayList<>();
        String pageToken = null;

        do {
            UriComponentsBuilder builder = UriComponentsBuilder.fromPath("/v2/stocks/{symbol}/bars")
                    .queryParam("timeframe", "1Min")
                    .queryParam("start",     from.toString())
                    .queryParam("end",       to.toString())
                    .queryParam("limit",     10000)
                    .queryParam("feed",      "iex")
                    .queryParam("sort",      "asc");

            if (pageToken != null) {
                builder.queryParam("page_token", pageToken);
            }

            String uri = builder.buildAndExpand(symbol).toUriString();
            log.debug("Fetching historical bars for {}: {} -> {} (page_token={})", symbol, from, to, pageToken);

            AlpacaDto.SingleBarsResponse response = restClient.get()
                    .uri(uri)
                    .retrieve()
                    .body(AlpacaDto.SingleBarsResponse.class);

            if (response == null || response.getBars() == null) {
                log.warn("Empty historical bars response for symbol: {}", symbol);
                break;
            }

            allBars.addAll(response.getBars());
            pageToken = response.getNextPageToken();

        } while (pageToken != null);

        log.info("Fetched {} total bars for {} [{} -> {}]", allBars.size(), symbol, from, to);
        return allBars;
    }

    /**
     * Fetch the latest snapshot (trade, quote, minute bar, daily bar) for each symbol.
     */
    public Map<String, AlpacaDto.Snapshot> fetchSnapshots(List<String> symbols) {
        if (symbols.isEmpty()) {
            return Map.of();
        }

        String symbolsCsv = String.join(",", symbols);

        String uri = UriComponentsBuilder.fromPath(SNAPSHOTS_PATH)
                .queryParam("symbols", symbolsCsv)
                .queryParam("feed",    "iex")
                .toUriString();

        log.debug("Fetching snapshots: {}", uri);

        AlpacaDto.SnapshotsResponse response = restClient.get()
                .uri(uri)
                .retrieve()
                .body(AlpacaDto.SnapshotsResponse.class);

        if (response == null || response.getSnapshots() == null) {
            log.warn("Empty snapshots response from Alpaca for symbols: {}", symbolsCsv);
            return Map.of();
        }

        return response.getSnapshots();
    }
}