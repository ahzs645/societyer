import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { ArrowLeft, CheckCheck, CircleSlash, ExternalLink, Keyboard, Layers, Lock, RotateCcw, Upload } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Banner } from "../components/ui";
import { useConfirm } from "../components/Modal";
import { RecordNotFound } from "../components/RecordNotFound";
import { useToast } from "../components/Toast";
import { pluralize } from "../lib/format";
import {
  bulkAcceptCandidates, groupQueue, latestDecisions, promotionReadiness, reviewFieldsForRecord,
  type EntityGroup, type QueueRow, type ReviewField, type ReviewGroup, type ReviewRow, type RiskTier,
} from "../../shared/intake/review";
import { SourceViewer, type ClusterVersion } from "../features/intake/SourceViewer";
import { FieldList, type FieldDecisionHandler } from "../features/intake/FieldPanel";
import { EntityPanel } from "../features/intake/EntityPanel";
import { GapPanel } from "../features/intake/GapPanel";
import { AddRunPeopleButton } from "../features/intake/AddRunPeopleButton";
import { BulkAcceptModal, CantRepresentModal, PromoteModal, type CantRepresentDraft, type PromoteChoice, type RunBulkScope } from "../features/intake/ReviewModals";
import { canStoreOriginals, useStoreOriginals } from "../features/intake/useStoreOriginals";
import { CLASS_PROMOTION } from "../../shared/intake/promotionClasses";
import "../features/intake/intake.css";

type Tab = "fields" | "people" | "gaps" | "log";
const TIER_LABEL: Record<RiskTier, string> = { high: "High risk", medium: "Medium risk", low: "Low risk" };
const STATUS_LABEL: Record<string, string> = { pending_review: "to review", in_review: "in review", accepted: "accepted", promoted: "promoted", rejected: "rejected", covered: "covered by a copy" };
const STATUS_TONE: Record<string, "success" | "warn" | "danger" | "info" | "neutral"> = { pending_review: "neutral", in_review: "info", accepted: "info", promoted: "success", rejected: "danger", covered: "success" };
const CLOSED = new Set(["promoted", "rejected", "covered"]);
const CLASS_TITLE: Record<string, string> = {
  meetingMinutes: "Meeting minutes", agenda: "Agenda", meetingPackage: "Meeting package", agmMaterial: "AGM material", bylaws: "Bylaws", policy: "Policy", directorConsent: "Consent to act as a director",
  proxy: "Proxy", roster: "Roster", financialStatement: "Financial statement", budget: "Budget", insurance: "Insurance", agreement: "Agreement", grant: "Grant", registryFiling: "Registry filing",
  correspondence: "Correspondence", invoice: "Invoice",
};
/** Where a promoted native record is shown. */
function recordHref(table: string, id: string): string {
  switch (table) {
    case "meetings": return `/app/meetings/${id}`;
    case "committees": return `/app/committees/${id}`;
    case "insurancePolicies": return `/app/insurance/${id}`;
    case "grants": return `/app/grants/${id}`;
    case "policies": return "/app/policies";
    case "bylawRuleSets": return "/app/bylaw-rules";
    case "directors": case "organizationSeats": return "/app/directors";
    case "proxies": return "/app/proxies";
    case "financialStatementImports": case "budgetSnapshots": return "/app/financials";
    case "deadlines": return "/app/deadlines";
    case "filings": return "/app/filings";
    case "sourceEvidence": return "/app/records-archive";
    case "transactionCandidates": return "/app/finance-imports";
    default: return "/app/documents";
  }
}
const TABLE_NOUN: Record<string, string> = {
  meetings: "Meeting", meetingMaterials: "Meeting material", committees: "Committee", insurancePolicies: "Insurance policy", grants: "Grant", policies: "Policy", bylawRuleSets: "Bylaw rule set",
  directors: "Director", organizationSeats: "Seat", proxies: "Proxy", financialStatementImports: "Financial statement", budgetSnapshots: "Budget", deadlines: "Deadline", filings: "Filing",
  sourceEvidence: "Source evidence", transactionCandidates: "Transaction candidate",
};
const UNDO_MS = 10_000;

/**
 * Three-pane intake review (design §4.4): risk-tiered queue by version
 * cluster (left), the source with the selected field's locator highlighted
 * (centre), and the native-target form with per-field decisions, people,
 * record gaps and the processing log (right). Promotion writes native records
 * through the import path with a provenance row per field.
 */
