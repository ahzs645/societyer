import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field, InspectorNote } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { BadgeDollarSign, FileText, Plus, Trash2, Inbox } from "lucide-react";
import { useToast } from "../components/Toast";
import { formatDate, money } from "../lib/format";

export function GrantsPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const summary = useQuery(
    api.grants.summary,
    society ? { societyId: society._id } : "skip",
  );
  const grants = useQuery(
    api.grants.list,
    society ? { societyId: society._id } : "skip",
  );
  const applications = useQuery(
    api.grants.applications,
    society ? { societyId: society._id } : "skip",
  );
  const ledger = useQuery(
    api.grants.transactions,
    society ? { societyId: society._id } : "skip",
  );
  const reports = useQuery(
    api.grants.reports,
    society ? { societyId: society._id } : "skip",
  );
  const committees = useQuery(
    api.committees.list,
    society ? { societyId: society._id } : "skip",
  );
  const users = useQuery(
    api.users.list,
    society ? { societyId: society._id } : "skip",
  );
  const accounts = useQuery(
    api.financialHub.accounts,
    society ? { societyId: society._id } : "skip",
  );
  const documents = useQuery(
    api.documents.list,
    society ? { societyId: society._id } : "skip",
  );
  const upsertGrant = useMutation(api.grants.upsertGrant);
  const removeGrant = useMutation(api.grants.removeGrant);
  const reviewApplication = useMutation(api.grants.reviewApplication);
  const convertApplication = useMutation(api.grants.convertApplication);
  const upsertReport = useMutation(api.grants.upsertReport);
  const removeReport = useMutation(api.grants.removeReport);
  const upsertTransaction = useMutation(api.grants.upsertTransaction);
  const removeTransaction = useMutation(api.grants.removeTransaction);
  const toast = useToast();
  const [grantDraft, setGrantDraft] = useState<any | null>(null);
  const [reportDraft, setReportDraft] = useState<any | null>(null);
  const [txnDraft, setTxnDraft] = useState<any | null>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const committeeById = new Map<string, any>((committees ?? []).map((row) => [String(row._id), row]));
  const grantById = new Map<string, any>((grants ?? []).map((row) => [String(row._id), row]));
  const accountById = new Map<string, any>((accounts ?? []).map((row) => [String(row._id), row]));

  const reportRows = useMemo(
    () =>
      (reports ?? []).map((report) => ({
        ...report,
        grantTitle: grantById.get(String(report.grantId))?.title ?? "Unknown grant",
      })),
    [reports, grantById],
  );

  return (
    <div className="page">
      <PageHeader
        title="Grants"
        icon={<BadgeDollarSign size={16} />}
        iconColor="green"
        subtitle="Grant pipeline, public intake, reporting deadlines, and restricted-fund ledger tracking."
        actions={
          <>
            <button
              className="btn-action"
              onClick={() =>
                setTxnDraft({
                  societyId: society._id,
                  grantId: grants?.[0]?._id ?? "",
                  date: new Date().toISOString().slice(0, 10),
                  direction: "outflow",
                  amountCents: "",
                  description: "",
                })
              }
            >
              <FileText size={12} /> Ledger entry
            </button>
            <button
              className="btn-action"
              onClick={() =>
                setReportDraft({
                  societyId: society._id,
                  grantId: grants?.[0]?._id ?? "",
                  title: "",
                  dueAtISO: new Date().toISOString().slice(0, 10),
                  status: "Upcoming",
                })
              }
            >
              <FileText size={12} /> New report
            </button>
            <button
              className="btn-action btn-action--primary"
              onClick={() =>
                setGrantDraft({
                  societyId: society._id,
                  title: "",
                  funder: "",
                  program: "",
                  status: "Prospecting",
                  applicationDueDate: new Date().toISOString().slice(0, 10),
                  allowPublicApplications: false,
                })
              }
            >
              <Plus size={12} /> New grant
            </button>
          </>
        }
      />

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Pipeline" value={String(summary?.pipeline ?? 0)} />
        <Stat label="Active awards" value={String(summary?.active ?? 0)} />
        <Stat label="Pending intake" value={String(summary?.pendingApplications ?? 0)} />
        <Stat label="Ledger spend" value={money(summary?.ledgerSpendCents ?? 0)} tone={(summary?.overdueReports ?? 0) > 0 ? "danger" : undefined} />
      </div>

      <DataTable
        label="Applications"
        icon={<Inbox size={14} />}
        data={(applications ?? []) as any[]}
        rowKey={(row) => String(row._id)}
        searchPlaceholder="Search grant applications…"
        defaultSort={{ columnId: "submittedAtISO", dir: "desc" }}
        columns={[
          {
            id: "projectTitle",
            header: "Request",
            sortable: true,
            accessor: (row) => row.projectTitle,
            render: (row) => (
              <div>
                <strong>{row.projectTitle}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{row.applicantName}</div>
              </div>
            ),
          },
          { id: "grantId", header: "Program", accessor: (row) => grantById.get(String(row.grantId))?.title ?? "", render: (row) => <span>{grantById.get(String(row.grantId))?.title ?? "General"}</span> },
          { id: "amountRequestedCents", header: "Requested", align: "right", accessor: (row) => row.amountRequestedCents ?? 0, render: (row) => <span className="mono">{money(row.amountRequestedCents)}</span> },
          { id: "status", header: "Status", sortable: true, accessor: (row) => row.status, render: (row) => <Badge tone={row.status === "Converted" ? "success" : row.status === "Declined" ? "danger" : "warn"}>{row.status}</Badge> },
          { id: "submittedAtISO", header: "Submitted", sortable: true, accessor: (row) => row.submittedAtISO, render: (row) => <span className="mono">{formatDate(row.submittedAtISO)}</span> },
        ]}
        renderRowActions={(row) => (
          <>
            {row.status === "Submitted" && (
              <button
                className="btn btn--ghost btn--sm"
                onClick={async () => {
                  await reviewApplication({ id: row._id, status: "Reviewing", actingUserId });
                  toast.success("Application moved to review");
                }}
              >
                Review
              </button>
            )}
            {!["Converted", "Declined"].includes(row.status) && (
              <button
                className="btn btn--ghost btn--sm"
                onClick={async () => {
                  await convertApplication({
                    id: row._id,
                    funder: grantById.get(String(row.grantId))?.funder ?? "Public intake",
                    program: grantById.get(String(row.grantId))?.program ?? undefined,
                    actingUserId,
                  });
                  toast.success("Application converted into grant pipeline item");
                }}
              >
                Convert
              </button>
            )}
            {row.status !== "Declined" && (
              <button
                className="btn btn--ghost btn--sm"
                onClick={async () => {
                  await reviewApplication({ id: row._id, status: "Declined", actingUserId });
                  toast.success("Application declined");
                }}
              >
                Decline
              </button>
            )}
          </>
        )}
      />

      <div className="spacer-6" />

      <DataTable
        label="Grant pipeline"
        icon={<BadgeDollarSign size={14} />}
        data={(grants ?? []) as any[]}
        rowKey={(row) => String(row._id)}
        searchPlaceholder="Search grants…"
        defaultSort={{ columnId: "createdAtISO", dir: "desc" }}
        columns={[
          {
            id: "title",
            header: "Grant",
            sortable: true,
            accessor: (row) => row.title,
            render: (row) => (
              <div>
                <strong>{row.title}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{row.funder}{row.program ? ` · ${row.program}` : ""}</div>
              </div>
            ),
          },
          {
            id: "status",
            header: "Status",
            sortable: true,
            accessor: (row) => row.status,
            render: (row) => <Badge tone={row.status === "Active" || row.status === "Awarded" ? "success" : row.status === "Declined" ? "danger" : "warn"}>{row.status}</Badge>,
          },
          {
            id: "amountAwardedCents",
            header: "Awarded",
            sortable: true,
            align: "right",
            accessor: (row) => row.amountAwardedCents ?? 0,
            render: (row) => <span className="mono">{money(row.amountAwardedCents)}</span>,
          },
          {
            id: "applicationDueDate",
            header: "Application due",
            sortable: true,
            accessor: (row) => row.applicationDueDate ?? "",
            render: (row) => <span className="mono">{row.applicationDueDate ? formatDate(row.applicationDueDate) : "—"}</span>,
          },
          {
            id: "publicIntake",
            header: "Public intake",
            sortable: true,
            accessor: (row) => (row.allowPublicApplications ? 1 : 0),
            render: (row) => <Badge tone={row.allowPublicApplications ? "success" : "info"}>{row.allowPublicApplications ? "Open" : "Internal"}</Badge>,
          },
          {
            id: "committeeId",
            header: "Committee",
            sortable: true,
            accessor: (row) => committeeById.get(String(row.committeeId))?.name ?? "",
            render: (row) => <span>{committeeById.get(String(row.committeeId))?.name ?? "—"}</span>,
          },
        ]}
        renderRowActions={(row) => (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => setGrantDraft({ ...row, id: row._id })}>
              Edit
            </button>
            <button
              className="btn btn--ghost btn--sm btn--icon"
              aria-label={`Delete grant ${row.title}`}
              onClick={async () => {
                await removeGrant({ id: row._id, actingUserId });
                toast.success("Grant removed");
              }}
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      />

      <div className="spacer-6" />

      <DataTable
        label="Restricted-fund ledger"
        icon={<FileText size={14} />}
        data={(ledger ?? []) as any[]}
        rowKey={(row) => String(row._id)}
        searchPlaceholder="Search ledger…"
        defaultSort={{ columnId: "date", dir: "desc" }}
        columns={[
          { id: "grantId", header: "Grant", accessor: (row) => grantById.get(String(row.grantId))?.title ?? "", render: (row) => <strong>{grantById.get(String(row.grantId))?.title ?? "Unknown grant"}</strong> },
          { id: "date", header: "Date", sortable: true, accessor: (row) => row.date, render: (row) => <span className="mono">{formatDate(row.date)}</span> },
          { id: "direction", header: "Direction", sortable: true, accessor: (row) => row.direction, render: (row) => <span className="cell-tag">{row.direction}</span> },
          { id: "description", header: "Description", sortable: true, accessor: (row) => row.description },
          { id: "amountCents", header: "Amount", align: "right", sortable: true, accessor: (row) => row.amountCents, render: (row) => <span className="mono">{money(row.amountCents)}</span> },
        ]}
        renderRowActions={(row) => (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => setTxnDraft({ ...row, id: row._id })}>
              Edit
            </button>
            <button
              className="btn btn--ghost btn--sm btn--icon"
              aria-label={`Delete ledger entry for ${row.description}`}
              onClick={async () => {
                await removeTransaction({ id: row._id, actingUserId });
                toast.success("Ledger entry removed");
              }}
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      />

      <div className="spacer-6" />

      <DataTable
        label="Grant reports"
        icon={<FileText size={14} />}
        data={reportRows as any[]}
        rowKey={(row) => String(row._id)}
        searchPlaceholder="Search grant reports…"
        defaultSort={{ columnId: "dueAtISO", dir: "asc" }}
        columns={[
          { id: "grantTitle", header: "Grant", sortable: true, accessor: (row) => row.grantTitle, render: (row) => <strong>{row.grantTitle}</strong> },
          { id: "title", header: "Report", sortable: true, accessor: (row) => row.title },
          {
            id: "status",
            header: "Status",
            sortable: true,
            accessor: (row) => row.status,
            render: (row) => <Badge tone={row.status === "Submitted" ? "success" : row.status === "Overdue" ? "danger" : "warn"}>{row.status}</Badge>,
          },
          { id: "dueAtISO", header: "Due", sortable: true, accessor: (row) => row.dueAtISO, render: (row) => <span className="mono">{formatDate(row.dueAtISO)}</span> },
          { id: "submittedAtISO", header: "Submitted", sortable: true, accessor: (row) => row.submittedAtISO ?? "", render: (row) => <span className="mono">{row.submittedAtISO ? formatDate(row.submittedAtISO) : "—"}</span> },
          { id: "spendingToDateCents", header: "Spend", sortable: true, align: "right", accessor: (row) => row.spendingToDateCents ?? 0, render: (row) => <span className="mono">{money(row.spendingToDateCents)}</span> },
        ]}
        renderRowActions={(row) => (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => setReportDraft({ ...row, id: row._id })}>
              Edit
            </button>
            <button
              className="btn btn--ghost btn--sm btn--icon"
              aria-label={`Delete report ${row.title}`}
              onClick={async () => {
                await removeReport({ id: row._id, actingUserId });
                toast.success("Report removed");
              }}
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      />

      <Drawer
        open={!!grantDraft}
        onClose={() => setGrantDraft(null)}
        title={grantDraft?.id ? "Edit grant" : "New grant"}
        footer={
          <>
            <button className="btn" onClick={() => setGrantDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={async () => {
                await upsertGrant({
                  ...grantDraft,
                  societyId: society._id,
                  funder: grantDraft.funder,
                  program: grantDraft.program || undefined,
                  committeeId: grantDraft.committeeId || undefined,
                  boardOwnerUserId: grantDraft.boardOwnerUserId || undefined,
                  linkedFinancialAccountId: grantDraft.linkedFinancialAccountId || undefined,
                  publicDescription: grantDraft.publicDescription || undefined,
                  allowPublicApplications: !!grantDraft.allowPublicApplications,
                  applicationInstructions: grantDraft.applicationInstructions || undefined,
                  restrictedPurpose: grantDraft.restrictedPurpose || undefined,
                  applicationDueDate: grantDraft.applicationDueDate || undefined,
                  submittedAtISO: grantDraft.submittedAtISO || undefined,
                  decisionAtISO: grantDraft.decisionAtISO || undefined,
                  startDate: grantDraft.startDate || undefined,
                  endDate: grantDraft.endDate || undefined,
                  nextReportDueAtISO: grantDraft.nextReportDueAtISO || undefined,
                  notes: grantDraft.notes || undefined,
                  amountRequestedCents: grantDraft.amountRequestedCents ? Number(grantDraft.amountRequestedCents) : undefined,
                  amountAwardedCents: grantDraft.amountAwardedCents ? Number(grantDraft.amountAwardedCents) : undefined,
                  actingUserId,
                });
                toast.success("Grant saved");
                setGrantDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {grantDraft && (
          <div>
            <InspectorNote title="Public intake">
              Turn on public applications only when the opportunity is actually open. Submitted requests will land in the intake queue above.
            </InspectorNote>
            <Field label="Title"><input className="input" value={grantDraft.title} onChange={(e) => setGrantDraft({ ...grantDraft, title: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Funder"><input className="input" value={grantDraft.funder} onChange={(e) => setGrantDraft({ ...grantDraft, funder: e.target.value })} /></Field>
              <Field label="Program"><input className="input" value={grantDraft.program ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, program: e.target.value })} /></Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Status">
                <select className="input" value={grantDraft.status} onChange={(e) => setGrantDraft({ ...grantDraft, status: e.target.value })}>
                  <option>Prospecting</option>
                  <option>Drafting</option>
                  <option>Submitted</option>
                  <option>Awarded</option>
                  <option>Declined</option>
                  <option>Active</option>
                  <option>Closed</option>
                </select>
              </Field>
              <Field label="Committee">
                <select className="input" value={grantDraft.committeeId ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, committeeId: e.target.value })}>
                  <option value="">None</option>
                  {(committees ?? []).map((committee) => <option key={committee._id} value={committee._id}>{committee.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Requested (cents)"><input className="input" type="number" value={grantDraft.amountRequestedCents ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, amountRequestedCents: e.target.value })} /></Field>
              <Field label="Awarded (cents)"><input className="input" type="number" value={grantDraft.amountAwardedCents ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, amountAwardedCents: e.target.value })} /></Field>
            </div>
            <Field label="Restricted purpose"><textarea className="textarea" value={grantDraft.restrictedPurpose ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, restrictedPurpose: e.target.value })} /></Field>
            <label className="checkbox"><input type="checkbox" checked={!!grantDraft.allowPublicApplications} onChange={(e) => setGrantDraft({ ...grantDraft, allowPublicApplications: e.target.checked })} /> Accept public applications</label>
            <Field label="Public description"><textarea className="textarea" rows={4} value={grantDraft.publicDescription ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, publicDescription: e.target.value })} /></Field>
            <Field label="Application instructions"><textarea className="textarea" rows={4} value={grantDraft.applicationInstructions ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, applicationInstructions: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Application due"><input className="input" type="date" value={grantDraft.applicationDueDate ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, applicationDueDate: e.target.value })} /></Field>
              <Field label="Next report"><input className="input" type="date" value={grantDraft.nextReportDueAtISO ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, nextReportDueAtISO: e.target.value })} /></Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Start"><input className="input" type="date" value={grantDraft.startDate ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, startDate: e.target.value })} /></Field>
              <Field label="End"><input className="input" type="date" value={grantDraft.endDate ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, endDate: e.target.value })} /></Field>
            </div>
            <Field label="Board owner">
              <select className="input" value={grantDraft.boardOwnerUserId ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, boardOwnerUserId: e.target.value })}>
                <option value="">None</option>
                {(users ?? []).map((user) => <option key={user._id} value={user._id}>{user.displayName}</option>)}
              </select>
            </Field>
            <Field label="Linked financial account">
              <select className="input" value={grantDraft.linkedFinancialAccountId ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, linkedFinancialAccountId: e.target.value })}>
                <option value="">None</option>
                {(accounts ?? []).map((account) => <option key={account._id} value={account._id}>{account.name}</option>)}
              </select>
            </Field>
            {grantDraft.linkedFinancialAccountId && (
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Current linked balance: {money(accountById.get(String(grantDraft.linkedFinancialAccountId))?.balanceCents ?? 0)}
              </div>
            )}
            <Field label="Notes"><textarea className="textarea" value={grantDraft.notes ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, notes: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!txnDraft}
        onClose={() => setTxnDraft(null)}
        title={txnDraft?.id ? "Edit ledger entry" : "New ledger entry"}
        footer={
          <>
            <button className="btn" onClick={() => setTxnDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={async () => {
                await upsertTransaction({
                  ...txnDraft,
                  societyId: society._id,
                  grantId: txnDraft.grantId,
                  financialTransactionId: txnDraft.financialTransactionId || undefined,
                  documentId: txnDraft.documentId || undefined,
                  amountCents: Number(txnDraft.amountCents),
                  notes: txnDraft.notes || undefined,
                  actingUserId,
                });
                toast.success("Ledger entry saved");
                setTxnDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {txnDraft && (
          <div>
            <Field label="Grant">
              <select className="input" value={txnDraft.grantId ?? ""} onChange={(e) => setTxnDraft({ ...txnDraft, grantId: e.target.value })}>
                {(grants ?? []).map((grant) => <option key={grant._id} value={grant._id}>{grant.title}</option>)}
              </select>
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Date"><input className="input" type="date" value={txnDraft.date ?? ""} onChange={(e) => setTxnDraft({ ...txnDraft, date: e.target.value })} /></Field>
              <Field label="Direction">
                <select className="input" value={txnDraft.direction} onChange={(e) => setTxnDraft({ ...txnDraft, direction: e.target.value })}>
                  <option>inflow</option>
                  <option>outflow</option>
                  <option>commitment</option>
                  <option>adjustment</option>
                </select>
              </Field>
            </div>
            <Field label="Amount (cents)"><input className="input" type="number" value={txnDraft.amountCents ?? ""} onChange={(e) => setTxnDraft({ ...txnDraft, amountCents: e.target.value })} /></Field>
            <Field label="Description"><input className="input" value={txnDraft.description ?? ""} onChange={(e) => setTxnDraft({ ...txnDraft, description: e.target.value })} /></Field>
            <Field label="Evidence document">
              <select className="input" value={txnDraft.documentId ?? ""} onChange={(e) => setTxnDraft({ ...txnDraft, documentId: e.target.value })}>
                <option value="">None</option>
                {(documents ?? []).map((document) => <option key={document._id} value={document._id}>{document.title}</option>)}
              </select>
            </Field>
            <Field label="Notes"><textarea className="textarea" value={txnDraft.notes ?? ""} onChange={(e) => setTxnDraft({ ...txnDraft, notes: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!reportDraft}
        onClose={() => setReportDraft(null)}
        title={reportDraft?.id ? "Edit report" : "New report"}
        footer={
          <>
            <button className="btn" onClick={() => setReportDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={async () => {
                await upsertReport({
                  ...reportDraft,
                  societyId: society._id,
                  grantId: reportDraft.grantId,
                  submittedAtISO: reportDraft.submittedAtISO || undefined,
                  spendingToDateCents: reportDraft.spendingToDateCents ? Number(reportDraft.spendingToDateCents) : undefined,
                  outcomeSummary: reportDraft.outcomeSummary || undefined,
                  documentId: reportDraft.documentId || undefined,
                  submittedByUserId: reportDraft.submittedAtISO ? actingUserId : undefined,
                  notes: reportDraft.notes || undefined,
                  actingUserId,
                });
                toast.success("Grant report saved");
                setReportDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {reportDraft && (
          <div>
            <Field label="Grant">
              <select className="input" value={reportDraft.grantId ?? ""} onChange={(e) => setReportDraft({ ...reportDraft, grantId: e.target.value })}>
                {(grants ?? []).map((grant) => <option key={grant._id} value={grant._id}>{grant.title}</option>)}
              </select>
            </Field>
            <Field label="Title"><input className="input" value={reportDraft.title} onChange={(e) => setReportDraft({ ...reportDraft, title: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Status">
                <select className="input" value={reportDraft.status} onChange={(e) => setReportDraft({ ...reportDraft, status: e.target.value })}>
                  <option>Upcoming</option>
                  <option>Due</option>
                  <option>Submitted</option>
                  <option>Overdue</option>
                </select>
              </Field>
              <Field label="Due"><input className="input" type="date" value={reportDraft.dueAtISO ?? ""} onChange={(e) => setReportDraft({ ...reportDraft, dueAtISO: e.target.value })} /></Field>
            </div>
            <Field label="Submitted"><input className="input" type="date" value={reportDraft.submittedAtISO ?? ""} onChange={(e) => setReportDraft({ ...reportDraft, submittedAtISO: e.target.value })} /></Field>
            <Field label="Spending to date (cents)"><input className="input" type="number" value={reportDraft.spendingToDateCents ?? ""} onChange={(e) => setReportDraft({ ...reportDraft, spendingToDateCents: e.target.value })} /></Field>
            <Field label="Outcome summary"><textarea className="textarea" value={reportDraft.outcomeSummary ?? ""} onChange={(e) => setReportDraft({ ...reportDraft, outcomeSummary: e.target.value })} /></Field>
            <Field label="Report document">
              <select className="input" value={reportDraft.documentId ?? ""} onChange={(e) => setReportDraft({ ...reportDraft, documentId: e.target.value })}>
                <option value="">None</option>
                {(documents ?? []).map((document) => <option key={document._id} value={document._id}>{document.title}</option>)}
              </select>
            </Field>
            <Field label="Notes"><textarea className="textarea" value={reportDraft.notes ?? ""} onChange={(e) => setReportDraft({ ...reportDraft, notes: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger";
}) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={tone ? { color: "var(--danger)" } : undefined}>
        {value}
      </div>
    </div>
  );
}
