/**
 * The WhisperX processor's dialogs, used by "Recordings and transcripts"
 * (MeetingSourcesCard): processor settings and reviewing a finished
 * transcription before it is used.
 */
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Modal } from "../../../components/Modal";
import { Select } from "../../../components/Select";
import { meetingSourceBroker } from "../../../lib/meetingSourceUpload";
import { DEFAULT_WHISPERX_SETTINGS, WHISPERX_MODELS, type WhisperXSettings } from "../../../../shared/transcription/protocol";

export type Connection = { id: string; name: string; enabled: boolean; settings: WhisperXSettings; heartbeatAt: number | null; capabilities: { cuda?: boolean; diarization?: boolean; models?: string[] } | null };
export function CandidatePreview({ job, close }: { job: { id: string; pageCount: number }; close: () => void }) {
  const [index, setIndex] = useState(0); const page = useQuery(api.meetingTranscription.page, { jobId: job.id, page: index });
  return <Modal open onClose={close} title="Review WhisperX transcript" size="xl"><p>This candidate has not replaced the meeting transcript.</p><div className="transcript-toolbar__actions"><button className="btn-action" disabled={!index} onClick={() => setIndex(index - 1)}>Previous</button><span>Page {index + 1} of {job.pageCount}</span><button className="btn-action" disabled={index + 1 >= job.pageCount} onClick={() => setIndex(index + 1)}>Next</button></div>{page ? page.segments.map((s: { text: string; speaker: string; startSec: number }, i: number) => <p key={i}><strong>{Math.floor(s.startSec / 60)}:{String(Math.floor(s.startSec % 60)).padStart(2, "0")} {s.speaker}</strong> {s.text}</p>) : <p role="status">Loading transcript page…</p>}</Modal>;
}
export function ProcessorSettings({ societyId, connection, close }: { societyId: string; connection: Connection | null; close: () => void }) {
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
