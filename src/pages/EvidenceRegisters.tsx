import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, RelatedDocumentViews, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Archive, Banknote, ClipboardCheck, FileSearch, GitBranch, Plus } from "lucide-react";
import { formatDate, money } from "../lib/format";

export function GovernanceRegistersPage() {
  const { society, data, people } = useRegisters();
  const promoteBoardRole = useMutation(api.evidenceRegisters.promoteBoardRoleToDirector);
  const createManual = useMutation(api.evidenceRegisters.createManual);
  const confirm = useConfirm();
  const toast = useToast();
  const [addForm, setAddForm] = useState<any>(null);
  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const saveManual = async () => {
    if (!addForm || !society) return;
    if (!String(addForm.personName ?? "").trim()) {
      toast.warn("Person name is required");
      return;
    }
    const { kind, ...payload } = addForm;
    await createManual({ societyId: society._id, kind, payload });
    toast.success("Record added to register");
    setAddForm(null);
  };

  const roles = data?.boardRoleAssignments ?? [];
  const changes = data?.boardRoleChanges ?? [];
  const signing = data?.signingAuthorities ?? [];

  const promoteRole = async (row: any) => {
    const ok = await confirm({
      title: "Promote to director register?",
      message: `${row.personName} will be added to the current directors register using this source-backed role assignment.`,
      confirmLabel: "Promote",
    });
    if (!ok) return;
    await promoteBoardRole({
      assignmentId: row._id,
      position: row.roleTitle,
      status: "Active",
      notes: "Promoted from governance register review.",
    });
    toast.success("Director register updated", row.personName);
  };

  return (
    <div className="page">
      <PageHeader
        title="Governance registers"
        icon={<GitBranch size={16} />}
        iconColor="blue"
        subtitle="Source-backed director/officer timeline, board role changes, and signing authority records."
        actions={
          <>
            <button className="btn-action" onClick={() => setAddForm({ kind: "boardRoleAssignment", personName: "", roleTitle: "Director", status: "Observed", startDate: new Date().toISOString().slice(0, 10), notes: "" })}>
              <Plus size={12} /> Add record
            </button>
            <Link className="btn-action" to="/app/imports"><FileSearch size={12} /> Review imports</Link>
          </>
        }
      />

      <Drawer
        open={Boolean(addForm)}
        onClose={() => setAddForm(null)}
        title="Add register record"
        footer={<><button className="btn" onClick={() => setAddForm(null)}>Cancel</button><button className="btn btn--accent" onClick={saveManual}>Add record</button></>}
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
        <Stat label="Role assignments" value={roles.length} />
        <Stat label="Role changes" value={changes.length} />
        <Stat label="Signing authorities" value={signing.length} />
        <Stat label="Restricted sources" value={countRestricted([...roles, ...changes, ...signing])} tone="warn" />
      </div>
      <RegisterTable
        title="People and director timeline"
        rows={roles}
        empty="Approve board role assignment imports to build the timeline."
        columns={["Person", "Role", "Group", "Start", "Status", "Actions"]}
        render={(row) => [
          <PersonCell key="p" row={row} name={row.personName} people={people} />,
          row.roleTitle,
          row.roleGroup ?? "-",
          formatDate(row.startDate),
          <Status key="s" value={row.status} />,
          <PromoteAction key="a" row={row} onPromote={() => promoteRole(row)} />,
        ]}
      />
      <RegisterTable
        title="Board role changes"
        rows={changes}
        empty="Approve role-change imports to track appointments, removals, vacancies, and renamed positions."
        columns={["Effective", "Change", "Role", "Person", "Status"]}
        render={(row) => [formatDate(row.effectiveDate), row.changeType, row.roleTitle, <PersonCell key="p" row={row} name={row.personName} people={people} />, <Status key="s" value={row.status} />]}
      />
      <RegisterTable
        title="Signing authorities"
        rows={signing}
        empty="Approve signing-authority imports after source review."
        columns={["Effective", "Person", "Institution", "Authority", "Status"]}
        render={(row) => [formatDate(row.effectiveDate), <PersonCell key="p" row={row} name={row.personName} people={people} />, row.institutionName ?? "-", row.authorityType, <Status key="s" value={row.status} />]}
      />
    </div>
  );
}

