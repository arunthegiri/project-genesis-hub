import { Settings } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { THEMES, setThemePrefs, type MarketConvention, type ThemeId } from "@/lib/theme";
import { useThemePrefs } from "@/hooks/useThemePrefs";

/**
 * §13.3 settings popover — theme picker for the four themes plus the two
 * independent direction axes (market convention, colorblind pair). Every
 * choice persists to the ui.theme cookie via setThemePrefs; the root shell
 * re-stamps the <html> attributes declaratively and the §13.4 chart registry
 * rethemes live charts off the attribute change.
 *
 * Built on the ui/* primitives (not components/terminal/* — W2 in flight; a
 * later wave can restyle to UnderlineTabs). SSR: renders the default prefs
 * server-side and during hydration (useThemePrefs default snapshot); the
 * popover is closed by default, so the post-mount swap to the cookie's
 * values is never visible.
 */
export function ThemeSettings() {
  const prefs = useThemePrefs();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="theme-settings-trigger"
          aria-label="Theme and display settings"
          className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-secondary"
        >
          <Settings className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72" data-testid="theme-settings">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
              Theme
            </span>
            <Tabs value={prefs.theme} onValueChange={(v) => setThemePrefs({ theme: v as ThemeId })}>
              <TabsList className="grid h-8 w-full grid-cols-4">
                {THEMES.map((t) => (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    title={t.hint}
                    data-testid={`theme-option-${t.id}`}
                    className="px-1 text-xs"
                    // Radix only fires onValueChange on CHANGE — re-clicking the
                    // active theme must still count as an explicit pick (it
                    // locks the theme against future prefers-color-scheme
                    // flips, §13.2).
                    onClick={() => {
                      if (t.id === prefs.theme) setThemePrefs({ theme: t.id });
                    }}
                  >
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
              Market convention
            </span>
            <ToggleGroup
              type="single"
              value={prefs.convention}
              onValueChange={(v) => v && setThemePrefs({ convention: v as MarketConvention })}
              className="grid w-full grid-cols-2"
            >
              <ToggleGroupItem
                value="western"
                data-testid="convention-western"
                className="h-8 text-xs"
                aria-label="Western convention, green up"
              >
                Green up
              </ToggleGroupItem>
              <ToggleGroupItem
                value="east-asian"
                data-testid="convention-east-asian"
                className="h-8 text-xs"
                aria-label="East Asian convention, red up"
              >
                Red up
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="cb-toggle" className="flex flex-col gap-0.5 text-xs font-normal">
              <span className="text-text-primary">Colorblind-safe colors</span>
              <span className="text-[10px] text-text-muted">
                Okabe-Ito direction pair (teal / orange)
              </span>
            </Label>
            <Switch
              id="cb-toggle"
              data-testid="cb-toggle"
              checked={prefs.cb}
              onCheckedChange={(v) => setThemePrefs({ cb: v })}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
