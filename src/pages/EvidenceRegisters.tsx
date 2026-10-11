import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, RelatedDocumentViews, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Archive, Banknote, ClipboardCheck, FileSearch, GitBranch, Plus } from "lucide-react";
import { formatDate, money } from "../lib/format";
import { todayDateOnly } from "../../shared/dateOnly";
import { ImportCandidatesNotice } from "../components/ImportCandidatesNotice";
import { InfoPopover } from "../components/InfoPopover";
import {
  EVIDENCE_REVIEW_STATUSES,
  evidenceReviewStatusLabel,
  evidenceReviewStatusTone,
  normalizeEvidenceReviewStatus,
} from "../../shared/documentReviewStatus";

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

  const roles = data?.boardRoleAssignments ?? [];
  const changes = data?.boardRoleChanges ?? [];
  const signing = data?.signingAuthorities ?? [];

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
      <RegisterTable
        title="People and director timeline"
        restricted={data?.restrictedResources?.includes("directors")}
        rows={roles}
        empty={<EmptyRegister kind="role-assignment" links={[["Directors", "/app/directors"], ["Role holders", "/app/role-holders"]]} />}
        columns={["Person", "Role", "Group", "Start", "Status", "Actions"]}
        render={(row) => [
          <PersonCell key="p" row={row} name={row.personName} people={people} />,
          row.roleTitle,
          row.roleGroup ?? "-",
          formatDate(row.startDate),
          <Status key="s" value={row.status} />,
          <PromoteAction key="a" row={row} disabled={!canPromote} onPromote={() => promoteRole(row)} />,
        ]}
      />
      <RegisterTable
        title="Board role changes"
        restricted={data?.restrictedResources?.includes("directors")}
        rows={changes}
        empty={<EmptyRegister kind="role-change" links={[["Directors", "/app/directors"], ["Role holders", "/app/role-holders"]]} />}
        columns={["Effective", "Change", "Role", "Person", "Status"]}
        render={(row) => [formatDate(row.effectiveDate), row.changeType, row.roleTitle, <PersonCell key="p" row={row} name={row.personName} people={people} />, <Status key="s" value={row.status} />]}
      />
      <RegisterTable
        title="Signing authorities"
        restricted={data?.restrictedResources?.includes("documents")}
        rows={signing}
        empty={<EmptyRegister kind="signing-authority" links={[["Directors", "/app/directors"], ["Role holders", "/app/role-holders"]]} />}
        columns={["Effective", "Person", "Institution", "Authority", "Status"]}
        render={(row) => [formatDate(row.effectiveDate), <PersonCell key="p" row={row} name={row.personName} people={people} />, row.institutionName ?? "-", capitalize(row.authorityType), <Status key="s" value={row.status} />]}
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

  const motions = data?.motionEvidence ?? [];

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
      <RegisterTable
        title="Attendance"
        restricted={data?.restrictedResources?.includes("meetings")}
        rows={attendance}
        empty={<EmptyRegister kind="attendance" links={[["Meetings", "/app/meetings"], ["Minutes", "/app/minutes"]]} />}
        columns={["Meeting", "Date", "Person", "Attendance", "Confidence"]}
        render={(row) => [<MeetingCell key="m" row={row} />, formatDate(row.meetingDate), <PersonCell key="p" row={row} name={row.personName} people={people} />, <span key="a">{!row.attendanceStatus || /^unknown$/i.test(row.attendanceStatus) ? "Not stated" : row.attendanceStatus}{row.duplicateCount > 1 ? <span className="muted" title="The same person, meeting and status appeared more than once in the imported evidence"> · recorded {row.duplicateCount}×</span> : null}</span>, <Confidence key="c" value={row.confidence} />]}
      />
      <RegisterTable
        title="Motion evidence"
        restricted={data?.restrictedResources?.includes("motions")}
        rows={motions}
        empty={<EmptyRegister kind="motion-evidence" links={[["Meetings", "/app/meetings"], ["Minutes", "/app/minutes"]]} />}
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
      <RegisterTable
        title="Budget snapshots"
        restricted={data?.restrictedResources?.includes("financials")}
        rows={budgets}
        empty={<EmptyRegister kind="budget snapshot" links={[["Financials", "/app/financials"], ["Treasurer", "/app/treasurer"]]} />}
        columns={["Fiscal year", "Title", "Income", "Expense", "Status"]}
        render={(row) => [row.fiscalYear, row.title, formatMoney(row.totalIncomeCents), formatMoney(row.totalExpenseCents), <Status key="s" value={row.status} />]}
      />
      <RegisterTable
        title="Financial statement imports"
        restricted={data?.restrictedResources?.includes("financials")}
        rows={statements}
        empty={<EmptyRegister kind="financial statement" links={[["Financials", "/app/financials"], ["Treasurer", "/app/treasurer"]]} />}
        columns={["Period end", "Type", "Revenue", "Expenses", "Status"]}
        render={(row) => [formatDate(row.periodEnd), row.statementType, formatMoney(row.revenueCents), formatMoney(row.expensesCents), <Status key="s" value={row.status} />]}
      />
      <RegisterTable
        title="Treasurer reports"
        restricted={data?.restrictedResources?.includes("financials")}
        rows={reports}
        empty={<EmptyRegister kind="treasurer report" links={[["Treasurer", "/app/treasurer"], ["Financials", "/app/financials"]]} />}
        columns={["Date", "Title", "Cash", "Highlights", "Status"]}
        render={(row) => [formatDate(row.reportDate), row.title, formatMoney(row.cashBalanceCents), row.highlights?.length ?? 0, <Status key="s" value={row.status} />]}
      />
      <RegisterTable
        title="Transaction candidates"
        restricted={data?.restrictedResources?.includes("financials")}
        rows={transactions}
        empty={<EmptyRegister kind="transaction" links={[["Financials", "/app/financials"], ["Treasurer", "/app/treasurer"]]} />}
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
  const permissions = usePermissions();
  const canEdit = permissions.loaded && permissions.can("documents:write");
  const updateReview = usePermissionedMutation(api.evidenceRegisters.updateReview, canEdit);
  const confirm = useConfirm();
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const accessions = data?.archiveAccessions ?? [];
  const evidence = data?.sourceEvidence ?? [];
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
    const ok = await confirm({
      title: `Mark ${targets.length} evidence link${targets.length === 1 ? "" : "s"} ${evidenceReviewStatusLabel(status).toLowerCase()}?`,
      message: `${targets.length} source evidence row${targets.length === 1 ? "" : "s"} on this page will change status. Linked records and documents are not changed.`,
      confirmLabel: `Mark ${targets.length}`,
    });
    if (!ok) return;
    let updated = 0;
    for (const row of targets) {
      try {
        await updateReview({ table: "sourceEvidence", id: row._id, status });
        updated += 1;
      } catch {
        // Keep going; the toast reports the count that changed.
      }
    }
    toast.success(`${updated} evidence link${updated === 1 ? "" : "s"} updated`);
  };

  return (
    <div className="page">
      <RegisterAccessNotice resources={data?.restrictedResources} />
      <PageHeader
        title="Records archive"
        icon={<Archive size={16} />}
        iconColor="gray"
        subtitle="Archive custody, accessions and source provenance."
        info={
          <>
            <p>Archive custody, accessions, source provenance, and restricted-source handling.</p>
            <RelatedDocumentViews current="/app/records-archive" />
          </>
        }
        actions={<Link className="btn-action" to="/app/imports" aria-label="Review imports"><FileSearch size={12} /> <span className="evidence-action-label">Review imports</span></Link>}
      />
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Accessions" value={accessions.length} />
        <Stat label="Evidence links" value={evidence.length} />
        <Stat label="Restricted" value={evidence.filter((row: any) => row.accessLevel === "restricted").length} tone="warn" />
        <Stat label="Linked targets" value={evidence.filter((row: any) => row.targetId).length} />
      </div>
      <RegisterTable
        title="Archive custody and accessions"
        restricted={data?.restrictedResources?.includes("documents")}
        rows={accessions}
        empty={<EmptyNote text="No accessions yet." info="Approve archive accession imports for boxes, binders, drives, and external archive transfers." />}
        columns={["Received", "Title", "Container", "Location", "Status"]}
        render={(row) => [row.dateReceived ? formatDate(row.dateReceived) : "-", row.title, row.containerType, row.location, <Status key="s" value={row.status} />]}
      />
      <div className="documents-facets__row evidence-status-filter" role="group" aria-label="Evidence status">
        <button type="button" className={`chip${statusFilter === "all" ? " is-active" : ""}`} aria-pressed={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All <span className="chip__count">{evidence.length}</span></button>
        {statusCounts.map(([status, count]) => (
          <button key={status} type="button" className={`chip${statusFilter === status ? " is-active" : ""}`} aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)}>
            {evidenceReviewStatusLabel(status)} <span className="chip__count">{count}</span>
          </button>
        ))}
      </div>
      <RegisterTable
        title="Source evidence and provenance"
        restricted={data?.restrictedResources?.includes("documents")}
        rows={evidenceShown}
        empty={statusFilter === "all" ? <EmptyNote text="No evidence links yet." info="Approved section imports automatically create source evidence links here." /> : "No evidence links have this status."}
        columns={["Source", "Kind", "Model destination", "Access", "Status"]}
        pageActions={(pageRows) => canEdit && pageRows.length > 0 ? (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn-action" onClick={() => { void bulkStatus(pageRows, "Verified"); }}>Mark {pageRows.length} shown verified</button>
            <button className="btn-action" onClick={() => { void bulkStatus(pageRows, "Linked"); }}>Mark {pageRows.length} shown linked</button>
          </div>
        ) : null}
        render={(row) => [
          <EvidenceSourceCell key="src" row={row} />,
          row.evidenceKind,
          row.targetTable ?? "-",
          <Badge key="a" tone={row.accessLevel === "restricted" ? "danger" : "info"}>{row.accessLevel}</Badge>,
          canEdit ? (
            <select key="s" className="input input--sm evidence-status-select" aria-label={`Status for ${row.sourceTitle}`} value={normalizeEvidenceReviewStatus(row.status)} onChange={(event) => { void setStatus(row, event.target.value); }}>
              {EVIDENCE_REVIEW_STATUSES.map((status) => <option key={status} value={status}>{evidenceReviewStatusLabel(status)}</option>)}
            </select>
          ) : <Status key="s" value={row.status} />,
        ]}
      />
    </div>
  );
}

