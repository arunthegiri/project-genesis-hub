import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * MetaGrid (build doc §7.4) — two-column label/value grid for stat panels:
 * muted label left, right-aligned tabular-nums value (text-primary default, or
 * a semantic color per item), 20px row pitch. Compose multi-column layouts by
 * passing a grid-cols class, e.g. className="grid-cols-2 lg:grid-cols-4".
 */
export interface MetaGridItem {
  label: ReactNode;
  value: ReactNode;
  /** Semantic value color class; defaults to text-text-primary. */
  color?: string;
}

export function MetaGrid({ items, className }: { items: MetaGridItem[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6", className)}>
      {items.map((item, i) => (
        <MetaRow key={i} {...item} />
      ))}
    </dl>
  );
}

export function MetaRow({ label, value, color }: MetaGridItem) {
  return (
    <div className="flex h-5 items-center justify-between gap-3">
      <dt className="shrink-0 text-xs text-text-muted">{label}</dt>
      <dd
        className={cn("num truncate text-right text-xs font-medium", color ?? "text-text-primary")}
      >
        {value}
      </dd>
    </div>
  );
}
