import {
  clearBackgroundGcosExportJob,
  fetchActiveGcosProjects,
  getBackgroundGcosExportJob,
  startBackgroundGcosExport,
} from "./lib/chrome-runtime.js";
import { copySnapshot } from "./lib/files.js";
import { importSnapshot } from "./lib/societyer-api.js";
import { restoreSettings, saveSettings } from "./lib/storage.js";
import {
  $,
  clearSnapshotOutput,
  readFormValues,
  renderExportJob,
  renderProjectList,
  renderProjectListMessage,
  setSelectedProjectSummary,
  setBusy,
  setStatus,
  writeSnapshot,
} from "./lib/dom.js";

const state = { snapshot: null, projects: [], projectsLoading: false, selectedProject: null, exportPoll: null };

function hasSnapshot() {
  return Boolean(state.snapshot);
}

async function exportWithInput(input) {
  setBusy(true, hasSnapshot());
  setStatus("Export running in background. You can close and reopen this popup.");
  try {
    const job = await startBackgroundGcosExport(input);
    renderExportJob(job);
    await saveSettings(readFormValues());
    startExportPolling();
  } catch (error) {
    state.snapshot = null;
    clearSnapshotOutput();
    setStatus(error?.message || String(error), "error");
    renderExportJob(null);
    setBusy(false, hasSnapshot());
  }
}

function applyExportJob(job) {
  renderExportJob(job);
  if (!job) {
    setBusy(false, hasSnapshot());
    return;
  }
  if (job.status === "running") {
    setBusy(true, hasSnapshot());
    setStatus("Export running in background. You can close and reopen this popup.");
    return;
  }
  if (job.status === "complete") {
    state.snapshot = job.snapshot;
    const json = writeSnapshot(job.snapshot);
    setBusy(false, hasSnapshot());
    setStatus(`Export downloaded: ${job.snapshot?.normalizedGrant?.title || "GCOS project"} (${json.length} bytes).`, "ok");
    stopExportPolling();
    return;
  }
  if (job.status === "error") {
    setBusy(false, hasSnapshot());
    setStatus(job.error || "GCOS export failed.", "error");
    stopExportPolling();
  }
}

async function refreshExportJob() {
  try {
    applyExportJob(await getBackgroundGcosExportJob());
  } catch (error) {
    setStatus(error?.message || String(error), "error");
  }
}

function startExportPolling() {
  stopExportPolling();
  state.exportPoll = window.setInterval(refreshExportJob, 800);
  void refreshExportJob();
}

function stopExportPolling() {
  if (state.exportPoll) {
    window.clearInterval(state.exportPoll);
    state.exportPoll = null;
  }
}

async function runExport() {
  const form = readFormValues();
  await exportWithInput({
    projectId: form.projectId,
    programCode: form.programCode,
    format: "json",
  });
}

async function runZipExport() {
  const form = readFormValues();
  await exportWithInput({
    projectId: form.projectId,
    programCode: form.programCode,
    format: "zip",
  });
}

function selectProject(project) {
  state.selectedProject = project;
  $("projectId").value = project.projectId || "";
  if (!$("programCode").value) $("programCode").value = project.programCode || inferProgramCode(project);
  setSelectedProjectSummary(project);
  renderProjectList(state.projects, { onSelect: selectProject }, project.projectId);
  void saveSettings(readFormValues());
  setStatus(`Selected ${project.title || `GCOS project ${project.projectId}`}.`, "ok");
}

function inferProgramCode(project) {
  const text = `${project.program || ""} ${project.programGroup || ""}`;
  if (/canada summer jobs|csj/i.test(text)) return "CSJ";
  return "";
}

async function loadProjectList() {
  if (state.projectsLoading) return;
  state.projectsLoading = true;
  $("refreshProjects").disabled = true;
  renderProjectListMessage("Loading projects...");
  try {
    const projects = await fetchActiveGcosProjects();
    state.projects = projects;
    const selectedProjectId = $("projectId").value.trim();
    if (selectedProjectId) {
      state.selectedProject = projects.find((project) => project.projectId === selectedProjectId) ?? state.selectedProject;
      setSelectedProjectSummary(state.selectedProject);
    }
    renderProjectList(projects, { onSelect: selectProject }, selectedProjectId);
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
  setSelectedProjectSummary(null);
}

document.addEventListener("DOMContentLoaded", async () => {
  await hydrateForm();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.gcosExportJob) applyExportJob(changes.gcosExportJob.newValue || null);
  });
  $("refreshProjects").addEventListener("click", loadProjectList);
  $("exportJson").addEventListener("click", runExport);
  $("exportZip").addEventListener("click", runZipExport);
  $("copyJson").addEventListener("click", runCopy);
  $("importJson").addEventListener("click", runImport);
  for (const id of ["apiBase", "societyId", "projectId", "programCode", "autoLoadProjects"]) {
    $(id).addEventListener("change", () => {
      if (id === "projectId") {
        const project = state.projects.find((candidate) => candidate.projectId === $("projectId").value.trim()) ?? null;
        state.selectedProject = project;
        setSelectedProjectSummary(project);
        renderProjectList(state.projects, { onSelect: selectProject }, $("projectId").value.trim());
      }
      saveSettings(readFormValues());
    });
  }
  setBusy(false, hasSnapshot());
  await refreshExportJob();
  const job = await getBackgroundGcosExportJob().catch(() => null);
  if (job?.status === "running") startExportPolling();
  if (job?.status === "complete" || job?.status === "error") {
    window.setTimeout(() => clearBackgroundGcosExportJob().catch(() => undefined), 30_000);
  }
  if ($("autoLoadProjects").checked) void loadProjectList();
});
