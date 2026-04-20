import { BlitzBrowserBackend } from "./blitzBrowserBackend.js";
import type { BrowserBackend } from "./types.js";

export function createBrowserBackend(): BrowserBackend {
  const provider = (process.env.CONNECTOR_BROWSER_PROVIDER ?? "blitz").trim().toLowerCase();

  if (provider === "blitz") {
    return new BlitzBrowserBackend(
      process.env.BLITZBROWSER_CDP_URL ?? "ws://127.0.0.1:9999",
      process.env.BLITZBROWSER_DASHBOARD_URL,
    );
  }

  throw new Error(`Unsupported CONNECTOR_BROWSER_PROVIDER "${provider}". Supported providers: blitz.`);
}
