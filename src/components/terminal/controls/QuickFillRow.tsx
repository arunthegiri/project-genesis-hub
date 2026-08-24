import { cn } from "@/lib/utils";

export interface QuickFillPreset {
  label: string;
  value: number;
}

export interface QuickFillRowProps {
  presets: readonly QuickFillPreset[];
  /** Writes into the sibling input — the owner decides parse/clamp. */
  onFill: (value: number) => void;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * QuickFillRow (build doc §9 W7) — preset chips that write into a sibling
 * input (order sizes, capital amounts). 24px chips (`--control-h-sm`),
 * surface-2, 8px gaps. Plain buttons: Tab between chips, Enter fills.
 */
export function QuickFillRow({
  presets,
  onFill,
  ariaLabel,
  disabled,
  className,
}: QuickFillRowProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("flex items-center gap-2", disabled && "opacity-40", className)}
    >
      {presets.map((p) => (
        <button
          key={p.label}
          type="button"
          disabled={disabled}
          onClick={() => onFill(p.value)}
          className={cn(
            "flex h-6 items-center rounded border border-border-subtle bg-surface-2 px-2 font-mono text-[11px] tabular-nums transition-colors",
            "text-text-secondary hover:bg-surface-3 hover:text-text-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
