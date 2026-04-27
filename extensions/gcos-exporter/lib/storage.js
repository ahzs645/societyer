const STORAGE_KEYS = ["gcosApiBase", "gcosSocietyId", "gcosProjectId", "gcosProgramCode", "gcosAutoLoadProjects"];

export async function restoreSettings() {
  return await chrome.storage.local.get(STORAGE_KEYS);
}

export async function saveSettings(values) {
  await chrome.storage.local.set({
    gcosApiBase: values.apiBase,
    gcosSocietyId: values.societyId,
    gcosProjectId: values.projectId,
    gcosProgramCode: values.programCode,
    gcosAutoLoadProjects: values.autoLoadProjects,
  });
}
