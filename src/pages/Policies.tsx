import { SourceProvenanceButton } from "../components/SourceProvenanceButton";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { ImportCandidatesNotice } from "../components/ImportCandidatesNotice";
import { Badge, Drawer, Field } from "../components/ui";
import { Menu } from "../components/Menu";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { Toggle } from "../components/Controls";
import { OptionMultiSelect, OptionSelect } from "../components/OptionSelect";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { FileText, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { formatDate } from "../lib/format";
import { optionLabel } from "../lib/orgHubOptions";
import { MarkdownEditor } from "../components/MarkdownEditor";

export function PoliciesPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("documents:write");
  const policies = useQuery(api.policies.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const adoptionOptions = useQuery(api.policies.adoptionOptions, society ? { societyId: society._id } : "skip");
  const upsert = usePermissionedMutation(api.policies.upsert, canWrite);
  const remove = usePermissionedMutation(api.policies.remove, canWrite);
  // Global search links to `?record=<id>`: scroll that policy into view and mark it.
  const [searchParams] = useSearchParams();
  const linkedPolicyId = searchParams.get("record");
  useEffect(() => {
    if (!linkedPolicyId || !policies) return;
    const row = document.getElementById(`policy-${linkedPolicyId}`);
    row?.scrollIntoView({ block: "center" });
    row?.focus({ preventScroll: true });
  }, [linkedPolicyId, policies]);
  const createReviewTask = usePermissionedMutation(api.policies.createReviewTask, canWrite);
  const createSignerTask = usePermissionedMutation(api.policies.createRequiredSignerTask, canWrite);
  const createTransparencyDraft = usePermissionedMutation(api.policies.createTransparencyDraft, canWrite);
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

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    if (!canWrite) return;
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
    if (!canWrite) return;
    if (!draft) return;
    if (!String(draft.policyName ?? "").trim()) {
      toast.error("Policy not saved", "Enter the policy name.");
      return;
    }
    try {
    await upsert({
      id: draft._id,
      societyId: society._id,
      policyName: draft.policyName.trim(),
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
    } catch (error) {
      toast.error("Policy not saved", error instanceof Error ? error.message : String(error));
    }
  };

  const confirmDelete = async (row: any) => {
    if (!canWrite) return;
    const openTasks = (row.lifecycle?.openTaskCount ?? 0) as number;
    const drafts = (row.lifecycle?.draftPublicationCount ?? 0) as number;
    const ok = await confirm({
      title: "Delete policy?",
      message: `"${row.policyName}" will be removed from the policy registry, together with ${openTasks} open review/signature task(s) and ${drafts} unpublished transparency draft(s). Published items and completed tasks are kept.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await remove({ id: row._id });
    toast.success("Policy deleted");
  };

  const createLifecycleTask = async (row: any, kind: "review" | "signers") => {
    if (!canWrite) return;
    if (kind === "review") await createReviewTask({ policyId: row._id });
    if (kind === "signers") await createSignerTask({ policyId: row._id });
    toast.success(kind === "review" ? "Review task created" : "Signer task created");
  };

  const createPublication = async (row: any) => {
    if (!canWrite) return;
    await createTransparencyDraft({ policyId: row._id });
    toast.success("Transparency draft ready");
  };

  return (
    <div className="page page--wide">
      <PageHeader
        title="Policy registry"
        icon={<FileText size={16} />}
        iconColor="green"
        subtitle="Your policies with their documents, review dates and signers."
        actions={
          <button className="btn-action btn-action--primary" disabled={!canWrite} onClick={openNew}>
            <Plus size={12} /> New policy
          </button>
        }
      />
      <ImportCandidatesNotice noun="policy" targets={["policies"]} kinds={["policy"]} documentCategory="Policy" emptyRegister={!(policies ?? []).length} />

      <div className="card">
        <div className="table-wrap">
          <table className="table table--stack-mobile policies-table review-stack-inline">
            <thead>
              <tr>
                <th>Policy</th>
                <th>Owner</th>
                <th>Dates</th>
                <th>Documents</th>
                <th>Adoption</th>
                <th>Signers</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(policies ?? []).map((row: any) => (
                <tr
                  key={row._id}
                  id={`policy-${row._id}`}
                  tabIndex={row._id === linkedPolicyId ? -1 : undefined}
                  aria-current={row._id === linkedPolicyId ? "true" : undefined}
                  className={row._id === linkedPolicyId ? "is-linked-record" : undefined}
                >
                  <td data-label="Policy">
                    <strong>{row.policyName}</strong>
                    {row.policyNumber && <div className="mono muted">{row.policyNumber}</div>}
                    <SourceProvenanceButton table="policies" id={row._id} />
                  </td>
                  <td data-label="Owner">{row.owner || "-"}</td>
                  <td data-label="Dates">
                    <div>{row.effectiveDate ? formatDate(row.effectiveDate) : "No effective date"}</div>
                    <div className={row.lifecycle?.reviewState === "overdue" ? "" : "muted"} style={row.lifecycle?.reviewState === "overdue" ? { color: "var(--danger)", fontWeight: 600 } : undefined}>
                      {row.reviewDate ? `Review ${formatDate(row.reviewDate)}${row.lifecycle?.reviewState === "overdue" ? " · Overdue" : ""}` : "No review date"}
                    </div>
                  </td>
                  <td data-label="Documents">
                    <div>{row.docxDocumentId ? docById.get(row.docxDocumentId)?.title ?? "DOCX linked" : "No DOCX"}</div>
                    <div className="muted">{row.pdfDocumentId ? docById.get(row.pdfDocumentId)?.title ?? "PDF linked" : "No PDF"}</div>
                  </td>
                  <td data-label="Adoption"><AdoptionCell row={row} maps={adoptionMaps} /></td>
                  <td data-label="Signers">
                    {row.signatureRequired ? (
                      <div className="row policies-table__badges">
                        {(row.requiredSigners ?? []).length
                          ? (row.requiredSigners ?? []).map((value: string) => <Badge key={value} tone="warn">{optionLabel("requiredSigners", value)}</Badge>)
                          : <Badge tone="warn">Needs review</Badge>}
                      </div>
                    ) : (
                      <span className="muted">Not required</span>
                    )}
                  </td>
                  <td data-label="Status">
                    <div className="row policies-table__badges">
                      <Badge tone={toneForStatus(row.status)}>{optionLabel("policyStatuses", row.status) || row.status}</Badge>
                      <LifecycleBadges lifecycle={row.lifecycle} />
                    </div>
                  </td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <Menu
                        align="right"
                        trigger={
                          <button className="btn btn--ghost btn--sm btn--icon" aria-label="Policy actions" disabled={!canWrite}>
                            <MoreHorizontal size={14} />
                          </button>
                        }
                        sections={[
                          {
                            id: "policy-actions",
                            items: [
                              { id: "review", label: "Review task", onSelect: () => createLifecycleTask(row, "review") },
                              ...(row.signatureRequired
                                ? [{ id: "signers", label: "Signer task", onSelect: () => createLifecycleTask(row, "signers") }]
                                : []),
                              { id: "publish", label: "Publish draft", onSelect: () => createPublication(row) },
                              { id: "edit", label: "Edit", onSelect: () => { if (!canWrite) return; setDraft({ ...row }); setOpen(true); } },
                              { id: "delete", label: "Delete", icon: <Trash2 size={14} />, destructive: true, onSelect: () => confirmDelete(row) },
                            ],
                          },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {(policies ?? []).length === 0 && (
                <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 24 }}>No policies yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer
        open={open && canWrite}
        onClose={() => { setOpen(false); setDraft(null); }}
        title={draft?._id ? "Edit policy" : "New policy"}
        footer={
          <>
            <button className="btn" onClick={() => { setOpen(false); setDraft(null); }}>Cancel</button>
            <button className="btn btn--accent" disabled={!canWrite} onClick={save}>Save</button>
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
              <OptionMultiSelect label="Jurisdictions" setName="entityJurisdictions" hideValues={["CA-BC", "CA-FED-CBCA", "CA-ON-OBCA"]} values={listValues(draft.jurisdictions)} onChange={(values) => setDraft({ ...draft, jurisdictions: values })} />
              <OptionMultiSelect label="Entity types" setName="entityTypes" values={listValues(draft.entityTypes)} onChange={(values) => setDraft({ ...draft, entityTypes: values })} rows={3} />
            </div>
            <Field label="DOCX document">
              <Select
                value={draft.docxDocumentId ?? ""}
                onChange={(value) => setDraft({ ...draft, docxDocumentId: value || undefined })}
                options={[
                  { value: "", label: "No DOCX document" },
                  ...(documents ?? []).map((doc: any) => ({ value: doc._id, label: doc.title })),
                ]}
              />
            </Field>
            <Field label="PDF document">
              <Select
                value={draft.pdfDocumentId ?? ""}
                onChange={(value) => setDraft({ ...draft, pdfDocumentId: value || undefined })}
                options={[
                  { value: "", label: "No PDF document" },
                  ...(documents ?? []).map((doc: any) => ({ value: doc._id, label: doc.title })),
                ]}
              />
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
            <Field label="Notes"><MarkdownEditor rows={4} value={draft.notes ?? ""} onChange={(markdown) => setDraft({ ...draft, notes: markdown })} /></Field>
          </>
        )}
      </Drawer>
    </div>
  );
}

function RecordSelect({ label, value, rows, onChange, getLabel }: any) {
  return (
    <Field label={label}>
      <Select
        value={value ?? ""}
        onChange={(next) => onChange(next || undefined)}
        options={[
          { value: "", label: `No ${label.toLowerCase()}` },
          ...rows.map((row: any) => ({ value: row._id, label: getLabel(row) })),
        ]}
      />
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

/**
 * Lifecycle facts not already shown in their own column (review state is in
 * Dates, signers in Signers, adoption in Adoption): publication, versions and
 * open tasks. Kept compact so the table fits a 1440 px window (X-02).
 */
function LifecycleBadges({ lifecycle }: { lifecycle?: any }) {
  if (!lifecycle) return null;
  const published = lifecycle.publicationStatus === "Published";
  return (
    <>
      <Badge tone={published ? "success" : "neutral"}>{published ? "Published" : lifecycle.publicationStatus ? `Publication ${String(lifecycle.publicationStatus).toLowerCase()}` : "Not published"}</Badge>
      {lifecycle.signatureState === "missing_signers" && <Badge tone="danger">{labelize(lifecycle.signatureState)}</Badge>}
      <span className="muted policies-table__counts">{pluralizeCount(lifecycle.versionCount ?? 0, "version")} · {pluralizeCount(lifecycle.taskCount ?? 0, "task")}</span>
    </>
  );
}

function pluralizeCount(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function toneForStatus(status?: string) {
  const value = String(status ?? "").toLowerCase();
  if (value.includes("active") || value.includes("approved")) return "success" as const;
  if (value.includes("review") || value.includes("draft")) return "warn" as const;
  if (value.includes("ceased") || value.includes("superseded")) return "danger" as const;
  return "neutral" as const;
}

const LIFECYCLE_LABELS: Record<string, string> = {
  overdue: "Review overdue",
  due_soon: "Review due soon",
  scheduled: "Review scheduled",
  missing_review_date: "No review date",
  required: "Signatures required",
  missing_signers: "Signers missing",
  not_required: "No signatures needed",
  linked: "Adoption linked",
  missing_adoption_record: "Adoption not recorded",
  not_linked: "Adoption n/a",
};

function labelize(value?: string) {
  if (value && LIFECYCLE_LABELS[value]) return LIFECYCLE_LABELS[value];
  const text = String(value ?? "-").replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function shortText(value: unknown, max: number) {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}
