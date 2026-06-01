package com.stocktracker.controller;

import com.stocktracker.config.AlpacaTradingProperties;
import com.stocktracker.dto.AlpacaDto;
import com.stocktracker.dto.ApiDto;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.List;

@Slf4j
@RestController
@RequestMapping("/api")
public class LiveController {

    private final AlpacaTradingProperties tradingProps;
    private final RestClient              alpacaTradingClient;

    public LiveController(AlpacaTradingProperties tradingProps,
                          RestClient alpacaTradingClient) {
        this.tradingProps       = tradingProps;
        this.alpacaTradingClient = alpacaTradingClient;
    }

    /**
     * GET /api/account
     * Proxies to paper-api.alpaca.markets/v2/account.
     * Returns null body (204) when trading keys are not configured.
     */
    @GetMapping("/account")
    public ResponseEntity<ApiDto.AccountResponse> account() {
        if (!tradingProps.isConfigured()) {
            return ResponseEntity.noContent().build();
        }
        try {
            AlpacaDto.AlpacaAccount raw = alpacaTradingClient.get()
                    .uri("/v2/account")
                    .retrieve()
                    .body(AlpacaDto.AlpacaAccount.class);
            return ResponseEntity.ok(toAccountResponse(raw));
        } catch (RestClientException ex) {
            log.warn("Failed to fetch Alpaca account: {}", ex.getMessage());
            return ResponseEntity.noContent().build();
        }
    }

    /**
     * GET /api/positions
     * Proxies to paper-api.alpaca.markets/v2/positions.
     * Returns empty list when trading keys are not configured.
     */
    @GetMapping("/positions")
    public List<ApiDto.PositionResponse> positions() {
        if (!tradingProps.isConfigured()) {
            return List.of();
        }
        try {
            List<AlpacaDto.AlpacaPosition> raw = alpacaTradingClient.get()
                    .uri("/v2/positions")
                    .retrieve()
                    .body(new ParameterizedTypeReference<List<AlpacaDto.AlpacaPosition>>() {});
            if (raw == null) return List.of();
            return raw.stream().map(this::toPositionResponse).toList();
        } catch (RestClientException ex) {
            log.warn("Failed to fetch Alpaca positions: {}", ex.getMessage());
            return List.of();
        }
    }

    // ── Mappers ───────────────────────────────────────────────────────────────

    private ApiDto.AccountResponse toAccountResponse(AlpacaDto.AlpacaAccount a) {
        if (a == null) return null;
        ApiDto.AccountResponse r = new ApiDto.AccountResponse();
        r.setId(a.getId());
        r.setAccountNumber(a.getAccountNumber());
        r.setStatus(a.getStatus());
        r.setCurrency(a.getCurrency());
        r.setBuyingPower(a.getBuyingPower());
        r.setCash(a.getCash());
        r.setPortfolioValue(a.getPortfolioValue());
        r.setEquity(a.getEquity());
        r.setLastEquity(a.getLastEquity());
        r.setLongMarketValue(a.getLongMarketValue());
        r.setShortMarketValue(a.getShortMarketValue());
        r.setDaytradingBuyingPower(a.getDaytradingBuyingPower());
        r.setRegtBuyingPower(a.getRegtBuyingPower());
        return r;
    }

    private ApiDto.PositionResponse toPositionResponse(AlpacaDto.AlpacaPosition p) {
        ApiDto.PositionResponse r = new ApiDto.PositionResponse();
        r.setSymbol(p.getSymbol());
        r.setSide(p.getSide());
        r.setQty(p.getQty());
        r.setMarketValue(p.getMarketValue());
        r.setCostBasis(p.getCostBasis());
        r.setUnrealizedPl(p.getUnrealizedPl());
        r.setUnrealizedPlPct(p.getUnrealizedPlPct());
        r.setCurrentPrice(p.getCurrentPrice());
        r.setLastdayPrice(p.getLastdayPrice());
        r.setChangeToday(p.getChangeToday());
        return r;
    }
}
