/**
 * Copilot build doc M5 unit test — SSE framing.
 *
 * The copilot's whole UI is driven by these frames, and the failure mode is
 * silent: a mis-split buffer drops an event rather than throwing. Chunk
 * boundaries land wherever the network puts them, so the cases that matter are
 * the ones where a frame is split across reads.
 *
 * Run: npm run test:sse
 */

import assert from "node:assert/strict";
import { SseFrameParser, parseSseFrame } from "../src/lib/api/sse.ts";

// ── parseSseFrame ───────────────────────────────────────────────────────────
assert.deepEqual(parseSseFrame('data:{"type":"status"}'), { type: "status" }, "plain frame");
assert.deepEqual(
  parseSseFrame('data: {"type":"status"}'),
  { type: "status" },
  "a space after data: is optional per spec",
);
assert.equal(parseSseFrame(": keep-alive"), null, "comment frames are not events");
assert.equal(parseSseFrame(""), null, "empty frame");
assert.equal(parseSseFrame("data:not json"), null, "non-JSON payload is ignored, not thrown");
assert.equal(parseSseFrame("event: ping"), null, "a frame with no data: line yields nothing");

// Multi-line data is joined with newlines before parsing (spec behaviour).
assert.deepEqual(
  parseSseFrame('data:{"a":\ndata:1}'),
  { a: 1 },
  "multi-line data: lines join into one payload",
);

// ── SseFrameParser: chunk boundaries ────────────────────────────────────────
{
  const p = new SseFrameParser();
  const out = p.push('data:{"n":1}\n\ndata:{"n":2}\n\n');
  assert.deepEqual(out, [{ n: 1 }, { n: 2 }], "two whole frames in one chunk");
  assert.deepEqual(p.flush(), [], "nothing buffered after complete frames");
}

{
  // The important case: one frame arriving in pieces.
  const p = new SseFrameParser();
  assert.deepEqual(p.push('data:{"ty'), [], "partial frame is withheld");
  assert.deepEqual(p.push('pe":"code"}'), [], "still incomplete without the blank line");
  assert.deepEqual(p.push("\n\n"), [{ type: "code" }], "terminator completes it");
}

{
  // A chunk that ends mid-terminator must not split the frame in two.
  const p = new SseFrameParser();
  assert.deepEqual(p.push('data:{"n":1}\n'), [], "single newline is not a frame boundary");
  assert.deepEqual(p.push('\ndata:{"n":2}\n\n'), [{ n: 1 }, { n: 2 }], "boundary spans chunks");
}

{
  // A final frame with no trailing blank line is still delivered on flush —
  // the backend completes the emitter right after the last event.
  const p = new SseFrameParser();
  assert.deepEqual(p.push('data:{"type":"done"}'), [], "no terminator yet");
  assert.deepEqual(p.flush(), [{ type: "done" }], "flush drains the trailing frame");
  assert.deepEqual(p.flush(), [], "flush is idempotent");
}

{
  // Keep-alives interleaved with real events must not shift the stream.
  const p = new SseFrameParser();
  const out = p.push(': ping\n\ndata:{"n":1}\n\n: ping\n\n');
  assert.deepEqual(out, [{ n: 1 }], "comments are dropped, events survive");
}

{
  // Payload containing a blank line, escaped inside the JSON string, must not
  // be mistaken for a frame boundary.
  const p = new SseFrameParser();
  const payload = JSON.stringify({ type: "code", payload: "a\n\nb" });
  assert.deepEqual(
    p.push(`data:${payload}\n\n`),
    [{ type: "code", payload: "a\n\nb" }],
    "escaped newlines inside JSON are not frame boundaries",
  );
}

console.log("sse: OK");
