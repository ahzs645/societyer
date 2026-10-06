import { useEffect, useId, useRef, useState } from "react";

type Row = Record<string, unknown>;
type HistoryKey = "historicalActions" | "quorumEvents" | "sourceVersions";
type History = Record<HistoryKey, Row[]>;
export type HistoryMinutes = {
  _id: string; meetingId?: string; title?: string; heldAt?: string; approvedAt?: string;
  historicalActions?: Row[]; quorumEvents?: Row[]; sourceVersions?: Row[];
};
export type MeetingHistoryPanelProps = {
  minutes: HistoryMinutes;
  otherMinutes: HistoryMinutes[];
  meetings: { _id: string; title: string; scheduledAt?: string }[];
  readOnly?: boolean;
  onSave: (patch: History) => Promise<unknown>;
  onCarry: (args: { sourceMinutesId: string; targetMinutesId: string; sourceEntryId: string }) => Promise<unknown>;
};
const keys: HistoryKey[] = ["historicalActions", "quorumEvents", "sourceVersions"];
const tabs = { historicalActions: "Historical actions", quorumEvents: "Quorum timeline", sourceVersions: "Source versions" };
const statusLabels: Record<string, string> = { unknown: "Unknown", open: "Open", in_progress: "In progress", ongoing: "Ongoing", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled", confirmed: "Met", not_met: "Not met", not_recorded: "Not recorded", draft: "Draft", revised: "Revised", adopted: "Adopted" };
const str = (v: unknown) => typeof v === "string" ? v : v == null ? "" : String(v);
const copy = (m: HistoryMinutes): History => Object.fromEntries(keys.map(k => [k, structuredClone(m[k] ?? [])])) as History;
const identifier = () => crypto.randomUUID();
const idKey = (k: HistoryKey) => k === "historicalActions" ? "entryId" : k === "quorumEvents" ? "eventId" : "versionId";

function Field({ label, value, onChange, type = "text", multiline = false, options, required = false }: {
  label: string; value: string; onChange: (value: string) => void; type?: string; multiline?: boolean;
  options?: { value: string; label: string }[]; required?: boolean;
}) {
  const id = useId();
  return <div style={{ display: "grid", gap: 4, minWidth: 0 }}><span><label htmlFor={id}>{label}</label>{required && <span aria-hidden="true"> *</span>}</span>
    {options ? <select id={id} className="input" value={value} required={required} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      : multiline ? <textarea id={id} className="input" rows={3} value={value} required={required} onChange={e => onChange(e.target.value)} />
      : <input id={id} className="input" type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? 1 : undefined} value={value} required={required} onChange={e => onChange(e.target.value)} />}
  </div>;
}
const options = (values: string[]) => values.map(value => ({ value, label: statusLabels[value] ?? value }));

/** Human-readable snapshot viewer; React text rendering intentionally escapes source content. */
function ContentTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value == null) return null;
  if (typeof value !== "object") return <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{String(value)}</span>;
  if (depth > 12) return <p>Nested content is available in the source document.</p>;
  if (Array.isArray(value)) return <ol>{value.map((v, i) => <li key={i}><ContentTree value={v} depth={depth + 1} /></li>)}</ol>;
  return <dl>{Object.entries(value).map(([k, v]) => <div key={k} style={{ marginBlock: 8 }}><dt style={{ fontWeight: 600 }}>{k.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt><dd style={{ marginInlineStart: 12 }}><ContentTree value={v} depth={depth + 1} /></dd></div>)}</dl>;
}
function snapshotText(value: string): string | null {
  if (!value) return "";
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && Object.keys(parsed).length === 1 && typeof parsed.text === "string" ? parsed.text : null; } catch { return null; }
}
function Snapshot({ value }: { value: string }) {
  let content: unknown = value;
  try { content = JSON.parse(value); } catch { /* Legacy plain text remains readable. */ }
  return <div style={{ maxHeight: 480, overflow: "auto", padding: 12, border: "1px solid var(--border, #ddd)" }}><ContentTree value={content} /></div>;
}

