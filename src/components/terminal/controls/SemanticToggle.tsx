import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

export type SemanticTone = "up" | "down" | "warn" | "info" | "neutral";

export interface SemanticToggleOption {
  value: string;
  label: string;
  tone: SemanticTone;
}

export interface SemanticToggleProps {
  /** Exactly two segments — the asymmetry is the feature (paper/LIVE, long/short). */
  options: readonly [SemanticToggleOption, SemanticToggleOption];
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

// Static per-tone class sets — Tailwind only generates utilities it can see
// spelled out in source, so no template-string composition here.
const TONE_ON: Record<SemanticTone, string> = {
  up: "data-[state=on]:border-dir-up data-[state=on]:bg-dir-up/20 data-[state=on]:text-dir-up",
  down: "data-[state=on]:border-dir-down data-[state=on]:bg-dir-down/20 data-[state=on]:text-dir-down",
  warn: "data-[state=on]:border-warning data-[state=on]:bg-warning/20 data-[state=on]:text-warning",
  info: "data-[state=on]:border-accent-blue data-[state=on]:bg-accent-blue/20 data-[state=on]:text-accent-blue",
  neutral:
    "data-[state=on]:border-text-secondary data-[state=on]:bg-surface-3 data-[state=on]:text-text-primary",
};

/**
 * SemanticToggle (build doc §9 W7) — a two-segment control on the Radix
 * ToggleGroup primitive (roving-tabindex arrow keys come free). The ACTIVE
 * segment carries the semantic meaning: tone fill at 20% alpha over
 * surface-2, 1px tone border, tone text. The inactive segment stays neutral
 * surface-1 — the asymmetry is the point (a LIVE segment should look armed).
 * 32px (`--control-h-md`). Radio semantics: the active segment can't be
 * clicked off.
 */
export function SemanticToggle({
  options,
  value,
  onValueChange,
  ariaLabel,
  disabled,
  className,
}: SemanticToggleProps) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(v) => {
        if (v) onValueChange(v); // radio semantics — ignore the deselect-to-"" case
      }}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn("inline-flex h-8 items-center gap-1", disabled && "opacity-40", className)}
    >
      {options.map((opt) => (
        <ToggleGroupPrimitive.Item
          key={opt.value}
          value={opt.value}
          disabled={disabled}
          className={cn(
            "flex h-full items-center rounded border px-3 text-xs font-medium uppercase tracking-wider transition-colors",
            "border-border-subtle bg-surface-1 text-text-secondary",
            "hover:bg-surface-3 hover:text-text-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none",
            TONE_ON[opt.tone],
          )}
        >
          {opt.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
