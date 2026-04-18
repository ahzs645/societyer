import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field, InspectorNote } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { BadgeDollarSign, FileText, Plus, Trash2, Inbox, ListChecks } from "lucide-react";
import { useToast } from "../components/Toast";
import { centsToDollarInput, dollarInputToCents, formatDate, money } from "../lib/format";

type GrantRequirementStatus = "Needed" | "Requested" | "Ready" | "Attached" | "Waived";

type GrantRequirement = {
  id: string;
  category: string;
  label: string;
  status: GrantRequirementStatus;
  dueDate?: string;
  documentId?: string;
  notes?: string;
};

type RequirementTemplateKey = "core" | "bcGaming" | "canadaSummerJobs";

const REQUIREMENT_STATUSES: GrantRequirementStatus[] = [
  "Needed",
  "Requested",
  "Ready",
  "Attached",
  "Waived",
];

const GRANT_REQUIREMENT_TEMPLATES: Record<
  RequirementTemplateKey,
  { label: string; items: Omit<GrantRequirement, "status">[] }
> = {
  core: {
    label: "Core",
    items: [
      { id: "core-opportunity-fit", category: "Prospect", label: "Eligibility and fit confirmed" },
      { id: "core-owner", category: "Ownership", label: "Board owner and internal reviewer assigned" },
      { id: "core-budget", category: "Finance", label: "Requested amount and budget notes prepared" },
      { id: "core-application-draft", category: "Application", label: "Application narrative drafted" },
      { id: "core-submission-confirmation", category: "Submission", label: "Submission confirmation saved" },
      { id: "core-reporting-calendar", category: "Post-award", label: "Reporting deadlines added" },
    ],
  },
  bcGaming: {
    label: "BC Gaming",
    items: [
      { id: "bc-bylaws", category: "Organization", label: "Certified constitution and bylaws attached" },
      { id: "bc-board-list", category: "Governance", label: "Board list and officer details ready" },
      { id: "bc-agm-minutes", category: "Governance", label: "AGM minutes with board election evidence attached" },
      { id: "bc-org-financials", category: "Finance", label: "Prior-year financial statements and current budget attached" },
      { id: "bc-gaming-account", category: "Finance", label: "Gaming account evidence reviewed" },
      { id: "bc-program-description", category: "Program", label: "Program description and community benefit narrative ready" },
      { id: "bc-program-financials", category: "Program", label: "Program actuals or simplified financials attached" },
      { id: "bc-program-budget", category: "Program", label: "Program budget attached when required" },
      { id: "bc-inkind", category: "Program", label: "In-kind contribution summary attached when claimed" },
      { id: "bc-officers", category: "Submission", label: "Two officers, submitter, contact, and delivery emails confirmed" },
      { id: "bc-confirmation", category: "Submission", label: "Application ID and confirmation PDF saved" },
      { id: "bc-summary-report", category: "Post-award", label: "Gaming Account Summary Report deadline tracked" },
    ],
  },
  canadaSummerJobs: {
    label: "Canada Summer Jobs",
    items: [
      { id: "csj-gcos-authority", category: "Access", label: "GCOS access and primary officer authority confirmed" },
      { id: "csj-org-profile", category: "Organization", label: "Legal name, CRA/business number, mandate, and address ready" },
      { id: "csj-project-dates", category: "Project", label: "Project title, start date, end date, and location confirmed" },
      { id: "csj-job-details", category: "Project", label: "Job activities, supervision, and youth employment details prepared" },
      { id: "csj-wage-budget", category: "Finance", label: "Wage, hours, and requested contribution calculated" },
      { id: "csj-contacts", category: "Contacts", label: "Primary and secondary contacts confirmed" },
      { id: "csj-attestation", category: "Submission", label: "Privacy, attestation, and signatory details reviewed" },
      { id: "csj-confirmation", category: "Submission", label: "Submission confirmation saved" },
    ],
  },
};

