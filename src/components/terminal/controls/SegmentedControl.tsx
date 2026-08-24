import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

export interface SegmentedControlOption {
  value: string;
  label: string;
  title?: string;
}

export interface SegmentedControlProps {
  options: readonly SegmentedControlOption[];
  /** Active value; "" (or a value not in options) renders none active. */
  value: string;
  /** Clicking the active segment re-fires with the same value (Radix would
      otherwise clear to "" — a segmented control here is radio, not toggle). */
  onValueChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * SegmentedControl (build doc §9 W7, built early for the §11 M2 chart
 * toolbar) — multi-option enumerated control on the Radix ToggleGroup
 * primitive (roving-tabindex arrow-key nav comes free). 32px
 * (`--control-h-md`), active = accent-blue at 20% alpha over surface-2 with
 * accent text; inactive = quiet surface-1. Semantic tokens only.
 */
export function SegmentedControl({
  options,
  value,
  onValueChange,
  ariaLabel,
  className,
}: SegmentedControlProps) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(v) => {
        if (v) onValueChange(v); // ignore the deselect-to-"" case (radio semantics)
      }}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-8 items-center gap-0.5 rounded-md border border-border-subtle bg-surface-1 p-0.5",
        className,
      )}
    >
      {options.map((opt) => (
        <ToggleGroupPrimitive.Item
          key={opt.value}
          value={opt.value}
          title={opt.title}
          className={cn(
            "flex h-full items-center rounded px-2.5 font-mono text-[11px] leading-none transition-colors",
            "text-text-secondary hover:text-text-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "data-[state=on]:bg-accent-blue/20 data-[state=on]:text-accent-blue",
          )}
        >
          {opt.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
