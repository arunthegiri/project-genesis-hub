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

import java.util.Map;

/**
 * Runs Python in the Jupyter container, where the Ananke SDK lives (build doc M2).
 *
 * The Java container has no SDK and no Python, so generated strategy code is
 * POSTed to the stdlib executor started alongside JupyterLab (executor/executor.py).
 * That executor's process is what ultimately calls {@code k.export()}, which
 * writes the strategy back to this backend over HTTP.
 */
@Slf4j
@Service
public class JupyterExecutionService {

    /** Executor's own cap is 120s; wait slightly longer so its 504 wins the race. */
    private static final int READ_TIMEOUT_MS    = 130_000;
    private static final int CONNECT_TIMEOUT_MS = 10_000;

    private final ObjectMapper mapper = new ObjectMapper();
    private final RestClient client;

    public JupyterExecutionService(
            @Value("${jupyter.executor.url:http://jupyter:5000}") String executorUrl) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(CONNECT_TIMEOUT_MS);
        factory.setReadTimeout(READ_TIMEOUT_MS);
        this.client = RestClient.builder()
                .baseUrl(executorUrl)
                .requestFactory(factory)
                .build();
    }

    public ExecutionResult execute(String pythonCode) {
        try {
            ResponseEntity<String> response = client.post()
                    .uri("/execute")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("code", pythonCode))
                    .retrieve()
                    // Suppress RestClient's default throw-on-error: a 504 from the
                    // executor is a normal outcome we want to report, not an exception.
                    .onStatus(status -> true, (req, res) -> { })
                    .toEntity(String.class);

            String body = response.getBody() == null ? "" : response.getBody();

            if (!response.getStatusCode().is2xxSuccessful()) {
                String detail = body;
                try {
                    JsonNode err = mapper.readTree(body);
                    if (err.hasNonNull("error")) detail = err.get("error").asText();
                } catch (Exception ignored) {
                    // Non-JSON error body — fall back to the raw text.
                }
                return ExecutionResult.error(
                        "Executor returned HTTP " + response.getStatusCode().value() + ": " + detail);
            }

            JsonNode json = mapper.readTree(body);
            int    rc     = json.path("returncode").asInt(-1);
            String stdout = json.path("stdout").asText("");
            String stderr = json.path("stderr").asText("");

            if (rc != 0) {
                log.warn("Generated code exited {} — stderr: {}", rc, stderr);
                return new ExecutionResult(false, stdout, stderr,
                        "Python exited with code " + rc);
            }
            return ExecutionResult.success(stdout, stderr);

        } catch (Exception e) {
            log.error("Failed to execute code in Jupyter", e);
            return ExecutionResult.error(e.getMessage());
        }
    }

    /**
     * @param stdout captured even on failure — the copilot shows it to the user.
     * @param error  null when the run succeeded.
     */
    public record ExecutionResult(boolean success, String stdout, String stderr, String error) {
        public static ExecutionResult success(String stdout, String stderr) {
            return new ExecutionResult(true, stdout, stderr, null);
        }
        public static ExecutionResult error(String error) {
            return new ExecutionResult(false, "", "", error);
        }
    }
}