function optionalString(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function optionalNumber(value: unknown) {
  if (value === "" || value === undefined || value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asRequirements(value: unknown): GrantRequirement[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any) => ({
      id: String(item?.id ?? `custom-${Date.now()}`),
      category: String(item?.category ?? "Custom"),
      label: String(item?.label ?? ""),
      status: REQUIREMENT_STATUSES.includes(item?.status) ? item.status : "Needed",
      dueDate: optionalString(item?.dueDate),
      documentId: optionalString(item?.documentId),
      notes: optionalString(item?.notes),
    }));
}

function sanitizeRequirements(value: unknown) {
  return asRequirements(value).filter((item) => item.label.trim());
}

function mergeTemplateRequirements(
  current: GrantRequirement[] | undefined,
  templateKey: RequirementTemplateKey,
) {
  const existing = new Map(asRequirements(current).map((item) => [item.id, item]));
  for (const item of GRANT_REQUIREMENT_TEMPLATES[templateKey].items) {
    if (!existing.has(item.id)) {
      existing.set(item.id, { ...item, status: "Needed" });
    }
  }
  return Array.from(existing.values());
}

function requirementSummary(requirements: GrantRequirement[] | undefined) {
  const rows = asRequirements(requirements);
  const complete = rows.filter((row) =>
    ["Ready", "Attached", "Waived"].includes(row.status),
  ).length;
  const attached = rows.filter((row) => row.documentId).length;
  const total = rows.length;
  return {
    total,
    complete,
    attached,
    percent: total > 0 ? Math.round((complete / total) * 100) : 0,
  };
}

function requirementStatusTone(status: GrantRequirementStatus): "success" | "warn" | "info" {
  if (status === "Attached" || status === "Ready" || status === "Waived") return "success";
  if (status === "Requested") return "warn";
  return "info";
}

function buildGrantPayload(draft: any, societyId: any, actingUserId: any) {
  return {
    id: draft.id,
    societyId,
    committeeId: draft.committeeId || undefined,
    boardOwnerUserId: draft.boardOwnerUserId || undefined,
    linkedFinancialAccountId: draft.linkedFinancialAccountId || undefined,
    opportunityUrl: optionalString(draft.opportunityUrl),
    opportunityType: optionalString(draft.opportunityType),
    priority: optionalString(draft.priority),
    fitScore: optionalNumber(draft.fitScore),
    nextAction: optionalString(draft.nextAction),
    publicDescription: optionalString(draft.publicDescription),
    allowPublicApplications: !!draft.allowPublicApplications,
    applicationInstructions: optionalString(draft.applicationInstructions),
    requirements: sanitizeRequirements(draft.requirements),
    title: draft.title,
    funder: draft.funder,
    program: optionalString(draft.program),
    status: draft.status,
    amountRequestedCents: dollarInputToCents(draft.amountRequestedDollars),
    amountAwardedCents: dollarInputToCents(draft.amountAwardedDollars),
    restrictedPurpose: optionalString(draft.restrictedPurpose),
    applicationDueDate: optionalString(draft.applicationDueDate),
    submittedAtISO: optionalString(draft.submittedAtISO),
    decisionAtISO: optionalString(draft.decisionAtISO),
    startDate: optionalString(draft.startDate),
    endDate: optionalString(draft.endDate),
    nextReportDueAtISO: optionalString(draft.nextReportDueAtISO),
    notes: optionalString(draft.notes),
    actingUserId,
  };
}

function buildReportPayload(draft: any, societyId: any, actingUserId: any) {
  return {
    id: draft.id,
    societyId,
    grantId: draft.grantId,
    title: draft.title,
    dueAtISO: draft.dueAtISO,
    submittedAtISO: optionalString(draft.submittedAtISO),
    status: draft.status,
    spendingToDateCents: dollarInputToCents(draft.spendingToDateDollars),
    outcomeSummary: optionalString(draft.outcomeSummary),
    documentId: draft.documentId || undefined,
    submittedByUserId: draft.submittedAtISO ? actingUserId : undefined,
    notes: optionalString(draft.notes),
    actingUserId,
  };
}

function buildTransactionPayload(draft: any, societyId: any, actingUserId: any) {
  return {
    id: draft.id,
    societyId,
    grantId: draft.grantId,
    financialTransactionId: draft.financialTransactionId || undefined,
    documentId: draft.documentId || undefined,
    date: draft.date,
    direction: draft.direction,
    amountCents: dollarInputToCents(draft.amountDollars) ?? 0,
    description: draft.description,
    notes: optionalString(draft.notes),
    actingUserId,
  };
}

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

  const reportRows = (reports ?? []).map((report) => ({
    ...report,
    grantTitle: grantById.get(String(report.grantId))?.title ?? "Unknown grant",
  }));

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
                  amountDollars: "",
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
                  opportunityType: "Government",
                  priority: "Medium",
                  fitScore: "",
                  nextAction: "",
                  opportunityUrl: "",
                  applicationDueDate: new Date().toISOString().slice(0, 10),
                  allowPublicApplications: false,
                  requirements: [],
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
            id: "readiness",
            header: "Readiness",
            sortable: true,
            accessor: (row) => requirementSummary(row.requirements).percent,
            render: (row) => {
              const readiness = requirementSummary(row.requirements);
              return readiness.total > 0 ? (
                <div>
                  <Badge tone={readiness.percent === 100 ? "success" : readiness.percent >= 50 ? "warn" : "info"}>
                    {readiness.percent}%
                  </Badge>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {readiness.complete}/{readiness.total} ready
                  </div>
                </div>
              ) : (
                <Badge tone="info">Not set</Badge>
              );
            },
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
            <button
              className="btn btn--ghost btn--sm"
              onClick={() =>
                setGrantDraft({
                  ...row,
                  id: row._id,
                  fitScore: row.fitScore ?? "",
                  amountRequestedDollars: centsToDollarInput(row.amountRequestedCents),
                  amountAwardedDollars: centsToDollarInput(row.amountAwardedCents),
                  requirements: asRequirements(row.requirements),
                })
              }
            >
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
            <button className="btn btn--ghost btn--sm" onClick={() => setTxnDraft({ ...row, id: row._id, amountDollars: centsToDollarInput(row.amountCents) })}>
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
            <button className="btn btn--ghost btn--sm" onClick={() => setReportDraft({ ...row, id: row._id, spendingToDateDollars: centsToDollarInput(row.spendingToDateCents) })}>
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
                await upsertGrant(buildGrantPayload(grantDraft, society._id, actingUserId));
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
              <Field label="Opportunity type">
                <select className="input" value={grantDraft.opportunityType ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, opportunityType: e.target.value })}>
                  <option value="">Unspecified</option>
                  <option>Government</option>
                  <option>Foundation</option>
                  <option>Corporate</option>
                  <option>Internal</option>
                  <option>Other</option>
                </select>
              </Field>
              <Field label="Priority">
                <select className="input" value={grantDraft.priority ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, priority: e.target.value })}>
                  <option value="">Unspecified</option>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Fit score" hint="0 to 100"><input className="input" type="number" inputMode="numeric" min="0" max="100" step="1" value={grantDraft.fitScore ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, fitScore: e.target.value })} /></Field>
              <Field label="Opportunity URL"><input className="input" type="url" value={grantDraft.opportunityUrl ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, opportunityUrl: e.target.value })} /></Field>
            </div>
            <Field label="Next action"><input className="input" value={grantDraft.nextAction ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, nextAction: e.target.value })} /></Field>
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
              <Field label="Requested" hint="Dollars"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={grantDraft.amountRequestedDollars ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, amountRequestedDollars: e.target.value })} /></Field>
              <Field label="Awarded" hint="Dollars"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={grantDraft.amountAwardedDollars ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, amountAwardedDollars: e.target.value })} /></Field>
            </div>
            <Field label="Restricted purpose"><textarea className="textarea" value={grantDraft.restrictedPurpose ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, restrictedPurpose: e.target.value })} /></Field>
            <GrantRequirementsEditor
              draft={grantDraft}
              documents={documents ?? []}
              onChange={setGrantDraft}
            />
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
                await upsertTransaction(buildTransactionPayload(txnDraft, society._id, actingUserId));
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
            <Field label="Amount" hint="Dollars"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={txnDraft.amountDollars ?? ""} onChange={(e) => setTxnDraft({ ...txnDraft, amountDollars: e.target.value })} /></Field>
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
                await upsertReport(buildReportPayload(reportDraft, society._id, actingUserId));
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
            <Field label="Spending to date" hint="Dollars"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={reportDraft.spendingToDateDollars ?? ""} onChange={(e) => setReportDraft({ ...reportDraft, spendingToDateDollars: e.target.value })} /></Field>
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

