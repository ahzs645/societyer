import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useUndoableAction } from "../hooks/useUndoableAction";
import { Archive, Banknote, ClipboardCheck, FileSearch, GitBranch, Plus } from "lucide-react";
import { todayDateOnly } from "../../shared/dateOnly";
import { ImportCandidatesNotice } from "../components/ImportCandidatesNotice";
import {
  EVIDENCE_REVIEW_STATUSES,
  evidenceReviewStatusLabel,
  evidenceReviewStatusTone,
  normalizeEvidenceReviewStatus,
} from "../../shared/documentReviewStatus";
import { StatTile } from "../components/StatTile";
import type { MenuSection } from "../components/Menu";
import { entityHref } from "../components/HoverCard/entityRefs";
import {
  FIELD_TYPES,
  RecordListTable,
  RecordTableEmpty,
  staticRecordTable,
  type BulkAction,
  type FieldMetadata,
  type StaticFieldDefinition,
  type StaticRecordTableDefinition,
} from "@/platform/record-engine";

/* ------------------------------------------------------------ register tables */

/** A register row as `evidenceRegisters.overview` returns it (the fields these registers read). */
type EvidenceRow = {
  _id: string;
  status?: string;
  sourceDocumentIds?: string[];
  personName?: string;
  directorId?: string;
  memberId?: string;
  directoryPersonId?: string;
  roleTitle?: string;
  roleGroup?: string;
  startDate?: string;
  effectiveDate?: string;
  changeType?: string;
  institutionName?: string;
  authorityType?: string;
  meetingId?: string;
  meetingTitle?: string;
  meetingDate?: string;
  attendanceStatus?: string;
  confidence?: string;
  duplicateCount?: number;
  motionText?: string;
  outcome?: string;
  fiscalYear?: string | number;
  title?: string;
  totalIncomeCents?: number;
  totalExpenseCents?: number;
  periodEnd?: string;
  statementType?: string;
  revenueCents?: number;
  expensesCents?: number;
  reportDate?: string;
  cashBalanceCents?: number;
  highlights?: unknown[];
  transactionDate?: string;
  description?: string;
  debitCredit?: string;
  amountCents?: number;
  chequeNumber?: string;
  balanceCents?: number;
  dateReceived?: string;
  containerType?: string;
  location?: string;
  sourceTitle?: string;
  sourceDocumentId?: string;
  sourceDocumentKind?: string;
  canonicalDocumentId?: string;
  evidenceKind?: string;
  targetTable?: string;
  accessLevel?: string;
};

/** A register row as its table reads it: the values its columns sort and filter by, plus the row. */
type RegisterRecord = Record<string, unknown> & { _id: string; row: EvidenceRow };

type RegisterDefinition = {
  table: StaticRecordTableDefinition;
  values: (row: EvidenceRow) => Record<string, unknown>;
};

const NO_ROWS: EvidenceRow[] = [];

/** Every register's status: review states by label, plus the stored vocabularies imports write. */
const STATUS_FIELD: StaticFieldDefinition = {
  name: "status",
  label: "Status",
  fieldType: FIELD_TYPES.SELECT,
  size: 130,
  config: {
    options: [
      { value: "Needs review", label: "Needs review", color: "amber" },
      { value: "Linked", label: "Linked", color: "blue" },
      { value: "Verified", label: "Verified", color: "green" },
      { value: "Rejected", label: "Rejected", color: "red" },
      { value: "Observed", label: "Observed", color: "blue" },
      { value: "Extracted", label: "Extracted", color: "blue" },
    ],
  },
};

/** The documents a register row was read from (the first opens in Documents). */
const SOURCE_FIELD: StaticFieldDefinition = { name: "sourceDocuments", label: "Source", fieldType: FIELD_TYPES.NUMBER, size: 110 };

function registerDefinition({
  name,
  singular,
  plural,
  identifier,
  fields,
  values,
  sourceColumn = true,
}: {
  /** camelCase, unique among registers. */
  name: string;
  singular: string;
  plural: string;
  identifier: string;
  fields: StaticFieldDefinition[];
  values: RegisterDefinition["values"];
  /** A "Source" column for the row's source documents (off where the row is itself a source link). */
  sourceColumn?: boolean;
}): RegisterDefinition {
  return {
    table: staticRecordTable({
      id: `evidence-register:${name}`,
      nameSingular: `evidenceRegister${name[0].toUpperCase()}${name.slice(1)}`,
      namePlural: `evidenceRegister${name[0].toUpperCase()}${name.slice(1)}s`,
      labelSingular: singular,
      labelPlural: plural,
      labelIdentifierFieldName: identifier,
      fields: [...fields, STATUS_FIELD, ...(sourceColumn ? [SOURCE_FIELD] : [])],
    }),
    values: (row) => ({ ...values(row), status: registerStatusLabel(row.status), sourceDocuments: row.sourceDocumentIds?.length ?? 0 }),
  };
}

