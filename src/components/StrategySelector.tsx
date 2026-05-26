import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { strategiesApi } from "@/lib/api/strategies";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Props {
  selectedStrategy: string | null;
  onSelect: (name: string | null) => void;
}

export function StrategySelector({ selectedStrategy, onSelect }: Props) {
  const { data: strategies = [], isLoading, isError } = useQuery({
    queryKey: ["strategies"],
    queryFn: strategiesApi.list,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex h-8 w-44 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading strategies…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-8 w-44 items-center px-2 text-xs text-destructive">
        Failed to load strategies
      </div>
    );
  }

  return (
    <Select
      value={selectedStrategy ?? "__none__"}
      onValueChange={v => onSelect(v === "__none__" ? null : v)}
    >
      <SelectTrigger className="h-8 w-44 text-xs">
        <SelectValue placeholder="Strategy…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">None</SelectItem>
        {strategies.length === 0 && (
          <SelectItem value="__empty__" disabled>
            Export one from Jupyter via s.export()
          </SelectItem>
        )}
        {strategies.map(s => (
          <SelectItem key={s.id} value={s.name}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
