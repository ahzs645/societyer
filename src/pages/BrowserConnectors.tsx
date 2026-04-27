import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardPaste, ExternalLink, MonitorPlay, Play, RefreshCw, ShieldCheck, Square, Upload, XCircle } from "lucide-react";
import { SeedPrompt } from "./_helpers";
import { Badge, Button, Field, SettingsShell } from "../components/ui";
import { LiveBrowserView } from "../components/LiveBrowserView";
import { useSociety } from "../hooks/useSociety";
import { useToast } from "../components/Toast";
import { formatDateTime } from "../lib/format";
import { readGcosExportFile } from "../lib/gcosExportImport";

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
  browserDefaults?: {
    timezone?: string;
    locale?: string;
    viewport?: { width: number; height: number };
    browserVersion?: string;
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
      description: "Run a live BC Registry page utility on a society filing-history page.",
      steps: [
        "Open BC Registry in the live browser and navigate to the target society filing history.",
        "Run the filing-history export while the live browser is still signed in.",
        "Save or stop the browser after export; closed BC Registry profiles can require a fresh login.",
      ],
    },
  },
  {
    id: "gcos",
    name: "GCOS",
    category: "Government funding",
    description: "User-authorized Grants and Contributions Online Services project snapshot exports.",
    auth: {
      startUrl: "https://www.canada.ca/en/employment-social-development/services/funding/gcos.html",
      allowedOrigins: ["https://www.canada.ca", "https://srv136.services.gc.ca"],
      profileKeyPrefix: "gcos",
      confirmMode: "profile",
    },
    browserDefaults: {
      timezone: "America/Vancouver",
      locale: "en-CA",
      viewport: { width: 1440, height: 900 },
    },
    actions: [
      {
        id: "exportProjects",
        name: "Export projects",
        description: "Read the GCOS Applications and Projects page and return project cards, statuses, and action URLs.",
      },
      {
        id: "exportProjectSnapshot",
        name: "Export project snapshot",
        description: "Read a selected GCOS project, including summary, approved values, agreement metadata, and correspondence.",
      },
    ],
    utility: {
      title: "GCOS grant import",
      description: "Collect ESDC/GCOS project records from the signed-in browser without submitting forms.",
      steps: [
        "Open GCOS in the live browser and finish GCKey or Sign-In Partner login.",
        "Run Project list to confirm the Applications and Projects page is available.",
        "Run Project snapshot for a selected project while the live browser remains signed in.",
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

function mergeConnectorManifests(remoteConnectors: ConnectorManifest[]) {
  const byId = new Map(FALLBACK_CONNECTORS.map((connector) => [connector.id, connector]));
  for (const connector of remoteConnectors) {
    const fallback = byId.get(connector.id);
    byId.set(connector.id, {
      ...fallback,
      ...connector,
      auth: {
        ...(fallback?.auth ?? { startUrl: connector.auth.startUrl, allowedOrigins: [] }),
        ...connector.auth,
      },
      actions: connector.actions?.length ? connector.actions : fallback?.actions ?? [],
      utility: connector.utility ?? fallback?.utility,
    });
  }
  return [...byId.values()];
}

function connectorForSession(session: BrowserSession, availableConnectors: ConnectorManifest[]) {
  return availableConnectors.find((connector) => connector.id === session.connectorId)
    ?? availableConnectors.find((connector) => {
      const prefix = connector.auth.profileKeyPrefix ?? connector.id;
      return session.profileKey.startsWith(`${prefix}-`);
    });
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
  const [bcRegistryCorpNum, setBcRegistryCorpNum] = useState("S0048345");
  const [gcosProjectId, setGcosProjectId] = useState("");
  const [gcosProgramCode, setGcosProgramCode] = useState("");
  const [gcosIncludeAgreementPdfs, setGcosIncludeAgreementPdfs] = useState(true);
  const [gcosExportJson, setGcosExportJson] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [workspaceConnectorId, setWorkspaceConnectorId] = useState<string | null>(null);

  const availableConnectors = mergeConnectorManifests(connectors);
  const workspaceConnector = workspaceConnectorId
    ? availableConnectors.find((connector) => connector.id === workspaceConnectorId) ?? null
    : null;
  const activeSession = sessions[0] ?? null;
  const selectedConnector = workspaceConnector ?? availableConnectors.find((connector) => connector.id === connectorId) ?? availableConnectors[0];
  const selectedConnectorRegistered = selectedConnector ? connectorRegistered(selectedConnector) : false;
  const runnerReady = Boolean(health?.ok && health.browser?.ok);
  const liveSession = workspaceConnector ? sessionForConnector(workspaceConnector) : activeSession;
  const visibleSessions = workspaceConnector
    ? sessions.filter((session) => connectorForSession(session, availableConnectors)?.id === workspaceConnector.id)
    : sessions;
  const liveViewUrl = useMemo(() => {
    if (!liveSession?.dashboardUrl) return activeDashboardUrl;
    return liveSession.dashboardUrl;
  }, [activeDashboardUrl, liveSession?.dashboardUrl]);
  const connectorPanelRenderers: Record<string, () => JSX.Element> = {
    wave: renderWaveProviderPanel,
    "bc-registry": renderBcRegistryProviderPanel,
    gcos: renderGcosProviderPanel,
  };
  const connectorPanelPolicy: Record<string, { hideGenericUtilities?: boolean }> = {
    wave: { hideGenericUtilities: true },
  };
  const providerPanel = selectedConnector ? connectorPanelRenderers[selectedConnector.id]?.() ?? null : null;
  const showGenericUtilities = Boolean(selectedConnector && !connectorPanelPolicy[selectedConnector.id]?.hideGenericUtilities);

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

  function connectorRegistered(connector: ConnectorManifest) {
    return connectors.some((item) => item.id === connector.id);
  }

  function sessionForConnector(connector: ConnectorManifest) {
    return sessions.find((session) => connectorForSession(session, availableConnectors)?.id === connector.id) ?? null;
  }

  function sessionForConnectorId(nextConnectorId: string) {
    return sessions.find((session) => connectorForSession(session, availableConnectors)?.id === nextConnectorId) ?? null;
  }

  function connectorActionPath(input: {
    connectorId: string;
    actionId: string;
    session?: BrowserSession | null;
    importAlias?: string;
  }) {
    const connector = encodeURIComponent(input.connectorId);
    const action = encodeURIComponent(input.actionId);
    if (input.session) {
      const sessionId = encodeURIComponent(input.session.sessionId);
      return input.importAlias
        ? `/connectors/${connector}/auth/sessions/${sessionId}/${input.importAlias}`
        : `/connectors/${connector}/auth/sessions/${sessionId}/actions/${action}`;
    }
    return input.importAlias
      ? `/connectors/${connector}/${input.importAlias}`
      : `/connectors/${connector}/actions/${action}`;
  }

  function profileKeyForWorkspace(connector: ConnectorManifest) {
    return sessionForConnector(connector)?.profileKey ?? profileKeyFor(connector);
  }

  function openWorkspace(nextConnectorId: string) {
    const connector = availableConnectors.find((item) => item.id === nextConnectorId);
    setWorkspaceConnectorId(nextConnectorId);
    setConnectorId(nextConnectorId);
    setStartUrl(connector?.auth.startUrl ?? DEFAULT_URL);
    setProfileKey(connector ? profileKeyForWorkspace(connector) : `${nextConnectorId}-local-demo`);
    setAuthCheck(null);
    setSavedConnection(null);
    setLastRun(null);
  }

  function backToApps() {
    setWorkspaceConnectorId(null);
    setAuthCheck(null);
    setSavedConnection(null);
    setLastRun(null);
  }

  async function startLoginFor(connector: ConnectorManifest | undefined, nextProfileKey: string, nextStartUrl: string) {
    setBusy(true);
    try {
      const path = connector && connectorRegistered(connector) ? `/connectors/${connector.id}/auth/start` : "/sessions/start-login";
      const payload = await apiFetch<{ data: StartLoginResponse }>(path, {
        method: "POST",
        body: JSON.stringify({
          societyId: society._id,
          profileKey: nextProfileKey,
          startUrl: nextStartUrl,
          liveView: true,
          timezone: connector?.browserDefaults?.timezone,
          locale: connector?.browserDefaults?.locale,
          viewport: connector?.browserDefaults?.viewport,
          browserVersion: connector?.browserDefaults?.browserVersion,
        }),
      });
      if (payload.data.dashboardUrl) setActiveDashboardUrl(payload.data.dashboardUrl);
      setProfileKey(payload.data.profileKey);
      toast.success("Browser app session started", payload.data.currentUrl);
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not start browser session");
    } finally {
      setBusy(false);
    }
  }

  async function startLogin() {
    await startLoginFor(selectedConnector, profileKey, startUrl);
  }

  async function launchApp(nextConnectorId: string) {
    const connector = availableConnectors.find((item) => item.id === nextConnectorId);
    const nextProfileKey = connector ? profileKeyForWorkspace(connector) : `${nextConnectorId}-local-demo`;
    const nextStartUrl = connector?.auth.startUrl ?? DEFAULT_URL;
    setWorkspaceConnectorId(nextConnectorId);
    setConnectorId(nextConnectorId);
    setProfileKey(nextProfileKey);
    setStartUrl(nextStartUrl);
    await startLoginFor(connector, nextProfileKey, nextStartUrl);
  }

  async function verifyAuth() {
    if (!selectedConnector) return;
    setBusy(true);
    try {
      const path = selectedConnectorRegistered ? `/connectors/${selectedConnector.id}/auth/verify` : "/profiles/validate";
      const payload = await apiFetch<{ data: any }>(path, {
        method: "POST",
        body: JSON.stringify({
          societyId: society._id,
          profileKey,
          url: startUrl,
        }),
      });
      setAuthCheck(payload.data);
      if (payload.data?.authenticated) {
        toast.success(`${selectedConnector.name} profile is authenticated`, payload.data?.currentUrl);
      } else if (payload.data?.authenticated === false) {
        toast.error(`${selectedConnector.name} needs login`, payload.data?.currentUrl);
      } else {
        toast.success(`${selectedConnector.name} profile checked`, payload.data?.currentUrl);
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
    const waveSession = sessionForConnectorId("wave");
    if (!businessId.trim() && !waveSession) {
      toast.error("Wave business id is required");
      return;
    }
    setBusy(true);
    try {
      const path = connectorActionPath({
        connectorId: "wave",
        actionId: "listTransactions",
        session: waveSession,
      });
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
    const waveSession = sessionForConnectorId("wave");
    if (!businessId.trim() && !waveSession) {
      toast.error("Wave business id is required");
      return;
    }
    setBusy(true);
    try {
      const path = connectorActionPath({
        connectorId: "wave",
        actionId: "importTransactions",
        session: waveSession,
        importAlias: "import-transactions",
      });
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

  async function scanBcRegistryFilingHistory() {
    const bcRegistrySession = sessionForConnectorId("bc-registry");
    setBusy(true);
    try {
      const path = connectorActionPath({
        connectorId: "bc-registry",
        actionId: "filingHistoryExport",
        session: bcRegistrySession,
      });
      const payload = await apiFetch<{ data: any }>(path, {
        method: "POST",
        body: JSON.stringify({
          societyId: society._id,
          profileKey,
          corpNum: bcRegistryCorpNum.trim() || undefined,
          includePdfProbe: true,
          downloadPdfs: true,
        }),
      });
      setLastRun(payload.data);
      toast.success(
        "BC Registry filing export complete",
        `${payload.data?.filingCount ?? 0} filings, ${payload.data?.download?.downloadedCount ?? 0} PDF(s) saved`,
      );
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not scan BC Registry filing history");
    } finally {
      setBusy(false);
    }
  }

  async function exportGcosProjects() {
    const gcosSession = sessionForConnectorId("gcos");
    setBusy(true);
    try {
      const path = connectorActionPath({
        connectorId: "gcos",
        actionId: "exportProjects",
        session: gcosSession,
      });
      const payload = await apiFetch<{ data: any }>(path, {
        method: "POST",
        body: JSON.stringify({
          societyId: society._id,
          profileKey,
          pageSize: 0,
          maxPages: 10,
        }),
      });
      setLastRun(payload.data);
      const firstProjectId = payload.data?.projects?.[0]?.projectId;
      if (!gcosProjectId && firstProjectId) setGcosProjectId(firstProjectId);
      toast.success("GCOS projects exported", `${payload.data?.projectCount ?? 0} project(s) found`);
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not export GCOS projects");
    } finally {
      setBusy(false);
    }
  }

  async function exportGcosProjectSnapshot() {
    const gcosSession = sessionForConnectorId("gcos");
    setBusy(true);
    try {
      const path = connectorActionPath({
        connectorId: "gcos",
        actionId: "exportProjectSnapshot",
        session: gcosSession,
      });
      const payload = await apiFetch<{ data: any }>(path, {
        method: "POST",
        body: JSON.stringify({
          societyId: society._id,
          profileKey,
          projectId: gcosProjectId.trim() || undefined,
          programCode: gcosProgramCode.trim() || undefined,
          includeAgreementPdfs: gcosIncludeAgreementPdfs,
        }),
      });
      setLastRun(payload.data);
      const normalized = payload.data?.normalizedGrant;
      toast.success(
        "GCOS project snapshot exported",
        normalized?.title ?? `${payload.data?.agreement?.agreementLinks?.length ?? 0} agreement link(s), ${payload.data?.correspondence?.viewLinks?.length ?? 0} correspondence item(s)`,
      );
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not export GCOS project snapshot");
    } finally {
      setBusy(false);
    }
  }

  async function importGcosProjectSnapshot() {
    const gcosSession = sessionForConnectorId("gcos");
    setBusy(true);
    try {
      const path = connectorActionPath({
        connectorId: "gcos",
        actionId: "exportProjectSnapshot",
        session: gcosSession,
        importAlias: "import-project-snapshot",
      });
      const payload = await apiFetch<{ data: any }>(path, {
        method: "POST",
        body: JSON.stringify({
          societyId: society._id,
          profileKey,
          projectId: gcosProjectId.trim() || undefined,
          programCode: gcosProgramCode.trim() || undefined,
          includeAgreementPdfs: gcosIncludeAgreementPdfs,
        }),
      });
      setLastRun(payload.data);
      const imported = payload.data?.import;
      toast.success(
        imported?.created ? "GCOS grant imported" : "GCOS grant updated",
        payload.data?.normalizedGrant?.title ?? imported?.grantId,
      );
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not import GCOS project snapshot");
    } finally {
      setBusy(false);
    }
  }

  async function importGcosExportedSnapshot(jsonText = gcosExportJson) {
    if (!jsonText.trim()) {
      toast.error("Paste GCOS export JSON first");
      return;
    }
    setBusy(true);
    try {
      const parsed = JSON.parse(jsonText);
      const snapshot = parsed?.snapshot ?? parsed;
      const payload = await apiFetch<{ data: any }>("/connectors/gcos/import-exported-snapshot", {
        method: "POST",
        body: JSON.stringify({
          societyId: society._id,
          snapshot,
          normalizedGrant: parsed?.normalizedGrant,
        }),
      });
      setLastRun(payload.data);
      const imported = payload.data?.import;
      toast.success(
        imported?.created ? "GCOS grant imported" : "GCOS grant updated",
        payload.data?.normalizedGrant?.title ?? imported?.grantId,
      );
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not import GCOS export JSON");
    } finally {
      setBusy(false);
    }
  }

  async function importGcosExportFile(file: File | undefined) {
    if (!file) return;
    try {
      const text = await readGcosExportFile(file);
      setGcosExportJson(text);
      await importGcosExportedSnapshot(text);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not read GCOS export file");
    }
  }

  async function finishSession(sessionId: string) {
    setBusy(true);
    try {
      await apiFetch<{ data: any }>(`/sessions/${sessionId}/finish-login`, {
        method: "POST",
        body: JSON.stringify({ societyId: society._id }),
      });
      toast.success("Browser profile saved");
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

  function renderGenericUtilityPanel() {
    if (!selectedConnector) return null;
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">{selectedConnector.utility?.title ?? `${selectedConnector.name} utilities`}</h2>
          <span className="card__subtitle">{selectedConnector.utility?.description ?? selectedConnector.description}</span>
        </div>
        <div className="card__body col" style={{ gap: 12 }}>
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
              <div className="muted">Available actions</div>
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
        </div>
      </div>
    );
  }

  function renderBcRegistryProviderPanel() {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">BC Registry filing export</h2>
          <span className="card__subtitle">Collect filing-history rows, write a CSV, and fetch digital PDFs through the signed-in browser.</span>
        </div>
        <div className="card__body col" style={{ gap: 12 }}>
          <div className="grid two">
            <Field label="Society number">
              <input
                className="input"
                value={bcRegistryCorpNum}
                onChange={(event) => setBcRegistryCorpNum(event.target.value)}
                placeholder="S0048345"
              />
            </Field>
            <div className="field">
              <label className="field__label">Mode</label>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <Badge tone={liveSession ? "success" : "warn"}>{liveSession ? "Live session" : "Saved profile"}</Badge>
                <Badge tone="info">CSV + PDFs</Badge>
                <Badge tone="gray">Paper rows kept</Badge>
              </div>
            </div>
          </div>
          <div className="muted">
            Run this while the BC Registry live browser is signed in on a society filing-history page. The runner executes a page utility, preserves paper-only rows in the CSV, and logs each PDF download result.
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn--accent" disabled={busy || !runnerReady} onClick={scanBcRegistryFilingHistory}>
              <Play size={14} /> Export filings & PDFs
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderGcosProviderPanel() {
    const gcosSession = sessionForConnectorId("gcos");
    const gcosNeedsLogin = Boolean(gcosSession && /gckey|sign-?in|login|credential|bank/i.test(gcosSession.currentUrl));
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">GCOS grant import</h2>
          <span className="card__subtitle">Export project records, agreement metadata, PDFs, and correspondence through the signed-in browser.</span>
        </div>
        <div className="card__body col" style={{ gap: 12 }}>
          {gcosSession && (
            <div className="panel" style={{ padding: 12 }}>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <Badge tone={gcosNeedsLogin ? "warn" : "success"}>
                  {gcosNeedsLogin ? "GCOS login in progress" : "Active GCOS session"}
                </Badge>
                <strong>{gcosSession.profileKey}</strong>
              </div>
              <div className="muted" style={{ marginTop: 4, overflowWrap: "anywhere" }}>
                {gcosNeedsLogin
                  ? "Finish login in the live browser, then run the project export while the session is still active."
                  : gcosSession.currentUrl}
              </div>
            </div>
          )}
          <div className="grid two">
            <Field label="Project ID" hint="Optional if the live browser is already on a project page.">
              <input
                className="input"
                value={gcosProjectId}
                onChange={(event) => setGcosProjectId(event.target.value)}
                placeholder="1539280"
              />
            </Field>
            <Field label="Program code" hint="Optional; CSJ is Canada Summer Jobs.">
              <input
                className="input"
                value={gcosProgramCode}
                onChange={(event) => setGcosProgramCode(event.target.value)}
                placeholder="CSJ"
              />
            </Field>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={gcosIncludeAgreementPdfs}
              onChange={(event) => setGcosIncludeAgreementPdfs(event.target.checked)}
            />
            Download agreement PDFs into the connector export folder
          </label>
          <div className="muted">
            This action is read-only. It redacts sensitive employee and banking fields and does not submit EEDs, claims, direct deposit, or signatures.
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn" disabled={busy || !runnerReady || gcosNeedsLogin} onClick={exportGcosProjects}>
              <Play size={14} /> Project list
            </button>
            <button className="btn" disabled={busy || !runnerReady || gcosNeedsLogin} onClick={exportGcosProjectSnapshot}>
              <Play size={14} /> Preview snapshot
            </button>
            <button className="btn btn--accent" disabled={busy || !runnerReady || gcosNeedsLogin} onClick={importGcosProjectSnapshot}>
              <Play size={14} /> Import grant
            </button>
          </div>
          <div className="panel col" style={{ gap: 10, padding: 12 }}>
            <div>
              <strong>Local Chrome extension fallback</strong>
              <div className="muted" style={{ marginTop: 4 }}>
                Load the unpacked extension from <code className="mono">extensions/gcos-exporter</code>, export JSON from your normal logged-in GCOS tab, then import it here.
              </div>
            </div>
            <Field label="GCOS export JSON" hint="Paste the Chrome extension output, or choose its downloaded JSON/ZIP file.">
              <textarea
                className="input"
                value={gcosExportJson}
                onChange={(event) => setGcosExportJson(event.target.value)}
                placeholder='{"source":"societyer-gcos-chrome-extension", ...}'
                rows={5}
                style={{ resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}
              />
            </Field>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <label className="btn btn--sm" style={{ cursor: busy ? "not-allowed" : "pointer" }}>
                <Upload size={12} /> Choose JSON/ZIP
                <input
                  type="file"
                  accept="application/json,application/zip,.json,.zip"
                  disabled={busy}
                  onChange={(event) => {
                    void importGcosExportFile(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                  style={{ display: "none" }}
                />
              </label>
              <button className="btn btn--accent btn--sm" disabled={busy || !gcosExportJson.trim()} onClick={() => importGcosExportedSnapshot()}>
                <Upload size={12} /> Import extension JSON
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderWaveProviderPanel() {
    const waveSession = sessionForConnectorId("wave");
    const waveNeedsLogin = Boolean(waveSession && /auth\.waveapps\.com|\/login|identifier/i.test(waveSession.currentUrl));

    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Wave transactions</h2>
          <span className="card__subtitle">Preview or import transactions through the active Wave browser profile.</span>
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
          {waveSession && (
            <div className="panel" style={{ padding: 12 }}>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <Badge tone={waveNeedsLogin ? "warn" : "success"}>
                  {waveNeedsLogin ? "Wave login in progress" : "Active Wave session"}
                </Badge>
                <strong>{waveSession.profileKey}</strong>
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                {waveNeedsLogin
                  ? "Finish login in the live browser. Then pull and save while this session is active."
                  : "Business ID can be inferred from the active Wave dashboard URL. Import before confirming if Wave only exposes its bearer during the live session."}
              </div>
            </div>
          )}
          <Field label="Business ID">
            <input className="input" value={businessId} onChange={(event) => setBusinessId(event.target.value)} placeholder={waveSession ? "Optional while Wave session is active" : "QnVzaW5lc3M6..."} />
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
            Leave dates blank to pull every transaction Wave returns for the active business. Raw bearer tokens stay inside the connector runner.
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn" disabled={busy || !runnerReady || waveNeedsLogin} onClick={pullWaveTransactions}>
              <Play size={14} /> Preview pull
            </button>
            <button className="btn btn--accent" disabled={busy || !runnerReady || waveNeedsLogin} onClick={importWaveTransactions}>
              <Play size={14} /> Pull all & save
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <SettingsShell
        title={workspaceConnector ? workspaceConnector.name : "Browser apps"}
        description={workspaceConnector
          ? `Live browser workspace for ${workspaceConnector.name}.`
          : "Open an installed browser app for imports, downloads, and page utilities."}
        tabs={[
          { id: "apps", label: "Apps", icon: <MonitorPlay size={14} /> },
          { id: "runtime", label: "Runtime" },
          { id: "sessions", label: "Sessions" },
        ]}
        activeTab={workspaceConnector ? "sessions" : "apps"}
        actions={
          <>
            {workspaceConnector && (
              <Button size="sm" disabled={busy} onClick={backToApps}>
                <ArrowLeft size={12} /> Apps
              </Button>
            )}
            <Button size="sm" disabled={busy} onClick={refresh}>
              <RefreshCw size={12} /> Refresh
            </Button>
            <a className="btn btn--sm" href={activeDashboardUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> Open runtime
            </a>
          </>
        }
      >

      {!workspaceConnector && (
        <>
          <div className="card__head" style={{ marginBottom: 8 }}>
            <h2 className="card__title">Installed apps</h2>
            <span className="card__subtitle">Choose an app to open its live browser workspace.</span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            {availableConnectors.map((connector) => {
              const appSession = sessionForConnector(connector);
              const isRegistered = connectorRegistered(connector);
              return (
                <div key={connector.id} className="card">
                  <div className="card__head">
                    <h2 className="card__title">{connector.name}</h2>
                    <span className="card__subtitle">{connector.category ?? "Browser app"}</span>
                  </div>
                  <div className="card__body col" style={{ gap: 12 }}>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      {appSession && <Badge tone="success">Running</Badge>}
                      {!isRegistered && <Badge tone="gray">Template</Badge>}
                      {isRegistered && !appSession && <Badge tone="info">Installed</Badge>}
                    </div>
                    <div className="muted">{connector.description}</div>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <button className="btn btn--accent btn--sm" disabled={busy} onClick={() => openWorkspace(connector.id)}>
                        <MonitorPlay size={12} /> Open workspace
                      </button>
                      <button className="btn btn--sm" disabled={busy || !runnerReady} onClick={() => launchApp(connector.id)}>
                        <Play size={12} /> Launch browser
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Browser runtime</h2>
              <span className="card__subtitle">Local runner status and active app sessions.</span>
            </div>
            <div className="card__body col" style={{ gap: 12 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted">Status</span>
                <Badge tone={runnerReady ? "success" : "danger"}>{runnerReady ? "Ready" : "Unavailable"}</Badge>
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
        </>
      )}

      {workspaceConnector && selectedConnector && (
        <>
          <div className="grid two" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">App details</h2>
                <span className="card__subtitle">{selectedConnector.description}</span>
              </div>
              <div className="card__body col" style={{ gap: 12 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span className="muted">App type</span>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {selectedConnector.category && <Badge tone="info">{selectedConnector.category}</Badge>}
                    {liveSession && <Badge tone="success">Running</Badge>}
                    {!selectedConnectorRegistered && <Badge tone="gray">Template</Badge>}
                  </div>
                </div>
                {!selectedConnectorRegistered && (
                  <div className="muted">
                    This app can use the generic browser session flow. Restart the connector runner to expose its named connector actions.
                  </div>
                )}
                <Field label="Browser profile">
                  <input className="input" value={profileKey} onChange={(event) => setProfileKey(event.target.value)} />
                </Field>
                <Field label="Launch URL">
                  <input className="input" value={startUrl} onChange={(event) => setStartUrl(event.target.value)} />
                </Field>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn--accent" disabled={busy || !runnerReady} onClick={startLogin}>
                    <MonitorPlay size={14} /> Launch browser
                  </button>
                  <button className="btn" disabled={busy || !runnerReady} onClick={verifyAuth}>
                    <CheckCircle2 size={14} /> Check profile
                  </button>
                  <button className="btn" disabled={busy || !runnerReady} onClick={openPage}>
                    <Play size={14} /> Open URL
                  </button>
                </div>
                <div className="muted">
                  Trusted origins: {selectedConnector.auth.allowedOrigins.length ? selectedConnector.auth.allowedOrigins.join(", ") : "not restricted"}
                </div>
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

            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Live browser</h2>
                <span className="card__subtitle">{liveSession ? "Interactive browser for this app." : "No active browser for this app."}</span>
              </div>
              <div className="card__body" style={{ padding: 0 }}>
                {runnerReady ? (
                  liveSession?.vncWebSocketUrl ? (
                    <LiveBrowserView
                      sessionId={liveSession.sessionId}
                      webSocketUrl={liveSession.vncWebSocketUrl}
                      onPasteText={(text) => pasteIntoSession(liveSession.sessionId, text)}
                    />
                  ) : liveSession ? (
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
                  ) : (
                    <div className="empty-state empty-state--start" style={{ padding: 24 }}>
                      <MonitorPlay size={18} />
                      <div className="empty-state__title">No live browser open</div>
                      <div className="empty-state__description">Launch this app to sign in, inspect pages, or run utilities.</div>
                      <button className="btn btn--accent" disabled={busy} onClick={startLogin}>
                        <MonitorPlay size={14} /> Launch browser
                      </button>
                    </div>
                  )
                ) : (
                  <div className="empty-state empty-state--start" style={{ padding: 24 }}>
                    <XCircle size={18} />
                    <div className="empty-state__title">Browser runtime unavailable</div>
                    <div className="empty-state__description">Start the optional connector stack, then refresh this page.</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {providerPanel}
          {showGenericUtilities && renderGenericUtilityPanel()}

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Sessions</h2>
              <span className="card__subtitle">Live browser sessions for {selectedConnector.name}.</span>
            </div>
            <div className="card__body col" style={{ gap: 8 }}>
              {visibleSessions.length === 0 && <div className="muted">No active browser sessions for this app.</div>}
              {liveSession && (
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
                    <button className="btn btn--sm" disabled={busy || !pasteText} onClick={() => pasteIntoSession(liveSession.sessionId, pasteText)}>
                      <ClipboardPaste size={12} /> Paste to browser
                    </button>
                    <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => pasteClipboardIntoSession(liveSession.sessionId)}>
                      <ClipboardPaste size={12} /> Read clipboard & paste
                    </button>
                  </div>
                </div>
              )}
              {visibleSessions.map((session) => {
                const sessionConnector = connectorForSession(session, availableConnectors);
                const sessionConfirmMode = confirmModeFor(sessionConnector);
                return (
                  <div key={session.sessionId} className="panel" style={{ padding: 12 }}>
                    <div className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                        <div className="row" style={{ gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                          <Badge tone="success">Running</Badge>
                          {sessionConnector && <Badge tone="info">{sessionConnector.name}</Badge>}
                          <strong>Active browser session</strong>
                        </div>
                        <div className="muted mono" style={{ fontSize: "var(--fs-sm)", overflowWrap: "anywhere" }}>{session.sessionId}</div>
                        <div className="muted" style={{ marginTop: 4, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                          Started {formatDateTime(session.startedAtISO)}
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
                            <CheckCircle2 size={12} /> Save profile
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
                      : lastRun.filingCount != null
                      ? `${lastRun.filingCount} filings, ${lastRun.documentCount ?? 0} digital document(s), ${lastRun.paperOnlyCount ?? 0} paper-only row(s)`
                      : lastRun.transactionCount != null
                      ? `${lastRun.transactionCount} transactions across ${lastRun.pageCount} page(s)`
                      : lastRun.title ?? lastRun.currentUrl}
                  </div>
                  {lastRun.pdfProbe && (
                    <div className="muted" style={{ marginTop: 6 }}>
                      Sample PDF check: {lastRun.pdfProbe.startsWithPdf ? "valid PDF" : "not a PDF"} ({lastRun.pdfProbe.contentType ?? "unknown type"})
                    </div>
                  )}
                  {lastRun.download && (
                    <div className="muted" style={{ marginTop: 6 }}>
                      Saved {lastRun.download.downloadedCount ?? 0} PDF(s), {lastRun.download.failedCount ?? 0} failure(s)
                      {lastRun.download.exportPublicDirectory ? ` in ${lastRun.download.exportPublicDirectory}` : ""}.
                    </div>
                  )}
                  {lastRun.resultLog?.length > 0 && (
                    <div className="muted" style={{ marginTop: 6 }}>
                      Log: {lastRun.resultLog.map((entry: any) => `${entry.step ?? entry.level}: ${entry.message}`).join(" · ")}
                    </div>
                  )}
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
        </>
      )}
      </SettingsShell>
    </div>
  );
}
