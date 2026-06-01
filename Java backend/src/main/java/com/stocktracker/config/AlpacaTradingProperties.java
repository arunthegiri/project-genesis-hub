package com.stocktracker.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Data
@Configuration
@ConfigurationProperties(prefix = "alpaca.trading")
public class AlpacaTradingProperties {
    private String baseUrl = "https://paper-api.alpaca.markets";
    private String key = "";
    private String secret = "";

    public boolean isConfigured() {
        return key != null && !key.isBlank() && secret != null && !secret.isBlank();
    }
}
