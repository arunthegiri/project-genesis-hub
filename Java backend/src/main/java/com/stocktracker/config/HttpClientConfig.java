package com.stocktracker.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

@Configuration
public class HttpClientConfig {

    private final AlpacaProperties        props;
    private final AlpacaTradingProperties tradingProps;

    public HttpClientConfig(AlpacaProperties props, AlpacaTradingProperties tradingProps) {
        this.props        = props;
        this.tradingProps = tradingProps;
    }

    @Bean
    public RestClient alpacaRestClient() {
        return RestClient.builder()
                .baseUrl(props.getBaseUrl())
                .defaultHeader("APCA-API-KEY-ID",     props.getKey())
                .defaultHeader("APCA-API-SECRET-KEY", props.getSecret())
                .defaultHeader("Accept", "application/json")
                .build();
    }

    @Bean
    public RestClient alpacaBrokerClient() {
        return RestClient.builder()
                .baseUrl(props.getBrokerBaseUrl())
                .defaultHeader("APCA-API-KEY-ID",     props.getKey())
                .defaultHeader("APCA-API-SECRET-KEY", props.getSecret())
                .defaultHeader("Accept", "application/json")
                .build();
    }

    @Bean
    public RestClient alpacaTradingClient() {
        return RestClient.builder()
                .baseUrl(tradingProps.getBaseUrl())
                .defaultHeader("APCA-API-KEY-ID",     tradingProps.getKey())
                .defaultHeader("APCA-API-SECRET-KEY", tradingProps.getSecret())
                .defaultHeader("Accept", "application/json")
                .build();
    }
}
