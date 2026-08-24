import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowUp, Loader2, Sparkles, Square, Trash2 } from "lucide-react";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { PanelState } from "@/components/terminal/PanelState";
import { SegmentedControl } from "@/components/terminal/controls/SegmentedControl";
import { CodeBlock } from "@/components/copilot/CodeBlock";
import { BacktestCard } from "@/components/copilot/BacktestCard";
import { CopilotMarkdown } from "@/components/copilot/CopilotMarkdown";
import { useCopilotChat, type CopilotTurn } from "@/hooks/useCopilotChat";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/copilot")({
  head: () => ({ meta: [{ title: "Copilot — Ananke Trading" }] }),
  component: CopilotPage,
});

const MODES = [
  { value: "research", label: "Research", title: "Generate, execute and backtest a strategy" },
  { value: "chat", label: "Chat", title: "Ask questions — no code execution" },
] as const;

const SUGGESTIONS = [
  "Build an RSI mean-reversion strategy for NVDA from 2024-06-01 to 2024-12-31 on 5-minute bars, long below RSI 30, exit above 70, 2% stop and 5% target.",
  "Build an EMA crossover strategy for AAPL in 2024 using a 12/26 EMA on 15-minute bars with a 1.5% stop.",
  "Test an RSI(7) strategy on AMD for the first half of 2024 with 20/80 bands.",
];

function CopilotPage() {
  const { turns, mode, setMode, send, cancel, reset, isStreaming, unavailable } = useCopilotChat();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow the transcript as frames arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const submit = () => {
    const text = draft.trim();
    if (!text || isStreaming) return;
    setDraft("");
    void send(text);
  };

  return (
    <div className="h-full min-h-0 p-3">
      <TerminalPanel
        tabs={[{ id: "copilot", label: "Copilot" }]}
        activeTab="copilot"
        bodyClassName="flex min-h-0 flex-col"
        actions={
          <div className="flex items-center gap-2">
            <SegmentedControl
              options={MODES}
              value={mode}
              onValueChange={(v) => setMode(v as typeof mode)}
              ariaLabel="Copilot mode"
            />
            {turns.length > 0 && (
              <button
                type="button"
                onClick={reset}
                aria-label="Clear conversation"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        }
      >
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {turns.length === 0 ? (
            <EmptyState mode={mode} unavailable={unavailable} onPick={(s) => void send(s)} />
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
              {turns.map((turn) => (
                <TurnView key={turn.id} turn={turn} />
              ))}
            </div>
          )}
        </div>

        <Composer
          draft={draft}
          setDraft={setDraft}
          onSubmit={submit}
          onCancel={cancel}
          isStreaming={isStreaming}
          disabled={Boolean(unavailable)}
          mode={mode}
        />
      </TerminalPanel>
    </div>
  );
}

// ── Transcript ────────────────────────────────────────────────────────────────

function TurnView({ turn }: { turn: CopilotTurn }) {
  const navigate = useNavigate();

  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-md rounded-br-sm bg-surface-3 px-3 py-2 text-xs leading-relaxed text-foreground">
          {turn.content}
        </div>
      </div>
    );
  }

  const empty = !turn.content && !turn.code && !turn.backtest && !turn.explanation && !turn.error;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
        <Sparkles className="h-3.5 w-3.5" />
        Copilot
      </div>

      {turn.content && <CopilotMarkdown>{turn.content}</CopilotMarkdown>}

      {turn.status && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {turn.status}
        </div>
      )}

      {turn.code && <CodeBlock code={turn.code} />}

      {turn.backtest && (
        <BacktestCard
          results={turn.backtest}
          usedExportedResult={turn.summary?.usedExportedResult}
        />
      )}

      {turn.explanation && (
        <div className="rounded-md border border-subtle bg-surface-0">
          <div className="border-b border-subtle bg-surface-2 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
            Analysis
          </div>
          <div className="px-2 py-2">
            <CopilotMarkdown>{turn.explanation}</CopilotMarkdown>
          </div>
        </div>
      )}

      {turn.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-subtle bg-surface-0 px-2 py-2 text-xs text-bear"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">
            {turn.error}
          </pre>
        </div>
      )}

      {turn.summary?.strategyName && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              navigate({
                to: "/backtesting",
                // Spreading prev keeps whatever the user already had loaded
                // there. Cross-route, prev is typed as the partial union of
                // every route's search, so the reducer needs a cast; the
                // target's validateSearch normalises the result at runtime.
                search: ((prev: Record<string, unknown>) => ({
                  ...prev,
                  tab: "results",
                  strategy: turn.summary!.strategyName,
                })) as never,
              })
            }
            className="rounded border border-subtle bg-surface-2 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-3"
          >
            View in Results
          </button>
          <span className="font-mono text-[10px] text-muted-foreground">
            {turn.summary.strategyName}
          </span>
        </div>
      )}

      {empty && !turn.streaming && <p className="text-xs text-muted-foreground">No response.</p>}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({
  mode,
  unavailable,
  onPick,
}: {
  mode: string;
  unavailable: string | null;
  onPick: (s: string) => void;
}) {
  if (unavailable) {
    return (
      <PanelState
        kind="pending"
        art="plug"
        message="Copilot is not configured"
        detail={[unavailable]}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 pt-10">
      <PanelState
        kind="empty"
        art="chart"
        message={
          mode === "research"
            ? "Describe a strategy and the copilot will write, run and backtest it."
            : "Ask about symbols, market data or strategy design."
        }
      />
      {mode === "research" && (
        <div className="flex w-full flex-col gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="rounded-md border border-subtle bg-surface-0 px-3 py-2 text-left text-xs leading-relaxed text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Composer ──────────────────────────────────────────────────────────────────

function Composer({
  draft,
  setDraft,
  onSubmit,
  onCancel,
  isStreaming,
  disabled,
  mode,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isStreaming: boolean;
  disabled: boolean;
  mode: string;
}) {
  return (
    <div className="shrink-0 border-t border-subtle bg-surface-1 p-3">
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter breaks the line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          rows={2}
          disabled={disabled}
          placeholder={
            mode === "research" ? "Describe a strategy to build and backtest…" : "Ask a question…"
          }
          className={cn(
            "min-h-[3.25rem] flex-1 resize-y rounded-md border border-subtle bg-surface-0 px-2.5 py-2",
            "text-xs leading-relaxed text-foreground placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50",
          )}
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Stop"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-subtle bg-surface-2 text-foreground transition-colors hover:bg-surface-3"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!draft.trim() || disabled}
            aria-label="Send"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
