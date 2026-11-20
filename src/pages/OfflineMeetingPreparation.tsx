import { CloudOff, Download } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useConvex } from "convex/react";
import { makeFunctionReference } from "convex/server";
import type { PowerSyncDatabase } from "@powersync/web";
import { useAuth } from "../auth/AuthProvider";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { authenticatedFetch } from "../lib/authToken";
import { isLocalDataRuntime } from "../lib/staticRuntime";
import { PageHeader, PageLoading } from "./_helpers";
import { Badge, Banner, EmptyState } from "../components/ui";
import type { Crumb } from "../components/Breadcrumbs";
import { openDatabase, type Scope } from "../offline/database";
import { connectMeetingPilot } from "../offline/meetingConnector";
import { exportMeetingRecovery, newKeys, prepareFile, saveMeetingCommand, type LocalFile } from "../offline/meetingStore";
import { purgeDownloadedPreparation, reconcileAuthorizedPreparation } from "../offline/meetingPreparation";
import { meetingPreparationEnabled } from "../offline/config";
import { permanentMeetingFailure } from "../offline/meetingRecoveryPolicy";
import type { Snapshot } from "../../shared/offline/meetingProtocol";
import {
  AvailableAttachmentsCard,
  PreparedMeetingItem,
  PrepareMeetingCard,
  SavedAttachmentsCard,
  type CachedFile,
  type DraftRow,
  type MinutesDraft,
  type SnapshotFile,
} from "./OfflineMeetingPreparation.internal.sections";
import "./OfflineMeetingPreparation.css";

const OFFLINE_CRUMBS: Crumb[] = [{ label: "Meetings", to: "/app/meetings" }, { label: "Offline preparation" }];

const query = (name: string) => makeFunctionReference<"query">(name);
const mutation = (name: string) => makeFunctionReference<"mutation">(name);
type Session = { db: PowerSyncDatabase; scope: Scope; current: boolean; authorized: boolean; epoch: number; stop?: () => Promise<void>; abort: AbortController };
type History = { id: string; meeting_uuid: string; state: string; result: string | null };

export function OfflineMeetingPreparationPage() {
  const auth = useAuth();
  if (meetingPreparationEnabled() && auth.mode !== "none" && !isLocalDataRuntime()) return <MeetingPreparation />;
  return (
    <div className="page">
      <PageHeader breadcrumbs={OFFLINE_CRUMBS} title="Offline meeting preparation" />
      <div className="card">
        <div className="card__body">
          <EmptyState
            icon={<CloudOff size={20} />}
            title="Needs a connected server"
            description="Offline meeting preparation syncs drafts with your organization's server, so it isn't available in this workspace."
            action={<Link className="btn" to="/app/meetings">Go to meetings</Link>}
          />
        </div>
      </div>
    </div>
  );
}

