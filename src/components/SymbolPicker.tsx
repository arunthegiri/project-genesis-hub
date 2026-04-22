import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, RefreshCw } from "lucide-react";
import { symbolsApi, normalizeSymbols } from "@/lib/api/symbols";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  selected?: string;
  onSelect?: (symbol: string) => void;
  className?: string;
}

export function SymbolPicker({ selected, onSelect, className }: Props) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState("");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["symbols"],
    queryFn: symbolsApi.list,
  });

  const symbols = normalizeSymbols(data);

  const addMut = useMutation({
    mutationFn: (s: string) => symbolsApi.add(s.toUpperCase()),
    onSuccess: () => {
      setAdding("");
      qc.invalidateQueries({ queryKey: ["symbols"] });
    },
  });

  const removeMut = useMutation({
    mutationFn: (s: string) => symbolsApi.remove(s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["symbols"] }),
  });

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Symbols
        </h3>
        <button
          onClick={() => refetch()}
          className="text-muted-foreground hover:text-foreground"
          title="Refresh"
        >
          <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
        </button>
      </div>

      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (adding.trim()) addMut.mutate(adding.trim());
        }}
      >
        <Input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="AAPL"
          className="h-8 font-mono text-xs uppercase"
        />
        <Button type="submit" size="sm" className="h-8 px-2" disabled={addMut.isPending}>
          <Plus className="h-3 w-3" />
        </Button>
      </form>

      {addMut.error && (
        <p className="text-xs text-destructive">{(addMut.error as Error).message}</p>
      )}

      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {error && (
        <p className="text-xs text-destructive">
          {(error as Error).message}
        </p>
      )}

      <ul className="flex flex-col gap-0.5">
        {symbols.map((s) => (
          <li
            key={s}
            className={cn(
              "group flex items-center justify-between rounded px-2 py-1.5 text-sm transition-colors",
              "hover:bg-accent",
              selected === s && "bg-accent",
            )}
          >
            <button
              className="flex-1 text-left font-mono"
              onClick={() => onSelect?.(s)}
            >
              {s}
            </button>
            <button
              onClick={() => removeMut.mutate(s)}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
              title="Remove"
            >
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
        {!isLoading && !error && symbols.length === 0 && (
          <li className="text-xs text-muted-foreground py-2">No symbols. Add one above.</li>
        )}
      </ul>
    </div>
  );
}