export function MeetingEvidencePage() {
  const { society, data, people } = useRegisters();
  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const attendance = data?.meetingAttendanceRecords ?? [];
  const motions = data?.motionEvidence ?? [];

  return (
    <div className="page">
      <PageHeader
        title="Meeting evidence"
        icon={<ClipboardCheck size={16} />}
        iconColor="orange"
        subtitle="Attendance, quorum evidence, and source-backed motions extracted from minutes."
        actions={<Link className="btn-action" to="/app/imports"><FileSearch size={12} /> Review imports</Link>}
      />
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Attendance rows" value={attendance.length} />
        <Stat label="Motion evidence" value={motions.length} />
        <Stat label="Needs review" value={[...attendance, ...motions].filter((row: any) => row.status !== "Verified").length} tone="warn" />
        <Stat label="Sources" value={uniqueSources([...attendance, ...motions]).length} />
      </div>
      <RegisterTable
        title="Attendance"
        rows={attendance}
        empty="Approve attendance imports to populate this register."
        columns={["Meeting", "Date", "Person", "Attendance", "Confidence"]}
        render={(row) => [<MeetingCell key="m" row={row} />, formatDate(row.meetingDate), <PersonCell key="p" row={row} name={row.personName} people={people} />, row.attendanceStatus, <Confidence key="c" value={row.confidence} />]}
      />
      <RegisterTable
        title="Motion evidence"
        rows={motions}
        empty="Approve motion-evidence imports to build a source-backed motion trail."
        columns={["Meeting", "Date", "Motion", "Outcome", "Status"]}
        render={(row) => [<MeetingCell key="m" row={row} />, formatDate(row.meetingDate), truncate(row.motionText, 100), row.outcome, <Status key="s" value={row.status} />]}
      />
    </div>
  );
}

export function FinanceImportsPage() {
  const { society, data } = useRegisters();
  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const budgets = data?.budgetSnapshots ?? [];
  const statements = data?.financialStatementImports ?? [];
  const reports = data?.treasurerReports ?? [];
  const transactions = data?.transactionCandidates ?? [];

  return (
    <div className="page">
      <PageHeader
        title="Finance imports"
        icon={<Banknote size={16} />}
        iconColor="green"
        subtitle="Paperless-derived budget snapshots, financial statements, treasurer reports, and transaction candidates."
        actions={<Link className="btn-action" to="/app/imports"><FileSearch size={12} /> Review imports</Link>}
      />
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Budgets" value={budgets.length} />
        <Stat label="Statements" value={statements.length} />
        <Stat label="Treasurer reports" value={reports.length} />
        <Stat label="Transactions" value={transactions.length} tone={transactions.length ? "warn" : undefined} />
      </div>
      <RegisterTable
        title="Budget snapshots"
        rows={budgets}
        empty="Approve budget snapshot imports after checking OCR amounts."
        columns={["Fiscal year", "Title", "Income", "Expense", "Status"]}
        render={(row) => [row.fiscalYear, row.title, formatMoney(row.totalIncomeCents), formatMoney(row.totalExpenseCents), <Status key="s" value={row.status} />]}
      />
      <RegisterTable
        title="Financial statement imports"
        rows={statements}
        empty="Approve financial statement imports only after verifying totals."
        columns={["Period end", "Type", "Revenue", "Expenses", "Status"]}
        render={(row) => [formatDate(row.periodEnd), row.statementType, formatMoney(row.revenueCents), formatMoney(row.expensesCents), <Status key="s" value={row.status} />]}
      />
      <RegisterTable
        title="Treasurer reports"
        rows={reports}
        empty="Approve treasurer report imports to build report history."
        columns={["Date", "Title", "Cash", "Highlights", "Status"]}
        render={(row) => [formatDate(row.reportDate), row.title, formatMoney(row.cashBalanceCents), row.highlights?.length ?? 0, <Status key="s" value={row.status} />]}
      />
      <RegisterTable
        title="Transaction candidates"
        rows={transactions}
        empty="Approve transaction candidates only inside a restricted finance review."
        columns={["Date", "Description", "Debit/Credit", "Amount", "Cheque/ref", "Balance", "Status"]}
        render={(row) => [
          formatDate(row.transactionDate),
          truncate(row.description, 90),
          row.debitCredit ?? "-",
          formatMoney(row.amountCents),
          row.chequeNumber ?? "-",
          formatMoney(row.balanceCents),
          <Status key="s" value={row.status} />,
        ]}
      />
    </div>
  );
}

