import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Database,
  FolderOpen,
  HardDrive,
  PlugZap,
  ShieldCheck,
} from "lucide-react";
import { PageHeader } from "./_helpers";
import { Badge } from "../components/ui";
import {
  getDesktopBridge,
  isDesktopBridgeAvailable,
  type DesktopConnectorHealth,
  type DesktopWorkspaceInfo,
} from "../lib/desktopBridge";
import { getRuntimeDescriptor } from "../lib/runtimeMode";

const CONNECTOR_ENDPOINT_KEY = "societyer.desktop.connectorEndpoint";
const DEFAULT_CONNECTOR_ENDPOINT = "http://127.0.0.1:8890";

export function DesktopSetupPage() {
  const runtime = useMemo(() => getRuntimeDescriptor(), []);
  const bridgeAvailable = isDesktopBridgeAvailable();
  const [workspace, setWorkspace] = useState<DesktopWorkspaceInfo | null>(null);
  const [connectorEndpoint, setConnectorEndpoint] = useState(
    () => localStorage.getItem(CONNECTOR_ENDPOINT_KEY) || DEFAULT_CONNECTOR_ENDPOINT,
  );
  const [connectorHealth, setConnectorHealth] = useState<DesktopConnectorHealth | null>(null);
  const [busy, setBusy] = useState<"workspace" | "backup" | "connector" | null>(null);
  const [backupPath, setBackupPath] = useState<string | null>(null);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    let active = true;
    bridge.getWorkspaceInfo().then((info) => {
      if (active) setWorkspace(info);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const chooseWorkspace = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy("workspace");
    try {
      const selected = await bridge.chooseWorkspaceDirectory();
      if (!selected) return;
      setWorkspace(await bridge.getWorkspaceInfo());
    } finally {
      setBusy(null);
    }
  };

  const createBackup = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy("backup");
    try {
      const result = await bridge.createBackup();
      setBackupPath(result.path);
    } finally {
      setBusy(null);
    }
  };

  const checkConnector = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy("connector");
    setConnectorHealth(null);
    localStorage.setItem(CONNECTOR_ENDPOINT_KEY, connectorEndpoint);
    try {
      setConnectorHealth(await bridge.checkConnector(connectorEndpoint));
    } finally {
      setBusy(null);
    }
  };

  const steps = [
    {
      label: "Desktop bridge",
      complete: bridgeAvailable,
      detail: bridgeAvailable ? "Electron preload is available." : "Open through the Electron app.",
    },
    {
      label: "Workspace folder",
      complete: Boolean(workspace?.rootPath),
      detail: workspace?.rootPath ?? "Default workspace will be created in app data.",
    },
    {
      label: "Local document storage",
      complete: runtime.documentStorage === "local-filesystem",
      detail: runtime.documentStorage,
    },
    {
      label: "Connector service",
      complete: connectorHealth?.ok === true,
      detail: connectorHealth
        ? connectorHealth.ok
          ? `Connected${connectorHealth.provider ? ` to ${connectorHealth.provider}` : ""}.`
          : connectorHealth.message ?? "Unavailable"
        : "Optional Docker service.",
    },
  ];

  return (
    <div className="page page--wide">
      <PageHeader
        title="Welcome to Societyer Desktop"
        subtitle="Choose where local records live, confirm the desktop bridge, and connect optional services when needed."
        icon={<HardDrive size={16} />}
        iconColor="blue"
        actions={
          <Link className="btn-action btn-action--primary" to="/app">
            <CheckCircle2 size={12} /> Continue to workspace
          </Link>
        }
      />

      <div className="settings-pair" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Workspace vault</h2>
              <span className="card__subtitle">Local records and document versions are stored in this folder.</span>
            </div>
            <Badge tone={workspace?.rootPath ? "success" : "warn"}>
              {workspace?.rootPath ? "Ready" : "Default"}
            </Badge>
          </div>
          <div className="card__body">
            <div className="settings-list">
              <div className="settings-row">
                <div>
                  <strong>{workspace?.name ?? "Societyer Workspace"}</strong>
                  <div className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
                    {workspace?.rootPath ?? "Workspace path will be assigned by Electron."}
                  </div>
                </div>
                <button className="btn btn--accent" disabled={!bridgeAvailable || busy === "workspace"} onClick={chooseWorkspace}>
                  <FolderOpen size={12} /> {busy === "workspace" ? "Choosing..." : "Choose folder"}
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <strong>Backup</strong>
                  <div className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
                    {backupPath ?? "Creates a local copy inside the workspace backups folder."}
                  </div>
                </div>
                <button className="btn" disabled={!bridgeAvailable || busy === "backup"} onClick={createBackup}>
                  <Database size={12} /> {busy === "backup" ? "Backing up..." : "Create backup"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Desktop readiness</h2>
              <span className="card__subtitle">Runtime and storage checks for local-first mode.</span>
            </div>
            <Badge tone={bridgeAvailable ? "success" : "warn"}>
              {runtime.mode}
            </Badge>
          </div>
          <div className="card__body">
            <div className="settings-list">
              {steps.map((step) => (
                <div className="settings-row" key={step.label}>
                  <div>
                    <strong>{step.label}</strong>
                    <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>{step.detail}</div>
                  </div>
                  <Badge tone={step.complete ? "success" : "neutral"}>
                    {step.complete ? "Ready" : "Pending"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Optional browser connector</h2>
            <span className="card__subtitle">Use this only when imports need the separate Docker connector service.</span>
          </div>
          <Badge tone={connectorHealth?.ok ? "success" : connectorHealth ? "warn" : "neutral"}>
            {connectorHealth?.ok ? "Connected" : connectorHealth ? "Unavailable" : "Optional"}
          </Badge>
        </div>
        <div className="card__body">
          <div className="settings-row">
            <div style={{ flex: 1 }}>
              <label className="field__label" htmlFor="connector-endpoint">
                Connector endpoint
              </label>
              <input
                id="connector-endpoint"
                className="input"
                value={connectorEndpoint}
                onChange={(event) => setConnectorEndpoint(event.target.value)}
              />
            </div>
            <button className="btn btn--accent" disabled={!bridgeAvailable || busy === "connector"} onClick={checkConnector}>
              <PlugZap size={12} /> {busy === "connector" ? "Checking..." : "Check"}
            </button>
            <Link className="btn" to="/app/browser-connectors">
              <ShieldCheck size={12} /> Browser apps
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
