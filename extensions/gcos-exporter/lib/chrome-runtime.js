import { fetchGcosProjectsInPage } from "./project-list.js";

export async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active browser tab was found.");
  return tab;
}

export async function startBackgroundGcosExport(input) {
  const response = await chrome.runtime.sendMessage({ action: "gcos:startExport", input });
  if (!response?.ok) throw new Error(response?.error || "Could not start GCOS export.");
  return response.job;
}

export async function getBackgroundGcosExportJob() {
  const response = await chrome.runtime.sendMessage({ action: "gcos:getExportJob" });
  if (!response?.ok) throw new Error(response?.error || "Could not read GCOS export progress.");
  return response.job;
}

export async function clearBackgroundGcosExportJob() {
  const response = await chrome.runtime.sendMessage({ action: "gcos:clearExportJob" });
  if (!response?.ok) throw new Error(response?.error || "Could not clear GCOS export progress.");
}

export async function fetchActiveGcosProjects() {
  const tab = await activeTab();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fetchGcosProjectsInPage,
    args: [],
    world: "MAIN",
  });
  if (!result?.ok) throw new Error(result?.error || "Could not load GCOS projects.");
  return result.projects ?? [];
}
