/**
 * Document locale helpers (pure logic).
 *
 * Maps the per-society YCN DOC_PREP_LANGUAGE setting to a document locale and
 * provides locale-aware long-date formatting. English is the default and is
 * byte-identical to the prior behaviour, so non-French societies are unaffected.
 */

export type DocLocale = "en" | "fr";

/** Resolve DOC_PREP_LANGUAGE (free text) to a supported locale. */
export function resolveLocale(docPrepLanguage?: string | null): DocLocale {
  const text = (docPrepLanguage ?? "").trim().toLowerCase();
  if (text.startsWith("fr") || text.includes("français") || text.includes("francais")) {
    return "fr";
  }
  return "en";
}

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/**
 * Format an ISO YYYY-MM-DD date as a long human date in the given locale:
 *   en -> "June 25, 2026"
 *   fr -> "25 juin 2026"
 * Parses the parts directly (no timezone drift, no date library). Non-parseable
 * input passes through unchanged.
 */
export function formatLongDate(iso: string, locale: DocLocale = "en"): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!match) {
    return iso ?? "";
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const months = locale === "fr" ? MONTHS_FR : MONTHS_EN;
  const monthName = months[monthIndex];
  if (!monthName) {
    return iso;
  }
  return locale === "fr" ? `${day} ${monthName} ${year}` : `${monthName} ${day}, ${year}`;
}