const ROLE_ASSIGNMENTS = registerDefinition({
  name: "roleAssignment",
  singular: "Role assignment",
  plural: "Role assignments",
  identifier: "personName",
  fields: [
    { name: "personName", label: "Person", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    { name: "roleTitle", label: "Role", fieldType: FIELD_TYPES.TEXT, size: 160 },
    { name: "roleGroup", label: "Group", fieldType: FIELD_TYPES.TEXT, size: 130 },
    { name: "startDate", label: "Start", fieldType: FIELD_TYPES.DATE, size: 120 },
    {
      name: "directorRegister",
      label: "Director register",
      fieldType: FIELD_TYPES.SELECT,
      size: 140,
      config: { options: [{ value: "Promoted", label: "Promoted", color: "green" }, { value: "Not promoted", label: "Not promoted", color: "gray" }] },
    },
  ],
  values: (row) => ({
    personName: row.personName ?? "",
    roleTitle: row.roleTitle ?? "",
    roleGroup: row.roleGroup ?? "",
    startDate: row.startDate ?? null,
    directorRegister: row.directorId ? "Promoted" : "Not promoted",
  }),
});

const ROLE_CHANGES = registerDefinition({
  name: "roleChange",
  singular: "Role change",
  plural: "Role changes",
  identifier: "personName",
  fields: [
    { name: "personName", label: "Person", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    { name: "changeType", label: "Change", fieldType: FIELD_TYPES.TEXT, size: 150 },
    { name: "roleTitle", label: "Role", fieldType: FIELD_TYPES.TEXT, size: 160 },
    { name: "effectiveDate", label: "Effective", fieldType: FIELD_TYPES.DATE, size: 120 },
  ],
  values: (row) => ({
    personName: row.personName ?? "",
    changeType: row.changeType ?? "",
    roleTitle: row.roleTitle ?? "",
    effectiveDate: row.effectiveDate ?? null,
  }),
});

const SIGNING_AUTHORITIES = registerDefinition({
  name: "signingAuthority",
  singular: "Signing authority",
  plural: "Signing authorities",
  identifier: "personName",
  fields: [
    { name: "personName", label: "Person", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    { name: "institutionName", label: "Institution", fieldType: FIELD_TYPES.TEXT, size: 180 },
    { name: "authorityType", label: "Authority", fieldType: FIELD_TYPES.TEXT, size: 140 },
    { name: "effectiveDate", label: "Effective", fieldType: FIELD_TYPES.DATE, size: 120 },
  ],
  values: (row) => ({
    personName: row.personName ?? "",
    institutionName: row.institutionName ?? "",
    authorityType: capitalize(row.authorityType),
    effectiveDate: row.effectiveDate ?? null,
  }),
});

const ATTENDANCE = registerDefinition({
  name: "attendance",
  singular: "Attendance record",
  plural: "Attendance records",
  identifier: "meetingTitle",
  fields: [
    { name: "meetingTitle", label: "Meeting", fieldType: FIELD_TYPES.TEXT, size: 220 },
    { name: "meetingDate", label: "Date", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "personName", label: "Person", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "attendanceStatus", label: "Attendance", fieldType: FIELD_TYPES.TEXT, size: 150 },
    {
      name: "confidence",
      label: "Confidence",
      fieldType: FIELD_TYPES.SELECT,
      size: 120,
      config: {
        options: [
          { value: "High", label: "High", color: "green" },
          { value: "Medium", label: "Medium", color: "blue" },
          { value: "Low", label: "Low", color: "amber" },
          { value: "Review", label: "Review", color: "amber" },
        ],
      },
    },
  ],
  values: (row) => ({
    meetingTitle: row.meetingTitle ?? "",
    meetingDate: row.meetingDate ?? null,
    personName: row.personName ?? "",
    attendanceStatus: !row.attendanceStatus || /^unknown$/i.test(row.attendanceStatus) ? "Not stated" : row.attendanceStatus,
    confidence: row.confidence ?? "Review",
  }),
});

const MOTIONS = registerDefinition({
  name: "motionEvidence",
  singular: "Motion",
  plural: "Motions",
  identifier: "motionText",
  fields: [
    { name: "motionText", label: "Motion", fieldType: FIELD_TYPES.TEXT, size: 320, config: { groupable: false } },
    { name: "meetingTitle", label: "Meeting", fieldType: FIELD_TYPES.TEXT, size: 200 },
    { name: "meetingDate", label: "Date", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "outcome", label: "Outcome", fieldType: FIELD_TYPES.TEXT, size: 130 },
  ],
  values: (row) => ({
    motionText: row.motionText ?? "",
    meetingTitle: row.meetingTitle ?? "",
    meetingDate: row.meetingDate ?? null,
    outcome: row.outcome ?? "",
  }),
});

const BUDGET_SNAPSHOTS = registerDefinition({
  name: "budgetSnapshot",
  singular: "Budget snapshot",
  plural: "Budget snapshots",
  identifier: "title",
  fields: [
    { name: "title", label: "Title", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    { name: "fiscalYear", label: "Fiscal year", fieldType: FIELD_TYPES.TEXT, size: 110 },
    { name: "totalIncomeCents", label: "Income", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: { isCents: true } },
    { name: "totalExpenseCents", label: "Expense", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: { isCents: true } },
  ],
  values: (row) => ({
    title: row.title ?? "",
    fiscalYear: row.fiscalYear == null ? "" : String(row.fiscalYear),
    totalIncomeCents: row.totalIncomeCents ?? null,
    totalExpenseCents: row.totalExpenseCents ?? null,
  }),
});

const STATEMENT_IMPORTS = registerDefinition({
  name: "statementImport",
  singular: "Statement import",
  plural: "Statement imports",
  identifier: "statementType",
  fields: [
    { name: "statementType", label: "Type", fieldType: FIELD_TYPES.TEXT, size: 200 },
    { name: "periodEnd", label: "Period end", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "revenueCents", label: "Revenue", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: { isCents: true } },
    { name: "expensesCents", label: "Expenses", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: { isCents: true } },
  ],
  values: (row) => ({
    statementType: row.statementType ?? "",
    periodEnd: row.periodEnd ?? null,
    revenueCents: row.revenueCents ?? null,
    expensesCents: row.expensesCents ?? null,
  }),
});

const TREASURER_REPORTS = registerDefinition({
  name: "treasurerReport",
  singular: "Treasurer report",
  plural: "Treasurer reports",
  identifier: "title",
  fields: [
    { name: "title", label: "Title", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    { name: "reportDate", label: "Date", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "cashBalanceCents", label: "Cash", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: { isCents: true } },
    { name: "highlights", label: "Highlights", fieldType: FIELD_TYPES.NUMBER, size: 110 },
  ],
  values: (row) => ({
    title: row.title ?? "",
    reportDate: row.reportDate ?? null,
    cashBalanceCents: row.cashBalanceCents ?? null,
    highlights: row.highlights?.length ?? 0,
  }),
});

const TRANSACTION_CANDIDATES = registerDefinition({
  name: "transactionCandidate",
  singular: "Transaction",
  plural: "Transactions",
  identifier: "description",
  fields: [
    { name: "description", label: "Description", fieldType: FIELD_TYPES.TEXT, size: 280, config: { groupable: false } },
    { name: "transactionDate", label: "Date", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "debitCredit", label: "Debit/Credit", fieldType: FIELD_TYPES.TEXT, size: 120 },
    { name: "amountCents", label: "Amount", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: { isCents: true } },
    { name: "chequeNumber", label: "Cheque/ref", fieldType: FIELD_TYPES.TEXT, size: 120 },
    { name: "balanceCents", label: "Balance", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: { isCents: true } },
  ],
  values: (row) => ({
    description: row.description ?? "",
    transactionDate: row.transactionDate ?? null,
    debitCredit: row.debitCredit ?? "",
    amountCents: row.amountCents ?? null,
    chequeNumber: row.chequeNumber ?? "",
    balanceCents: row.balanceCents ?? null,
  }),
});

const ACCESSIONS = registerDefinition({
  name: "archiveAccession",
  singular: "Accession",
  plural: "Accessions",
  identifier: "title",
  fields: [
    { name: "title", label: "Title", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    { name: "dateReceived", label: "Received", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "containerType", label: "Container", fieldType: FIELD_TYPES.TEXT, size: 140 },
    { name: "location", label: "Location", fieldType: FIELD_TYPES.TEXT, size: 180 },
  ],
  values: (row) => ({
    title: row.title ?? "",
    dateReceived: row.dateReceived ?? null,
    containerType: row.containerType ?? "",
    location: row.location ?? "",
  }),
});

const EVIDENCE_KIND_LABELS: Record<string, string> = {
  provenance: "Provenance",
  restricted: "Restricted",
  publication_sidecar: "Publication sidecar",
  import_support: "Import support",
};

const SOURCE_EVIDENCE = registerDefinition({
  name: "sourceEvidence",
  singular: "Evidence link",
  plural: "Evidence links",
  identifier: "sourceTitle",
  sourceColumn: false,
  fields: [
    { name: "sourceTitle", label: "Source", fieldType: FIELD_TYPES.TEXT, size: 260, config: { groupable: false } },
    {
      name: "evidenceKind",
      label: "Kind",
      fieldType: FIELD_TYPES.SELECT,
      size: 150,
      config: { options: Object.entries(EVIDENCE_KIND_LABELS).map(([value, label]) => ({ value, label, color: "gray" })) },
    },
    { name: "targetTable", label: "Model destination", fieldType: FIELD_TYPES.TEXT, size: 170 },
    {
      name: "accessLevel",
      label: "Access",
      fieldType: FIELD_TYPES.SELECT,
      size: 110,
      config: {
        options: [
          { value: "public", label: "public", color: "blue" },
          { value: "internal", label: "internal", color: "blue" },
          { value: "restricted", label: "restricted", color: "red" },
        ],
      },
    },
  ],
  values: (row) => ({
    sourceTitle: row.sourceTitle ?? "",
    evidenceKind: row.evidenceKind ?? "",
    targetTable: row.targetTable ?? "",
    accessLevel: row.accessLevel ?? "",
  }),
});

export function GovernanceRegistersPage() {
  const { society, data, people } = useRegisters();
  const permissions = usePermissions();
  const canEdit = permissions.loaded && permissions.can("documents:write");
  const canPromote = canEdit && permissions.can("directors:write");
  const promoteBoardRole = usePermissionedMutation(api.evidenceRegisters.promoteBoardRoleToDirector, canPromote);
  const createManual = usePermissionedMutation(api.evidenceRegisters.createManual, canEdit);
  const confirm = useConfirm();
  const toast = useToast();
  const [addForm, setAddForm] = useState<any>(null);
  const directors = useQuery(
    api.directors.list,
    society && permissions.can("directors:read") ? { societyId: society._id } : "skip",
  ) as any[] | undefined;
  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const saveManual = async () => {
    if (!addForm || !society || !canEdit) return;
    if (!String(addForm.personName ?? "").trim()) {
      toast.warn("Person name is required");
      return;
    }
    const { kind, ...payload } = addForm;
    await createManual({ societyId: society._id, kind, payload });
    toast.success("Record added to register");
    setAddForm(null);
  };

  const roles = (data?.boardRoleAssignments ?? NO_ROWS) as EvidenceRow[];
  const changes = (data?.boardRoleChanges ?? NO_ROWS) as EvidenceRow[];
  const signing = (data?.signingAuthorities ?? NO_ROWS) as EvidenceRow[];

  const promoteRole = async (row: any) => {
    if (!canPromote) return;
    const sourced = (row.sourceDocumentIds?.length ?? 0) > 0 || (row.sourceExternalIds?.length ?? 0) > 0 || Boolean(row.importedFrom);
    const samePosition = (directors ?? []).filter((director: any) =>
      director.status === "Active" && !director.resignedAt &&
      String(director.position ?? "").trim().toLowerCase() === String(row.roleTitle ?? "").trim().toLowerCase() &&
      !/^director$/i.test(String(row.roleTitle ?? "")));
    const ok = await confirm({
      title: "Promote to director register?",
      message: [
        `${row.personName} will be added to the current directors register as ${row.roleTitle || "Director"}.`,
        sourced
          ? "The role assignment has source evidence; review it before relying on the register."
          : "This role assignment has NO source document. It will be promoted as unverified; attach the appointment minutes or resolution afterwards.",
        samePosition.length
          ? `Conflict: ${samePosition.map((director: any) => `${director.firstName} ${director.lastName}`.trim()).join(", ")} already holds ${row.roleTitle} on the register. Resign or update them if this replaces them.`
          : "",
      ].filter(Boolean).join(" "),
      confirmLabel: sourced && !samePosition.length ? "Promote" : "Promote anyway",
      tone: sourced && !samePosition.length ? undefined : "warn",
    });
    if (!ok) return;
    try {
      await promoteBoardRole({
        assignmentId: row._id,
        position: row.roleTitle,
        status: "Active",
        notes: "Promoted from governance register review.",
      });
      toast.success("Director register updated", row.personName);
    } catch (error) {
      toast.error("Could not promote", error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="page">
      <RegisterAccessNotice resources={data?.restrictedResources} />
      <PageHeader
        title="Governance registers"
        icon={<GitBranch size={16} />}
        iconColor="blue"
        subtitle="Director and officer timeline, role changes and signing authority."
        info={<p>Source-backed director/officer timeline, board role changes, and signing authority records.</p>}
        actions={
          <>
            <button className="btn-action" aria-label="Add record" disabled={!canEdit} onClick={() => setAddForm({ kind: "boardRoleAssignment", personName: "", roleTitle: "Director", status: "Observed", startDate: todayDateOnly(), notes: "" })}>
              <Plus size={12} /> <span className="evidence-action-label">Add record</span>
            </button>
            <Link className="btn-action" to="/app/imports" aria-label="Review imports"><FileSearch size={12} /> <span className="evidence-action-label">Review imports</span></Link>
          </>
        }
      />

      <Drawer
        open={Boolean(addForm)}
        onClose={() => setAddForm(null)}
        title="Add register record"
        footer={<><button className="btn" onClick={() => setAddForm(null)}>Cancel</button><button className="btn btn--accent" disabled={!canEdit} onClick={saveManual}>Add record</button></>}
      >
        {addForm && (
          <div>
            <div className="muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
              Manually record a governance fact (e.g. from minutes or a bank letter) without importing a document. It is flagged for review.
            </div>
            <Field label="Register">
              <Select
                value={addForm.kind}
                onChange={(v) => setAddForm({ ...addForm, kind: v })}
                options={[
                  { value: "boardRoleAssignment", label: "Role assignment" },
                  { value: "boardRoleChange", label: "Board role change" },
                  { value: "signingAuthority", label: "Signing authority" },
                ]}
              />
            </Field>
            <Field label="Person name"><input className="input" value={addForm.personName ?? ""} onChange={(e) => setAddForm({ ...addForm, personName: e.target.value })} /></Field>
            {addForm.kind === "boardRoleChange" ? (
              <>
                <Field label="Change type"><input className="input" value={addForm.changeType ?? ""} onChange={(e) => setAddForm({ ...addForm, changeType: e.target.value })} placeholder="appointment / removal / vacancy" /></Field>
                <Field label="Role title"><input className="input" value={addForm.roleTitle ?? ""} onChange={(e) => setAddForm({ ...addForm, roleTitle: e.target.value })} /></Field>
                <Field label="Effective date"><DatePicker value={addForm.effectiveDate ?? ""} onChange={(value) => setAddForm({ ...addForm, effectiveDate: value })} /></Field>
              </>
            ) : addForm.kind === "signingAuthority" ? (
              <>
                <Field label="Institution"><input className="input" value={addForm.institutionName ?? ""} onChange={(e) => setAddForm({ ...addForm, institutionName: e.target.value })} /></Field>
                <Field label="Authority type"><input className="input" value={addForm.authorityType ?? ""} onChange={(e) => setAddForm({ ...addForm, authorityType: e.target.value })} placeholder="signing / co-signing" /></Field>
                <Field label="Effective date"><DatePicker value={addForm.effectiveDate ?? ""} onChange={(value) => setAddForm({ ...addForm, effectiveDate: value })} /></Field>
              </>
            ) : (
              <>
                <Field label="Role title"><input className="input" value={addForm.roleTitle ?? ""} onChange={(e) => setAddForm({ ...addForm, roleTitle: e.target.value })} /></Field>
                <Field label="Role group"><input className="input" value={addForm.roleGroup ?? ""} onChange={(e) => setAddForm({ ...addForm, roleGroup: e.target.value })} placeholder="Board / Officers / Committee" /></Field>
                <Field label="Start date"><DatePicker value={addForm.startDate ?? ""} onChange={(value) => setAddForm({ ...addForm, startDate: value })} /></Field>
              </>
            )}
            <Field label="Notes"><input className="input" value={addForm.notes ?? ""} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Role assignments" value={data?.restrictedResources?.includes("directors") ? "Restricted" : roles.length} />
        <Stat label="Role changes" value={data?.restrictedResources?.includes("directors") ? "Restricted" : changes.length} />
        <Stat label="Signing authorities" value={signing.length} />
        <Stat label="Restricted sources" value={countRestricted([...roles, ...changes, ...signing])} tone="warn" />
      </div>
      <Register
        title="People and director timeline"
        definition={ROLE_ASSIGNMENTS}
        tableId="governance-role-assignments"
        restricted={data?.restrictedResources?.includes("directors")}
        rows={roles}
        loading={data === undefined}
        empty={<EmptyRegister kind="role-assignment" links={[["Directors", "/app/directors"], ["Role holders", "/app/role-holders"]]} />}
        renderCell={({ record, field }) => {
          if (field.name === "personName") return <PersonCell row={record.row} people={people} />;
          if (field.name === "directorRegister") return <DirectorRegisterCell row={record.row} />;
          return undefined;
        }}
        renderRowActions={(record) => <PromoteAction row={record.row} disabled={!canPromote} onPromote={() => promoteRole(record.row)} />}
      />
      <Register
        title="Board role changes"
        definition={ROLE_CHANGES}
        tableId="governance-role-changes"
        restricted={data?.restrictedResources?.includes("directors")}
        rows={changes}
        loading={data === undefined}
        empty={<EmptyRegister kind="role-change" links={[["Directors", "/app/directors"], ["Role holders", "/app/role-holders"]]} />}
        renderCell={({ record, field }) => (field.name === "personName" ? <PersonCell row={record.row} people={people} /> : undefined)}
      />
      <Register
        title="Signing authorities"
        definition={SIGNING_AUTHORITIES}
        tableId="governance-signing-authorities"
        restricted={data?.restrictedResources?.includes("documents")}
        rows={signing}
        loading={data === undefined}
        empty={<EmptyRegister kind="signing-authority" links={[["Directors", "/app/directors"], ["Role holders", "/app/role-holders"]]} />}
        renderCell={({ record, field }) => (field.name === "personName" ? <PersonCell row={record.row} people={people} /> : undefined)}
      />
    </div>
  );
}

export function MeetingEvidencePage() {
  const { society, data, people } = useRegisters();
  const { can } = usePermissions();
  const meetings = useQuery(api.meetings.list, society && can("meetings:read") ? { societyId: society._id } : "skip") as any[] | undefined;
  // P18: one row per person, meeting and status (imports read the same minutes
  // twice), labelled with the meeting's current title rather than a file name.
  const attendance = useMemo(() => {
    const titles = new Map((meetings ?? []).map((m: any) => [String(m._id), m.title]));
    const groups = new Map<string, any>();
    for (const row of (data?.meetingAttendanceRecords ?? []) as any[]) {
      const key = [row.meetingId ?? row.meetingTitle ?? row.sourceTitle, String(row.directoryPersonId ?? row.personName ?? "").trim().toLocaleLowerCase(), String(row.attendanceStatus ?? "").toLocaleLowerCase()].join("|");
      const existing = groups.get(key);
      if (existing) { existing.duplicateCount += 1; continue; }
      groups.set(key, { ...row, meetingTitle: (row.meetingId && titles.get(String(row.meetingId))) || row.meetingTitle, duplicateCount: 1 });
    }
    return [...groups.values()];
  }, [data, meetings]);
  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const motions = (data?.motionEvidence ?? NO_ROWS) as EvidenceRow[];

  return (
    <div className="page">
      <RegisterAccessNotice resources={data?.restrictedResources} />
      <PageHeader
        title="Meeting evidence"
        icon={<ClipboardCheck size={16} />}
        iconColor="orange"
        subtitle="Attendance, quorum and motions from minutes."
        info={<p>Attendance, quorum evidence, and source-backed motions extracted from minutes.</p>}
        actions={<Link className="btn-action" to="/app/imports" aria-label="Review imports"><FileSearch size={12} /> <span className="evidence-action-label">Review imports</span></Link>}
      />
      <ImportCandidatesNotice noun="meeting evidence" kinds={["meetingAttendance", "motionEvidence", "motion", "meetingMinutes"]} emptyRegister={!attendance.length && !motions.length} />
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Attendance rows" value={data?.restrictedResources?.includes("meetings") ? "Restricted" : attendance.length} />
        <Stat label="Motion evidence" value={data?.restrictedResources?.includes("motions") ? "Restricted" : motions.length} />
        <Stat label="Needs review" value={[...attendance, ...motions].filter((row: any) => row.status !== "Verified").length} tone="warn" />
        <Stat label="Sources" value={uniqueSources([...attendance, ...motions]).length} />
      </div>
      <Register
        title="Attendance"
        definition={ATTENDANCE}
        tableId="meeting-evidence-attendance"
        restricted={data?.restrictedResources?.includes("meetings")}
        rows={attendance}
        loading={data === undefined}
        empty={<EmptyRegister kind="attendance" links={[["Meetings", "/app/meetings"], ["Minutes", "/app/minutes"]]} />}
        renderCell={({ record, field }) => {
          const { row } = record;
          if (field.name === "meetingTitle") return <MeetingCell row={row} />;
          if (field.name === "personName") return <PersonCell row={row} people={people} />;
          if (field.name === "attendanceStatus")
            return (
              <span>
                {String(record.attendanceStatus)}
                {(row.duplicateCount ?? 0) > 1 ? <span className="muted" title="The same person, meeting and status appeared more than once in the imported evidence"> · recorded {row.duplicateCount}×</span> : null}
              </span>
            );
          if (field.name === "confidence") return <Confidence value={row.confidence} />;
          return undefined;
        }}
      />
      <Register
        title="Motion evidence"
        definition={MOTIONS}
        tableId="meeting-evidence-motions"
        restricted={data?.restrictedResources?.includes("motions")}
        rows={motions}
        loading={data === undefined}
        empty={<EmptyRegister kind="motion-evidence" links={[["Meetings", "/app/meetings"], ["Minutes", "/app/minutes"]]} />}
        renderCell={({ record, field }) => (field.name === "meetingTitle" ? <MeetingCell row={record.row} /> : undefined)}
      />
    </div>
  );
}

export function FinanceImportsPage() {
  const { society, data } = useRegisters();
  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const budgets = (data?.budgetSnapshots ?? NO_ROWS) as EvidenceRow[];
  const statements = (data?.financialStatementImports ?? NO_ROWS) as EvidenceRow[];
  const reports = (data?.treasurerReports ?? NO_ROWS) as EvidenceRow[];
  const transactions = (data?.transactionCandidates ?? NO_ROWS) as EvidenceRow[];

  return (
    <div className="page">
      <RegisterAccessNotice resources={data?.restrictedResources} />
      <PageHeader
        title="Finance imports"
        icon={<Banknote size={16} />}
        iconColor="green"
        subtitle="Imported budgets, statements and reports to verify."
        info={<p>Imported budget snapshots, financial statements, treasurer reports, and transaction candidates awaiting verification.</p>}
        actions={<Link className="btn-action" to="/app/imports" aria-label="Review imports"><FileSearch size={12} /> <span className="evidence-action-label">Review imports</span></Link>}
      />
      <ImportCandidatesNotice noun="finance" targets={["financialStatementImports", "budgetSnapshots"]} kinds={["financialStatementImport", "budgetSnapshot", "treasurerReport", "transactionCandidate"]} documentCategory="FinancialStatement" emptyRegister={!budgets.length && !statements.length} />
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Budgets" value={data?.restrictedResources?.includes("financials") ? "Restricted" : budgets.length} />
        <Stat label="Statements" value={data?.restrictedResources?.includes("financials") ? "Restricted" : statements.length} />
        <Stat label="Treasurer reports" value={data?.restrictedResources?.includes("financials") ? "Restricted" : reports.length} />
        <Stat label="Transactions" value={data?.restrictedResources?.includes("financials") ? "Restricted" : transactions.length} tone={transactions.length ? "warn" : undefined} />
      </div>
      <Register
        title="Budget snapshots"
        definition={BUDGET_SNAPSHOTS}
        tableId="finance-imports-budgets"
        restricted={data?.restrictedResources?.includes("financials")}
        rows={budgets}
        loading={data === undefined}
        empty={<EmptyRegister kind="budget snapshot" links={[["Financials", "/app/financials"], ["Treasurer", "/app/treasurer"]]} />}
      />
      <Register
        title="Financial statement imports"
        definition={STATEMENT_IMPORTS}
        tableId="finance-imports-statements"
        restricted={data?.restrictedResources?.includes("financials")}
        rows={statements}
        loading={data === undefined}
        empty={<EmptyRegister kind="financial statement" links={[["Financials", "/app/financials"], ["Treasurer", "/app/treasurer"]]} />}
      />
      <Register
        title="Treasurer reports"
        definition={TREASURER_REPORTS}
        tableId="finance-imports-treasurer-reports"
        restricted={data?.restrictedResources?.includes("financials")}
        rows={reports}
        loading={data === undefined}
        empty={<EmptyRegister kind="treasurer report" links={[["Treasurer", "/app/treasurer"], ["Financials", "/app/financials"]]} />}
      />
      <Register
        title="Transaction candidates"
        definition={TRANSACTION_CANDIDATES}
        tableId="finance-imports-transactions"
        restricted={data?.restrictedResources?.includes("financials")}
        rows={transactions}
        loading={data === undefined}
        empty={<EmptyRegister kind="transaction" links={[["Financials", "/app/financials"], ["Treasurer", "/app/treasurer"]]} />}
      />
    </div>
  );
}

export function RecordsArchivePage() {
  const { society, data } = useRegisters();
  const permissions = usePermissions();
  const canEdit = permissions.loaded && permissions.can("documents:write");
  const updateReview = usePermissionedMutation(api.evidenceRegisters.updateReview, canEdit);
  const toast = useToast();
  const undoable = useUndoableAction();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const accessions = (data?.archiveAccessions ?? NO_ROWS) as EvidenceRow[];
  const evidence = (data?.sourceEvidence ?? NO_ROWS) as EvidenceRow[];
  const statusCounts = EVIDENCE_REVIEW_STATUSES.map((status) => [status, evidence.filter((row: any) => normalizeEvidenceReviewStatus(row.status) === status).length] as const);
  const evidenceShown = statusFilter === "all" ? evidence : evidence.filter((row: any) => normalizeEvidenceReviewStatus(row.status) === statusFilter);
  const setStatus = async (row: any, status: string) => {
    try {
      await updateReview({ table: "sourceEvidence", id: row._id, status });
      toast.success("Evidence status updated", evidenceReviewStatusLabel(status));
    } catch (error: any) {
      toast.error(error?.message ?? "Could not update evidence status");
    }
  };
  const bulkStatus = async (rows: any[], status: string) => {
    const targets = rows.filter((row) => normalizeEvidenceReviewStatus(row.status) !== status);
    if (!targets.length) return;
    // A status change is reversible row by row, so apply it and offer Undo
    // (restoring each row's own previous status) instead of confirming first.
    const updated: any[] = [];
    for (const row of targets) {
      try {
        await updateReview({ table: "sourceEvidence", id: row._id, status });
        updated.push(row);
      } catch {
        // Keep going; the toast reports the count that changed.
      }
    }
    if (!updated.length) {
      toast.error("Could not update evidence status");
      return;
    }
    await undoable({
      message: `${updated.length} evidence link${updated.length === 1 ? "" : "s"} marked ${evidenceReviewStatusLabel(status).toLowerCase()}`,
      description: "Linked records and documents are not changed.",
      dedupeKey: "evidence-bulk-status",
      undo: async () => {
        for (const row of updated) await updateReview({ table: "sourceEvidence", id: row._id, status: normalizeEvidenceReviewStatus(row.status) });
      },
      undoneMessage: "Evidence status restored",
    });
  };

  return (
    <div className="page">
      <RegisterAccessNotice resources={data?.restrictedResources} />
      <PageHeader
        title="Records archive"
        icon={<Archive size={16} />}
        iconColor="gray"
        subtitle="Archive custody, accessions and source provenance."
        info={<p>Archive custody, accessions, source provenance, and restricted-source handling.</p>}
        actions={<Link className="btn-action" to="/app/imports" aria-label="Review imports"><FileSearch size={12} /> <span className="evidence-action-label">Review imports</span></Link>}
      />
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Accessions" value={accessions.length} />
        <Stat label="Evidence links" value={evidence.length} />
        <Stat label="Restricted" value={evidence.filter((row: any) => row.accessLevel === "restricted").length} tone="warn" />
        <Stat label="Linked targets" value={evidence.filter((row: any) => row.targetId).length} />
      </div>
      <Register
        title="Archive custody and accessions"
        definition={ACCESSIONS}
        tableId="records-archive-accessions"
        restricted={data?.restrictedResources?.includes("documents")}
        rows={accessions}
        loading={data === undefined}
        empty={<EmptyNote text="No accessions yet." info="Approve archive accession imports for boxes, binders, drives, and external archive transfers." />}
      />
      <Register
        title="Source evidence and provenance"
        definition={SOURCE_EVIDENCE}
        tableId="records-archive-source-evidence"
        restricted={data?.restrictedResources?.includes("documents")}
        /* Status chips filter this register only, so they sit inside its
           card (and only once there is evidence to filter). */
        toolbar={evidence.length > 0 ? (
          <div className="documents-facets__row evidence-status-filter" role="group" aria-label="Evidence status">
            <button type="button" className={`chip${statusFilter === "all" ? " is-active" : ""}`} aria-pressed={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All <span className="chip__count">{evidence.length}</span></button>
            {statusCounts.map(([status, count]) => (
              <button key={status} type="button" className={`chip${statusFilter === status ? " is-active" : ""}`} aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)}>
                {evidenceReviewStatusLabel(status)} <span className="chip__count">{count}</span>
              </button>
            ))}
          </div>
        ) : null}
        rows={evidenceShown}
        loading={data === undefined}
        empty={statusFilter === "all" ? <EmptyNote text="No evidence links yet." info="Approved section imports automatically create source evidence links here." /> : <RecordTableEmpty title="No evidence links have this status" />}
        renderCell={({ record, field }) => {
          const { row } = record;
          if (field.name === "sourceTitle") return <EvidenceSourceCell row={row} />;
          if (field.name === "accessLevel") return <Badge tone={row.accessLevel === "restricted" ? "danger" : "info"}>{row.accessLevel}</Badge>;
          if (field.name === "evidenceKind") return row.evidenceKind ? <span>{EVIDENCE_KIND_LABELS[row.evidenceKind] ?? row.evidenceKind}</span> : undefined;
          return undefined;
        }}
        rowMenuSections={(record) => (canEdit ? evidenceStatusMenu(record.row, (status) => { void setStatus(record.row, status); }) : [])}
        bulkActions={canEdit ? [
          { id: "verified", label: "Mark verified", onRun: (_ids, records) => bulkStatus(registerRows(records), "Verified") },
          { id: "linked", label: "Mark linked", onRun: (_ids, records) => bulkStatus(registerRows(records), "Linked") },
        ] : undefined}
      />
    </div>
  );
}

function capitalize(value?: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function useRegisters() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const data = useQuery(api.evidenceRegisters.overview, society ? { societyId: society._id } : "skip");
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
  const directors = useQuery(api.directors.list, society && loaded && can("directors:read") ? { societyId: society._id } : "skip");
  return { society, data, people: personLinkCandidates(members, directors) };
}

/** Empty register: what will appear here and where today's live data is. */
function EmptyRegister({ kind, links }: { kind: string; links: [string, string][] }) {
  return (
    <RecordTableEmpty
      title="Nothing imported yet"
      description={
        <>
          Approved {kind} imports appear here. Current data:{" "}
          {links.map(([label, to], index) => (
            <span key={to}>
              {index > 0 && " · "}
              <Link to={to}>{label}</Link>
            </span>
          ))}
        </>
      }
    />
  );
}

/** Empty register with a line on what fills it. */
function EmptyNote({ text, info }: { text: string; info: string }) {
  return <RecordTableEmpty title={text} description={info} />;
}

/**
 * One evidence register: a card with its heading (and any filters under it)
 * around the shared record table. Status and source-document cells are drawn
 * the same way in every register; pages draw the rest.
 */
function Register({
  title,
  definition,
  tableId,
  rows,
  loading,
  empty,
  restricted,
  toolbar,
  renderCell,
  renderRowActions,
  rowMenuSections,
  bulkActions,
}: {
  title: string;
  definition: RegisterDefinition;
  tableId: string;
  rows: EvidenceRow[];
  loading: boolean;
  empty: ReactNode;
  restricted?: boolean;
  /** Filters shown under the title (e.g. status chips). */
  toolbar?: ReactNode;
  renderCell?: (cell: { record: RegisterRecord; field: FieldMetadata }) => ReactNode | undefined;
  renderRowActions?: (record: RegisterRecord) => ReactNode;
  rowMenuSections?: (record: RegisterRecord) => MenuSection[];
  bulkActions?: BulkAction[];
}) {
  const records = useMemo<RegisterRecord[]>(
    () => rows.map((row) => ({ ...definition.values(row), _id: String(row._id), row })),
    [rows, definition],
  );
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">{title}</h2>
        {restricted && <span className="card__subtitle">Access limited</span>}
      </div>
      {toolbar && <div className="card__body">{toolbar}</div>}
      <RecordListTable<RegisterRecord>
        variant="card"
        table={definition.table}
        tableId={tableId}
        label={title}
        records={records}
        loading={loading}
        renderCell={({ record, field }) => {
          const custom = renderCell?.({ record, field });
          if (custom !== undefined) return custom;
          if (field.name === "status") return <Status value={record.row.status} />;
          if (field.name === "sourceDocuments") return <SourceDocumentsCell row={record.row} />;
          return undefined;
        }}
        renderRowActions={renderRowActions}
        rowMenuSections={rowMenuSections}
        bulkActions={bulkActions}
        emptyState={restricted && rows.length === 0 ? <RecordTableEmpty title="This section requires additional access" /> : empty}
      />
    </div>
  );
}

/** Register counts: the tone only applies once the count is non-zero. */
function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "warn" | "danger" | "ok" }) {
  return <StatTile label={label} value={value} tone={!value || tone === "ok" ? undefined : tone} />;
}

/** Register rows use their own vocabularies (Observed, Draft, Filed…); only review states are relabelled. */
function isReviewState(value?: string) {
  return !value || /^(needs ?review|needsreview|linked|verified|rejected)$/i.test(value);
}

/** The status as shown (and filtered): review states by their label, anything else as stored. */
function registerStatusLabel(value?: string) {
  return isReviewState(value) ? evidenceReviewStatusLabel(value) : String(value);
}

function Status({ value }: { value?: string }) {
  if (!isReviewState(value)) return <Badge tone="info">{value}</Badge>;
  return <Badge tone={evidenceReviewStatusTone(value)}>{evidenceReviewStatusLabel(value)}</Badge>;
}

/** The register row's source documents: the first opens in Documents, the rest are counted. */
function SourceDocumentsCell({ row }: { row: EvidenceRow }) {
  const ids = row.sourceDocumentIds ?? [];
  if (!ids.length) return <span className="muted">None</span>;
  return (
    <span>
      <Link to={`/app/documents/${ids[0]}`}>Document</Link>
      {ids.length > 1 && <span className="muted"> +{ids.length - 1}</span>}
    </span>
  );
}

/** The evidence row's "…" menu: set its review status. */
function evidenceStatusMenu(row: EvidenceRow, onSet: (status: string) => void): MenuSection[] {
  const current = normalizeEvidenceReviewStatus(row.status);
  return [
    {
      id: "status",
      label: "Set status",
      items: EVIDENCE_REVIEW_STATUSES.map((status) => ({
        id: status,
        label: evidenceReviewStatusLabel(status),
        hint: status === current ? "Current" : undefined,
        disabled: status === current,
        onSelect: () => onSet(status),
      })),
    },
  ];
}

function registerRows(records: RegisterRecord[]) {
  return records.map((record) => record.row);
}

/** Source link that prefers the canonical document over a staged import candidate (D-20). */
function EvidenceSourceCell({ row }: { row: EvidenceRow }) {
  if (!row.sourceDocumentId) return <span>{row.sourceTitle}</span>;
  if (row.sourceDocumentKind === "candidate") {
    return row.canonicalDocumentId
      ? <span className="col" style={{ gap: 2 }}><Link to={`/app/documents/${row.canonicalDocumentId}`}>{row.sourceTitle}</Link><span className="muted" style={{ fontSize: "var(--fs-xs)" }}>cited the staged import copy; showing the document</span></span>
      : <span className="col" style={{ gap: 2 }}><span>{row.sourceTitle}</span><Link className="muted" style={{ fontSize: "var(--fs-xs)" }} to="/app/imports">still a staged import candidate</Link></span>;
  }
  if (row.sourceDocumentKind === "missing") return <span>{row.sourceTitle} <span className="muted">(document removed)</span></span>;
  return <Link to={`/app/documents/${row.sourceDocumentId}`}>{row.sourceTitle}</Link>;
}

/** Promote, for a role assignment not yet on the director register (and not rejected). */
function PromoteAction({ row, onPromote, disabled }: { row: EvidenceRow; onPromote: () => void; disabled?: boolean }) {
  if (row.directorId || row.status === "Rejected") return null;
  return (
    <button className="btn btn--ghost btn--sm" disabled={disabled} onClick={onPromote}>
      Promote
    </button>
  );
}

/** The promoted director, opened on the directors register. */
function DirectorRegisterCell({ row }: { row: EvidenceRow }) {
  if (!row.directorId) return <span className="muted">{row.status === "Rejected" ? "Rejected" : "Not promoted"}</span>;
  return <Link to={entityHref({ kind: "director", id: row.directorId }) ?? "/app/directors"}><Badge tone="success">Director</Badge></Link>;
}

/**
 * The person a register row names, opened where the app keeps them: the
 * reviewed directory identity, else the linked director or member record,
 * else the one director or member whose name matches (a suggestion).
 */
function PersonCell({ row, people }: { row: EvidenceRow; people?: PersonLinkCandidate[] }) {
  const name = row.personName;
  const label = name || "-";
  if(row.directoryPersonId)return <Link to={`/app/people-directory/${row.directoryPersonId}`}>{label} <Badge tone="success">Reviewed identity</Badge></Link>;
  const fallback = findPersonLink(name, people ?? []);
  const linked = Boolean(row.directorId || row.memberId);
  const to = row.directorId
    ? entityHref({ kind: "director", id: row.directorId })
    : row.memberId
      ? entityHref({ kind: "member", id: row.memberId })
      : fallback ? entityHref({ kind: fallback.kind, id: fallback.id }) : null;
  const content = (
    <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
      <span>{label}</span>
      {linked && <Badge tone="success">Linked</Badge>}{!linked&&fallback&&<Badge tone="warn">Name suggestion</Badge>}
    </span>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

type PersonLinkCandidate = {
  id: string;
  name: string;
  aliases: string[];
  kind: "member" | "director";
};

function personLinkCandidates(members: any[] | undefined, directors: any[] | undefined): PersonLinkCandidate[] {
  return [
    ...(members ?? []).map((member: any) => ({
      id: String(member._id),
      name: `${member.firstName} ${member.lastName}`.trim(),
      aliases: Array.isArray(member.aliases) ? member.aliases : [],
      kind: "member" as const,
    })),
    ...(directors ?? []).map((director: any) => ({
      id: String(director._id),
      name: `${director.firstName} ${director.lastName}`.trim(),
      aliases: Array.isArray(director.aliases) ? director.aliases : [],
      kind: "director" as const,
    })),
  ];
}

function findPersonLink(name: string | undefined, people: PersonLinkCandidate[]) {
  const key = normalizePersonName(name ?? "");
  if (!key) return null;
  const matches=people.filter(person=>[person.name,...person.aliases].some(candidate=>normalizePersonName(candidate)===key));
  return matches.length===1?matches[0]:null;
}

function normalizePersonName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function MeetingCell({ row }: { row: EvidenceRow }) {
  const label = row.meetingTitle || "-";
  return row.meetingId ? <Link to={`/app/meetings/${row.meetingId}`}>{label}</Link> : label;
}

function Confidence({ value }: { value?: string }) {
  return <Badge tone={value === "High" ? "success" : value === "Medium" ? "info" : "warn"}>{value ?? "Review"}</Badge>;
}

function uniqueSources(rows: any[]) {
  return Array.from(new Set(rows.flatMap((row) => row.sourceExternalIds ?? [])));
}

function countRestricted(rows: any[]) {
  return rows.filter((row) => row.notes?.toLowerCase?.().includes("restricted") || row.sourceExternalIds?.length).length;
}

function RegisterAccessNotice({ resources }: { resources?: string[] }) {
  if (!resources?.length) return null;
  return <p className="muted" role="status">Your role limits access to these register sections: {resources.join(", ")}. Accessible records remain available.</p>;
}
