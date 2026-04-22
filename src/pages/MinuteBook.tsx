import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { OptionSelect } from "../components/OptionSelect";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import { formatDate } from "../lib/format";
import { optionLabel } from "../lib/orgHubOptions";

export function MinuteBookPage() {
  const society = useSociety();
  const detail = useQuery(api.minuteBook.overview, society ? { societyId: society._id } : "skip");
  const upsert = useMutation(api.minuteBook.upsert);
  const remove = useMutation(api.minuteBook.remove);
  const confirm = useConfirm();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<any>(null);

  const maps = useMemo(() => {
    const d = detail ?? {};
    return {
      documents: new Map<string, any>((d.documents ?? []).map((row: any) => [row._id, row])),
      meetings: new Map<string, any>((d.meetings ?? []).map((row: any) => [row._id, row])),
      minutes: new Map<string, any>((d.minutes ?? []).map((row: any) => [row._id, row])),
      filings: new Map<string, any>((d.filings ?? []).map((row: any) => [row._id, row])),
      policies: new Map<string, any>((d.policies ?? []).map((row: any) => [row._id, row])),
      workflowPackages: new Map<string, any>((d.workflowPackages ?? []).map((row: any) => [row._id, row])),
    };
  }, [detail]);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setDraft({
      title: "",
      recordType: "minute_book_record",
      status: "NeedsReview",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!draft) return;
    await upsert({
      id: draft._id,
      societyId: society._id,
      title: draft.title || "Untitled record",
      recordType: draft.recordType || "minute_book_record",
      effectiveDate: draft.effectiveDate || undefined,
      status: draft.status || "NeedsReview",
      documentIds: draft.documentId ? [draft.documentId] : draft.documentIds ?? [],
      meetingId: draft.meetingId || undefined,
      minutesId: draft.minutesId || undefined,
      filingId: draft.filingId || undefined,
      policyId: draft.policyId || undefined,
      workflowPackageId: draft.workflowPackageId || undefined,
      signatureIds: draft.signatureIds ?? [],
      sourceEvidenceIds: draft.sourceEvidenceIds ?? [],
      archivedAtISO: draft.archivedAtISO || undefined,
      notes: draft.notes || undefined,
    });
    setOpen(false);
    setDraft(null);
    toast.success("Minute book record saved");
  };

  const confirmDelete = async (row: any) => {
    const ok = await confirm({
      title: "Delete minute book record?",
      message: `"${row.title}" will be removed from the minute book spine.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await remove({ id: row._id });
    toast.success("Minute book record deleted");
  };

  const items = Array.isArray(detail) ? [] : detail?.items ?? [];
  const checks = safeRows(detail, "checks");
  const openCheckCount = checks.filter((check: any) => !check.ok).length;

  return (
    <div className="page page--wide">
      <PageHeader
        title="Minute book"
        icon={<BookOpen size={16} />}
        iconColor="purple"
        subtitle="A legal record spine tying documents, meetings, minutes, resolutions, filings, signatures, policies, and workflow packages together."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New record
          </button>
        }
      />

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Manual records" value={items.length} />
        <Stat label="Documents" value={safeCount(detail, "documents")} />
        <Stat label="Meetings" value={safeCount(detail, "meetings")} />
        <Stat label="Open checks" value={openCheckCount} tone={openCheckCount ? "warn" : undefined} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Completeness checks</h2>
          <Badge tone={openCheckCount ? "warn" : "success"}>{openCheckCount ? `${openCheckCount} open` : "Clear"}</Badge>
        </div>
        <div className="card__body">
          <div className="grid two">
            {checks.map((check: any) => (
              <div key={check.key} className="row" style={{ alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <strong>{check.label}</strong>
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{check.detail}</div>
                </div>
                <Badge tone={check.ok ? "success" : check.severity === "danger" ? "danger" : check.severity === "warn" ? "warn" : "info"}>
                  {check.count}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Record spine</h2>
          <Badge>{items.length}</Badge>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Record</th>
                <th>Linked source</th>
                <th>Effective</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((row: any) => (
                <tr key={row._id}>
                  <td>
                    <strong>{row.title}</strong>
                    <div className="muted">{optionLabel("minuteBookRecordTypes", row.recordType)}</div>
                  </td>
                  <td>{linkSummary(row, maps)}</td>
                  <td>{row.effectiveDate ? formatDate(row.effectiveDate) : "-"}</td>
                  <td><Badge tone={toneForStatus(row.status)}>{optionLabel("minuteBookStatuses", row.status)}</Badge></td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          setDraft({ ...row, documentId: row.documentIds?.[0] });
                          setOpen(true);
                        }}
                      >
                        Edit
                      </button>
                      <button className="btn btn--ghost btn--sm btn--icon" aria-label="Delete minute book record" onClick={() => confirmDelete(row)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>No manual minute book records yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid two">
        <LinkedList title="Canonical documents" rows={safeRows(detail, "documents")} getTitle={(row: any) => row.title} getMeta={(row: any) => row.category} />
        <LinkedList title="Meetings and minutes" rows={safeRows(detail, "meetings")} getTitle={(row: any) => row.title} getMeta={(row: any) => `${row.type} - ${row.scheduledAt ? formatDate(row.scheduledAt) : "unscheduled"}`} />
        <LinkedList title="Filings" rows={safeRows(detail, "filings")} getTitle={(row: any) => row.kind} getMeta={(row: any) => `${row.status} - ${row.dueDate ? formatDate(row.dueDate) : "no due date"}`} />
        <LinkedList title="Policies and workflow packages" rows={[...safeRows(detail, "policies"), ...safeRows(detail, "workflowPackages")]} getTitle={(row: any) => row.policyName ?? row.packageName} getMeta={(row: any) => row.status ?? row.eventType} />
      </div>

      <Drawer
        open={open}
        onClose={() => { setOpen(false); setDraft(null); }}
        title={draft?._id ? "Edit minute book record" : "New minute book record"}
        footer={
          <>
            <button className="btn" onClick={() => { setOpen(false); setDraft(null); }}>Cancel</button>
            <button className="btn btn--accent" onClick={save}>Save</button>
          </>
        }
      >
        {draft && (
          <>
            <Field label="Title"><input className="input" value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <OptionSelect label="Record type" setName="minuteBookRecordTypes" value={draft.recordType ?? ""} onChange={(value) => setDraft({ ...draft, recordType: value })} />
              <OptionSelect label="Status" setName="minuteBookStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Effective date"><DatePicker value={draft.effectiveDate ?? ""} onChange={(value) => setDraft({ ...draft, effectiveDate: value })} /></Field>
              <Field label="Archived date"><DatePicker value={draft.archivedAtISO ?? ""} onChange={(value) => setDraft({ ...draft, archivedAtISO: value })} /></Field>
            </div>
            <RecordSelect label="Document" value={draft.documentId} rows={safeRows(detail, "documents")} onChange={(value) => setDraft({ ...draft, documentId: value })} getLabel={(row: any) => row.title} />
            <RecordSelect label="Meeting" value={draft.meetingId} rows={safeRows(detail, "meetings")} onChange={(value) => setDraft({ ...draft, meetingId: value })} getLabel={(row: any) => row.title} />
            <RecordSelect label="Minutes" value={draft.minutesId} rows={safeRows(detail, "minutes")} onChange={(value) => setDraft({ ...draft, minutesId: value })} getLabel={(row: any) => `${row.heldAt ?? "Minutes"} - ${row.status ?? ""}`} />
            <RecordSelect label="Filing" value={draft.filingId} rows={safeRows(detail, "filings")} onChange={(value) => setDraft({ ...draft, filingId: value })} getLabel={(row: any) => row.kind} />
            <RecordSelect label="Policy" value={draft.policyId} rows={safeRows(detail, "policies")} onChange={(value) => setDraft({ ...draft, policyId: value })} getLabel={(row: any) => row.policyName} />
            <RecordSelect label="Workflow package" value={draft.workflowPackageId} rows={safeRows(detail, "workflowPackages")} onChange={(value) => setDraft({ ...draft, workflowPackageId: value })} getLabel={(row: any) => row.packageName} />
            <Field label="Notes"><textarea className="textarea" value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
          </>
        )}
      </Drawer>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={{ color: tone === "warn" ? "var(--warn)" : undefined }}>{value}</div>
    </div>
  );
}

function LinkedList({ title, rows, getTitle, getMeta }: any) {
  return (
    <div className="card">
      <div className="card__head">
        <h2 className="card__title">{title}</h2>
        <Badge>{rows.length}</Badge>
      </div>
      <div className="card__body">
        {rows.slice(0, 8).map((row: any) => (
          <div key={row._id} className="row" style={{ justifyContent: "space-between", gap: 12, padding: "6px 0" }}>
            <span>{getTitle(row)}</span>
            <span className="muted">{getMeta(row)}</span>
          </div>
        ))}
        {rows.length === 0 && <div className="muted">No records yet.</div>}
      </div>
    </div>
  );
}

function RecordSelect({ label, value, rows, onChange, getLabel }: any) {
  return (
    <Field label={label}>
      <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">No {label.toLowerCase()}</option>
        {rows.map((row: any) => <option key={row._id} value={row._id}>{getLabel(row)}</option>)}
      </select>
    </Field>
  );
}

function linkSummary(row: any, maps: any) {
  const document = row.documentIds?.[0] ? maps.documents.get(row.documentIds[0]) : null;
  if (document) return <Link to="/app/documents">{document.title}</Link>;
  const meeting = row.meetingId ? maps.meetings.get(row.meetingId) : null;
  if (meeting) return <Link to={`/app/meetings/${meeting._id}`}>{meeting.title}</Link>;
  const minutes = row.minutesId ? maps.minutes.get(row.minutesId) : null;
  if (minutes) return <Link to="/app/minutes">{minutes.heldAt ?? "Minutes"}</Link>;
  const filing = row.filingId ? maps.filings.get(row.filingId) : null;
  if (filing) return <Link to="/app/filings">{filing.kind}</Link>;
  const policy = row.policyId ? maps.policies.get(row.policyId) : null;
  if (policy) return <Link to="/app/policies">{policy.policyName}</Link>;
  const workflowPackage = row.workflowPackageId ? maps.workflowPackages.get(row.workflowPackageId) : null;
  if (workflowPackage) return <Link to="/app/workflow-packages">{workflowPackage.packageName}</Link>;
  return <span className="muted">Not linked</span>;
}

function safeRows(detail: any, key: string) {
  if (!detail || Array.isArray(detail)) return [];
  return detail[key] ?? [];
}

function safeCount(detail: any, key: string) {
  return safeRows(detail, key).length;
}

function labelize(value?: string) {
  return String(value ?? "-").replace(/_/g, " ");
}

function toneForStatus(status?: string) {
  const value = String(status ?? "").toLowerCase();
  if (value.includes("current") || value.includes("verified") || value.includes("filed")) return "success" as const;
  if (value.includes("review") || value.includes("draft")) return "warn" as const;
  if (value.includes("archiv") || value.includes("reject")) return "danger" as const;
  return "neutral" as const;
}
