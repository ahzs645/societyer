import crypto from "node:crypto";
import type {
  BrowserBackend,
  BrowserBackendHealth,
  BrowserProvider,
  BrowserSession,
  BrowserSessionRequest,
} from "./types.js";
import { deriveProfileIdentity } from "./profileKeys.js";

export class BlitzBrowserBackend implements BrowserBackend {
  readonly provider: BrowserProvider = "blitz";

  constructor(
    private readonly cdpBaseUrl: string,
    private readonly dashboardUrl?: string,
  ) {}

  async createSession(input: BrowserSessionRequest): Promise<BrowserSession> {
    const url = new URL(this.cdpBaseUrl);
    const profile = deriveProfileIdentity(input.tenantKey, input.connectorId, input.profileKey);

    if (input.persist) url.searchParams.set("userDataId", profile.userDataId);
    if (input.readOnly) url.searchParams.set("userDataReadOnly", "true");
    if (input.liveView) url.searchParams.set("liveView", "true");
    if (input.timezone) url.searchParams.set("timezone", input.timezone);
    if (input.browserVersion) url.searchParams.set("browserVersion", input.browserVersion);
    if (input.proxyUrl) url.searchParams.set("proxyUrl", input.proxyUrl);

    return {
      provider: this.provider,
      providerSessionId: crypto.randomUUID(),
      profileKey: profile.profileKey,
      cdpUrl: url.toString(),
      dashboardUrl: this.dashboardUrl,
      liveViewEnabled: input.liveView,
    };
  }

  async stopSession(_sessionId: string): Promise<void> {
    // BlitzBrowser binds browser lifetime to the CDP connection. The runner
    // closes the Playwright browser handle; no extra provider API is needed.
  }

  async deleteProfile(input: Pick<BrowserSessionRequest, "tenantKey" | "connectorId" | "profileKey">): Promise<void> {
    deriveProfileIdentity(input.tenantKey, input.connectorId, input.profileKey);
    throw new Error("BlitzBrowser profile deletion is not exposed through the CDP endpoint.");
  }

  async healthCheck(): Promise<BrowserBackendHealth> {
    try {
      const url = new URL(this.cdpBaseUrl);
      if (url.protocol !== "ws:" && url.protocol !== "wss:") {
        return { ok: false, provider: this.provider, detail: "BLITZBROWSER_CDP_URL must be ws:// or wss://." };
      }
      return { ok: true, provider: this.provider };
    } catch (error: unknown) {
      return {
        ok: false,
        provider: this.provider,
        detail: error instanceof Error ? error.message : "Invalid BlitzBrowser URL.",
      };
    }
  }
}
