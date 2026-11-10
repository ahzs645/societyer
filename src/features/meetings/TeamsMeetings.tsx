import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/convexApi";
import { Drawer, Field, Badge } from "../../components/ui";
import { Select } from "../../components/Select";
import { usePermissions } from "../../hooks/usePermissions";
import { isLocalDataRuntime } from "../../lib/staticRuntime";

export function TeamsMeetingImport({ societyId }: { societyId: string }) {
  const [open, setOpen] = useState(false);
  return <><button className="btn" onClick={() => setOpen(true)}>Import from Teams</button>{open && <TeamsImportDrawer societyId={societyId} onClose={() => setOpen(false)} />}</>;
}
function TeamsImportDrawer({ societyId, onClose }: { societyId: string; onClose: () => void }) {
  const settings = useQuery(api.microsoftMeetings.settings, { societyId });
  const discover = useAction(api.microsoftMeetingsActions.discover);
  const importMeeting = useAction(api.microsoftMeetingsActions.importMeeting);
  const navigate = useNavigate();
  const [start, setStart] = useState(() => new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<any>(null), [selected, setSelected] = useState<any>(null);
  const [title, setTitle] = useState(""), [chat, setChat] = useState(""), [confirmed, setConfirmed] = useState(false);
  const refresh = async () => { setBusy(true); setError(""); setSelected(null); try { setResult(await discover({ societyId, start: new Date(`${start}T00:00:00`).toISOString(), end: new Date(`${end}T23:59:59`).toISOString() })); } catch (e) { setError(e instanceof Error ? e.message : "Could not read Teams meetings."); } finally { setBusy(false); } };
  const save = async () => { setBusy(true); setError(""); try { const id = await importMeeting({ societyId, candidateId: selected.id, title, ...(chat ? { contextChatId: chat } : {}), contextChatConfirmed: confirmed }); navigate(`/app/meetings/${id}?tab=transcript`); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Could not import the Teams transcript."); } finally { setBusy(false); } };
  return <Drawer open onClose={() => { if (!busy) onClose(); }} title="Import from Microsoft Teams" size="wide"><div className="col" style={{ gap: 16 }}>
    <p>Create an informal meeting record from an existing Teams transcript. Imports stay in this workspace. Existing imports and your corrections are preserved.</p>
    {settings === undefined ? <p>Checking the Teams connection…</p> : !settings.configured ? <p role="status">A deployment administrator must configure the dedicated Teams connector for this workspace.</p> : <>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}><Field label="From"><input className="input" type="date" value={start} onChange={e => setStart(e.target.value)} /></Field><Field label="Through"><input className="input" type="date" value={end} onChange={e => setEnd(e.target.value)} /></Field><button className="btn" disabled={busy || !start || !end} onClick={refresh}>{busy ? "Reading Microsoft…" : "Find transcripts"}</button></div>
      <p className="small muted">Up to 31 days per search, for approved organizers. Only calls and meetings with available transcripts appear. Times mark transcription, which may start after the meeting begins.</p>
      {result?.warnings.map((warning: string) => <p key={warning} role="status">{warning}</p>)}
      {result && !result.candidates.length && <p>No transcripts found in this range. Check any Microsoft access messages above.</p>}
      {result?.candidates.map((candidate: any) => <div className="card" key={candidate.id}><div className="card__body col" style={{ gap: 8 }}><strong>{candidate.source.title}</strong><span>{new Date(candidate.source.createdAt).toLocaleString()} <Badge>{candidate.source.kind === "adhoc" ? "Group call" : "Scheduled meeting"}</Badge></span>{candidate.meetingId ? <button className="btn" onClick={() => { navigate(`/app/meetings/${candidate.meetingId}?tab=transcript`); onClose(); }}>Open imported meeting</button> : <button className="btn" disabled={busy} onClick={() => { setSelected(candidate); setTitle(candidate.source.title); }}>Review this import</button>}</div></div>)}
      {selected && <section aria-label="Review Teams import" className="card"><div className="card__body col" style={{ gap: 12 }}><Field label="Meeting title"><input className="input" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></Field><Field label="Link a chat roster (optional)"><Select value={chat} onChange={value => { setChat(value); setConfirmed(false); }} options={[{ value: "", label: "No linked chat" }, ...settings.chats.map((c: any) => ({ value: c.id, label: c.name }))]} /></Field>{chat && <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I confirm this chat relates to the selected call. Its roster is context, not proof of attendance.</label>}<p className="small muted">Speaker names will be imported as recorded. On the Transcript tab you can explicitly link a speaker to a verified workspace user. No roles or attendance are assigned.</p><button className="btn-action btn-action--primary" disabled={busy || !title.trim() || Boolean(chat && !confirmed)} onClick={save}>{busy ? "Importing…" : "Import as meeting notes"}</button></div></section>}
    </>}{error && <p role="alert" className="field__error">{error}</p>}
  </div></Drawer>;
}
export function TeamsSpeakerLinks({ societyId, meetingId, transcript }: { societyId: string; meetingId: string; transcript: any }) {
  const { can, loaded } = usePermissions();
  const enabled = !isLocalDataRuntime() && loaded && can("settings:write") && can("meetings:write") && can("minutes:write");
  return enabled ? <TeamsSpeakerLinksContent societyId={societyId} meetingId={meetingId} transcript={transcript} /> : null;
}
function TeamsSpeakerLinksContent({ societyId, meetingId, transcript }: { societyId: string; meetingId: string; transcript: any }) {
  const info = useQuery(api.microsoftMeetings.participants, { societyId, meetingId });
  const assign = useMutation(api.microsoftMeetings.assignSpeakerToUser);
  const [label, setLabel] = useState(""), [userId, setUserId] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  if (!info) return null;
  const speakers = [...new Set<string>((transcript?.segments ?? []).map((s: any) => String(s.speaker)))];
  const users = info.participants.filter((p: any) => p.userId);
  const link = async () => { setBusy(true); setMessage(""); try { await assign({ societyId, meetingId, label, userId }); setMessage("Speaker linked to the selected workspace user and their directory profile."); } catch (e) { setMessage(e instanceof Error ? e.message : "Speaker could not be linked."); } finally { setBusy(false); } };
  return <section className="card" aria-label="Microsoft Teams source"><div className="card__body col" style={{ gap: 12 }}><strong>Microsoft Teams transcript</strong><p className="small muted">Imported {new Date(info.importedAt).toLocaleString()}. {info.chatRoster ? "The confirmed chat roster is context; it does not establish attendance." : "No chat roster was linked."} Name matches need your review.</p>{users.length ? <><Field label="Recorded speaker"><Select value={label} onChange={setLabel} options={[{ value: "", label: "Choose a speaker" }, ...speakers.map(value => ({ value, label: value }))]} /></Field><Field label="Verified workspace user"><Select value={userId} onChange={setUserId} options={[{ value: "", label: "Choose a user" }, ...users.map((p: any) => ({ value: p.userId, label: p.name }))]} /></Field><button className="btn" disabled={!label || !userId || busy} onClick={link}>Confirm speaker link</button></> : <p className="small muted">No verified local users were resolved from a linked chat. You can still name speakers using Review speakers.</p>}{message && <p role="status">{message}</p>}</div></section>;
}
