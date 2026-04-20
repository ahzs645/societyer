import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field, InspectorNote } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { ArrowLeft, BadgeDollarSign, ExternalLink, FileText, Pencil, Plus, Save, Trash2, Inbox, ListChecks } from "lucide-react";
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

type GrantUseOfFundsLine = {
  label: string;
  amountCents?: number;
  notes?: string;
};

type GrantTimelineEvent = {
  label: string;
  date: string;
  status?: string;
  notes?: string;
};

type GrantComplianceFlag = {
  label: string;
  status: string;
  notes?: string;
  requirementId?: string;
};

type GrantContact = {
  role: string;
  name?: string;
  organization?: string;
  email?: string;
  phone?: string;
  notes?: string;
};

type GrantAnswerLibraryItem = {
  section: string;
  title: string;
  body: string;
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

function cleanStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function splitStringList(value: unknown) {
  if (Array.isArray(value)) return cleanStringList(value);
  return Array.from(
    new Set(
      String(value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function asUseOfFunds(value: unknown): GrantUseOfFundsLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    label: String(item?.label ?? ""),
    amountCents: optionalNumber(item?.amountCents),
    notes: optionalString(item?.notes),
  }));
}

function sanitizeUseOfFunds(value: unknown) {
  return asUseOfFunds(value).filter((item) => item.label.trim());
}

function asTimelineEvents(value: unknown): GrantTimelineEvent[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    label: String(item?.label ?? ""),
    date: String(item?.date ?? ""),
    status: optionalString(item?.status),
    notes: optionalString(item?.notes),
  }));
}

function sanitizeTimelineEvents(value: unknown) {
  return asTimelineEvents(value).filter((item) => item.label.trim() && item.date.trim());
}

function asComplianceFlags(value: unknown): GrantComplianceFlag[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    label: String(item?.label ?? ""),
    status: String(item?.status ?? "Info"),
    notes: optionalString(item?.notes),
    requirementId: optionalString(item?.requirementId),
  }));
}

function sanitizeComplianceFlags(value: unknown) {
  return asComplianceFlags(value).filter((item) => item.label.trim());
}

function asContacts(value: unknown): GrantContact[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    role: optionalString(item?.role) ?? "Contact",
    name: optionalString(item?.name),
    organization: optionalString(item?.organization),
    email: optionalString(item?.email),
    phone: optionalString(item?.phone),
    notes: optionalString(item?.notes),
  }));
}

function sanitizeContacts(value: unknown) {
  return asContacts(value).filter((item) =>
    [item.role, item.name, item.organization, item.email, item.phone, item.notes]
      .some((part) => String(part ?? "").trim()),
  );
}

function asAnswerLibrary(value: unknown): GrantAnswerLibraryItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    section: String(item?.section ?? "Application answer"),
    title: String(item?.title ?? ""),
    body: String(item?.body ?? ""),
  }));
}

