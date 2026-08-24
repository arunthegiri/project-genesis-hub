import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal markdown renderer for copilot explanations (build doc M5/M6).
 *
 * The explanation prompt constrains the model to headings, bullets, bold and
 * paragraphs, so a ~40-line parser covers it and the app takes on no markdown
 * dependency. Shared by the Copilot page and the Results tab so both render
 * the same stored text identically.
 */

interface Props {
  children: string;
  className?: string;
}

/** Splits `**bold**` and `` `code` `` out of a line into styled spans. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <code
          key={`${keyPrefix}-c${i}`}
          className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[0.9em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + token.length;
    i++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function CopilotMarkdown({ children, className }: Props) {
  const lines = children.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = (key: string) => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={key} className="ml-4 list-disc space-y-1 marker:text-muted-foreground">
        {bullets.map((b, i) => (
          <li key={i} className="text-xs leading-relaxed">
            {renderInline(b, `${key}-${i}`)}
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const key = `md-${idx}`;

    if (/^\s*[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^\s*[-*]\s+/, ""));
      return;
    }
    flushBullets(`${key}-ul`);

    if (line.trim() === "") {
      blocks.push(<div key={key} aria-hidden className="h-1.5" />);
      return;
    }
    if (/^#{3,}\s+/.test(line)) {
      blocks.push(
        <h5 key={key} className="mt-2 text-xs font-semibold text-foreground">
          {renderInline(line.replace(/^#{3,}\s+/, ""), key)}
        </h5>,
      );
      return;
    }
    if (/^##\s+/.test(line)) {
      blocks.push(
        <h4 key={key} className="mt-2 text-sm font-semibold text-foreground">
          {renderInline(line.replace(/^##\s+/, ""), key)}
        </h4>,
      );
      return;
    }
    if (/^#\s+/.test(line)) {
      blocks.push(
        <h4 key={key} className="mt-2 text-sm font-semibold text-foreground">
          {renderInline(line.replace(/^#\s+/, ""), key)}
        </h4>,
      );
      return;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      blocks.push(
        <p key={key} className="ml-4 text-xs leading-relaxed">
          {renderInline(line.trim(), key)}
        </p>,
      );
      return;
    }
    blocks.push(
      <p key={key} className="text-xs leading-relaxed">
        {renderInline(line, key)}
      </p>,
    );
  });

  flushBullets("md-tail-ul");

  return (
    <div className={cn("space-y-1 text-foreground", className)}>
      {blocks.map((b, i) => (
        <Fragment key={i}>{b}</Fragment>
      ))}
    </div>
  );
}
