/**
 * Local stand-in for `@floot/ai`, backed by Kimi (Moonshot).
 *
 * The hosted `@floot/ai` package isn't published to npm, but the only surface
 * `endpoints/copilot/chat_POST.ts` uses is an OpenAI-shaped `chat()` —
 * `choices[0].message` / `finish_reason` / `tool_calls` when buffered, and
 * `choices[0].delta.content` chunks when streaming. Kimi's API is
 * OpenAI-compatible, so this forwards the request unchanged and re-exposes the
 * same two symbols.
 *
 * Configure via .env:
 *   KIMI_API_KEY    required
 *   KIMI_BASE_URL   default https://api.moonshot.ai/v1
 *   KIMI_MODEL      default kimi-k2-0905-preview (set to your K3 model id)
 */

const DEFAULT_BASE_URL = "https://api.moonshot.ai/v1";
const DEFAULT_MODEL = "kimi-k2-0905-preview";

export class FlootAiOutOfCreditsError extends Error {
  constructor(message = "AI provider quota exhausted") {
    super(message);
    this.name = "FlootAiOutOfCreditsError";
  }
}

export class FlootAiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "FlootAiError";
  }
}

export interface ChatOptions {
  /** Ignored — the model is taken from KIMI_MODEL so the endpoint stays portable. */
  model?: string;
  messages: unknown[];
  tools?: unknown[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

function config() {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) {
    throw new FlootAiError(
      "KIMI_API_KEY is not set. Add it to ananke-copilot/.env and restart the dev server.",
      401,
    );
  }
  return {
    apiKey,
    baseUrl: (process.env.KIMI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
    model: process.env.KIMI_MODEL ?? DEFAULT_MODEL,
  };
}

async function post(options: ChatOptions) {
  const { apiKey, baseUrl, model } = config();

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: options.messages,
      ...(options.tools?.length ? { tools: options.tools } : {}),
      ...(options.max_tokens ? { max_tokens: options.max_tokens } : {}),
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
      stream: options.stream ?? false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // 429 covers both rate limiting and exhausted balance; the endpoint's
    // catch block turns the credits error into a friendly 503.
    if (res.status === 429 || /insufficient|balance|quota/i.test(body)) {
      throw new FlootAiOutOfCreditsError(
        `Kimi request rejected (${res.status}): ${body.slice(0, 300)}`,
      );
    }
    throw new FlootAiError(
      `Kimi request failed (${res.status}): ${body.slice(0, 500)}`,
      res.status,
    );
  }

  return res;
}

/** Parses an SSE body into the raw JSON chunks the caller iterates. */
async function* streamChunks(res: Response): AsyncGenerator<unknown> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are newline-delimited; hold back any partial trailing line.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data);
      } catch {
        // Ignore keep-alives and any non-JSON frames.
      }
    }
  }
}

export const flootAi = {
  /**
   * Mirrors `flootAi.chat()`: returns a promise for a completion object when
   * `stream` is falsy, or a synchronously-iterable async stream when it's true.
   */
  chat(options: ChatOptions): Promise<unknown> | AsyncIterable<unknown> {
    if (!options.stream) {
      return post(options).then((res) => res.json());
    }

    return {
      async *[Symbol.asyncIterator]() {
        const res = await post(options);
        yield* streamChunks(res);
      },
    };
  },
};
