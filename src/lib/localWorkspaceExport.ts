import { localDataClient } from "./localDataClient";

type LocalExportCapableClient = {
  exportLocalWorkspaceSnapshot?: () => unknown;
  importLocalWorkspaceSnapshot?: (snapshot: any) => Promise<unknown> | unknown;
};

export function getLocalWorkspaceSnapshot() {
  const client = localDataClient as unknown as LocalExportCapableClient;
  return client.exportLocalWorkspaceSnapshot?.() ?? null;
}

export function downloadLocalWorkspaceSnapshot(filename = "societyer-local-workspace.json") {
  const snapshot = getLocalWorkspaceSnapshot();
  if (!snapshot) throw new Error("Local workspace export is unavailable in this runtime.");
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function importLocalWorkspaceSnapshotFile(file: File) {
  const text = await file.text();
  const snapshot = JSON.parse(text);
  if (!snapshot || typeof snapshot !== "object" || !snapshot.tables) {
    throw new Error("The selected file is not a local Societyer workspace snapshot.");
  }
  const client = localDataClient as unknown as LocalExportCapableClient;
  if (!client.importLocalWorkspaceSnapshot) {
    throw new Error("Local workspace import is unavailable in this runtime.");
  }
  await client.importLocalWorkspaceSnapshot(snapshot);
  return snapshot;
}
