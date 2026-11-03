"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme-boot";

export type ThemePreference = "light" | "dark" | "auto";
type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (theme: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
// D3: ключ общий с boot-скриптом в <head> — разъехаться им нельзя, иначе
// первый кадр и React будут выбирать тему по разным источникам.
const STORAGE_KEY = THEME_STORAGE_KEY;

function resolveTheme(preference: ThemePreference, media?: MediaQueryList): ResolvedTheme {
  if (preference !== "auto") return preference;
  return media?.matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // The first render must be identical on the server and in the browser.
  // Reading localStorage/matchMedia in the state initializer made the theme
  // toggle render different icons during hydration on dark-system devices.
  const [preference, setPreferenceState] = useState<ThemePreference>("auto");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  /**
   * D3: пока сохранённый выбор не прочитан, React не имеет права трогать
   * <html> — там уже стоит правильная тема от boot-скрипта. Без этого флага
   * первый проход эффекта применял «auto» и на кадр перебивал явный выбор
   * пользователя (тёмная система + сохранённая светлая тема = мигание).
   */
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const timer = window.setTimeout(() => {
      if (stored === "light" || stored === "dark" || stored === "auto") setPreferenceState(stored);
      setPreferenceLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = resolveTheme(preference, media);
      setResolvedTheme(resolved);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.themeMode = preference;
      document.documentElement.style.colorScheme = resolved;
    };
    if (preferenceLoaded) apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference, preferenceLoaded]);

  const setPreference = useCallback((theme: ThemePreference) => {
    setPreferenceState(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, []);

  const value = useMemo(() => ({ preference, resolvedTheme, setPreference }), [preference, resolvedTheme, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
