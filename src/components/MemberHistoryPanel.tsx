import {Link} from "react-router-dom";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../convex/_generated/dataModel";
import { usePermissions } from "../hooks/usePermissions";
import { useToast } from "./Toast";
import { Badge, Drawer, Field, EmptyState } from "./ui";
import { Select } from "./Select";
import { ImportWizard } from "./ImportWizard";
import { Plus, Upload, Download, History } from "lucide-react";
import { rowsToCsv } from "../lib/csv";
import { MEMBER_HISTORY_KINDS, MEMBER_HISTORY_REVIEW_STATUSES, isMemberEvidenceDate, validMemberSourceUrl } from "../../shared/memberHistory";
import type { MemberHistoryEvent } from "../../shared/functions/memberHistory";

const columns = ["effectiveDate", "endDate", "kind", "title", "details", "reviewStatus", "sourceUrl", "sourceReference", "sourceExternalId"];
function downloadCsv(name: string, rows: unknown[][]) {
  const url = URL.createObjectURL(new Blob([rowsToCsv(rows)], { type: "text/csv" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}
const blankEvent = (): MemberHistoryEvent => ({ effectiveDate: "", kind: "Note", title: "", reviewStatus: "Observed", sourceReference: "" });

export function MemberHistoryPanel({ societyId, memberId }: { societyId: Id<"societies">; memberId: Id<"members"> }) {
  const { loaded, can } = usePermissions();
  const canRead = loaded && can("members:read");
  const canWrite = loaded && can("members:write");
  const rows = useQuery(api.memberHistory.list, canRead ? { societyId, memberId } : "skip") as any[] | undefined;
  const add = useMutation(api.memberHistory.add);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [event, setEvent] = useState<MemberHistoryEvent>(blankEvent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!canWrite) return;
    setSaving(true); setError("");
    try {
      const result = await add({ societyId, memberId, event });
      toast.success(result.duplicate ? "Evidence already recorded" : "Member history added");
      setOpen(false); setEvent(blankEvent());
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save history"); }
    finally { setSaving(false); }
  };
  if (!canRead && loaded) return <EmptyState title="Member history unavailable" description="Your role does not include member history access." />;
  return <div className="col" style={{ gap: 16 }}>
    <p className="muted">Record dated membership, role, attendance, and dues evidence with its source. Historical entries preserve the current member register. Dues entries record evidence; payments are tracked in Membership and Finance.</p>
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <button className="btn-action btn-action--primary" disabled={!canWrite} onClick={() => { setEvent(blankEvent()); setError(""); setOpen(true); }}><Plus size={12} /> Add history</button>
      <button className="btn-action" disabled={!canWrite} onClick={() => setCsvOpen(true)}><Upload size={12} /> Import history CSV</button>
      <button className="btn-action" onClick={() => downloadCsv("member-history-template.csv", [columns])}><Download size={12} /> CSV template</button>
      <button className="btn-action" disabled={!rows?.length} onClick={() => downloadCsv("member-history.csv", [columns, ...(rows ?? []).map(row => columns.map(key => row[key] ?? ""))])}><Download size={12} /> Export history</button>
    </div>
    {rows === undefined ? <p className="muted">Loading history…</p> : !rows.length ? <EmptyState icon={<History size={18} />} title="No historical evidence yet" description="Add a dated event or import a CSV for this member." /> :
      <div className="col" style={{ gap: 12 }}>{rows.map(row => <article className="card" key={row._id}>
        <div className="card__body col" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}><time dateTime={row.effectiveDate}>{row.effectiveDate}</time>{row.endDate && <span>to {row.endDate}</span>}<Badge>{row.kind}</Badge><Badge tone={row.reviewStatus === "Verified" ? "success" : row.reviewStatus === "Rejected" ? "danger" : "warn"}>{row.reviewStatus}</Badge></div>
          <strong>{row.title}</strong>{row.details && <p style={{ whiteSpace: "pre-wrap" }}>{row.details}</p>}
          {row.evidenceRegister && <small className="muted">Linked from {row.kind === "Attendance" ? "meeting attendance" : "board role evidence"}</small>}
          {row.href&&<Link to={row.href}>Open linked history or meeting</Link>}{row.meetingHref&&<Link to={row.meetingHref}>Open related meeting</Link>}
          {row.sourceReference && <span className="muted">Source: {row.sourceReference}</span>}
          {row.sourceUrl && validMemberSourceUrl(row.sourceUrl) && <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer">Open source</a>}
          {row.sourceExternalId && <span className="muted">External event ID: {row.sourceExternalId}</span>}
          <small className="muted">Recorded {row.createdAtISO?.slice(0, 10)}</small>
        </div>
      </article>)}</div>}
    <Drawer open={open} onClose={() => setOpen(false)} title="Add member history" footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" disabled={!canWrite || saving} onClick={save}>{saving ? "Saving…" : "Save history"}</button></>}>
      <Field label="Effective date" hint="Use YYYY, YYYY-MM, or YYYY-MM-DD to preserve the precision in the source."><input className="input" value={event.effectiveDate} onChange={e => setEvent({ ...event, effectiveDate: e.target.value })} placeholder="YYYY-MM-DD" /></Field>
      <Field label="End date (optional)"><input className="input" value={event.endDate ?? ""} onChange={e => setEvent({ ...event, endDate: e.target.value })} placeholder="YYYY, YYYY-MM, or YYYY-MM-DD" /></Field>
      <Field label="Kind"><Select value={event.kind} onChange={kind => setEvent({ ...event, kind })} options={MEMBER_HISTORY_KINDS.map(value => ({ value, label: value }))} /></Field>
      <Field label="Title"><input className="input" value={event.title} onChange={e => setEvent({ ...event, title: e.target.value })} /></Field>
      <Field label="Details"><textarea className="input" value={event.details ?? ""} onChange={e => setEvent({ ...event, details: e.target.value })} /></Field>
      <Field label="Review status"><Select value={event.reviewStatus} onChange={reviewStatus => setEvent({ ...event, reviewStatus })} options={MEMBER_HISTORY_REVIEW_STATUSES.map(value => ({ value, label: value }))} /></Field>
      <Field label="Source citation" hint="Provide a source citation, URL, or external event ID."><input className="input" value={event.sourceReference ?? ""} onChange={e => setEvent({ ...event, sourceReference: e.target.value })} placeholder="Document title, page, and section" /></Field>
      <Field label="Source URL"><input className="input" value={event.sourceUrl ?? ""} onChange={e => setEvent({ ...event, sourceUrl: e.target.value })} placeholder="https://" /></Field>
      <Field label="External event ID" hint="Use a stable ID for this event, not only the document ID."><input className="input" value={event.sourceExternalId ?? ""} onChange={e => setEvent({ ...event, sourceExternalId: e.target.value })} /></Field>
      {error && <p role="alert" className="muted">{error}</p>}
    </Drawer>
    <ImportWizard open={csvOpen} onClose={() => setCsvOpen(false)} target={{ id: "member-history", label: "Member history", fields: [
      { id: "effectiveDate", label: "Effective date", required: true, validate: value => isMemberEvidenceDate(value) ? null : "Use YYYY, YYYY-MM, or a real YYYY-MM-DD date" },
      { id: "endDate", label: "End date", validate: value => isMemberEvidenceDate(value) ? null : "Use YYYY, YYYY-MM, or a real YYYY-MM-DD date" },
      { id: "kind", label: "Kind", required: true, type: "select", options: MEMBER_HISTORY_KINDS.map(value => ({ value, label: value })) },
      { id: "title", label: "Title", required: true }, { id: "details", label: "Details" },
      { id: "reviewStatus", label: "Review status", type: "select", options: MEMBER_HISTORY_REVIEW_STATUSES.map(value => ({ value, label: value })) },
      { id: "sourceUrl", label: "Source URL", validate: value => validMemberSourceUrl(value) ? null : "Use HTTP or HTTPS" },
      { id: "sourceReference", label: "Source citation" }, { id: "sourceExternalId", label: "External event ID" },
    ], onImportRow: async row => {
      if (!canWrite) throw new Error("Member write permission required.");
      await add({ societyId, memberId, event: { ...row, reviewStatus: row.reviewStatus || "Observed" } });
    } }} />
  </div>;
}
