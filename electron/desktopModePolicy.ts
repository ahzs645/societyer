/** Pure policies shared by the main-process handlers and executable checks. */
export type HostedDesktopConfiguration = {
  origin: string;
  authenticationOrigins: string[];
};

export function normalizeHostedOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter the HTTPS address of your Societyer web app."); }
  if (url.protocol !== "https:" || url.hostname.includes("*") || url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "/app" && url.pathname !== "/app/")) {
    throw new Error("Use an HTTPS app origin without credentials, query parameters or a custom path.");
  }
  return url.origin;
}

export function normalizeHostedConfiguration(input: HostedDesktopConfiguration): HostedDesktopConfiguration {
  const origin = normalizeHostedOrigin(input.origin);
  if (!Array.isArray(input.authenticationOrigins) || input.authenticationOrigins.length > 5) {
    throw new Error("Specify at most five exact HTTPS sign-in origins.");
  }
  return {
    origin,
    authenticationOrigins: [...new Set(input.authenticationOrigins.map(normalizeHostedOrigin))]
      .filter((entry) => entry !== origin),
  };
}

export function isAllowedHostedNavigation(url: string, configuration: HostedDesktopConfiguration): boolean {
  try {
    const target = new URL(url);
    return target.protocol === "https:" && !target.username && !target.password &&
      (target.origin === configuration.origin || configuration.authenticationOrigins.includes(target.origin));
  } catch { return false; }
}

export function isTrustedLocalRendererUrl(url: string, devOrigin?: string): boolean {
  try {
    const target = new URL(url);
    return devOrigin
      ? target.origin === devOrigin && !target.username && !target.password
      : target.protocol === "societyer-app:" && target.hostname === "index.html" && !target.username && !target.password;
  } catch { return false; }
}
