package com.stocktracker.controller;

import com.stocktracker.dto.CopilotDto;
import com.stocktracker.service.CopilotService;
import com.stocktracker.service.KimiClient;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/copilot")
public class CopilotController {

    /** Research runs an LLM loop, Python execution and a backtest — minutes, not seconds. */
    private static final long RESEARCH_TIMEOUT_MS = 300_000L;
    private static final long CHAT_TIMEOUT_MS     = 120_000L;

    private final CopilotService copilotService;
    private final KimiClient     kimiClient;

    public CopilotController(CopilotService copilotService, KimiClient kimiClient) {
        this.copilotService = copilotService;
        this.kimiClient     = kimiClient;
    }

    /**
     * Full research pipeline: prompt → data → code → execution → backtest → explanation.
     * Streams Server-Sent Events so each step can render its own UI as it lands.
     *
     * Returns {@code SseEmitter} directly, not wrapped in a ResponseEntity: the
     * async dispatch is what installs the text/event-stream converter, and a
     * ResponseEntity wrapper makes Spring look for a converter for the emitter
     * itself, which fails with "No converter for SseEmitter".
     */
    @PostMapping(value = "/research", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter research(@Valid @RequestBody CopilotDto.ResearchRequest req) {
        requireCopilot();
        SseEmitter emitter = new SseEmitter(RESEARCH_TIMEOUT_MS);
        copilotService.runResearch(req.getPrompt(), req.getMessages(), emitter);
        return emitter;
    }

    /** Simple Q&A — same tool loop, no code execution or backtest. */
    @PostMapping(value = "/chat", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter chat(@Valid @RequestBody CopilotDto.ChatRequest req) {
        requireCopilot();
        SseEmitter emitter = new SseEmitter(CHAT_TIMEOUT_MS);
        copilotService.streamChat(req.getMessages(), emitter);
        return emitter;
    }

    /**
     * Thrown before the emitter is created so a missing key surfaces as a clean
     * 503 (via GlobalExceptionHandler) rather than a stream that opens and dies.
     */
    private void requireCopilot() {
        if (!kimiClient.isConfigured()) {
            throw new KimiClient.KimiUnavailableException(
                    "Copilot is unavailable: KIMI_API_KEY is not configured on the backend.");
        }
    }
}
