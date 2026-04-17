import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge } from "../components/ui";
import { Archive, Banknote, ClipboardCheck, FileSearch, GitBranch } from "lucide-react";
import { formatDate, money } from "../lib/format";

export function GovernanceRegistersPage() {
  const { society, data } = useRegisters();
  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const roles = data?.boardRoleAssignments ?? [];
  const changes = data?.boardRoleChanges ?? [];
  const signing = data?.signingAuthorities ?? [];

  return (
    <div className="page">
      <PageHeader
        title="Governance registers"
        icon={<GitBranch size={16} />}
        iconColor="blue"
        subtitle="Source-backed director/officer timeline, board role changes, and signing authority records."
        actions={<Link className="btn-action" to="/app/imports"><FileSearch size={12} /> Review imports</Link>}
      />
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
        columns={["Person", "Role", "Group", "Start", "Status"]}
        render={(row) => [row.personName, row.roleTitle, row.roleGroup ?? "-", formatDate(row.startDate), <Status key="s" value={row.status} />]}
      />
      <RegisterTable
        title="Board role changes"
        rows={changes}
        empty="Approve role-change imports to track appointments, removals, vacancies, and renamed positions."
        columns={["Effective", "Change", "Role", "Person", "Status"]}
        render={(row) => [formatDate(row.effectiveDate), row.changeType, row.roleTitle, row.personName ?? "-", <Status key="s" value={row.status} />]}
      />
      <RegisterTable
        title="Signing authorities"
        rows={signing}
        empty="Approve signing-authority imports after source review."
        columns={["Effective", "Person", "Institution", "Authority", "Status"]}
        render={(row) => [formatDate(row.effectiveDate), row.personName, row.institutionName ?? "-", row.authorityType, <Status key="s" value={row.status} />]}
      />
    </div>
  );
}

export function MeetingEvidencePage() {
  const { society, data } = useRegisters();
  if (society === undefined) return <div className="page">Loading...</div>;
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
        render={(row) => [row.meetingTitle, formatDate(row.meetingDate), row.personName, row.attendanceStatus, <Confidence key="c" value={row.confidence} />]}
      />
      <RegisterTable
        title="Motion evidence"
        rows={motions}
        empty="Approve motion-evidence imports to build a source-backed motion trail."
        columns={["Meeting", "Date", "Motion", "Outcome", "Status"]}
        render={(row) => [row.meetingTitle, formatDate(row.meetingDate), truncate(row.motionText, 100), row.outcome, <Status key="s" value={row.status} />]}
      />
    </div>
  );
}

export function FinanceImportsPage() {
  const { society, data } = useRegisters();
  if (society === undefined) return <div className="page">Loading...</div>;
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
  if (society === undefined) return <div className="page">Loading...</div>;
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
  return { society, data };
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
