import type { ComponentType } from "react";

import { cn } from "@/lib/utils";
import {
  ChartArt,
  ClockArt,
  LockArt,
  PlugArt,
  SearchArt,
  TableArt,
  WalletArt,
  WarningArt,
  type PanelArtName,
} from "@/components/terminal/art";

export type { PanelArtName };
export type PanelStateKind = "empty" | "loading" | "error" | "pending" | "paywall";

export interface PanelStateAction {
  label: string;
  /** Renders an <a>; onClick still fires if both are given. */
  href?: string;
  /** Renders a <button> when no href is set. */
  onClick?: () => void;
}

export interface PanelStateProps {
  kind: PanelStateKind;
  /** Illustration flavor (art/index.tsx). Ignored while kind="loading". */
  art: PanelArtName;
  /** One line of muted copy. */
  message: string;
  /** Single accent-blue link/button. */
  action?: PanelStateAction;
  /** Mono chip list — e.g. the exact pending/failing endpoints (§6 PendingPage
   *  pattern at panel level). */
  detail?: string[];
  className?: string;
}

const ART: Record<PanelArtName, ComponentType<{ className?: string }>> = {
  chart: ChartArt,
  table: TableArt,
  plug: PlugArt,
  warning: WarningArt,
  lock: LockArt,
  clock: ClockArt,
  search: SearchArt,
  wallet: WalletArt,
};

/**
 * PanelState (build doc §6.1) — the one intentional placeholder for every
 * panel region: empty / loading / error / pending / paywall. Muted 96×96 art
 * + one line of copy + optional endpoint chip list + a single accent action.
 * Semantic tokens only, so it renders correctly in all four themes.
 *
 * `loading` deliberately renders a small pulse skeleton (the PanelSkeleton
 * idiom: animate-pulse rounded blocks) rather than art — and rather than
 * PanelSkeleton itself, whose geometry is chart-specific (symbol header,
 * controls strip, fixed chart region) and would paint chart-shaped
 * placeholders inside tables and stat sections.
 */
export function PanelState({ kind, art, message, action, detail, className }: PanelStateProps) {
  const Art = ART[art];
  return (
    <div
      role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined}
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center",
        className,
      )}
    >
      {kind === "loading" ? (
        <div aria-hidden className="flex w-56 max-w-full animate-pulse flex-col gap-2">
          <div className="h-2.5 w-2/3 self-center rounded bg-surface-3" />
          <div className="h-2.5 w-full rounded bg-surface-3" />
          <div className="h-2.5 w-1/2 self-center rounded bg-surface-3" />
        </div>
      ) : (
        <Art className="shrink-0 text-text-muted" />
      )}

      <p className="max-w-md text-sm text-text-muted">{message}</p>

      {detail && detail.length > 0 && (
        <ul className="flex max-w-md flex-col items-center gap-1.5">
          {detail.map((d) => (
            <li
              key={d}
              className="max-w-full rounded border border-dashed border-border-subtle bg-surface-0 px-2.5 py-1 font-mono text-[11px] break-all text-text-secondary"
            >
              {d}
            </li>
          ))}
        </ul>
      )}

      {action &&
        (action.href ? (
          <a
            href={action.href}
            onClick={action.onClick}
            className="text-sm text-accent-blue hover:underline"
          >
            {action.label}
          </a>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="text-sm text-accent-blue hover:underline"
          >
            {action.label}
          </button>
        ))}
    </div>
  );
}
