import type { PowerSyncDatabase } from "@powersync/web";
import { openDatabase, type Scope } from "./database";
import { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { MeetingConnector, connectMeetingPilot, convexMeetingTransport, withSessionAbort } from "./meetingConnector";
import { exportMeetingRecovery, hydrateMeetingSnapshots, newKeys, prepareFile, saveMeetingCommand } from "./meetingStore";
import type { Download, FileDescriptor, MeetingCommand, Snapshot } from "./meetingProtocol";
import "./style.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const live = new URLSearchParams(location.search).get("live") === "1";
const run = new URLSearchParams(location.search).get("run") ?? "manual-live";
const liveQuery = (actor: string) => `actor=${encodeURIComponent(actor)}&run=${encodeURIComponent(run)}`;
async function liveRequest(path: string, actor: string, signal?: AbortSignal) {
  const response = await fetch(`/__live/${path}?${liveQuery(actor)}`, { signal });
  const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.error), { status: response.status }); return value;
}
const ref = (name: string) => makeFunctionReference<"query">(name);
const mutationRef = (name: string) => makeFunctionReference<"mutation">(name);
let generation = 0;
let active: { db: PowerSyncDatabase; scope: Scope; role: string; authorized: boolean; authorityEpoch: number; connector: MeetingConnector; abort: AbortController; client?: ConvexReactClient; cleanup?: () => Promise<void>; setup?: Promise<void>; stopIdentity?: () => void } | undefined;
let busy = false;
let renderGeneration = 0;
let renderedLocal = "";
const discussionEdits = new Map<string, string>();
async function request(path: string, body?: unknown) {
  const response = await fetch(`/__fixture/${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Fixture request failed.");
  return result;
}
function showError(error: unknown) { $("error").textContent = error instanceof Error ? error.message : String(error); }
function buttons() {
  const writable = active && ["Owner", "Admin", "Director"].includes(active.role);
  $<HTMLButtonElement>("save").disabled = busy || !writable;
  for (const id of ["upload", "files", "refresh"]) $<HTMLButtonElement>(id).disabled = busy || !active || !navigator.onLine || (id !== "refresh" && !writable);
  $<HTMLButtonElement>("export").disabled = busy || !active;
}
async function render() {
  const renderVersion = ++renderGeneration;
  const current = active; if (!current) return;
  const rows = await current.db.getAll<{ id: string; body: string }>("SELECT id, body FROM portableMeetingRows WHERE table_name = 'meetings'");
  const history = await current.db.getAll<{ meeting_uuid: string; state: string }>("SELECT meeting_uuid, state FROM meetingCommandHistory");
  const minutesRows = await current.db.getAll<{ body: string }>("SELECT body FROM portableMeetingRows WHERE table_name = 'minutes'");
  const files = await current.db.getAll<{ meeting_uuid: string; state: string }>("SELECT meeting_uuid, state FROM meetingFiles");
  const count = await current.db.getOptional<{ n: number }>("SELECT count(*) AS n FROM ps_crud");
  const snapshots = await current.db.getAll<{ payload: string }>("SELECT payload FROM fixtureMeetingSnapshots");
  if (active !== current || renderVersion !== renderGeneration) return;
  $("queue").textContent = `${count?.n ?? 0} pending commands`;
  const fingerprint = JSON.stringify([rows, minutesRows, history, files, current.role]);
  if (fingerprint !== renderedLocal) $("meetings").replaceChildren(...rows.map(row => {
    const meeting = JSON.parse(row.body);
    const minutes = minutesRows.map(row => JSON.parse(row.body)).find(item => item.meetingId === row.id);
    const states = history.filter(item => item.meeting_uuid === row.id).map(item => item.state);
    const state = states.includes("review") ? "Needs review" : states.includes("waiting") ? "Waiting to sync" : states.length ? (live ? "Accepted by live Convex" : "Accepted by fixture server") : (live ? "Downloaded via PowerSync" : "Downloaded fixture preparation");
    const li = document.createElement("li");
    const text = document.createElement("p"); text.textContent = `${meeting.title}: ${meeting.notes ?? ""} · ${state} · Minutes: ${minutes?.discussion ?? ""}`; li.append(text);
    const file = files.find(item => item.meeting_uuid === row.id);
    if (file) { const status = document.createElement("p"); status.textContent = file.state === "available" ? "Attachment bytes accepted" : "Attachment saved on this device; transfer pending"; li.append(status); }
    if (["Owner", "Admin", "Director"].includes(current.role) && !minutes?.approvedAt) {
      const form = document.createElement("form");
      const label = document.createElement("label"); label.textContent = "Minutes discussion";
      const input = document.createElement("textarea"); input.maxLength = 20_000; input.rows = 3; input.value = discussionEdits.get(row.id) ?? minutes?.discussion ?? "";
      input.oninput = () => { discussionEdits.set(row.id, input.value); }; label.append(input); form.append(label);
      const button = document.createElement("button"); button.textContent = "Save minutes on this device"; button.disabled = busy; form.append(button);
      form.onsubmit = event => { event.preventDefault(); void perform(async value => {
        const local = await value.db.getOptional<{ revision: number }>("SELECT revision FROM meetingLocalState WHERE id = ?", [row.id]);
        await saveMeetingCommand(value.db, value.scope, value.role, { version: 1, operationId: crypto.randomUUID(), meetingUuid: row.id, baseRevision: local!.revision, kind: "edit-minutes", discussion: discussionEdits.get(row.id) ?? input.value });
        if (active === value) { discussionEdits.delete(row.id); $("status").textContent = "Minutes saved on this device."; }
      }); };
      li.append(form);
    }
    return li;
  }));
  renderedLocal = fingerprint;
  for (const button of $("meetings").querySelectorAll("button")) button.disabled = busy;
  $("server").replaceChildren(...snapshots.map(row => {
    const snapshot: Snapshot = JSON.parse(row.payload);
    const li = document.createElement("li");
    const text = document.createElement("p"); text.textContent = `${snapshot.title} · revision ${snapshot.revision} · ${snapshot.discussion} · Agenda: ${snapshot.agenda.join(", ")}`; li.append(text);
    for (const file of snapshot.files) {
      const status = document.createElement("p"); status.textContent = `${file.name}: ${file.available ? "available from server" : "bytes not available from server"}`; li.append(status);
      if (file.available) {
        const button = document.createElement("button"); button.textContent = "Download attachment to this device"; button.disabled = busy || !navigator.onLine;
        button.onclick = () => void perform(async value => {
          const authorityEpoch = value.authorityEpoch;
          let result: { content: string };
          if (value.client) {
            const storageId = await value.client.query(ref("offlineMeetings:fileForDownload"), { societyId: value.scope.societyId, meetingUuid: snapshot.meetingUuid });
            const url = await value.client.query(ref("files:getUrl"), { storageId });
            const response = await fetch(url); if (!response.ok) throw new Error("Native attachment download failed.");
            result = { content: btoa(Array.from(new Uint8Array(await response.arrayBuffer()), byte => String.fromCharCode(byte)).join("")) };
          } else result = await request("meeting-download-file", { subject: value.scope.subject, societyId: value.scope.societyId, meetingUuid: snapshot.meetingUuid });
          if (active !== value) return;
          const bytes = Uint8Array.from(atob(result.content), c => c.charCodeAt(0));
          const prepared = await prepareFile(new File([bytes], file.name));
          if (prepared.descriptor.sha256 !== file.sha256 || prepared.descriptor.size !== file.size) throw new Error("Downloaded file hash mismatch.");
          if (active !== value) return;
          await value.db.writeTransaction(async tx => {
            if (active !== value || !value.authorized || value.authorityEpoch !== authorityEpoch) throw new Error("Attachment authorization changed before caching.");
            const current = value.client
              ? await tx.getOptional<{ payload: string }>("SELECT payload FROM offlineMeetingDownloads WHERE meeting_uuid = ? AND actor_key = ? AND society_id = ?", [snapshot.meetingUuid, `${value.scope.issuer}|${value.scope.subject}`, value.scope.societyId])
              : await tx.getOptional<{ payload: string }>("SELECT payload FROM fixtureMeetingSnapshots WHERE id = ?", [snapshot.meetingUuid]);
            const authorized: Snapshot | undefined = current ? JSON.parse(current.payload) : undefined;
            if (!authorized?.files.some(item => item.uuid === file.uuid && item.available && item.sha256 === file.sha256 && item.size === file.size)) throw new Error("Attachment authorization changed before caching.");
            // The permission row and byte write share one SQLite transaction;
            // a concurrent replicated deletion cannot be undone by this fetch.
            const found = await tx.getOptional("SELECT id FROM meetingFiles WHERE id = ?", [file.uuid]);
            if (found) await tx.execute("UPDATE meetingFiles SET content = ?, state = 'available', origin = COALESCE(origin, 'downloaded') WHERE id = ?", [prepared.content, file.uuid]);
            else await tx.execute("INSERT INTO meetingFiles (id, meeting_uuid, descriptor, content, state, origin) VALUES (?, ?, ?, ?, 'available', 'downloaded')", [file.uuid, snapshot.meetingUuid, JSON.stringify(prepared.descriptor), prepared.content]);
          });
          if (active === value) $("status").textContent = "Attachment downloaded and verified on this device.";
        }); li.append(button);
      }
    }
    return li;
  }));
  buttons();
}
async function perform(action: (current: NonNullable<typeof active>) => Promise<void>) {
  const current = active; if (!current || busy) return;
  busy = true; buttons(); $("error").textContent = "";
  try { await action(current); }
  catch (error) { if (active === current) showError(error); }
  finally { if (active === current) { busy = false; await render(); } }
}
async function switchSession() {
  const version = ++generation;
  const previous = active; active = undefined; previous?.abort.abort(); busy = false;
  renderedLocal = ""; discussionEdits.clear(); ++renderGeneration;
  $("meetings").replaceChildren(); $("server").replaceChildren(); $("error").textContent = ""; $("queue").textContent = ""; buttons();
  $<HTMLFormElement>("meeting-form").reset(); $("status").textContent = "Opening local database…";
  if (previous) {
    previous.stopIdentity?.();
    // close() synchronously disables this client, but its Promise can wait on
    // an offline WebSocket close handshake. Scope changes must not await that.
    void previous.client?.close().catch(() => {});
    await previous.setup?.catch(() => {});
    if (previous.cleanup) await previous.cleanup(); else await previous.db.close();
  }

  const subject = $<HTMLSelectElement>("actor").value;
  const key = live ? `societyer.meeting-pilot.live.${run}.session.${subject}` : `societyer.meeting-pilot.session.${subject}`;
  let unavailable = !navigator.onLine;
  let session;
  try { session = navigator.onLine ? await (live ? liveRequest("session", subject) : request(`session?subject=${encodeURIComponent(subject)}`)) : JSON.parse(localStorage.getItem(key) ?? "null"); }
  catch (error) {
    // Connectivity hints can still say online at offline startup. Only an
    // actual transport failure may use this lab's cached preparation binding;
    // authorization/HTTP rejections must never fall back to it.
    if (!(error instanceof TypeError)) throw error;
    unavailable = true; session = JSON.parse(localStorage.getItem(key) ?? "null");
  }
  if (!session) throw new Error("Open this evaluation account online once before using it offline.");
  if (version !== generation) return;
  const scope: Scope = { deployment: live ? session.deployment : "convex-test:meeting-pilot", issuer: session.issuer, subject: session.subject, societyId: session.societyId };
  const { token: _token, ...binding } = session; localStorage.setItem(key, JSON.stringify(binding)); localStorage.setItem("societyer.meeting-pilot.actor", subject);
  const db = await openDatabase(scope);
  if (version !== generation) { await db.close(); return; }
  const abort = new AbortController();
  const invalidateAuthority = async (error: unknown) => {
    const current = active;
    if (current?.db !== db || generation !== version) return;
    current.authorized = false; current.authorityEpoch += 1; current.role = "";
    localStorage.setItem(key, JSON.stringify({ ...binding, revoked: true }));
    await db.execute("DELETE FROM fixtureMeetingSnapshots");
    await hydrateMeetingSnapshots(db, scope, [], new Set(discussionEdits.keys()));
    if (active === current) { showError(error); await render(); }
  };
  const client = live ? new ConvexReactClient(scope.deployment, { unsavedChangesWarning: false, logger: false }) : undefined;
  const fetchAuth = async () => {
    if (generation !== version || !navigator.onLine) return null;
    try { const verified = await liveRequest("session", subject, abort.signal); return generation === version ? verified.token : null; }
    catch (error) {
      // An offline connectivity hint may be stale. Fail closed without an
      // unhandled rejected auth callback or persisting a credential offline.
      if ((error as { status?: number }).status === 403) await invalidateAuthority(error);
      else if (!(error instanceof TypeError) && generation === version) showError(error);
      return null;
    }
  };
  client?.setAuth(fetchAuth);
  const nativeTransport = client ? convexMeetingTransport(client, abort.signal) : undefined;
  const transport = nativeTransport ? { async applyCommand(args: Parameters<typeof nativeTransport.applyCommand>[0]) {
    try { return await nativeTransport.applyCommand(args); }
    catch (error) {
      if (/membership not found|membership is not active|User is disabled|External identity is disabled|Permission .* required/.test(String(error))) await invalidateAuthority(error);
      throw error;
    }
  } } : { applyCommand: (args: { societyId: string; command: MeetingCommand }) => request("meeting-command", { subject, args }) };
  const connector = new MeetingConnector(scope, transport, () => generation === version);
  active = { db, scope, connector, role: session.revoked ? "" : session.role, authorized: !session.revoked, authorityEpoch: 0, abort, client };
  if (client) {
    const current = active;
    current.setup = (async () => {
      const identityWatch = client.watchQuery(ref("offlineMeetings:syncIdentity"), { societyId: scope.societyId });
      current.stopIdentity = identityWatch.onUpdate(() => {
        if (active !== current) return;
        try { identityWatch.localQueryResult(); }
        catch (error) {
          if (/membership not found|membership is not active|disabled|Permission .* required/.test(String(error))) void invalidateAuthority(error).catch(problem => { if (generation === version) showError(problem); });
        }
      });
      try { current.cleanup = await connectMeetingPilot(db, scope, client, () => generation === version, async () => {
      let credentials;
      try { credentials = await liveRequest("credentials", subject, abort.signal); }
      catch (error) {
        if ((error as { status?: number }).status === 403) await invalidateAuthority(error);
        throw error;
      }
      // The normal SDK retry loop reaches this boundary after offline startup.
      // Refresh native auth, then verify scope before returning live credentials.
      client.setAuth(fetchAuth);
      const identity = await withSessionAbort(client.query(ref("offlineMeetings:syncIdentity"), { societyId: scope.societyId }), abort.signal);
      if (identity.actorKey !== `${scope.issuer}|${scope.subject}` || identity.societyId !== scope.societyId) throw new Error("Live credential scope mismatch.");
      if (active === current) { current.authorized = true; unavailable = false; }
      return credentials;
    }, showError, () => new Set(discussionEdits.keys()), async snapshots => {
      if (active !== current) return;
      if (!current.authorized) { snapshots = []; await hydrateMeetingSnapshots(db, scope, [], new Set(discussionEdits.keys())); }
      await db.writeTransaction(async tx => {
        await tx.execute("DELETE FROM fixtureMeetingSnapshots");
        for (const snapshot of snapshots) await tx.execute("INSERT INTO fixtureMeetingSnapshots (id, payload) VALUES (?, ?)", [snapshot.meetingUuid, JSON.stringify(snapshot)]);
      });
      if (active === current) {
        try { if (!unavailable && navigator.onLine) { const verified = await liveRequest("session", subject, abort.signal); if (active === current) { current.role = verified.role; const { token: _freshToken, ...freshBinding } = verified; localStorage.setItem(key, JSON.stringify(freshBinding)); } } }
        catch (error) { if (active === current) { current.role = ""; showError(error); } }
        if (active === current) await render();
      }
    }, unavailable, transport, () => current.authorized, abort.signal);
      } catch (error) {
        if (generation === version && active === current) throw error;
      }
    })();
    await current.setup;
    if (generation !== version || active !== current) return;
  }
  for (const table of ["portableMeetingRows", "meetingCommandHistory", "meetingFiles", "ps_crud"]) {
    db.watch(`SELECT * FROM ${table}`, [], { onResult: () => { if (active?.db === db) void render().catch(error => { if (active?.db === db) showError(error); }); }, onError: error => { if (active?.db === db) showError(error); } }, { signal: abort.signal });
  }
  $("status").textContent = unavailable ? "Ready · offline · saved on this device" : (live ? "Ready · live Convex and PowerSync · durable SQLite" : "Ready · meeting fixture · durable SQLite");
  await render();
}
$("meeting-form").onsubmit = event => { event.preventDefault(); void perform(async current => {
  const keys = newKeys();
  const file = $<HTMLInputElement>("file").files?.[0];
  const prepared = file ? await prepareFile(file) : undefined;
  if (active !== current) return;
  const command: MeetingCommand = { version: 1, operationId: crypto.randomUUID(), meetingUuid: keys.meeting, baseRevision: 0, kind: "create-meeting", keys,
    title: $<HTMLInputElement>("title").value, scheduledAt: new Date($<HTMLInputElement>("date").value).toISOString(), notes: $<HTMLTextAreaElement>("notes").value,
    agendaTitle: $<HTMLInputElement>("agenda").value, ...(prepared ? { file: prepared.descriptor } : {}) };
  await saveMeetingCommand(current.db, current.scope, current.role, command, prepared);
  if (active !== current) return;
  $<HTMLFormElement>("meeting-form").reset(); $("status").textContent = "Meeting and related records saved on this device.";
}); };
$("upload").onclick = () => void perform(async current => {
  while (active === current && await current.db.getNextCrudTransaction()) await current.connector.uploadData(current.db);
  if (active === current) $("status").textContent = (live ? "Commands accepted by live Convex. PowerSync downloads update automatically." : "Commands accepted by fixture server. Download confirmation and files are separate.");
});
$("files").onclick = () => void perform(async current => {
  const files = await current.db.getAll<{ id: string; meeting_uuid: string; descriptor: string; content: string }>("SELECT * FROM meetingFiles WHERE state = 'waiting'");
  for (const file of files) {
    if (active !== current) return;
    const history = await current.db.getAll<{ state: string; body: string }>("SELECT state, body FROM meetingCommandHistory WHERE meeting_uuid = ?", [file.meeting_uuid]);
    const parent = history.find(item => JSON.parse(item.body).kind === "create-meeting");
    if (parent?.state !== "accepted") throw new Error("Parent command must be accepted before transferring attachment bytes.");
    if (current.client) {
      const url = await current.client.mutation(mutationRef("offlineMeetings:prepareFileUpload"), { societyId: current.scope.societyId });
      const bytes = Uint8Array.from(atob(file.content), byte => byte.charCodeAt(0));
      const descriptor: FileDescriptor = JSON.parse(file.descriptor);
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": descriptor.mime }, body: bytes });
      if (!response.ok) throw new Error("Native attachment upload failed.");
      const { storageId } = await response.json();
      await current.client.mutation(mutationRef("offlineMeetings:commitFile"), { societyId: current.scope.societyId, meetingUuid: file.meeting_uuid, storageId });
    } else await request("meeting-file", { subject: current.scope.subject, societyId: current.scope.societyId, meetingUuid: file.meeting_uuid, content: file.content, descriptor: JSON.parse(file.descriptor) as FileDescriptor });
    if (active !== current) return;
    await current.db.execute("UPDATE meetingFiles SET state = 'available' WHERE id = ?", [file.id]);
  }
  if (active === current) $("status").textContent = (live ? "Attachment bytes accepted by live Convex." : "Attachment bytes accepted by fixture server.");
});
$("refresh").onclick = () => void perform(async current => {
  if (current.client) {
    await current.client.query(ref("offlineMeetings:syncIdentity"), { societyId: current.scope.societyId });
    $("status").textContent = "Current membership verified. The server view comes only from PowerSync replication."; return;
  }
  let downloads: Download[];
  try { downloads = await request(`meeting-downloads?subject=${encodeURIComponent(current.scope.subject)}`); }
  catch (error) {
    if (active === current && /membership|disabled|identity|Permission/.test(String(error))) {
      await current.db.execute("DELETE FROM fixtureMeetingSnapshots");
      await hydrateMeetingSnapshots(current.db, current.scope, [], new Set(discussionEdits.keys()));
    }
    throw error;
  }
  if (active !== current) return;
  if (downloads.some(row => row.actor_key !== `${current.scope.issuer}|${current.scope.subject}` || row.society_id !== current.scope.societyId)) throw new Error("Download scope mismatch.");
  await current.db.writeTransaction(async tx => {
    await tx.execute("DELETE FROM fixtureMeetingSnapshots");
    for (const row of downloads) await tx.execute("INSERT INTO fixtureMeetingSnapshots (id, payload) VALUES (?, ?)", [row.meeting_uuid, row.payload]);
  });
  if (active !== current) return;
  await hydrateMeetingSnapshots(current.db, current.scope, downloads.map(row => JSON.parse(row.payload)), new Set(discussionEdits.keys()));
  if (active === current) $("status").textContent = "Authorized fixture view refreshed. Live replication is not connected.";
});
$("export").onclick = () => void perform(async current => {
  const result = await exportMeetingRecovery(current.db, current.scope);
  if (active !== current) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "societyer-meeting-recovery.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("actor").onchange = () => { void switchSession().catch(showError); };
window.addEventListener("online", () => {
  buttons();
  if (live && active && !active.cleanup) void switchSession().catch(showError);
});
window.addEventListener("offline", buttons);
$<HTMLSelectElement>("actor").value = localStorage.getItem("societyer.meeting-pilot.actor") ?? "owner-a";
if (live) {
  document.querySelector("main > p")!.textContent = "Isolated local test: authenticated live Convex commands and real PowerSync replication. Test accounts are available only on this loopback pilot server.";
  $("refresh").textContent = "Verify current membership";
}
void switchSession().catch(showError);
