"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * `attribute="class"` is what globals.css keys its `.dark` block off, and
 * `disableTransitionOnChange` stops every surface in the app cross-fading at
 * once when the theme flips.
 *
 * The dark rail is NOT part of this: the sidebar tokens are dark in both
 * themes on purpose, so switching only repaints the working area.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
