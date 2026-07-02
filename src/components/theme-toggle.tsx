"use client";

/**
 * ThemeToggle — light/dark mode switch button.
 *
 * Uses next-themes to toggle the `dark` class on <html>. Renders a sun icon
 * in dark mode (click → light) and a moon icon in light mode (click → dark).
 */
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  // Track whether we've mounted to avoid hydration mismatch. The state
  // update happens in useEffect (after mount), not during render.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // This is the standard next-themes hydration-safe pattern: set mounted
    // after the first render so we don't read `theme` (a client-only value)
    // during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className={className} disabled>
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  const isDark = theme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={className}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
