import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

export interface UnitInputUnit {
  value: string;
  label: string;
}

export interface UnitInputProps {
  /** Display string (formatted is fine — the owner owns parsing). */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Trailing unit group (shares/%/$…). Omit for a bare numeric input. */
  units?: readonly UnitInputUnit[];
  unit?: string;
  onUnitChange?: (unit: string) => void;
  /** Leading adornment — "$" for currency inputs. */
  prefix?: string;
  placeholder?: string;
  /** Error message — renders the dir-down border + inline message state. */
  error?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  inputClassName?: string;
}

/**
 * UnitInput (build doc §9 W7) — numeric input, right-aligned tabular-nums,
 * with an optional trailing unit toggle group. 32px (`--control-h-md`).
 * States per the W7 contract: default / hover (surface-3 wash on units) /
 * focus-visible (2px --ring) / disabled (40% opacity) / error (dir-down
 * border + inline message below).
 */
export function UnitInput({
  value,
  onChange,
  onBlur,
  units,
  unit,
  onUnitChange,
  prefix,
  placeholder,
  error,
  disabled,
  ariaLabel,
  className,
  inputClassName,
}: UnitInputProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div
        className={cn(
          "flex h-8 items-center rounded-md border bg-surface-1 transition-colors",
          error
            ? "border-dir-down"
            : "border-border-subtle focus-within:ring-2 focus-within:ring-ring",
          disabled && "opacity-40",
        )}
      >
        {prefix && (
          <span className="pointer-events-none pl-2 font-mono text-xs text-text-muted">
            {prefix}
          </span>
        )}
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={!!error}
          className={cn(
            "h-full min-w-0 flex-1 bg-transparent px-2 text-right font-mono text-xs tabular-nums text-text-primary",
            "placeholder:text-text-muted focus:outline-none disabled:pointer-events-none",
            inputClassName,
          )}
        />
        {units && units.length > 0 && (
          <ToggleGroupPrimitive.Root
            type="single"
            value={unit ?? ""}
            onValueChange={(v) => {
              if (v) onUnitChange?.(v);
            }}
            className="flex h-full shrink-0 items-center gap-0.5 border-l border-border-subtle px-1"
          >
            {units.map((u) => (
              <ToggleGroupPrimitive.Item
                key={u.value}
                value={u.value}
                disabled={disabled}
                className={cn(
                  "flex h-6 items-center rounded px-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                  "text-text-secondary hover:bg-surface-3 hover:text-text-primary",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "data-[state=on]:bg-accent-blue/20 data-[state=on]:text-accent-blue",
                  "disabled:pointer-events-none",
                )}
              >
                {u.label}
              </ToggleGroupPrimitive.Item>
            ))}
          </ToggleGroupPrimitive.Root>
        )}
      </div>
      {error && <p className="text-[11px] text-dir-down">{error}</p>}
    </div>
  );
}
