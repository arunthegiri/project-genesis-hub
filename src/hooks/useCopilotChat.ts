import { useCallback, useRef, useState } from "react";
import {
  copilotApi,
  CopilotUnavailableError,
  type CopilotMessage,
  type ResearchEvent,
  type ResearchSummary,
} from "@/lib/api/copilot";
import type { BacktestResults } from "@/lib/api/strategies";

/**
 * Copilot chat state (build doc M5).
 *
 * One assistant turn accumulates the whole pipeline — status, code, metrics,
 * explanation — because they all describe a single run and the UI renders them
 * as one stacked card rather than separate messages.
 */

export type CopilotMode = "research" | "chat";

export interface CopilotTurn {
  id: string;
  role: "user" | "assistant";
  /** Prose answer (chat mode, or the model's preamble in research mode). */
  content: string;
  /** Latest status pill; cleared when the run finishes. */
  status?: string;
  code?: string;
  backtest?: BacktestResults;
  explanation?: string;
  summary?: ResearchSummary;
  error?: string;
  streaming: boolean;
}

let seq = 0;
const nextId = () => `turn-${++seq}-${Date.now()}`;

export function useCopilotChat() {
  const [turns, setTurns] = useState<CopilotTurn[]>([]);
  const [mode, setMode] = useState<CopilotMode>("research");
  const [isStreaming, setIsStreaming] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const patchLast = useCallback((patch: Partial<CopilotTurn>) => {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1], ...patch };
      return next;
    });
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    patchLast({ streaming: false, status: undefined });
  }, [patchLast]);

  const send = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || isStreaming) return;

      // History excludes the turn being created, and carries prose only —
      // the backend rebuilds its own system prompt and tool context.
      const history: CopilotMessage[] = turns
        .filter((t) => t.content.trim().length > 0)
        .map((t) => ({ role: t.role, content: t.content }));

      setTurns((prev) => [
        ...prev,
        { id: nextId(), role: "user", content: trimmed, streaming: false },
        { id: nextId(), role: "assistant", content: "", streaming: true, status: "Connecting…" },
      ]);
      setIsStreaming(true);
      setUnavailable(null);

      const controller = new AbortController();
      abortRef.current = controller;

      const onEvent = (event: ResearchEvent) => {
        switch (event.type) {
          case "status":
            patchLast({ status: event.message ?? undefined });
            break;
          case "code":
            patchLast({ code: String(event.payload ?? "") });
            break;
          case "backtest":
            patchLast({ backtest: event.payload as BacktestResults });
            break;
          case "explanation":
            patchLast({ explanation: String(event.payload ?? "") });
            break;
          case "token":
            // Chat mode delivers its answer as one frame.
            patchLast({ content: String(event.payload ?? "") });
            break;
          case "error":
            patchLast({ error: event.message ?? "Something went wrong.", status: undefined });
            break;
          case "done":
            patchLast({
              summary: (event.payload as ResearchSummary | null) ?? undefined,
              status: undefined,
              streaming: false,
            });
            break;
        }
      };

      try {
        if (mode === "research") {
          await copilotApi.research(trimmed, history, onEvent, controller.signal);
        } else {
          await copilotApi.chat(
            [...history, { role: "user", content: trimmed }],
            onEvent,
            controller.signal,
          );
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof CopilotUnavailableError) {
          setUnavailable(e.message);
          patchLast({ error: e.message });
        } else {
          patchLast({ error: e instanceof Error ? e.message : "Copilot request failed." });
        }
      } finally {
        if (!controller.signal.aborted) {
          patchLast({ streaming: false, status: undefined });
          setIsStreaming(false);
        }
        abortRef.current = null;
      }
    },
    [isStreaming, mode, patchLast, turns],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setTurns([]);
    setIsStreaming(false);
    setUnavailable(null);
  }, []);

  return { turns, mode, setMode, send, cancel, reset, isStreaming, unavailable };
}