export function RecordsArchivePage() {
  const { society, data } = useRegisters();
  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const accessions = data?.archiveAccessions ?? [];
  const evidence = data?.sourceEvidence ?? [];

  return (
    <div className="page">
      <PageHeader
        title="Records archive"
        icon={<Archive size={16} />}
        iconColor="gray"
        subtitle="Archive custody, accessions, source provenance, and restricted-source handling."
        actions={<Link className="btn-action" to="/app/imports"><FileSearch size={12} /> Review imports</Link>}
      />
      <RelatedDocumentViews current="/app/records-archive" />
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Accessions" value={accessions.length} />
        <Stat label="Evidence links" value={evidence.length} />
        <Stat label="Restricted" value={evidence.filter((row: any) => row.accessLevel === "restricted").length} tone="warn" />
        <Stat label="Linked targets" value={evidence.filter((row: any) => row.targetId).length} />
      </div>
      <RegisterTable
        title="Archive custody and accessions"
        rows={accessions}
        empty="Approve archive accession imports for boxes, binders, drives, and external archive transfers."
        columns={["Received", "Title", "Container", "Location", "Status"]}
        render={(row) => [row.dateReceived ? formatDate(row.dateReceived) : "-", row.title, row.containerType, row.location, <Status key="s" value={row.status} />]}
      />
      <RegisterTable
        title="Source evidence and provenance"
        rows={evidence}
        empty="Approved section imports automatically create source evidence links here."
        columns={["Source", "Kind", "Target", "Access", "Status"]}
        render={(row) => [row.sourceTitle, row.evidenceKind, row.targetTable ?? "-", <Badge key="a" tone={row.accessLevel === "restricted" ? "danger" : "info"}>{row.accessLevel}</Badge>, <Status key="s" value={row.status} />]}
      />
    </div>
  );
}

function useRegisters() {
  const society = useSociety();
  const data = useQuery(api.evidenceRegisters.overview, society ? { societyId: society._id } : "skip");
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
  const directors = useQuery(api.directors.list, society ? { societyId: society._id } : "skip");
  return { society, data, people: personLinkCandidates(members, directors) };
}

function RegisterTable({
  title,
  rows,
  columns,
  render,
  empty,
}: {
  title: string;
  rows: any[];
  columns: string[];
  render: (row: any) => any[];
  empty: string;
}) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">{title}</h2>
        <span className="card__subtitle">{rows.length} row{rows.length === 1 ? "" : "s"}</span>
      </div>
      {rows.length === 0 ? (
        <div className="card__body muted">{empty}</div>
      ) : (
        <table className="table">
          <thead>
            <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 25).map((row) => (
              <tr key={row._id}>
                {render(row).map((cell, index) => <td key={index}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "warn" | "danger" | "ok" }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={{ color: tone === "warn" ? "var(--warn)" : tone === "danger" ? "var(--danger)" : undefined }}>{value}</div>
    </div>
  );
}

function Status({ value }: { value?: string }) {
  const tone = value === "Verified" || value === "Linked" ? "success" : value === "Rejected" ? "danger" : "warn";
  return <Badge tone={tone}>{value ?? "NeedsReview"}</Badge>;
}

function PromoteAction({ row, onPromote }: { row: any; onPromote: () => void }) {
  if (row.directorId) return <Badge tone="success">Director</Badge>;
  if (row.status === "Rejected") return <span className="muted">Rejected</span>;
  return (
    <button className="btn btn--ghost btn--sm" onClick={onPromote}>
      Promote
    </button>
  );
}

function PersonCell({ row, name, people }: { row: any; name?: string; people?: PersonLinkCandidate[] }) {
  const label = name || "-";
  const fallback = findPersonLink(name, people ?? []);
  const linked = Boolean(row.directorId || row.memberId || fallback);
  const to = row.directorId || fallback?.kind === "director" ? "/app/directors" : row.memberId || fallback?.kind === "member" ? "/app/members" : null;
  const content = (
    <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
      <span>{label}</span>
      {linked && <Badge tone="success">Linked</Badge>}
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
  return people.find((person) =>
    [person.name, ...person.aliases].some((candidate) => normalizePersonName(candidate) === key),
  ) ?? null;
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

function MeetingCell({ row }: { row: any }) {
  const label = row.meetingTitle || "-";
  return row.meetingId ? <Link to={`/app/meetings/${row.meetingId}`}>{label}</Link> : label;
}

function Confidence({ value }: { value?: string }) {
  return <Badge tone={value === "High" ? "success" : value === "Medium" ? "info" : "warn"}>{value ?? "Review"}</Badge>;
}

function formatMoney(value?: number) {
  return typeof value === "number" ? money(value) : "-";
}

function truncate(value: string | undefined, length: number) {
  const text = String(value ?? "-");
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function uniqueSources(rows: any[]) {
  return Array.from(new Set(rows.flatMap((row) => row.sourceExternalIds ?? [])));
}

function countRestricted(rows: any[]) {
  return rows.filter((row) => row.notes?.toLowerCase?.().includes("restricted") || row.sourceExternalIds?.length).length;
}
