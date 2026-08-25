"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const THEME_KEY = "sentinel_theme";

export function ThemeToggle({ className = "" }) {
  // Starts null (renders nothing) so the client never paints a guess that
  // might not match the pre-hydration inline script in app/layout.js -
  // avoids a flash where the icon briefly shows the wrong state.
  const [isDark, setIsDark] = useState(null);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      window.localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      // localStorage unavailable (private browsing, etc.) - theme just
      // won't persist across visits, harmless.
    }
  }

  if (isDark === null) {
    return <div className={`size-8 ${className}`} aria-hidden="true" />;
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={`inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground ${className}`}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
