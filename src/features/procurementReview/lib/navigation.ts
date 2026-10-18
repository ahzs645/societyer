/** The plugin's own paths live under the page's splat route: /app/procurement-review/<plugin path>. */
export const REVIEW_BASE_PATH = "/app/procurement-review";

/** Router location → plugin-relative location ("/" for the page itself). */
export function pluginLocationFor(pathname: string, search = ""): string {
  const rest = pathname.toLowerCase().startsWith(REVIEW_BASE_PATH) ? pathname.slice(REVIEW_BASE_PATH.length) : "";
  return (rest && rest !== "/" ? rest : "/") + search;
}

/** Plugin-relative location → router path. */
export function appPathFor(location: string): string {
  return location === "/" ? REVIEW_BASE_PATH : `${REVIEW_BASE_PATH}${location.startsWith("/?") ? location.slice(1) : location}`;
}

/**
 * The module route's path as the browser sees it (router basename included,
 * no trailing slash), from `useHref(REVIEW_BASE_PATH)`: "/demo/app/procurement-review"
 * in the demo, "/app/procurement-review" hosted at the root.
 */
export function hrefBaseFor(href: string): string {
  return href.replace(/\/+$/, "");
}
