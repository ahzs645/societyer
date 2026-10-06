/** Add complete source structure to this private test without replacing browser edits. */
const revision = "source-record-v3";
const marker = "pgair-preview-upgrade:" + revision;
export async function upgradeSourceRecords(client: any, updateStatus: (message: string) => void) {
  if (localStorage.getItem(marker) === "complete") return;
  updateStatus("Loading complete meeting source records…");
  const response = await fetch("/test-data/source-record-v3/manifest.json", { cache: "no-store" });
  if (!response.ok) throw new Error("The meeting source update could not be loaded. Please try again.");
  const manifest = await response.json();
  if (manifest.kind !== "pgair-source-record-v3-upgrade" || manifest.revision !== revision || manifest.societyId !== "static_society_workspace_1791180962204_fb1mbd") throw new Error("The meeting source update is not recognized.");
  let loaded = 0;
  for (const part of manifest.parts) {
    if (!/^records-\d+\.json$/.test(part.file)) throw new Error("The meeting source download is not recognized.");
    const response = await fetch("/test-data/source-record-v3/" + part.file, { cache: "no-store" });
    if (!response.ok) throw new Error("A meeting source download was interrupted. Please try again.");
    const bytes = await response.arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
    if (bytes.byteLength !== part.bytes || hash !== part.sha256) throw new Error("The meeting source download was incomplete. Please try again.");
    const data = JSON.parse(new TextDecoder().decode(bytes));
    for (let index = 0; index < data.entries.length; index += 5) {
      const entries = data.entries.slice(index, index + 5);
      updateStatus(`Completing meeting source records (${Math.min(loaded + entries.length, manifest.entries)} of ${manifest.entries})…`);
      await client.mutation("minutes:completeSourceRecords", { societyId: manifest.societyId, entries });
      loaded += entries.length;
    }
  }
  if (loaded !== manifest.entries) throw new Error("The meeting source update was incomplete. Please try again.");
  localStorage.setItem(marker, "complete");
}
