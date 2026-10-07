// Site-only entrypoint: restore the delivered local test once, then start the
// unchanged Societyer application. Never replace an existing edited workspace.
const societyId = "static_society_workspace_1791180962204_fb1mbd";
const workspaceId = "pgair-sites-test";
const status = document.getElementById("preview-status");
const updateStatus = (message: string) => { if (status) status.textContent = message; };

async function start() {
  let choice: any;
  try { choice = JSON.parse(localStorage.getItem("societyer:app-runtime") ?? "null"); } catch { /* use the test workspace */ }
  if (choice?.mode !== "local" || typeof choice.workspaceId !== "string" || !choice.workspaceId) localStorage.setItem("societyer:app-runtime", JSON.stringify({ mode: "local", workspaceId, chosenAtISO: new Date().toISOString() }));
  const { localDataClient } = await import("./lib/localDataClient");
  await localDataClient.whenLocalWorkspaceReady();
  const existing = (await localDataClient.exportLocalWorkspaceSnapshot()).tables.societies ?? [];
  if (!existing.length) {
    const response = await fetch("/test-data/manifest.json");
    if (!response.ok) throw new Error("The test records could not be loaded. Please try again.");
    const manifest = await response.json();
    let loaded = 0;
    const parts = await Promise.all(manifest.parts.map(async (part: { file: string; bytes: number; sha256: string }) => {
      const response = await fetch("/test-data/" + part.file);
      if (!response.ok) throw new Error("A test record download was interrupted. Please try again.");
      const bytes = await response.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
      if (bytes.byteLength !== part.bytes || hash !== part.sha256) throw new Error("The test record download was incomplete. Please try again.");
      loaded++;
      updateStatus(`Loading test records (${loaded} of ${manifest.parts.length})…`);
      return bytes;
    }));
    updateStatus("Opening your local test workspace. The first visit may take a minute…");
    const data = await new Response(new Blob(parts).stream().pipeThrough(new DecompressionStream("gzip"))).blob();
    if (data.size !== manifest.uncompressedBytes) throw new Error("The test record download was incomplete. Please try again.");
    const { readWorkspaceBackupFile } = await import("./lib/localWorkspaceExport");
    const snapshot = await readWorkspaceBackupFile(new File([data], "pgair-connected-test-database.json", { type: "application/json" }));
    await localDataClient.importLocalWorkspaceSnapshot(snapshot);
    localStorage.setItem("societyer.currentSocietyId", societyId);
    localStorage.removeItem("societyer.currentUserId");
    localStorage.setItem("pgair-preview-source-sha256", manifest.uncompressedSHA256);
  }
  const hasTestSociety = !existing.length || existing.some((row: any) => row._id === societyId);
  if (hasTestSociety) {
  const { upgradeTestWorkspace } = await import("./sitesPreviewUpgrade");
  await upgradeTestWorkspace(localDataClient, updateStatus);
  const { upgradeSourceRecords } = await import("./sitesSourceRecordUpgrade");
  await upgradeSourceRecords(localDataClient, updateStatus);
  }
  if (window.location.pathname === "/" || window.location.pathname === "/index.html") {
    history.replaceState(null, "", "/app/people-history");
  }
  await import("./main");
}

// Importing shared build helpers does not start or seed an application shell.
if (status) void start().catch(error => {
  updateStatus(error instanceof Error ? error.message : "The test workspace could not be opened. Please try again.");
  const retry = document.getElementById("preview-retry") as HTMLButtonElement | null;
  if (retry) { retry.hidden = false; retry.addEventListener("click", () => location.reload(), { once: true }); }
});
