/**
 * Layout breakpoints — single source of truth shared by JS and CSS.
 * Values come from CSS custom properties defined on :root in theme/tokens.css
 * so that stylesheet media queries and matchMedia checks stay in sync.
 */

function readCssNumber(name: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const MOBILE_SIDEBAR_BREAKPOINT = readCssNumber("--bp-mobile-sidebar", 980);
// Matches twenty-ui's MOBILE_VIEWPORT — below this we apply phone-optimized
// affordances (full-width drawer, larger nav type, wider page padding).
export const MOBILE_BREAKPOINT = readCssNumber("--bp-mobile", 768);
export const MOBILE_CARD_BREAKPOINT = readCssNumber("--bp-mobile-card", 760);

export const mobileSidebarMediaQuery = `(max-width: ${MOBILE_SIDEBAR_BREAKPOINT}px)`;
export const mobileMediaQuery = `(max-width: ${MOBILE_BREAKPOINT}px)`;
export const mobileCardMediaQuery = `(max-width: ${MOBILE_CARD_BREAKPOINT}px)`;
