import { exportActiveGcosTab, fetchActiveGcosProjects } from "./lib/chrome-runtime.js";
import { copySnapshot, downloadSnapshot } from "./lib/files.js";
import { importSnapshot } from "./lib/societyer-api.js";
import { restoreSettings, saveSettings } from "./lib/storage.js";
import {
  $,
  clearSnapshotOutput,
  readFormValues,
  renderProjectList,
  renderProjectListMessage,
  setBusy,
  setStatus,
  writeSnapshot,
} from "./lib/dom.js";

const state = { snapshot: null, projectsLoading: false };

function hasSnapshot() {
  return Boolean(state.snapshot);
}

async function exportWithInput(input) {
  setBusy(true, hasSnapshot());
  setStatus("Exporting GCOS pages...");
  try {
    const snapshot = await exportActiveGcosTab(input);
    state.snapshot = snapshot;
    const json = writeSnapshot(snapshot);
    await saveSettings(readFormValues());
    setStatus(`Exported ${snapshot.normalizedGrant?.title || "GCOS project"} (${json.length} bytes).`, "ok");
  } catch (error) {
    state.snapshot = null;
    clearSnapshotOutput();
    setStatus(error?.message || String(error), "error");
  } finally {
    setBusy(false, hasSnapshot());
  }
}

async function runExport() {
  const form = readFormValues();
  await exportWithInput({
    projectId: form.projectId,
    programCode: form.programCode,
  });
}

async function runProjectExport(project) {
  $("projectId").value = project.projectId || "";
  if (!$("programCode").value && project.programCode) $("programCode").value = project.programCode;
  await exportWithInput({
    projectId: project.projectId,
    programCode: $("programCode").value.trim(),
  });
}

async function loadProjectList() {
  if (state.projectsLoading) return;
  state.projectsLoading = true;
  $("refreshProjects").disabled = true;
  renderProjectListMessage("Loading projects...");
  try {
    const projects = await fetchActiveGcosProjects();
    renderProjectList(projects, { onExport: runProjectExport });
    setStatus(`Loaded ${projects.length} GCOS project${projects.length === 1 ? "" : "s"}.`, "ok");
  } catch (error) {
    renderProjectListMessage(error?.message || "Could not load projects. Make sure you are logged into GCOS.", "error");
  } finally {
    state.projectsLoading = false;
    $("refreshProjects").disabled = false;
  }
}

async function runCopy() {
  if (!state.snapshot) return;
  await copySnapshot(state.snapshot);
  setStatus("Copied GCOS JSON to clipboard.", "ok");
}

async function runDownload() {
  if (!state.snapshot) return;
  await downloadSnapshot(state.snapshot);
  setStatus("Download started.", "ok");
}

async function runImport() {
  if (!state.snapshot) return;
  setBusy(true, hasSnapshot());
  setStatus("Importing into Societyer...");
  try {
    const form = readFormValues();
    const payload = await importSnapshot({
      apiBase: form.apiBase,
      societyId: form.societyId,
      snapshot: state.snapshot,
    });
    await saveSettings(form);
    setStatus(`Imported into Societyer: ${payload?.data?.normalizedGrant?.title || payload?.data?.import?.grantId || "GCOS grant"}.`, "ok");
  } catch (error) {
    setStatus(error?.message || String(error), "error");
  } finally {
    setBusy(false, hasSnapshot());
  }
}

async function hydrateForm() {
  const saved = await restoreSettings();
  $("apiBase").value = saved.gcosApiBase || "http://127.0.0.1:5180/api/v1/browser-connectors";
  $("societyId").value = saved.gcosSocietyId || "";
  $("projectId").value = saved.gcosProjectId || "";
  $("programCode").value = saved.gcosProgramCode || "";
  $("autoLoadProjects").checked = saved.gcosAutoLoadProjects !== false;
}

document.addEventListener("DOMContentLoaded", async () => {
  await hydrateForm();
  $("refreshProjects").addEventListener("click", loadProjectList);
  $("exportJson").addEventListener("click", runExport);
  $("copyJson").addEventListener("click", runCopy);
  $("downloadJson").addEventListener("click", runDownload);
  $("importJson").addEventListener("click", runImport);
  for (const id of ["apiBase", "societyId", "projectId", "programCode", "autoLoadProjects"]) {
    $(id).addEventListener("change", () => saveSettings(readFormValues()));
  }
  setBusy(false, hasSnapshot());
  if ($("autoLoadProjects").checked) void loadProjectList();
});
