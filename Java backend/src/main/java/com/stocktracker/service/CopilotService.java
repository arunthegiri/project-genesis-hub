package com.stocktracker.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.stocktracker.dto.ApiDto;
import com.stocktracker.dto.CopilotDto;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Orchestrates the copilot research pipeline (build doc M4):
 * prompt → market data → generated Python → execution in Jupyter → backtest →
 * explanation, streaming each step to the browser over SSE.
 *
 * The copilot orchestrates Ananke rather than reimplementing it: code runs in
 * the Jupyter container that owns the SDK, {@code k.export()} writes through
 * the normal strategy endpoint, and the backtest goes through
 * {@link BacktestEngineService}.
 */
@Slf4j
@Service
public class CopilotService {

    /** Guard against a model that keeps calling tools forever. */
    private static final int MAX_TOOL_ITERATIONS = 8;
    private static final int MAX_TOKENS          = 8192;
    /** Bars are 1-minute; a wide range is thousands of rows. Only a sample reaches the model. */
    private static final int SAMPLE_BARS         = 5;

    private static final Pattern CODE_FENCE =
            Pattern.compile("```(?:python|py)?\\s*\\n(.*?)```", Pattern.DOTALL);
    /** The SDK prints this on a successful export — the most reliable name source. */
    private static final Pattern EXPORT_CONFIRMATION =
            Pattern.compile("Kairos '([^']+)' exported successfully");
    private static final Pattern NAME_IN_CODE =
            Pattern.compile("name\\s*=\\s*['\"]([^'\"]+)['\"]");

    private final KimiClient              kimi;
    private final JupyterExecutionService jupyter;
    private final StrategyService         strategyService;
    private final SymbolService           symbolService;
    private final AssetSearchService      assetSearch;
    private final StockPriceService       priceService;

    /**
     * Spring's configured mapper, not a bare {@code new ObjectMapper()}: the
     * backtest payload carries {@link Instant} fields, and only the
     * auto-configured bean has the JSR-310 module registered to write them.
     */
    private final ObjectMapper mapper;

