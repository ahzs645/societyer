export type BrowserProvider = "blitz";

export type BrowserSessionRequest = {
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
  deleteProfile(profileKey: string): Promise<void>;
  healthCheck(): Promise<BrowserBackendHealth>;
};
