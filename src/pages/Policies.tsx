import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Toggle } from "../components/Controls";
import { OptionMultiSelect, OptionSelect } from "../components/OptionSelect";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { FileText, Plus, Trash2 } from "lucide-react";
import { formatDate } from "../lib/format";
import { optionLabel } from "../lib/orgHubOptions";

export function PoliciesPage() {
  const society = useSociety();
  const policies = useQuery(api.policies.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const adoptionOptions = useQuery(api.policies.adoptionOptions, society ? { societyId: society._id } : "skip");
  const upsert = useMutation(api.policies.upsert);
  const remove = useMutation(api.policies.remove);
  const createReviewTask = useMutation(api.policies.createReviewTask);
  const createSignerTask = useMutation(api.policies.createRequiredSignerTask);
  const createTransparencyDraft = useMutation(api.policies.createTransparencyDraft);
  const confirm = useConfirm();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<any>(null);

  const docById = useMemo(
    () => new Map<string, any>((documents ?? []).map((doc: any) => [doc._id, doc])),
    [documents],
  );
  const adoptionMaps = useMemo(
    () => ({
      meetings: new Map<string, any>((adoptionOptions?.meetings ?? []).map((row: any) => [row._id, row])),
      minutes: new Map<string, any>((adoptionOptions?.minutes ?? []).map((row: any) => [row._id, row])),
      motionEvidence: new Map<string, any>((adoptionOptions?.motionEvidence ?? []).map((row: any) => [row._id, row])),
    }),
    [adoptionOptions],
  );

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setDraft({
      policyName: "",
      status: "Draft",
      signatureRequired: false,
      requiredSigners: [],
      jurisdictions: ["british_columbia"],
      entityTypes: ["corporation__nfp_"],
    });
    setOpen(true);
  };

  const save = async () => {
    if (!draft) return;
    await upsert({
      id: draft._id,
      societyId: society._id,
      policyName: draft.policyName || "Untitled policy",
      policyNumber: draft.policyNumber || undefined,
      owner: draft.owner || undefined,
      effectiveDate: draft.effectiveDate || undefined,
      reviewDate: draft.reviewDate || undefined,
      ceasedDate: draft.ceasedDate || undefined,
      docxDocumentId: draft.docxDocumentId || undefined,
      pdfDocumentId: draft.pdfDocumentId || undefined,
      adoptedAtMeetingId: draft.adoptedAtMeetingId || undefined,
      adoptedInMinutesId: draft.adoptedInMinutesId || undefined,
      adoptingMotionEvidenceId: draft.adoptingMotionEvidenceId || undefined,
      html: draft.html || undefined,
      requiredSigners: listValues(draft.requiredSignersText ?? draft.requiredSigners),
      signatureRequired: !!draft.signatureRequired,
      jurisdictions: listValues(draft.jurisdictionsText ?? draft.jurisdictions),
      entityTypes: listValues(draft.entityTypesText ?? draft.entityTypes),
      status: draft.status || "Draft",
      notes: draft.notes || undefined,
    });
    setOpen(false);
    setDraft(null);
    toast.success("Policy saved");
  };

  const confirmDelete = async (row: any) => {
    const ok = await confirm({
      title: "Delete policy?",
      message: `"${row.policyName}" will be removed from the policy registry.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await remove({ id: row._id });
    toast.success("Policy deleted");
  };

  const createLifecycleTask = async (row: any, kind: "review" | "signers") => {
    if (kind === "review") await createReviewTask({ policyId: row._id });
    if (kind === "signers") await createSignerTask({ policyId: row._id });
    toast.success(kind === "review" ? "Review task created" : "Signer task created");
  };

  const createPublication = async (row: any) => {
    await createTransparencyDraft({ policyId: row._id });
    toast.success("Transparency draft ready");
  };

  return (
    <div className="page page--wide">
      <PageHeader
        title="Policy registry"
        icon={<FileText size={16} />}
        iconColor="green"
        subtitle="First-class policy records with source documents, review dates, signers, jurisdictions, and entity scope."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New policy
          </button>
        }
      />

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Policies</h2>
          <Badge>{policies?.length ?? 0}</Badge>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Policy</th>
                <th>Owner</th>
                <th>Dates</th>
                <th>Documents</th>
                <th>Adoption</th>
                <th>Signers</th>
                <th>Lifecycle</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(policies ?? []).map((row: any) => (
                <tr key={row._id}>
                  <td>
                    <strong>{row.policyName}</strong>
                    {row.policyNumber && <div className="mono muted">{row.policyNumber}</div>}
                  </td>
                  <td>{row.owner || "-"}</td>
                  <td>
                    <div>{row.effectiveDate ? formatDate(row.effectiveDate) : "No effective date"}</div>
                    <div className="muted">{row.reviewDate ? `Review ${formatDate(row.reviewDate)}` : "No review date"}</div>
                  </td>
                  <td>
                    <div>{row.docxDocumentId ? docById.get(row.docxDocumentId)?.title ?? "DOCX linked" : "No DOCX"}</div>
                    <div className="muted">{row.pdfDocumentId ? docById.get(row.pdfDocumentId)?.title ?? "PDF linked" : "No PDF"}</div>
                  </td>
                  <td><AdoptionCell row={row} maps={adoptionMaps} /></td>
                  <td>
                    {row.signatureRequired ? (
                      <Badge tone="warn">{(row.requiredSigners ?? []).map((value: string) => optionLabel("requiredSigners", value)).join(", ") || "Needs review"}</Badge>
                    ) : (
                      <span className="muted">Not required</span>
                    )}
                  </td>
                  <td>
                    <LifecycleBadges lifecycle={row.lifecycle} />
                  </td>
                  <td><Badge tone={toneForStatus(row.status)}>{row.status}</Badge></td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <button className="btn btn--ghost btn--sm" onClick={() => createLifecycleTask(row, "review")}>Review task</button>
                      {row.signatureRequired && <button className="btn btn--ghost btn--sm" onClick={() => createLifecycleTask(row, "signers")}>Signer task</button>}
                      <button className="btn btn--ghost btn--sm" onClick={() => createPublication(row)}>Publish draft</button>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          setDraft({
                            ...row,
                          });
                          setOpen(true);
                        }}
                      >
                        Edit
                      </button>
                      <button className="btn btn--ghost btn--sm btn--icon" aria-label="Delete policy" onClick={() => confirmDelete(row)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {(policies ?? []).length === 0 && (
                <tr><td colSpan={9} className="muted" style={{ textAlign: "center", padding: 24 }}>No policies yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer
        open={open}
        onClose={() => { setOpen(false); setDraft(null); }}
        title={draft?._id ? "Edit policy" : "New policy"}
        footer={
          <>
            <button className="btn" onClick={() => { setOpen(false); setDraft(null); }}>Cancel</button>
            <button className="btn btn--accent" onClick={save}>Save</button>
          </>
        }
      >
        {draft && (
          <>
            <Field label="Policy name"><input className="input" value={draft.policyName ?? ""} onChange={(e) => setDraft({ ...draft, policyName: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Policy number"><input className="input" value={draft.policyNumber ?? ""} onChange={(e) => setDraft({ ...draft, policyNumber: e.target.value })} /></Field>
              <Field label="Owner"><input className="input" value={draft.owner ?? ""} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} /></Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Effective date"><DatePicker value={draft.effectiveDate ?? ""} onChange={(value) => setDraft({ ...draft, effectiveDate: value })} /></Field>
              <Field label="Review date"><DatePicker value={draft.reviewDate ?? ""} onChange={(value) => setDraft({ ...draft, reviewDate: value })} /></Field>
              <Field label="Ceased date"><DatePicker value={draft.ceasedDate ?? ""} onChange={(value) => setDraft({ ...draft, ceasedDate: value })} /></Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <OptionSelect label="Status" setName="policyStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
              <OptionMultiSelect label="Jurisdictions" setName="entityJurisdictions" values={listValues(draft.jurisdictions)} onChange={(values) => setDraft({ ...draft, jurisdictions: values })} />
              <OptionMultiSelect label="Entity types" setName="entityTypes" values={listValues(draft.entityTypes)} onChange={(values) => setDraft({ ...draft, entityTypes: values })} rows={3} />
            </div>
            <Field label="DOCX document">
              <select className="input" value={draft.docxDocumentId ?? ""} onChange={(e) => setDraft({ ...draft, docxDocumentId: e.target.value || undefined })}>
                <option value="">No DOCX document</option>
                {(documents ?? []).map((doc: any) => <option key={doc._id} value={doc._id}>{doc.title}</option>)}
              </select>
            </Field>
            <Field label="PDF document">
              <select className="input" value={draft.pdfDocumentId ?? ""} onChange={(e) => setDraft({ ...draft, pdfDocumentId: e.target.value || undefined })}>
                <option value="">No PDF document</option>
                {(documents ?? []).map((doc: any) => <option key={doc._id} value={doc._id}>{doc.title}</option>)}
              </select>
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <RecordSelect
                label="Adoption meeting"
                value={draft.adoptedAtMeetingId}
                rows={adoptionOptions?.meetings ?? []}
                onChange={(value: string | undefined) => setDraft({ ...draft, adoptedAtMeetingId: value })}
                getLabel={(row: any) => `${row.title} - ${row.scheduledAt ? formatDate(row.scheduledAt) : "unscheduled"}`}
              />
              <RecordSelect
                label="Adoption minutes"
                value={draft.adoptedInMinutesId}
                rows={adoptionOptions?.minutes ?? []}
                onChange={(value: string | undefined) => setDraft({ ...draft, adoptedInMinutesId: value })}
                getLabel={(row: any) => `${row.heldAt ? formatDate(row.heldAt) : "Minutes"} - ${row.status ?? "draft"}`}
              />
            </div>
            <RecordSelect
              label="Adopting resolution evidence"
              value={draft.adoptingMotionEvidenceId}
              rows={adoptionOptions?.motionEvidence ?? []}
              onChange={(value: string | undefined) => setDraft({ ...draft, adoptingMotionEvidenceId: value })}
              getLabel={(row: any) => `${row.meetingDate ? formatDate(row.meetingDate) : "Motion"} - ${shortText(row.motionText, 92)}`}
            />
            <Toggle checked={!!draft.signatureRequired} onChange={(value) => setDraft({ ...draft, signatureRequired: value })} label="Signature required" />
            <OptionMultiSelect label="Required signers" setName="requiredSigners" values={listValues(draft.requiredSigners)} onChange={(values) => setDraft({ ...draft, requiredSigners: values })} />
            <Field label="HTML"><textarea className="textarea mono" value={draft.html ?? ""} onChange={(e) => setDraft({ ...draft, html: e.target.value })} /></Field>
            <Field label="Notes"><textarea className="textarea" value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
          </>
        )}
      </Drawer>
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

function listValues(value: any) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function AdoptionCell({ row, maps }: { row: any; maps: any }) {
  const meeting = row.adoptedAtMeetingId ? maps.meetings.get(row.adoptedAtMeetingId) : null;
  const minutes = row.adoptedInMinutesId ? maps.minutes.get(row.adoptedInMinutesId) : null;
  const motion = row.adoptingMotionEvidenceId ? maps.motionEvidence.get(row.adoptingMotionEvidenceId) : null;
  if (!meeting && !minutes && !motion) {
    return <Badge tone={row.status === "Active" ? "warn" : "neutral"}>{row.status === "Active" ? "Needs adoption record" : "Not linked"}</Badge>;
  }
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      {meeting && <Badge tone="success">{meeting.title}</Badge>}
      {minutes && <Badge tone="success">Minutes {minutes.heldAt ? formatDate(minutes.heldAt) : ""}</Badge>}
      {motion && <Badge tone="info">{shortText(motion.motionText, 42)}</Badge>}
    </div>
  );
}

function LifecycleBadges({ lifecycle }: { lifecycle?: any }) {
  if (!lifecycle) return <span className="muted">-</span>;
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <Badge tone={lifecycle.reviewState === "overdue" ? "danger" : lifecycle.reviewState === "due_soon" || lifecycle.reviewState === "missing_review_date" ? "warn" : "success"}>
        {labelize(lifecycle.reviewState)}
      </Badge>
      <Badge tone={lifecycle.publicationId ? "success" : "neutral"}>{lifecycle.publicationStatus ?? "not published"}</Badge>
      <Badge tone={lifecycle.signatureState === "missing_signers" ? "danger" : lifecycle.signatureState === "required" ? "warn" : "neutral"}>
        {labelize(lifecycle.signatureState)}
      </Badge>
      <Badge tone={lifecycle.adoptionState === "linked" ? "success" : lifecycle.adoptionState === "missing_adoption_record" ? "warn" : "neutral"}>
        {labelize(lifecycle.adoptionState)}
      </Badge>
      <Badge>{lifecycle.versionCount ?? 0} versions</Badge>
      <Badge>{lifecycle.taskCount ?? 0} tasks</Badge>
    </div>
  );
}

function toneForStatus(status?: string) {
  const value = String(status ?? "").toLowerCase();
  if (value.includes("active") || value.includes("approved")) return "success" as const;
  if (value.includes("review") || value.includes("draft")) return "warn" as const;
  if (value.includes("ceased") || value.includes("superseded")) return "danger" as const;
  return "neutral" as const;
}

function labelize(value?: string) {
  return String(value ?? "-").replace(/_/g, " ");
}

function shortText(value: unknown, max: number) {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}