function GrantRequirementsEditor({
  draft,
  documents,
  onChange,
}: {
  draft: any;
  documents: any[];
  onChange: (draft: any) => void;
}) {
  const requirements = asRequirements(draft.requirements);
  const summary = requirementSummary(requirements);

  const setRequirements = (next: GrantRequirement[]) => {
    onChange({ ...draft, requirements: next });
  };

  const updateRequirement = (index: number, patch: Partial<GrantRequirement>) => {
    setRequirements(
      requirements.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  };

  return (
    <div style={{ display: "grid", gap: 12, margin: "12px 0" }}>
      <InspectorNote title="Readiness checklist">
        Track the documents, financials, confirmations, and post-award obligations that make a grant file auditable.
      </InspectorNote>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Badge tone={summary.percent === 100 && summary.total > 0 ? "success" : "info"}>
          {summary.total > 0 ? `${summary.percent}% ready` : "No checklist"}
        </Badge>
        <Badge tone="info">{summary.attached} docs linked</Badge>
        {(Object.keys(GRANT_REQUIREMENT_TEMPLATES) as RequirementTemplateKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setRequirements(mergeTemplateRequirements(requirements, key))}
          >
            <ListChecks size={12} /> {GRANT_REQUIREMENT_TEMPLATES[key].label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() =>
            setRequirements([
              ...requirements,
              {
                id: `custom-${Date.now()}`,
                category: "Custom",
                label: "New requirement",
                status: "Needed",
              },
            ])
          }
        >
          <Plus size={12} /> Add item
        </button>
      </div>

      {requirements.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          {requirements.map((item, index) => (
            <div
              key={item.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)",
                padding: 12,
                background: "var(--bg-base)",
              }}
            >
              <div className="row" style={{ justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <Badge tone={requirementStatusTone(item.status)}>{item.status}</Badge>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Remove requirement ${item.label}`}
                  onClick={() => setRequirements(requirements.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="row" style={{ gap: 12 }}>
                <Field label="Status">
                  <select
                    className="input"
                    value={item.status}
                    onChange={(event) =>
                      updateRequirement(index, {
                        status: event.target.value as GrantRequirementStatus,
                      })
                    }
                  >
                    {REQUIREMENT_STATUSES.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Category">
                  <input
                    className="input"
                    value={item.category}
                    onChange={(event) => updateRequirement(index, { category: event.target.value })}
                  />
                </Field>
              </div>
              <Field label="Requirement">
                <input
                  className="input"
                  value={item.label}
                  onChange={(event) => updateRequirement(index, { label: event.target.value })}
                />
              </Field>
              <div className="row" style={{ gap: 12 }}>
                <Field label="Due">
                  <input
                    className="input"
                    type="date"
                    value={item.dueDate ?? ""}
                    onChange={(event) => updateRequirement(index, { dueDate: event.target.value || undefined })}
                  />
                </Field>
                <Field label="Document">
                  <select
                    className="input"
                    value={item.documentId ?? ""}
                    onChange={(event) => updateRequirement(index, { documentId: event.target.value || undefined })}
                  >
                    <option value="">None</option>
                    {documents.map((document) => (
                      <option key={document._id} value={document._id}>
                        {document.title}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Notes">
                <textarea
                  className="textarea"
                  rows={2}
                  value={item.notes ?? ""}
                  onChange={(event) => updateRequirement(index, { notes: event.target.value })}
                />
              </Field>
            </div>
          ))}
        </div>
      )}
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
