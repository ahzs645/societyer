import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import { isStaticDemoRuntime } from "../lib/staticRuntime";

export const SUPPORTED_LOCALES = ["en", "fr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const LOCALE_KEY = "societyer.locale";

/** Storage can be missing (Node gate scripts) or throw (blocked site data); the UI must still boot. */
function readStoredLocale(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(LOCALE_KEY);
  } catch {
    return null;
  }
}

function detectInitialLocale(): Locale {
  if (!isStaticDemoRuntime()) {
    const stored = readStoredLocale();
    if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
      return stored as Locale;
    }
  }
  const nav = typeof navigator === "undefined" ? undefined : navigator.language?.slice(0, 2).toLowerCase();
  return nav === "fr" ? "fr" : "en";
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    lng: detectInitialLocale(),
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnNull: false,
  });

/** Screen readers, hyphenation and spell-check follow <html lang>; keep it in step with the UI language. */
function syncDocumentLanguage(language: string) {
  if (typeof document === "undefined") return;
  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(language.slice(0, 2)) ? language.slice(0, 2) : "en";
  document.documentElement.lang = locale;
}
syncDocumentLanguage(i18n.language ?? "en");
i18n.on("languageChanged", syncDocumentLanguage);

export function setLocale(locale: Locale) {
  if (!isStaticDemoRuntime()) {
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // Blocked storage: the language still changes for this session.
    }
  }
  i18n.changeLanguage(locale);
}

export function getLocale(): Locale {
  return (i18n.language as Locale) ?? "en";
}

export default i18n;
