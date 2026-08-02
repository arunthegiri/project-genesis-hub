import React, { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "./Button";

type Mode = "light" | "dark";

const STORAGE_KEY = "ananke-copilot.theme";

function applyMode(mode: Mode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
}

/**
 * Toggles the `.dark` class on <html>, which is the switch base.css keys its
 * dark palette off. Preference is stored per-browser; first visit follows the
 * OS setting.
 */
export function ThemeModeSwitch() {
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Mode | null;
    const initial =
      stored ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setMode(initial);
    applyMode(initial);
  }, []);

  const toggle = () => {
    const next: Mode = mode === "dark" ? "light" : "dark";
    setMode(next);
    applyMode(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
    >
      {mode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </Button>
  );
}
