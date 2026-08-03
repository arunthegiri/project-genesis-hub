import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { DialogTitle } from "@/components/ui/dialog";
import {
  closePalette,
  getCommand,
  getRecentIds,
  pushScope,
  recordRecent,
  useCommands,
  usePaletteState,
  type CommandSpec,
} from "@/lib/command-registry";
import { getActiveChartPanel, setPendingSymbol } from "@/lib/active-chart-panel";
import { symbolsApi, type AssetMatch } from "@/lib/api/symbols";

const SEARCH_DEBOUNCE_MS = 200;
const MAX_SYMBOL_RESULTS = 8;

/**
 * Global command palette (build doc §17) on cmdk 1.1.1.
 *
 * - Local commands come from the decentralized registry (feature components
 *   register on mount); cmdk's built-in command-score ranking does the
 *   filtering — no fuzzy lib.
 * - Symbol jump: symbolsApi.search debounced 200ms with an AbortController;
 *   remote rows are force-mounted so cmdk's local filter never hides them,
 *   and local commands stay visible while remote results load.
 * - Empty query pins the last 8 executed commands (localStorage recents) on
 *   top, their category rows excluded below to keep cmdk values unique.
 * - Launch options come from the registry's palette state: a seeded query
 *   (bare letter typed on the chart) or a category pre-filter ("/").
 */
export function CommandPalette() {
  const palette = usePaletteState();
  const commands = useCommands();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [matches, setMatches] = useState<AssetMatch[]>([]);

  // Seed input/filter from the launch options on every open; reset on close.
  useEffect(() => {
    if (palette.open) {
      setQuery(palette.query);
      setCategoryFilter(palette.category);
    } else {
      setQuery("");
      setCategoryFilter(null);
      setMatches([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette.open]);

  // The palette owns the top of the hotkey scope stack while open, which
  // keeps chart hotkeys inert even if the chart somehow still has focus.
  useEffect(() => {
    if (!palette.open) return;
    return pushScope("palette");
  }, [palette.open]);

  // Symbol jump — debounced remote search, stale responses aborted.
  useEffect(() => {
    if (!palette.open) return;
    const q = query.trim();
    if (q.length < 1) {
      setMatches([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      symbolsApi
        .search(q, ctrl.signal)
        .then((res) => setMatches((res ?? []).slice(0, MAX_SYMBOL_RESULTS)))
        .catch(() => {
          /* aborted or backend down — local commands still show */
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, palette.open]);

  const recentCommands = useMemo(() => {
    if (!palette.open || query || categoryFilter) return [];
    const byId = new Map(commands.map((c) => [c.id, c]));
    return getRecentIds()
      .map((id) => byId.get(id))
      .filter((c): c is CommandSpec => !!c);
  }, [palette.open, query, categoryFilter, commands]);

  const groups = useMemo(() => {
    const recentIds = new Set(recentCommands.map((c) => c.id));
    const byCategory = new Map<string, CommandSpec[]>();
    for (const cmd of commands) {
      if (categoryFilter && cmd.category !== categoryFilter) continue;
      if (recentIds.has(cmd.id)) continue; // already pinned in the Recent group
      const list = byCategory.get(cmd.category) ?? [];
      list.push(cmd);
      byCategory.set(cmd.category, list);
    }
    return Array.from(byCategory.entries());
  }, [commands, recentCommands, categoryFilter]);

  const runCommand = (id: string) => {
    const cmd = getCommand(id);
    closePalette();
    if (cmd) {
      recordRecent(id);
      cmd.action();
    }
  };

  // Symbol jump applies to the ACTIVE chart panel; off "/", stash the pick
  // and navigate — the charts page consumes it on mount.
  const pickSymbol = (symbol: string) => {
    closePalette();
    const panel = getActiveChartPanel();
    if (panel) {
      panel.setSymbol(symbol);
    } else {
      setPendingSymbol(symbol);
      navigate({ to: "/" });
    }
  };

  const showSymbols = !categoryFilter && query.trim().length > 0 && matches.length > 0;

  return (
    <CommandDialog
      open={palette.open}
      onOpenChange={(open) => {
        if (!open) closePalette();
      }}
    >
      <DialogTitle className="sr-only">Command palette</DialogTitle>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Type a command or symbol…"
      />
      {categoryFilter && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <span className="rounded border border-border bg-panel px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {categoryFilter}
          </span>
          <button
            type="button"
            onClick={() => setCategoryFilter(null)}
            className="text-muted-foreground hover:text-foreground"
            title="Clear filter"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <CommandList>
        <CommandEmpty>No matching commands.</CommandEmpty>
        {recentCommands.length > 0 && (
          <CommandGroup heading="Recent">
            {recentCommands.map((cmd) => (
              <PaletteCommandItem key={cmd.id} cmd={cmd} onSelect={runCommand} />
            ))}
          </CommandGroup>
        )}
        {groups.map(([category, cmds]) => (
          <CommandGroup heading={category} key={category}>
            {cmds.map((cmd) => (
              <PaletteCommandItem key={cmd.id} cmd={cmd} onSelect={runCommand} />
            ))}
          </CommandGroup>
        ))}
        {showSymbols && (
          <CommandGroup heading="Symbols">
            {matches.map((m) => (
              <CommandItem
                key={m.symbol}
                value={`sym:${m.symbol}`}
                keywords={[m.symbol, m.name]}
                forceMount
                onSelect={() => pickSymbol(m.symbol)}
              >
                <span className="font-mono text-sm font-semibold">{m.symbol}</span>
                <span className="truncate text-xs text-muted-foreground">{m.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex items-center gap-3 border-t border-border bg-panel px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
        <span>↑↓ navigate</span>
        <span>↵ select</span>
        <span>esc close</span>
      </div>
    </CommandDialog>
  );
}

function PaletteCommandItem({
  cmd,
  onSelect,
}: {
  cmd: CommandSpec;
  onSelect: (id: string) => void;
}) {
  return (
    <CommandItem
      value={cmd.id}
      keywords={[cmd.label, ...cmd.keywords]}
      onSelect={() => onSelect(cmd.id)}
    >
      <span>{cmd.label}</span>
      {cmd.shortcut && <CommandShortcut className="font-mono">{cmd.shortcut}</CommandShortcut>}
    </CommandItem>
  );
}
