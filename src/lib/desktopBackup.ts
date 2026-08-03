import { getDesktopBridge, type DesktopBackupResult } from "./desktopBridge";
import { persistLocalWorkspaceSnapshot } from "./documentStorage";

export async function createDesktopBackup(): Promise<DesktopBackupResult> {
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error("Electron desktop bridge is not available.");

  const { getLocalWorkspaceSnapshot } = await import("./localWorkspaceExport");
  const snapshot = getLocalWorkspaceSnapshot();
  if (!snapshot) throw new Error("Local workspace export is unavailable in this runtime.");

  await persistLocalWorkspaceSnapshot(JSON.stringify(snapshot, null, 2));
  return await bridge.createBackup();
}
