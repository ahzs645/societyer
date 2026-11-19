import { instanceWorkspaceSymbol, type InstanceBrandEnvironment } from "./instanceBranding";

export const DEFAULT_FAVICON_TAG = '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />';

/** Scope public compact artwork to its sign-in origin when a build serves several
 * domains. The head script runs before React, including on an authenticated load.
 * Other origins keep the neutral icon; workspace membership is never inferred. */
export function instanceFaviconMarkup(env: InstanceBrandEnvironment & {
  VITE_WORKSPACE_SYMBOL_SIGN_IN_ORIGIN?: string;
}) {
  const symbols = instanceWorkspaceSymbol(env.VITE_WORKSPACE_SYMBOL_BRAND_ID, env);
  if (!symbols) return DEFAULT_FAVICON_TAG;
  const origin = env.VITE_WORKSPACE_SYMBOL_SIGN_IN_ORIGIN;
  if (!origin) {
    // Preserve legacy single-instance builds that do not declare an origin.
    return `<link rel="icon" type="image/svg+xml" href="${symbols.light}" />\n    <link rel="icon" type="image/svg+xml" href="${symbols.dark}" media="(prefers-color-scheme: dark)" />`;
  }
  try {
    const url = new URL(origin);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== origin) return DEFAULT_FAVICON_TAG;
  } catch {
    return DEFAULT_FAVICON_TAG;
  }
  return `<link id="societyer-favicon" rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <script>
      (function () {
        if (window.location.origin !== ${JSON.stringify(origin)}) return;
        var light = document.getElementById("societyer-favicon");
        if (!light) return;
        light.href = ${JSON.stringify(symbols.light)};
        var dark = document.createElement("link");
        dark.rel = "icon";
        dark.type = "image/svg+xml";
        dark.href = ${JSON.stringify(symbols.dark)};
        dark.media = "(prefers-color-scheme: dark)";
        document.head.appendChild(dark);
      })();
    </script>`;
}
