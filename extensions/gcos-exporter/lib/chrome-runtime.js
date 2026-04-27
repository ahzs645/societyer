import { exportGcosSnapshotInPage } from "./page-exporter.js";
import { fetchGcosProjectsInPage } from "./project-list.js";

export async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active browser tab was found.");
  return tab;
}

export async function exportActiveGcosTab(input) {
  const tab = await activeTab();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: exportGcosSnapshotInPage,
    args: [input],
    world: "MAIN",
  });
  if (!result?.ok) throw new Error(result?.error || "GCOS export failed.");
  return result.snapshot;
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
