import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
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
import { GrantSourceLibrarySection } from "../features/grants/components/GrantSourceLibrary";
import { enrichGcosNormalizedGrant, readGcosExportFile } from "../lib/gcosExportImport";

export function GrantsPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const [selectedGrant, setSelectedGrant] = useState<any | null>(null);
  const [grantDraft, setGrantDraft] = useState<any | null>(null);
  const [reportDraft, setReportDraft] = useState<any | null>(null);
  const [txnDraft, setTxnDraft] = useState<any | null>(null);
  const [loadLowerSections, setLoadLowerSections] = useState(false);
  const [loadSupportData, setLoadSupportData] = useState(false);
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
  const sourceLibrary = useQuery(
    api.grantSources.listWithLibrary,
    society ? { societyId: society._id } : "skip",
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
            <label className="btn-action" style={{ cursor: "pointer" }}>
              <Upload size={12} /> Import GCOS
              <input
                type="file"
                accept="application/json,application/zip,.json,.zip"
                onChange={(event) => {
                  void importGcosGrantFile(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
                style={{ display: "none" }}
              />
            </label>
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

      <GrantSourceLibrarySection
        actingUserId={actingUserId}
        societyId={society._id}
        sourceLibrary={sourceLibrary}
      />

      <div className="spacer-6" />

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
          (row) => (row.nextSteps ?? []).map((step: any) => [step.label, step.status, step.reason].filter(Boolean).join(" ")).join(" "),
          (row) => row.nextAction,
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
            id: "nextAction",
            header: "Next action",
            sortable: true,
            accessor: (row) => row.nextAction ?? "",
            render: (row) => row.nextAction ? <span>{row.nextAction}</span> : <span className="muted">—</span>,
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
        loading={loadLowerSections && reports === undefined}
        rowKey={(row) => String(row._id)}
        searchPlaceholder="Search grant reports…"
        defaultSort={{ columnId: "dueAtISO", dir: "asc" }}
        viewsKey="grant-reports"
        sharedViewsContext={{ societyId: society._id, nameSingular: "grant" }}
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
  return <GrantWorkspacePage />;
}

function GrantWorkspacePage({ initialEditing = false }: { initialEditing?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
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
  const employees = useQuery(
    api.employees.list,
    society ? { societyId: society._id } : "skip",
  );
  const employeeLinks = useQuery(
    api.grants.employeeLinks,
    society ? { societyId: society._id, grantId: id } : "skip",
  );
  const secretVaultItems = useQuery(
    api.secrets.list,
    society ? { societyId: society._id } : "skip",
  );
  const upsertEmployeeLink = useMutation(api.grants.upsertEmployeeLink);
  const removeEmployeeLink = useMutation(api.grants.removeEmployeeLink);
  const createEmployee = useMutation(api.employees.create);
  const createPendingEmail = useMutation(api.pendingEmails.create);
  const createSecret = useMutation(api.secrets.create);
  const upsertGrant = useMutation(api.grants.upsertGrant);
  const [editing, setEditing] = useState(initialEditing);
  const [grantDraft, setGrantDraft] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!grant) return;
    setGrantDraft((current) => current?.id === grant._id ? current : grantToDraft(grant));
  }, [grant?._id]);

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
  const accountById = new Map<string, any>((accounts ?? []).map((row) => [String(row._id), row]));

  const startEditing = () => {
    setGrantDraft(grantToDraft(grant));
    setEditing(true);
  };

  const cancelEditing = () => {
    setGrantDraft(grantToDraft(grant));
    setEditing(false);
  };

  const saveGrant = async () => {
    if (!grantDraft) return;
    setSaving(true);
    try {
      await upsertGrant(buildGrantPayload(grantDraft, society._id, actingUserId));
      toast.success("Grant saved");
      setEditing(false);
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
        title={grant.title}
        icon={<BadgeDollarSign size={16} />}
        iconColor="green"
        subtitle={editing ? "Editing grant workspace details, format library, evidence, and source data." : `${grant.funder}${grant.program ? ` · ${grant.program}` : ""}`}
        actions={
          editing ? (
            <>
              <button className="btn-action" onClick={cancelEditing} disabled={saving}>Cancel</button>
              <button className="btn-action btn-action--primary" onClick={saveGrant} disabled={saving}>
                <Save size={12} /> {saving ? "Saving…" : "Save changes"}
              </button>
            </>
          ) : (
            <button className="btn-action btn-action--primary" onClick={startEditing}>
              <Pencil size={12} /> Edit workspace
            </button>
          )
        }
      />

      {editing && grantDraft ? (
        <>
          <GrantReadPanel
            grant={grantDraft}
            documents={documents ?? []}
            reports={reports ?? []}
            employees={employees ?? []}
            employeeLinks={employeeLinks ?? []}
            secretVaultItems={secretVaultItems ?? []}
            committee={committee}
            owner={owner}
            account={account}
            viewMode="page"
            editable
            onLinkEmployee={async (employeeId, patch = {}) => {
              await upsertEmployeeLink({
                societyId: society._id,
                grantId: grant._id,
                employeeId,
                patch: { status: "eed_pending", source: "manual", ...patch },
                actingUserId,
              });
            }}
            onUnlinkEmployee={async (linkId) => {
              await removeEmployeeLink({ id: linkId, actingUserId });
            }}
            onCreateEmployee={async (draft) => {
              return createEmployee({
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
            }}
            onQueueEmployeeOrientationEmail={async (employee, currentGrant) => {
              await createPendingEmail({
                societyId: society._id,
                nodeKey: "csj_remote_worker_orientation.queue_orientation_email",
                fromName: "Over the Edge",
                fromEmail: "ote@unbc.ca",
                to: String(employee.email ?? ""),
                subject: "Canada Summer Jobs remote work orientation resources",
                body: buildCsjOrientationEmailBody(employee),
                status: "ready",
                notes: `System workflow: CSJ remote worker orientation. Grant: ${currentGrant.title}. Evidence for GCOS Young Workers/EED attestation.`,
                actingUserId,
              });
            }}
            onCreateSinVaultRecord={async (draft) => {
              return createSecret({
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
                sourceExternalIds: [`grant:${String(grant._id)}`],
                notes: draft.notes ? String(draft.notes) : undefined,
              });
            }}
            editorPanel={
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
            }
          />
        </>
      ) : (
        <GrantReadPanel
          grant={grant}
          documents={documents ?? []}
          reports={reports ?? []}
          employees={employees ?? []}
          employeeLinks={employeeLinks ?? []}
          secretVaultItems={secretVaultItems ?? []}
          committee={committee}
          owner={owner}
          account={account}
          viewMode="page"
          onLinkEmployee={async (employeeId, patch = {}) => {
            await upsertEmployeeLink({
              societyId: society._id,
              grantId: grant._id,
              employeeId,
              patch: { status: "eed_pending", source: "manual", ...patch },
              actingUserId,
            });
          }}
          onUnlinkEmployee={async (linkId) => {
            await removeEmployeeLink({ id: linkId, actingUserId });
          }}
          onCreateEmployee={async (draft) => {
            return createEmployee({
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
          }}
          onQueueEmployeeOrientationEmail={async (employee, currentGrant) => {
            await createPendingEmail({
              societyId: society._id,
              nodeKey: "csj_remote_worker_orientation.queue_orientation_email",
              fromName: "Over the Edge",
              fromEmail: "ote@unbc.ca",
              to: String(employee.email ?? ""),
              subject: "Canada Summer Jobs remote work orientation resources",
              body: buildCsjOrientationEmailBody(employee),
              status: "ready",
              notes: `System workflow: CSJ remote worker orientation. Grant: ${currentGrant.title}. Evidence for GCOS Young Workers/EED attestation.`,
              actingUserId,
            });
          }}
          onCreateSinVaultRecord={async (draft) => {
            return createSecret({
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
              sourceExternalIds: [`grant:${String(grant._id)}`],
              notes: draft.notes ? String(draft.notes) : undefined,
            });
          }}
        />
      )}
    </div>
  );
}

export function GrantEditPage() {
  return <GrantWorkspacePage initialEditing />;
}

function buildCsjOrientationEmailBody(employee: any) {
  const firstName = String(employee?.firstName ?? "").trim() || "there";
  return [
    `Hi ${firstName},`,
    "",
    "Thanks for completing the required documentation, no need to worry about the employee number, we will do that on our end. Since you'll be working primarily remotely, I've gathered some resources that we'll review during your virtual orientation in your first week.",
    "",
    "Young Workers Website",
    "Please review: https://www.ccohs.ca/youngworkers",
    "This covers your rights, health and safety basics, and workplace responsibilities.",
    "",
    "Virtual Health and Safety Orientation",
    "We'll conduct a video call orientation covering remote work safety:",
    "- Home Office Ergonomics: https://www.ccohs.ca/oshanswers/ergonomics/office",
    "- Digital Equipment Safety: We'll review proper setup for your computer, software access, and digital security.",
    "- Remote Emergency Procedures: Contact information, reporting protocols, and what to do in case of power/internet outages.",
    "- Remote Work Safety Checks: Tips for maintaining a safe home workspace.",
    "",
    "Remote Work and Employment Policies",
    "While we don't have formal written policies, we'll discuss expectations for remote work including:",
    "- Harassment Prevention: BC Human Rights Code basics: https://www2.gov.bc.ca/gov/content/justice/human-rights",
    "- Digital Communication Guidelines: Professional expectations for email, messaging, and video calls.",
    "- Conflict Resolution: Virtual open-door policy and how to raise concerns remotely.",
    "- Privacy and Confidentiality: Protecting organizational data when working from home.",
    "- Work Hours and Boundaries: Setting healthy remote work practices.",
    "",
    "BC Employment Standards for Remote Workers",
    "Review your rights: https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards",
    "",
    "Additional Remote Work Resources",
    "- Health tips for remote workers: https://www.ccohs.ca/oshanswers/hsprograms/telework.html",
    "- WorkSafeBC remote work guidelines: https://www.worksafebc.com/en/resources/health-safety/information-sheets/working-from-home-guide-keeping-workers-healthy-safe?lang=en",
    "",
    "Please review these resources before our virtual orientation meeting.",
    "",
    "Looking forward to having you join our team!",
    "",
    "Best regards,",
    "",
    "Ahmad Jalil",
  ].join("\n");
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
