export function filenameFor(snapshot) {
  const project = snapshot?.projectId || snapshot?.normalizedGrant?.confirmationCode || "gcos";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `societyer-gcos-${String(project).replace(/[^a-z0-9_-]+/gi, "-")}-${stamp}.json`;
}

export async function copySnapshot(snapshot) {
  await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
}

export async function downloadSnapshot(snapshot) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({
    url,
    filename: filenameFor(snapshot),
    saveAs: true,
  });
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
