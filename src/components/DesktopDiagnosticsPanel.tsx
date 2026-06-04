import { useEffect, useMemo, useState } from "react";
import { Database, Download, FileText, FolderOpen, HardDrive, KeyRound, PlugZap, RefreshCw } from "lucide-react";

import {
  getDesktopBridge,
  isDesktopBridgeAvailable,
  type DesktopAppInfo,
  type DesktopConnectorHealth,
  type DesktopManagedServiceStatus,
  type DesktopSecretKey,
  type DesktopServiceStatus,
  type DesktopUpdateStatus,
  type DesktopWorkspaceInfo,
} from "../lib/desktopBridge";
import { getRuntimeDescriptor } from "../lib/runtimeMode";
import { useToast } from "./Toast";
import { Badge } from "./ui";

const CONNECTOR_ENDPOINT_KEY = "societyer.desktop.connectorEndpoint";
const DEFAULT_CONNECTOR_ENDPOINT = "http://127.0.0.1:8890";

const SECRET_FIELDS: { key: DesktopSecretKey; label: string; hint: string }[] = [
  {
    key: "connector-token",
    label: "Connector token",
    hint: "Optional token for a local browser connector service.",
  },
  {
    key: "rustfs-access-key",
    label: "RustFS/S3 access key",
    hint: "Optional replication credential. Local documents do not require it.",
  },
  {
    key: "rustfs-secret-key",
    label: "RustFS/S3 secret key",
    hint: "Stored with Electron safeStorage, not Dexie.",
  },
  {
    key: "ai-api-key",
    label: "AI API key",
    hint: "Optional desktop-scoped AI credential.",
  },
  {
    key: "sync-token",
    label: "Sync token",
    hint: "Reserved for future local-to-server sync.",
  },
];

