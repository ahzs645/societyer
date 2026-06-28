import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";
import { ArrowLeft, BadgeDollarSign, ExternalLink, FileText, Pencil, Plus, Save, Trash2, Inbox, Upload } from "lucide-react";
import { useToast } from "../components/Toast";
import { centsToDollarInput, formatDate, money } from "../lib/format";
import {
  buildGrantPayload,
  buildReportPayload,
  buildTransactionPayload,
  grantToDraft,
  newGrantDraft,
  requirementSummary,
} from "../features/grants/lib/grantDrafts";
import {
  GrantEditorForm,
  GrantReadPanel,
} from "../features/grants/components/GrantPanels";
import { GrantSummaryStats } from "../features/grants/components/GrantSummaryStats";
import { buildCsjOrientationEmailBody } from "../features/grants/lib/csjOrientationEmail";
import { enrichGcosNormalizedGrant, readGcosExportFile } from "../lib/gcosExportImport";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { MoreActionsMenu } from "../components/MoreActionsMenu";

export function GrantsPage() {
  const society = useSociety();
  const navigate = useNavigate();
  const gcosInputRef = useRef<HTMLInputElement>(null);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const [selectedGrant, setSelectedGrant] = useState<any | null>(null);
  const [grantDraft, setGrantDraft] = useState<any | null>(null);
  const [reportDraft, setReportDraft] = useState<any | null>(null);
  const [txnDraft, setTxnDraft] = useState<any | null>(null);
  const [loadLowerSections, setLoadLowerSections] = useState(false);
  const [loadSupportData, setLoadSupportData] = useState(false);
  const [applicationsViewId, setApplicationsViewId] = useState<Id<"views"> | undefined>(undefined);
  const [applicationsFilterOpen, setApplicationsFilterOpen] = useState(false);
  const [pipelineViewId, setPipelineViewId] = useState<Id<"views"> | undefined>(undefined);
  const [pipelineFilterOpen, setPipelineFilterOpen] = useState(false);
  const [ledgerViewId, setLedgerViewId] = useState<Id<"views"> | undefined>(undefined);
  const [ledgerFilterOpen, setLedgerFilterOpen] = useState(false);
  const [reportsViewId, setReportsViewId] = useState<Id<"views"> | undefined>(undefined);
  const [reportsFilterOpen, setReportsFilterOpen] = useState(false);
  const societyId = society?._id;
  const supportDataNeeded = loadSupportData || !!selectedGrant || !!grantDraft || !!txnDraft || !!reportDraft;
  const grantDetailDataNeeded = !!selectedGrant;

  useEffect(() => {
    setLoadLowerSections(false);
    setLoadSupportData(false);
    if (!societyId) return;

    const lowerSectionsTimer = window.setTimeout(() => setLoadLowerSections(true), 250);
    const supportDataTimer = window.setTimeout(() => setLoadSupportData(true), 800);

    return () => {
      window.clearTimeout(lowerSectionsTimer);
      window.clearTimeout(supportDataTimer);
    };
  }, [societyId]);

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
    society && (loadLowerSections || !!txnDraft) ? { societyId: society._id } : "skip",
  );
  const reports = useQuery(
    api.grants.reports,
    society && (loadLowerSections || !!selectedGrant || !!grantDraft || !!reportDraft) ? { societyId: society._id } : "skip",
  );
  const committees = useQuery(
    api.committees.list,
    society && supportDataNeeded ? { societyId: society._id } : "skip",
  );
  const users = useQuery(
    api.users.list,
    society && supportDataNeeded ? { societyId: society._id } : "skip",
  );
  const accounts = useQuery(
    api.financialHub.accounts,
    society && supportDataNeeded ? { societyId: society._id } : "skip",
  );
  const documents = useQuery(
    api.documents.list,
    society && supportDataNeeded ? { societyId: society._id } : "skip",
  );
  const employees = useQuery(
    api.employees.list,
    society && grantDetailDataNeeded ? { societyId: society._id } : "skip",
  );
  const employeeLinks = useQuery(
    api.grants.employeeLinks,
    society && grantDetailDataNeeded ? { societyId: society._id } : "skip",
  );
  const secretVaultItems = useQuery(
    api.secrets.list,
    society && grantDetailDataNeeded ? { societyId: society._id } : "skip",
  );
  const upsertGrant = useMutation(api.grants.upsertGrant);
  const removeGrant = useMutation(api.grants.removeGrant);
  const upsertEmployeeLink = useMutation(api.grants.upsertEmployeeLink);
  const removeEmployeeLink = useMutation(api.grants.removeEmployeeLink);
  const createEmployee = useMutation(api.employees.create);
  const createPendingEmail = useMutation(api.pendingEmails.create);
  const createSecret = useMutation(api.secrets.create);
  const reviewApplication = useMutation(api.grants.reviewApplication);
  const convertApplication = useMutation(api.grants.convertApplication);
  const upsertReport = useMutation(api.grants.upsertReport);
  const removeReport = useMutation(api.grants.removeReport);
  const upsertTransaction = useMutation(api.grants.upsertTransaction);
  const removeTransaction = useMutation(api.grants.removeTransaction);

  const applicationsTable = useObjectRecordTableData({ societyId: society?._id, nameSingular: "grantApplication", viewId: applicationsViewId });
  const pipelineTable = useObjectRecordTableData({ societyId: society?._id, nameSingular: "grant", viewId: pipelineViewId });
  const ledgerTable = useObjectRecordTableData({ societyId: society?._id, nameSingular: "grantTransaction", viewId: ledgerViewId });
  const reportsTable = useObjectRecordTableData({ societyId: society?._id, nameSingular: "grantReport", viewId: reportsViewId });

  const committeeById = useMemo(
    () => new Map<string, any>((committees ?? []).map((row) => [String(row._id), row])),
    [committees],
  );
  const grantById = useMemo(
    () => new Map<string, any>((grants ?? []).map((row) => [String(row._id), row])),
    [grants],
  );
  const accountById = useMemo(
    () => new Map<string, any>((accounts ?? []).map((row) => [String(row._id), row])),
    [accounts],
  );

  const reportRows = useMemo(
    () =>
      (reports ?? []).map((report) => ({
        ...report,
        grantTitle: grantById.get(String(report.grantId))?.title ?? "Unknown grant",
      })),
    [reports, grantById],
  );
  const ledgerRows = useMemo(
    () =>
      (ledger ?? []).map((row: any) => ({
        ...row,
        grantTitle: grantById.get(String(row.grantId))?.title ?? "Unknown grant",
      })),
    [ledger, grantById],
  );
  const applicationRows = useMemo(
    () =>
      (applications ?? []).map((row: any) => ({
        ...row,
        program: grantById.get(String(row.grantId))?.title ?? "General",
      })),
    [applications, grantById],
  );

  const importGcosGrantFile = async (file: File | undefined) => {
    if (!file) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const text = await readGcosExportFile(file);
      const parsed = JSON.parse(text);
      const snapshot = parsed?.snapshot ?? parsed;
      const response = await fetch("/api/v1/browser-connectors/connectors/gcos/import-exported-snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
      body: JSON.stringify({
        societyId: society?._id,
        snapshot,
        normalizedGrant: enrichGcosNormalizedGrant(snapshot, parsed?.normalizedGrant),
      }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message ?? payload?.error ?? `Import failed with ${response.status}`);
      const imported = payload.data?.import;
      toast.success(imported?.created ? "GCOS grant imported" : "GCOS grant updated", payload.data?.normalizedGrant?.title ?? imported?.grantId);
    } catch (error: any) {
      const aborted = error?.name === "AbortError";
      toast.error(aborted ? "Societyer API did not respond. Make sure the local API server is running for this app URL." : error?.message ?? "Could not import GCOS export");
    } finally {
      window.clearTimeout(timeout);
    }
  };

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Grants"
        icon={<BadgeDollarSign size={16} />}
        iconColor="green"
        subtitle="Grant pipeline, public intake, reporting deadlines, and restricted-fund ledger tracking."
        actions={
          <>
            <input
              ref={gcosInputRef}
              type="file"
              accept="application/json,application/zip,.json,.zip"
              onChange={(event) => {
                void importGcosGrantFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
              style={{ display: "none" }}
            />
            <MoreActionsMenu
              items={[
                {
                  id: "review-imports",
                  label: "Review imports",
                  icon: <FileText size={14} />,
                  onSelect: () => navigate("/app/imports"),
                },
                {
                  id: "source-library",
                  label: "Source library",
                  icon: <FileText size={14} />,
                  onSelect: () => navigate("/app/grants/sources"),
                },
                {
                  id: "import-gcos",
                  label: "Import GCOS",
                  icon: <Upload size={14} />,
                  onSelect: () => gcosInputRef.current?.click(),
                },
                {
                  id: "ledger-entry",
                  label: "Ledger entry",
                  icon: <FileText size={14} />,
                  onSelect: () =>
                    setTxnDraft({
                      societyId: society._id,
                      grantId: grants?.[0]?._id ?? "",
                      date: new Date().toISOString().slice(0, 10),
                      direction: "outflow",
                      amountDollars: "",
                      description: "",
                    }),
                },
                {
                  id: "new-report",
                  label: "New report",
                  icon: <FileText size={14} />,
                  onSelect: () =>
                    setReportDraft({
                      societyId: society._id,
                      grantId: grants?.[0]?._id ?? "",
                      title: "",
                      dueAtISO: new Date().toISOString().slice(0, 10),
                      status: "Upcoming",
                    }),
                },
              ]}
            />
            <button
              className="btn-action btn-action--primary"
              onClick={() => setGrantDraft(newGrantDraft(society._id))}
            >
              <Plus size={12} /> New grant
            </button>
          </>
        }
      />

      <GrantSummaryStats summary={summary} />

      {!applicationsTable.loading && !applicationsTable.objectMetadata ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="grant application" />
      ) : applicationsTable.objectMetadata ? (
        <RecordTableScope
          tableId="grantApplications"
          objectMetadata={applicationsTable.objectMetadata}
          hydratedView={applicationsTable.hydratedView}
          records={applicationRows}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={applicationsTable.objectMetadata._id as Id<"objectMetadata">}
            icon={<Inbox size={14} />}
            label="Applications"
            views={applicationsTable.views}
            currentViewId={applicationsViewId ?? applicationsTable.views[0]?._id ?? null}
            onChangeView={(viewId) => setApplicationsViewId(viewId as Id<"views">)}
            onOpenFilter={() => setApplicationsFilterOpen((v) => !v)}
          />
          <RecordTableFilterPopover open={applicationsFilterOpen} onClose={() => setApplicationsFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={applicationsTable.loading || applications === undefined}
            renderCell={({ record, field }) => {
              if (field.name === "projectTitle") return (
                <div>
                  <strong>{record.projectTitle}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>{record.applicantName}</div>
                </div>
              );
              if (field.name === "program") return <span>{record.program}</span>;
              if (field.name === "amountRequestedCents") return <span className="mono">{money(record.amountRequestedCents)}</span>;
              if (field.name === "status") return <Badge tone={record.status === "Converted" ? "success" : record.status === "Declined" ? "danger" : "warn"}>{record.status}</Badge>;
              if (field.name === "submittedAtISO") return <span className="mono">{formatDate(record.submittedAtISO)}</span>;
              return undefined;
            }}
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
        </RecordTableScope>
      ) : null}

      <div className="spacer-6" />

      {!pipelineTable.loading && !pipelineTable.objectMetadata ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="grant" />
      ) : pipelineTable.objectMetadata ? (
        <RecordTableScope
          tableId="grants"
          objectMetadata={pipelineTable.objectMetadata}
          hydratedView={pipelineTable.hydratedView}
          records={(grants ?? []) as any[]}
          onRecordClick={(_recordId, record) => setSelectedGrant(record)}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={pipelineTable.objectMetadata._id as Id<"objectMetadata">}
            icon={<BadgeDollarSign size={14} />}
            label="Grant pipeline"
            views={pipelineTable.views}
            currentViewId={pipelineViewId ?? pipelineTable.views[0]?._id ?? null}
            onChangeView={(viewId) => setPipelineViewId(viewId as Id<"views">)}
            onOpenFilter={() => setPipelineFilterOpen((v) => !v)}
          />
          <RecordTableFilterPopover open={pipelineFilterOpen} onClose={() => setPipelineFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={pipelineTable.loading || grants === undefined}
            renderCell={({ record: row, field }) => {
              if (field.name === "title") return (
                <div>
                  <strong>{row.title}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>{row.funder}{row.program ? ` · ${row.program}` : ""}</div>
                </div>
              );
              if (field.name === "status") return <Badge tone={row.status === "Active" || row.status === "Awarded" ? "success" : row.status === "Declined" ? "danger" : "warn"}>{row.status}</Badge>;
              if (field.name === "readiness") {
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
              }
              if (field.name === "amountAwardedCents") return <span className="mono">{money(row.amountAwardedCents)}</span>;
              if (field.name === "nextAction") return row.nextAction ? <span>{row.nextAction}</span> : <span className="muted">—</span>;
              if (field.name === "applicationDueDate") return <span className="mono">{row.applicationDueDate ? formatDate(row.applicationDueDate) : "—"}</span>;
              if (field.name === "sources") return row.sourceExternalIds?.length ? (
                <Link to="/app/grants/sources" onClick={(e) => e.stopPropagation()}>
                  <Badge tone="info">{row.sourceExternalIds.length}</Badge>
                </Link>
              ) : (
                <>—</>
              );
              if (field.name === "publicIntake") return <Badge tone={row.allowPublicApplications ? "success" : "info"}>{row.allowPublicApplications ? "Open" : "Internal"}</Badge>;
              if (field.name === "committee") {
                const committee = committeeById.get(String(row.committeeId));
                return committee ? (
                  <Link to={`/app/committees/${row.committeeId}`} onClick={(e) => e.stopPropagation()}>
                    {committee.name}
                  </Link>
                ) : (
                  <>—</>
                );
              }
              return undefined;
            }}
            renderRowActions={(row) => (
              <>
                <Link
                  className="btn btn--ghost btn--sm"
                  to={`/app/grants/${row._id}/edit`}
                  onClick={(e) => e.stopPropagation()}
                >
                  Edit
                </Link>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Delete grant ${row.title}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    await removeGrant({ id: row._id, actingUserId });
                    toast.success("Grant removed");
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          />
        </RecordTableScope>
      ) : null}

      <div className="spacer-6" />

      {!ledgerTable.loading && !ledgerTable.objectMetadata ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="ledger entry" />
      ) : ledgerTable.objectMetadata ? (
        <RecordTableScope
          tableId="grantTransactions"
          objectMetadata={ledgerTable.objectMetadata}
          hydratedView={ledgerTable.hydratedView}
          records={ledgerRows}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={ledgerTable.objectMetadata._id as Id<"objectMetadata">}
            icon={<FileText size={14} />}
            label="Restricted-fund ledger"
            views={ledgerTable.views}
            currentViewId={ledgerViewId ?? ledgerTable.views[0]?._id ?? null}
            onChangeView={(viewId) => setLedgerViewId(viewId as Id<"views">)}
            onOpenFilter={() => setLedgerFilterOpen((v) => !v)}
          />
          <RecordTableFilterPopover open={ledgerFilterOpen} onClose={() => setLedgerFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={ledgerTable.loading || ledger === undefined}
            renderCell={({ record: row, field }) => {
              if (field.name === "grantTitle") return <strong>{row.grantTitle}</strong>;
              if (field.name === "date") return <span className="mono">{formatDate(row.date)}</span>;
              if (field.name === "direction") return <span className="cell-tag">{row.direction}</span>;
              if (field.name === "amountCents") return <span className="mono">{money(row.amountCents)}</span>;
              return undefined;
            }}
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
        </RecordTableScope>
      ) : null}

      <div className="spacer-6" />

      {!reportsTable.loading && !reportsTable.objectMetadata ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="grant report" />
      ) : reportsTable.objectMetadata ? (
        <RecordTableScope
          tableId="grantReports"
          objectMetadata={reportsTable.objectMetadata}
          hydratedView={reportsTable.hydratedView}
          records={reportRows}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={reportsTable.objectMetadata._id as Id<"objectMetadata">}
            icon={<FileText size={14} />}
            label="Grant reports"
            views={reportsTable.views}
            currentViewId={reportsViewId ?? reportsTable.views[0]?._id ?? null}
            onChangeView={(viewId) => setReportsViewId(viewId as Id<"views">)}
            onOpenFilter={() => setReportsFilterOpen((v) => !v)}
          />
          <RecordTableFilterPopover open={reportsFilterOpen} onClose={() => setReportsFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={reportsTable.loading || (loadLowerSections && reports === undefined)}
            renderCell={({ record: row, field }) => {
              if (field.name === "grantTitle") return <strong>{row.grantTitle}</strong>;
              if (field.name === "status") return <Badge tone={row.status === "Submitted" ? "success" : row.status === "Overdue" ? "danger" : "warn"}>{row.status}</Badge>;
              if (field.name === "dueAtISO") return <span className="mono">{formatDate(row.dueAtISO)}</span>;
              if (field.name === "submittedAtISO") return <span className="mono">{row.submittedAtISO ? formatDate(row.submittedAtISO) : "—"}</span>;
              if (field.name === "spendingToDateCents") return <span className="mono">{money(row.spendingToDateCents)}</span>;
              return undefined;
            }}
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
        </RecordTableScope>
      ) : null}

      <Drawer
        open={!!selectedGrant}
        onClose={() => setSelectedGrant(null)}
        title={selectedGrant?.title ?? "Grant details"}
        size="wide"
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
            employees={employees ?? []}
            employeeLinks={employeeLinks ?? []}
            secretVaultItems={secretVaultItems ?? []}
            committee={committeeById.get(String(selectedGrant.committeeId))}
            owner={(users ?? []).find((user) => String(user._id) === String(selectedGrant.boardOwnerUserId))}
            account={accountById.get(String(selectedGrant.linkedFinancialAccountId))}
            onLinkEmployee={async (employeeId, patch = {}) => {
              await upsertEmployeeLink({
                societyId: society._id,
                grantId: selectedGrant._id,
                employeeId,
                patch: { status: "eed_pending", source: "manual", ...patch },
                actingUserId,
              });
              toast.success("Employee linked to grant");
            }}
            onUnlinkEmployee={async (linkId) => {
              await removeEmployeeLink({ id: linkId, actingUserId });
              toast.success("Employee unlinked from grant");
            }}
            onCreateEmployee={async (draft) => {
              const employeeId = await createEmployee({
                societyId: society._id,
                firstName: String(draft.firstName ?? ""),
                lastName: String(draft.lastName ?? ""),
                email: draft.email ? String(draft.email) : undefined,
                phone: draft.phone ? String(draft.phone) : undefined,
                birthDate: draft.birthDate ? String(draft.birthDate) : undefined,
                addressLine1: draft.addressLine1 ? String(draft.addressLine1) : undefined,
                addressLine2: draft.addressLine2 ? String(draft.addressLine2) : undefined,
                city: draft.city ? String(draft.city) : undefined,
                province: draft.province ? String(draft.province) : undefined,
                postalCode: draft.postalCode ? String(draft.postalCode) : undefined,
                country: draft.country ? String(draft.country) : undefined,
                sinSecretVaultItemId: draft.sinSecretVaultItemId ? (draft.sinSecretVaultItemId as any) : undefined,
                role: String(draft.role ?? ""),
                startDate: String(draft.startDate ?? ""),
                endDate: draft.endDate ? String(draft.endDate) : undefined,
                employmentType: String(draft.employmentType ?? "FullTime"),
                hourlyWageCents: typeof draft.hourlyWageCents === "number" ? draft.hourlyWageCents : undefined,
                annualSalaryCents: typeof draft.annualSalaryCents === "number" ? draft.annualSalaryCents : undefined,
                worksafeBCNumber: draft.worksafeBCNumber ? String(draft.worksafeBCNumber) : undefined,
                cppExempt: Boolean(draft.cppExempt),
                eiExempt: Boolean(draft.eiExempt),
                notes: draft.notes ? String(draft.notes) : undefined,
              });
              toast.success("Employee created");
              return employeeId;
            }}
            onQueueEmployeeOrientationEmail={async (employee, grant) => {
              await createPendingEmail({
                societyId: society._id,
                nodeKey: "csj_remote_worker_orientation.queue_orientation_email",
                fromName: "Over the Edge",
                fromEmail: "ote@unbc.ca",
                to: String(employee.email ?? ""),
                subject: "Canada Summer Jobs remote work orientation resources",
                body: buildCsjOrientationEmailBody(employee),
                status: "ready",
                notes: `System workflow: CSJ remote worker orientation. Grant: ${grant.title}. Evidence for GCOS Young Workers/EED attestation.`,
                actingUserId,
              });
              toast.success("Orientation email queued in Outbox");
            }}
            onCreateSinVaultRecord={async (draft) => {
              const id = await createSecret({
                societyId: society._id,
                actingUserId,
                name: String(draft.name ?? "SIN - funded employee"),
                service: "Employee SIN",
                credentialType: "Social Insurance Number",
                ownerRole: "Employer",
                custodianPersonName: draft.custodianPersonName ? String(draft.custodianPersonName) : undefined,
                custodianEmail: draft.custodianEmail ? String(draft.custodianEmail) : undefined,
                storageMode: draft.secretValue ? "stored_encrypted" : "external_reference",
                externalLocation: draft.externalLocation ? String(draft.externalLocation) : undefined,
                secretValue: draft.secretValue ? String(draft.secretValue) : undefined,
                revealPolicy: "owner_admin_custodian",
                status: "Active",
                sensitivity: "high",
                accessLevel: "restricted",
                sourceExternalIds: [`grant:${String(selectedGrant._id)}`],
                notes: draft.notes ? String(draft.notes) : undefined,
              });
              toast.success("SIN vault record created");
              return id;
            }}
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
              <Select value={txnDraft.grantId ?? ""} onChange={(value) => setTxnDraft({ ...txnDraft, grantId: value })}
                options={(grants ?? []).map((grant) => ({ value: grant._id, label: grant.title }))} />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Date"><DatePicker value={txnDraft.date ?? ""} onChange={(value) => setTxnDraft({ ...txnDraft, date: value })} /></Field>
              <Field label="Direction">
                <Select value={txnDraft.direction} onChange={(value) => setTxnDraft({ ...txnDraft, direction: value })}
                  options={[
                    { value: "inflow", label: "inflow" },
                    { value: "outflow", label: "outflow" },
                    { value: "commitment", label: "commitment" },
                    { value: "adjustment", label: "adjustment" },
                  ]} />
              </Field>
            </div>
            <Field label="Amount" hint="Dollars"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={txnDraft.amountDollars ?? ""} onChange={(e) => setTxnDraft({ ...txnDraft, amountDollars: e.target.value })} /></Field>
            <Field label="Description"><input className="input" value={txnDraft.description ?? ""} onChange={(e) => setTxnDraft({ ...txnDraft, description: e.target.value })} /></Field>
            <Field label="Evidence document">
              <Select value={txnDraft.documentId ?? ""} onChange={(value) => setTxnDraft({ ...txnDraft, documentId: value })}
                options={[{ value: "", label: "None" }, ...(documents ?? []).map((document) => ({ value: document._id, label: document.title }))]} />
            </Field>
            <Field label="Notes"><MarkdownEditor rows={4} value={txnDraft.notes ?? ""} onChange={(markdown) => setTxnDraft({ ...txnDraft, notes: markdown })} /></Field>
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
              <Select value={reportDraft.grantId ?? ""} onChange={(value) => setReportDraft({ ...reportDraft, grantId: value })}
                options={(grants ?? []).map((grant) => ({ value: grant._id, label: grant.title }))} />
            </Field>
            <Field label="Title"><input className="input" value={reportDraft.title} onChange={(e) => setReportDraft({ ...reportDraft, title: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Status">
                <Select value={reportDraft.status} onChange={(value) => setReportDraft({ ...reportDraft, status: value })}
                  options={[
                    { value: "Upcoming", label: "Upcoming" },
                    { value: "Due", label: "Due" },
                    { value: "Submitted", label: "Submitted" },
                    { value: "Overdue", label: "Overdue" },
                  ]} />
              </Field>
              <Field label="Due"><DatePicker value={reportDraft.dueAtISO ?? ""} onChange={(value) => setReportDraft({ ...reportDraft, dueAtISO: value })} /></Field>
            </div>
            <Field label="Submitted"><DatePicker value={reportDraft.submittedAtISO ?? ""} onChange={(value) => setReportDraft({ ...reportDraft, submittedAtISO: value })} /></Field>
            <Field label="Spending to date" hint="Dollars"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={reportDraft.spendingToDateDollars ?? ""} onChange={(e) => setReportDraft({ ...reportDraft, spendingToDateDollars: e.target.value })} /></Field>
            <Field label="Outcome summary"><MarkdownEditor rows={4} value={reportDraft.outcomeSummary ?? ""} onChange={(markdown) => setReportDraft({ ...reportDraft, outcomeSummary: markdown })} /></Field>
            <Field label="Report document">
              <Select value={reportDraft.documentId ?? ""} onChange={(value) => setReportDraft({ ...reportDraft, documentId: value })}
                options={[{ value: "", label: "None" }, ...(documents ?? []).map((document) => ({ value: document._id, label: document.title }))]} />
            </Field>
            <Field label="Notes"><MarkdownEditor rows={4} value={reportDraft.notes ?? ""} onChange={(markdown) => setReportDraft({ ...reportDraft, notes: markdown })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
