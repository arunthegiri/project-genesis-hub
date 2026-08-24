/**
 * Server-Sent Events framing (build doc M5).
 *
 * Kept free of any `import.meta.env` dependency so it stays importable from the
 * plain-node unit tests, and separate from the copilot client because the
 * framing rules are transport concerns, not copilot ones.
 *
 * Native `EventSource` would handle this, but it is GET-only and the research
 * endpoint needs a POST body — so the response body is read as a stream and
 * framed here.
 */

/**
 * One SSE frame → its parsed `data` payload.
 *
 * A frame may carry several `data:` lines; the spec joins them with newlines
 * before parsing. Comments (`:` keep-alives) and non-JSON frames yield null.
 */
export function parseSseFrame<T = unknown>(frame: string): T | null {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!data) return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/**
 * Accumulates decoded chunks and emits complete frames.
 *
 * Chunk boundaries fall wherever the network puts them — mid-frame, mid-JSON,
 * even mid-multibyte — so a partial trailing frame is held back until the
 * blank line that terminates it arrives.
 */
export class SseFrameParser<T = unknown> {
  private buffer = "";

  /** Feed one decoded chunk; returns whatever frames completed. */
  push(chunk: string): T[] {
    this.buffer += chunk;
    const parts = this.buffer.split("\n\n");
    // The last part is either empty or an incomplete frame — keep it.
    this.buffer = parts.pop() ?? "";
    return parts
      .map((frame) => parseSseFrame<T>(frame))
      .filter((v): v is T => v !== null);
  }

  /** Drain a final frame that arrived without a trailing blank line. */
  flush(): T[] {
    const rest = this.buffer;
    this.buffer = "";
    const parsed = parseSseFrame<T>(rest);
    return parsed === null ? [] : [parsed];
  }
}
