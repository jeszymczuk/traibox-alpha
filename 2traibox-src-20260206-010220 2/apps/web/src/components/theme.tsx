'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'dark' | 'light';

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void; toggle: () => void } | null>(null);

const STORAGE_KEY = 'traibox_theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // ignore
    }
    document.documentElement.dataset.theme = t;
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [setTheme, theme]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
      const initial = saved === 'light' || saved === 'dark' ? saved : 'dark';
      setThemeState(initial);
      document.documentElement.dataset.theme = initial;
    } catch {
      document.documentElement.dataset.theme = 'dark';
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

