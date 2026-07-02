"use client";

/**
 * ThemeProvider — wraps next-themes so the app supports light/dark mode.
 *
 * Default theme is dark (the chess app's primary look), but users can switch
 * to a light theme from the home page. The `class` attribute strategy
 * toggles the `dark` class on <html>, which drives the CSS variables.
 */
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
