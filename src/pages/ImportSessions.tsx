import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field, InspectorNote } from "../components/ui";
import { Segmented } from "../components/primitives";
import { useToast } from "../components/Toast";
import { ImportWizard } from "../components/ImportWizard";
import { Select } from "../components/Select";
import {
  Archive,
  Check,
  FileJson,
  FileText,
  FolderOpen,
  History,
  ListChecks,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from "lucide-react";

type FilterStatus = "all" | "Pending" | "Approved" | "Rejected" | "risk";
type SessionTrack = "active" | "completed";

const STATUS_ITEMS: { id: FilterStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "Pending", label: "Pending" },
  { id: "Approved", label: "Approved" },
  { id: "Rejected", label: "Rejected" },
  { id: "risk", label: "Review flags" },
];

const KIND_LABELS: Record<string, string> = {
  source: "Source",
  fact: "Fact",
  event: "Event",
  boardTerm: "Role",
  motion: "Motion",
  meetingMinutes: "Minutes",
  budget: "Budget",
  documentCandidate: "Document",
  filing: "Filing",
  deadline: "Deadline",
  bylawAmendment: "Bylaw amendment",
  publication: "Publication",
  insurancePolicy: "Insurance",
  financialStatement: "Financial",
  financialStatementImport: "Financial import",
  grant: "Grant",
  recordsLocation: "Records",
  archiveAccession: "Archive",
  boardRoleAssignment: "Role assignment",
  boardRoleChange: "Role change",
  signingAuthority: "Signing",
  meetingAttendance: "Attendance",
  motionEvidence: "Motion evidence",
  budgetSnapshot: "Budget snapshot",
  treasurerReport: "Treasurer report",
  transactionCandidate: "Transaction",
  organizationAddress: "Org address",
  organizationRegistration: "Registration",
  organizationIdentifier: "Identifier",
  policy: "Policy",
  workflowPackage: "Workflow package",
  minuteBookItem: "Minute book",
  legalTemplateDataField: "Template field",
  legalTemplate: "Legal template",
  legalPrecedent: "Legal precedent",
  legalPrecedentRun: "Precedent run",
  generatedLegalDocument: "Generated document",
  legalSigner: "Legal signer",
  sourceEvidence: "Evidence",
  secretVaultItem: "Access custody",
  pipaTraining: "PIPA",
  employee: "Employee",
  volunteer: "Volunteer",
};

