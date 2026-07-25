import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import { isStaticDemoRuntime } from "../lib/staticRuntime";

export const SUPPORTED_LOCALES = ["en", "fr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const LOCALE_KEY = "societyer.locale";

function detectInitialLocale(): Locale {
  if (!isStaticDemoRuntime()) {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
      return stored as Locale;
    }
  }
  const nav = navigator.language?.slice(0, 2).toLowerCase();
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

export function setLocale(locale: Locale) {
  if (!isStaticDemoRuntime()) {
    localStorage.setItem(LOCALE_KEY, locale);
  }
  i18n.changeLanguage(locale);
}

export function getLocale(): Locale {
  return (i18n.language as Locale) ?? "en";
}

export default i18n;
