import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
  const bridgeAvailable = isDesktopBridgeAvailable();
  const [workspace, setWorkspace] = useState<DesktopWorkspaceInfo | null>(null);
  const [setupComplete, setSetupComplete] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
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
    Promise.all([bridge.getWorkspaceInfo(), bridge.getSetupState()])
      .then(([info, setup]) => {
        if (!active) return;
        setWorkspace(info);
        setSetupComplete(setup.complete);
      })
      .catch((error) => {
        if (active) setStatusMessage(error instanceof Error ? error.message : "Desktop setup could not load.");
      });
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
      setStatusMessage("Workspace folder updated.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Workspace selection failed.");
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
      setStatusMessage("Backup created.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Backup failed.");
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
    } catch (error) {
      setConnectorHealth({ ok: false, message: error instanceof Error ? error.message : "Connector check failed." });
    } finally {
      setBusy(null);
    }
  };

  const completeSetup = async (target: "/app" | "/app/society/new") => {
    const bridge = getDesktopBridge();
    if (!bridge || !workspace?.rootPath) return;
    setBusy("workspace");
    try {
      const setup = await bridge.setSetupComplete(true);
      setSetupComplete(setup.complete);
      navigate(target);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Setup could not be completed.");
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
      complete: true,
      detail: connectorHealth
        ? connectorHealth.ok
          ? `Connected${connectorHealth.provider ? ` to ${connectorHealth.provider}` : ""}.`
          : connectorHealth.message ?? "Unavailable"
        : "Optional Docker service.",
    },
  ];

  const requiredReady = bridgeAvailable && Boolean(workspace?.rootPath) && runtime.documentStorage === "local-filesystem";

  return (
    <div className="page page--wide">
      <PageHeader
        title="Welcome to Societyer Desktop"
        subtitle="Choose where local records live, confirm the desktop bridge, and connect optional services when needed."
        icon={<HardDrive size={16} />}
        iconColor="blue"
        actions={
          <button
            className="btn-action btn-action--primary"
            disabled={!requiredReady || busy === "workspace"}
            onClick={() => completeSetup(setupComplete ? "/app" : "/app/society/new")}
          >
            <CheckCircle2 size={12} /> {setupComplete ? "Continue to workspace" : "Create first society"}
          </button>
        }
      />

      {statusMessage && (
        <div className="notice notice--info" style={{ marginBottom: 16 }}>
          {statusMessage}
        </div>
      )}

      <div className="settings-pair" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Workspace vault</h2>
              <span className="card__subtitle">Local records and document versions are stored in this folder.</span>
            </div>
            <Badge tone={workspace?.rootPath ? "success" : "warn"}>
              {workspace?.rootPath ? "Ready" : "Pending"}
            </Badge>
          </div>
          <div className="card__body">
            <div className="settings-list">
              <div className="settings-row">
                <div>
                  <strong>{workspace?.name ?? "Societyer Workspace"}</strong>
                  <div className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
                    {workspace?.rootPath ?? "Open through Electron to create the default workspace."}
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
                <button className="btn" disabled={!requiredReady || busy === "backup"} onClick={createBackup}>
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
            <h2 className="card__title">Start local workspace</h2>
            <span className="card__subtitle">Create a workspace record now, or enter the demo data after confirming the vault.</span>
          </div>
          <Badge tone={setupComplete ? "success" : requiredReady ? "info" : "warn"}>
            {setupComplete ? "Complete" : requiredReady ? "Ready" : "Needs setup"}
          </Badge>
        </div>
        <div className="card__body">
          <div className="settings-row">
            <div>
              <strong>Society records</strong>
              <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                Local files are ready before cloud, AI, connector, or Paperless services are connected.
              </div>
            </div>
            <button className="btn btn--accent" disabled={!requiredReady || busy === "workspace"} onClick={() => completeSetup("/app/society/new")}>
              <CheckCircle2 size={12} /> Create new society
            </button>
            <button className="btn" disabled={!requiredReady || busy === "workspace"} onClick={() => completeSetup("/app")}>
              Use demo data
            </button>
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