function sanitizeAnswerLibrary(value: unknown) {
  return asAnswerLibrary(value).filter((item) => item.title.trim() && item.body.trim());
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

function grantRiskFlags(draft: any) {
  const flags = new Set(splitStringList(draft.riskFlagsInput ?? draft.riskFlags));
  if (draft.sensitivity === "restricted") flags.add("restricted");
  if ((draft.confidence ?? "") === "Review") flags.add("needs review");
  return Array.from(flags);
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
    confirmationCode: optionalString(draft.confirmationCode),
    sourcePath: optionalString(draft.sourcePath),
    sourceImportedAtISO: optionalString(draft.sourceImportedAtISO),
    sourceFileCount: optionalNumber(draft.sourceFileCount),
    sourceDocumentIds: cleanStringList(draft.sourceDocumentIds) as any,
    sourceExternalIds: splitStringList(draft.sourceExternalIdsInput ?? draft.sourceExternalIds),
    confidence: optionalString(draft.confidence),
    sensitivity: optionalString(draft.sensitivity),
    riskFlags: grantRiskFlags(draft),
    sourceNotes: optionalString(draft.sourceNotes),
    keyFacts: cleanStringList(draft.keyFacts),
    useOfFunds: sanitizeUseOfFunds(draft.useOfFunds),
    timelineEvents: sanitizeTimelineEvents(draft.timelineEvents),
    complianceFlags: sanitizeComplianceFlags(draft.complianceFlags),
    contacts: sanitizeContacts(draft.contacts),
    answerLibrary: sanitizeAnswerLibrary(draft.answerLibrary),
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

function newGrantDraft(societyId: any) {
  return {
    societyId,
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
    sourceDocumentIds: [],
    sourceExternalIdsInput: "",
    confidence: "",
    sensitivity: "",
    riskFlagsInput: "",
    requirements: [],
    keyFacts: [],
    useOfFunds: [],
    timelineEvents: [],
    complianceFlags: [],
    contacts: [],
    answerLibrary: [],
  };
}

function grantToDraft(row: any) {
  return {
    ...row,
    id: row._id,
    fitScore: row.fitScore ?? "",
    sourceDocumentIds: cleanStringList(row.sourceDocumentIds),
    sourceExternalIdsInput: (row.sourceExternalIds ?? []).join(", "),
    confidence: row.confidence ?? "",
    sensitivity: row.sensitivity ?? "",
    riskFlagsInput: (row.riskFlags ?? []).join(", "),
    amountRequestedDollars: centsToDollarInput(row.amountRequestedCents),
    amountAwardedDollars: centsToDollarInput(row.amountAwardedCents),
    requirements: asRequirements(row.requirements),
    keyFacts: cleanStringList(row.keyFacts),
    useOfFunds: asUseOfFunds(row.useOfFunds),
    timelineEvents: asTimelineEvents(row.timelineEvents),
    complianceFlags: asComplianceFlags(row.complianceFlags),
    contacts: asContacts(row.contacts),
    answerLibrary: asAnswerLibrary(row.answerLibrary),
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
  const [selectedGrant, setSelectedGrant] = useState<any | null>(null);
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
            <Link className="btn-action" to="/app/imports">
              <FileText size={12} /> Review imports
            </Link>
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
              onClick={() => setGrantDraft(newGrantDraft(society._id))}
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
        loading={applications === undefined}
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
        loading={grants === undefined}
        rowKey={(row) => String(row._id)}
        searchPlaceholder="Search grants…"
        searchExtraFields={[
          (row) => (row.sourceExternalIds ?? []).join(" "),
          (row) => (row.riskFlags ?? []).join(" "),
          (row) => row.sourceNotes,
        ]}
        defaultSort={{ columnId: "createdAtISO", dir: "desc" }}
        onRowClick={(row) => setSelectedGrant(row)}
        rowActionLabel={(row) => `Open grant ${row.title}`}
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
            id: "sources",
            header: "Sources",
            sortable: true,
            align: "right",
            accessor: (row) => (row.sourceExternalIds ?? []).length,
            render: (row) => (row.sourceExternalIds?.length ? <Badge tone="info">{row.sourceExternalIds.length}</Badge> : "—"),
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
            <Link
              className="btn btn--ghost btn--sm"
              to={`/app/grants/${row._id}/edit`}
            >
              Edit
            </Link>
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
        loading={ledger === undefined}
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
        open={!!selectedGrant}
        onClose={() => setSelectedGrant(null)}
        title={selectedGrant?.title ?? "Grant details"}
        footer={
          <>
            <button className="btn" onClick={() => setSelectedGrant(null)}>Close</button>
            {selectedGrant && (
              <>
                <Link className="btn" to={`/app/grants/${selectedGrant._id}`}>
                  <ExternalLink size={12} /> Open full screen
                </Link>
                <Link className="btn btn--accent" to={`/app/grants/${selectedGrant._id}/edit`}>
                  <Pencil size={12} /> Edit
                </Link>
              </>
            )}
          </>
        }
      >
        {selectedGrant && (
          <GrantReadPanel
            grant={selectedGrant}
            documents={documents ?? []}
            reports={reports ?? []}
            committee={committeeById.get(String(selectedGrant.committeeId))}
            owner={(users ?? []).find((user) => String(user._id) === String(selectedGrant.boardOwnerUserId))}
            account={accountById.get(String(selectedGrant.linkedFinancialAccountId))}
          />
        )}
      </Drawer>

      <Drawer
        open={!!grantDraft}
        onClose={() => setGrantDraft(null)}
        title="New grant"
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
          <GrantEditorForm
            grantDraft={grantDraft}
            setGrantDraft={setGrantDraft}
            committees={committees ?? []}
            users={users ?? []}
            accounts={accounts ?? []}
            documents={documents ?? []}
            reports={reports ?? []}
            accountById={accountById}
          />
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

export function GrantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const grant = useQuery(api.grants.get, id ? { id } : "skip");
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

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (grant === undefined) return <div className="page">Loading…</div>;
  if (!grant || grant.societyId !== society._id) {
    return (
      <div className="page">
        <Link to="/app/grants" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
          <ArrowLeft size={12} /> All grants
        </Link>
        <PageHeader
          title="Grant not found"
          icon={<BadgeDollarSign size={16} />}
          iconColor="green"
          subtitle="The grant could not be found in the current society."
        />
      </div>
    );
  }

  const committee = (committees ?? []).find((row) => String(row._id) === String(grant.committeeId));
  const owner = (users ?? []).find((row) => String(row._id) === String(grant.boardOwnerUserId));
  const account = (accounts ?? []).find((row) => String(row._id) === String(grant.linkedFinancialAccountId));

  return (
    <div className="page">
      <Link to="/app/grants" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> All grants
      </Link>
      <PageHeader
        title={grant.title}
        icon={<BadgeDollarSign size={16} />}
        iconColor="green"
        subtitle={`${grant.funder}${grant.program ? ` · ${grant.program}` : ""}`}
        actions={
          <Link className="btn-action btn-action--primary" to={`/app/grants/${grant._id}/edit`}>
            <Pencil size={12} /> Edit grant
          </Link>
        }
      />

      <GrantReadPanel
        grant={grant}
        documents={documents ?? []}
        reports={reports ?? []}
        committee={committee}
        owner={owner}
        account={account}
      />
    </div>
  );
}

export function GrantEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const grant = useQuery(api.grants.get, id ? { id } : "skip");
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
  const toast = useToast();
  const [grantDraft, setGrantDraft] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!grant) return;
    setGrantDraft((current) => current?.id === grant._id ? current : grantToDraft(grant));
  }, [grant?._id]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (grant === undefined || (grant && !grantDraft)) return <div className="page">Loading…</div>;
  if (!grant || grant.societyId !== society._id) {
    return (
      <div className="page">
        <Link to="/app/grants" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
          <ArrowLeft size={12} /> All grants
        </Link>
        <PageHeader
          title="Grant not found"
          icon={<BadgeDollarSign size={16} />}
          iconColor="green"
          subtitle="The grant could not be found in the current society."
        />
      </div>
    );
  }

  const accountById = new Map<string, any>((accounts ?? []).map((row) => [String(row._id), row]));

  const saveGrant = async () => {
    if (!grantDraft) return;
    setSaving(true);
    try {
      await upsertGrant(buildGrantPayload(grantDraft, society._id, actingUserId));
      toast.success("Grant saved");
      navigate("/app/grants");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <Link to="/app/grants" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> All grants
      </Link>
      <PageHeader
        title={grantDraft?.title || "Edit grant"}
        icon={<BadgeDollarSign size={16} />}
        iconColor="green"
        subtitle="Edit grant details, intake settings, requirements, evidence links, and restricted-fund tracking."
        actions={
          <button
            className="btn-action btn-action--primary"
            disabled={saving}
            onClick={saveGrant}
          >
            <Save size={12} /> {saving ? "Saving…" : "Save changes"}
          </button>
        }
      />

      {grantDraft && (
        <GrantEditorForm
          grantDraft={grantDraft}
          setGrantDraft={setGrantDraft}
          committees={committees ?? []}
          users={users ?? []}
          accounts={accounts ?? []}
          documents={documents ?? []}
          reports={reports ?? []}
          accountById={accountById}
          layout="page"
        />
      )}
    </div>
  );
}

function GrantReadPanel({
  grant,
  documents,
  reports,
  committee,
  owner,
  account,
}: {
  grant: any;
  documents: any[];
  reports: any[];
  committee?: any;
  owner?: any;
  account?: any;
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <GrantDossierStack
        grant={grant}
        documents={documents}
        reports={reports}
      />
      <DossierSection title="Administrative Details">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
          <DossierFact label="Status">
            <Badge tone={grantStatusTone(grant.status)}>{grant.status ?? "Not set"}</Badge>
          </DossierFact>
          <DossierFact label="Opportunity type" value={grant.opportunityType} />
          <DossierFact label="Priority" value={grant.priority} />
          <DossierFact label="Fit score" value={grant.fitScore == null ? undefined : `${grant.fitScore}/100`} />
          <DossierFact label="Committee" value={committee?.name} />
          <DossierFact label="Board owner" value={owner?.displayName} />
          <DossierFact label="Requested" value={grant.amountRequestedCents == null ? undefined : money(grant.amountRequestedCents)} />
          <DossierFact label="Awarded" value={grant.amountAwardedCents == null ? undefined : money(grant.amountAwardedCents)} />
          <DossierFact label="Application due" value={grant.applicationDueDate ? formatDate(grant.applicationDueDate) : undefined} />
          <DossierFact label="Submitted" value={grant.submittedAtISO ? formatDate(grant.submittedAtISO) : undefined} />
          <DossierFact label="Decision" value={grant.decisionAtISO ? formatDate(grant.decisionAtISO) : undefined} />
          <DossierFact label="Next report" value={grant.nextReportDueAtISO ? formatDate(grant.nextReportDueAtISO) : undefined} />
          <DossierFact label="Project start" value={grant.startDate ? formatDate(grant.startDate) : undefined} />
          <DossierFact label="Project end" value={grant.endDate ? formatDate(grant.endDate) : undefined} />
          <DossierFact label="Public intake">
            <Badge tone={grant.allowPublicApplications ? "success" : "info"}>{grant.allowPublicApplications ? "Open" : "Internal"}</Badge>
          </DossierFact>
          <DossierFact label="Linked account" value={account ? `${account.name} · ${money(account.balanceCents ?? 0)}` : undefined} />
        </div>
        {grant.opportunityUrl && (
          <div style={{ marginTop: 10 }}>
            <div className="stat__label">Opportunity URL</div>
            <a href={grant.opportunityUrl} target="_blank" rel="noreferrer" className="row" style={{ gap: 6, overflowWrap: "anywhere" }}>
              {grant.opportunityUrl}
              <ExternalLink size={12} />
            </a>
          </div>
        )}
      </DossierSection>
      {grant.restrictedPurpose && (
        <DossierSection title="Restricted Purpose">
          <div style={{ whiteSpace: "pre-wrap" }}>{grant.restrictedPurpose}</div>
        </DossierSection>
      )}
      {(grant.publicDescription || grant.applicationInstructions) && (
        <DossierSection title="Public Intake Copy">
          {grant.publicDescription && (
            <div style={{ marginBottom: grant.applicationInstructions ? 12 : 0 }}>
              <div className="stat__label">Public description</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{grant.publicDescription}</div>
            </div>
          )}
          {grant.applicationInstructions && (
            <div>
              <div className="stat__label">Application instructions</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{grant.applicationInstructions}</div>
            </div>
          )}
        </DossierSection>
      )}
      {grant.notes && (
        <DossierSection title="Notes">
          <div style={{ whiteSpace: "pre-wrap" }}>{grant.notes}</div>
        </DossierSection>
      )}
    </div>
  );
}

function GrantEditorForm({
  grantDraft,
  setGrantDraft,
  committees,
  users,
  accounts,
  documents,
  reports,
  accountById,
  layout = "drawer",
}: {
  grantDraft: any;
  setGrantDraft: (draft: any) => void;
  committees: any[];
  users: any[];
  accounts: any[];
  documents: any[];
  reports: any[];
  accountById: Map<string, any>;
  layout?: "drawer" | "page";
}) {
  if (layout === "page") {
    return (
      <GrantEditorPageLayout
        grantDraft={grantDraft}
        setGrantDraft={setGrantDraft}
        committees={committees}
        users={users}
        accounts={accounts}
        documents={documents}
        reports={reports}
        accountById={accountById}
      />
    );
  }
  return (
    <div>
      <InspectorNote title="Public intake">
        Turn on public applications only when the opportunity is actually open. Submitted requests will land in the intake queue above.
      </InspectorNote>
      <GrantDossierStack
        grant={grantDraft}
        documents={documents}
        reports={reports}
      />
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
            {committees.map((committee) => <option key={committee._id} value={committee._id}>{committee.name}</option>)}
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
        documents={documents}
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
          {users.map((user) => <option key={user._id} value={user._id}>{user.displayName}</option>)}
        </select>
      </Field>
      <Field label="Linked financial account">
        <select className="input" value={grantDraft.linkedFinancialAccountId ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, linkedFinancialAccountId: e.target.value })}>
          <option value="">None</option>
          {accounts.map((account) => <option key={account._id} value={account._id}>{account.name}</option>)}
        </select>
      </Field>
      {grantDraft.linkedFinancialAccountId && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Current linked balance: {money(accountById.get(String(grantDraft.linkedFinancialAccountId))?.balanceCents ?? 0)}
        </div>
      )}
      <Field label="Source external IDs" hint="Comma-separated Paperless, local, or external IDs used for provenance.">
        <input className="input" value={grantDraft.sourceExternalIdsInput ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, sourceExternalIdsInput: e.target.value })} />
      </Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Confidence">
          <select className="input" value={grantDraft.confidence ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, confidence: e.target.value })}>
            <option value="">Unspecified</option>
            <option>High</option>
            <option>Medium</option>
            <option>Review</option>
          </select>
        </Field>
        <Field label="Sensitivity">
          <select className="input" value={grantDraft.sensitivity ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, sensitivity: e.target.value })}>
            <option value="">Standard</option>
            <option value="restricted">Restricted</option>
          </select>
        </Field>
      </div>
      <Field label="Risk flags" hint="Comma-separated review markers.">
        <input className="input" value={grantDraft.riskFlagsInput ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, riskFlagsInput: e.target.value })} />
      </Field>
      <Field label="Source notes">
        <textarea className="textarea" rows={3} value={grantDraft.sourceNotes ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, sourceNotes: e.target.value })} />
      </Field>
      <Field label="Notes"><textarea className="textarea" value={grantDraft.notes ?? ""} onChange={(e) => setGrantDraft({ ...grantDraft, notes: e.target.value })} /></Field>
    </div>
  );
}

function EditSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grant-edit-section">
      <header className="grant-edit-section__head">
        <h3 className="grant-edit-section__title">{title}</h3>
        {description && <p className="grant-edit-section__desc">{description}</p>}
      </header>
      <div className="grant-edit-section__body">{children}</div>
    </section>
  );
}

function GrantEditorPageLayout({
  grantDraft,
  setGrantDraft,
  committees,
  users,
  accounts,
  documents,
  reports,
  accountById,
}: {
  grantDraft: any;
  setGrantDraft: (draft: any) => void;
  committees: any[];
  users: any[];
  accounts: any[];
  documents: any[];
  reports: any[];
  accountById: Map<string, any>;
}) {
  const update = (patch: Record<string, any>) => setGrantDraft({ ...grantDraft, ...patch });

  return (
    <div className="grant-edit-layout">
      <div className="grant-edit-layout__main">
        <EditSection title="Overview" description="Funder, program, and high-level positioning.">
          <Field label="Title">
            <input className="input" value={grantDraft.title} onChange={(e) => update({ title: e.target.value })} />
          </Field>
          <div className="grant-edit-grid grant-edit-grid--2">
            <Field label="Funder">
              <input className="input" value={grantDraft.funder} onChange={(e) => update({ funder: e.target.value })} />
            </Field>
            <Field label="Program">
              <input className="input" value={grantDraft.program ?? ""} onChange={(e) => update({ program: e.target.value })} />
            </Field>
          </div>
          <div className="grant-edit-grid grant-edit-grid--3">
            <Field label="Opportunity type">
              <select className="input" value={grantDraft.opportunityType ?? ""} onChange={(e) => update({ opportunityType: e.target.value })}>
                <option value="">Unspecified</option>
                <option>Government</option>
                <option>Foundation</option>
                <option>Corporate</option>
                <option>Internal</option>
                <option>Other</option>
              </select>
            </Field>
            <Field label="Priority">
              <select className="input" value={grantDraft.priority ?? ""} onChange={(e) => update({ priority: e.target.value })}>
                <option value="">Unspecified</option>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </select>
            </Field>
            <Field label="Fit score" hint="0 to 100">
              <input className="input" type="number" inputMode="numeric" min="0" max="100" step="1" value={grantDraft.fitScore ?? ""} onChange={(e) => update({ fitScore: e.target.value })} />
            </Field>
          </div>
          <Field label="Opportunity URL">
            <input className="input" type="url" value={grantDraft.opportunityUrl ?? ""} onChange={(e) => update({ opportunityUrl: e.target.value })} />
          </Field>
        </EditSection>

        <EditSection title="Status & amounts" description="Pipeline stage, committee, and the money that goes with it.">
          <div className="grant-edit-grid grant-edit-grid--2">
            <Field label="Status">
              <select className="input" value={grantDraft.status} onChange={(e) => update({ status: e.target.value })}>
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
              <select className="input" value={grantDraft.committeeId ?? ""} onChange={(e) => update({ committeeId: e.target.value })}>
                <option value="">None</option>
                {committees.map((committee) => <option key={committee._id} value={committee._id}>{committee.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grant-edit-grid grant-edit-grid--2">
            <Field label="Requested" hint="Dollars">
              <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={grantDraft.amountRequestedDollars ?? ""} onChange={(e) => update({ amountRequestedDollars: e.target.value })} />
            </Field>
            <Field label="Awarded" hint="Dollars">
              <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={grantDraft.amountAwardedDollars ?? ""} onChange={(e) => update({ amountAwardedDollars: e.target.value })} />
            </Field>
          </div>
          <Field label="Next action">
            <input className="input" value={grantDraft.nextAction ?? ""} onChange={(e) => update({ nextAction: e.target.value })} />
          </Field>
          <Field label="Restricted purpose">
            <textarea className="textarea" value={grantDraft.restrictedPurpose ?? ""} onChange={(e) => update({ restrictedPurpose: e.target.value })} />
          </Field>
        </EditSection>

        <EditSection title="Readiness checklist" description="Documents, financials, confirmations, and post-award obligations.">
          <GrantRequirementsEditor
            draft={grantDraft}
            documents={documents}
            onChange={setGrantDraft}
          />
        </EditSection>

        <EditSection title="Public intake" description="Only enable when the opportunity is open to outside applicants.">
          <label className="checkbox">
            <input type="checkbox" checked={!!grantDraft.allowPublicApplications} onChange={(e) => update({ allowPublicApplications: e.target.checked })} /> Accept public applications
          </label>
          <Field label="Public description">
            <textarea className="textarea" rows={4} value={grantDraft.publicDescription ?? ""} onChange={(e) => update({ publicDescription: e.target.value })} />
          </Field>
          <Field label="Application instructions">
            <textarea className="textarea" rows={4} value={grantDraft.applicationInstructions ?? ""} onChange={(e) => update({ applicationInstructions: e.target.value })} />
          </Field>
        </EditSection>

        <EditSection title="Timeline & ownership" description="Deadlines, project window, and who's accountable.">
          <div className="grant-edit-grid grant-edit-grid--4">
            <Field label="Application due">
              <input className="input" type="date" value={grantDraft.applicationDueDate ?? ""} onChange={(e) => update({ applicationDueDate: e.target.value })} />
            </Field>
            <Field label="Next report">
              <input className="input" type="date" value={grantDraft.nextReportDueAtISO ?? ""} onChange={(e) => update({ nextReportDueAtISO: e.target.value })} />
            </Field>
            <Field label="Start">
              <input className="input" type="date" value={grantDraft.startDate ?? ""} onChange={(e) => update({ startDate: e.target.value })} />
            </Field>
            <Field label="End">
              <input className="input" type="date" value={grantDraft.endDate ?? ""} onChange={(e) => update({ endDate: e.target.value })} />
            </Field>
          </div>
          <div className="grant-edit-grid grant-edit-grid--2">
            <Field label="Board owner">
              <select className="input" value={grantDraft.boardOwnerUserId ?? ""} onChange={(e) => update({ boardOwnerUserId: e.target.value })}>
                <option value="">None</option>
                {users.map((user) => <option key={user._id} value={user._id}>{user.displayName}</option>)}
              </select>
            </Field>
            <Field label="Linked financial account">
              <select className="input" value={grantDraft.linkedFinancialAccountId ?? ""} onChange={(e) => update({ linkedFinancialAccountId: e.target.value })}>
                <option value="">None</option>
                {accounts.map((account) => <option key={account._id} value={account._id}>{account.name}</option>)}
              </select>
            </Field>
          </div>
          {grantDraft.linkedFinancialAccountId && (
            <div className="muted" style={{ fontSize: 12 }}>
              Current linked balance: {money(accountById.get(String(grantDraft.linkedFinancialAccountId))?.balanceCents ?? 0)}
            </div>
          )}
        </EditSection>

        <EditSection title="Provenance & notes" description="Import IDs, review markers, and free-form notes.">
          <Field label="Source external IDs" hint="Comma-separated Paperless, local, or external IDs used for provenance.">
            <input className="input" value={grantDraft.sourceExternalIdsInput ?? ""} onChange={(e) => update({ sourceExternalIdsInput: e.target.value })} />
          </Field>
          <div className="grant-edit-grid grant-edit-grid--2">
            <Field label="Confidence">
              <select className="input" value={grantDraft.confidence ?? ""} onChange={(e) => update({ confidence: e.target.value })}>
                <option value="">Unspecified</option>
                <option>High</option>
                <option>Medium</option>
                <option>Review</option>
              </select>
            </Field>
            <Field label="Sensitivity">
              <select className="input" value={grantDraft.sensitivity ?? ""} onChange={(e) => update({ sensitivity: e.target.value })}>
                <option value="">Standard</option>
                <option value="restricted">Restricted</option>
              </select>
            </Field>
          </div>
          <Field label="Risk flags" hint="Comma-separated review markers.">
            <input className="input" value={grantDraft.riskFlagsInput ?? ""} onChange={(e) => update({ riskFlagsInput: e.target.value })} />
          </Field>
          <Field label="Source notes">
            <textarea className="textarea" rows={3} value={grantDraft.sourceNotes ?? ""} onChange={(e) => update({ sourceNotes: e.target.value })} />
          </Field>
          <Field label="Notes">
            <textarea className="textarea" value={grantDraft.notes ?? ""} onChange={(e) => update({ notes: e.target.value })} />
          </Field>
        </EditSection>
      </div>

      <aside className="grant-edit-layout__aside">
        <div className="grant-edit-layout__aside-inner">
          <div className="grant-edit-aside__label">Reference dossier</div>
          <GrantDossierStack
            grant={grantDraft}
            documents={documents}
            reports={reports}
          />
        </div>
      </aside>
    </div>
  );
}

function GrantDossierStack({
  grant,
  documents,
  reports,
}: {
  grant: any;
  documents: any[];
  reports: any[];
}) {
  const hasDossierData =
    !!(grant.id ?? grant._id) ||
    !!grant.confirmationCode ||
    asUseOfFunds(grant.useOfFunds).length > 0 ||
    asTimelineEvents(grant.timelineEvents).length > 0 ||
    asComplianceFlags(grant.complianceFlags).length > 0 ||
    asContacts(grant.contacts).length > 0 ||
    asAnswerLibrary(grant.answerLibrary).length > 0 ||
    cleanStringList(grant.keyFacts).length > 0 ||
    cleanStringList(grant.sourceExternalIds).length > 0;

  if (!hasDossierData) return null;

  return (
    <div style={{ display: "grid", gap: 12, margin: "0 0 16px" }}>
      <GrantDossierSummary grant={grant} />
      <GrantEvidencePacketMap grant={grant} documents={documents} />
      <GrantDeadlineTimeline grant={grant} reports={reports} />
      <GrantUseOfFundsPanel grant={grant} />
      <GrantComplianceFlagsPanel grant={grant} />
      <GrantContactsPanel grant={grant} />
      <GrantAnswerLibraryPanel grant={grant} />
      <GrantSourceNotesPanel grant={grant} />
    </div>
  );
}

function GrantDossierSummary({ grant }: { grant: any }) {
  const readiness = requirementSummary(grant.requirements);
  const keyDates = [
    grant.applicationDueDate ? `Due ${formatDate(grant.applicationDueDate)}` : undefined,
    grant.submittedAtISO ? `Submitted ${formatDate(grant.submittedAtISO)}` : undefined,
    grant.startDate ? `Starts ${formatDate(grant.startDate)}` : undefined,
    grant.endDate ? `Ends ${formatDate(grant.endDate)}` : undefined,
    grant.nextReportDueAtISO ? `Report ${formatDate(grant.nextReportDueAtISO)}` : undefined,
  ].filter(Boolean);

  return (
    <DossierSection title="Grant Dossier Summary">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
        <DossierFact label="Funder" value={grant.funder ?? grant.funderName} />
        <DossierFact label="Program" value={grant.program} />
        <DossierFact label="Requested" value={grant.amountRequestedCents ? money(grant.amountRequestedCents) : undefined} />
        <DossierFact label="Submitted" value={grant.submittedAtISO ? formatDate(grant.submittedAtISO) : undefined} />
        <DossierFact label="Confirmation" value={grant.confirmationCode} />
        <DossierFact label="Status">
          <Badge tone={grantStatusTone(grant.status)}>{grant.status ?? "Not set"}</Badge>
        </DossierFact>
        <DossierFact label="Readiness">
          {readiness.total > 0 ? (
            <span>
              <Badge tone={readiness.percent === 100 ? "success" : readiness.percent >= 50 ? "warn" : "info"}>
                {readiness.percent}%
              </Badge>{" "}
              <span className="muted">{readiness.complete}/{readiness.total}</span>
            </span>
          ) : (
            "—"
          )}
        </DossierFact>
        <DossierFact label="Key dates" value={keyDates.length ? keyDates.join(" · ") : undefined} />
      </div>
      {grant.nextAction && (
        <div style={{ marginTop: 10 }}>
          <div className="stat__label">Next action</div>
          <div>{grant.nextAction}</div>
        </div>
      )}
    </DossierSection>
  );
}

function GrantEvidencePacketMap({ grant, documents }: { grant: any; documents: any[] }) {
  const relatedDocuments = grantRelatedDocuments(grant, documents);
  if (relatedDocuments.length === 0) return null;

  const groups = groupEvidenceDocuments(relatedDocuments);

  return (
    <DossierSection title="Evidence Packet Map">
      <div style={{ display: "grid", gap: 8 }}>
        {groups.map((group, index) => group.documents.length > 0 && (
          <details key={group.label} open={index < 4} style={detailPanelStyle}>
            <summary style={detailSummaryStyle}>
              <span>{group.label}</span>
              <Badge tone="info">{group.documents.length}</Badge>
            </summary>
            <ul style={documentListStyle}>
              {group.documents.map((document) => (
                <li key={String(document._id)} style={documentListItemStyle}>
                  <span>{cleanDocumentTitle(document)}</span>
                  {document.category && <Badge tone="neutral">{document.category}</Badge>}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </DossierSection>
  );
}

function GrantDeadlineTimeline({ grant, reports }: { grant: any; reports: any[] }) {
  const items = buildGrantTimeline(grant, reports);
  if (items.length === 0) return null;

  return (
    <DossierSection title="Deadline + Obligation Timeline">
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((item) => (
          <div key={`${item.date}-${item.label}`} style={timelineItemStyle}>
            <div className="mono" style={{ minWidth: 96 }}>{formatDate(item.date)}</div>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong>{item.label}</strong>
                {item.status && <Badge tone={timelineTone(item.status, item.date)}>{item.status}</Badge>}
              </div>
              {item.notes && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{item.notes}</div>}
            </div>
          </div>
        ))}
      </div>
    </DossierSection>
  );
}

function GrantUseOfFundsPanel({ grant }: { grant: any }) {
  const lines = asUseOfFunds(grant.useOfFunds).filter((line) => line.label.trim());
  if (lines.length === 0) return null;

  const knownTotal = lines.reduce((sum, line) => sum + (line.amountCents ?? 0), 0);
  const hasAmounts = lines.some((line) => typeof line.amountCents === "number");

  return (
    <DossierSection title="Use of Funds / Budget Breakdown">
      <div style={{ display: "grid", gap: 8 }}>
        {lines.map((line) => (
          <div key={`${line.label}-${line.amountCents ?? "na"}`} style={fundLineStyle}>
            <div>
              <strong>{line.label}</strong>
              {line.notes && <div className="muted" style={{ fontSize: 12 }}>{line.notes}</div>}
            </div>
            <span className="mono">{line.amountCents === undefined ? "—" : money(line.amountCents)}</span>
          </div>
        ))}
        {hasAmounts && (
          <div style={{ ...fundLineStyle, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <strong>Seeded total</strong>
            <span className="mono">{money(knownTotal)}</span>
          </div>
        )}
      </div>
    </DossierSection>
  );
}

function GrantComplianceFlagsPanel({ grant }: { grant: any }) {
  const flags = asComplianceFlags(grant.complianceFlags).filter((flag) => flag.label.trim());
  if (flags.length === 0) return null;

  return (
    <DossierSection title="Compliance Flags">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {flags.map((flag) => (
          <span key={`${flag.label}-${flag.status}`} style={flagChipStyle} title={flag.notes}>
            <Badge tone={complianceTone(flag.status)}>{flag.status}</Badge>
            <span>{flag.label}</span>
          </span>
        ))}
      </div>
    </DossierSection>
  );
}

function GrantContactsPanel({ grant }: { grant: any }) {
  const contacts = asContacts(grant.contacts).filter((contact) =>
    [contact.role, contact.name, contact.organization, contact.email, contact.phone, contact.notes]
      .some((part) => String(part ?? "").trim()),
  );
  if (contacts.length === 0) return null;

  return (
    <DossierSection title="Contacts / Signatories">
      <div style={{ display: "grid", gap: 8 }}>
        {contacts.map((contact) => (
          <div key={`${contact.role}-${contact.name ?? contact.organization ?? "contact"}`} style={contactRowStyle}>
            <div>
              <div className="stat__label">{contact.role}</div>
              <strong>{contact.name ?? contact.organization ?? "Unnamed contact"}</strong>
              {contact.organization && contact.name && (
                <div className="muted" style={{ fontSize: 12 }}>{contact.organization}</div>
              )}
            </div>
            <div className="muted" style={{ fontSize: 12, textAlign: "right" }}>
              {[contact.email, contact.phone, contact.notes].filter(Boolean).join(" · ")}
            </div>
          </div>
        ))}
      </div>
    </DossierSection>
  );
}

function GrantAnswerLibraryPanel({ grant }: { grant: any }) {
  const answers = asAnswerLibrary(grant.answerLibrary).filter((answer) => answer.title.trim() && answer.body.trim());
  if (answers.length === 0) return null;

  return (
    <DossierSection title="Application Answer Library">
      <div style={{ display: "grid", gap: 8 }}>
        {answers.map((answer) => (
          <details key={`${answer.section}-${answer.title}`} style={detailPanelStyle}>
            <summary style={detailSummaryStyle}>
              <span>{answer.title}</span>
              <Badge tone="neutral">{answer.section}</Badge>
            </summary>
            <p style={{ margin: "8px 0 0", color: "var(--text-secondary)", lineHeight: 1.45 }}>
              {answer.body}
            </p>
          </details>
        ))}
      </div>
    </DossierSection>
  );
}

function GrantSourceNotesPanel({ grant }: { grant: any }) {
  const keyFacts = cleanStringList(grant.keyFacts);
  const sourceExternalIds = cleanStringList(grant.sourceExternalIds);
  const hasSource =
    grant.sourcePath ||
    grant.sourceImportedAtISO ||
    grant.sourceFileCount ||
    grant.sourceNotes ||
    sourceExternalIds.length > 0 ||
    grant.confidence ||
    grant.sensitivity ||
    keyFacts.length > 0;
  if (!hasSource) return null;

  return (
    <DossierSection title="Imported Source Notes">
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
          <DossierFact label="Imported from" value={grant.sourcePath} />
          <DossierFact label="Import date" value={grant.sourceImportedAtISO ? formatDate(grant.sourceImportedAtISO) : undefined} />
          <DossierFact label="Linked files" value={grant.sourceFileCount ? String(grant.sourceFileCount) : undefined} />
          <DossierFact label="Confidence" value={grant.confidence} />
          <DossierFact label="Sensitivity" value={grant.sensitivity} />
        </div>
        {sourceExternalIds.length > 0 && (
          <div className="muted mono" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
            Sources: {sourceExternalIds.join(", ")}
          </div>
        )}
        {keyFacts.length > 0 && (
          <ul style={{ ...documentListStyle, marginTop: 0 }}>
            {keyFacts.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>
        )}
        <div className="muted" style={{ fontSize: 12 }}>
          {grant.sourceNotes ?? "Review sensitive contact details before public use."}
        </div>
      </div>
    </DossierSection>
  );
}

function DossierSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section style={dossierSectionStyle}>
      <div className="stat__label" style={{ marginBottom: 10 }}>{title}</div>
      {children}
    </section>
  );
}

function DossierFact({
  label,
  value,
  children,
}: {
  label: string;
  value?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div style={factBoxStyle}>
      <div className="stat__label">{label}</div>
      <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{children ?? value ?? "—"}</div>
    </div>
  );
}

function grantStatusTone(status: unknown) {
  if (status === "Awarded" || status === "Active" || status === "Closed") return "success";
  if (status === "Declined") return "danger";
  if (status === "Submitted" || status === "Drafting") return "warn";
  return "info";
}

function complianceTone(status: unknown) {
  const text = String(status ?? "").toLowerCase();
  if (/(ready|attached|present|saved|linked|waived|complete)/.test(text)) return "success";
  if (/(missing|not|needed|overdue)/.test(text)) return "danger";
  if (/(requested|review|scheduled|watch|conditional)/.test(text)) return "warn";
  return "info";
}

function timelineTone(status: unknown, date: string) {
  const text = String(status ?? "").toLowerCase();
  if (/(submitted|complete|attached|ready|saved|done)/.test(text)) return "success";
  if (/(overdue|missing|not)/.test(text)) return "danger";
  const dueTime = new Date(date).getTime();
  if (Number.isFinite(dueTime) && dueTime < Date.now() && !/(conditional|expected)/.test(text)) return "danger";
  if (/(due|requested|conditional|expected|watch)/.test(text)) return "warn";
  return "info";
}

function grantPacketKey(grant: any) {
  const title = String(grant.title ?? "").toLowerCase();
  if (title.includes("canada summer jobs")) return "canada summer jobs";
  if (title.includes("bc community gaming") || title.includes("gaming grant")) return "bc gaming grant";
  return "";
}

function grantRelatedDocuments(grant: any, documents: any[]) {
  const linkedIds = new Set(
    [
      ...asRequirements(grant.requirements).map((requirement) => requirement.documentId),
      ...cleanStringList(grant.sourceDocumentIds),
    ]
      .filter(Boolean)
      .map(String),
  );
  const packetKey = grantPacketKey(grant);
  return documents.filter((document) => {
    if (linkedIds.has(String(document._id))) return true;
    if (!packetKey) return false;
    return evidenceDocumentText(document).includes(packetKey);
  });
}

const EVIDENCE_GROUPS = [
  {
    label: "Application / confirmation",
    patterns: [/application|confirmation|summary|online version|main application|review purposes/i],
  },
  {
    label: "Bylaws and registry evidence",
    patterns: [/bylaws|constitution|registry|society|annual report|certified/i],
  },
  {
    label: "AGM / board evidence",
    patterns: [/annual general meeting|agm|directors|office|officer|authority to act|primary officer/i],
  },
  {
    label: "Financials and budgets",
    patterns: [/budget|financial|fin312|statement|screenshot|revenue|expenses|balance|2024-2025|simplified_program_financials/i],
  },
  {
    label: "Program narrative",
    patterns: [/program information|program|narrative|job details/i],
  },
  {
    label: "Government guides / conditions",
    patterns: [/guide|conditions|cond|checklist|faq|tutorial|canada\.ca|common hosted/i],
  },
  {
    label: "Follow-up documents",
    patterns: [/follow.?up|direct deposit|email/i],
  },
];

function groupEvidenceDocuments(documents: any[]) {
  const groups = EVIDENCE_GROUPS.map((group) => ({ label: group.label, documents: [] as any[] }));
  const other = { label: "Other packet files", documents: [] as any[] };

  for (const document of documents) {
    const text = evidenceDocumentText(document);
    const index = EVIDENCE_GROUPS.findIndex((group) =>
      group.patterns.some((pattern) => pattern.test(text)),
    );
    if (index >= 0) groups[index].documents.push(document);
    else other.documents.push(document);
  }

  return [...groups, other];
}

function evidenceDocumentText(document: any) {
  return [
    document.title,
    document.fileName,
    document.category,
    ...(Array.isArray(document.tags) ? document.tags : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function cleanDocumentTitle(document: any) {
  return String(document.title ?? document.fileName ?? "Document")
    .replace(/^Grant packet — /, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildGrantTimeline(grant: any, reports: any[]) {
  const grantId = String(grant.id ?? grant._id ?? "");
  const items: { date: string; label: string; status?: string; notes?: string }[] = [];
  const add = (date: unknown, label: string, status?: string, notes?: string) => {
    const text = optionalString(date);
    if (!text) return;
    items.push({ date: text, label, status, notes });
  };

  add(grant.applicationDueDate, "Application due", "Due");
  add(grant.submittedAtISO, "Application submitted", "Submitted", grant.confirmationCode ? `Confirmation ${grant.confirmationCode}` : undefined);
  add(grant.decisionAtISO, "Decision expected / recorded", "Expected");
  add(grant.startDate, "Project start", "Scheduled");
  add(grant.endDate, "Project end", "Scheduled");
  add(grant.nextReportDueAtISO, "Next report due", "Due");

  for (const requirement of asRequirements(grant.requirements)) {
    add(requirement.dueDate, requirement.label, requirement.status, requirement.notes);
  }
  for (const event of asTimelineEvents(grant.timelineEvents)) {
    add(event.date, event.label, event.status, event.notes);
  }
  for (const report of reports.filter((report) => String(report.grantId) === grantId)) {
    add(report.dueAtISO, report.title, report.status, report.notes);
    add(report.submittedAtISO, `${report.title} submitted`, "Submitted");
  }

  const deduped = new Map<string, { date: string; label: string; status?: string; notes?: string }>();
  for (const item of items) {
    deduped.set(`${item.date}-${item.label}`, item);
  }
  return Array.from(deduped.values()).sort((a, b) => a.date.localeCompare(b.date));
}

const dossierSectionStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-panel)",
  padding: 12,
};

const factBoxStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: 10,
  minWidth: 0,
};

const detailPanelStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: "8px 10px",
};

const detailSummaryStyle = {
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  fontWeight: 600,
};

const documentListStyle = {
  margin: "8px 0 0",
  paddingLeft: 18,
  display: "grid",
  gap: 6,
};

const documentListItemStyle = {
  color: "var(--text-secondary)",
  lineHeight: 1.35,
};

const timelineItemStyle = {
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: 10,
};

const fundLineStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
};

const flagChipStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  padding: "6px 8px",
  background: "var(--bg-base)",
};

const contactRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: 10,
};

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