function capitalize(value?: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "-";
}

function useRegisters() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const data = useQuery(api.evidenceRegisters.overview, society ? { societyId: society._id } : "skip");
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
  const directors = useQuery(api.directors.list, society && loaded && can("directors:read") ? { societyId: society._id } : "skip");
  return { society, data, people: personLinkCandidates(members, directors) };
}

/** One-line empty state: what will appear and where today's live data is. */
function EmptyRegister({ kind, links }: { kind: string; links: [string, string][] }) {
  return (
    <span className="evidence-empty">
      Nothing imported yet.
      <InfoPopover label={`About ${kind} imports`}>
        <p>Approved {kind} imports appear here.</p>
        <p>
          Current data:{" "}
          {links.map(([label, to], index) => (
            <span key={to}>
              {index > 0 && " · "}
              <Link to={to}>{label}</Link>
            </span>
          ))}
        </p>
      </InfoPopover>
    </span>
  );
}

/** One-line empty state with the background behind an ⓘ. */
function EmptyNote({ text, info }: { text: string; info: string }) {
  return (
    <span className="evidence-empty">
      {text}
      <InfoPopover label="About this register"><p>{info}</p></InfoPopover>
    </span>
  );
}

function RegisterTable({
  title,
  rows,
  columns,
  render,
  empty,
  restricted,
  pageActions,
}: {
  title: string;
  rows: any[];
  columns: string[];
  render: (row: any) => any[];
  empty: ReactNode;
  restricted?: boolean;
  /** Actions over the rows currently shown on this page (bulk review). */
  pageActions?: (pageRows: any[]) => ReactNode;
}) {
  const [page,setPage]=useState(0);const [search,setSearch]=useState("");
  const filtered=rows.filter(row=>[row.sourceTitle,row.personName,row.meetingTitle,row.title,row.motionText,row.targetTable,row.summary,row.notes].join(" ").toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1));
  const pageRows = filtered.slice(safePage*25,safePage*25+25);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">{title}</h2>
        {restricted && <span className="card__subtitle">Access limited</span>}
      </div>
      {rows.length>25&&<div className="card__body"><input className="input" aria-label={`Search ${title}`} placeholder="Search this evidence register" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></div>}
      {pageActions && pageRows.length > 0 && <div className="card__body" style={{ paddingTop: 0 }}>{pageActions(pageRows)}</div>}
      {rows.length === 0 ? (
        <div className="card__body muted">{restricted ? "This section requires additional access." : empty}</div>
      ) : (
        <table className="table">
          <thead>
            <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row._id}>
                {render(row).map((cell, index) => <td key={index}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {filtered.length>25&&<div className="card__body row" style={{gap:12,flexWrap:"wrap"}}><button className="btn" disabled={!safePage} onClick={()=>setPage(safePage-1)}>Previous</button><span>Page {safePage+1} of {Math.ceil(filtered.length/25)} · {filtered.length} matching rows</span><button className="btn" disabled={(safePage+1)*25>=filtered.length} onClick={()=>setPage(safePage+1)}>Next</button></div>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "warn" | "danger" | "ok" }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={{ color: !value || value === 0 ? undefined : tone === "warn" ? "var(--warn)" : tone === "danger" ? "var(--danger)" : undefined }}>{value}</div>
    </div>
  );
}

function Status({ value }: { value?: string }) {
  // Register rows use their own vocabularies (Observed, Draft, Filed…); only
  // review states are relabelled, anything else is shown as stored.
  const reviewState = !value || /^(needs ?review|needsreview|linked|verified|rejected)$/i.test(value);
  if (!reviewState) return <Badge tone="info">{value}</Badge>;
  return <Badge tone={evidenceReviewStatusTone(value)}>{evidenceReviewStatusLabel(value)}</Badge>;
}

/** Source link that prefers the canonical document over a staged import candidate (D-20). */
function EvidenceSourceCell({ row }: { row: any }) {
  if (!row.sourceDocumentId) return <span>{row.sourceTitle}</span>;
  if (row.sourceDocumentKind === "candidate") {
    return row.canonicalDocumentId
      ? <span className="col" style={{ gap: 2 }}><Link to={`/app/documents/${row.canonicalDocumentId}`}>{row.sourceTitle}</Link><span className="muted" style={{ fontSize: "var(--fs-xs)" }}>cited the staged import copy; showing the document</span></span>
      : <span className="col" style={{ gap: 2 }}><span>{row.sourceTitle}</span><Link className="muted" style={{ fontSize: "var(--fs-xs)" }} to="/app/imports">still a staged import candidate</Link></span>;
  }
  if (row.sourceDocumentKind === "missing") return <span>{row.sourceTitle} <span className="muted">(document removed)</span></span>;
  return <Link to={`/app/documents/${row.sourceDocumentId}`}>{row.sourceTitle}</Link>;
}

function PromoteAction({ row, onPromote, disabled }: { row: any; onPromote: () => void; disabled?: boolean }) {
  if (row.directorId) return <Badge tone="success">Director</Badge>;
  if (row.status === "Rejected") return <span className="muted">Rejected</span>;
  return (
    <button className="btn btn--ghost btn--sm" disabled={disabled} onClick={onPromote}>
      Promote
    </button>
  );
}

function PersonCell({ row, name, people }: { row: any; name?: string; people?: PersonLinkCandidate[] }) {
  const label = name || "-";
  if(row.directoryPersonId)return <Link to={`/app/people-directory/${row.directoryPersonId}`}>{label} <Badge tone="success">Reviewed identity</Badge></Link>;
  const fallback = findPersonLink(name, people ?? []);
  const linked = Boolean(row.directorId || row.memberId);
  const to = row.directorId || fallback?.kind === "director" ? "/app/directors" : row.memberId || fallback?.kind === "member" ? "/app/members" : null;
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

function RegisterAccessNotice({ resources }: { resources?: string[] }) {
  if (!resources?.length) return null;
  return <p className="muted" role="status">Your role limits access to these register sections: {resources.join(", ")}. Accessible records remain available.</p>;
}
