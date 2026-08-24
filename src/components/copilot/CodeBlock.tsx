import { Fragment, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Collapsible Python code block with copy-to-clipboard (build doc M5).
 *
 * Highlighting is deliberately hand-rolled and limited to three categories —
 * comment, keyword, string — because the app takes on no syntax-highlighting
 * dependency and only these three map cleanly onto existing semantic tokens.
 * Directional tokens (bull/bear) are never used here: they mean P&L direction,
 * not syntax.
 */

const KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "False",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "None",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "True",
  "try",
  "while",
  "with",
  "yield",
]);

/** Splits one line into comment / string / keyword / plain spans. */
function highlight(line: string, keyPrefix: string) {
  const hashAt = findCommentStart(line);
  const code = hashAt >= 0 ? line.slice(0, hashAt) : line;
  const comment = hashAt >= 0 ? line.slice(hashAt) : "";

  const nodes = [];
  // Strings first so keywords inside them are not re-coloured.
  const parts = code.split(/('[^']*'|"[^"]*")/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (/^['"]/.test(part)) {
      nodes.push(
        <span key={`${keyPrefix}-s${i}`} className="text-primary">
          {part}
        </span>,
      );
      return;
    }
    part.split(/(\b\w+\b)/g).forEach((word, j) => {
      if (!word) return;
      nodes.push(
        KEYWORDS.has(word) ? (
          <span key={`${keyPrefix}-k${i}-${j}`} className="text-accent-blue">
            {word}
          </span>
        ) : (
          <Fragment key={`${keyPrefix}-t${i}-${j}`}>{word}</Fragment>
        ),
      );
    });
  });

  if (comment) {
    nodes.push(
      <span key={`${keyPrefix}-c`} className="text-muted-foreground">
        {comment}
      </span>,
    );
  }
  return nodes;
}

/** Index of the `#` that starts a comment, ignoring `#` inside string literals. */
function findCommentStart(line: string): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === "#") {
      return i;
    }
  }
  return -1;
}

interface Props {
  code: string;
  title?: string;
  /** Collapsed by default in long transcripts; the active run opens it. */
  defaultOpen?: boolean;
  className?: string;
}

export function CodeBlock({
  code,
  title = "Generated strategy",
  defaultOpen = true,
  className,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const lines = code.replace(/\s+$/, "").split("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context) — leave the icon unchanged.
    }
  };

  return (
    <div className={cn("overflow-hidden rounded-md border border-subtle bg-surface-0", className)}>
      <div className="flex items-center gap-2 border-b border-subtle bg-surface-2 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {title}
          <span className="font-mono text-[10px] normal-case tracking-normal">
            {lines.length} lines
          </span>
        </button>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-bull" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>

      {open && (
        <div className="overflow-x-auto">
          <pre className="min-w-full p-2 font-mono text-[11px] leading-relaxed text-foreground">
            {lines.map((line, i) => (
              <div key={i} className="flex">
                <span
                  aria-hidden
                  className="mr-3 w-7 shrink-0 select-none text-right text-muted-foreground"
                >
                  {i + 1}
                </span>
                <span className="whitespace-pre">{highlight(line, `l${i}`)}</span>
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}
