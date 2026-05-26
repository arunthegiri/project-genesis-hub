package com.stocktracker.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import lombok.Data;

@Data
@Configuration
@ConfigurationProperties(prefix = "alpaca.api")
public class AlpacaProperties {
    private String baseUrl;
    private String brokerBaseUrl = "https://paper-api.alpaca.markets";
    private String key;
    private String secret;
}
