import { importSectionPermission } from "../../shared/importPromotionPermissions";
import { usePermissions } from "@/hooks/usePermissions";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { RepairImportedMinutesAction } from "../features/meetings/components/RepairImportedMinutesAction";
import { Badge, Drawer, Field, InspectorNote } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { Segmented } from "../components/primitives";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
import { ImportWizard } from "../components/ImportWizard";
import { isMemberHistoryDate } from "../../shared/memberHistory";
import { Select } from "../components/Select";
import { inspectImportBundle, prepareImportBundle } from "../lib/importBundleIntake";
import { isActiveImportSession } from "../../shared/importSessionState";
import { distinguishSessionNames, type SessionLabel } from "../../shared/importSessionLabels";
import { ImportReviewQueue, DEFAULT_QUEUE_FILTERS, type QueueFilters } from "../features/importReview/ImportReviewQueue";
import { IMPORT_KIND_LABELS, importKindLabel } from "../features/importReview/importKindLabels";
import { formatDate } from "../lib/format";
import {
  Archive,
  Check,
  FileJson,
  FileText,
  FileWarning,
  FolderOpen,
  History,
  ListChecks,
  Plus,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";

type SessionTrack = "active" | "completed";
type LinkInsight = {
  key: string;
  label: string;
  detail: string;
  resolved: boolean;
};

const KIND_LABELS = IMPORT_KIND_LABELS;
// "source" stays the session-source filter used by links from Integrations.
const QUEUE_PARAM_KEYS = ["status", "kind", "target", "sessionId", "risk", "origin", "q", "sort", "page"] as const;

function filtersFromParams(params: URLSearchParams): QueueFilters {
  const status = params.get("status");
  return {
    status: status === "Approved" || status === "Rejected" || status === "all" ? status : "Pending",
    recordKind: params.get("kind") || undefined,
    targetModule: params.get("target") || undefined,
    sessionId: params.get("sessionId") || undefined,
    risk: params.get("risk") || undefined,
    source: params.get("origin") || undefined,
    search: params.get("q") || undefined,
    sort: params.get("sort") === "session" ? "session" : "priority",
    page: Math.max(0, Number(params.get("page")) || 0),
  };
}

function paramsFromFilters(base: URLSearchParams, filters: QueueFilters) {
  const next = new URLSearchParams(base);
  for (const key of QUEUE_PARAM_KEYS) next.delete(key);
  if (filters.status !== DEFAULT_QUEUE_FILTERS.status) next.set("status", filters.status);
  if (filters.recordKind) next.set("kind", filters.recordKind);
  if (filters.targetModule) next.set("target", filters.targetModule);
  if (filters.sessionId) next.set("sessionId", filters.sessionId);
  if (filters.risk) next.set("risk", filters.risk);
  if (filters.source) next.set("origin", filters.source);
  if (filters.search) next.set("q", filters.search);
  if (filters.sort === "session") next.set("sort", "session");
  if (filters.page) next.set("page", String(filters.page));
  return next;
}

export function ImportSessionsPage() {
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("settings:write");
  const society = useSociety();
  const toast = useToast();
  const confirm = useConfirm();
  const convex = useConvex();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const setFilters = (next: QueueFilters) => setSearchParams(paramsFromFilters(searchParams, next), { replace: true });
  const sourceFilter = searchParams.get("source");
  const sessions = useQuery(api.importSessions.list, society ? { societyId: society._id } : "skip");
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
  const sessionLabels = useMemo(() => {
    const all = sessions ?? [];
    const computed = distinguishSessionNames(all.map((session: any) => String(session.name ?? "")));
    return new Map<string, SessionLabel>(all.map((session: any, index: number) => [String(session._id), computed[index]]));
  }, [sessions]);
  const selectedSessionId = filters.sessionId ?? null;
  const detail = useQuery(api.importSessions.get, selectedSessionId ? { sessionId: selectedSessionId } : "skip");
  const removalImpact = useQuery(api.importSessions.removalImpact, selectedSessionId && canWrite ? { sessionId: selectedSessionId } : "skip");
  const gapSummary = useQuery(api.representationGaps.summary, society && loaded && can("documents:read") ? { societyId: society._id } : "skip");

  const createSession = useMutation(api.importSessions.createFromBundle);
  const importMember = useMutation(api.members.importMember);
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
  const [createName, setCreateName] = useState("Reviewed records import");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importOwnershipReviewed, setImportOwnershipReviewed] = useState(false);
  const [importCreating, setImportCreating] = useState(false);
  const [recordForm, setRecordForm] = useState<any | null>(null);
  const [paperlessQuery, setPaperlessQuery] = useState("meeting minutes");
  const [paperlessLimit, setPaperlessLimit] = useState(100);
  const [paperlessBusy, setPaperlessBusy] = useState(false);
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [discoveryLimit, setDiscoveryLimit] = useState(100);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [transposeQuery, setTransposeQuery] = useState("");
  const [transposeLimit, setTransposeLimit] = useState(100);
  const [transposeBusy, setTransposeBusy] = useState(false);

  const importPreview = useMemo(() => {
    if (!importText.trim() || !society) return null;
    try {
      return { data: inspectImportBundle(JSON.parse(importText), society), error: "" };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : "Invalid JSON bundle" };
    }
  }, [importText, society]);

  useEffect(() => {
    setImportOwnershipReviewed(false);
  }, [importText, society?._id]);

  useEffect(() => {
    if (!selectedSessionId || sessions === undefined) return;
    const requested = sessions.find((session: any) => session._id === selectedSessionId);
    if (requested) setSessionTrack(isActiveImportSession(requested) ? "active" : "completed");
  }, [selectedSessionId, sessions]);

  const records = detail?.records ?? [];
  const session = detail?.session ?? null;
  const approvedToApply = useMemo(() => records.filter((record: any) => record.status === "Approved" && !Object.values(record.importedTargets ?? {}).some(Boolean)).length, [records]);
  const sessionGaps = useMemo(() => (gapSummary?.byImportSession ?? []).find((row: any) => String(row.importSessionId) === String(selectedSessionId)), [gapSummary, selectedSessionId]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const pickSession = (sessionId: string | null) => setFilters({ ...filters, sessionId: sessionId ?? undefined, page: 0 });

  const createFromJson = async () => {
    if (!canWrite || importCreating) return;
    // Explain why a bundle cannot be staged instead of silently disabling the button.
    if (!importPreview?.data) { setImportError(importPreview?.error || "Paste or upload a JSON bundle first."); return; }
    if (importPreview.data.mixedOrganizations) { setImportError("This bundle declares multiple organizations. Split it by organization before importing."); return; }
    if (importPreview.data.needsReview && !importOwnershipReviewed) { setImportError("Confirm that you reviewed the source ownership before staging these records."); return; }
    setImportCreating(true);
    try {
      const parsed = prepareImportBundle(JSON.parse(importText), society, importOwnershipReviewed, importFileName || undefined);
      const sessionId = await createSession({
        societyId: society._id,
        name: createName,
        bundle: parsed,
      });
      pickSession(sessionId);
      setImportText("");
      setImportFileName("");
      setImportError("");
      setCreateOpen(false);
      toast.success("Import session created", createName);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not create session");
    } finally {
      setImportCreating(false);
    }
  };

  const loadImportFile = async (file: File) => {
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error("Choose a JSON bundle smaller than 16 MB. Split larger archives into review batches.");
      const contents = await file.text();
      const parsed = JSON.parse(contents);
      inspectImportBundle(parsed, society);
      setImportText(contents);
      setImportFileName(file.name);
      setCreateName(parsed.metadata?.name || parsed.name || file.name.replace(/\.json$/i, ""));
      setImportError("");
    } catch (error) {
      setImportText("");
      setImportFileName("");
      setImportError(error instanceof Error ? error.message : "Could not read JSON bundle");
    }
  };

  const editRecord = async (recordId: string) => {
    try {
      const record = await convex.query(api.importSessions.getRecord, { recordId });
      if (record) setRecordForm(formFromRecord(record));
    } catch (error: any) {
      toast.error(error?.message ?? "Could not open the import record");
    }
  };

  const approveImportReadyInsurance = async () => {
    if (!session) return;
    const insuranceRecords = records.filter(isImportReadyInsuranceRecord).filter((record: any) => record.status !== "Approved");
    if (!insuranceRecords.length) return;
    const ok = await confirm({
      title: `Approve ${insuranceRecords.length} import-ready insurance record${insuranceRecords.length === 1 ? "" : "s"}?`,
      message: `${insuranceRecords.length} insurance polic${insuranceRecords.length === 1 ? "y" : "ies"} in "${session.name}" will be marked approved. Nothing is published to Insurance until you apply sections.`,
      confirmLabel: `Approve ${insuranceRecords.length}`,
    });
    if (!ok) return;
    try {
      const result = await bulkSetStatus({
        sessionId: session._id,
        status: "Approved",
        recordIds: insuranceRecords.map((record: any) => record._id),
      });
      toast.success(`${result.updated} insurance records approved`, "Apply sections when ready to publish them to Insurance");
    } catch (error: any) {
      toast.error(error?.message ?? "Could not approve insurance records");
    }
  };

  const canPromote = (...permissions: string[]) => canWrite && permissions.every(permission => can(permission as any));
  const runApply = async (label: string, action: () => Promise<string>) => {
    if (!session) return;
    try {
      const summary = await action();
      toast.success(label, summary);
    } catch (error: any) {
      toast.error(error?.message ?? `Could not complete: ${label.toLowerCase()}`);
    }
  };
  const runOrgHistoryApply = () => runApply("Approved records applied to history", async () => {
    const result = await applyToOrgHistory({ sessionId: session._id });
    return `${result.sources} source records, ${result.items} history records`;
  });
  const runMeetingApply = () => runApply("Meeting drafts created", async () => {
    const result = await applyMeetings({ sessionId: session._id });
    return `${result.meetings} meetings, ${result.motions} motions${result.existing ? `, ${result.existing} already existed` : ""}`;
  });
  const runMeetingBackfill = () => runApply("Meeting references refreshed", async () => {
    const result = await backfillMeetings({ sessionId: session._id });
    return `${result.meetings} meetings, ${result.minutes} minutes, ${result.documents} source links`;
  });
  const runDocumentApply = () => runApply("Documents created from approved candidates", async () => {
    const result = await applyDocuments({ sessionId: session._id });
    return result.documents
      ? `${result.documents} document record${result.documents === 1 ? "" : "s"} created`
      : "No approved document candidates were waiting to be created.";
  });
  const runSectionApply = () => runApply("Section records applied", async () => {
    const result = await applySections({ sessionId: session._id });
    const byKind = Object.entries(result.byKind ?? {})
      .map(([kind, count]) => `${count} ${importKindLabel(kind)}`)
      .join(", ");
    return byKind || `${result.total} records`;
  });

  const deleteSession = async () => {
    if (!session) return;
    const impact = removalImpact ?? { records: records.length, pending: 0, approved: 0, applied: 0, linkedDocuments: 0, gaps: 0 };
    const parts = [
      `${impact.records} staged record${impact.records === 1 ? "" : "s"} (${impact.pending} pending, ${impact.approved} approved) will be deleted`,
      impact.applied ? `${impact.applied} already applied record${impact.applied === 1 ? " stays" : "s stay"} in the app` : null,
      impact.linkedDocuments ? `${impact.linkedDocuments} document${impact.linkedDocuments === 1 ? "" : "s"} created from this session will be tagged "import-session-removed" and keep the session name as provenance` : null,
      impact.gaps ? `${impact.gaps} unsupported-detail record${impact.gaps === 1 ? "" : "s"} will be unlinked from it` : null,
    ].filter(Boolean);
    const ok = await confirm({
      title: `Delete import session "${session.name}"?`,
      message: `${parts.join(". ")}. This cannot be undone.`,
      confirmLabel: `Delete session and ${impact.records} record${impact.records === 1 ? "" : "s"}`,
      tone: "danger",
    });
    if (!ok) return;
    try {
      await removeSession({ sessionId: session._id });
      pickSession(null);
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
      pickSession(result.sessionId);
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
      pickSession(result.sessionId);
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
      pickSession(result.sessionId);
      toast.success("Paperless transposition staged", `${result.sources} sources from ${result.scannedDocuments} documents`);
    } catch (error: any) {
      toast.error(error?.message ?? "Paperless transposition failed");
    } finally {
      setTransposeBusy(false);
    }
  };

  const selectedLabel = selectedSessionId ? sessionLabels.get(selectedSessionId) : undefined;

  return (
    <div className="page import-sessions-page">
      <PageHeader
        title="Import sessions"
        icon={<FileJson size={16} />}
        iconColor="purple"
        subtitle="Review staged records from every import in one queue, then apply approved records into the app session by session."
        actions={
          <>
          <RepairImportedMinutesAction societyId={society._id} />
          <button className="btn-action" onClick={() => setCsvOpen(true)} disabled={!canWrite}>
            <Upload size={12} /> Import members CSV
          </button>
          <button className="btn-action btn-action--primary" onClick={() => setCreateOpen(true)} disabled={!canWrite}>
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
            { id: "address", label: "Address" },
            { id: "aliases", label: "Aliases", type: "multiSelect" },
            { id: "membershipClass", label: "Class", required: true },
            { id: "status", label: "Status", required: true },
            { id: "joinedAt", label: "Joined (YYYY-MM-DD)", required: true, validate: value => isMemberHistoryDate(value) ? null : "Use a real YYYY-MM-DD date" },
            { id: "leftAt", label: "Left (YYYY-MM-DD)", validate: value => isMemberHistoryDate(value) ? null : "Use a real YYYY-MM-DD date" },
            { id: "votingRights", label: "Voting rights", type: "boolean", required: true },
            { id: "notes", label: "Notes / source citation" },
          ],
          onImportRow: async (row) => {
            await importMember({
              societyId: society._id,
              firstName: row.firstName,
              lastName: row.lastName,
              email: row.email || undefined,
              phone: row.phone || undefined,
              address: row.address || undefined,
              aliases: row.aliases,
              membershipClass: row.membershipClass,
              status: row.status,
              joinedAt: row.joinedAt,
              leftAt: row.leftAt || undefined,
              votingRights: row.votingRights,
              notes: row.notes || undefined,
            });
          },
        }}
      />

      {sourceFilter && (
        <InspectorNote tone="info" title="Filtered import sessions">
          Showing sessions matching <span className="mono">{sourceFilter}</span>.
        </InspectorNote>
      )}

      <ImportReviewQueue
        societyId={society._id}
        canWrite={canWrite}
        filters={filters}
        onFiltersChange={setFilters}
        onEdit={(recordId) => { void editRecord(recordId); }}
        onSessionPicked={(sessionId) => pickSession(sessionId)}
      />

      <div className="import-review-layout">
        <div className="card import-sessions-card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Sessions</h2>
              <p className="card__subtitle">
                {sessionTrack === "active"
                  ? "Batches that still need review or apply steps. Pick one to filter the queue and apply it."
                  : "Finished, rejected, or empty batches kept for audit trail."}
              </p>
            </div>
          </div>
          <div className="card__body import-session-track">
            <Segmented<SessionTrack>
              value={sessionTrack}
              onChange={(next) => setSessionTrack(next)}
              items={[
                { id: "active", label: `Active (${activeSessions.length})` },
                { id: "completed", label: `Completed (${completedSessions.length})` },
              ]}
            />
            <Select
              className="import-session-picker"
              aria-label="Import session"
              value={selectedSessionId ?? ""}
              searchable
              onChange={(value) => pickSession(value || null)}
              options={[
                { value: "", label: "All sessions" },
                ...visibleSessions.map((item: any) => ({ value: item._id, label: `${sessionLabels.get(String(item._id))?.full ?? item.name} · ${item.summary?.byStatus?.Pending ?? 0} pending` })),
              ]}
            />
          </div>
          <div className="card__body import-session-list" role="list">
            {visibleSessions.map((item: any) => {
              const label = sessionLabels.get(String(item._id));
              const pending = item.summary?.byStatus?.Pending ?? 0;
              return (
                <button
                  key={item._id}
                  role="listitem"
                  className={`import-session-row${item._id === selectedSessionId ? " is-active" : ""}`}
                  aria-pressed={item._id === selectedSessionId}
                  title={item.name}
                  onClick={() => pickSession(item._id === selectedSessionId ? null : item._id)}
                >
                  <span className="import-session-row__name">
                    <strong>{label?.primary ?? item.name}</strong>
                    <span className="muted">{[label?.sharedPrefix, item.sourceSystem].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="import-session-row__counts">
                    {pending > 0 && <Badge tone="warn">{pending} pending</Badge>}
                    {(item.summary?.approvedUnapplied ?? 0) > 0 && <Badge tone="info">{item.summary.approvedUnapplied} to apply</Badge>}
                    {!isActiveImportSession(item) && <Badge tone="success">Complete</Badge>}
                    <span className="muted">{item.summary?.total ?? 0} total</span>
                  </span>
                </button>
              );
            })}
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

        <div className="card import-session-panel">
          <div className="card__head import-review-head">
            <div className="import-review-heading">
              <h2 className="card__title">{session?.name ?? (selectedSessionId ? "Loading session…" : "No session selected")}</h2>
              {session && <p className="card__subtitle">{[session.sourceSystem, session.createdAtISO ? `staged ${formatDate(session.createdAtISO)}` : null, selectedLabel && selectedLabel.primary !== session.name ? `shown as “${selectedLabel.primary}”` : null].filter(Boolean).join(" · ")}</p>}
            </div>
            {session && (
              <div className="import-review-actions">
                <button className="btn-action" onClick={() => { void runOrgHistoryApply(); }} disabled={!canPromote("society:write", "documents:write")}>
                  <History size={12} /> Apply history
                </button>
                <button className="btn-action" onClick={() => { void runMeetingApply(); }} disabled={!canPromote("meetings:write", "minutes:write", "motions:write", "documents:write")}>
                  <FileText size={12} /> Create minutes
                </button>
                <button className="btn-action" onClick={() => { void runMeetingBackfill(); }} disabled={!canWrite}>
                  <History size={12} /> Refresh links
                </button>
                <button className="btn-action" onClick={() => { void runDocumentApply(); }} disabled={!canPromote("documents:write")}>
                  <FolderOpen size={12} /> Create docs
                </button>
                <button className="btn-action" onClick={() => { void runSectionApply(); }} disabled={!canPromote("documents:write") || !records.filter((row: any) => row.status === "Approved").every((row: any) => can(importSectionPermission(row.recordKind) as any))}>
                  <Archive size={12} /> Apply sections
                </button>
                <button className="btn-action btn-action--danger" onClick={() => { void deleteSession(); }} disabled={!canWrite}>
                  <Trash2 size={12} /> Delete session…
                </button>
              </div>
            )}
          </div>
          {session ? (
            <div className="card__body col" style={{ gap: 12 }}>
              <div className="stat-grid import-sessions-page__stats">
                <Stat label="Candidates" value={String(session.summary?.total ?? 0)} icon={<ListChecks size={14} />} sub={`${session.summary?.byStatus?.Pending ?? 0} pending`} />
                <Stat label="Approved, not applied" value={String(approvedToApply)} icon={<Check size={14} />} sub="run an apply step above" />
                <Stat label="Applied" value={String((session.summary?.documentsApplied ?? 0) + (session.summary?.sectionsApplied ?? 0) + (session.summary?.meetingsApplied ?? 0) + (session.summary?.orgHistoryApplied ?? 0))} icon={<Archive size={14} />} sub="documents, sections, minutes, history" />
                <Stat label="Unsupported" value={sessionGaps ? String(sessionGaps.count) : "0"} icon={<FileWarning size={14} />} sub={sessionGaps ? `details · ${sessionGaps.open ?? 0} open` : "no details recorded"} />
              </div>
              {sessionGaps && Object.keys(sessionGaps.infoTypes ?? {}).length > 0 && (
                <InspectorNote tone="warn" title="Source details Societyer could not represent">
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {Object.entries(sessionGaps.infoTypes as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => <Badge key={label}>{label} · {count}</Badge>)}
                  </div>
                  <Link to="/app/coverage?tab=system">Review in Coverage and gaps</Link>
                </InspectorNote>
              )}
              {session.qualitySummary && (
                <InspectorNote title="Quality gates">
                  {session.qualitySummary.importBlockers ?? 0} import blockers, {session.qualitySummary.badDateDocuments ?? 0} bad-date documents, and {session.qualitySummary.sensitiveDocuments ?? 0} sensitive documents were reported in the source bundle.
                </InspectorNote>
              )}
              <InsuranceImportReviewPanel
                records={records}
                onShow={() => setFilters({ ...filters, recordKind: "insurancePolicy", status: "all", search: undefined, page: 0 })}
                onApproveReady={() => { void approveImportReadyInsurance(); }}
              />
              <p className="muted" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
                Apply steps act on this session's approved records only; pending and rejected records are never applied.
              </p>
            </div>
          ) : (
            <div className="card__body">
              <InspectorNote title="Pick a session to apply it">
                The queue above reviews every session at once. Choose a session in the list to see its counts and unsupported details, and to create documents, minutes or section records from its approved candidates. To stage new records, use New session with a JSON bundle.
              </InspectorNote>
            </div>
          )}
        </div>
      </div>

      <details className="card import-connectors">
        <summary className="card__head">
          <span className="card__title"><ShieldAlert size={14} /> Stage records from Paperless-ngx</span>
          <span className="card__subtitle">Scan a connected Paperless server into a new review session.</span>
        </summary>
        <div className="import-scan-grid">
          <div className="card import-scan-card">
            <div className="card__head import-scan-card__head">
              <div>
                <h2 className="card__title">Paperless meeting scan</h2>
                <p className="card__subtitle">Creates a review session from live Paperless meeting-minute documents.</p>
              </div>
              <button className="btn-action btn-action--primary" disabled={!(canWrite && loaded && can("documents:write")) || (paperlessBusy)} onClick={runPaperlessMeetingScan}>
                <FileText size={12} /> {paperlessBusy ? "Scanning..." : "Scan minutes"}
              </button>
            </div>
            <div className="card__body import-scan-card__fields">
              <Field label="Search query">
                <input className="input" value={paperlessQuery} onChange={(event) => setPaperlessQuery(event.target.value)} />
              </Field>
              <Field label="Max documents" hint="Caps how many Paperless-ngx documents this pass will fetch and review.">
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
              <button className="btn-action btn-action--primary" disabled={!(canWrite && loaded && can("documents:write")) || (discoveryBusy)} onClick={runPaperlessDiscoveryScan}>
                <Archive size={12} /> {discoveryBusy ? "Scanning..." : "Scan sections"}
              </button>
            </div>
            <div className="card__body import-scan-card__fields">
              <Field label="Search query" hint="Leave blank to scan broadly across Paperless.">
                <input className="input" value={discoveryQuery} onChange={(event) => setDiscoveryQuery(event.target.value)} placeholder="budget, annual report, policy..." />
              </Field>
              <Field label="Max documents" hint="Caps how many Paperless-ngx documents this pass will fetch and review.">
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
              <button className="btn-action btn-action--primary" disabled={!(canWrite && loaded && can("documents:write")) || (transposeBusy)} onClick={runPaperlessTransposeScan}>
                <Archive size={12} /> {transposeBusy ? "Transposing..." : "Transpose records"}
              </button>
            </div>
            <div className="card__body import-scan-card__fields">
              <Field label="Search query" hint="Leave blank to transpose broadly across Paperless OCR.">
                <input className="input" value={transposeQuery} onChange={(event) => setTransposeQuery(event.target.value)} placeholder="insurance, filings, issue, grant..." />
              </Field>
              <Field label="Max documents" hint="Caps how many Paperless-ngx documents this pass will fetch and review.">
                <input className="input" type="number" min={1} max={1179} value={transposeLimit} onChange={(event) => setTransposeLimit(Number(event.target.value) || 1)} />
              </Field>
            </div>
          </div>
        </div>
      </details>

      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New import session"
        footer={
          <>
            <button className="btn" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={createFromJson} disabled={!canWrite || importCreating || !importText.trim()}>
              <Upload size={14} /> {importCreating ? "Creating..." : "Create session"}
            </button>
          </>
        }
      >
        <div className="col" style={{ gap: 12 }}>
          <InspectorNote title="Destination organization">
            Records will be staged for <strong>{society.name}</strong>. They remain pending until reviewed and applied. Use one organization per bundle.
          </InspectorNote>
          <Field label="JSON bundle file" hint="Upload a converted Drive, Office, or Paperless bundle. Original PDFs, spreadsheets and Word files need conversion first.">
            <input className="input" type="file" accept=".json,application/json" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadImportFile(file);
              event.target.value = "";
            }} />
            {importFileName && <span className="muted">Loaded {importFileName}</span>}
          </Field>
          <Field label="Session name">
            <input className="input" value={createName} onChange={(event) => setCreateName(event.target.value)} />
          </Field>
          <Field label="Import JSON" hint="Accepts source, meeting, documentMap, and section-record bundles from Paperless, Office files, or reviewed JSON exports.">
            <textarea
              className="textarea"
              rows={18}
              value={importText}
              onChange={(event) => { setImportText(event.target.value); setImportFileName(""); setImportError(""); }}
              placeholder='{"sources":[],"documentMap":[],"meetingMinutes":[],"budgetSnapshots":[],"transactionCandidates":[]}'
            />
          </Field>
          {importPreview?.error && <Badge tone="danger">{importPreview.error}</Badge>}
          {importPreview?.data && (
            <InspectorNote title="Bundle preview">
              <p>{importPreview.data.total} staged records: {Object.entries(importPreview.data.byKind).map(([kind, count]) => `${count} ${KIND_LABELS[kind] || kind}`).join(", ")}.</p>
              <p>Declared source organization: {importPreview.data.organizations.join(", ") || "Not declared"}. {importPreview.data.sourceCount} source records; {importPreview.data.linkedSources} original source links; {importPreview.data.missingEvidence} records without source IDs.</p>
              {importPreview.data.mixedOrganizations ? (
                <p role="alert">This bundle declares multiple organizations. Split it by organization before importing.</p>
              ) : importPreview.data.needsReview ? (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <input type="checkbox" checked={importOwnershipReviewed} onChange={(event) => setImportOwnershipReviewed(event.target.checked)} />
                  <span>I reviewed the source ownership and evidence gaps. These records belong in {society.name}.</span>
                </label>
              ) : <p>Declared ownership matches the selected organization.</p>}
            </InspectorNote>
          )}
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
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("settings:write");
  return (
    <Drawer
      open={Boolean(form)}
      onClose={onClose}
      title="Review import record"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={onSave} disabled={!canWrite}>Save review</button>
        </>
      }
    >
      {form && (
        <div className="col" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Review status">
              <Select
                value={form.status}
                onChange={(value) => onChange({ ...form, status: value })}
                options={[
                  { value: "Pending", label: "Pending" },
                  { value: "Approved", label: "Approved" },
                  { value: "Rejected", label: "Rejected" },
                ]}
              />
            </Field>
            <Field label="Confidence">
              <Select
                value={form.payload.confidence ?? form.confidence ?? "Review"}
                onChange={(value) => updatePayload(form, onChange, { confidence: value })}
                options={[
                  { value: "High", label: "High" },
                  { value: "Medium", label: "Medium" },
                  { value: "Review", label: "Review" },
                ]}
              />
            </Field>
          </div>
          {renderPayloadEditor(form, onChange)}
          <LinkReviewPanel record={form} />
          <Field label="Source external IDs" hint="Comma-separated Paperless, BC Registry, local, or external IDs used for provenance.">
            <input className="input" value={form.sourceExternalIdsText} onChange={(event) => onChange({ ...form, sourceExternalIdsText: event.target.value })} />
          </Field>
          <Field label="Review notes">
            <MarkdownEditor rows={4} value={form.reviewNotes ?? ""} onChange={(markdown) => onChange({ ...form, reviewNotes: markdown })} />
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
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("settings:write");
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
          <button className="btn-action btn-action--primary" type="button" onClick={onApproveReady} disabled={!canWrite || (!ready.length)}>
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

function LinkReviewPanel({ record }: { record: any }) {
  const insights = linkInsightsFor(record);
  if (!insights.length) return null;
  const open = insights.filter((insight) => !insight.resolved);
  return (
    <InspectorNote
      tone={open.length ? "warn" : "info"}
      title={open.length ? "Likely links to review" : "Link review looks complete"}
    >
      <div className="col" style={{ gap: 8 }}>
        {insights.map((insight) => (
          <div key={insight.key} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <Badge tone={insight.resolved ? "success" : "warn"}>
              {insight.resolved ? "Linked" : "Review"}
            </Badge>
            <div>
              <strong>{insight.label}</strong>
              <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{insight.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </InspectorNote>
  );
}

function linkInsightsFor(record: any): LinkInsight[] {
  const payload = record?.payload ?? {};
  const importedTargets = record?.importedTargets ?? {};
  const sourceExternalIds = uniqueStrings([
    ...(Array.isArray(record?.sourceExternalIds) ? record.sourceExternalIds : []),
    ...(Array.isArray(payload?.sourceExternalIds) ? payload.sourceExternalIds : []),
  ]);
  const insights: LinkInsight[] = [];
  const add = (insight: LinkInsight) => {
    if (!insights.some((item) => item.key === insight.key)) insights.push(insight);
  };

  if (sourceExternalIds.length > 0) {
    add({
      key: "source-evidence",
      label: "Source evidence",
      detail: `${sourceExternalIds.length} source ID${sourceExternalIds.length === 1 ? "" : "s"} should stay linked to the created record or document.`,
      resolved: Boolean(importedTargets.documents || importedTargets.sections || importedTargets.meetings || importedTargets.orgHistory),
    });
  }

  if (["motion", "meetingMinutes", "meetingAttendance", "motionEvidence"].includes(record?.recordKind)) {
    const meetingLabel = firstString(payload.meetingTitle, payload.title, payload.meetingDate, payload.scheduledAt);
    if (meetingLabel) {
      add({
        key: "meeting",
        label: "Meeting",
        detail: `Looks related to ${meetingLabel}. Link it to a meeting/minutes record when applying or reviewing.`,
        resolved: Boolean(importedTargets.meetings || payload.meetingId || payload.minutesId),
      });
    }
  }

  const personLabel = firstString(
    payload.personName,
    payload.fullName,
    payload.participantName,
    payload.employeeName,
    payload.volunteerName,
    payload.movedByName,
    payload.secondedByName,
    payload.name,
    payload.email,
  );
  if (personLabel && [
    "boardTerm",
    "boardRoleAssignment",
    "boardRoleChange",
    "signingAuthority",
    "meetingAttendance",
    "pipaTraining",
    "employee",
    "volunteer",
    "legalSigner",
    "roleHolder",
    "rightsholdingTransfer",
  ].includes(record?.recordKind)) {
    add({
      key: "person",
      label: "Person record",
      detail: `Candidate person value: ${personLabel}. Check whether this should link to an existing member, director, volunteer, or employee.`,
      resolved: Boolean(payload.personId || payload.memberId || payload.directorId || payload.employeeId || payload.volunteerId || payload.roleHolderId),
    });
  }

  if (record?.recordKind === "deadline" && firstString(payload.filingKind, payload.filingTitle, payload.kind, payload.title)) {
    add({
      key: "filing",
      label: "Filing",
      detail: "This deadline looks filing-related and may need a linked filing record.",
      resolved: Boolean(payload.linkedFilingId || payload.filingId),
    });
  }

  if (["budget", "budgetSnapshot", "financialStatement", "financialStatementImport", "treasurerReport"].includes(record?.recordKind)) {
    const fiscalYear = firstString(payload.fiscalYear, payload.year, payload.periodLabel, payload.periodEnd);
    if (fiscalYear) {
      add({
        key: "fiscal-year",
        label: "Fiscal year",
        detail: `Financial period found: ${fiscalYear}. Check whether it should connect to financial statements or a fiscal-year detail record.`,
        resolved: Boolean(payload.fiscalYearId || payload.financialStatementId || importedTargets.sections),
      });
    }
  }

  if (record?.recordKind === "insurancePolicy" && firstString(payload.policySeriesKey, payload.policyNumber, payload.insurer)) {
    add({
      key: "policy-series",
      label: "Policy series",
      detail: `Policy identifiers found: ${[payload.policySeriesKey, payload.policyNumber, payload.insurer].filter(Boolean).join(" · ")}.`,
      resolved: Boolean(payload.policyId || payload.insurancePolicyId || importedTargets.sections),
    });
  }

  if (record?.recordKind === "grant" && firstString(payload.funder, payload.program, payload.linkedFinancialAccountId)) {
    add({
      key: "grant-source",
      label: "Grant source",
      detail: `Grant source fields found: ${[payload.funder, payload.program].filter(Boolean).join(" · ") || "financial account"}.`,
      resolved: Boolean(payload.grantSourceId || payload.linkedFinancialAccountId || importedTargets.sections),
    });
  }

  return insights;
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
        <Field label="Notes"><MarkdownEditor rows={5} value={payload.notes ?? ""} onChange={(markdown) => set({ notes: markdown })} /></Field>
      </>
    );
  }
  if (form.recordKind === "fact") {
    return (
      <>
        <Field label="Label"><input className="input" value={payload.label ?? ""} onChange={(event) => set({ label: event.target.value })} /></Field>
        <Field label="Value"><MarkdownEditor rows={5} value={payload.value ?? ""} onChange={(markdown) => set({ value: markdown })} /></Field>
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
        <Field label="Summary"><MarkdownEditor rows={5} value={payload.summary ?? ""} onChange={(markdown) => set({ summary: markdown })} /></Field>
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
        <Field label="Notes"><MarkdownEditor rows={4} value={payload.notes ?? ""} onChange={(markdown) => set({ notes: markdown })} /></Field>
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
        <Field label="Motion text"><MarkdownEditor rows={5} value={payload.motionText ?? ""} onChange={(markdown) => set({ motionText: markdown })} /></Field>
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
            <Select
              value={payload.status ?? "Draft"}
              onChange={(value) => set({ status: value })}
              options={[
                { value: "Draft", label: "Draft" },
                { value: "Consultation", label: "Consultation" },
                { value: "ResolutionPassed", label: "ResolutionPassed" },
                { value: "Filed", label: "Filed" },
                { value: "Withdrawn", label: "Withdrawn" },
                { value: "Superseded", label: "Superseded" },
              ]}
            />
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
          <MarkdownEditor rows={4} value={payload.notes ?? ""} onChange={(markdown) => set({ notes: markdown })} />
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
            <Select
              value={payload.status ?? "Drafting"}
              onChange={(value) => set({ status: value })}
              options={[
                { value: "Prospecting", label: "Prospecting" },
                { value: "Drafting", label: "Drafting" },
                { value: "Submitted", label: "Submitted" },
                { value: "Awarded", label: "Awarded" },
                { value: "Declined", label: "Declined" },
                { value: "Active", label: "Active" },
                { value: "Closed", label: "Closed" },
                { value: "NeedsReview", label: "NeedsReview" },
              ]}
            />
          </Field>
          <Field label="Requested cents"><input className="input" type="number" value={payload.amountRequestedCents ?? ""} onChange={(event) => set({ amountRequestedCents: numericInput(event.target.value) })} /></Field>
          <Field label="Awarded cents"><input className="input" type="number" value={payload.amountAwardedCents ?? ""} onChange={(event) => set({ amountAwardedCents: numericInput(event.target.value) })} /></Field>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Application due"><DatePicker value={payload.applicationDueDate ?? ""} onChange={(value) => set({ applicationDueDate: value })} /></Field>
          <Field label="Submitted"><DatePicker value={payload.submittedAtISO ?? ""} onChange={(value) => set({ submittedAtISO: value })} /></Field>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Decision"><DatePicker value={payload.decisionAtISO ?? ""} onChange={(value) => set({ decisionAtISO: value })} /></Field>
          <Field label="Next report"><DatePicker value={payload.nextReportDueAtISO ?? ""} onChange={(value) => set({ nextReportDueAtISO: value })} /></Field>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Start"><DatePicker value={payload.startDate ?? ""} onChange={(value) => set({ startDate: value })} /></Field>
          <Field label="End"><DatePicker value={payload.endDate ?? ""} onChange={(value) => set({ endDate: value })} /></Field>
        </div>
        <Field label="Restricted purpose"><MarkdownEditor rows={3} value={payload.restrictedPurpose ?? ""} onChange={(markdown) => set({ restrictedPurpose: markdown })} /></Field>
        <Field label="Notes"><MarkdownEditor rows={4} value={payload.notes ?? ""} onChange={(markdown) => set({ notes: markdown })} /></Field>
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

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
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
