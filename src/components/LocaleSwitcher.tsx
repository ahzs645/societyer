import { useTranslation } from "react-i18next";
import { SUPPORTED_LOCALES, setLocale, type Locale } from "../i18n";

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { i18n, t } = useTranslation();
  const current = (i18n.language?.slice(0, 2) as Locale) ?? "en";

  return (
    <label
      className="row"
      style={{ gap: 6, alignItems: "center" }}
      title={t("locale.switchTo")}
    >
      {!compact && <span className="muted">{t("locale.switchTo")}</span>}
      <select
        className="input"
        value={current}
        onChange={(e) => setLocale(e.target.value as Locale)}
        style={{ minWidth: compact ? 64 : undefined }}
        aria-label={t("locale.switchTo")}
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {t(`locale.${locale}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
