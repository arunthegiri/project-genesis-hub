import { schema } from "./chat_POST.schema";
import { flootAi, FlootAiOutOfCreditsError } from "../../helpers/flootAi";
import { stockDataService } from "../../helpers/stockDataService";
import { backtestEngine } from "../../helpers/backtestEngine";
import { alpacaClient } from "../../helpers/alpacaClient";
import { summarizePriceData } from "../../helpers/anankeApiClient";

export async function handle(request: Request) {
  try {
    const body = await request.text();
    const json = JSON.parse(body);
    const { messages: inputMessages } = schema.parse(json);

    const messages = [
      {
        role: "system",
        content: `You are the Ananke AI Copilot, an AI-powered quantitative research assistant. You help users explore market data, analyze price patterns, calculate technical indicators, plan trading strategies, and execute backtests. You have access to tools that connect directly to the Ananke data layer — a Postgres + TimescaleDB system storing OHLCV market data from Alpaca Markets. When users ask about stock data, use the tools to fetch real data. Use search_symbols to find and add new symbols. For backtest requests, use the run_backtest tool to execute rsi_crossover or ema_crossover strategies against real price data and present the results. For technical indicators, explain the calculations and show the data. Always present data clearly with metrics and observations. Format responses in markdown.`,
      },
      ...inputMessages,
    ] as any[];

    const tools = [
      {
        type: "function" as const,
        function: {
          name: "list_symbols",
          description: "List all tracked stock symbols in the database. No parameters.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "get_price_data",
          description: "Get OHLCV price data for a symbol within a date range. Auto-fetches from Alpaca if data is missing.",
          parameters: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              from: { type: "string", description: "ISO date" },
              to: { type: "string", description: "ISO date" },
            },
            required: ["symbol", "from", "to"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "add_symbol",
          description: "Add a new stock symbol to track.",
          parameters: {
            type: "object",
            properties: { symbol: { type: "string" } },
            required: ["symbol"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "search_symbols",
          description: "Search for tradable US equity symbols by name or ticker. Returns up to 10 matching results.",
          parameters: {
            type: "object",
            properties: { query: { type: "string", description: "Search query (symbol or company name)" } },
            required: ["query"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "run_backtest",
          description: "Run a backtest for a symbol within a date range using a specified strategy. Returns comprehensive trade results, metrics (Sharpe ratio, max drawdown, win rate, PnL), and equity curve.",
          parameters: {
            type: "object",
            properties: {
              symbol: { type: "string", description: "Stock symbol" },
              from: { type: "string", description: "ISO date for backtest start" },
              to: { type: "string", description: "ISO date for backtest end" },
              strategy_type: { type: "string", enum: ["rsi_crossover", "ema_crossover"], description: "Strategy type" },
              strategy_params: {
                type: "object",
                description: "Strategy parameters. For rsi_crossover: rsi_period, long_entry_rsi_below, short_entry_rsi_above, long_exit_rsi_above, short_exit_rsi_below, stop_loss, take_profit, quantity. For ema_crossover: fast_period, slow_period, stop_loss, take_profit, quantity.",
                properties: {
                  rsi_period: { type: "number" },
                  long_entry_rsi_below: { type: "number" },
                  short_entry_rsi_above: { type: "number" },
                  long_exit_rsi_above: { type: "number" },
                  short_exit_rsi_below: { type: "number" },
                  fast_period: { type: "number" },
                  slow_period: { type: "number" },
                  stop_loss: { type: "number" },
                  take_profit: { type: "number" },
                  quantity: { type: "number" },
                },
              },
            },
            required: ["symbol", "from", "to", "strategy_type", "strategy_params"],
          },
        },
      },
    ];

    let toolLoopActive = true;
    while (toolLoopActive) {
      // Non-streaming call for resolving tool usage
      const r = (await flootAi.chat({
        // Model id comes from KIMI_MODEL (see helpers/flootAi.ts)
        messages,
        tools: tools as any,
        max_tokens: 32768,
      })) as any;

      const msg = r.choices[0].message;
      if (r.choices[0].finish_reason === "tool_calls") {
        // Echo the assistant message verbatim, reasoning included
        messages.push(msg);

        for (const call of msg.tool_calls ?? []) {
          const args = JSON.parse(call.function.arguments);
          let result;
          try {
            if (call.function.name === "list_symbols") {
              const symbols = await stockDataService.listSymbols();
              result = symbols;
            } else if (call.function.name === "get_price_data") {
              const from = new Date(args.from);
              const to = new Date(args.to);
              const bars = await stockDataService.ensureDataAvailable(args.symbol, from, to);
              if (bars.length === 0) {
                result = { error: "No price data available for the requested range." };
              } else {
                const mappedBars = bars.map((b) => ({
                  time: new Date(b.time).toISOString(),
                  symbol: b.symbol,
                  open: parseFloat(b.open ?? "0"),
                  high: parseFloat(b.high ?? "0"),
                  low: parseFloat(b.low ?? "0"),
                  close: parseFloat(b.close),
                  volume: Number(b.volume ?? 0),
                  vwap: parseFloat(b.vwap ?? "0"),
                  tradeCount: b.tradeCount ?? 0,
                }));
                result = summarizePriceData(mappedBars);
              }
            } else if (call.function.name === "add_symbol") {
              const added = await stockDataService.addSymbol(args.symbol);
              result = { symbol: added.symbol, enabled: added.enabled, message: `Symbol ${added.symbol} added successfully.` };
            } else if (call.function.name === "search_symbols") {
              const assets = await alpacaClient.searchAssets(args.query);
              result = assets;
            } else if (call.function.name === "run_backtest") {
              const from = new Date(args.from);
              const to = new Date(args.to);
              const bars = await stockDataService.ensureDataAvailable(args.symbol, from, to);
              if (bars.length === 0) {
                result = { error: "No price data available for the requested range. Cannot run backtest." };
              } else {
                const mappedBars = bars.map((b) => ({
                  time: new Date(b.time),
                  open: parseFloat(b.open ?? "0"),
                  high: parseFloat(b.high ?? "0"),
                  low: parseFloat(b.low ?? "0"),
                  close: parseFloat(b.close),
                  volume: Number(b.volume ?? 0),
                }));
                const strategyDefinition = {
                  type: args.strategy_type,
                  ...args.strategy_params,
                };
                const backtestResult = backtestEngine.run(strategyDefinition, mappedBars, args.symbol);
                result = backtestResult;
              }
            } else {
              result = { error: `Unknown tool: ${call.function.name}` };
            }
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Unknown error";
            result = { error: message };
          }

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
      } else {
        // Tool loop is complete (finish_reason is not tool_calls). 
        // We drop out to make the final stream: true call.
        toolLoopActive = false;
      }
    }

    // After tools are resolved, we make the FINAL streaming call to seamlessly stream the final formulated response to the frontend.
    const stream = flootAi.chat({
      model: "glm-5",
      stream: true,
      messages,
      tools: tools as any,
      max_tokens: 32768,
    }) as AsyncIterable<any>;

    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();

    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        async start(controller) {
          const write = (chunk: any) => {
            if ("flootCredits" in chunk) return;
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              controller.enqueue(encoder.encode(delta.content));
            }
          };
          try {
            if (!first.done) write(first.value);
            while (true) {
              const n = await iterator.next();
              if (n.done) break;
              write(n.value);
            }
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
      }),
      { headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  } catch (err) {
    console.log("COPILOT ERROR:", err instanceof Error ? err.constructor.name : typeof err, err instanceof Error ? err.message : String(err));
    if (err instanceof FlootAiOutOfCreditsError) {
      return new Response(
        JSON.stringify({ error: "AI features are temporarily unavailable. Please contact the app owner." }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}