export function IntakeReviewPage() {
  const { runId = "" } = useParams();
  const society = useSociety();
  const { can, loaded } = usePermissions();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const canRead = can("settings:read");
  const canWrite = loaded && can("settings:write");
  const societyId = society?._id as string | undefined;
  // Existence comes from the society-scoped list: a missing id must show "not found", not wait on a rejected read.
  const runs = useQuery(api.intake.listRuns, societyId && canRead ? { societyId } : "skip") as any[] | undefined;
  const runExists = runs ? runs.some((candidate) => candidate._id === runId) : undefined;
  const run = useQuery(api.intake.getRun, societyId && canRead && runExists ? { societyId, runId } : "skip") as any;
  const runArgs = societyId && canRead && run ? { societyId, runId } : "skip";
  const queue = useQuery(api.intake.listExtractions, runArgs) as QueueRow[] | undefined;
  const clusters = useQuery(api.intake.listClusters, runArgs) as any[] | undefined;
  const files = useQuery(api.intake.listFiles, runArgs) as any[] | undefined;
  const [statusFilter, setStatusFilter] = useState<"open" | "all">("open");
  const selectedId = params.get("e") ?? undefined;
  const select = useCallback((id: string | undefined, fieldPath?: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("e", id); else next.delete("e");
    if (fieldPath) next.set("f", fieldPath); else next.delete("f");
    setParams(next, { replace: true });
  }, [params, setParams]);

  const visibleQueue = useMemo(() => (queue ?? []).filter((row) => statusFilter === "all" || !CLOSED.has(row.status)), [queue, statusFilter]);
  const groups = useMemo(() => groupQueue(visibleQueue, clusters ?? []), [visibleQueue, clusters]);
  const flat = useMemo(() => groups.flatMap((group) => group.clusters.flatMap((cluster) => [cluster.canonical, ...cluster.versions.map((version) => version.row).filter(Boolean) as QueueRow[]])), [groups]);
  useEffect(() => {
    if (!selectedId && flat.length) select(flat[0]._id);
  }, [selectedId, flat, select]);

  const selectedInRun = Boolean(selectedId && queue?.some((row) => row._id === selectedId));
  const detail = useQuery(api.intake.getExtraction, societyId && selectedId && selectedInRun ? { societyId, extractionId: selectedId } : "skip") as { extraction: any; file: any; extract: any; reviews: ReviewRow[] } | undefined;
  const provenance = useQuery(api.intake.provenanceForExtraction, societyId && selectedId && detail?.extraction?.status === "promoted" ? { societyId, extractionId: selectedId } : "skip") as any[] | undefined;
  const log = useQuery(api.intake.processingLog, runArgs) as any[] | undefined;

  const reviewFields = usePermissionedMutation(api.intake.reviewFields, canWrite);
  const undoReviews = usePermissionedMutation(api.intake.undoReviews, canWrite);
  const promoteExtraction = usePermissionedMutation(api.intake.promoteExtraction, canWrite);
  const setExtractionStatus = usePermissionedMutation(api.intake.setExtractionStatus, canWrite);
  const linkNameAcrossRun = usePermissionedMutation(api.intake.linkNameAcrossRun, canWrite);
  const bulkAccept = usePermissionedMutation(api.intake.bulkAccept, canWrite);
  const storeOriginals = useStoreOriginals(canWrite && can("documents:write"));

  const extraction = detail?.extraction;
  const fields = useMemo(() => (extraction ? reviewFieldsForRecord(extraction.record, extraction.docClass) : []), [extraction]);
  const decisions = useMemo(() => latestDecisions(detail?.reviews ?? []), [detail?.reviews]);
  const readiness = useMemo(() => promotionReadiness(fields, decisions, extraction?.docClass), [fields, decisions, extraction?.docClass]);
  const promotable = Boolean(extraction && (extraction.docClass === "meetingMinutes" || CLASS_PROMOTION[extraction.docClass]));
  const selectedPath = params.get("f") ?? undefined;
  const selectedField = fields.find((field) => field.path === selectedPath);
  const readOnly = !canWrite || CLOSED.has(String(extraction?.status));
  const [tab, setTab] = useState<Tab>("fields");
  const [bulkScope, setBulkScope] = useState<{ group?: ReviewGroup; itemIndex?: number } | null>(null);
  const [gapField, setGapField] = useState<ReviewField | null>(null);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const lastBatch = useRef<{ ids: string[]; at: number } | null>(null);

  const versions: ClusterVersion[] = useMemo(() => {
    if (!detail?.file?.clusterKey || !clusters) return [];
    const cluster = clusters.find((candidate) => candidate.clusterKey === detail.file.clusterKey);
    const names = new Map((files ?? []).map((file) => [file.fileKey, file.name]));
    return (cluster?.members ?? []).filter((member: any) => member.fileKey !== detail.file.fileKey).map((member: any) => ({ fileId: member.fileId, fileKey: member.fileKey, name: names.get(member.fileKey) ?? member.fileKey.replace(/^local:/, ""), relation: member.relation, reason: member.reason }));
  }, [detail?.file, clusters, files]);

  const decide = useCallback(async (items: Array<{ field: ReviewField; decision: string; editedValue?: unknown; gap?: CantRepresentDraft }>, label?: string) => {
    if (!societyId || !selectedId || !items.length) return;
    try {
      const result = await reviewFields({
        societyId,
        items: items.map(({ field, decision, editedValue, gap }) => ({
          extractionId: selectedId, fieldPath: field.path, decision,
          ...(decision === "edit" ? { editedValue } : {}),
          ...(gap ? { gap: { infoType: gap.infoType, reason: gap.reason, description: gap.description, suggestedTarget: gap.suggestedTarget } } : {}),
        })),
      });
      if (label) {
        lastBatch.current = { ids: result.reviewIds, at: Date.now() };
        toast.success(label, { duration: UNDO_MS, action: { label: "Undo", onClick: () => void undo(result.reviewIds) } });
      }
      return result;
    } catch (error) {
      toast.error("Could not save the decision", error instanceof Error ? error.message : undefined);
    }
  }, [societyId, selectedId, reviewFields, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const undo = async (ids: string[]) => {
    if (!societyId) return;
    try {
      let removed = 0;
      for (let offset = 0; offset < ids.length; offset += 1000) removed += (await undoReviews({ societyId, reviewIds: ids.slice(offset, offset + 1000) })).removed ?? 0;
      toast.info(`Undid ${pluralize(removed, "decision")}`);
    } catch (error) {
      toast.error("Could not undo", error instanceof Error ? error.message : undefined);
    }
  };

  const nextUnreviewed = useCallback((from?: string) => {
    const start = Math.max(0, fields.findIndex((field) => field.path === from));
    return fields.slice(start + 1).find((field) => !decisions.has(field.path)) ?? fields.find((field) => !decisions.has(field.path));
  }, [fields, decisions]);

  const onDecide: FieldDecisionHandler = (field, decision, editedValue) => {
    if (decision === "cant_represent") {
      setGapField(field);
      return;
    }
    void decide([{ field, decision, editedValue }]).then((result) => {
      if (result && field.path === selectedPath) {
        const next = nextUnreviewed(field.path);
        if (next) select(selectedId, next.path);
      }
    });
  };

  const bulkCandidates = useMemo(() => (bulkScope && extraction ? bulkAcceptCandidates(fields, decisions, extraction.docClass, bulkScope) : []), [bulkScope, fields, decisions, extraction]);
  const allBulk = useMemo(() => (extraction ? bulkAcceptCandidates(fields, decisions, extraction.docClass) : []), [fields, decisions, extraction]);
  // Run-wide scopes for bulk accept: the version cluster, the body and year, the class.
  const runBulkScopes: RunBulkScope[] = useMemo(() => {
    if (!extraction) return [];
    const scopes: RunBulkScope[] = [];
    if (detail?.file?.clusterKey) scopes.push({ id: "cluster", label: "Version cluster", scope: { clusterKey: detail.file.clusterKey } });
    const year = String(extraction.record?.date?.value?.iso ?? "").slice(0, 4);
    const bodyValue = extraction.record?.body?.value;
    if (bodyValue && /^\d{4}$/.test(year)) scopes.push({ id: "body-year", label: `${extraction.record?.bodyLabel?.value ?? bodyValue} ${year}`, scope: { body: String(bodyValue), year } });
    scopes.push({ id: "class", label: `All ${extraction.docClass === "meetingMinutes" ? "minutes" : `${CLASS_PROMOTION[extraction.docClass]?.noun ?? extraction.docClass} documents`} in the run`, scope: { docClass: extraction.docClass } });
    scopes.push({ id: "all", label: "Every document in the run", scope: { all: true } });
    return scopes;
  }, [extraction, detail?.file?.clusterKey]);

  const promote = async (choice: PromoteChoice) => {
    if (!societyId || !selectedId) return;
    setBusy(true);
    try {
      const result = await promoteExtraction({ societyId, extractionId: selectedId, mode: choice.mode, ...(choice.targetMeetingId ? { targetMeetingId: choice.targetMeetingId } : {}) });
      setPromoteOpen(false);
      const stored = await storeOriginals(societyId, result.sourceDocuments ?? []);
      const fileNote = stored.skipped ? "Originals stay in this browser's intake cache." : stored.stored ? `${pluralize(stored.stored, "original file")} saved as document versions.` : stored.missing ? "The original file is not on this device; the source document keeps the extracted text." : "";
      const coveredNote = result.covered ? ` ${pluralize(result.covered, "other copy", "other copies")} of this document ${result.covered === 1 ? "is" : "are"} now covered.` : "";
      const first = (result.targets ?? []).find((target: any) => target.table !== "meetingMaterials") ?? result.targets?.[0];
      const title = extraction?.docClass === "meetingMinutes"
        ? (result.merged ? "Merged into the existing meeting" : "Meeting created")
        : first ? `${pluralize((result.targets ?? []).filter((target: any) => target.table !== "meetingMaterials").length || 1, "record")} created from the ${CLASS_PROMOTION[extraction?.docClass]?.noun ?? "document"}`
        : result.gaps ? `The ${CLASS_PROMOTION[extraction?.docClass]?.noun ?? "document"} was recorded as system gaps` : `The ${CLASS_PROMOTION[extraction?.docClass]?.noun ?? "document"} was filed as a source document`;
      toast.success(title, {
        description: `${pluralize(result.provenance, "field")} with source locators${result.gaps ? `, ${pluralize(result.gaps, "system gap")}` : ""}.${coveredNote} ${fileNote}`,
        duration: 9000,
        ...(first ? { action: { label: `Open ${(TABLE_NOUN[first.table] ?? "record").toLowerCase()}`, onClick: () => navigate(recordHref(first.table, first.id)) } } : {}),
      });
      const index = flat.findIndex((row) => row._id === selectedId);
      const next = flat.slice(index + 1).find((row) => !CLOSED.has(row.status) && row._id !== selectedId);
      if (next && statusFilter === "open") select(next._id);
    } catch (error) {
      toast.error("Could not promote", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  // Promote every open document whose required fields are accepted (after a run-wide bulk accept).
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const promoteAllReady = async () => {
    if (!societyId) return;
    const rank = (row: QueueRow) => (row.docClass === "meetingMinutes" ? 0 : ["agenda", "meetingPackage", "agmMaterial"].includes(row.docClass) ? 1 : 2);
    const rows = flat.filter((row) => !CLOSED.has(row.status) && (row.docClass === "meetingMinutes" || CLASS_PROMOTION[row.docClass])).map((row, index) => ({ row, index })).sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index).map(({ row }) => row);
    if (!rows.length) return;
    const ok = await confirm({
      title: `Promote every ready document (${rows.length})?`,
      message: "Each document whose required fields you accepted becomes native records, one at a time: minutes first (merging into a meeting with the same date and body), then agendas, then policies, people, filings, statements and the rest. Only accepted fields are written, each with its source locator. Documents still missing a required field are skipped and stay in the queue. Every promotion is kept as an import session.",
      confirmLabel: "Promote ready documents",
    });
    if (!ok) return;
    setBatch({ done: 0, total: rows.length });
    let promoted = 0, covered = 0;
    const skipped: string[] = [];
    const failed: string[] = [];
    for (const [index, row] of rows.entries()) {
      try {
        const result = await promoteExtraction({ societyId, extractionId: row._id, mode: "auto" });
        promoted++;
        covered += result.covered ?? 0;
        await storeOriginals(societyId, result.sourceDocuments ?? []);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/copy of this document|already promoted/i.test(message)) { /* covered by a copy promoted earlier in this batch */ }
        else if (/Accept or edit|exact day|Accept the meeting date/i.test(message)) skipped.push(row.fileKey.replace(/^local:/, "").split("/").pop() ?? row.fileKey);
        else failed.push(`${row.fileKey.replace(/^local:/, "").split("/").pop()}: ${message}`);
      }
      setBatch({ done: index + 1, total: rows.length });
    }
    setBatch(null);
    const parts = [`${pluralize(promoted, "document")} promoted`, covered ? `${pluralize(covered, "copy", "copies")} covered` : "", skipped.length ? `${skipped.length} still ${skipped.length === 1 ? "needs" : "need"} a required field` : "", failed.length ? `${failed.length} failed` : ""].filter(Boolean).join(" · ");
    if (failed.length) toast.error(parts, failed.slice(0, 3).join("\n"));
    else toast.success(parts, skipped.length ? { description: `Open "To review" to finish: ${skipped.slice(0, 4).join(", ")}${skipped.length > 4 ? "…" : ""}`, duration: 9000 } : undefined);
  };

  const rejectDocument = async () => {
    if (!societyId || !selectedId) return;
    const ok = await confirm({ title: "Reject this document?", message: `${detail?.file?.name ?? "This document"} will not be promoted. Its ${pluralize(decisions.size, "field decision")} stay on record and you can reopen it later.`, confirmLabel: "Reject document", tone: "danger" });
    if (!ok) return;
    await setExtractionStatus({ societyId, extractionId: selectedId, status: "rejected" }).catch((error: unknown) => toast.error("Could not reject", error instanceof Error ? error.message : undefined));
  };

  // Keyboard: J/K documents, N/P fields, A accept, R reject, E edit, C can't represent, B bulk accept, ? help.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable=true], [role=dialog]") || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      const docIndex = flat.findIndex((row) => row._id === selectedId);
      // The URL is updated synchronously on selection; read it so a fast key press never acts on the previous field.
      const livePath = new URLSearchParams(window.location.search).get("f") ?? selectedPath;
      const fieldIndex = fields.findIndex((field) => field.path === livePath);
      const current = fields[fieldIndex];
      if (key === "j" || key === "k") {
        const next = flat[docIndex + (key === "j" ? 1 : -1)];
        if (next) select(next._id);
      } else if (key === "n" || key === "p") {
        const next = fields[fieldIndex + (key === "n" ? 1 : -1)] ?? fields[0];
        if (next) select(selectedId, next.path);
      } else if (current && !readOnly && key === "a") onDecide(current, "accept");
      else if (current && !readOnly && key === "r") onDecide(current, "reject");
      else if (current && !readOnly && key === "c") onDecide(current, "cant_represent");
      else if (current && !readOnly && key === "e") document.querySelector(`[data-path="${CSS.escape(current.path)}"]`)?.dispatchEvent(new Event("intake:edit"));
      else if (!readOnly && key === "b") setBulkScope({});
      else if (key === "?") setShowKeys((value) => !value);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  if (society === undefined) return <PageLoading />;
  if (!society) return <SeedPrompt />;
  if (loaded && !canRead) return <div className="page"><PageHeader title="Intake review" /><Banner tone="info">Reviewing intake runs needs settings read access.</Banner></div>;
  if (runExists === false) return <RecordNotFound recordLabel="Intake run" backTo="/app/intake" backLabel="All intake runs" />;
  if (run === undefined || queue === undefined) return <PageLoading />;

  const promotedTotal = (queue ?? []).filter((row) => row.status === "promoted").length;
  const coveredTotal = (queue ?? []).filter((row) => row.status === "covered").length;
  const rejectedTotal = (queue ?? []).filter((row) => row.status === "rejected").length;
  const meetingLink = provenance?.find((row) => row.targetTable === "meetings")?.targetId;
  const promotedTargets: Array<{ table: string; id: string; label: string }> = (extraction?.promotion?.targets ?? []).filter((target: any) => target.table !== "meetingMaterials");
  const fileLog = (log ?? []).filter((entry) => !entry.fileKey || entry.fileKey === detail?.file?.fileKey);
  const locator = selectedField?.field.locators?.[0];
  const recordDate = extraction?.record?.date?.value?.iso as string | undefined;
  const body = extraction?.record?.body?.value as string | undefined;

  return (
    <div className="page page--wide intake-review">
      <PageHeader
        title={<>Review: {run.name}</>}
        routeKey="/app/intake"
        subtitle={`${pluralize(queue.length, "document")} · ${promotedTotal} promoted · ${run.counts?.files ?? 0} files in the run`}
        actions={<>
          <Link className="btn-action" to="/app/intake"><ArrowLeft size={12} /> All runs</Link>
          <Link className="btn-action" to={`/app/intake?run=${runId}`}><Layers size={12} /> Run details</Link>
        </>}
      />
      <div className="intake-review__bar">
        <div className="segmented" role="group" aria-label="Queue filter">
          <button type="button" className={`segmented__btn${statusFilter === "open" ? " is-active" : ""}`} aria-pressed={statusFilter === "open"} onClick={() => setStatusFilter("open")}>To review</button>
          <button type="button" className={`segmented__btn${statusFilter === "all" ? " is-active" : ""}`} aria-pressed={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All</button>
        </div>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => setShowKeys((value) => !value)} aria-expanded={showKeys}><Keyboard size={12} /> Shortcuts</button>
        {canWrite && queue.some((row) => !CLOSED.has(row.status)) && (
          <button type="button" className="btn btn--sm btn--accent" onClick={() => void promoteAllReady()} disabled={Boolean(batch)} data-testid="intake-promote-all" title="Promote every open document whose required fields are accepted">
            <Upload size={12} /> {batch ? `Promoting ${batch.done}/${batch.total}…` : "Promote all ready…"}
          </button>
        )}
        {showKeys && (
          <div className="intake-shortcuts" role="note">
            <span><kbd className="intake-kbd">J</kbd>/<kbd className="intake-kbd">K</kbd> next/previous document</span>
            <span><kbd className="intake-kbd">N</kbd>/<kbd className="intake-kbd">P</kbd> next/previous field</span>
            <span><kbd className="intake-kbd">A</kbd> accept · <kbd className="intake-kbd">E</kbd> edit · <kbd className="intake-kbd">R</kbd> reject · <kbd className="intake-kbd">C</kbd> can't represent</span>
            <span><kbd className="intake-kbd">B</kbd> bulk accept · <kbd className="intake-kbd">?</kbd> this help</span>
          </div>
        )}
        <AddRunPeopleButton societyId={society._id} people={run.reconciliation?.people} canWrite={canWrite && can("members:write")} />
        {run.status === "running" && <Badge tone="info">Run still in progress</Badge>}
        {run.status === "failed" && <Badge tone="danger">Run failed: {run.stats?.error ?? "see run details"}</Badge>}
      </div>

      {!queue.length && <Banner tone="info">This run has no extracted documents to review{run.status === "running" ? " yet" : ""}. {run.counts?.byDisposition?.catalogue ? `${run.counts.byDisposition.catalogue} files were catalogued only (no minutes extractor for their class).` : ""}</Banner>}

      {queue.length > 0 && !visibleQueue.length && (
        <section className="card intake-done" data-testid="intake-review-done" aria-labelledby="intake-done-title">
          <div className="card__body col" style={{ gap: 10 }}>
            <h2 className="card__title" id="intake-done-title">Every document in this run has been reviewed</h2>
            <p className="muted" style={{ margin: 0 }}>
              {pluralize(promotedTotal, "document")} promoted
              {coveredTotal ? `, ${pluralize(coveredTotal, "copy", "copies")} covered by a promoted copy` : ""}
              {rejectedTotal ? `, ${rejectedTotal} rejected` : ""}.
              {(run.recordGaps?.length ?? 0) > 0 ? ` The run found ${pluralize(run.recordGaps.length, "record gap")} (missing minutes, AGMs without minutes, unadopted policies) to follow up in Coverage & gaps.` : ""}
            </p>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <Link className="btn btn--accent" to="/app/coverage?tab=record">Open Coverage &amp; gaps</Link>
              <Link className="btn" to="/app/meetings">Meetings</Link>
              <button type="button" className="btn" onClick={() => setStatusFilter("all")}>Show all documents</button>
              <Link className="btn btn--ghost" to="/app/intake">Start another run</Link>
            </div>
          </div>
        </section>
      )}

      {visibleQueue.length > 0 && (
        <div className="intake-panes">
          <nav className="intake-pane intake-pane--queue" aria-label="Review queue">
            <div className="intake-pane__head"><h2>Queue</h2><span className="muted" style={{ fontSize: 11 }}>{visibleQueue.length} shown</span></div>
            <div className="intake-pane__body">
              <QueueList groups={groups} selectedId={selectedId} onSelect={(id) => select(id)} />
            </div>
          </nav>

          {detail ? (
            <SourceViewer societyId={society._id} file={detail.file} extract={detail.extract} locator={locator ? { ...locator, fieldPath: selectedPath } : undefined} versions={versions} />
          ) : (
            <div className="intake-pane intake-pane--viewer"><div className="intake-pane__body"><p className="muted" style={{ padding: 12 }}>{selectedId ? "Loading…" : "Choose a document."}</p></div></div>
          )}

          <section className="intake-pane intake-pane--fields" aria-label="Native record">
            {detail && extraction ? (
              <>
                <div className="intake-pane__head">
                  <h2>{CLASS_TITLE[extraction.docClass] ?? extraction.docClass}</h2>
                  <Badge tone={STATUS_TONE[extraction.status] ?? "neutral"}>{STATUS_LABEL[extraction.status] ?? extraction.status}</Badge>
                  <span className="muted" style={{ fontSize: 11 }}>{extraction.engine}{extraction.model ? ` · ${extraction.model}` : ""}</span>
                  {detail.file.sensitivity === "restricted" && <Badge tone="danger"><Lock size={10} /> restricted</Badge>}
                </div>
                <div className="intake-tabs" role="tablist" aria-label="Review panels">
                  {(["fields", "people", "gaps", "log"] as Tab[]).map((id) => (
                    <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                      {id === "fields" ? `Fields (${readiness.reviewed}/${readiness.total})` : id === "people" ? "People" : id === "gaps" ? "Gaps" : `Log (${fileLog.length})`}
                    </button>
                  ))}
                </div>
                <div className="intake-pane__body">
                  {extraction.verification?.mismatched > 0 && tab === "fields" && <Banner tone="danger">{pluralize(extraction.verification.mismatched, "quote")} could not be re-found in the source. Those fields need a person.</Banner>}
                  {tab === "fields" && <FieldList docClass={extraction.docClass} fields={fields} decisions={decisions} selectedPath={selectedPath} onSelect={(field) => select(selectedId, field.path)} onDecide={onDecide} onBulkItem={(group, itemIndex) => setBulkScope({ group, itemIndex })} readOnly={readOnly} />}
                  {tab === "people" && <EntityPanel societyId={society._id} extractionId={extraction._id} readOnly={readOnly}
                    onShow={(path) => { setTab("fields"); select(selectedId, path); }}
                    onLink={(group: EntityGroup, personId: string, fullName: string) => void linkNameAcrossRun({ societyId: society._id, runId, name: group.name, personId }).then((result: any) => {
                      toast.success(`Linked "${group.name}" to ${fullName}`, { description: `${pluralize(result.occurrences, "occurrence")} in ${pluralize(result.extractions, "document")}.`, duration: UNDO_MS, action: { label: "Undo", onClick: () => void undo(result.reviewIds) } });
                    }).catch((error: unknown) => toast.error("Could not link", error instanceof Error ? error.message : undefined))}
                    onAcceptAsWritten={(group: EntityGroup) => void linkNameAcrossRun({ societyId: society._id, runId, name: group.name, mode: "accept" }).then((result: any) => {
                      toast.success(`Accepted "${group.name}" as written`, { description: `${pluralize(result.occurrences, "occurrence")} in ${pluralize(result.extractions, "document")}.`, duration: UNDO_MS, action: { label: "Undo", onClick: () => void undo(result.reviewIds) } });
                    }).catch((error: unknown) => toast.error("Could not accept", error instanceof Error ? error.message : undefined))}
                  />}
                  {tab === "gaps" && <GapPanel societyId={society._id} runId={runId} runGaps={run.recordGaps ?? []} body={body} date={recordDate} />}
                  {tab === "log" && (
                    <ul className="intake-sample" style={{ padding: 8 }}>
                      {fileLog.map((entry) => (
                        <li key={entry._id}>
                          <span className="mono" style={{ fontSize: 10 }}>{entry.atISO.slice(0, 19).replace("T", " ")}</span> · <strong>{entry.stage}</strong>
                          {entry.sentToProvider ? <> · <Badge tone="warn">sent to {entry.provider} {entry.model}</Badge></> : entry.stage.startsWith("llm") ? <> · <Badge>not sent</Badge></> : null}
                          {entry.redactions && Object.keys(entry.redactions).length > 0 && <div className="muted">masked before sending: {Object.entries(entry.redactions).map(([kind, count]) => `${kind} ${count}`).join(", ")}</div>}
                          {entry.note && <div className="muted">{entry.note}</div>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="intake-record-bar">
                  <div className="intake-readiness" aria-live="polite">
                    {fields.filter((field) => field.required).map((field) => {
                      const decision = decisions.get(field.path)?.decision;
                      const ok = decision === "accept" || decision === "edit";
                      return <span key={field.path} className={`intake-chip intake-chip--${ok ? "high" : "low"}`}>{ok ? "✓" : "✗"} {field.label}</span>;
                    })}
                    <span className="muted">{readiness.promoted} accepted · {readiness.rejected} rejected/gap · {readiness.unreviewed} unreviewed</span>
                  </div>
                  {extraction.status === "promoted" ? (
                    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                      <Badge tone="success">Promoted</Badge>
                      {promotedTargets.length > 0
                        ? promotedTargets.slice(0, 4).map((target) => <Link key={`${target.table}:${target.id}`} className="btn btn--sm" to={recordHref(target.table, target.id)}><ExternalLink size={12} /> {TABLE_NOUN[target.table] ?? target.table}: {target.label}</Link>)
                        : meetingLink && <Link className="btn btn--sm btn--accent" to={`/app/meetings/${meetingLink}`}><ExternalLink size={12} /> Open meeting</Link>}
                      {promotedTargets.length > 4 && <span className="muted" style={{ fontSize: 11 }}>+{promotedTargets.length - 4} more</span>}
                      <span className="muted" style={{ fontSize: 11 }}>{pluralize(provenance?.length ?? 0, "field")} with provenance</span>
                    </div>
                  ) : extraction.status === "covered" ? (
                    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                      <Badge tone="success">Covered</Badge>
                      <span className="muted" style={{ fontSize: 12 }}>A copy of this document ({String(extraction.promotion?.coveredByFileKey ?? "").replace(/^local:/, "").split("/").pop()}) was promoted; this file is cited as a source of the same record.</span>
                      {canWrite && <button type="button" className="btn btn--sm" onClick={() => void setExtractionStatus({ societyId: society._id, extractionId: extraction._id, status: "in_review" })}><RotateCcw size={12} /> Review separately</button>}
                    </div>
                  ) : extraction.status === "rejected" ? (
                    <div className="row">
                      <Badge tone="danger">Rejected</Badge>
                      {canWrite && <button type="button" className="btn btn--sm" onClick={() => void setExtractionStatus({ societyId: society._id, extractionId: extraction._id, status: "in_review" })}><RotateCcw size={12} /> Reopen</button>}
                    </div>
                  ) : (
                    <div className="row">
                      <button type="button" className="btn btn--sm" disabled={readOnly} onClick={() => setBulkScope({})} data-testid="intake-bulk-open"><CheckCheck size={12} /> Bulk accept ({allBulk.length})</button>
                      <button type="button" className="btn btn--sm btn--accent" disabled={readOnly || !promotable} onClick={() => setPromoteOpen(true)} data-testid="intake-promote-open" title={!promotable ? "There is no native record type for this class yet; mark its facts as system gaps (C)." : readiness.ready ? "Promote accepted fields to native records" : `Accept ${readiness.missing.join(" and ").toLowerCase()} first`}><Upload size={12} /> Promote…</button>
                      <button type="button" className="btn btn--sm btn--ghost" disabled={readOnly} onClick={() => void rejectDocument()}><CircleSlash size={12} /> Reject document</button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="intake-pane__body"><p className="muted" style={{ padding: 12 }}>{selectedId ? "Loading…" : "Choose a document from the queue."}</p></div>
            )}
          </section>
        </div>
      )}

      {extraction && (
        <BulkAcceptModal
          open={Boolean(bulkScope)}
          onClose={() => setBulkScope(null)}
          candidates={bulkCandidates}
          docClass={extraction.docClass}
          scopeLabel={bulkScope?.itemIndex !== undefined ? `${bulkScope.group} item ${bulkScope.itemIndex + 1}` : bulkScope?.group ? `${bulkScope.group} fields` : "this document"}
          busy={busy}
          societyId={society._id}
          runId={runId}
          runScopes={bulkScope && !bulkScope.group ? runBulkScopes : []}
          onConfirm={() => {
            const items = bulkCandidates.map((field) => ({ field, decision: "accept" }));
            setBulkScope(null);
            void decide(items, `Accepted ${pluralize(items.length, "field")}`);
          }}
          onConfirmRun={(scope) => {
            setBulkScope(null);
            // Large scopes are accepted in batches of whole documents (≤ 5,000 fields per transaction).
            void (async () => {
              const reviewIds: string[] = [];
              let fieldsAccepted = 0;
              let documents = 0;
              for (let round = 0; round < 200; round++) {
                const result: any = await bulkAccept({ societyId: society._id, runId, scope: scope.scope });
                reviewIds.push(...(result.reviewIds ?? []));
                fieldsAccepted += result.fields ?? 0;
                documents += result.extractions ?? 0;
                if (!result.remainingFields || !result.fields) break;
              }
              toast.success(`Accepted ${pluralize(fieldsAccepted, "field")} in ${pluralize(documents, "document")}`, { duration: UNDO_MS, action: { label: "Undo", onClick: () => void undo(reviewIds) } });
            })().catch((error: unknown) => toast.error("Could not bulk accept", error instanceof Error ? error.message : undefined));
          }}
        />
      )}
      <CantRepresentModal field={gapField} onClose={() => setGapField(null)} onConfirm={(draft) => {
        const field = gapField!;
        setGapField(null);
        void decide([{ field, decision: "cant_represent", gap: draft }]).then((result) => {
          if (result) toast.success("System gap recorded", { description: "It appears in Coverage & gaps and links to the meeting on promotion." });
        });
      }} />
      {extraction && (
        <PromoteModal
          open={promoteOpen}
          onClose={() => setPromoteOpen(false)}
          onConfirm={(choice) => void promote(choice)}
          societyId={society._id}
          extractionId={extraction._id}
          docClass={extraction.docClass}
          readiness={readiness}
          unsupported={extraction.unsupported?.length ?? 0}
          gapsRecorded={[...decisions.values()].filter((review) => review.decision === "cant_represent").length}
          busy={busy}
          storeNote={canStoreOriginals() ? "The original file (when it is on this device) is saved as a version of the source document." : "This runtime has no file store: the source document keeps the extracted text; the original stays in this browser's intake cache."}
        />
      )}
    </div>
  );
}

function QueueList({ groups, selectedId, onSelect }: { groups: ReturnType<typeof groupQueue>; selectedId?: string; onSelect: (id: string) => void }) {
  const list = useRef<HTMLUListElement>(null);
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button[data-extraction]") ?? []);
    const index = buttons.findIndex((button) => button === document.activeElement);
    const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
      onSelect(next.dataset.extraction!);
    }
  };
  const item = (row: QueueRow, extra?: string) => (
    <button type="button" className="intake-queue__item" data-extraction={row._id} aria-current={row._id === selectedId} tabIndex={row._id === selectedId ? 0 : -1} onClick={() => onSelect(row._id)}>
      <span className="intake-queue__title">{row.fileKey.replace(/^local:/, "").split("/").pop()}</span>
      <span className="intake-queue__meta">
        {row.docClass === "meetingMinutes"
          ? <>{row.date ?? "no date"}{row.body ? ` · ${row.body}` : ""} · {pluralize(row.motions, "motion")}</>
          : <>{row.summary ?? row.docClass}{row.date ? ` · ${row.date}` : ""}</>}
        <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{STATUS_LABEL[row.status] ?? row.status}</Badge>
        {(row.verification?.mismatched ?? 0) > 0 && <Badge tone="danger">{row.verification!.mismatched} unverified</Badge>}
        {extra && <span>{extra}</span>}
      </span>
    </button>
  );
  return (
    <ul className="intake-queue" ref={list} onKeyDown={onKeyDown} data-testid="intake-queue">
      {groups.map((group) => (
        <li key={group.tier}>
          <div className="intake-queue__tier">{TIER_LABEL[group.tier]} · {group.clusters.length}</div>
          <ul className="intake-queue" style={{ padding: 0 }}>
            {group.clusters.map((cluster) => (
              <li key={cluster.key}>
                {item(cluster.canonical, cluster.versions.length ? `${cluster.versions.length} other cop${cluster.versions.length === 1 ? "y" : "ies"}` : undefined)}
                {cluster.versions.length > 0 && (
                  <ul className="intake-queue__versions" aria-label="Versions">
                    {cluster.versions.map((version) => (
                      <li key={version.fileKey} className="intake-queue__version">
                        {version.row ? item(version.row, version.relation.replace(/-/g, " ")) : <span>{version.fileKey.replace(/^local:/, "").split("/").pop()} · {version.relation.replace(/-/g, " ")}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
