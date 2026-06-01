import { useRef } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  totalBars: number;
  from: number;
  to: number;
  onRangeChange: (from: number, to: number) => void;
  className?: string;
}

export function ChartScrollbar({ totalBars, from, to, onRangeChange, className }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);

  if (totalBars <= 1) return null;

  const visFrom    = Math.max(0, from);
  const visTo      = Math.min(totalBars - 1, to);
  const topPct     = (visFrom / totalBars) * 100;
  const heightPct  = Math.max((visTo - visFrom) / totalBars * 100, 0.5);

  const toDelta = (py: number) =>
    (py / (trackRef.current?.clientHeight ?? 1)) * totalBars;

  const startDrag = (e: React.MouseEvent, mode: "pan" | "top" | "bottom") => {
    e.preventDefault();
    const startY    = e.clientY;
    const startFrom = from;
    const startTo   = to;
    const span      = startTo - startFrom;

    const onMove = (mv: MouseEvent) => {
      const d = toDelta(mv.clientY - startY);
      if (mode === "pan") {
        let f = startFrom + d, t = startTo + d;
        if (f < 0)             { f = 0; t = span; }
        if (t > totalBars - 1) { t = totalBars - 1; f = t - span; }
        onRangeChange(f, t);
      } else if (mode === "top") {
        onRangeChange(Math.max(0, Math.min(startFrom + d, to - 2)), to);
      } else {
        onRangeChange(from, Math.max(from + 2, Math.min(startTo + d, totalBars - 1)));
      }
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  };

  const zoom = (factor: number) => {
    const center  = (from + to) / 2;
    const newSpan = Math.max(5, (to - from) * factor);
    onRangeChange(
      Math.max(0, center - newSpan / 2),
      Math.min(totalBars - 1, center + newSpan / 2),
    );
  };

  return (
    <div className={cn(
      "flex select-none flex-col items-center gap-1.5 border-l border-border/40 px-1 py-2",
      "w-7",
      className,
    )}>
      <button
        onClick={() => zoom(0.7)}
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="Zoom in"
      >
        <ZoomIn className="h-3 w-3" />
      </button>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative w-2 flex-1 rounded-full bg-border/30"
      >
        {/* Visible window */}
        <div
          className="absolute left-0 w-full cursor-grab rounded-full bg-primary/25 active:cursor-grabbing"
          style={{ top: `${topPct}%`, height: `${heightPct}%` }}
          onMouseDown={e => startDrag(e, "pan")}
        >
          {/* Top resize handle */}
          <div
            className="absolute top-0 left-0 w-full h-1.5 cursor-ns-resize rounded-t-full bg-primary/70 hover:bg-primary"
            onMouseDown={e => { e.stopPropagation(); startDrag(e, "top"); }}
          />
          {/* Bottom resize handle */}
          <div
            className="absolute bottom-0 left-0 w-full h-1.5 cursor-ns-resize rounded-b-full bg-primary/70 hover:bg-primary"
            onMouseDown={e => { e.stopPropagation(); startDrag(e, "bottom"); }}
          />
        </div>
      </div>

      <button
        onClick={() => zoom(1.4)}
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="Zoom out"
      >
        <ZoomOut className="h-3 w-3" />
      </button>
    </div>
  );
}
