package com.stocktracker.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

public class CopilotDto {

    @Data
    public static class ResearchRequest {
        @NotBlank
        private String prompt;
        /** Optional conversation history for context. */
        private List<Message> messages;
    }

    @Data
    public static class ChatRequest {
        @NotEmpty
        private List<Message> messages;
    }

    @Data
    public static class Message {
        private String role;   // "user" | "assistant" | "system"
        private String content;
    }

    /**
     * One SSE frame. {@code type} tells the frontend which UI to render:
     * status pill, code block, metrics card, explanation panel, or error.
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ResearchEvent {
        /** status | code | backtest | explanation | error | done */
        private String type;
        private String message;
        private Object payload;

        public static ResearchEvent status(String message) {
            return new ResearchEvent("status", message, null);
        }
        public static ResearchEvent code(String code) {
            return new ResearchEvent("code", "Generated strategy", code);
        }
        public static ResearchEvent backtest(Object metrics) {
            return new ResearchEvent("backtest", "Backtest complete", metrics);
        }
        public static ResearchEvent explanation(String text) {
            return new ResearchEvent("explanation", "Analysis complete", text);
        }
        public static ResearchEvent error(String message) {
            return new ResearchEvent("error", message, null);
        }
        public static ResearchEvent done(Object payload) {
            return new ResearchEvent("done", "Done", payload);
        }
        public static ResearchEvent token(String text) {
            return new ResearchEvent("token", null, text);
        }
    }

    /**
     * Payload of the terminal {@code done} event — what the frontend needs to
     * deep-link into the Results tab.
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ResearchSummary {
        private String  strategyName;
        private String  symbol;
        private Long    backtestResultId;
        /** True when the Java engine could not re-run the definition and the
         *  SDK's own exported run was used instead. */
        private boolean usedExportedResult;
    }
}
