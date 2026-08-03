export type BrowserProvider = "blitz";

export type BrowserSessionRequest = {
  tenantKey: string;
  connectorId: string;
  profileKey: string;
  persist: boolean;
  liveView: boolean;
  readOnly?: boolean;
  timezone?: string;
  locale?: string;
  viewport?: {
    width: number;
    height: number;
  };
  browserVersion?: string;
  proxyUrl?: string;
};

export type BrowserSession = {
  provider: BrowserProvider;
  providerSessionId: string;
  profileKey: string;
  cdpUrl: string;
  dashboardUrl?: string;
  liveViewEnabled: boolean;
};

export type BrowserBackendHealth = {
  ok: boolean;
  provider: BrowserProvider;
  detail?: string;
};

export type BrowserBackend = {
  readonly provider: BrowserProvider;
  createSession(input: BrowserSessionRequest): Promise<BrowserSession>;
  stopSession(sessionId: string): Promise<void>;
  deleteProfile(input: Pick<BrowserSessionRequest, "tenantKey" | "connectorId" | "profileKey">): Promise<void>;
  healthCheck(): Promise<BrowserBackendHealth>;
};
