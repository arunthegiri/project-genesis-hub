import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, RefreshCw, Loader2 } from "lucide-react";
import { symbolsApi, normalizeSymbols, type AssetMatch } from "@/lib/api/symbols";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  selected?: string;
  onSelect?: (symbol: string) => void;
  className?: string;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function SymbolPicker({ selected, onSelect, className }: Props) {
  const qc = useQueryClient();
  const [adding, setAdding]           = useState("");
  const [open, setOpen]               = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef                  = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(adding.trim(), 300);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["symbols"],
    queryFn: symbolsApi.list,
  });
  const symbols = normalizeSymbols(data);

  const { data: searchResults = [], isFetching: isSearching } = useQuery({
    enabled: debouncedQuery.length >= 1,
    queryKey: ["symbol-search", debouncedQuery],
    queryFn: () => symbolsApi.search(debouncedQuery),
    staleTime: 5 * 60 * 1000,
  });

  const addMut = useMutation({
    mutationFn: (s: string) => symbolsApi.add(s.toUpperCase()),
    onSuccess: () => {
      setAdding("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["symbols"] });
    },
  });

  const removeMut = useMutation({
    mutationFn: (s: string) => symbolsApi.remove(s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["symbols"] }),
  });

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const selectMatch = (match: AssetMatch) => {
    setAdding(match.symbol);
    setOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = adding.trim().toUpperCase();
    if (sym) addMut.mutate(sym);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || searchResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted(i => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && searchResults[highlighted]) {
      e.preventDefault();
      selectMatch(searchResults[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showDropdown = open && adding.trim().length >= 1;

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

      {/* Search + add */}
      <div ref={containerRef} className="relative">
        <form className="flex gap-1" onSubmit={handleSubmit}>
          <div className="relative flex-1">
            <Input
              value={adding}
              onChange={(e) => {
                setAdding(e.target.value);
                setOpen(true);
                setHighlighted(0);
              }}
              onFocus={() => { if (adding.trim()) setOpen(true); }}
              onKeyDown={handleKeyDown}
              placeholder="Search symbol or company…"
              className="h-8 pr-6 text-xs"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {isSearching && (
              <Loader2 className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          <Button type="submit" size="sm" className="h-8 px-2" disabled={addMut.isPending}>
            <Plus className="h-3 w-3" />
          </Button>
        </form>

        {/* Dropdown */}
        {showDropdown && (
          <ul className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
            {searchResults.length === 0 && !isSearching && (
              <li className="px-3 py-2 text-xs text-muted-foreground">No results</li>
            )}
            {searchResults.map((m, i) => (
              <li key={m.symbol}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectMatch(m);
                  }}
                  onMouseEnter={() => setHighlighted(i)}
                  className={cn(
                    "flex w-full items-baseline gap-2 px-3 py-1.5 text-left",
                    "hover:bg-accent hover:text-accent-foreground",
                    i === highlighted && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="font-mono text-xs font-semibold">{m.symbol}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {addMut.error && (
        <p className="text-xs text-destructive">{(addMut.error as Error).message}</p>
      )}

      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {error && <p className="text-xs text-destructive">{(error as Error).message}</p>}

      {/* Tracked symbols */}
      <ul className="flex flex-col gap-0.5">
        {symbols.map((s) => (
          <li
            key={s}
            className={cn(
              "group flex items-center justify-between rounded px-2 py-1.5 transition-colors",
              "hover:bg-accent",
              selected === s && "bg-accent",
            )}
          >
            <button className="flex-1 text-left font-mono text-xs" onClick={() => onSelect?.(s)}>
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
