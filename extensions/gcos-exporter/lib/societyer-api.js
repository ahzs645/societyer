export async function importSnapshot({ apiBase, societyId, snapshot }) {
  if (!apiBase) throw new Error("Set the Societyer API base before importing.");
  const response = await fetch(`${apiBase}/connectors/gcos/import-exported-snapshot`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      societyId: societyId || undefined,
      snapshot,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error?.message || payload?.error || `Import failed (${response.status}).`);
  }
  return payload;
}