export function ImportSessionsPage() {
  const society = useSociety();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const requestedSessionId = searchParams.get("sessionId");
  const sourceFilter = searchParams.get("source");
  const sessions = useQuery(api.importSessions.list, society ? { societyId: society._id } : "skip");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sessionTrack, setSessionTrack] = useState<SessionTrack>("active");
  const sourceFilteredSessions = useMemo(() => {
    const rows = sessions ?? [];
    const query = sourceFilter?.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((session: any) =>
      [
        session.name,
        session.sourceSystem,
        session.metadata?.sourceSystem,
        session.metadata?.importedFrom,
        session.metadata?.createdFrom,
      ].join(" ").toLowerCase().includes(query),
    );
  }, [sessions, sourceFilter]);
  const activeSessions = useMemo(() => sourceFilteredSessions.filter(isActiveImportSession), [sourceFilteredSessions]);
  const completedSessions = useMemo(() => sourceFilteredSessions.filter((session: any) => !isActiveImportSession(session)), [sourceFilteredSessions]);
  const visibleSessions = sessionTrack === "active" ? activeSessions : completedSessions;
  const selectedVisible = selectedId ? visibleSessions.some((session: any) => session._id === selectedId) : false;
  const activeSessionId = selectedVisible ? selectedId : visibleSessions[0]?._id ?? null;
  const detail = useQuery(api.importSessions.get, activeSessionId ? { sessionId: activeSessionId } : "skip");

  const createSession = useMutation(api.importSessions.createFromBundle);
  const createMember = useMutation(api.members.create);
  const updateRecord = useMutation(api.importSessions.updateRecord);
  const bulkSetStatus = useMutation(api.importSessions.bulkSetStatus);
  const removeSession = useMutation(api.importSessions.removeSession);
  const applyToOrgHistory = useMutation(api.importSessions.applyApprovedToOrgHistory);
  const applyMeetings = useMutation(api.importSessions.applyApprovedMeetings);
  const backfillMeetings = useMutation(api.importSessions.backfillApprovedMeetingReferences);
  const applyDocuments = useMutation(api.importSessions.applyApprovedDocuments);
  const applySections = useMutation(api.importSessions.applyApprovedSectionRecords);
  const scanPaperlessMeetings = useAction(api.paperless.createMeetingMinutesImportSession);
  const scanPaperlessDiscovery = useAction(api.paperless.createDiscoveryImportSession);
  const scanPaperlessTransposed = useAction(api.paperless.createTransposedImportSession);

  const [createOpen, setCreateOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [createName, setCreateName] = useState("Paperless import");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [targetFilter, setTargetFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [recordForm, setRecordForm] = useState<any | null>(null);
  const [paperlessQuery, setPaperlessQuery] = useState("meeting minutes");
  const [paperlessLimit, setPaperlessLimit] = useState(500);
  const [paperlessBusy, setPaperlessBusy] = useState(false);
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [discoveryLimit, setDiscoveryLimit] = useState(1179);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [transposeQuery, setTransposeQuery] = useState("");
  const [transposeLimit, setTransposeLimit] = useState(1179);
  const [transposeBusy, setTransposeBusy] = useState(false);

  useEffect(() => {
    if (!requestedSessionId) return;
    setSelectedId(requestedSessionId);
    setSessionTrack("active");
  }, [requestedSessionId]);

  useEffect(() => {
    if (!requestedSessionId || sessions === undefined) return;
    const requested = sessions.find((session: any) => session._id === requestedSessionId);
    if (requested && !isActiveImportSession(requested)) {
      setSessionTrack("completed");
    }
  }, [requestedSessionId, sessions]);

  const records = detail?.records ?? [];
  const session = detail?.session ?? null;
  const kinds = useMemo<string[]>(() => {
    return Array.from(new Set<string>(records.map((record: any) => String(record.recordKind)))).sort();
  }, [records]);
  const targets = useMemo<string[]>(() => {
    return Array.from(new Set<string>(records.map((record: any) => String(record.targetModule)))).sort();
  }, [records]);
  const filteredRecords = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return records.filter((record: any) => {
      const statusMatch =
        statusFilter === "all" ||
        (statusFilter === "risk" ? (record.riskFlags ?? []).length > 0 : record.status === statusFilter);
      const kindMatch = kindFilter === "all" || record.recordKind === kindFilter;
      const targetMatch = targetFilter === "all" || record.targetModule === targetFilter;
      const searchMatch = !query || [
        record.title,
        record.description,
        record.targetModule,
        record.recordKind,
        record.payload?.insurer,
        record.payload?.broker,
        record.payload?.policyNumber,
        record.payload?.policySeriesKey,
        record.payload?.policyTermLabel,
        record.payload?.versionType,
        record.payload?.importReadiness,
        record.payload?.visualReviewStatus,
        ...(record.sourceExternalIds ?? []),
        ...(record.riskFlags ?? []),
        ...(Array.isArray(record.payload?.tags) ? record.payload.tags : []),
      ].join(" ").toLowerCase().includes(query);
      return statusMatch && kindMatch && targetMatch && searchMatch;
    });
  }, [records, statusFilter, kindFilter, targetFilter, searchText]);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const createFromJson = async () => {
    try {
      const parsed = JSON.parse(importText);
      const sessionId = await createSession({
        societyId: society._id,
        name: createName,
        bundle: parsed,
      });
      setSelectedId(sessionId);
      setImportText("");
      setImportError("");
      setCreateOpen(false);
      toast.success("Import session created", createName);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not create session");
    }
  };

  const setRecordStatus = async (record: any, status: "Pending" | "Approved" | "Rejected") => {
    try {
      await updateRecord({ recordId: record._id, status });
      toast.success(`Record ${status.toLowerCase()}`, record.title);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not update import record");
    }
  };

  const bulkStatus = async (status: "Approved" | "Rejected" | "Pending") => {
    if (!session) return;
    try {
      const result = await bulkSetStatus({
        sessionId: session._id,
        status,
        recordIds: filteredRecords.map((record: any) => record._id),
      });
      toast.success(`${result.updated} records updated`, status);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not bulk-update import records");
    }
  };

  const approveImportReadyInsurance = async () => {
    if (!session) return;
    const insuranceRecords = records.filter(isImportReadyInsuranceRecord);
    try {
      const result = await bulkSetStatus({
        sessionId: session._id,
        status: "Approved",
        recordIds: insuranceRecords.map((record: any) => record._id),
      });
      setKindFilter("insurancePolicy");
      setStatusFilter("Approved");
      toast.success(`${result.updated} insurance records approved`, "Apply sections when ready to publish them to Insurance");
    } catch (error: any) {
      toast.error(error?.message ?? "Could not approve insurance records");
    }
  };

  const runOrgHistoryApply = async () => {
    if (!session) return;
    try {
      const result = await applyToOrgHistory({ sessionId: session._id });
      toast.success("Approved records applied", `${result.sources} source records, ${result.items} history records`);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not apply org history imports");
    }
  };

  const runMeetingApply = async () => {
    if (!session) return;
    try {
      const result = await applyMeetings({ sessionId: session._id });
      toast.success("Meeting drafts created", `${result.meetings} meetings, ${result.motions} motions${result.existing ? `, ${result.existing} already existed` : ""}`);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not create meeting drafts");
    }
  };

  const runMeetingBackfill = async () => {
    if (!session) return;
    try {
      const result = await backfillMeetings({ sessionId: session._id });
      toast.success("Meeting references refreshed", `${result.meetings} meetings, ${result.minutes} minutes, ${result.documents} source links`);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not refresh meeting references");
    }
  };

  const runDocumentApply = async () => {
    if (!session) return;
    try {
      const result = await applyDocuments({ sessionId: session._id });
      toast.success("Document candidates created", `${result.documents} metadata records`);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not create document candidates");
    }
  };

  const runSectionApply = async () => {
    if (!session) return;
    try {
      const result = await applySections({ sessionId: session._id });
      const byKind = Object.entries(result.byKind ?? {})
        .map(([kind, count]) => `${count} ${kind}`)
        .join(", ");
      toast.success("Section records applied", byKind || `${result.total} records`);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not apply section imports");
    }
  };

  const deleteSession = async () => {
    if (!session) return;
    try {
      await removeSession({ sessionId: session._id });
      setSelectedId(null);
      toast.success("Import session removed", session.name);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not remove import session");
    }
  };

  const runPaperlessMeetingScan = async () => {
    if (!society || paperlessBusy) return;
    setPaperlessBusy(true);
    try {
      const result = await scanPaperlessMeetings({
        societyId: society._id,
        query: paperlessQuery.trim() || undefined,
        maxDocuments: paperlessLimit,
      });
      setSelectedId(result.sessionId);
      toast.success("Paperless meeting scan staged", `${result.candidateDocuments} candidate docs, ${result.meetingMinutes} meeting records`);
    } catch (error: any) {
      toast.error(error?.message ?? "Paperless meeting scan failed");
    } finally {
      setPaperlessBusy(false);
    }
  };

  const runPaperlessDiscoveryScan = async () => {
    if (!society || discoveryBusy) return;
    setDiscoveryBusy(true);
    try {
      const result = await scanPaperlessDiscovery({
        societyId: society._id,
        query: discoveryQuery.trim() || undefined,
        maxDocuments: discoveryLimit,
      });
      setSelectedId(result.sessionId);
      toast.success("Paperless discovery staged", `${result.candidateDocuments} candidates from ${result.scannedDocuments} documents`);
    } catch (error: any) {
      toast.error(error?.message ?? "Paperless discovery scan failed");
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const runPaperlessTransposeScan = async () => {
    if (!society || transposeBusy) return;
    setTransposeBusy(true);
    try {
      const result = await scanPaperlessTransposed({
        societyId: society._id,
        query: transposeQuery.trim() || undefined,
        maxDocuments: transposeLimit,
      });
      setSelectedId(result.sessionId);
      toast.success("Paperless transposition staged", `${result.sources} sources from ${result.scannedDocuments} documents`);
    } catch (error: any) {
      toast.error(error?.message ?? "Paperless transposition failed");
    } finally {
      setTransposeBusy(false);
    }
  };

  return (
    <div className="page import-sessions-page">
      <PageHeader
        title="Import sessions"
        icon={<FileJson size={16} />}
        iconColor="purple"
        subtitle="Stage converted Paperless records, review each item, then apply approved records into app modules."
        actions={
          <>
          <button className="btn-action" onClick={() => setCsvOpen(true)}>
            <Upload size={12} /> Import members CSV
          </button>
          <button className="btn-action btn-action--primary" onClick={() => setCreateOpen(true)}>
            <Plus size={12} /> New session
          </button>
          </>
        }
      />

      <ImportWizard
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        target={{
          id: "members",
          label: "Members",
          fields: [
            { id: "firstName", label: "First name", required: true },
            { id: "lastName", label: "Last name", required: true },
            { id: "email", label: "Email", validate: (v) => (/.+@.+\..+/.test(v) ? null : "Not an email") },
            { id: "phone", label: "Phone" },
            { id: "membershipClass", label: "Class" },
            { id: "status", label: "Status" },
            { id: "joinedAt", label: "Joined (YYYY-MM-DD)" },
          ],
          onImportRow: async (row) => {
            await createMember({
              societyId: society._id,
              firstName: row.firstName,
              lastName: row.lastName,
              email: row.email || undefined,
              phone: row.phone || undefined,
              membershipClass: row.membershipClass || "Regular",
              status: row.status || "Active",
              joinedAt: row.joinedAt || new Date().toISOString().slice(0, 10),
              votingRights: true,
            });
          },
        }}
      />

      <div className="stat-grid import-sessions-page__stats">
        <Stat label="Active" value={String(activeSessions.length)} icon={<ListChecks size={14} />} sub="pending or not yet applied" />
        <Stat label="Completed" value={String(completedSessions.length)} icon={<Archive size={14} />} sub="hidden from active track" />
        <Stat label="Candidates" value={String(session?.summary?.total ?? 0)} icon={<ListChecks size={14} />} sub="records in selected session" />
        <Stat label="Review flags" value={String(session?.summary?.riskCount ?? 0)} icon={<ShieldAlert size={14} />} sub="restricted, OCR, or cleanup risks" />
      </div>

      {sourceFilter && (
        <InspectorNote tone="info" title="Filtered import sessions">
          Showing sessions matching <span className="mono">{sourceFilter}</span>.
        </InspectorNote>
      )}

      <div className="import-scan-grid">
        <div className="card import-scan-card">
          <div className="card__head import-scan-card__head">
            <div>
              <h2 className="card__title">Paperless meeting scan</h2>
              <p className="card__subtitle">Creates a review session from live Paperless meeting-minute documents.</p>
            </div>
            <button className="btn-action btn-action--primary" disabled={paperlessBusy} onClick={runPaperlessMeetingScan}>
              <FileText size={12} /> {paperlessBusy ? "Scanning..." : "Scan minutes"}
            </button>
          </div>
          <div className="card__body import-scan-card__fields">
            <Field label="Search query">
              <input className="input" value={paperlessQuery} onChange={(event) => setPaperlessQuery(event.target.value)} />
            </Field>
            <Field label="Max documents">
              <input className="input" type="number" min={1} max={1179} value={paperlessLimit} onChange={(event) => setPaperlessLimit(Number(event.target.value) || 1)} />
            </Field>
          </div>
        </div>

        <div className="card import-scan-card">
          <div className="card__head import-scan-card__head">
            <div>
              <h2 className="card__title">Paperless expanded discovery</h2>
              <p className="card__subtitle">Creates a review session across app sections with source evidence, risk flags, and target modules.</p>
            </div>
            <button className="btn-action btn-action--primary" disabled={discoveryBusy} onClick={runPaperlessDiscoveryScan}>
              <Archive size={12} /> {discoveryBusy ? "Scanning..." : "Scan sections"}
            </button>
          </div>
          <div className="card__body import-scan-card__fields">
            <Field label="Search query" hint="Leave blank to scan broadly across Paperless.">
              <input className="input" value={discoveryQuery} onChange={(event) => setDiscoveryQuery(event.target.value)} placeholder="budget, annual report, policy..." />
            </Field>
            <Field label="Max documents">
              <input className="input" type="number" min={1} max={1179} value={discoveryLimit} onChange={(event) => setDiscoveryLimit(Number(event.target.value) || 1)} />
            </Field>
          </div>
        </div>

        <div className="card import-scan-card">
          <div className="card__head import-scan-card__head">
            <div>
              <h2 className="card__title">Paperless transposition</h2>
              <p className="card__subtitle">Reads Paperless OCR into section-native review records for filings, deadlines, publications, insurance, grants, records, HR, volunteers, and privacy training.</p>
            </div>
            <button className="btn-action btn-action--primary" disabled={transposeBusy} onClick={runPaperlessTransposeScan}>
              <Archive size={12} /> {transposeBusy ? "Transposing..." : "Transpose records"}
            </button>
          </div>
          <div className="card__body import-scan-card__fields">
            <Field label="Search query" hint="Leave blank to transpose broadly across Paperless OCR.">
              <input className="input" value={transposeQuery} onChange={(event) => setTransposeQuery(event.target.value)} placeholder="insurance, filings, issue, grant..." />
            </Field>
            <Field label="Max documents">
              <input className="input" type="number" min={1} max={1179} value={transposeLimit} onChange={(event) => setTransposeLimit(Number(event.target.value) || 1)} />
            </Field>
          </div>
        </div>
      </div>

      <div className="import-review-layout">
        <div className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Sessions</h2>
              <p className="card__subtitle">
                {sessionTrack === "active"
                  ? "Batches that still need review or apply steps."
                  : "Finished, rejected, or empty batches kept for audit trail."}
              </p>
            </div>
          </div>
          <div className="card__body import-session-track">
            <Segmented<SessionTrack>
              value={sessionTrack}
              onChange={(next) => {
                setSessionTrack(next);
                setSelectedId(null);
              }}
              items={[
                { id: "active", label: `Active (${activeSessions.length})` },
                { id: "completed", label: `Completed (${completedSessions.length})` },
              ]}
            />
          </div>
          <div className="card__body col" style={{ gap: 8 }}>
            {visibleSessions.map((item: any) => (
              <button
                key={item._id}
                className={`import-session-row${item._id === activeSessionId ? " is-active" : ""}`}
                onClick={() => setSelectedId(item._id)}
              >
                <span>
                  <strong>{item.name}</strong>
                  <span className="muted">{item.sourceSystem}</span>
                </span>
                <span className="import-session-row__counts">
                  <Badge tone="info">{item.summary.total}</Badge>
                  {(item.summary.byStatus?.Pending ?? 0) > 0 && <Badge tone="warn">{item.summary.byStatus.Pending} pending</Badge>}
                  {isCompletedImportSession(item) && <Badge tone="success">Complete</Badge>}
                  {(item.summary.riskCount ?? 0) > 0 && <Badge tone="warn">{item.summary.riskCount} flags</Badge>}
                </span>
              </button>
            ))}
            {sessions?.length === 0 && (
              <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                No import sessions yet.
              </div>
            )}
            {(sessions?.length ?? 0) > 0 && visibleSessions.length === 0 && (
              <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                {sourceFilter
                  ? `No ${sessionTrack} import sessions match ${sourceFilter}.`
                  : sessionTrack === "active"
                  ? "No active import sessions. Completed batches are archived in the Completed track."
                  : "No completed import sessions yet."}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card__head import-review-head">
            <div className="import-review-heading">
              <h2 className="card__title">{session?.name ?? "No session selected"}</h2>
              {session && <p className="card__subtitle">{session.sourceSystem}</p>}
            </div>
            {session && (
              <div className="import-review-actions">
                <button className="btn-action" onClick={runOrgHistoryApply}>
                  <History size={12} /> Apply history
                </button>
                <button className="btn-action" onClick={runMeetingApply}>
                  <FileText size={12} /> Create minutes
                </button>
                <button className="btn-action" onClick={runMeetingBackfill}>
                  <History size={12} /> Refresh links
                </button>
                <button className="btn-action" onClick={runDocumentApply}>
                  <FolderOpen size={12} /> Create docs
                </button>
                <button className="btn-action" onClick={runSectionApply}>
                  <Archive size={12} /> Apply sections
                </button>
                <button className="btn-action" onClick={deleteSession}>
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            )}
          </div>
          {session ? (
            <>
              <div className="card__body col" style={{ gap: 12 }}>
                {session.qualitySummary && (
                  <InspectorNote title="Quality gates">
                    {session.qualitySummary.importBlockers ?? 0} import blockers, {session.qualitySummary.badDateDocuments ?? 0} bad-date documents, and {session.qualitySummary.sensitiveDocuments ?? 0} sensitive documents were reported in the source bundle.
                  </InspectorNote>
                )}
                <InsuranceImportReviewPanel
                  records={records}
                  onShow={() => {
                    setKindFilter("insurancePolicy");
                    setStatusFilter("all");
                    setSearchText("");
                  }}
                  onApproveReady={approveImportReadyInsurance}
                />
                <div className="import-review-filters">
                  <Segmented value={statusFilter} onChange={setStatusFilter} items={STATUS_ITEMS} />
                  <Select value={kindFilter} onChange={value => setKindFilter(value)} options={[{
  value: "all",
  label: "All record types"
}, ...kinds.map(kind => ({
  value: kind,
  label: KIND_LABELS[kind] ?? kind
}))]} className="input import-review-filter-select" />
                  <Select value={targetFilter} onChange={value => setTargetFilter(value)} options={[{
  value: "all",
  label: "All targets"
}, ...targets.map(target => ({
  value: target,
  label: target
}))]} className="input import-review-filter-select" />
                  <input
                    className="input import-review-search"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="Search title, source, tag..."
                  />
                  <div className="import-review-bulk-actions">
                    <button className="btn-action" onClick={() => bulkStatus("Approved")}>
                      <Check size={12} /> Approve visible
                    </button>
                    <button className="btn-action" onClick={() => bulkStatus("Rejected")}>
                      <X size={12} /> Reject visible
                    </button>
                  </div>
                </div>
              </div>

              <div className="table-wrap">
                <table className="table import-review-table">
                  <thead>
                    <tr>
                      <th>Record</th>
                      <th>Type</th>
                      <th>Target</th>
                      <th>Status</th>
                      <th>Flags</th>
                      <th>Applied</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.map((record: any) => (
                      <tr key={record._id}>
                        <td>
                          <strong>{record.title}</strong>
                          {record.description && <div className="muted clamp-2">{record.description}</div>}
                          {record.recordKind === "insurancePolicy" && <InsuranceRecordSummary record={record} />}
                          {(record.sourceExternalIds ?? []).length > 0 && (
                            <div className="mono muted" style={{ fontSize: 11 }}>
                              {record.sourceExternalIds.slice(0, 3).join(", ")}
                              {record.sourceExternalIds.length > 3 ? ` +${record.sourceExternalIds.length - 3}` : ""}
                            </div>
                          )}
                        </td>
                        <td><Badge tone="info">{KIND_LABELS[record.recordKind] ?? record.recordKind}</Badge></td>
                        <td>{record.targetModule}</td>
                        <td><StatusBadge status={record.status} /></td>
                        <td>
                          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                            <ConfidenceBadge confidence={record.confidence} />
                            {(record.riskFlags ?? []).map((flag: string) => (
                              <Badge key={flag} tone={flag === "restricted" ? "danger" : "warn"}>{flag}</Badge>
                            ))}
                          </div>
                        </td>
                        <td>
                          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                            {record.importedTargets?.orgHistory && <Badge tone="success">History</Badge>}
                            {record.importedTargets?.meetings && <Badge tone="success">Minutes</Badge>}
                            {record.importedTargets?.documents && <Badge tone="success">Documents</Badge>}
                            {record.importedTargets?.sections && <Badge tone="success">Sections</Badge>}
                            {!record.importedTargets?.orgHistory && !record.importedTargets?.meetings && !record.importedTargets?.documents && !record.importedTargets?.sections && <span className="muted">-</span>}
                          </div>
                        </td>
                        <td>
                          <div className="table__actions-inner" style={{ opacity: 1, visibility: "visible" }}>
                            <button className="btn btn--ghost btn--icon" title="Approve" onClick={() => setRecordStatus(record, "Approved")}>
                              <Check size={14} />
                            </button>
                            <button className="btn btn--ghost btn--icon" title="Reject" onClick={() => setRecordStatus(record, "Rejected")}>
                              <X size={14} />
                            </button>
                            <button className="btn btn--ghost btn--icon" title="Edit" onClick={() => setRecordForm(formFromRecord(record))}>
                              <Pencil size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="card__body">
              <InspectorNote title="Create a staged import">
                Paste an org-history import bundle or section-candidates bundle to start a review session.
              </InspectorNote>
            </div>
          )}
        </div>
      </div>

      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New import session"
        footer={
          <>
            <button className="btn" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={createFromJson}>
              <Upload size={14} /> Create session
            </button>
          </>
        }
      >
        <div className="col" style={{ gap: 12 }}>
          <Field label="Session name">
            <input className="input" value={createName} onChange={(event) => setCreateName(event.target.value)} />
          </Field>
          <Field label="Import JSON" hint="Accepts source, meeting, documentMap, and section-record bundles from Paperless, Office files, or reviewed JSON exports.">
            <textarea
              className="textarea"
              rows={18}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder='{"sources":[],"documentMap":[],"meetingMinutes":[],"budgetSnapshots":[],"transactionCandidates":[]}'
            />
          </Field>
          {importError && <Badge tone="danger">{importError}</Badge>}
        </div>
      </Drawer>

      <RecordDrawer
        form={recordForm}
        onClose={() => setRecordForm(null)}
        onChange={setRecordForm}
        onSave={async () => {
          try {
            const next = recordPayloadFromForm(recordForm);
            await updateRecord({
              recordId: recordForm._id,
              status: recordForm.status,
              reviewNotes: recordForm.reviewNotes,
              payload: next.payload,
              sourceExternalIds: next.sourceExternalIds,
            });
            setRecordForm(null);
            toast.success("Import record updated");
          } catch (error: any) {
            toast.error(error?.message ?? "Could not save import record");
          }
        }}
      />
    </div>
  );
}

function RecordDrawer({
  form,
  onClose,
  onChange,
  onSave,
}: {
  form: any | null;
  onClose: () => void;
  onChange: (form: any) => void;
  onSave: () => void;
}) {
  return (
    <Drawer
      open={Boolean(form)}
      onClose={onClose}
      title="Review import record"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={onSave}>Save review</button>
        </>
      }
    >
      {form && (
        <div className="col" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Review status">
              <Select value={form.status} onChange={value => onChange({
  ...form,
  status: value
})} options={[{
  value: "Pending",
  label: "Pending"
}, {
  value: "Approved",
  label: "Approved"
}, {
  value: "Rejected",
  label: "Rejected"
}]} className="input" />
            </Field>
            <Field label="Confidence">
              <Select value={form.payload.confidence ?? form.confidence ?? "Review"} onChange={value => updatePayload(form, onChange, {
  confidence: value
})} options={[{
  value: "High",
  label: "High"
}, {
  value: "Medium",
  label: "Medium"
}, {
  value: "Review",
  label: "Review"
}]} className="input" />
            </Field>
          </div>
          {renderPayloadEditor(form, onChange)}
          <Field label="Source external IDs" hint="Comma-separated Paperless, BC Registry, local, or external IDs used for provenance.">
            <input className="input" value={form.sourceExternalIdsText} onChange={(event) => onChange({ ...form, sourceExternalIdsText: event.target.value })} />
          </Field>
          <Field label="Review notes">
            <textarea className="textarea" rows={4} value={form.reviewNotes ?? ""} onChange={(event) => onChange({ ...form, reviewNotes: event.target.value })} />
          </Field>
        </div>
      )}
    </Drawer>
  );
}

function InsuranceImportReviewPanel({
  records,
  onShow,
  onApproveReady,
}: {
  records: any[];
  onShow: () => void;
  onApproveReady: () => void;
}) {
  const insurance = records.filter((record) => record.recordKind === "insurancePolicy");
  if (!insurance.length) return null;
  const ready = insurance.filter(isImportReadyInsuranceRecord);
  const approved = insurance.filter((record) => record.status === "Approved");
  const series = new Set(insurance.map((record) => record.payload?.policySeriesKey).filter(Boolean));
  return (
    <InspectorNote title="Insurance import review">
      <div className="col" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Badge tone="info">{insurance.length} policy version{insurance.length === 1 ? "" : "s"}</Badge>
          <Badge tone="success">{ready.length} import-ready</Badge>
          <Badge tone={approved.length === ready.length && ready.length > 0 ? "success" : "warn"}>{approved.length} approved</Badge>
          {series.size > 0 && <Badge>{series.size} policy series</Badge>}
        </div>
        <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          These records are deduped by policy series and term. Source/visual-review notes remain attached, and certificates/payment-option sources stay as evidence instead of duplicate policy rows.
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn-action" type="button" onClick={onShow}>
            <ListChecks size={12} /> Show insurance records
          </button>
          <button className="btn-action btn-action--primary" type="button" onClick={onApproveReady} disabled={!ready.length}>
            <Check size={12} /> Approve import-ready insurance
          </button>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {insurance.slice(0, 6).map((record) => (
            <InsuranceRecordSummary key={record._id} record={record} compact />
          ))}
        </div>
      </div>
    </InspectorNote>
  );
}

function InsuranceRecordSummary({ record, compact = false }: { record: any; compact?: boolean }) {
  const payload = record.payload ?? {};
  const term = payload.policyTermLabel || [payload.startDate, payload.endDate].filter(Boolean).join(" to ");
  const reviewed = payload.visualReviewStatus || payload.sourceReviewStatus;
  return (
    <div className={compact ? "muted" : ""} style={{ fontSize: compact ? "var(--fs-sm)" : 12, marginTop: compact ? 0 : 4 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <span className="mono">{payload.policyNumber || "Policy # not set"}</span>
        {payload.kind && <Badge tone="info">{insuranceKindLabel(payload.kind)}</Badge>}
        {term && <Badge>{term}</Badge>}
        {payload.versionType && <Badge>{payload.versionType}</Badge>}
        {payload.importReadiness && <Badge tone={payload.importReadiness === "Ready" ? "success" : "warn"}>{payload.importReadiness}</Badge>}
        {reviewed && <Badge tone="success">{reviewed}</Badge>}
      </div>
      {!compact && (
        <div className="muted">
          {[payload.insurer, payload.broker, payload.policySeriesKey && `series ${payload.policySeriesKey}`].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
}

function isImportReadyInsuranceRecord(record: any) {
  if (record.recordKind !== "insurancePolicy") return false;
  const payload = record.payload ?? {};
  return payload.importReadiness === "Ready" ||
    Boolean(payload.policySeriesKey && payload.policyTermLabel && payload.policyNumber && payload.policyNumber !== "Needs review" && payload.insurer && payload.insurer !== "Needs review");
}

function insuranceKindLabel(kind: string) {
  return ({
    DirectorsOfficers: "D&O",
    GeneralLiability: "CGL",
    PropertyCasualty: "Property",
    CyberLiability: "Cyber",
  } as Record<string, string>)[kind] ?? kind;
}

function renderPayloadEditor(form: any, onChange: (form: any) => void) {
  const payload = form.payload ?? {};
  const set = (patch: any) => updatePayload(form, onChange, patch);
  if (form.recordKind === "source") {
    return (
      <>
        <Field label="Title"><input className="input" value={payload.title ?? ""} onChange={(event) => set({ title: event.target.value })} /></Field>
        <div className="row" style={{ gap: 12 }}>
          <Field label="External ID"><input className="input" value={payload.externalId ?? ""} onChange={(event) => set({ externalId: event.target.value })} /></Field>
          <Field label="Source date"><input className="input" value={payload.sourceDate ?? ""} onChange={(event) => set({ sourceDate: event.target.value })} /></Field>
        </div>
        <Field label="Category"><input className="input" value={payload.category ?? ""} onChange={(event) => set({ category: event.target.value })} /></Field>
        <Field label="Notes"><textarea className="textarea" rows={5} value={payload.notes ?? ""} onChange={(event) => set({ notes: event.target.value })} /></Field>
      </>
    );
  }
  if (form.recordKind === "fact") {
    return (
      <>
        <Field label="Label"><input className="input" value={payload.label ?? ""} onChange={(event) => set({ label: event.target.value })} /></Field>
        <Field label="Value"><textarea className="textarea" rows={5} value={payload.value ?? ""} onChange={(event) => set({ value: event.target.value })} /></Field>
      </>
    );
  }
  if (form.recordKind === "event") {
    return (
      <>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Event date"><input className="input" value={payload.eventDate ?? ""} onChange={(event) => set({ eventDate: event.target.value })} /></Field>
          <Field label="Category"><input className="input" value={payload.category ?? ""} onChange={(event) => set({ category: event.target.value })} /></Field>
        </div>
        <Field label="Title"><input className="input" value={payload.title ?? ""} onChange={(event) => set({ title: event.target.value })} /></Field>
        <Field label="Summary"><textarea className="textarea" rows={5} value={payload.summary ?? ""} onChange={(event) => set({ summary: event.target.value })} /></Field>
      </>
    );
  }
  if (form.recordKind === "boardTerm") {
    return (
      <>
        <Field label="Person"><input className="input" value={payload.personName ?? ""} onChange={(event) => set({ personName: event.target.value })} /></Field>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Position"><input className="input" value={payload.position ?? ""} onChange={(event) => set({ position: event.target.value })} /></Field>
          <Field label="Committee or board"><input className="input" value={payload.committeeName ?? ""} onChange={(event) => set({ committeeName: event.target.value })} /></Field>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Start"><input className="input" value={payload.startDate ?? ""} onChange={(event) => set({ startDate: event.target.value })} /></Field>
          <Field label="End"><input className="input" value={payload.endDate ?? ""} onChange={(event) => set({ endDate: event.target.value })} /></Field>
        </div>
        <Field label="Change type"><input className="input" value={payload.changeType ?? ""} onChange={(event) => set({ changeType: event.target.value })} /></Field>
        <Field label="Notes"><textarea className="textarea" rows={4} value={payload.notes ?? ""} onChange={(event) => set({ notes: event.target.value })} /></Field>
      </>
    );
  }
  if (form.recordKind === "motion") {
    return (
      <>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Meeting date"><input className="input" value={payload.meetingDate ?? ""} onChange={(event) => set({ meetingDate: event.target.value })} /></Field>
          <Field label="Outcome"><input className="input" value={payload.outcome ?? ""} onChange={(event) => set({ outcome: event.target.value })} /></Field>
        </div>
        <Field label="Meeting title"><input className="input" value={payload.meetingTitle ?? ""} onChange={(event) => set({ meetingTitle: event.target.value })} /></Field>
        <Field label="Motion text"><textarea className="textarea" rows={5} value={payload.motionText ?? ""} onChange={(event) => set({ motionText: event.target.value })} /></Field>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Moved by"><input className="input" value={payload.movedByName ?? ""} onChange={(event) => set({ movedByName: event.target.value })} /></Field>
          <Field label="Seconded by"><input className="input" value={payload.secondedByName ?? ""} onChange={(event) => set({ secondedByName: event.target.value })} /></Field>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Field label="For"><input className="input" type="number" value={payload.votesFor ?? ""} onChange={(event) => set({ votesFor: numericInput(event.target.value) })} /></Field>
          <Field label="Against"><input className="input" type="number" value={payload.votesAgainst ?? ""} onChange={(event) => set({ votesAgainst: numericInput(event.target.value) })} /></Field>
          <Field label="Abstentions"><input className="input" type="number" value={payload.abstentions ?? ""} onChange={(event) => set({ abstentions: numericInput(event.target.value) })} /></Field>
        </div>
      </>
    );
  }
  if (form.recordKind === "budget") {
    return (
      <>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Fiscal year"><input className="input" value={payload.fiscalYear ?? ""} onChange={(event) => set({ fiscalYear: event.target.value })} /></Field>
          <Field label="Source date"><input className="input" value={payload.sourceDate ?? ""} onChange={(event) => set({ sourceDate: event.target.value })} /></Field>
        </div>
        <Field label="Title"><input className="input" value={payload.title ?? ""} onChange={(event) => set({ title: event.target.value })} /></Field>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Income cents"><input className="input" type="number" value={payload.totalIncomeCents ?? ""} onChange={(event) => set({ totalIncomeCents: numericInput(event.target.value) })} /></Field>
          <Field label="Expense cents"><input className="input" type="number" value={payload.totalExpenseCents ?? ""} onChange={(event) => set({ totalExpenseCents: numericInput(event.target.value) })} /></Field>
          <Field label="Net cents"><input className="input" type="number" value={payload.netCents ?? ""} onChange={(event) => set({ netCents: numericInput(event.target.value) })} /></Field>
        </div>
        <Field label="Budget lines JSON">
          <textarea className="textarea mono" rows={8} value={form.linesText} onChange={(event) => onChange({ ...form, linesText: event.target.value })} />
        </Field>
      </>
    );
  }
  if (form.recordKind === "bylawAmendment") {
    return (
      <>
        <Field label="Title"><input className="input" value={payload.title ?? ""} onChange={(event) => set({ title: event.target.value })} /></Field>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Status">
            <Select value={payload.status ?? "Draft"} onChange={value => set({
  status: value
})} options={[{
  value: "",
  label: "Draft"
}, {
  value: "",
  label: "Consultation"
}, {
  value: "",
  label: "ResolutionPassed"
}, {
  value: "",
  label: "Filed"
}, {
  value: "",
  label: "Withdrawn"
}, {
  value: "",
  label: "Superseded"
}]} className="input" />
          </Field>
          <Field label="Filed at">
            <input className="input" value={payload.filedAtISO ?? ""} onChange={(event) => set({ filedAtISO: event.target.value })} placeholder="YYYY-MM-DD or ISO date" />
          </Field>
          <Field label="Source date">
            <input className="input" value={payload.sourceDate ?? ""} onChange={(event) => set({ sourceDate: event.target.value })} placeholder="YYYY-MM-DD" />
          </Field>
        </div>
        <Field label="Base bylaws Markdown" hint="Prior full version used for the redline. Leave blank only for the first version.">
          <textarea className="textarea mono" rows={12} value={payload.baseText ?? ""} onChange={(event) => set({ baseText: event.target.value })} />
        </Field>
        <Field label="Proposed/current bylaws Markdown" hint="For filed history, this should be the full bylaws text after the amendment, not just the resolution excerpt.">
          <textarea className="textarea mono" rows={16} value={payload.proposedText ?? ""} onChange={(event) => set({ proposedText: event.target.value })} />
        </Field>
        <Field label="Notes">
          <textarea className="textarea" rows={4} value={payload.notes ?? ""} onChange={(event) => set({ notes: event.target.value })} />
        </Field>
      </>
    );
  }
  if (form.recordKind === "grant") {
    return (
      <>
        <Field label="Title"><input className="input" value={payload.title ?? ""} onChange={(event) => set({ title: event.target.value })} /></Field>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Funder"><input className="input" value={payload.funder ?? ""} onChange={(event) => set({ funder: event.target.value })} /></Field>
          <Field label="Program"><input className="input" value={payload.program ?? ""} onChange={(event) => set({ program: event.target.value })} /></Field>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Status">
            <Select value={payload.status ?? "Drafting"} onChange={value => set({
  status: value
})} options={[{
  value: "",
  label: "Prospecting"
}, {
  value: "",
  label: "Drafting"
}, {
  value: "",
  label: "Submitted"
}, {
  value: "",
  label: "Awarded"
}, {
  value: "",
  label: "Declined"
}, {
  value: "",
  label: "Active"
}, {
  value: "",
  label: "Closed"
}, {
  value: "",
  label: "NeedsReview"
}]} className="input" />
          </Field>
          <Field label="Requested cents"><input className="input" type="number" value={payload.amountRequestedCents ?? ""} onChange={(event) => set({ amountRequestedCents: numericInput(event.target.value) })} /></Field>
          <Field label="Awarded cents"><input className="input" type="number" value={payload.amountAwardedCents ?? ""} onChange={(event) => set({ amountAwardedCents: numericInput(event.target.value) })} /></Field>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Application due"><input className="input" type="date" value={payload.applicationDueDate ?? ""} onChange={(event) => set({ applicationDueDate: event.target.value })} /></Field>
          <Field label="Submitted"><input className="input" type="date" value={payload.submittedAtISO ?? ""} onChange={(event) => set({ submittedAtISO: event.target.value })} /></Field>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Decision"><input className="input" type="date" value={payload.decisionAtISO ?? ""} onChange={(event) => set({ decisionAtISO: event.target.value })} /></Field>
          <Field label="Next report"><input className="input" type="date" value={payload.nextReportDueAtISO ?? ""} onChange={(event) => set({ nextReportDueAtISO: event.target.value })} /></Field>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Start"><input className="input" type="date" value={payload.startDate ?? ""} onChange={(event) => set({ startDate: event.target.value })} /></Field>
          <Field label="End"><input className="input" type="date" value={payload.endDate ?? ""} onChange={(event) => set({ endDate: event.target.value })} /></Field>
        </div>
        <Field label="Restricted purpose"><textarea className="textarea" rows={3} value={payload.restrictedPurpose ?? ""} onChange={(event) => set({ restrictedPurpose: event.target.value })} /></Field>
        <Field label="Notes"><textarea className="textarea" rows={4} value={payload.notes ?? ""} onChange={(event) => set({ notes: event.target.value })} /></Field>
      </>
    );
  }
  return (
    <Field label="Payload JSON">
      <textarea className="textarea mono" rows={12} value={form.payloadText} onChange={(event) => onChange({ ...form, payloadText: event.target.value })} />
    </Field>
  );
}

function formFromRecord(record: any) {
  return {
    ...record,
    payload: { ...(record.payload ?? {}) },
    payloadText: JSON.stringify(record.payload ?? {}, null, 2),
    linesText: JSON.stringify(record.payload?.lines ?? [], null, 2),
    sourceExternalIdsText: (record.sourceExternalIds ?? []).join(", "),
  };
}

function recordPayloadFromForm(form: any) {
  let payload = { ...(form.payload ?? {}) };
  if (form.recordKind === "budget") {
    payload = { ...payload, lines: parseJsonArray(form.linesText) };
  }
  if (!["source", "fact", "event", "boardTerm", "motion", "budget", "bylawAmendment", "grant"].includes(form.recordKind)) {
    payload = parseJsonObject(form.payloadText);
  }
  return {
    payload,
    sourceExternalIds: String(form.sourceExternalIdsText ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  };
}

function updatePayload(form: any, onChange: (form: any) => void, patch: any) {
  const nextPayload = { ...(form.payload ?? {}), ...patch };
  onChange({
    ...form,
    payload: nextPayload,
    payloadText: JSON.stringify(nextPayload, null, 2),
  });
}

function parseJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) throw new Error("Expected a JSON array.");
    return parsed;
  } catch {
    throw new Error("Budget lines must be valid JSON array.");
  }
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object.");
    return parsed;
  } catch {
    throw new Error("Payload must be a valid JSON object.");
  }
}

function numericInput(value: string) {
  return value === "" ? undefined : Number(value);
}

function StatusBadge({ status }: { status: string }) {
  if (status === "Approved") return <Badge tone="success">Approved</Badge>;
  if (status === "Rejected") return <Badge tone="danger">Rejected</Badge>;
  return <Badge tone="warn">Pending</Badge>;
}

function ConfidenceBadge({ confidence }: { confidence?: string }) {
  if (confidence === "High") return <Badge tone="success">High</Badge>;
  if (confidence === "Medium") return <Badge tone="info">Medium</Badge>;
  return <Badge tone="warn">Review</Badge>;
}

function isActiveImportSession(session: any) {
  const summary = session?.summary ?? {};
  const pending = Number(summary.byStatus?.Pending ?? 0);
  const approved = Number(summary.byStatus?.Approved ?? 0);
  const applied =
    Number(summary.documentsApplied ?? 0) +
    Number(summary.meetingsApplied ?? 0) +
    Number(summary.orgHistoryApplied ?? 0) +
    Number(summary.sectionsApplied ?? 0);

  return pending > 0 || (approved > 0 && applied === 0);
}

function isCompletedImportSession(session: any) {
  return !isActiveImportSession(session);
}

function Stat({ label, value, icon, sub }: { label: string; value: string; icon: ReactNode; sub: string }) {
  return (
    <div className="stat">
      <div className="stat__icon">{icon}</div>
      <div>
        <div className="stat__label">{label}</div>
        <div className="stat__value">{value}</div>
        <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>{sub}</div>
      </div>
    </div>
  );
}