export function MeetingHistoryPanel({ minutes, otherMinutes, meetings, onSave, onCarry, readOnly = false }: MeetingHistoryPanelProps) {
  const [tab, setTab] = useState<HistoryKey>("historicalActions");
  const [draft, setDraft] = useState<History>(() => copy(minutes));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [carrySource, setCarrySource] = useState("");
  const [carryEntry, setCarryEntry] = useState("");
  const latest = JSON.stringify(copy(minutes));
  const baseline = useRef(latest);
  const changedOnServer = dirty && baseline.current !== latest;
  const approved = Boolean(minutes.approvedAt);
  const locked = approved || readOnly || busy;
  useEffect(() => {
    if (!dirty) { setDraft(JSON.parse(latest) as History); baseline.current = latest; }
  }, [latest, dirty]); // Preserve unsaved edits when query data refreshes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const change = (key: HistoryKey, index: number, field: string, value: unknown) => {
    setDraft(old => ({ ...old, [key]: old[key].map((row, i) => {
      if (i !== index) return row;
      const next = { ...row };
      if (value === "" || value === undefined) delete next[field]; else next[field] = value;
      return next;
    }) })); setDirty(true); setNotice("");
  };
  const add = (key: HistoryKey, value?: Row) => {
    const row = value ?? (key === "historicalActions" ? { entryId: identifier(), actionKey: identifier(), text: "", status: "unknown" }
      : key === "quorumEvents" ? { eventId: identifier(), status: "not_recorded", scope: "meeting" }
        : { versionId: identifier(), label: "", status: "unknown", sourceExternalIds: [] });
    setDraft(old => ({ ...old, [key]: [...old[key], row] })); setDirty(true); setNotice("");
  };
  const remove = (key: HistoryKey, index: number) => {
    setDraft(old => ({ ...old, [key]: old[key].filter((_, i) => i !== index) })); setDirty(true); setNotice("");
  };
  const save = async () => {
    setError("");
    if (changedOnServer) { setError("This history changed elsewhere. Copy any unsaved work, then reload the saved history before editing again."); return; }
    try {
      for (const a of draft.historicalActions) if (!str(a.text).trim() || !str(a.actionKey).trim()) throw new Error("Each historical action needs text and an action identity.");
      for (const q of draft.quorumEvents) if (q.scope !== "meeting" && !str(q.scopeLabel).trim()) throw new Error("Session and item quorum observations need a scope label.");
      for (const v of draft.sourceVersions) {
        if (!str(v.label).trim()) throw new Error("Each source version needs a label.");
        if (!Array.isArray(v.sourceExternalIds) || !v.sourceExternalIds.some(id => str(id).trim())) throw new Error("Each source version needs at least one source reference.");
        if (v.status === "adopted" && (!v.adoptedAt || !str(v.adoptionEvidence).trim())) throw new Error("Record the adoption date and evidence before marking a version adopted.");
      }
      const cleaned = Object.fromEntries(keys.map(k => [k, draft[k].map(r => ({ ...r, ...(Array.isArray(r.sourceExternalIds) ? { sourceExternalIds: r.sourceExternalIds.map(str).map(s => s.trim()).filter(Boolean) } : {}) }))])) as History;
      setBusy(true); await onSave(cleaned); baseline.current = JSON.stringify(cleaned); setDirty(false); setNotice("History saved.");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const savedAdopted = new Set((minutes.sourceVersions ?? []).filter(v => v.status === "adopted").map(v => v.versionId));
  const sourceMinutes = otherMinutes.find(m => m._id === carrySource);
  const sourceRows = sourceMinutes?.historicalActions ?? [];
  const candidates = otherMinutes.filter(m => m._id !== minutes._id && (m.historicalActions?.length ?? 0) > 0 && (!minutes.heldAt || !m.heldAt || m.heldAt <= minutes.heldAt));
  const meetingLabel = (m: HistoryMinutes) => `${meetings.find(v => v._id === m.meetingId)?.title ?? m.title ?? "Minutes"}${m.heldAt ? ` — ${m.heldAt.slice(0, 10)}` : " — date not recorded"}`;
  const carry = async () => {
    if (!carrySource || !carryEntry || dirty) return;
    setBusy(true); setError(""); setNotice("");
    try { await onCarry({ sourceMinutesId: carrySource, targetMinutesId: minutes._id, sourceEntryId: carryEntry }); setNotice("Action carried forward as a new observation with unknown status. Review its status and as-of date here."); setCarryEntry(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <section className="card" aria-label="Meeting history" style={{ marginTop: 20 }}>
    <div className="card__head"><h2>Meeting history</h2><p>Keep historical observations, quorum changes and document versions with their evidence.</p></div>
    <div className="card__body" style={{ display: "grid", gap: 16 }}>
      {approved && <p role="status">These minutes are approved. History is read only; use the existing reopen approval workflow before making changes. Adopted source snapshots stay protected.</p>}
      <div role="tablist" aria-label="Meeting history sections" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{keys.map(k => <button type="button" key={k} role="tab" aria-selected={tab === k} className={`btn ${tab === k ? "btn--primary" : "btn--ghost"}`} onClick={() => setTab(k)}>{tabs[k]} ({draft[k].length})</button>)}</div>
      {error && <p role="alert" style={{ color: "var(--danger, #a21d26)", whiteSpace: "pre-wrap" }}>{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {changedOnServer && <p role="alert">New saved history is available. Your unsaved changes are retained; reload before saving to avoid replacing someone else’s work.</p>}
      <div role="tabpanel" aria-label={tabs[tab]} style={{ display: "grid", gap: 14 }}>
        {tab === "historicalActions" && <>
          <p>Status describes the source’s point in time, not today. New observations get separate identities automatically. Share an action identity across meetings only after verifying they refer to the same action. Legacy action checkboxes are unchanged.</p>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}><Field label="Filter action status" value={filter} options={[{ value: "all", label: "All statuses" }, ...options(["unknown", "open", "in_progress", "ongoing", "on_hold", "completed", "cancelled"])]} onChange={setFilter} /><Field label="Find action or identity" value={search} onChange={setSearch} /></div>
          <details><summary>Carry an action forward from earlier minutes</summary><p>Choose the verified prior observation. Its identity and provenance are retained; completion and as-of date are reset for review. The prior meeting is unchanged.</p>
            <fieldset disabled={locked || dirty} style={{ display: "grid", gap: 12 }}><Field label="Previous minutes" value={carrySource} options={[{ value: "", label: "Choose minutes" }, ...candidates.map(m => ({ value: m._id, label: meetingLabel(m) }))]} onChange={v => { setCarrySource(v); setCarryEntry(""); }} />
              <Field label="Prior action observation" value={carryEntry} options={[{ value: "", label: "Choose action" }, ...sourceRows.map(a => ({ value: str(a.entryId), label: `${str(a.text)} — ${statusLabels[str(a.status)] ?? str(a.status)} as of ${str(a.statusAsOf) || "unknown date"}` }))]} onChange={setCarryEntry} />
              <button type="button" className="btn" disabled={!carrySource || !carryEntry} onClick={carry}>Carry selected action forward</button></fieldset>{dirty && <p>Save or reload your edits before carrying an action forward.</p>}
          </details>
        </>}
        {tab === "quorumEvents" && <p>Record each observation in source order. A quorum observation can apply to the whole meeting, a session or one agenda item. These entries do not change the meeting’s summary quorum field or establish legal validity.</p>}
        {tab === "sourceVersions" && <p>Source adoption is separate from approving an imported candidate. An “approved” filename alone is not adoption evidence. Saved adopted snapshots cannot be changed; append a revision instead.</p>}
        {draft[tab].length === 0 && <p>No {tabs[tab].toLowerCase()} recorded yet.</p>}
        {draft[tab].map((row, index) => {
          if (tab === "historicalActions" && ((filter !== "all" && row.status !== filter) || !`${str(row.text)} ${str(row.actionKey)}`.toLowerCase().includes(search.toLowerCase()))) return null;
          const frozen = tab === "sourceVersions" && savedAdopted.has(row.versionId);
          const field = (name: string, label: string, opts: Partial<Parameters<typeof Field>[0]> = {}) => <Field label={label} value={str(row[name])} onChange={v => change(tab, index, name, opts.type === "number" ? (v === "" ? undefined : Number(v)) : v)} {...opts} />;
          return <details key={str(row[idKey(tab)])} open style={{ border: "1px solid var(--border, #ddd)", borderRadius: 8, padding: 14 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>{index + 1}. {str(row.text || row.label || row.scopeLabel) || (tab === "quorumEvents" ? `${statusLabels[str(row.status)]} — ${str(row.scope)}` : "New record")}</summary>
            {frozen && <p>Adopted snapshot — protected from edits and removal.</p>}
            <fieldset disabled={locked || frozen} style={{ border: 0, padding: 0, marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 14 }}>
              {tab === "historicalActions" && <>
                {field("text", "Action", { multiline: true, required: true })}{field("assignee", "Owner as recorded")}{field("actionKey", "Action identity", { required: true })}{field("sourceActionId", "Source action number")}
                {field("status", "Historical status", { options: options(["unknown", "open", "in_progress", "ongoing", "on_hold", "completed", "cancelled"]) })}{field("statusAsOf", "Status as of", { type: "date" })}{field("dateAssigned", "Assigned date", { type: "date" })}{field("dueDate", "Due date", { type: "date" })}{field("sourceStatus", "Source status wording")}{field("notes", "Action notes", { multiline: true })}
              </>}
              {tab === "quorumEvents" && <>
                {field("status", "Observed quorum", { options: options(["not_recorded", "confirmed", "not_met"]) })}{field("atTime", "Time as recorded")}{field("scope", "Scope", { options: options(["meeting", "session", "item"]) })}{field("scopeLabel", "Session or agenda item", { required: row.scope !== "meeting" })}{field("eligibleCount", "Eligible count", { type: "number" })}{field("presentCount", "Present eligible count", { type: "number" })}{field("reason", "Reason or qualification", { multiline: true })}
              </>}
              {tab === "sourceVersions" && <>
                {field("label", "Version label", { required: true })}{field("status", "Version status", { options: options(["unknown", "draft", "revised", "adopted"]) })}{field("sourceDate", "Source date", { type: "date" })}
                {field("supersedesVersionId", "Supersedes version", { options: [{ value: "", label: "No supersession established" }, ...draft.sourceVersions.filter(v => v.versionId !== row.versionId).map(v => ({ value: str(v.versionId), label: str(v.label) || str(v.versionId) }))] })}
                {field("adoptedAt", "Adoption date", { type: "date", required: row.status === "adopted" })}{field("adoptedInMeetingId", "Adopting meeting", { options: [{ value: "", label: "Not linked" }, ...meetings.map(m => ({ value: m._id, label: m.title }))] })}{field("adoptionEvidence", "Adoption evidence", { multiline: true, required: row.status === "adopted" })}{field("notes", "Version notes", { multiline: true })}
                {snapshotText(str(row.contentJson)) !== null && <Field label="Source snapshot text (optional)" value={snapshotText(str(row.contentJson)) ?? ""} multiline onChange={v => change(tab, index, "contentJson", v ? JSON.stringify({ text: v }) : undefined)} />}
              </>}
              <Field label="Source references (one per line)" required={tab === "sourceVersions"} value={Array.isArray(row.sourceExternalIds) ? row.sourceExternalIds.join("\n") : ""} multiline onChange={v => change(tab, index, "sourceExternalIds", v.split("\n"))} />
              {tab !== "sourceVersions" && <>{field("sourceLocator", "Source page, section or row")}{field("evidence", "Source evidence", { multiline: true })}</>}
              {tab === "quorumEvents" && <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn btn--ghost" disabled={index === 0} onClick={() => { setDraft(old => { const rows = [...old.quorumEvents]; [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]]; return { ...old, quorumEvents: rows }; }); setDirty(true); }}>Move observation earlier</button>
                <button type="button" className="btn btn--ghost" disabled={index === draft.quorumEvents.length - 1} onClick={() => { setDraft(old => { const rows = [...old.quorumEvents]; [rows[index + 1], rows[index]] = [rows[index], rows[index + 1]]; return { ...old, quorumEvents: rows }; }); setDirty(true); }}>Move observation later</button>
              </div>}
              <div><button type="button" className="btn btn--ghost" onClick={() => remove(tab, index)}>Remove this {tab === "historicalActions" ? "observation" : tab === "quorumEvents" ? "event" : "version"}</button></div>
            </fieldset>
            {tab === "historicalActions" && Boolean(row.carriedFromMinutesId) && <p>Carried from {otherMinutes.find(m => m._id === row.carriedFromMinutesId)?.meetingId ? <a href={`/app/meetings/${otherMinutes.find(m => m._id === row.carriedFromMinutesId)?.meetingId}?tab=minutes`}>prior minutes</a> : <span>minutes {str(row.carriedFromMinutesId)}</span>}; observation {str(row.carriedFromEntryId)}. Earlier status is not a current completion claim.</p>}
            {tab === "historicalActions" && <details><summary>Observations with this action identity</summary>
              <p>Matches use the recorded identity, not text similarity. Confirm the evidence before treating these as the same action.</p>
              <ol>{[...otherMinutes.filter(m => m._id !== minutes._id), { ...minutes, historicalActions: draft.historicalActions }].flatMap(m => (m.historicalActions ?? []).filter(a => a.actionKey === row.actionKey).map(a => ({ m, a }))).sort((x, y) => str(x.a.statusAsOf || x.m.heldAt).localeCompare(str(y.a.statusAsOf || y.m.heldAt))).map(({ m, a }) => <li key={`${m._id}:${str(a.entryId)}`} style={{ marginBlock: 12 }}>
                <strong>{statusLabels[str(a.status)] ?? str(a.status)}</strong> as of {str(a.statusAsOf) || "date not recorded"} · {m.meetingId ? <a href={`/app/meetings/${m.meetingId}?tab=minutes`}>{meetingLabel(m)}</a> : meetingLabel(m)}
                <p style={{ whiteSpace: "pre-wrap" }}>{str(a.text)}</p>
                {Boolean(a.sourceStatus) && <p>Source status: {str(a.sourceStatus)}</p>}
                {Boolean(a.sourceLocator) && <p>Source location: {str(a.sourceLocator)}</p>}
                {Array.isArray(a.sourceExternalIds) && a.sourceExternalIds.length > 0 && <p>Sources: {a.sourceExternalIds.join(", ")}</p>}
              </li>)}</ol>
            </details>}
            {tab === "sourceVersions" && <>
              {Boolean(row.adoptionMotionId) && <p>Linked adoption motion: {str(row.adoptionMotionId)}</p>}
              {Boolean(row.contentJson) && <details><summary>Read this version’s captured content</summary><Snapshot value={str(row.contentJson)} /></details>}
              <button type="button" className="btn" disabled={locked} onClick={() => add("sourceVersions", { versionId: identifier(), label: `Revision of ${str(row.label)}`, status: "revised", sourceExternalIds: [], supersedesVersionId: row.versionId })}>Append revision</button>
            </>}
          </details>;
        })}
        <button type="button" className="btn" disabled={locked} onClick={() => { setFilter("all"); setSearch(""); add(tab); }}>Add {tab === "historicalActions" ? "historical action" : tab === "quorumEvents" ? "quorum observation" : "source version"}</button>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}><button type="button" className="btn btn--primary" disabled={locked || !dirty || changedOnServer} onClick={save}>{busy ? "Saving…" : "Save history"}</button><button type="button" className="btn btn--ghost" disabled={busy || !dirty} onClick={() => { setDraft(copy(minutes)); setDirty(false); setError(""); setNotice("Saved history reloaded; unsaved edits discarded."); baseline.current = latest; }}>Reload saved history</button>{dirty && <span role="status">Unsaved history changes</span>}</div>
    </div>
  </section>;
}
