import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Modal, useConfirm } from "../../../components/Modal";
import { Select } from "../../../components/Select";
import { usePermissions } from "../../../hooks/usePermissions";
import { isLocalDataRuntime } from "../../../lib/staticRuntime";
import { meetingSourceBroker, sourceRequest, type MeetingSource } from "../../../lib/meetingSourceUpload";
import { DEFAULT_WHISPERX_SETTINGS, WHISPERX_MODELS, type WhisperXSettings } from "../../../../shared/transcription/protocol";

type Job = { id: string; sourceId: string; status: string; phase: string | null; progress: number | null; error: string | null; segmentCount: number; pageCount: number; settings: WhisperXSettings };
type Connection = { id: string; name: string; enabled: boolean; settings: WhisperXSettings; heartbeatAt: number | null; capabilities: { cuda?: boolean; diarization?: boolean; models?: string[] } | null };
export function WhisperXQueue(props: { societyId: string; meetingId: string; transcript?: { _id?: string; createdAtISO?: string; contentRevision?: string } | null }) {
  if (isLocalDataRuntime() || !meetingSourceBroker) return null;
  return <ConnectedQueue key={props.meetingId} {...props} />;
}
function ConnectedQueue({ societyId, meetingId, transcript }: { societyId: string; meetingId: string; transcript?: { _id?: string; createdAtISO?: string; contentRevision?: string } | null }) {
  const { can } = usePermissions(); const confirm = useConfirm();
  const connection = useQuery(api.meetingTranscription.settings, { societyId }) as Connection | null | undefined;
  const jobs = useQuery(api.meetingTranscription.jobs, { meetingId }) as Job[] | undefined;
  const enqueue = useMutation(api.meetingTranscription.enqueue); const cancel = useMutation(api.meetingTranscription.cancel); const apply = useMutation(api.meetingTranscription.apply);
  const [sources, setSources] = useState<MeetingSource[]>([]); const [sourceId, setSourceId] = useState("");
  const [configure, setConfigure] = useState(false); const [preview, setPreview] = useState<Job | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const refresh = async () => { const rows: MeetingSource[] = await sourceRequest("list", { meetingId }); setSources(rows.filter(s => s.kind === "recording" && s.status === "ready")); };
  useEffect(() => { let active = true; sourceRequest("list", { meetingId }).then((rows: MeetingSource[]) => { if (active) setSources(rows.filter(s => s.kind === "recording" && s.status === "ready")); }).catch(() => { if (active) setError("Recordings could not be loaded. Refresh to retry."); }); return () => { active = false; }; }, [meetingId]);
  async function run(action: () => Promise<unknown>) { if (busy) return; setBusy(true); setError(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Transcription request failed."); } finally { setBusy(false); } }
  const online = connection?.heartbeatAt && Date.now() - connection.heartbeatAt < 120_000;
  return <section className="card" aria-label="WhisperX transcription queue" style={{ padding: 16, marginBottom: 16 }}>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}><h3>WhisperX transcription</h3>{can("settings:write") && <button className="btn-action" onClick={() => setConfigure(true)}>Processor settings</button>}</div>
    <p className="transcript-muted">{connection === undefined ? "Checking processor connection…" : !connection?.enabled ? "Connect a Zoer processor to transcribe attached recordings." : online ? "Zoer processor connected. Recordings are processed one at a time." : "Waiting for the Zoer processor. Queued recordings will wait safely until it connects."}</p>
    {can("meetings:write") && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}><Select aria-label="Recording to transcribe" value={sourceId} onChange={setSourceId} options={sources.map(s => ({ value: s.id, label: `${s.fileName} (${(s.size / 1024 / 1024).toFixed(1)} MB)` }))} placeholder="Choose an attached recording" /><button className="btn-action" disabled={busy || !connection?.enabled || !sourceId} onClick={() => void run(() => enqueue({ sourceId }))}>Queue transcription</button><button className="btn-action" disabled={busy} onClick={() => void run(refresh)}>Refresh recordings</button></div>}
    {!sources.length && <p><Link to="?tab=sources">Upload a recording in Sources</Link>, then refresh the recording list here.</p>}
    {error && <p role="alert" className="transcript-error">{error}</p>}
    <ul style={{ listStyle: "none", padding: 0 }}>{jobs?.map(job => <li key={job.id} style={{ borderTop: "1px solid var(--border)", paddingBlock: 10 }}>
      <strong>{sources.find(s => s.id === job.sourceId)?.fileName ?? "Recording"}</strong> · {job.status} · {job.settings.model}<p className="transcript-muted" role="status">{job.phase}{job.status === "running" && job.progress !== null ? ` · ${Math.round(job.progress * 100)}%` : ""}{job.error && ` · ${job.error}`}</p>
      {job.status === "running" && <progress max={1} value={job.progress ?? 0} aria-label="Transcription progress" />}
      {job.status === "ready" && <><button className="btn-action" onClick={() => setPreview(job)}>Review {job.segmentCount.toLocaleString()} segments</button>{can("meetings:write") && <button className="btn-action" disabled={busy} onClick={() => void run(async () => { if (!await confirm({ title: "Use this transcript?", message: transcript ? "Replace the current working transcript with this WhisperX result? Draft and approved minutes are kept." : "Use this WhisperX result as the meeting’s working transcript?", confirmLabel: "Use transcript" })) return; await apply({ jobId: job.id, replace: Boolean(transcript), expectedRevision: transcript ? transcript.contentRevision ?? `${transcript._id}:${transcript.createdAtISO}` : undefined }); })}>Use transcript</button>}</>}
      {can("meetings:write") && ["queued", "running", "ready"].includes(job.status) && <button className="btn-action" disabled={busy} onClick={() => void run(() => cancel({ jobId: job.id }))}>Cancel</button>}
      {can("meetings:write") && ["failed", "cancelled"].includes(job.status) && <button className="btn-action" disabled={busy || !connection?.enabled} onClick={() => void run(() => enqueue({ sourceId: job.sourceId, settings: job.settings }))}>Retry</button>}
    </li>)}</ul>
    {configure && <ProcessorSettings societyId={societyId} connection={connection ?? null} close={() => setConfigure(false)} />}
    {preview && <CandidatePreview job={preview} close={() => setPreview(null)} />}
  </section>;
}
function CandidatePreview({ job, close }: { job: Job; close: () => void }) {
  const [index, setIndex] = useState(0); const page = useQuery(api.meetingTranscription.page, { jobId: job.id, page: index });
  return <Modal open onClose={close} title="Review WhisperX transcript" size="xl"><p>This candidate has not replaced the meeting transcript.</p><div className="transcript-toolbar__actions"><button className="btn-action" disabled={!index} onClick={() => setIndex(index - 1)}>Previous</button><span>Page {index + 1} of {job.pageCount}</span><button className="btn-action" disabled={index + 1 >= job.pageCount} onClick={() => setIndex(index + 1)}>Next</button></div>{page ? page.segments.map((s: { text: string; speaker: string; startSec: number }, i: number) => <p key={i}><strong>{Math.floor(s.startSec / 60)}:{String(Math.floor(s.startSec % 60)).padStart(2, "0")} {s.speaker}</strong> {s.text}</p>) : <p role="status">Loading transcript page…</p>}</Modal>;
}
function ProcessorSettings({ societyId, connection, close }: { societyId: string; connection: Connection | null; close: () => void }) {
  const configure = useMutation(api.meetingTranscription.configure);
  const [settings, setSettings] = useState<WhisperXSettings>(connection?.settings ?? DEFAULT_WHISPERX_SETTINGS);
  const [enabled, setEnabled] = useState(connection?.enabled ?? true); const [allow, setAllow] = useState(Boolean(connection));
  const [pairingKey, setPairingKey] = useState(""); const [keySaved, setKeySaved] = useState(false); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const update = <K extends keyof WhisperXSettings>(key: K, value: WhisperXSettings[K]) => setSettings(s => ({ ...s, [key]: value }));
  return <Modal open onClose={close} title="Zoer transcription processor" size="lg"><form onSubmit={event => { event.preventDefault(); setBusy(true); setError(""); void (async () => { try {
    const keyHash = pairingKey ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pairingKey))), b => b.toString(16).padStart(2, "0")).join("") : undefined;
    await configure({ societyId, enabled, name: "Zoer WhisperX", settings, keyHash, allowRecordingProcessing: allow }); if (pairingKey) setKeySaved(true); else close();
  } catch (e) { setError(e instanceof Error ? e.message : "Could not save settings."); } finally { setBusy(false); } })(); }}>
    <p>Zoer can read only recordings queued in this workspace and return transcript results. This includes any private meeting sections in those recordings. Applying results requires a meeting editor.</p>
    <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Enable processor connection</label>
    <div style={{ display: "grid", gap: 12, marginBlock: 16 }}>
      <label>Whisper model<Select value={settings.model} onChange={v => update("model", v)} options={WHISPERX_MODELS.map(value => ({ value, label: value, disabled: Boolean(connection?.capabilities?.models && !connection.capabilities.models.includes(value)) }))} /></label>
      <label>Language (auto or language code)<input className="form-input" value={settings.language} maxLength={4} onChange={e => update("language", e.target.value)} /></label>
      <label>Device<Select value={settings.device} onChange={v => update("device", v)} options={[{ value: "cpu", label: "CPU" }, { value: "cuda", label: "CUDA GPU", disabled: !connection?.capabilities?.cuda }]} /></label>
      <label>Batch size<input className="form-input" type="number" min={1} max={32} value={settings.batchSize} onChange={e => update("batchSize", Number(e.target.value))} /></label>
      <label><input type="checkbox" checked={settings.diarize} disabled={!connection?.capabilities?.diarization} onChange={e => update("diarize", e.target.checked)} /> Identify speakers automatically</label>
      {!connection?.capabilities?.diarization && <p className="transcript-muted">Speaker identification needs a Hugging Face token and accepted model terms on the worker. Word timing and manual speaker assignment work without it.</p>}
      {settings.diarize && <><label>Minimum speakers (optional)<input className="form-input" type="number" min={1} max={32} value={settings.minSpeakers ?? ""} onChange={e => update("minSpeakers", e.target.value ? Number(e.target.value) : undefined)} /></label><label>Maximum speakers (optional)<input className="form-input" type="number" min={1} max={32} value={settings.maxSpeakers ?? ""} onChange={e => update("maxSpeakers", e.target.value ? Number(e.target.value) : undefined)} /></label></>}
      <label><input type="checkbox" checked={allow} onChange={e => setAllow(e.target.checked)} /> Allow this processor to access recordings I explicitly queue, including private sections</label>
    </div>
    <p>Broker endpoint: <code style={{ overflowWrap: "anywhere" }}>{meetingSourceBroker}/meeting-transcription</code></p>
    {!pairingKey && <button className="btn-action" type="button" onClick={() => { setPairingKey(Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("")); setKeySaved(false); }}>{connection ? "Rotate pairing key" : "Create pairing key"}</button>}
    {pairingKey && <><p>{keySaved ? "Saved. Copy this key into Zoer now. It is shown only here; closing this dialog hides it." : "Save settings to activate this key. Rotation revokes the previous key."}</p><input className="form-input" aria-label="New processor pairing key" type="password" value={pairingKey} readOnly /><button className="btn-action" type="button" onClick={() => void navigator.clipboard.writeText(pairingKey).catch(() => setError("Could not copy the key. Select and copy it manually."))}>Copy pairing key</button></>}
    {error && <p role="alert" className="transcript-error">{error}</p>}<div style={{ marginTop: 16 }}><button className="btn-action" disabled={busy || !allow || (!connection && !pairingKey)} type="submit">{busy ? "Saving…" : "Save settings"}</button></div>
  </form></Modal>;
}
