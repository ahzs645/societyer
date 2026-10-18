/**
 * The 27 Zoer theme tokens (THEME_TOKENS in zoer/packages/plugin-site/bin/export-site-data.ts).
 * The mount element defines each as `--zoer-<token>` from Societyer tokens in
 * src/styles/_procurement-review.scss, so they follow light and dark.
 */
export const ZOER_THEME_TOKENS = [
  "surface-base", "surface-primary", "surface-secondary", "surface-hover", "surface-active",
  "border-default", "border-muted",
  "text-heading", "text-primary", "text-secondary", "text-muted", "text-faint",
  "accent", "accent-hover", "accent-subtle", "accent-text",
  "input-bg", "input-border", "input-focus",
  "danger", "danger-hover", "danger-text",
  "scrollbar-thumb", "scrollbar-hover",
  "status-error", "status-success", "status-warning",
] as const;

export type ZoerThemeToken = typeof ZOER_THEME_TOKENS[number];
export type ReviewAppearance = { dark: boolean; tokens: Record<ZoerThemeToken, string> };

export function isDarkTheme(): boolean {
  return document.documentElement.classList.contains("dark");
}

/** The resolved colours on the mount element, keyed by the Zoer token names. */
export function readAppearance(element: Element): ReviewAppearance {
  const style = getComputedStyle(element);
  const tokens = Object.fromEntries(ZOER_THEME_TOKENS.map((name) => [name, style.getPropertyValue(`--zoer-${name}`).trim()])) as Record<ZoerThemeToken, string>;
  return { dark: isDarkTheme(), tokens };
}
