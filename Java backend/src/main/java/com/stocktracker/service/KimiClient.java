package com.stocktracker.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Kimi (Moonshot) chat client. The API is OpenAI-shaped, so requests carry
 * {@code messages}/{@code tools} and responses expose
 * {@code choices[0].message} plus {@code finish_reason}.
 *
 * Mirrors the configuration the standalone ananke-copilot already used
 * (KIMI_API_KEY / KIMI_BASE_URL / KIMI_MODEL) so one key serves both apps.
 */
@Slf4j
@Service
public class KimiClient {

    private static final int READ_TIMEOUT_MS    = 180_000;
    private static final int CONNECT_TIMEOUT_MS = 10_000;

    private final ObjectMapper mapper = new ObjectMapper();
    private final RestClient client;
    private final String apiKey;
    private final String model;

    public KimiClient(
            @Value("${kimi.api-key:}")   String apiKey,
            @Value("${kimi.base-url:https://api.moonshot.ai/v1}") String baseUrl,
            @Value("${kimi.model:kimi-k2-0905-preview}")          String model) {
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.model  = model;

        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(CONNECT_TIMEOUT_MS);
        factory.setReadTimeout(READ_TIMEOUT_MS);
        this.client = RestClient.builder()
                .baseUrl(baseUrl.replaceAll("/+$", ""))
                .requestFactory(factory)
                .build();
    }

    /** Controllers check this up front so a missing key is a clean 503, not a stream that dies. */
    public boolean isConfigured() {
        return !apiKey.isEmpty();
    }

    public String model() {
        return model;
    }

    /**
     * One non-streaming completion.
     *
     * @param tools OpenAI-shaped tool definitions; omitted from the payload when empty.
     * @return the raw response root — callers read {@code choices[0]}.
     */
    public JsonNode chat(List<Map<String, Object>> messages,
                         List<Map<String, Object>> tools,
                         int maxTokens) {
        if (!isConfigured()) {
            throw new KimiUnavailableException(
                    "KIMI_API_KEY is not set. Add it to the project .env and restart stock-tracker.");
        }

        Map<String, Object> payload = new HashMap<>();
        payload.put("model", model);
        payload.put("messages", messages);
        payload.put("max_tokens", maxTokens);
        // Deliberately no temperature: some Kimi models (k3 on the coding
        // endpoint) reject anything but 1, so we take each model's default.
        if (tools != null && !tools.isEmpty()) {
            payload.put("tools", tools);
        }

        ResponseEntity<String> response = client.post()
                .uri("/chat/completions")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", "Bearer " + apiKey)
                .body(payload)
                .retrieve()
                .onStatus(status -> true, (req, res) -> { })
                .toEntity(String.class);

        String body = response.getBody() == null ? "" : response.getBody();

        if (!response.getStatusCode().is2xxSuccessful()) {
            String snippet = body.length() > 400 ? body.substring(0, 400) : body;
            throw new KimiUnavailableException(
                    "Kimi request failed (" + response.getStatusCode().value() + "): " + snippet);
        }

        try {
            return mapper.readTree(body);
        } catch (Exception e) {
            throw new KimiUnavailableException("Kimi returned unparseable JSON: " + e.getMessage());
        }
    }

    /** Convenience for a plain prompt with no tools. */
    public String complete(String systemPrompt, String userPrompt, int maxTokens) {
        List<Map<String, Object>> messages = new ArrayList<>();
        messages.add(Map.of("role", "system", "content", systemPrompt));
        messages.add(Map.of("role", "user", "content", userPrompt));
        JsonNode root = chat(messages, List.of(), maxTokens);
        return root.path("choices").path(0).path("message").path("content").asText("");
    }

    /** Signals "the AI provider is unusable right now" — surfaced to callers as 503. */
    public static class KimiUnavailableException extends RuntimeException {
        public KimiUnavailableException(String message) {
            super(message);
        }
    }
}