export function DesktopDiagnosticsPanel() {
  const bridgeAvailable = isDesktopBridgeAvailable();
  const runtime = useMemo(() => getRuntimeDescriptor(), []);
  const toast = useToast();
  const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null);
  const [workspace, setWorkspace] = useState<DesktopWorkspaceInfo | null>(null);
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [connectorEndpoint, setConnectorEndpoint] = useState(
    () => localStorage.getItem(CONNECTOR_ENDPOINT_KEY) || DEFAULT_CONNECTOR_ENDPOINT,
  );
  const [connectorHealth, setConnectorHealth] = useState<DesktopConnectorHealth | null>(null);
  const [serviceStatuses, setServiceStatuses] = useState<DesktopServiceStatus[]>([]);
  const [managedServices, setManagedServices] = useState<DesktopManagedServiceStatus[]>([]);
  const [busy, setBusy] = useState<"backup" | "connector" | "workspace" | "backup-folder" | "logs" | "log-preview" | "updates" | "services" | "managed-services" | "start-connectors" | "stop-connectors" | null>(null);
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [logPreview, setLogPreview] = useState("");
  const [secretValues, setSecretValues] = useState<Partial<Record<DesktopSecretKey, string>>>({});
  const [storedSecrets, setStoredSecrets] = useState<Partial<Record<DesktopSecretKey, boolean>>>({});

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    let active = true;
    Promise.all([
      bridge.getAppInfo(),
      bridge.getUpdateState(),
      bridge.getWorkspaceInfo(),
      bridge.getSetupState(),
      bridge.listServiceStatuses(),
      bridge.listManagedServiceStatuses(),
    ])
      .then(([info, updates, workspaceInfo, setup, services, managed]) => {
        if (!active) return;
        setAppInfo(info);
        setUpdateStatus(updates);
        setWorkspace(workspaceInfo);
        setSetupComplete(setup.complete);
        setServiceStatuses(services);
        setManagedServices(managed);
      })
      .catch((error) => {
        if (!active) return;
        toast.error("Desktop diagnostics failed", error instanceof Error ? error.message : undefined);
      });
    return () => {
      active = false;
    };
  }, [toast]);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    let active = true;
    Promise.all(
      SECRET_FIELDS.map(async (field) => [field.key, Boolean(await bridge.getSecret(field.key))] as const),
    )
      .then((entries) => {
        if (!active) return;
        setStoredSecrets(Object.fromEntries(entries) as Partial<Record<DesktopSecretKey, boolean>>);
      })
      .catch(() => {
        if (!active) return;
        setStoredSecrets({});
      });
    return () => {
      active = false;
    };
  }, []);

  if (!bridgeAvailable) return null;

  const createBackup = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy("backup");
    try {
      const result = await bridge.createBackup();
      setBackupPath(result.path);
      toast.success("Backup created", { description: result.path });
    } catch (error) {
      toast.error("Backup failed", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const openWorkspace = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy("workspace");
    try {
      await bridge.openWorkspaceFolder();
    } catch (error) {
      toast.error("Could not open workspace", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const openBackup = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy("backup-folder");
    try {
      await bridge.openBackupFolder(backupPath ?? undefined);
    } catch (error) {
      toast.error("Could not open backup folder", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const openLogs = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy("logs");
    try {
      await bridge.openLogFolder();
    } catch (error) {
      toast.error("Could not open logs", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const refreshLogPreview = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy("log-preview");
    try {
      const logText = await bridge.readMainLog(200_000);
      setLogPreview(logText);
      if (!logText) toast.info("No desktop log entries yet");
    } catch (error) {
      toast.error("Could not read logs", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const exportLogPreview = () => {
    const blob = new Blob([logPreview], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `societyer-desktop-${new Date().toISOString().slice(0, 10)}.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const checkConnector = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy("connector");
    setConnectorHealth(null);
    localStorage.setItem(CONNECTOR_ENDPOINT_KEY, connectorEndpoint);
    try {
      const health = await bridge.checkConnector(connectorEndpoint);
      setConnectorHealth(health);
      if (health.ok) toast.success("Connector available", health.provider);
      else toast.warn("Connector unavailable", health.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connector check failed.";
      setConnectorHealth({ ok: false, message });
      toast.error("Connector check failed", message);
    } finally {
      setBusy(null);
    }
  };

  const checkUpdates = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy("updates");
    try {
      const state = await bridge.checkForUpdate();
      setUpdateStatus(state);
      if (state.status === "available") toast.success("Update available", state.availableVersion);
      else if (state.status === "error") toast.error("Update check failed", state.error);
      else toast.info("Update status checked", state.reason);
    } catch (error) {
      toast.error("Update check failed", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const refreshServices = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy("services");
    try {
      setServiceStatuses(await bridge.listServiceStatuses());
    } catch (error) {
      toast.error("Service check failed", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const refreshManagedServices = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy("managed-services");
    try {
      setManagedServices(await bridge.listManagedServiceStatuses());
    } catch (error) {
      toast.error("Managed service check failed", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const startConnectors = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy("start-connectors");
    try {
      const status = await bridge.startManagedService("browser-connectors");
      setManagedServices((prev) => upsertManagedService(prev, status));
      if (status.state === "running") toast.success("Connector stack started", status.message);
      else toast.warn("Connector stack did not start", status.message);
    } catch (error) {
      toast.error("Connector stack start failed", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const stopConnectors = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy("stop-connectors");
    try {
      const status = await bridge.stopManagedService("browser-connectors");
      setManagedServices((prev) => upsertManagedService(prev, status));
      if (status.state === "stopped") toast.success("Connector stack stopped", status.message);
      else toast.info("Connector stack status updated", status.message);
    } catch (error) {
      toast.error("Connector stack stop failed", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const saveSecret = async (key: DesktopSecretKey) => {
    const bridge = getDesktopBridge();
    const value = secretValues[key] ?? "";
    if (!bridge) return;
    try {
      const status = await bridge.setSecret(key, value);
      setStoredSecrets((prev) => ({ ...prev, [key]: status.stored }));
      setSecretValues((prev) => ({ ...prev, [key]: "" }));
      toast.success(status.stored ? "Secret stored" : "Secret removed");
    } catch (error) {
      toast.error("Secret update failed", error instanceof Error ? error.message : undefined);
    }
  };

  const removeSecret = async (key: DesktopSecretKey) => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    try {
      await bridge.removeSecret(key);
      setStoredSecrets((prev) => ({ ...prev, [key]: false }));
      setSecretValues((prev) => ({ ...prev, [key]: "" }));
      toast.success("Secret removed");
    } catch (error) {
      toast.error("Secret removal failed", error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <div>
          <h2 className="card__title">Desktop diagnostics</h2>
          <span className="card__subtitle">Local runtime, workspace, storage, connector, and native app state.</span>
        </div>
        <Badge tone={runtime.mode === "electron-local" ? "success" : "info"}>{runtime.mode}</Badge>
      </div>
      <div className="card__body col" style={{ gap: 16 }}>
        <div className="settings-pair">
          <div className="card" style={{ background: "var(--bg-base)" }}>
            <div className="card__head">
              <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>Runtime</h3>
            </div>
            <div className="card__body">
              <DiagnosticRows
                rows={[
                  ["App version", appInfo?.version ?? "Loading..."],
                  ["Packaged", appInfo ? (appInfo.isPackaged ? "Yes" : "No") : "Loading..."],
                  ["Electron", appInfo?.electronVersion ?? "Loading..."],
                  ["Chrome", appInfo?.chromeVersion ?? "Loading..."],
                  ["Node", appInfo?.nodeVersion ?? "Loading..."],
                  ["Resource path", appInfo?.resourcePath ?? "Loading..."],
                  ["Log folder", appInfo?.logDirectory ?? "Loading..."],
                  ["Run ID", appInfo?.runId ?? "Loading..."],
                  ["Build commit", appInfo?.buildCommit ?? "Not embedded"],
                  ["Icon PNG", appInfo?.iconPaths.png ?? "Not found"],
                  ["Runtime mode", appInfo?.runtimeMode ?? runtime.mode],
                  ["Document storage", appInfo?.documentStorageProvider ?? runtime.documentStorage],
                  ["Setup complete", setupComplete === null ? "Loading..." : setupComplete ? "Yes" : "No"],
                  ["Updates", updateStatus ? `${updateStatus.status} (${updateStatus.channel})` : "Loading..."],
                  ["Update reason", updateStatus?.error ?? updateStatus?.reason ?? "Loading..."],
                ]}
              />
              <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn" disabled={busy === "updates"} onClick={checkUpdates}>
                  <RefreshCw size={12} /> {busy === "updates" ? "Checking..." : "Check updates"}
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ background: "var(--bg-base)" }}>
            <div className="card__head">
              <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>Workspace</h3>
            </div>
            <div className="card__body">
              <DiagnosticRows
                rows={[
                  ["Workspace", workspace?.rootPath ?? "Loading..."],
                  ["User data", appInfo?.userDataPath ?? "Loading..."],
                  ["Last backup", backupPath ?? "None this session"],
                ]}
              />
              <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn" disabled={busy === "workspace"} onClick={openWorkspace}>
                  <FolderOpen size={12} /> Open workspace folder
                </button>
                <button className="btn" disabled={busy === "backup"} onClick={createBackup}>
                  <Database size={12} /> {busy === "backup" ? "Backing up..." : "Create backup"}
                </button>
                <button className="btn" disabled={busy === "backup-folder"} onClick={openBackup}>
                  <HardDrive size={12} /> Open backup folder
                </button>
                <button className="btn" disabled={busy === "logs"} onClick={openLogs}>
                  <HardDrive size={12} /> Open logs folder
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ background: "var(--bg-base)" }}>
          <div className="card__head">
            <div>
              <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>Desktop logs</h3>
              <span className="card__subtitle">Recent main-process entries from the current desktop log.</span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn" disabled={busy === "log-preview"} onClick={refreshLogPreview}>
                <FileText size={12} /> {busy === "log-preview" ? "Loading..." : "Refresh"}
              </button>
              <button className="btn" disabled={!logPreview} onClick={exportLogPreview}>
                <Download size={12} /> Export
              </button>
              <button className="btn" disabled={busy === "logs"} onClick={openLogs}>
                <HardDrive size={12} /> Open folder
              </button>
            </div>
          </div>
          <div className="card__body">
            <pre
              className="mono"
              style={{
                background: "var(--bg-muted)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                maxHeight: 260,
                overflow: "auto",
                padding: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {logPreview || "No log preview loaded."}
            </pre>
          </div>
        </div>

        <div className="card" style={{ background: "var(--bg-base)" }}>
          <div className="card__head">
            <div>
              <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>Managed local helpers</h3>
              <span className="card__subtitle">Explicit controls for optional helper services. Nothing starts automatically.</span>
            </div>
            <button className="btn" disabled={busy === "managed-services"} onClick={refreshManagedServices}>
              <RefreshCw size={12} /> {busy === "managed-services" ? "Checking..." : "Refresh"}
            </button>
          </div>
          <div className="card__body">
            <div className="settings-list">
              {managedServices.map((service) => (
                <div className="settings-row" key={service.id}>
                  <div style={{ flex: 1 }}>
                    <strong>{service.label}</strong>
                    <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                      {service.message ?? service.composeFile ?? "Status unavailable."}
                    </div>
                    {service.composeFile && (
                      <div className="muted mono" style={{ fontSize: "var(--fs-xs)", marginTop: 3 }}>
                        {service.composeFile}
                      </div>
                    )}
                  </div>
                  <Badge tone={managedServiceTone(service.state)}>
                    {service.state}
                  </Badge>
                  {service.id === "browser-connectors" && (
                    <>
                      <button
                        className="btn"
                        disabled={!service.manageable || busy === "start-connectors" || service.state === "running"}
                        onClick={startConnectors}
                      >
                        {busy === "start-connectors" ? "Starting..." : "Start"}
                      </button>
                      <button
                        className="btn"
                        disabled={!service.manageable || busy === "stop-connectors" || service.state === "stopped"}
                        onClick={stopConnectors}
                      >
                        {busy === "stop-connectors" ? "Stopping..." : "Stop"}
                      </button>
                    </>
                  )}
                </div>
              ))}
              {managedServices.length === 0 && (
                <div className="muted">No managed helper services are available.</div>
              )}
            </div>
          </div>
        </div>

        <div className="card" style={{ background: "var(--bg-base)" }}>
          <div className="card__head">
            <div>
              <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>Optional services</h3>
              <span className="card__subtitle">Server-assisted integrations are checked only when configured.</span>
            </div>
            <button className="btn" disabled={busy === "services"} onClick={refreshServices}>
              <RefreshCw size={12} /> {busy === "services" ? "Checking..." : "Refresh"}
            </button>
          </div>
          <div className="card__body">
            <div className="settings-list">
              {serviceStatuses.map((service) => (
                <div className="settings-row" key={service.id}>
                  <div>
                    <strong>{service.label}</strong>
                    <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                      {service.endpoint ?? service.message ?? "Not configured"}
                    </div>
                  </div>
                  <Badge tone={service.ok ? "success" : service.configured ? "warn" : "neutral"}>
                    {service.ok ? "Available" : service.configured ? "Unavailable" : "Optional"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card" style={{ background: "var(--bg-base)" }}>
          <div className="card__head">
            <div>
              <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>Connector service</h3>
              <span className="card__subtitle">Optional Docker/browser connector endpoint.</span>
            </div>
            <Badge tone={connectorHealth?.ok ? "success" : connectorHealth ? "warn" : "neutral"}>
              {connectorHealth?.ok ? "Connected" : connectorHealth ? "Unavailable" : "Not checked"}
            </Badge>
          </div>
          <div className="card__body">
            <div className="settings-row">
              <div style={{ flex: 1 }}>
                <label className="field__label" htmlFor="desktop-diagnostics-connector">
                  Connector endpoint
                </label>
                <input
                  id="desktop-diagnostics-connector"
                  className="input"
                  value={connectorEndpoint}
                  onChange={(event) => setConnectorEndpoint(event.target.value)}
                />
                {connectorHealth?.message && (
                  <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
                    {connectorHealth.message}
                  </div>
                )}
              </div>
              <button className="btn btn--accent" disabled={busy === "connector"} onClick={checkConnector}>
                <PlugZap size={12} /> {busy === "connector" ? "Checking..." : "Check connector"}
              </button>
            </div>
          </div>
        </div>

        <div className="card" style={{ background: "var(--bg-base)" }}>
          <div className="card__head">
            <div>
              <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>Desktop secrets</h3>
              <span className="card__subtitle">Stored through Electron safeStorage for desktop-only credentials.</span>
            </div>
            <KeyRound size={16} />
          </div>
          <div className="card__body col" style={{ gap: 12 }}>
            {SECRET_FIELDS.map((field) => (
              <div className="settings-row" key={field.key}>
                <div style={{ flex: 1 }}>
                  <label className="field__label" htmlFor={`desktop-secret-${field.key}`}>
                    {field.label}
                  </label>
                  <input
                    id={`desktop-secret-${field.key}`}
                    className="input"
                    type="password"
                    value={secretValues[field.key] ?? ""}
                    placeholder={storedSecrets[field.key] ? "Stored" : "Not stored"}
                    onChange={(event) =>
                      setSecretValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                    }
                  />
                  <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
                    {field.hint}
                  </div>
                </div>
                <button className="btn" onClick={() => void saveSecret(field.key)}>
                  Save
                </button>
                <button className="btn" onClick={() => void removeSecret(field.key)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DiagnosticRows({ rows }: { rows: [string, string][] }) {
  return (
    <div className="settings-list">
      {rows.map(([label, value]) => (
        <div className="settings-row" key={label}>
          <strong>{label}</strong>
          <span className="muted mono" style={{ fontSize: "var(--fs-xs)", textAlign: "right" }}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function upsertManagedService(
  services: DesktopManagedServiceStatus[],
  next: DesktopManagedServiceStatus,
) {
  const found = services.some((service) => service.id === next.id);
  return found
    ? services.map((service) => (service.id === next.id ? next : service))
    : [...services, next];
}

function managedServiceTone(state: DesktopManagedServiceStatus["state"]) {
  if (state === "running") return "success";
  if (state === "stopped" || state === "disabled") return "neutral";
  if (state === "not-installed") return "info";
  if (state === "starting" || state === "stopping" || state === "unhealthy") return "warn";
  return "danger";
}
