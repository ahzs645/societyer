import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  Database,
  Download,
  FolderOpen,
  HardDrive,
  Monitor,
  PlugZap,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { PageHeader } from "./_helpers";
import { DesktopDiagnosticsPanel } from "../components/DesktopDiagnosticsPanel";
import { Badge } from "../components/ui";
import {
  getDesktopBridge,
  isDesktopBridgeAvailable,
  type DesktopConnectorHealth,
  type DesktopWorkspaceInfo,
} from "../lib/desktopBridge";
import {
  persistLocalWorkspaceSnapshot,
  readLocalWorkspaceSnapshot,
  type LocalWorkspaceSnapshotReadResult,
} from "../lib/documentStorage";
import {
  downloadLocalWorkspaceSnapshot,
  getLocalWorkspaceSnapshot,
  importLocalWorkspaceSnapshotFile,
} from "../lib/localWorkspaceExport";
import { getRuntimeDescriptor } from "../lib/runtimeMode";
import { isStaticDemoRuntime } from "../lib/staticRuntime";

const CONNECTOR_ENDPOINT_KEY = "societyer.desktop.connectorEndpoint";
const DEFAULT_CONNECTOR_ENDPOINT = "http://127.0.0.1:8890";
type WorkspaceSnapshotOffer = Extract<LocalWorkspaceSnapshotReadResult, { status: "available" }>;

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
  const [busy, setBusy] = useState<"workspace" | "backup" | "connector" | "export" | "import" | null>(null);
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [workspaceSnapshotOffer, setWorkspaceSnapshotOffer] = useState<WorkspaceSnapshotOffer | null>(null);

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
    setWorkspaceSnapshotOffer(null);
    try {
      const selected = await bridge.chooseWorkspaceDirectory();
      if (!selected) return;
      setWorkspace(await bridge.getWorkspaceInfo());
      const snapshotResult = await readLocalWorkspaceSnapshot();
      if (snapshotResult.status === "available") {
        setWorkspaceSnapshotOffer(snapshotResult);
        setStatusMessage("Workspace folder updated.");
      } else if (snapshotResult.status === "invalid") {
        setStatusMessage(`Workspace folder updated, but ${snapshotResult.error}`);
      } else {
        setStatusMessage("Workspace folder updated.");
      }
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
      const snapshot = getLocalWorkspaceSnapshot();
      if (!snapshot) throw new Error("Local workspace export is unavailable in this runtime.");
      await persistLocalWorkspaceSnapshot(JSON.stringify(snapshot, null, 2));
      const result = await bridge.createBackup();
      setBackupPath(result.path);
      setStatusMessage("Backup created.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Backup failed.");
    } finally {
      setBusy(null);
    }
  };

  const exportLocalData = () => {
    setBusy("export");
    try {
      downloadLocalWorkspaceSnapshot();
      setStatusMessage("Local workspace data export created.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Local data export failed.");
    } finally {
      setBusy(null);
    }
  };

  const importLocalData = async (file: File | null | undefined) => {
    if (!file) return;
    setBusy("import");
    try {
      await importLocalWorkspaceSnapshotFile(file);
      setStatusMessage("Local workspace data import completed.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Local data import failed.");
    } finally {
      setBusy(null);
    }
  };

  const importBundledRecords = async () => {
    if (!workspaceSnapshotOffer) return;
    setBusy("import");
    try {
      const file = new File(
        [workspaceSnapshotOffer.serializedSnapshot],
        "records-snapshot.json",
        { type: "application/json" },
      );
      await importLocalWorkspaceSnapshotFile(file);
      setWorkspaceSnapshotOffer(null);
      setStatusMessage("Records from the workspace snapshot were imported.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Workspace records import failed.");
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

  if (!bridgeAvailable) {
    const inDemo = isStaticDemoRuntime();
    return (
      <div className="page page--wide">
        <PageHeader
          title="Desktop app setup"
          subtitle="This page configures the Societyer desktop app. You're currently using the web version."
          icon={<Monitor size={16} />}
          iconColor="blue"
        />
        <div className="card" style={{ maxWidth: 720 }}>
          <div className="card__head">
            <h2 className="card__title">You're using the web version</h2>
            <span className="card__subtitle">
              {inDemo
                ? "This is the browser-based demo, which doesn't have a desktop bridge."
                : "No desktop bridge was found in this browser tab."}
            </span>
          </div>
          <div className="card__body col">
            <div className="muted">
              The desktop app unlocks local-first storage — your society's records live in the app's local database,
              while document files live in your chosen workspace folder. Both remain on your computer for offline
              access, backups, and exports/imports. Societyer Desktop isn't required; everything else works normally
              in the web version you're using now.
            </div>
            <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              To set up the desktop app, download and open Societyer Desktop, then revisit this page from inside
              that app.
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Link to="/app/settings" className="btn btn--accent">
                Open settings
              </Link>
              <Link to="/app" className="btn">
                Back to dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page page--wide">
      <PageHeader
        title="Welcome to Societyer Desktop"
        subtitle="Choose where local documents live, confirm the desktop bridge, and connect optional services when needed."
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

      {workspaceSnapshotOffer && (
        <div className="notice notice--warning" style={{ marginBottom: 16 }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <strong>Records snapshot found</strong>
              <div style={{ marginTop: 4 }}>
                This folder contains a records snapshot from{" "}
                {new Date(workspaceSnapshotOffer.exportedAtISO).toLocaleString()} with{" "}
                {workspaceSnapshotOffer.tableCount} table{workspaceSnapshotOffer.tableCount === 1 ? "" : "s"}.
                Importing it replaces the records currently stored in this app.
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn--accent" disabled={busy === "import"} onClick={() => void importBundledRecords()}>
                <Upload size={12} /> {busy === "import" ? "Importing..." : "Import records"}
              </button>
              <button className="btn" disabled={busy === "import"} onClick={() => setWorkspaceSnapshotOffer(null)}>
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="settings-pair" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Workspace vault</h2>
              <span className="card__subtitle">
                Document files are stored in this folder. Records stay in the app's local database and are snapshotted here for backups.
              </span>
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
                    {backupPath ?? "Snapshots local records, then copies the workspace into its backups folder."}
                  </div>
                </div>
                <button className="btn" disabled={!requiredReady || busy === "backup"} onClick={createBackup}>
                  <Database size={12} /> {busy === "backup" ? "Backing up..." : "Create backup"}
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <strong>Local data export</strong>
                  <div className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
                    Downloads local records, attachment references, and change metadata as JSON. Workspace document files remain in the folder.
                  </div>
                </div>
                <button className="btn" disabled={!requiredReady || busy === "export"} onClick={exportLocalData}>
                  <Download size={12} /> {busy === "export" ? "Exporting..." : "Export data"}
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <strong>Local data import</strong>
                  <div className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
                    Restores a local workspace JSON snapshot into IndexedDB.
                  </div>
                </div>
                <label className={`btn${!requiredReady || busy === "import" ? " is-disabled" : ""}`}>
                  <Upload size={12} /> {busy === "import" ? "Importing..." : "Import data"}
                  <input
                    accept="application/json"
                    disabled={!requiredReady || busy === "import"}
                    onChange={(event) => void importLocalData(event.currentTarget.files?.[0])}
                    style={{ display: "none" }}
                    type="file"
                  />
                </label>
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

      <DesktopDiagnosticsPanel />
    </div>
  );
}