function MeetingPreparation() {
  const convex = useConvex();
  const society = useSociety();
  const { loaded, can, role } = usePermissions();
  const canRead = loaded && ["meetings:read", "minutes:read", "agendas:read", "documents:read"].every(can);
  const canWrite = loaded && can("meetings:write") && can("minutes:write") && can("agendas:write");
  const session = useRef<Session>();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [cachedFiles, setCachedFiles] = useState<CachedFile[]>([]);
  const [replicatedFiles, setReplicatedFiles] = useState<Set<string>>(new Set());
  const [syncState, setSyncState] = useState("Waiting for sync");
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState("Connecting securely…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [discussion, setDiscussion] = useState<Record<string, MinutesDraft>>({});
  const roleRef = useRef(role); roleRef.current = role;
  const readRef = useRef(canRead); readRef.current = canRead;
  const writeRef = useRef(canWrite); writeRef.current = canWrite;
  const filesRef = useRef(can("documents:write")); filesRef.current = loaded && can("documents:write");

  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener("online", changed); window.addEventListener("offline", changed);
    return () => { window.removeEventListener("online", changed); window.removeEventListener("offline", changed); };
  }, []);

  useEffect(() => {
    if (!society?._id || !canRead) return;
    let current = true;
    let value: Session | undefined;
    let stopAuthority: (() => void) | undefined;
    let stopSyncStatus: (() => void) | undefined;
    let authoritative = new Map<string, Snapshot>();
    let preparation = Promise.resolve();
    const enqueueAuthority = (operation: () => Promise<void>) => {
      const queued = preparation.then(operation, operation);
      preparation = queued.catch(problem => { if (current) setError(String(problem)); });
      return queued;
    };
    setReady(false); setBusy(false); setRows([]); setSnapshots([]); setHistory([]); setCachedFiles([]); setReplicatedFiles(new Set()); setSyncState("Waiting for sync"); setDiscussion({}); setError(""); setStatus("Connecting securely…");
    const update = async () => {
      if (!value?.current || !current) return;
      const db = value.db;
      const records = await db.getAll<{ id: string; body: string }>("SELECT id, body FROM portableMeetingRows WHERE table_name = 'meetings'");
      const states = await db.getAll<{ id: string; revision: number; origin: string }>("SELECT id, revision, origin FROM meetingLocalState");
      const minutes = await db.getAll<{ body: string }>("SELECT body FROM portableMeetingRows WHERE table_name = 'minutes'");
      const log = await db.getAll<History>("SELECT * FROM meetingCommandHistory");
      const count = await db.getOptional<{ n: number }>("SELECT count(*) AS n FROM ps_crud");
      const files = await db.getAll<CachedFile>("SELECT * FROM meetingFiles");
      const downloads = await db.getAll<{ payload: string }>("SELECT payload FROM offlineMeetingDownloads WHERE society_id = ? AND actor_key = ?", [value.scope.societyId, `${value.scope.issuer}|${value.scope.subject}`]);
      if (!value.current || !current) return;
      setRows(records.filter(row => value!.authorized || states.find(item => item.id === row.id)?.origin === "authored").map(row => {
        const minute = minutes.map(item => JSON.parse(item.body)).find(item => item.meetingId === row.id);
        return { ...row, revision: states.find(item => item.id === row.id)?.revision ?? 0, discussion: minute?.discussion ?? "", approved: Boolean(minute?.approvedAt) };
      }));
      setHistory(log); setPending(count?.n ?? 0); setCachedFiles(files.filter(file => value!.authorized || file.origin === "authored"));
      setReplicatedFiles(new Set(value.authorized ? downloads.flatMap(row => (JSON.parse(row.payload) as Snapshot).files.filter(file => file.available).map(file => `${file.uuid}:${file.sha256}:${file.size}`)) : []));
    };
    const denied = async (problem: unknown, serialized = false) => {
      if (!value?.current || !current) return;
      value.authorized = false; value.epoch += 1;
      authoritative.clear();
      const purge = async () => {
        if (!current || !value?.current) return;
        await purgeDownloadedPreparation(value.db);
        if (value.current && current) { setSnapshots([]); setDiscussion({}); setError(String(problem)); setStatus("Access changed. Recovery remains on this device."); await update(); }
      };
      if (serialized) await purge(); else await enqueueAuthority(purge);
    };
    const credentials = async () => {
      const response = await authenticatedFetch("/api/v1/offline/meeting-preparation/credentials", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ societyId: society._id }), signal: value?.abort.signal });
      const result = await response.json();
      if (!response.ok) {
        const problem = new Error(result.error?.message ?? result.error ?? "Offline sync credentials are unavailable.");
        if (response.status === 401 || response.status === 403) await denied(problem);
        throw problem;
      }
      if (!current || !value?.current) throw new Error("Session changed.");
      if (result.identity?.actorKey !== `${value.scope.issuer}|${value.scope.subject}` || result.identity?.societyId !== value.scope.societyId) throw new Error("Credential identity does not match this workspace.");
      if (!value.authorized) {
        const epoch = value.epoch;
        const verified = await convex.query(query("offlineMeetings:authorizedSnapshot"), { societyId: value.scope.societyId }) as Snapshot[];
        await enqueueAuthority(async () => {
          if (!current || !value?.current || value.epoch !== epoch) throw new Error("Authorization changed while refreshing credentials.");
          value.epoch += 1; value.authorized = true;
          authoritative = new Map(verified.map(snapshot => [snapshot.meetingUuid, snapshot]));
          await reconcileAuthorizedPreparation(value.db, value.scope, verified);
          if (current) { setReady(true); setSnapshots(verified); await update(); }
        });
      }
      return { endpoint: result.endpoint, token: result.token };
    };
    void (async () => {
      const identity = await convex.query(query("offlineMeetings:syncIdentity"), { societyId: society._id });
      if (!current) return;
      const separator = identity.actorKey.lastIndexOf("|");
      if (separator < 1 || identity.societyId !== society._id) throw new Error("Invalid authorized offline identity.");
      const deployment = String(import.meta.env.VITE_CONVEX_URL ?? "");
      const scope: Scope = { deployment, issuer: identity.actorKey.slice(0, separator), subject: identity.actorKey.slice(separator + 1), societyId: identity.societyId };
      const db = await openDatabase(scope);
      if (!current) { await db.close(); return; }
      value = { db, scope, current: true, authorized: false, epoch: 0, abort: new AbortController() }; session.current = value;
      const syncChanged = (sync: typeof db.currentStatus) => {
        if (!current) return;
        setSyncState(sync.connected ? sync.hasSynced ? "Sync connected · Download confirmed" : "Sync connected · Waiting for first download" : sync.hasSynced ? "Saved download available · Sync will reconnect" : "Waiting for sync download");
      };
      stopSyncStatus = db.registerListener({ statusChanged: syncChanged }); syncChanged(db.currentStatus);
      for (const table of ["portableMeetingRows", "meetingCommandHistory", "meetingLocalState", "meetingFiles", "offlineMeetingDownloads", "ps_crud"]) db.watch(`SELECT * FROM ${table}`, [], { onResult: () => { void update().catch(problem => { if (current) setError(String(problem)); }); }, onError: problem => { if (current) setError(String(problem)); } }, { signal: value.abort.signal });
      // Native authorization reacts independently of SDK checkpoint progress.
      const authority = convex.watchQuery(query("offlineMeetings:authorizedSnapshot"), { societyId: society._id });
      const changed = () => {
        void enqueueAuthority(async () => {
          if (!current || !value?.current) return;
          try {
            const result = authority.localQueryResult() as Snapshot[] | undefined;
            if (!result) return;
            value.epoch += 1; value.authorized = true;
            authoritative = new Map(result.map(snapshot => [snapshot.meetingUuid, snapshot]));
            await reconcileAuthorizedPreparation(db, scope, result);
            if (current) { setReady(true); setSnapshots(result); await update(); }
          } catch (problem) {
            if (permanentMeetingFailure(problem) === "AUTHORIZATION_REJECTED") await denied(problem, true);
            else if (current) setError(String(problem));
          }
        }).catch(() => {});
      };
      stopAuthority = authority.onUpdate(changed); changed();
      const connected = await connectMeetingPilot(db, scope, convex, () => current && Boolean(value?.current), credentials,
        problem => { if (current) setError(String(problem)); }, () => new Set(), async () => { await update(); }, false, undefined,
        () => Boolean(value?.authorized), value.abort.signal, { onAuthorizationDenied: denied },
        incoming => incoming.map(snapshot => authoritative.get(snapshot.meetingUuid)).filter((snapshot): snapshot is Snapshot => Boolean(snapshot)));
      if (!current) { await connected(); return; }
      value.stop = connected;
      setReady(value.authorized); setStatus(value.authorized ? "Ready. Preparation is saved on this device." : "Preparation is saved on this device. Checking sync access."); await update();
    })().catch(problem => { if (current) setError(String(problem)); });
    return () => {
      current = false; stopAuthority?.(); stopSyncStatus?.();
      if (value) {
        value.current = false; value.abort.abort();
        if (session.current === value) session.current = undefined;
        // Do not disconnect the app's shared Convex client. This scope owns only
        // its PowerSync connection; recovery SQLite is retained across sign-out.
        void preparation.then(async () => { await purgeDownloadedPreparation(value!.db); if (value!.stop) await value!.stop(); else { await value!.db.disconnect(); await value!.db.close(); } }).catch(() => {});
      }
    };
  }, [convex, society?._id, canRead]);

  const perform = async (operation: (value: Session) => Promise<void>) => {
    const value = session.current;
    if (!value?.current || busy) return;
    setBusy(true);
    setError("");
    try {
      await operation(value);
    } catch (problem) {
      if (value.current) setError(String(problem));
    } finally {
      if (value.current) setBusy(false);
    }
  };

  const exportRecovery = () => void perform(async (value) => {
    const recovery = { ...await exportMeetingRecovery(value.db, value.scope), unsavedMinutes: discussion };
    if (!value.current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(recovery, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "societyer-meeting-recovery.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const dropDraft = (meetingId: string) => setDiscussion((previous) => {
    const next = { ...previous };
    delete next[meetingId];
    return next;
  });

  const createMeeting = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void perform(async (value) => {
      if (!writeRef.current || !readRef.current || !value.authorized) throw new Error("Meeting preparation is read only.");
      const candidate = data.get("attachment") as File | null;
      let file: LocalFile | undefined;
      if (candidate?.size) {
        if (!filesRef.current) throw new Error("Attachment write permission required.");
        file = await prepareFile(candidate);
      }
      const keys = newKeys();
      await saveMeetingCommand(value.db, value.scope, roleRef.current ?? "", {
        version: 1,
        operationId: crypto.randomUUID(),
        meetingUuid: keys.meeting,
        baseRevision: 0,
        kind: "create-meeting",
        keys,
        title: String(data.get("title")),
        scheduledAt: new Date(String(data.get("scheduledAt"))).toISOString(),
        notes: String(data.get("notes")),
        agendaTitle: String(data.get("agenda")),
        ...(file ? { file: file.descriptor } : {}),
      }, file);
      if (value.current) {
        form.reset();
        setStatus("Meeting saved on this device.");
      }
    });
  };

  const saveMinutes = (event: FormEvent<HTMLFormElement>, row: DraftRow) => {
    event.preventDefault();
    const text = discussion[row.id]?.text ?? row.discussion;
    const baseRevision = discussion[row.id]?.baseRevision ?? row.revision;
    void perform(async (value) => {
      if (!writeRef.current || !readRef.current || !value.authorized) throw new Error("Meeting preparation is read only.");
      await saveMeetingCommand(value.db, value.scope, roleRef.current ?? "", {
        version: 1,
        operationId: crypto.randomUUID(),
        meetingUuid: row.id,
        baseRevision,
        kind: "edit-minutes",
        discussion: text,
      });
      if (value.current) dropDraft(row.id);
    });
  };

  const sendAttachment = (row: DraftRow) => void perform(async (value) => {
    if (!value.authorized || !writeRef.current || !filesRef.current) throw new Error("Attachment write permission required.");
    const file = await value.db.getOptional<{ id: string; descriptor: string; content: string; state: string }>(
      "SELECT * FROM meetingFiles WHERE meeting_uuid = ? AND origin = 'authored'",
      [row.id],
    );
    if (!file || file.state === "available") return;
    const accepted = await value.db.getOptional("SELECT id FROM meetingCommandHistory WHERE meeting_uuid = ? AND state = 'accepted'", [row.id]);
    if (!accepted) throw new Error("Wait for meeting acceptance before sending the attachment.");
    const url = await convex.mutation(mutation("offlineMeetings:prepareFileUpload"), { societyId: value.scope.societyId });
    const descriptor = JSON.parse(file.descriptor);
    const bytes = Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0));
    const response = await fetch(url, { method: "POST", body: bytes, headers: { "content-type": descriptor.mime }, signal: value.abort.signal });
    if (!response.ok) throw new Error("Attachment transfer failed.");
    const result = await response.json();
    if (!value.current) return;
    await convex.mutation(mutation("offlineMeetings:commitFile"), { societyId: value.scope.societyId, meetingUuid: row.id, storageId: result.storageId });
    if (value.current) await value.db.execute("UPDATE meetingFiles SET state = 'available' WHERE id = ?", [file.id]);
  });

  const downloadSaved = (file: CachedFile) => void perform(async (value) => {
    const existing = await value.db.getOptional<CachedFile>("SELECT * FROM meetingFiles WHERE id = ?", [file.id]);
    if (!existing || !value.current || (existing.origin === "downloaded" && !value.authorized)) throw new Error("Attachment access changed.");
    const descriptor = JSON.parse(existing.descriptor);
    const bytes = Uint8Array.from(atob(existing.content), (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: descriptor.mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = descriptor.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const saveAvailable = (snapshot: Snapshot, file: SnapshotFile) => void perform(async (value) => {
    const epoch = value.epoch;
    const storageId = await convex.query(query("offlineMeetings:fileForDownload"), { societyId: value.scope.societyId, meetingUuid: snapshot.meetingUuid });
    const url = await convex.query(query("files:getUrl"), { storageId });
    const response = await fetch(url, { signal: value.abort.signal });
    if (!response.ok) throw new Error("Attachment download failed.");
    const prepared = await prepareFile(new File([await response.arrayBuffer()], file.name));
    if (prepared.descriptor.sha256 !== file.sha256 || prepared.descriptor.size !== file.size) throw new Error("Attachment verification failed.");
    if (!value.current || !value.authorized || value.epoch !== epoch) throw new Error("Attachment access changed.");
    await value.db.writeTransaction(async (tx) => {
      if (!value.current || !value.authorized || value.epoch !== epoch) throw new Error("Attachment access changed.");
      const allowed = await tx.getOptional<{ payload: string }>(
        "SELECT payload FROM offlineMeetingDownloads WHERE meeting_uuid = ? AND actor_key = ? AND society_id = ?",
        [snapshot.meetingUuid, `${value.scope.issuer}|${value.scope.subject}`, value.scope.societyId],
      );
      const stillAvailable = allowed && (JSON.parse(allowed.payload) as Snapshot).files
        .some((item) => item.uuid === file.uuid && item.sha256 === file.sha256 && item.available);
      if (!stillAvailable) throw new Error("Attachment access changed.");
      const existing = await tx.getOptional("SELECT id FROM meetingFiles WHERE id = ?", [file.uuid]);
      if (existing) {
        await tx.execute("UPDATE meetingFiles SET content = ?, state = 'available' WHERE id = ?", [prepared.content, file.uuid]);
      } else {
        await tx.execute(
          "INSERT INTO meetingFiles (id, meeting_uuid, descriptor, content, state, origin) VALUES (?, ?, ?, ?, 'available', 'downloaded')",
          [file.uuid, snapshot.meetingUuid, JSON.stringify(prepared.descriptor), prepared.content],
        );
      }
    });
    if (value.current) setStatus("Attachment verified and saved on this device.");
  });

  if (!loaded) return <PageLoading label="Offline meeting preparation" />;
  if (!canRead) {
    return (
      <div className="page">
        <PageHeader breadcrumbs={OFFLINE_CRUMBS} title="Offline meeting preparation" />
        <div className="card">
          <div className="card__body">
            <EmptyState
              icon={<CloudOff size={20} />}
              title="Not available for your role"
              description="Your role does not allow access to the resources used for meeting preparation."
              action={<Link className="btn" to="/app/meetings">Go to meetings</Link>}
            />
          </div>
        </div>
      </div>
    );
  }

  const editingLocked = busy || !ready || !session.current?.authorized;
  const quarantined = history.filter((item) => item.state === "quarantined").length;
  const retrying = history.filter((item) => item.state === "review").length;
  const availableFiles = snapshots.flatMap((snapshot) => snapshot.files
    .filter((file) => file.available)
    .map((file) => ({ snapshot, file })));

  const renderMeeting = (row: DraftRow) => {
    const log = history.filter((item) => item.meeting_uuid === row.id);
    const needsReview = log.some((item) => item.state === "quarantined" || item.state === "review");
    const attachment = cachedFiles.find((file) => file.meeting_uuid === row.id && file.origin === "authored");
    return (
      <PreparedMeetingItem
        key={row.id}
        row={row}
        needsReview={needsReview}
        waiting={log.some((item) => item.state === "waiting")}
        attachment={attachment}
        draft={discussion[row.id]}
        editable={canWrite && !row.approved && !needsReview}
        locked={editingLocked}
        attachmentLocked={busy || !online || !ready || !canWrite || !can("documents:write") || needsReview || attachment?.state === "available"}
        onDraftChange={(text) => setDiscussion((previous) => ({
          ...previous,
          [row.id]: { text, baseRevision: previous[row.id]?.baseRevision ?? row.revision },
        }))}
        onUseSynced={() => dropDraft(row.id)}
        onSaveMinutes={(event) => saveMinutes(event, row)}
        onSendAttachment={() => sendAttachment(row)}
      />
    );
  };

  return (
    <div className="page offline-meeting-preparation">
      <PageHeader
        breadcrumbs={OFFLINE_CRUMBS}
        title="Offline meeting preparation"
        subtitle="Prepare meetings, agenda items and minutes on this device. Changes sync when connected."
        info={
          <p>
            Only meetings prepared here are included. Open this page while signed in before disconnecting. Approval and
            formal adoption use the online meeting workspace.
          </p>
        }
        actions={
          <button className="btn-action" type="button" disabled={!ready || busy} onClick={exportRecovery}>
            <Download size={12} /> Export recovery
          </button>
        }
      />

      <Banner className="offline-meeting-status" tone={online ? "info" : "warn"} title={status}>
        {online ? "Online" : "Offline"} · {pending} pending commands · {syncState}
      </Banner>
      {error && <Banner tone="danger">{error}</Banner>}
      {quarantined + retrying > 0 && (
        <section aria-label="Edits needing review">
          <Banner tone="warn" title="Needs review">
            <p>Saved edits remain in recovery even when a meeting is no longer displayed. Export recovery to reconcile these edits.</p>
            <p>{quarantined} quarantined edits · {retrying} edits waiting for retry.</p>
          </Banner>
        </section>
      )}

      {canWrite && (
        <PrepareMeetingCard formKey={society?._id} locked={editingLocked} canAttach={can("documents:write")} onSubmit={createMeeting} />
      )}

      <section className="card" aria-labelledby="offline-meeting-list-title">
        <div className="card__head">
          <h2 className="card__title" id="offline-meeting-list-title">Preparation on this device</h2>
          <Badge>{rows.length}</Badge>
        </div>
        {rows.length ? (
          <ul className="offline-meeting-list">{rows.map(renderMeeting)}</ul>
        ) : (
          <div className="card__body">
            <EmptyState size="sm" title="No meetings prepared on this device yet" />
          </div>
        )}
      </section>

      {cachedFiles.length > 0 && (
        <SavedAttachmentsCard files={cachedFiles} locked={busy || !ready} onDownload={downloadSaved} />
      )}
      <AvailableAttachmentsCard
        files={availableFiles}
        isReplicated={(file) => replicatedFiles.has(`${file.uuid}:${file.sha256}:${file.size}`)}
        locked={busy || !online || !ready}
        onSave={saveAvailable}
      />
    </div>
  );
}
