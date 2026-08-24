import { forwardRef, type ButtonHTMLAttributes, type ComponentType } from "react";
import { cn } from "@/lib/utils";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Lucide (or compatible) icon component. */
  icon: ComponentType<{ className?: string }>;
  /** Accessible label — also used as the tooltip. */
  label: string;
}

/**
 * IconButton (build doc §4.1) — 28×28 quiet icon button used across terminal
 * chrome (panel options hamburger, toolbars). Semantic tokens only.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, label, className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-secondary",
        "transition-colors hover:bg-surface-3 hover:text-text-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    >
      <Icon className="h-4 w-4" />
    </button>
  ),
);
IconButton.displayName = "IconButton";
