package com.stocktracker.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry r) {
        r.addMapping("/api/**")
            .allowedOriginPatterns(
                "http://localhost:*",
                "https://*.lovable.app",
                "https://*.lovableproject.com",
                "https://*.ngrok-free.app",
                "http://172.17.18.231:*"
            )
            .allowedMethods("GET", "POST", "DELETE", "OPTIONS")
            .allowedHeaders("*");
    }
}