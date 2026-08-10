import { useState } from "react";
import { Link } from "react-router-dom";
import { Download, HardDrive, Server, Upload } from "lucide-react";
import { useConfirm } from "./Modal";
import { useToast } from "./Toast";
import { Badge } from "./ui";
import { InstallAppPrompt } from "./InstallAppPrompt";
import { setStoredSocietyId } from "../hooks/useSociety";
import { resolveAppRuntime } from "../lib/appRuntime";
import {
  downloadLocalWorkspaceSnapshot,
  localWorkspaceBackupSupported,
  localWorkspaceRestoreSupported,
  restoreLocalWorkspaceBackup,
} from "../lib/localWorkspaceExport";
import { isStandalonePwa } from "../lib/pwa";

/**
 * Where this device keeps its records, plus the backup/restore pair that makes
 * a browser-local workspace survivable. Browser storage can be cleared by the
 * user, the OS, or a "clear site data" click, so exporting is the only durable
 * copy — the card says so rather than implying the data is safe by default.
 */
export function WorkspaceStorageCard() {
  const resolution = resolveAppRuntime();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<"export" | "import" | null>(null);

  const canBackup = localWorkspaceBackupSupported();
  const canRestore = localWorkspaceRestoreSupported();

  const exportBackup = () => {
    setBusy("export");
    try {
      const filename = downloadLocalWorkspaceSnapshot();
      toast.success("Backup downloaded", filename);
    } catch (error: any) {
      toast.error("Backup failed", error?.message ?? "The workspace could not be exported.");
    } finally {
      setBusy(null);
    }
  };

  const importBackup = async (file: File | null | undefined, input: HTMLInputElement) => {
    if (!file) return;
    const ok = await confirm({
      title: "Restore this backup?",
      message: `Everything currently in this workspace is replaced by the contents of "${file.name}". This cannot be undone — export a backup first if you need one.`,
      confirmLabel: "Restore",
      tone: "danger",
    });
    input.value = "";
    if (!ok) return;
    setBusy("import");
    try {
      const summary = await restoreLocalWorkspaceBackup(file);
      const restoredSocietyId = summary.societies[0]?._id;
      if (restoredSocietyId) setStoredSocietyId(restoredSocietyId as any);
      toast.success(
        "Backup restored",
        `${summary.rowCount} record${summary.rowCount === 1 ? "" : "s"} across ${summary.tableCount} table${summary.tableCount === 1 ? "" : "s"}.`,
      );
    } catch (error: any) {
      toast.error("Restore failed", error?.message ?? "The backup file could not be read.");
    } finally {
      setBusy(null);
    }
  };

  const description =
    resolution.kind === "local"
      ? "Records are stored in this browser on this device only."
      : resolution.kind === "demo"
        ? "This is the seeded public demo. Nothing here is saved permanently."
        : resolution.kind === "builtin-local"
          ? "Records are stored locally by this build."
          : resolution.kind === "server"
            ? `Records live on ${resolution.url}.`
            : "No storage has been chosen for this device yet.";

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <div className="app-setup__card-head">
          {resolution.kind === "server" ? <Server size={15} /> : <HardDrive size={15} />}
          <div>
            <h2 className="card__title">Workspace storage</h2>
            <span className="card__subtitle">{description}</span>
          </div>
        </div>
        <Badge tone={resolution.kind === "server" ? "info" : resolution.kind === "unconfigured" ? "warn" : "success"}>
          {resolution.kind === "server" ? "Server" : resolution.kind === "unconfigured" ? "Not set up" : "This device"}
        </Badge>
      </div>
      <div className="card__body col" style={{ gap: 12 }}>
        {resolution.kind === "local" && (
          <div className="notice notice--warning">
            Clearing this browser's site data, or using private browsing, erases the workspace. Download a
            backup regularly and keep it somewhere you control.
          </div>
        )}

        {(canBackup || canRestore) && (
          <div className="settings-list">
            {canBackup && (
              <div className="settings-row">
                <div>
                  <strong>Download a backup</strong>
                  <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                    Exports every record, attachment reference, and change entry as a single JSON file.
                  </div>
                </div>
                <button className="btn" type="button" disabled={busy !== null} onClick={exportBackup}>
                  <Download size={12} /> {busy === "export" ? "Exporting…" : "Download backup"}
                </button>
              </div>
            )}
            {canRestore && (
              <div className="settings-row">
                <div>
                  <strong>Restore a backup</strong>
                  <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                    Replaces this workspace with the contents of a backup file.
                  </div>
                </div>
                <label className={`btn${busy !== null ? " is-disabled" : ""}`}>
                  <Upload size={12} /> {busy === "import" ? "Restoring…" : "Choose file"}
                  <input
                    type="file"
                    accept="application/json,.json"
                    disabled={busy !== null}
                    style={{ display: "none" }}
                    onChange={(event) => void importBackup(event.currentTarget.files?.[0], event.currentTarget)}
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {!isStandalonePwa() && <InstallAppPrompt />}

        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Link className="btn-action" to="/setup">
            Change where records are stored
          </Link>
        </div>
      </div>
    </div>
  );
}
