import { isDemoPath } from "./appRuntime";
import type { RuntimeMode } from "./runtimeMode";

export type AppRouteHrefOptions = {
  runtimeMode?: RuntimeMode;
  baseUrl?: string;
  demo?: boolean;
  locationHref?: string;
};

/** Mirrors BrowserRouter's basename; hash routing needs a full document URL. */
export function appRouteBasePath(options: Pick<AppRouteHrefOptions, "baseUrl" | "demo"> = {}): string {
  if (options.demo ?? isDemoPath()) return "/demo";
  const base = options.baseUrl ?? import.meta.env?.BASE_URL ?? "/";
  if (base === "/" || base === "./" || !base) return "";
  if (!base.startsWith("/") || base.startsWith("//") || /[\\\u0000-\u0020\u007f?#]/.test(base)) throw new Error("App routes require a local deployment base path.");
  return base.replace(/\/+$/, "");
}

/** Use for window.open and plain hrefs. React Router Link handles normal navigation. */
export function appRouteHref(routePath: string, options: AppRouteHrefOptions = {}): string {
  if (!routePath.startsWith("/") || routePath.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(routePath)) throw new Error("App route must be an absolute local router path.");
  const mode = options.runtimeMode ?? import.meta.env?.VITE_RUNTIME_MODE;
  if (mode === "electron-local") {
    const current = options.locationHref ?? (typeof window !== "undefined" ? window.location.href : undefined);
    if (!current) throw new Error("Desktop route links require the current document URL.");
    const documentUrl = new URL(current);
    if (!["file:", "http:", "https:"].includes(documentUrl.protocol)) throw new Error("Unsupported app document URL.");
    documentUrl.search = "";
    documentUrl.hash = routePath;
    return documentUrl.href;
  }
  return `${appRouteBasePath(options)}${routePath}`;
}

/** Copyable URL; file URLs remain local previews, not publicly hosted links. */
export function appRouteAbsoluteHref(routePath: string, options: AppRouteHrefOptions = {}): string {
  const href = appRouteHref(routePath, options);
  const current = options.locationHref ?? (typeof window !== "undefined" ? window.location.href : undefined);
  if (!current) throw new Error("Absolute route links require the current document URL.");
  return new URL(href, current).href;
}
