import { API_BASE_URL } from "./config";
import { SseFrameParser } from "./sse";

/**
 * Copilot client (build doc M5).
 *
 * The research endpoint streams Server-Sent Events, but the request needs a
 * POST body, and native `EventSource` is GET-only — so this reads the response
 * body as a stream and parses the SSE framing by hand.
 */

/** Discriminator on every frame; tells the UI which surface to render. */
export type ResearchEventType =
  | "status"
  | "code"
  | "backtest"
  | "explanation"
  | "token"
  | "error"
  | "done";

export interface ResearchEvent {
  type: ResearchEventType;
  message: string | null;
  payload: unknown;
}

/** Payload of the terminal `done` frame — enough to deep-link into Results. */
export interface ResearchSummary {
  strategyName: string;
  symbol: string | null;
  backtestResultId: number | null;
  /** The engine could not re-run the definition, so the SDK's own run was used. */
  usedExportedResult: boolean;
}

export interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
}

/** Raised when the backend has no KIMI_API_KEY, so the UI can explain the fix. */
export class CopilotUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopilotUnavailableError";
  }
}

async function openStream(
  path: string,
  body: unknown,
  onEvent: (event: ResearchEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 503) {
    const detail = await res.json().catch(() => null);
    throw new CopilotUnavailableError(
      detail?.message ?? "Copilot is unavailable: the backend has no KIMI_API_KEY configured.",
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Copilot request failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  if (!res.body) throw new Error("Copilot response had no body to stream.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseFrameParser<ResearchEvent>();

  const emit = (event: ResearchEvent) => {
    if (event && typeof event.type === "string") onEvent(event);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true })).forEach(emit);
  }

  // A final frame that arrived without a trailing blank line still counts.
  parser.flush().forEach(emit);
}

export const copilotApi = {
  /** Full pipeline: data → code → execution → backtest → explanation. */
  research: (
    prompt: string,
    messages: CopilotMessage[],
    onEvent: (event: ResearchEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> => openStream("/api/copilot/research", { prompt, messages }, onEvent, signal),

  /** Q&A only — no code execution, no backtest. */
  chat: (
    messages: CopilotMessage[],
    onEvent: (event: ResearchEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> => openStream("/api/copilot/chat", { messages }, onEvent, signal),
};
