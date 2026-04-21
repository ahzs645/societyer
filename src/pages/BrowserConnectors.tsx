import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardPaste, ExternalLink, KeyRound, MonitorPlay, Play, PlugZap, RefreshCw, ShieldCheck, Square, XCircle } from "lucide-react";
import { PageHeader, SeedPrompt } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { LiveBrowserView } from "../components/LiveBrowserView";
import { useSociety } from "../hooks/useSociety";
import { useToast } from "../components/Toast";
import { formatDateTime } from "../lib/format";

type RunnerHealth = {
  ok?: boolean;
  runner?: string;
  browser?: {
    ok: boolean;
    provider: string;
    detail?: string;
  };
  activeSessions?: number;
};

type BrowserSession = {
  sessionId: string;
  connectorId?: string;
  profileKey: string;
  provider: string;
  startedAtISO: string;
  currentUrl: string;
  dashboardUrl?: string;
  vncWebSocketUrl?: string;
  liveViewEnabled?: boolean;
};

type ConnectorManifest = {
  id: string;
  name: string;
  description: string;
  category?: string;
  auth: {
    startUrl: string;
    allowedOrigins: string[];
    profileKeyPrefix?: string;
    confirmMode?: "verified" | "profile";
  };
  actions: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  utility?: {
    title: string;
    description: string;
    steps: string[];
  };
};

type StartLoginResponse = BrowserSession & {
  connectorId?: string;
  dashboardUrl?: string;
};

const DEFAULT_CONNECTOR_ID = "wave";
const DEFAULT_PROFILE = "wave-local-demo";
const DEFAULT_URL = "https://next.waveapps.com/";
const FALLBACK_CONNECTORS: ConnectorManifest[] = [
  {
    id: "wave",
    name: "Wave",
    category: "Accounting",
    description: "User-authorized Wave browser connector for transaction exports beyond the public API.",
    auth: {
      startUrl: DEFAULT_URL,
      allowedOrigins: ["https://next.waveapps.com", "https://gql.waveapps.com"],
      profileKeyPrefix: "wave",
      confirmMode: "verified",
    },
    actions: [
      {
        id: "listTransactions",
        name: "List transactions",
        description: "Fetch Wave transactions through the authenticated browser session.",
      },
      {
        id: "importTransactions",
        name: "Import transactions",
        description: "Fetch all available Wave transactions and normalize them for Societyer financial records.",
      },
    ],
    utility: {
      title: "Wave data import",
      description: "Pull browser-session transactions and save normalized account rows into Societyer.",
      steps: [
        "Open Wave in the live browser and finish login.",
        "Confirm the saved profile or pull while the live session is active.",
        "Run Preview pull or Pull all & save from the Wave import panel.",
      ],
    },
  },
  {
    id: "bc-registry",
    name: "BC Registry",
    category: "Registry",
    description: "Browser utility profile for authenticated BC Registry filing-history exports.",
    auth: {
      startUrl: "https://www.bcregistry.ca/societies/",
      allowedOrigins: ["https://www.bcregistry.ca"],
      profileKeyPrefix: "bc-registry",
      confirmMode: "profile",
    },
    actions: [
      {
        id: "filingHistoryExport",
        name: "Filing history export",
        description: "Use a filing-history page utility to download digital PDFs and a CSV table of all filing records.",
      },
    ],
    utility: {
      title: "BC Registry filing export",
      description: "Save a BC Registry browser profile, then run a page utility or Chrome extension on a society filing-history page.",
      steps: [
        "Open BC Registry in the live browser and navigate to the target society filing history.",
        "Save the profile so authenticated registry cookies remain available to browser-backed utilities.",
        "Run the filing-history export utility on the current page to create the CSV and download every digital document.",
      ],
    },
  },
];

function profileKeyFor(connector: ConnectorManifest | undefined) {
  return `${connector?.auth.profileKeyPrefix ?? connector?.id ?? "browser"}-local-demo`;
}

function confirmModeFor(connector: ConnectorManifest | undefined) {
  return connector?.auth.confirmMode ?? (connector?.id === "wave" ? "verified" : "profile");
}

