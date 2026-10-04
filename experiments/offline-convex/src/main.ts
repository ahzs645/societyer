import type { PowerSyncDatabase } from "@powersync/web";
import { DraftConnector } from "./connector";
import { openDatabase, saveDraft, type Draft, type Scope } from "./database";
import "./style.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let generation = 0;
let active: { db: PowerSyncDatabase; scope: Scope; connector: DraftConnector; abort: AbortController } | undefined;
let editId: string | undefined;
let busy = false;
async function request(path: string, body?: unknown) {
  const response = await fetch(`/__fixture/${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Upload failed.");
  return data;
}
function buttons() {
  const writable = active && active.scope.subject !== "viewer-a";
  $<HTMLButtonElement>("save").disabled = busy || !writable;
  $<HTMLButtonElement>("upload").disabled = busy || !active || !navigator.onLine;
  $<HTMLButtonElement>("retry").disabled = busy || !active || !navigator.onLine;
}
async function render() {
  const current = active;
  if (!current) return;
  const rows = await current.db.getAll<Draft>("SELECT * FROM offlineDrafts ORDER BY title");
  const queue = await current.db.getOptional<{ count: number }>("SELECT count(*) AS count FROM ps_crud");
  if (active !== current) return;
  $("queue").textContent = `${queue?.count ?? 0} pending operations`;
  $("drafts").replaceChildren(...rows.map(row => {
    const li = document.createElement("li");
    const text = document.createElement("span"); text.textContent = `${row.title}: ${row.content}`; li.append(text);
    if (current.scope.subject !== "viewer-a") {
      const button = document.createElement("button"); button.textContent = "Edit";
      button.onclick = () => { editId = row.id; $<HTMLInputElement>("title").value = row.title; $<HTMLTextAreaElement>("content").value = row.content; $("title").focus(); };
      li.append(button);
    }
    return li;
  }));
  buttons();
}
async function switchSession() {
  const version = ++generation;
  const previous = active; active = undefined;
  previous?.abort.abort();
  $("drafts").replaceChildren(); $("queue").textContent = ""; $("error").textContent = "";
  $<HTMLFormElement>("draft-form").reset(); editId = undefined; busy = false; buttons();
  $("status").textContent = "Opening local database…";
  if (previous) await previous.db.close();
  const subject = $<HTMLSelectElement>("actor").value;
  // Persist only this lab's fixture binding; no tokens or production membership decisions.
  const key = `societyer.offline-evaluation.session.${subject}`;
  const session = navigator.onLine ? await request(`session?subject=${encodeURIComponent(subject)}`) : JSON.parse(localStorage.getItem(key) ?? "null");
  if (!session) throw new Error("Open this evaluation account online once before using it offline.");
  const scope: Scope = { deployment: "convex-test:offline-evaluation", issuer: session.issuer, subject: session.subject, societyId: session.societyId };
  if (version !== generation) return;
  localStorage.setItem(key, JSON.stringify(session));
  localStorage.setItem("societyer.offline-evaluation.actor", subject);
  const db = await openDatabase(scope);
  if (version !== generation) { await db.close(); return; }
  const abort = new AbortController();
  const connector = new DraftConnector(scope, { applyBatch: batch => request("upload", { subject, batch }) }, () => version === generation);
  active = { db, scope, connector, abort };
  db.watch("SELECT * FROM offlineDrafts", [], { onResult: () => void render(), onError: showError }, { signal: abort.signal });
  $("status").textContent = navigator.onLine ? "Ready · local SQLite · fixture server" : "Ready · offline · saved on this device";
  await render();
}
function showError(error: unknown) { $("error").textContent = error instanceof Error ? error.message : String(error); }
$("draft-form").addEventListener("submit", async event => {
  event.preventDefault();
  const current = active; if (!current || busy || current.scope.subject === "viewer-a") return;
  busy = true; buttons(); $("error").textContent = "";
  try {
    await saveDraft(current.db, current.scope, $<HTMLInputElement>("title").value, $<HTMLTextAreaElement>("content").value, editId);
    if (active !== current) return;
    $<HTMLFormElement>("draft-form").reset(); editId = undefined;
    $("status").textContent = "Draft saved on this device.";
    await render();
  } catch (error) { if (active === current) showError(error); }
  finally { if (active === current) { busy = false; buttons(); } }
});
async function upload() {
  const current = active; if (!current || busy) return;
  busy = true; buttons(); $("error").textContent = "";
  try {
    while (active === current && await current.db.getNextCrudTransaction()) await current.connector.uploadData(current.db);
    if (active === current) { $("status").textContent = "Upload accepted by fixture server; live replication is not connected."; await render(); }
  } catch (error) { if (active === current) { showError(error); await render(); } }
  finally { if (active === current) { busy = false; buttons(); } }
}
$("upload").onclick = () => void upload(); $("retry").onclick = () => void upload();
$("actor").onchange = () => void switchSession().catch(showError);
window.addEventListener("online", buttons); window.addEventListener("offline", buttons);
$<HTMLSelectElement>("actor").value = localStorage.getItem("societyer.offline-evaluation.actor") ?? "owner-a";
void switchSession().catch(showError);
