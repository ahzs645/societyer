import { useTranslation } from "react-i18next";
import { SUPPORTED_LOCALES, setLocale, type Locale } from "../i18n";
import { Select } from "./Select";

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { i18n, t } = useTranslation();
  const activeLanguage = (i18n.resolvedLanguage || i18n.language || "en").slice(0, 2);
  const current = SUPPORTED_LOCALES.includes(activeLanguage as Locale)
    ? (activeLanguage as Locale)
    : "en";

  return (
    <label
      className="row"
      style={{ gap: 6, alignItems: "center" }}
      title={t("locale.switchTo")}
    >
      {!compact && <span className="muted">{t("locale.switchTo")}</span>}
      <Select value={current} onChange={value => setLocale(value as Locale)} options={[...SUPPORTED_LOCALES.map(locale => ({
  value: locale,
  label: t(`locale.${locale}`)
}))]} className="input" style={{
  minWidth: compact ? 64 : undefined
}} aria-label={t("locale.switchTo")} />
    </label>
  );
}
