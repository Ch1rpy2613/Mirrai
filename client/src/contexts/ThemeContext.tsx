import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * The browser-chrome colour for each theme.
 *
 * The install manifest can only carry one `theme_color`, but the address bar
 * on an installed app follows the `<meta name="theme-color">` tag — so the
 * two themes each get their own value there.
 */
const THEME_COLORS: Record<Theme, string> = {
  dark: "#6E5AC8",
  light: "#f3eee3",
};

interface ThemeContextType {
  theme: Theme;
  toggleTheme?: () => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}

/**
 * The stored theme, if there is one and it is one of the two.
 *
 * The storage can refuse — private mode, cookies disabled, a full
 * quota — and it used to be read without a guard, in the state
 * initialiser of the outermost provider: the whole app failed to mount.
 *
 * And any rubbish in the storage was taken as the theme, so the browser
 * chrome was told its colour was "undefined".
 */
function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem("theme");
    return stored === "dark" || stored === "light" ? stored : null;
  } catch {
    return null;
  }
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (!switchable) return defaultTheme;
    const stored = readStoredTheme();
    if (stored) return stored;
    // The theme follows the operating system.
    //
    // It did not: the provider was mounted with a hard-coded "light",
    // and nothing ever asked the system what it wanted. So a user whose
    // machine is in dark mode got a bright cream app on the first run
    // and had to find the theme button by hand — while the stylesheet's
    // own header claimed the themes follow the system.
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      try {
        if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
      } catch {
        // The system will not say; the default stands.
      }
    }
    return defaultTheme;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    // Keep the browser chrome in step with the theme.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", THEME_COLORS[theme]);
    }

    if (switchable) {
      try {
        localStorage.setItem("theme", theme);
      } catch {
        // A browser that will not keep the choice is not a problem: the
        // theme still changes for this session.
      }
    }
  }, [theme, switchable]);

  const toggleTheme = switchable
    ? () => {
        setTheme(prev => (prev === "light" ? "dark" : "light"));
      }
    : undefined;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, switchable }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
