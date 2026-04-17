import { useCallback, useEffect, useState } from "react";
import {
  applyThemePreference,
  getStoredThemePreference,
  isThemePreference,
  storeThemePreference,
  THEME_STORAGE_KEY,
  watchSystemTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "../lib/theme";

export function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    getStoredThemePreference(),
  );
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    applyThemePreference(getStoredThemePreference()),
  );

  useEffect(() => {
    setResolvedTheme(applyThemePreference(preference));

    if (preference !== "system") return;

    return watchSystemTheme(() => {
      setResolvedTheme(applyThemePreference("system"));
    });
  }, [preference]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;

      const nextPreference = isThemePreference(event.newValue)
        ? event.newValue
        : "system";
      setPreferenceState(nextPreference);
      setResolvedTheme(applyThemePreference(nextPreference));
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    storeThemePreference(nextPreference);
    setPreferenceState(nextPreference);
    setResolvedTheme(applyThemePreference(nextPreference));
  }, []);

  return { preference, resolvedTheme, setPreference };
}
