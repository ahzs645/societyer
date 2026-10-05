import crypto from "node:crypto";
import { WebSocket } from "ws";
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
      return await new Promise<BrowserBackendHealth>((resolve) => {
        const socket = new WebSocket(url);
        let settled = false;
        const finish = (ok: boolean, detail?: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          socket.terminate();
          resolve({ ok, provider: this.provider, detail });
        };
        const timeout = setTimeout(() => finish(false, "Browser endpoint did not answer the CDP health probe."), 3_000);
        socket.once("open", () => socket.send(JSON.stringify({ id: 1, method: "Browser.getVersion" })));
        socket.on("message", (raw: WebSocket.RawData) => {
          let payload: any;
          try { payload = JSON.parse(raw.toString()); } catch { finish(false, "Browser endpoint returned an invalid CDP response."); return; }
          if (payload?.id !== 1) return;
          finish(typeof payload?.result?.product === "string", payload?.result?.product ? undefined : "Browser endpoint rejected the CDP health probe.");
        });
        socket.once("error", () => finish(false, "Browser endpoint is unavailable or rejected the connection."));
        socket.once("close", () => finish(false, "Browser endpoint closed before answering the CDP health probe."));
      });
    } catch (error: unknown) {
      return {
        ok: false,
        provider: this.provider,
        detail: "Invalid BlitzBrowser endpoint configuration.",
      };
    }
  }
}
