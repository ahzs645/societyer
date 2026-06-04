import { useEffect, useMemo, useState } from "react";
import { Database, FolderOpen, HardDrive, KeyRound, PlugZap } from "lucide-react";

import {
  getDesktopBridge,
  isDesktopBridgeAvailable,
  type DesktopAppInfo,
  type DesktopConnectorHealth,
  type DesktopSecretKey,
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
  const [busy, setBusy] = useState<"backup" | "connector" | "workspace" | "backup-folder" | null>(null);
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [secretValues, setSecretValues] = useState<Partial<Record<DesktopSecretKey, string>>>({});
  const [storedSecrets, setStoredSecrets] = useState<Partial<Record<DesktopSecretKey, boolean>>>({});

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    let active = true;
    Promise.all([
      bridge.getAppInfo(),
      bridge.getUpdateStatus(),
      bridge.getWorkspaceInfo(),
      bridge.getSetupState(),
    ])
      .then(([info, updates, workspaceInfo, setup]) => {
        if (!active) return;
        setAppInfo(info);
        setUpdateStatus(updates);
        setWorkspace(workspaceInfo);
        setSetupComplete(setup.complete);
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
                  ["Icon PNG", appInfo?.iconPaths.png ?? "Not found"],
                  ["Document storage", runtime.documentStorage],
                  ["Setup complete", setupComplete === null ? "Loading..." : setupComplete ? "Yes" : "No"],
                  ["Updates", updateStatus ? (updateStatus.enabled ? "Enabled" : "Disabled") : "Loading..."],
                  ["Update reason", updateStatus?.reason ?? "Loading..."],
                ]}
              />
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
              </div>
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
