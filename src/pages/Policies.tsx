import { SourceProvenanceButton } from "../components/SourceProvenanceButton";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { ImportCandidatesNotice } from "../components/ImportCandidatesNotice";
import { Badge, Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { Toggle } from "../components/Controls";
import { OptionMultiSelect, OptionSelect } from "../components/OptionSelect";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { FileText, Plus, Trash2 } from "lucide-react";
import { formatDate } from "../lib/format";
import { OPTION_SETS, optionLabel } from "../lib/orgHubOptions";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { INCORPORATION_JURISDICTION_CODES } from "../../shared/incorporationActs";
import {
  FIELD_TYPES,
  RecordListTable,
  RecordTableEmpty,
  RecordTablePhoneCard,
  staticRecordTable,
} from "@/platform/record-engine";
import type { TagColor } from "../components/Tag";

/** The fields of a policy row (api.policies.list) this page reads. */
type PolicyRow = {
  _id: string;
  policyName: string;
  policyNumber?: string;
  owner?: string;
  effectiveDate?: string;
  reviewDate?: string;
  ceasedDate?: string;
  docxDocumentId?: string;
  pdfDocumentId?: string;
  adoptedAtMeetingId?: string;
  adoptedInMinutesId?: string;
  adoptingMotionEvidenceId?: string;
  signatureRequired?: boolean;
  requiredSigners?: string[];
  status?: string;
  lifecycle?: {
    reviewState?: string;
    publicationStatus?: string;
    signatureState?: string;
    versionCount?: number;
    taskCount?: number;
    openTaskCount?: number;
    draftPublicationCount?: number;
  };
};

type AdoptionState = "linked" | "needs_record" | "not_linked";

/** A policy as the table reads it: composite columns as searchable text or select values, the row itself for its cells and actions. */
type PolicyRecord = {
  _id: string;
  policyName: string;
  policyNumber: string | null;
  status: string | null;
  owner: string | null;
  effectiveDate: string | null;
  reviewDate: string | null;
  ceasedDate: string | null;
  documents: string;
  docxLabel: string;
  pdfLabel: string;
  adoption: AdoptionState;
  signatureRequired: boolean;
  requiredSigners: string[];
  policy: PolicyRow;
};

const TONE_COLORS: Record<ReturnType<typeof toneForStatus>, TagColor> = {
  success: "green",
  warn: "amber",
  danger: "red",
  neutral: "gray",
};

const POLICIES = staticRecordTable({
  id: "policies",
  nameSingular: "policy",
  namePlural: "policies",
  labelSingular: "Policy",
  labelPlural: "Policies",
  labelIdentifierFieldName: "policyName",
  density: "comfortable",
  fields: [
    { name: "policyName", label: "Policy", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    // Status leads the facts so it stays in view however wide the register is (X-02).
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 260,
      config: {
        options: OPTION_SETS.policyStatuses.map((option) => ({
          value: option.value,
          label: option.label,
          color: TONE_COLORS[toneForStatus(option.value)],
        })),
      },
    },
    { name: "owner", label: "Owner", fieldType: FIELD_TYPES.TEXT, size: 130 },
    { name: "effectiveDate", label: "Dates", fieldType: FIELD_TYPES.DATE, size: 170 },
    { name: "documents", label: "Documents", fieldType: FIELD_TYPES.TEXT, size: 180, config: { groupable: false } },
    {
      name: "adoption",
      label: "Adoption",
      fieldType: FIELD_TYPES.SELECT,
      size: 190,
      config: {
        options: [
          { value: "linked", label: "Adoption linked", color: "green" },
          { value: "needs_record", label: "Needs adoption record", color: "amber" },
          { value: "not_linked", label: "Not linked", color: "gray" },
        ],
      },
    },
    { name: "signatureRequired", label: "Signers", fieldType: FIELD_TYPES.BOOLEAN, size: 180, config: { trueLabel: "Required", falseLabel: "Not required" } },
    { name: "policyNumber", label: "Policy number", fieldType: FIELD_TYPES.TEXT, size: 140, isVisible: false },
    { name: "reviewDate", label: "Review date", fieldType: FIELD_TYPES.DATE, size: 140, isVisible: false },
    { name: "ceasedDate", label: "Ceased date", fieldType: FIELD_TYPES.DATE, size: 140, isVisible: false },
    {
      name: "requiredSigners",
      label: "Required signers",
      fieldType: FIELD_TYPES.MULTI_SELECT,
      size: 200,
      isVisible: false,
      config: { options: OPTION_SETS.requiredSigners.map((option) => ({ ...option, color: "amber" })) },
    },
  ],
});

type AdoptionMaps = { meetings: Map<string, unknown>; minutes: Map<string, unknown>; motionEvidence: Map<string, unknown> };

function toPolicyRecord(policy: PolicyRow, docById: Map<string, { title?: string }>, maps: AdoptionMaps): PolicyRecord {
  const linked = [
    policy.adoptedAtMeetingId && maps.meetings.get(policy.adoptedAtMeetingId),
    policy.adoptedInMinutesId && maps.minutes.get(policy.adoptedInMinutesId),
    policy.adoptingMotionEvidenceId && maps.motionEvidence.get(policy.adoptingMotionEvidenceId),
  ].some(Boolean);
  const docxLabel = policy.docxDocumentId ? docById.get(policy.docxDocumentId)?.title ?? "DOCX linked" : "No DOCX";
  const pdfLabel = policy.pdfDocumentId ? docById.get(policy.pdfDocumentId)?.title ?? "PDF linked" : "No PDF";
  return {
    _id: policy._id,
    policyName: policy.policyName,
    policyNumber: policy.policyNumber ?? null,
    status: policy.status ?? null,
    owner: policy.owner ?? null,
    effectiveDate: policy.effectiveDate ?? null,
    reviewDate: policy.reviewDate ?? null,
    ceasedDate: policy.ceasedDate ?? null,
    documents: `${docxLabel} · ${pdfLabel}`,
    docxLabel,
    pdfLabel,
    adoption: linked ? "linked" : policy.status === "Active" ? "needs_record" : "not_linked",
    signatureRequired: !!policy.signatureRequired,
    requiredSigners: policy.requiredSigners ?? [],
    policy,
  };
}

/** Table rows are one line tall: badge groups stay on one line (the cell clips them) rather than wrapping. */
const ONE_LINE_BADGES = { flexWrap: "nowrap", maxWidth: "none" } as const;

function reviewText(row: PolicyRow) {
  if (!row.reviewDate) return "No review date";
  return `Review ${formatDate(row.reviewDate)}${row.lifecycle?.reviewState === "overdue" ? " · Overdue" : ""}`;
}

export function PoliciesPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("documents:write");
  const policies = useQuery(api.policies.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const adoptionOptions = useQuery(api.policies.adoptionOptions, society ? { societyId: society._id } : "skip");
  const upsert = usePermissionedMutation(api.policies.upsert, canWrite);
  const remove = usePermissionedMutation(api.policies.remove, canWrite);
  // Global search links to `?record=<id>`: the record table opens that policy's preview and marks its row.
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
  const policyRecords = useMemo(
    () => ((policies ?? []) as PolicyRow[]).map((policy) => toPolicyRecord(policy, docById, adoptionMaps)),
    [policies, docById, adoptionMaps],
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

      <RecordListTable<PolicyRecord>
        table={POLICIES}
        tableId="policies"
        label="Policies"
        icon={<FileText size={14} />}
        records={policyRecords}
        loading={policies === undefined}
        showTotals={false}
        renderCell={({ record, field }) => {
          const { policy: row } = record;
          if (field.name === "policyName") return (
            <div className="record-table__identifier-lines">
              <span className="record-table__identifier-primary row" style={{ gap: 6, flexWrap: "nowrap" }}>
                <strong>{row.policyName}</strong>
                <SourceProvenanceButton table="policies" id={row._id} />
              </span>
              {row.policyNumber && <div className="record-table__identifier-secondary mono muted">{row.policyNumber}</div>}
            </div>
          );
          if (field.name === "owner") return <span>{row.owner || "-"}</span>;
          if (field.name === "effectiveDate") {
            const overdue = row.lifecycle?.reviewState === "overdue";
            return (
              <div className="record-table__identifier-lines">
                <span className="record-table__identifier-primary">{row.effectiveDate ? formatDate(row.effectiveDate) : "No effective date"}</span>
                <div className={overdue ? "record-table__identifier-secondary" : "record-table__identifier-secondary muted"} style={overdue ? { color: "var(--danger)", fontWeight: 600 } : undefined}>
                  {reviewText(row)}
                </div>
              </div>
            );
          }
          if (field.name === "documents") {
            const { docxLabel, pdfLabel } = record;
            return (
              <div className="record-table__identifier-lines">
                <span className="record-table__identifier-primary">{docxLabel}</span>
                <div className="record-table__identifier-secondary muted">{pdfLabel}</div>
              </div>
            );
          }
          if (field.name === "adoption") return <AdoptionCell row={row} maps={adoptionMaps} />;
          if (field.name === "signatureRequired") return row.signatureRequired ? (
            <div className="row policies-table__badges" style={ONE_LINE_BADGES}>
              {(row.requiredSigners ?? []).length
                ? (row.requiredSigners ?? []).map((value) => <Badge key={value} tone="warn">{optionLabel("requiredSigners", value)}</Badge>)
                : <Badge tone="warn">Needs review</Badge>}
            </div>
          ) : (
            <span className="muted">Not required</span>
          );
          if (field.name === "status") return (
            <div className="row policies-table__badges" style={ONE_LINE_BADGES}>
              <Badge tone={toneForStatus(row.status)}>{optionLabel("policyStatuses", row.status ?? "") || row.status}</Badge>
              <LifecycleBadges lifecycle={row.lifecycle} />
            </div>
          );
          return undefined;
        }}
        renderPhoneCard={(record, { field, selecting }) => {
          const { policy: row } = record;
          return (
            <RecordTablePhoneCard
              title={row.policyName}
              badge={field("status")}
              meta={[row.owner ?? "", reviewText(row)]}
              detail={[row.policyNumber ?? ""]}
              selecting={selecting}
            />
          );
        }}
        rowMenuSections={(record) => {
          const { policy: row } = record;
          return [
            {
              id: "policy-actions",
              items: [
                { id: "review", label: "Review task", disabled: !canWrite, onSelect: () => createLifecycleTask(row, "review") },
                ...(row.signatureRequired
                  ? [{ id: "signers", label: "Signer task", disabled: !canWrite, onSelect: () => createLifecycleTask(row, "signers") }]
                  : []),
                { id: "publish", label: "Publish draft", disabled: !canWrite, onSelect: () => createPublication(row) },
                { id: "edit", label: "Edit", disabled: !canWrite, onSelect: () => { if (!canWrite) return; setDraft({ ...row }); setOpen(true); } },
                { id: "delete", label: "Delete", icon: <Trash2 size={14} />, destructive: true, disabled: !canWrite, onSelect: () => confirmDelete(row) },
              ],
            },
          ];
        }}
        emptyState={<RecordTableEmpty title="No policies yet" />}
      />

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
              <OptionMultiSelect label="Jurisdictions" setName="entityJurisdictions" hideValues={["CA-BC", "CA-FED-CBCA", "CA-ON-OBCA", ...INCORPORATION_JURISDICTION_CODES]} values={listValues(draft.jurisdictions)} onChange={(values) => setDraft({ ...draft, jurisdictions: values })} />
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
