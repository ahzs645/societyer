export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "societyer:theme";

const THEME_CLASSES: ResolvedTheme[] = ["light", "dark"];
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

// Browser / PWA chrome colour per theme — matches --bg-primary (slate-1) so
// the status bar and Android toolbar blend into the app canvas instead of
// painting a dark band over the light UI.
const THEME_CHROME_COLORS: Record<ResolvedTheme, string> = {
  light: "#fcfcfd",
  dark: "#111113",
};

function syncThemeColorMeta(resolvedTheme: ResolvedTheme) {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((meta, index) => {
    // index.html ships one tag per prefers-color-scheme; once the app has
    // resolved an explicit theme the stored preference wins over the OS.
    meta.removeAttribute("media");
    if (index === 0) meta.content = THEME_CHROME_COLORS[resolvedTheme];
    else meta.remove();
  });
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light";
}

export function resolveThemePreference(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? getSystemTheme() : preference;
}

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function storeThemePreference(preference: ThemePreference) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Ignore storage failures; the active document can still be themed.
  }
}

export function applyThemePreference(preference = getStoredThemePreference()): ResolvedTheme {
  const resolvedTheme = resolveThemePreference(preference);

  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.remove(...THEME_CLASSES);
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;
    syncThemeColorMeta(resolvedTheme);
  }

  return resolvedTheme;
}

export function applyResolvedTheme(resolvedTheme: ResolvedTheme): ResolvedTheme {
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.remove(...THEME_CLASSES);
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;
    syncThemeColorMeta(resolvedTheme);
  }
  return resolvedTheme;
}

export function watchSystemTheme(onChange: (theme: ResolvedTheme) => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};

  const media = window.matchMedia(SYSTEM_DARK_QUERY);
  const handleChange = () => onChange(getSystemTheme());

  if (media.addEventListener) {
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }

  media.addListener(handleChange);
  return () => media.removeListener(handleChange);
}