export function BrowserConnectorsPage() {
  const society = useSociety();
  const toast = useToast();
  const [health, setHealth] = useState<RunnerHealth | null>(null);
  const [connectors, setConnectors] = useState<ConnectorManifest[]>([]);
  const [connectorId, setConnectorId] = useState(DEFAULT_CONNECTOR_ID);
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [profileKey, setProfileKey] = useState(DEFAULT_PROFILE);
  const [startUrl, setStartUrl] = useState(DEFAULT_URL);
  const [busy, setBusy] = useState(false);
  const [activeDashboardUrl, setActiveDashboardUrl] = useState("http://127.0.0.1:3003");
  const [authCheck, setAuthCheck] = useState<any | null>(null);
  const [savedConnection, setSavedConnection] = useState<any | null>(null);
  const [lastRun, setLastRun] = useState<any | null>(null);
  const [businessId, setBusinessId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [pasteText, setPasteText] = useState("");

  const availableConnectors = connectors.length ? connectors : FALLBACK_CONNECTORS;
  const activeSession = sessions[0] ?? null;
  const activeWaveSession = sessions.find((session) => session.connectorId === "wave") ?? null;
  const activeWaveNeedsLogin = Boolean(activeWaveSession && /auth\.waveapps\.com|\/login|identifier/i.test(activeWaveSession.currentUrl));
  const selectedConnector = availableConnectors.find((connector) => connector.id === connectorId) ?? availableConnectors[0];
  const selectedConfirmMode = confirmModeFor(selectedConnector);
  const runnerReady = Boolean(health?.ok && health.browser?.ok);
  const liveViewUrl = useMemo(() => {
    if (!activeSession?.dashboardUrl) return activeDashboardUrl;
    return activeSession.dashboardUrl;
  }, [activeDashboardUrl, activeSession?.dashboardUrl]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [society?._id]);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`/api/v1/browser-connectors${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message ?? payload?.error ?? `Request failed with ${response.status}`);
    }
    return payload;
  }

  async function refresh() {
    if (!society?._id) return;
    try {
      const [connectorsPayload, healthPayload, sessionsPayload] = await Promise.all([
        apiFetch<{ connectors: ConnectorManifest[] }>(`/connectors?societyId=${society._id}`),
        apiFetch<{ data: RunnerHealth }>(`/health?societyId=${society._id}`),
        apiFetch<{ sessions: BrowserSession[] }>(`/sessions?societyId=${society._id}`),
      ]);
      setConnectors(connectorsPayload.connectors ?? []);
      setHealth(healthPayload.data);
      setSessions(sessionsPayload.sessions ?? []);
      const primarySession = sessionsPayload.sessions?.[0];
      const dashboardUrl = primarySession?.dashboardUrl;
      if (dashboardUrl) setActiveDashboardUrl(dashboardUrl);
      if (primarySession?.connectorId === connectorId) {
        setProfileKey((current) => {
          const connectorDefault = profileKeyFor(availableConnectors.find((connector) => connector.id === connectorId));
          return current === DEFAULT_PROFILE || current === connectorDefault ? primarySession.profileKey : current;
        });
      }
    } catch (error: any) {
      setHealth({ ok: false, browser: { ok: false, provider: "blitz", detail: error?.message } });
      setSessions([]);
    }
  }

  function chooseConnector(nextConnectorId: string) {
    const connector = availableConnectors.find((item) => item.id === nextConnectorId);
    setConnectorId(nextConnectorId);
    setStartUrl(connector?.auth.startUrl ?? DEFAULT_URL);
    setProfileKey(profileKeyFor(connector));
    setAuthCheck(null);
    setSavedConnection(null);
    setLastRun(null);
  }

  async function startLogin() {
    setBusy(true);
    try {
      const path = selectedConnector ? `/connectors/${selectedConnector.id}/auth/start` : "/sessions/start-login";
      const payload = await apiFetch<{ data: StartLoginResponse }>(path, {
        method: "POST",
        body: JSON.stringify({
          societyId: society._id,
          profileKey,
          startUrl,
          liveView: true,
        }),
      });
      if (payload.data.dashboardUrl) setActiveDashboardUrl(payload.data.dashboardUrl);
      setProfileKey(payload.data.profileKey);
      toast.success("Browser session started", payload.data.currentUrl);
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not start browser session");
    } finally {
      setBusy(false);
    }
  }

  async function verifyAuth() {
    if (!selectedConnector) return;
    setBusy(true);
    try {
      const payload = await apiFetch<{ data: any }>(`/connectors/${selectedConnector.id}/auth/verify`, {
        method: "POST",
        body: JSON.stringify({
          societyId: society._id,
          profileKey,
        }),
      });
      setAuthCheck(payload.data);
      if (payload.data?.authenticated) {
        toast.success(`${selectedConnector.name} profile is authenticated`, payload.data?.currentUrl);
      } else {
        toast.error(`${selectedConnector.name} needs login`, payload.data?.currentUrl);
      }
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not verify connector login");
    } finally {
      setBusy(false);
    }
  }

  async function openPage() {
    setBusy(true);
    try {
      const payload = await apiFetch<{ data: any }>("/runs/open-page", {
        method: "POST",
        body: JSON.stringify({
          societyId: society._id,
          profileKey,
          url: startUrl,
          readOnly: false,
          includeBodyText: false,
        }),
      });
      setLastRun(payload.data);
      toast.success("Page opened", payload.data?.title ?? payload.data?.currentUrl);
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not run browser action");
    } finally {
      setBusy(false);
    }
  }

  async function pullWaveTransactions() {
    if (!businessId.trim() && !activeWaveSession) {
      toast.error("Wave business id is required");
      return;
    }
    setBusy(true);
    try {
      const path = activeWaveSession
        ? `/connectors/wave/auth/sessions/${activeWaveSession.sessionId}/actions/listTransactions`
        : "/connectors/wave/actions/listTransactions";
      const payload = await apiFetch<{ data: any }>(path, {
        method: "POST",
        body: JSON.stringify({
          societyId: society._id,
          profileKey,
          businessId: businessId.trim() || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          first: 100,
          sort: "DATE_DESC",
        }),
      });
      setLastRun(payload.data);
      toast.success("Wave transactions pulled", `${payload.data?.transactionCount ?? 0} transactions`);
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not pull Wave transactions");
    } finally {
      setBusy(false);
    }
  }

  async function importWaveTransactions() {
    if (!businessId.trim() && !activeWaveSession) {
      toast.error("Wave business id is required");
      return;
    }
    setBusy(true);
    try {
      const path = activeWaveSession
        ? `/connectors/wave/auth/sessions/${activeWaveSession.sessionId}/import-transactions`
        : "/connectors/wave/import-transactions";
      const payload = await apiFetch<{ data: any }>(path, {
        method: "POST",
        body: JSON.stringify({
          societyId: society._id,
          profileKey,
          businessId: businessId.trim() || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          first: 100,
          maxPages: 500,
          sort: "DATE_DESC",
        }),
      });
      setLastRun(payload.data);
      const imported = payload.data?.import;
      toast.success(
        "Wave data imported",
        `${imported?.transactions ?? payload.data?.transactionCount ?? 0} transactions across ${imported?.accounts ?? payload.data?.normalized?.accountCount ?? 0} accounts`,
      );
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not import Wave transactions");
    } finally {
      setBusy(false);
    }
  }

  async function finishSession(sessionId: string) {
    setBusy(true);
    try {
      await apiFetch<{ data: any }>(`/sessions/${sessionId}/finish-login`, {
        method: "POST",
        body: JSON.stringify({ societyId: society._id }),
      });
      toast.success("Login session saved");
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not finish session");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAndSaveSession(session: BrowserSession) {
    const sessionConnectorId = session.connectorId ?? connectorId;
    const sessionConnector = availableConnectors.find((connector) => connector.id === sessionConnectorId);
    setBusy(true);
    try {
      const payload = await apiFetch<{ data: any }>(`/connectors/${sessionConnectorId}/auth/sessions/${session.sessionId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ societyId: society._id }),
      });
      setAuthCheck(payload.data);
      setSavedConnection(payload.data);
      setProfileKey(payload.data.profileKey ?? session.profileKey);
      toast.success(`${sessionConnector?.name ?? "Connector"} profile saved`, payload.data.profileKey);
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Profile is not ready to save");
    } finally {
      setBusy(false);
    }
  }

  async function stopSession(sessionId: string) {
    setBusy(true);
    try {
      await apiFetch<{ data: any }>(`/sessions/${sessionId}/stop`, {
        method: "POST",
        body: JSON.stringify({ societyId: society._id }),
      });
      toast.success("Browser session stopped");
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not stop session");
    } finally {
      setBusy(false);
    }
  }

  async function pasteIntoSession(sessionId: string, text: string) {
    if (!text) {
      toast.error("Paste text is empty");
      return;
    }
    setBusy(true);
    try {
      const payload = await apiFetch<{ data: any }>(`/sessions/${sessionId}/paste`, {
        method: "POST",
        body: JSON.stringify({
          societyId: society._id,
          text,
        }),
      });
      setPasteText("");
      toast.success("Pasted into browser", `${payload.data?.insertedCharacterCount ?? text.length} characters`);
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not paste into browser");
    } finally {
      setBusy(false);
    }
  }

  async function pasteClipboardIntoSession(sessionId: string) {
    try {
      const text = await navigator.clipboard.readText();
      await pasteIntoSession(sessionId, text);
    } catch (error: any) {
      toast.error(error?.message ?? "Clipboard permission was not granted");
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Plugin connections"
        icon={<MonitorPlay size={16} />}
        iconColor="orange"
        subtitle="Authorize browser-backed utilities with a user-controlled session, then save the profile for plugin actions."
        actions={
          <>
            <button className="btn-action" disabled={busy} onClick={refresh}>
              <RefreshCw size={12} /> Refresh
            </button>
            <a className="btn-action" href={activeDashboardUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> Runtime console
            </a>
          </>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div className="panel" style={{ padding: 14 }}>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <PlugZap size={15} />
            <strong>1. Launch browser session</strong>
          </div>
          <div className="muted">Open {selectedConnector?.name ?? "the selected utility"} in an isolated browser profile owned by the runner.</div>
        </div>
        <div className="panel" style={{ padding: 14 }}>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <ShieldCheck size={15} />
            <strong>2. {selectedConfirmMode === "verified" ? "Confirm & save" : "Save profile"}</strong>
          </div>
          <div className="muted">
            {selectedConfirmMode === "verified"
              ? "After login, Societyer verifies the plugin session and closes the browser to persist the profile."
              : "Close the live browser from Societyer to persist the profile for later utility runs."}
          </div>
        </div>
        <div className="panel" style={{ padding: 14 }}>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <KeyRound size={15} />
            <strong>3. Run utility</strong>
          </div>
          <div className="muted">Connector actions and page utilities reuse the saved profile. Tokens stay inside the connector runner.</div>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Runner</h2>
            <span className="card__subtitle">Optional Docker profile: connectors</span>
          </div>
          <div className="card__body col" style={{ gap: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">Status</span>
              <Badge tone={runnerReady ? "success" : "danger"}>
                {runnerReady ? "Ready" : "Unavailable"}
              </Badge>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">Provider</span>
              <Badge tone="info">{health?.browser?.provider ?? "blitz"}</Badge>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">Active sessions</span>
              <span className="mono">{health?.activeSessions ?? sessions.length}</span>
            </div>
            {health?.browser?.detail && <div className="alert alert--danger">{health.browser.detail}</div>}
            <div className="muted">
              Start with <code className="mono">npm run docker:connectors</code> if the runner is unavailable.
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Plugin connection</h2>
            <span className="card__subtitle">{selectedConnector?.description ?? "Browser-backed utility profile."}</span>
          </div>
          <div className="card__body col" style={{ gap: 12 }}>
            <Field label="Service">
              <select className="input" value={connectorId} onChange={(event) => chooseConnector(event.target.value)}>
                {availableConnectors.map((connector) => (
                  <option key={connector.id} value={connector.id}>{connector.name}</option>
                ))}
              </select>
            </Field>
            {selectedConnector?.category && (
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted">Category</span>
                <Badge tone="info">{selectedConnector.category}</Badge>
              </div>
            )}
            <Field label="Profile key">
              <input className="input" value={profileKey} onChange={(event) => setProfileKey(event.target.value)} />
            </Field>
            <Field label="Start URL">
              <input className="input" value={startUrl} onChange={(event) => setStartUrl(event.target.value)} />
            </Field>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn--accent" disabled={busy || !runnerReady} onClick={startLogin}>
                <MonitorPlay size={14} /> Open {selectedConnector?.name ?? "plugin"} session
              </button>
              <button className="btn" disabled={busy || !runnerReady || !selectedConnector} onClick={verifyAuth}>
                <CheckCircle2 size={14} /> Check saved profile
              </button>
              <button className="btn" disabled={busy || !runnerReady} onClick={openPage}>
                <Play size={14} /> Debug open URL
              </button>
            </div>
            {selectedConnector && (
              <div className="muted">
                Allowed origins: {selectedConnector.auth.allowedOrigins.length ? selectedConnector.auth.allowedOrigins.join(", ") : "not restricted"}
              </div>
            )}
          </div>
        </div>
      </div>

      {connectorId !== "wave" && selectedConnector && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">{selectedConnector.utility?.title ?? `${selectedConnector.name} utility`}</h2>
            <span className="card__subtitle">{selectedConnector.utility?.description ?? selectedConnector.description}</span>
          </div>
          <div className="card__body col" style={{ gap: 12 }}>
            {savedConnection && (
              <div className="panel" style={{ padding: 12 }}>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <Badge tone="success">Saved profile</Badge>
                  <strong>{savedConnection.profileKey}</strong>
                </div>
                <div className="muted" style={{ marginTop: 4, overflowWrap: "anywhere" }}>
                  Saved {formatDateTime(savedConnection.savedAtISO)} from {savedConnection.finalUrl ?? savedConnection.currentUrl}
                </div>
              </div>
            )}
            {selectedConnector.utility?.steps?.length ? (
              <div className="grid two">
                {selectedConnector.utility.steps.map((step, index) => (
                  <div key={step} className="panel" style={{ padding: 12 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <Badge tone="gray">{index + 1}</Badge>
                      <span>{step}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {selectedConnector.actions.length > 0 && (
              <div className="col" style={{ gap: 8 }}>
                <div className="muted">Registered utility actions</div>
                {selectedConnector.actions.map((action) => (
                  <div key={action.id} className="panel" style={{ padding: 12 }}>
                    <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <strong>{action.name}</strong>
                      <span className="mono muted">{action.id}</span>
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>{action.description}</div>
                  </div>
                ))}
              </div>
            )}
            {authCheck && (
              <Badge tone={authCheck.authenticated === false ? "warn" : "success"}>
                {authCheck.authenticated === true
                  ? `${selectedConnector.name} authenticated`
                  : authCheck.authenticated === false
                  ? `${selectedConnector.name} login needed`
                  : `${selectedConnector.name} profile checked`}
              </Badge>
            )}
          </div>
        </div>
      )}

      {connectorId === "wave" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">Wave data import</h2>
            <span className="card__subtitle">Pull all available browser-session transactions and save them to Societyer accounts.</span>
          </div>
          <div className="card__body col" style={{ gap: 12 }}>
            {savedConnection && (
              <div className="panel" style={{ padding: 12 }}>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <Badge tone="success">Pipeline-ready profile</Badge>
                  <strong>{savedConnection.profileKey}</strong>
                </div>
                <div className="muted" style={{ marginTop: 4, overflowWrap: "anywhere" }}>
                  Saved {formatDateTime(savedConnection.savedAtISO)} from {savedConnection.finalUrl ?? savedConnection.currentUrl}
                </div>
              </div>
            )}
            {activeWaveSession && (
              <div className="panel" style={{ padding: 12 }}>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <Badge tone={activeWaveNeedsLogin ? "warn" : "success"}>
                    {activeWaveNeedsLogin ? "Wave login in progress" : "Active Wave session"}
                  </Badge>
                  <strong>{activeWaveSession.profileKey}</strong>
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  {activeWaveNeedsLogin
                    ? "Finish login in the live browser. Then pull and save while this session is active."
                    : "Business ID can be inferred from the active Wave dashboard URL. Import before confirming if Wave only exposes its bearer during the live session."}
                </div>
              </div>
            )}
            <Field label="Business ID">
              <input className="input" value={businessId} onChange={(event) => setBusinessId(event.target.value)} placeholder={activeWaveSession ? "Optional while Wave session is active" : "QnVzaW5lc3M6..."} />
            </Field>
            <div className="grid two">
              <Field label="Start date (optional)">
                <input className="input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </Field>
              <Field label="End date (optional)">
                <input className="input" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </Field>
            </div>
            <div className="muted">
              Leave dates blank to pull every transaction Wave returns for the active business. The import stores normalized account rows and transaction rows; raw bearer tokens stay inside the connector runner.
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn" disabled={busy || !runnerReady || connectorId !== "wave" || activeWaveNeedsLogin} onClick={pullWaveTransactions}>
                <Play size={14} /> Preview pull
              </button>
              <button className="btn btn--accent" disabled={busy || !runnerReady || connectorId !== "wave" || activeWaveNeedsLogin} onClick={importWaveTransactions}>
                <Play size={14} /> Pull all & save
              </button>
              {authCheck && (
                <Badge tone={authCheck.authenticated ? "success" : "warn"}>
                  {authCheck.authenticated ? "Wave authenticated" : "Wave login needed"}
                </Badge>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Active sessions</h2>
          <span className="card__subtitle">Save or verify browser sessions for later connector runs.</span>
        </div>
        <div className="card__body col" style={{ gap: 8 }}>
          {sessions.length === 0 && <div className="muted">No active browser sessions.</div>}
          {activeSession && (
            <div className="panel" style={{ padding: 12 }}>
              <Field label="Paste bridge">
                <textarea
                  className="input"
                  value={pasteText}
                  onChange={(event) => setPasteText(event.target.value)}
                  placeholder="Paste text here"
                  rows={3}
                  style={{ resize: "vertical" }}
                />
              </Field>
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button className="btn btn--sm" disabled={busy || !pasteText} onClick={() => pasteIntoSession(activeSession.sessionId, pasteText)}>
                  <ClipboardPaste size={12} /> Paste to browser
                </button>
                <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => pasteClipboardIntoSession(activeSession.sessionId)}>
                  <ClipboardPaste size={12} /> Read clipboard & paste
                </button>
              </div>
            </div>
          )}
          {sessions.map((session) => {
            const sessionConnector = availableConnectors.find((connector) => connector.id === session.connectorId);
            const sessionConfirmMode = confirmModeFor(sessionConnector);
            return (
            <div key={session.sessionId} className="panel" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 520px", minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                    <Badge tone="success">Running</Badge>
                    {sessionConnector && <Badge tone="info">{sessionConnector.name}</Badge>}
                    <strong>{session.profileKey}</strong>
                  </div>
                  <div className="muted mono" style={{ fontSize: "var(--fs-sm)", overflowWrap: "anywhere" }}>{session.sessionId}</div>
                  <div className="muted" style={{ marginTop: 4, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                    {session.currentUrl} · started {formatDateTime(session.startedAtISO)}
                  </div>
                </div>
                <div className="row" style={{ gap: 8, flex: "0 0 auto", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {session.connectorId && (
                    <button className="btn btn--accent btn--sm" disabled={busy} onClick={() => confirmAndSaveSession(session)}>
                      <ShieldCheck size={12} /> {sessionConfirmMode === "verified" ? "Confirm & save" : "Save profile"}
                    </button>
                  )}
                  {!session.connectorId && (
                    <button className="btn btn--sm" disabled={busy} onClick={() => finishSession(session.sessionId)}>
                      <CheckCircle2 size={12} /> Finish
                    </button>
                  )}
                  <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => stopSession(session.sessionId)}>
                    <Square size={12} /> Stop
                  </button>
                </div>
              </div>
            </div>
            );
          })}
          {lastRun && (
            <div className="panel" style={{ padding: 12 }}>
              <div className="row" style={{ gap: 8 }}>
                <CheckCircle2 size={14} />
                <strong>Last run</strong>
              </div>
              <div className="muted">
                {lastRun.import
                  ? `${lastRun.import.transactions} imported transactions across ${lastRun.import.accounts} account(s)`
                  : lastRun.transactionCount != null
                  ? `${lastRun.transactionCount} transactions across ${lastRun.pageCount} page(s)`
                  : lastRun.title ?? lastRun.currentUrl}
              </div>
              {lastRun.normalized?.transactionsByAccount?.length > 0 && (
                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {lastRun.normalized.transactionsByAccount.slice(0, 5).map((row: any) => (
                    <span key={row.accountExternalId} className="pill pill--sm">
                      {row.accountName}: {row.transactionCount}
                    </span>
                  ))}
                </div>
              )}
              <div className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>{lastRun.runId}</div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Runtime console</h2>
          <span className="card__subtitle">Infrastructure view for opening the live browser when a login session is active.</span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {runnerReady ? (
            activeSession?.vncWebSocketUrl ? (
              <LiveBrowserView
                sessionId={activeSession.sessionId}
                webSocketUrl={activeSession.vncWebSocketUrl}
                onPasteText={(text) => pasteIntoSession(activeSession.sessionId, text)}
              />
            ) : (
              <iframe
                title="BlitzBrowser dashboard"
                src={liveViewUrl}
                style={{
                  width: "100%",
                  height: 720,
                  border: 0,
                  display: "block",
                  background: "var(--bg-surface)",
                }}
              />
            )
          ) : (
            <div className="empty-state empty-state--start" style={{ padding: 24 }}>
              <XCircle size={18} />
              <div className="empty-state__title">Connector runner unavailable</div>
              <div className="empty-state__description">Start the optional connector stack, then refresh this page.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