    /**
     * Dedicated pool: the shared task executor is sized for backfill jobs
     * (core 2 / queue 10) and a 5-minute research run would starve it.
     */
    private final ExecutorService pool = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "copilot-" + THREAD_SEQ.incrementAndGet());
        t.setDaemon(true);
        return t;
    });
    private static final AtomicInteger THREAD_SEQ = new AtomicInteger();

    public CopilotService(KimiClient kimi,
                          JupyterExecutionService jupyter,
                          StrategyService strategyService,
                          SymbolService symbolService,
                          AssetSearchService assetSearch,
                          StockPriceService priceService,
                          ObjectMapper mapper) {
        this.mapper          = mapper;
        this.kimi            = kimi;
        this.jupyter         = jupyter;
        this.strategyService = strategyService;
        this.symbolService   = symbolService;
        this.assetSearch     = assetSearch;
        this.priceService    = priceService;
    }

    // ── System prompts ────────────────────────────────────────────────────────

    /**
     * Every SDK call here is checked against ananke-sdk. Three details are
     * load-bearing and a generic LLM gets them wrong:
     *   • get_data() is positional — `from` is a reserved word in Python.
     *   • export() raises unless run() was called first.
     *   • the engine only re-runs rsi_crossover / ema_crossover definitions.
     */
    private static final String RESEARCH_SYSTEM_PROMPT = """
            You are the Ananke AI Copilot, a quantitative research assistant.

            You help users build, test and analyse trading strategies. When asked to
            build a strategy: gather data with the tools, then emit ONE Python script
            in a single ```python fenced block. Emit no other code block.

            The script runs in a Jupyter container with the Ananke SDK installed.

            EXACT SDK CONTRACT — deviating from this breaks the run:

            ```python
            from ananke import get_data, Kairos
            from ananke.indicators import rsi, ema, sma, macd, bollinger, atr, vwap

            # get_data(symbol, start, end, interval) — POSITIONAL.
            # 'from' is a reserved Python keyword; never use from=/to= here.
            # interval: '1min','5min','15min','30min','1hour','1day'
            # ALWAYS request the 'symbol' column or the saved run has no symbol.
            df = get_data('NVDA', '2024-06-01', '2024-12-31', '5min',
                          columns=['open','high','low','close','volume','symbol'])

            RSI_PERIOD, OVERSOLD, OVERBOUGHT = 14, 30, 70
            STOP_LOSS, TAKE_PROFIT, QUANTITY = 0.02, 0.05, 1

            # Indicators take a Series and return a Series on the same index.
            df['rsi'] = rsi(df['close'], RSI_PERIOD)

            # params= is REQUIRED: it is what lets the dashboard re-run the
            # strategy. Use type 'rsi_crossover' or 'ema_crossover' ONLY.
            k = Kairos(df, name='nvda_rsi_meanrev', params={
                'type': 'rsi_crossover',
                'rsi_period': RSI_PERIOD,
                'long_entry_rsi_below': OVERSOLD,
                'long_exit_rsi_above': OVERBOUGHT,
                'stop_loss': STOP_LOSS,
                'take_profit': TAKE_PROFIT,
                'quantity': QUANTITY,
            })

            # Conditions must be boolean Series on df's index.
            k.enter_long(df['rsi'] < OVERSOLD)
            k.exit_trade(condition=df['rsi'] > OVERBOUGHT,
                         stop_loss=STOP_LOSS, take_profit=TAKE_PROFIT)

            k.run()     # MANDATORY — export() raises without it
            k.export()  # saves the strategy to the dashboard
            ```

            RULES
            1. The script MUST end with k.run() then k.export().
            2. params MUST include a 'type' of 'rsi_crossover' or 'ema_crossover'.
               - rsi_crossover keys: rsi_period, long_entry_rsi_below,
                 short_entry_rsi_above, long_exit_rsi_above, short_exit_rsi_below,
                 stop_loss, take_profit, quantity
               - ema_crossover keys: fast_period, slow_period, stop_loss,
                 take_profit, quantity
               Include only the keys the user's strategy actually uses.
            3. Give the strategy a unique, descriptive snake_case name that encodes
               symbol and idea, e.g. 'nvda_rsi_meanrev_14_30_70'. An existing name
               is overwritten, so make it specific.
            4. Use the date range the user asked for. Call get_price_data first to
               confirm the data exists.
            5. No plotting, no input(), no network calls other than the SDK's.

            Explain your plan in one or two short sentences, then the code block.
            """;

    private static final String EXPLANATION_SYSTEM_PROMPT = """
            You are analysing backtest results for a trading strategy.

            Provide, in markdown:
            1. A concise summary of how the strategy performed.
            2. What worked and what did not.
            3. 2-3 concrete, actionable improvements (parameter changes, extra
               filters, different timeframe) — specific numbers, not platitudes.
            4. A short risk assessment.

            Use '## ' headings and '- ' bullets only. Under 300 words. Be specific
            about the actual numbers you were given. If there were zero trades, say
            plainly why that likely happened and how to fix it.
            """;

    private static final String CHAT_SYSTEM_PROMPT = """
            You are the Ananke AI Copilot, a quantitative research assistant for a
            trading terminal backed by TimescaleDB and a Spring backend.

            Answer questions about market data, symbols and strategy design. Use the
            tools to look up real data rather than guessing. Be concise. If the user
            asks you to BUILD or BACKTEST a strategy, tell them to switch to Research
            mode, which executes code and runs a real backtest.
            """;

    // ── Public entry points ───────────────────────────────────────────────────

    public void runResearch(String prompt, List<CopilotDto.Message> history, SseEmitter emitter) {
        pool.submit(() -> {
            try {
                research(prompt, history, emitter);
            } catch (Exception e) {
                log.error("Copilot research failed", e);
                emit(emitter, CopilotDto.ResearchEvent.error(rootMessage(e)));
            } finally {
                complete(emitter);
            }
        });
    }

    public void streamChat(List<CopilotDto.Message> history, SseEmitter emitter) {
        pool.submit(() -> {
            try {
                List<Map<String, Object>> messages = new ArrayList<>();
                messages.add(msg("system", CHAT_SYSTEM_PROMPT));
                appendHistory(messages, history);

                String answer = runToolLoop(messages, emitter);
                emit(emitter, CopilotDto.ResearchEvent.token(answer));
                emit(emitter, CopilotDto.ResearchEvent.done(null));
            } catch (Exception e) {
                log.error("Copilot chat failed", e);
                emit(emitter, CopilotDto.ResearchEvent.error(rootMessage(e)));
            } finally {
                complete(emitter);
            }
        });
    }

    // ── The pipeline ──────────────────────────────────────────────────────────

    private void research(String prompt, List<CopilotDto.Message> history, SseEmitter emitter) {
        emit(emitter, CopilotDto.ResearchEvent.status("Analysing request…"));

        List<Map<String, Object>> messages = new ArrayList<>();
        messages.add(msg("system", RESEARCH_SYSTEM_PROMPT));
        appendHistory(messages, history);
        messages.add(msg("user", prompt));

        // 1 — tool loop until the model produces its final answer with the code.
        String answer = runToolLoop(messages, emitter);

        String code = extractCode(answer);
        if (code == null || code.isBlank()) {
            emit(emitter, CopilotDto.ResearchEvent.error(
                    "The model did not return a Python code block. Try rephrasing the request."));
            return;
        }
        emit(emitter, CopilotDto.ResearchEvent.code(code));

        // 2 — execute in the container that owns the SDK.
        emit(emitter, CopilotDto.ResearchEvent.status("Executing strategy in Jupyter…"));
        JupyterExecutionService.ExecutionResult exec = jupyter.execute(code);
        if (!exec.success()) {
            String detail = exec.stderr() == null || exec.stderr().isBlank()
                    ? exec.error()
                    : tail(exec.stderr(), 1500);
            emit(emitter, CopilotDto.ResearchEvent.error("Strategy code failed:\n" + detail));
            return;
        }

        // 3 — k.export() ran inside that script; recover the name it saved under.
        String strategyName = parseStrategyName(exec.stdout(), code);
        if (strategyName == null || !strategyService.strategyExists(strategyName)) {
            emit(emitter, CopilotDto.ResearchEvent.error(
                    "The script ran but no strategy was exported. Ensure it ends with "
                    + "k.run() then k.export().\n\nOutput:\n" + tail(exec.stdout(), 1000)));
            return;
        }

        // 4 — the run k.export() persisted; also our fallback and range source.
        Optional<ApiDto.BacktestResultResponse> exported = strategyService.latestResult(strategyName);

        emit(emitter, CopilotDto.ResearchEvent.status("Running backtest…"));
        BacktestOutcome outcome = backtest(strategyName, exported);
        if (outcome == null) {
            emit(emitter, CopilotDto.ResearchEvent.error(
                    "Strategy '" + strategyName + "' was saved but no backtest could be produced."));
            return;
        }
        emit(emitter, CopilotDto.ResearchEvent.backtest(outcome.result()));

        // 5 — explain, then store the analysis on that run.
        emit(emitter, CopilotDto.ResearchEvent.status("Analysing results…"));
        String explanation;
        try {
            explanation = kimi.complete(
                    EXPLANATION_SYSTEM_PROMPT,
                    explanationPrompt(strategyName, outcome.result()),
                    2048);
        } catch (Exception e) {
            log.warn("Explanation step failed", e);
            explanation = null;
        }

        if (explanation != null && !explanation.isBlank() && outcome.resultId() != null) {
            strategyService.attachExplanation(outcome.resultId(), explanation);
        }
        if (explanation != null && !explanation.isBlank()) {
            emit(emitter, CopilotDto.ResearchEvent.explanation(explanation));
        }

        emit(emitter, CopilotDto.ResearchEvent.done(new CopilotDto.ResearchSummary(
                strategyName,
                outcome.result().getSymbol(),
                outcome.resultId(),
                outcome.usedExported())));
    }

    /**
     * Re-run through the Java engine, falling back to the SDK's exported run.
     *
     * The engine only understands rsi_crossover / ema_crossover; anything else
     * throws. Rather than failing a run whose code already executed and saved
     * successfully, fall back to what {@code k.export()} persisted.
     */
    private BacktestOutcome backtest(String strategyName,
                                     Optional<ApiDto.BacktestResultResponse> exported) {
        String symbol = exported.map(ApiDto.BacktestResultResponse::getSymbol).orElse(null);
        Instant from  = exported.map(ApiDto.BacktestResultResponse::getFromTs).orElse(null);
        Instant to    = exported.map(ApiDto.BacktestResultResponse::getToTs).orElse(null);

        if (symbol != null && from != null && to != null) {
            try {
                ApiDto.RunBacktestRequest req = new ApiDto.RunBacktestRequest();
                req.setSymbol(symbol);
                req.setFromTs(from.toString());
                req.setToTs(to.toString());

                ApiDto.BacktestResultResponse engineRun =
                        strategyService.runBacktest(strategyName, req);
                Long id = strategyService.persistRun(strategyName, engineRun, "1Min");
                engineRun.setId(id);
                return new BacktestOutcome(engineRun, id, false);

            } catch (UnsupportedOperationException e) {
                log.info("Engine cannot re-run '{}' ({}), using the exported run instead",
                        strategyName, e.getMessage());
            } catch (Exception e) {
                log.warn("Engine re-run of '{}' failed, using the exported run instead",
                        strategyName, e);
            }
        } else {
            log.info("Exported run for '{}' lacks symbol/range; skipping engine re-run", strategyName);
        }

        return exported
                .map(r -> new BacktestOutcome(r, r.getId(), true))
                .orElse(null);
    }

    private record BacktestOutcome(ApiDto.BacktestResultResponse result,
                                   Long resultId,
                                   boolean usedExported) { }

    private String explanationPrompt(String name, ApiDto.BacktestResultResponse r) {
        return """
               Strategy: %s
               Symbol: %s
               Period: %s → %s

               Metrics:
               - Total trades: %s
               - Winning / losing: %s / %s
               - Win rate: %s%%
               - Total PnL: %s (%s%%)
               - Average win / loss: %s / %s
               - Largest win / loss: %s / %s
               - Profit factor: %s
               - Max drawdown: %s%%
               - Sharpe ratio: %s
               """.formatted(
                name, nz(r.getSymbol()), nz(r.getFromTs()), nz(r.getToTs()),
                nz(r.getTotalTrades()), nz(r.getWinningTrades()), nz(r.getLosingTrades()),
                nz(r.getWinRate()), nz(r.getTotalPnl()), nz(r.getTotalPnlPct()),
                nz(r.getAvgWin()), nz(r.getAvgLoss()),
                nz(r.getLargestWin()), nz(r.getLargestLoss()),
                nz(r.getProfitFactor()), nz(r.getMaxDrawdown()), nz(r.getSharpeRatio()));
    }

    // ── LLM tool loop ─────────────────────────────────────────────────────────

    /** Drives tool calls until the model answers, returning that final text. */
    private String runToolLoop(List<Map<String, Object>> messages, SseEmitter emitter) {
        for (int i = 0; i < MAX_TOOL_ITERATIONS; i++) {
            JsonNode root   = kimi.chat(messages, toolDefinitions(), MAX_TOKENS);
            JsonNode choice = root.path("choices").path(0);
            JsonNode message = choice.path("message");

            if (!"tool_calls".equals(choice.path("finish_reason").asText())) {
                return message.path("content").asText("");
            }

            // Echo the assistant turn back verbatim so tool_call_ids line up.
            messages.add(mapper.convertValue(message, Map.class));

            for (JsonNode call : message.path("tool_calls")) {
                String toolName = call.path("function").path("name").asText();
                String callId   = call.path("id").asText();
                Object result;
                try {
                    JsonNode args = mapper.readTree(
                            call.path("function").path("arguments").asText("{}"));
                    emit(emitter, CopilotDto.ResearchEvent.status(describeTool(toolName, args)));
                    result = dispatchTool(toolName, args);
                } catch (Exception e) {
                    result = Map.of("error", rootMessage(e));
                }

                Map<String, Object> toolMsg = new LinkedHashMap<>();
                toolMsg.put("role", "tool");
                toolMsg.put("tool_call_id", callId);
                toolMsg.put("content", writeJson(result));
                messages.add(toolMsg);
            }
        }
        return "";
    }

    private Object dispatchTool(String name, JsonNode args) {
        return switch (name) {
            case "list_symbols"   -> symbolService.listAll();
            case "search_symbols" -> assetSearch.search(args.path("query").asText(""));
            case "add_symbol"     -> symbolService.addSymbol(args.path("symbol").asText("").toUpperCase());
            case "get_price_data" -> priceSummary(
                    args.path("symbol").asText("").toUpperCase(),
                    args.path("from").asText(""),
                    args.path("to").asText(""));
            default -> Map.of("error", "Unknown tool: " + name);
        };
    }

    /**
     * Full ranges run to hundreds of thousands of 1-minute bars, so the model
     * gets a shape-and-range summary plus a short sample — never the raw series.
     */
    private Object priceSummary(String symbol, String from, String to) {
        Instant fromTs;
        Instant toTs;
        try {
            fromTs = parseInstant(from);
            toTs   = parseInstant(to);
        } catch (Exception e) {
            return Map.of("error", "Could not parse dates: " + from + " → " + to);
        }

        List<ApiDto.PriceResponse> bars = priceService.getRange(symbol, fromTs, toTs);
        if (bars.isEmpty()) {
            return Map.of(
                    "symbol", symbol,
                    "bar_count", 0,
                    "error", "No price data stored for " + symbol + " in that range. "
                           + "The symbol may not be tracked yet — call add_symbol, or pick another range.");
        }

        double min = Double.MAX_VALUE;
        double max = -Double.MAX_VALUE;
        for (ApiDto.PriceResponse b : bars) {
            double c = b.getClose().doubleValue();
            min = Math.min(min, c);
            max = Math.max(max, c);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("symbol", symbol);
        out.put("bar_count", bars.size());
        out.put("interval", "1Min");
        out.put("first_bar", bars.get(0).getTime());
        out.put("last_bar", bars.get(bars.size() - 1).getTime());
        out.put("close_min", round2(min));
        out.put("close_max", round2(max));
        out.put("close_first", bars.get(0).getClose());
        out.put("close_last", bars.get(bars.size() - 1).getClose());
        out.put("sample", bars.subList(0, Math.min(SAMPLE_BARS, bars.size())));
        return out;
    }

    private List<Map<String, Object>> toolDefinitions() {
        return List.of(
                tool("list_symbols",
                     "List every symbol currently tracked with stored price data.",
                     Map.of("type", "object", "properties", Map.of())),
                tool("search_symbols",
                     "Search tradable assets by ticker or company name.",
                     Map.of("type", "object",
                            "properties", Map.of("query",
                                    Map.of("type", "string", "description", "Ticker or company name")),
                            "required", List.of("query"))),
                tool("add_symbol",
                     "Start tracking a symbol so its price history can be backfilled.",
                     Map.of("type", "object",
                            "properties", Map.of("symbol",
                                    Map.of("type", "string", "description", "Ticker, e.g. NVDA")),
                            "required", List.of("symbol"))),
                tool("get_price_data",
                     "Summarise stored OHLCV data for a symbol over a date range. "
                     + "Call this before writing a strategy to confirm the data exists.",
                     Map.of("type", "object",
                            "properties", new LinkedHashMap<>(Map.of(
                                    "symbol", Map.of("type", "string", "description", "Ticker, e.g. NVDA"),
                                    "from",   Map.of("type", "string", "description", "Start date, YYYY-MM-DD"),
                                    "to",     Map.of("type", "string", "description", "End date, YYYY-MM-DD"))),
                            "required", List.of("symbol", "from", "to"))));
    }

    private static Map<String, Object> tool(String name, String description, Map<String, Object> params) {
        Map<String, Object> fn = new LinkedHashMap<>();
        fn.put("name", name);
        fn.put("description", description);
        fn.put("parameters", params);
        Map<String, Object> wrapper = new LinkedHashMap<>();
        wrapper.put("type", "function");
        wrapper.put("function", fn);
        return wrapper;
    }

    private static String describeTool(String name, JsonNode args) {
        return switch (name) {
            case "list_symbols"   -> "Listing tracked symbols…";
            case "search_symbols" -> "Searching for \"" + args.path("query").asText("") + "\"…";
            case "add_symbol"     -> "Adding " + args.path("symbol").asText("") + "…";
            case "get_price_data" -> "Fetching " + args.path("symbol").asText("") + " price data…";
            default -> "Working…";
        };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private void appendHistory(List<Map<String, Object>> messages, List<CopilotDto.Message> history) {
        if (history == null) return;
        for (CopilotDto.Message m : history) {
            if (m.getRole() == null || m.getContent() == null) continue;
            if ("system".equals(m.getRole())) continue;   // ours is authoritative
            messages.add(msg(m.getRole(), m.getContent()));
        }
    }

    private static Map<String, Object> msg(String role, String content) {
        Map<String, Object> m = new HashMap<>();
        m.put("role", role);
        m.put("content", content);
        return m;
    }

    /** First fenced block; the prompt asks for exactly one. */
    static String extractCode(String content) {
        if (content == null) return null;
        Matcher m = CODE_FENCE.matcher(content);
        return m.find() ? m.group(1).trim() : null;
    }

    /**
     * Prefer the SDK's own success line — it is the name the backend actually
     * saved. Fall back to the literal in the source only if that is missing.
     */
    static String parseStrategyName(String stdout, String code) {
        if (stdout != null) {
            Matcher m = EXPORT_CONFIRMATION.matcher(stdout);
            if (m.find()) return m.group(1);
        }
        if (code != null) {
            Matcher m = NAME_IN_CODE.matcher(code);
            if (m.find()) return m.group(1);
        }
        return null;
    }

    private void emit(SseEmitter emitter, CopilotDto.ResearchEvent event) {
        try {
            emitter.send(SseEmitter.event().data(writeJson(event), org.springframework.http.MediaType.APPLICATION_JSON));
        } catch (Exception e) {
            // Client hung up mid-run — normal when the user navigates away.
            log.debug("SSE send failed: {}", e.getMessage());
        }
    }

    private void complete(SseEmitter emitter) {
        try {
            emitter.complete();
        } catch (Exception ignored) {
            // Already completed or the connection is gone.
        }
    }

    private String writeJson(Object o) {
        try {
            return mapper.writeValueAsString(o);
        } catch (Exception e) {
            return "{\"error\":\"serialisation failed\"}";
        }
    }

    private static Instant parseInstant(String raw) {
        String s = raw.trim();
        if (s.length() == 10) s = s + "T00:00:00Z";     // bare YYYY-MM-DD
        else if (!s.endsWith("Z") && !s.contains("+")) s = s + "Z";
        return Instant.parse(s);
    }

    private static String tail(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : "…" + s.substring(s.length() - max);
    }

    private static String nz(Object o) {
        return o == null ? "n/a" : o.toString();
    }

    private static double round2(double d) {
        return Math.round(d * 100.0) / 100.0;
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) t = t.getCause();
        String m = t.getMessage();
        return m == null || m.isBlank() ? t.getClass().getSimpleName() : m;
    }
}
