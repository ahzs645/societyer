import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Badge, InspectorNote } from "../../components/ui";
import { Select } from "../../components/Select";
import { Segmented } from "../../components/primitives";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { distinguishSessionNames } from "../../../shared/importSessionLabels";
import { REVIEW_RISK_LABELS, type ReviewRiskLevel } from "../../../shared/importReviewRisk";
import { importKindLabel, importTargetLabel } from "./importKindLabels";
import { Check, ChevronLeft, ChevronRight, ExternalLink, FileText, Keyboard, Pencil, SkipForward, X } from "lucide-react";

export type QueueFilters = {
  status: "Pending" | "Approved" | "Rejected" | "all";
  recordKind?: string;
  targetModule?: string;
  sessionId?: string;
  risk?: string;
  source?: string;
  search?: string;
  sort?: "priority" | "session";
  page: number;
};

export const DEFAULT_QUEUE_FILTERS: QueueFilters = { status: "Pending", page: 0, sort: "priority" };
const PAGE_SIZE = 50;

type Decision = "Approved" | "Rejected" | "Pending";

/**
 * The cross-session review queue (findings D-07 to D-10): one list over every
 * pending import candidate, filters with counts, progress, priority by legal
 * weight and missing facts, provenance beside each decision, and a keyboard
 * flow (j/k move, a approve, r reject, e edit, n skip, o open source) that
 * keeps focus in the queue and moves on after every decision.
 */
export function ImportReviewQueue({
  societyId,
  canWrite,
  filters,
  onFiltersChange,
  onEdit,
  onSessionPicked,
}: {
  societyId: string;
  canWrite: boolean;
  filters: QueueFilters;
  onFiltersChange: (next: QueueFilters) => void;
  onEdit: (recordId: string) => void;
  onSessionPicked?: (sessionId: string) => void;
}) {
  const args = {
    societyId,
    status: filters.status,
    recordKind: filters.recordKind,
    targetModule: filters.targetModule,
    sessionId: filters.sessionId,
    risk: filters.risk,
    source: filters.source,
    search: filters.search?.trim() || undefined,
    sort: filters.sort,
    offset: filters.page * PAGE_SIZE,
    limit: PAGE_SIZE,
  };
  const live = useQuery(api.importSessions.reviewQueue, args);
  // Keep showing the previous page while a new filter loads, so the list never
  // collapses to a spinner between keystrokes.
  const lastRef = useRef<any>(null);
  if (live !== undefined) lastRef.current = live;
  const data = live ?? lastRef.current;
  const updateRecord = useMutation(api.importSessions.updateRecord);
  const bulkSetStatus = useMutation(api.importSessions.bulkSetStatus);
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [decided, setDecided] = useState<Map<string, Decision>>(new Map());
  const [focusIndex, setFocusIndex] = useState(0);
  const [searchDraft, setSearchDraft] = useState(filters.search ?? "");
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => { setSearchDraft(filters.search ?? ""); }, [filters.search]);
  useEffect(() => {
    const handle = window.setTimeout(() => {
      if ((filters.search ?? "") !== searchDraft) onFiltersChange({ ...filters, search: searchDraft || undefined, page: 0 });
    }, 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  // Decisions already reflected by the server stop being "optimistic".
  useEffect(() => {
    if (!live || !decided.size) return;
    const next = new Map(decided);
    let changed = false;
    for (const item of live.items as any[]) {
      if (next.has(item._id) && next.get(item._id) === item.status) { next.delete(item._id); changed = true; }
    }
    if (changed) setDecided(next);
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps

  const items: any[] = useMemo(() => {
    const rows = (data?.items ?? []) as any[];
    return rows
      .map((item) => (decided.has(item._id) ? { ...item, status: decided.get(item._id) } : item))
      .filter((item) => filters.status === "all" || item.status === filters.status || !decided.has(item._id));
  }, [data, decided, filters.status]);
  const hiddenByDecision = useMemo(() => {
    const rows = (data?.items ?? []) as any[];
    return rows.filter((item) => decided.has(item._id) && filters.status !== "all" && decided.get(item._id) !== filters.status).length;
  }, [data, decided, filters.status]);

  const sessions: any[] = useMemo(() => data?.sessions ?? [], [data]);
  const labels = useMemo(() => {
    const computed = distinguishSessionNames(sessions.map((session) => String(session.name ?? "")));
    return new Map(sessions.map((session, index) => [String(session._id), computed[index]]));
  }, [sessions]);

  const clampedIndex = Math.min(focusIndex, Math.max(0, items.length - 1));
  const focused = items[clampedIndex];
  useEffect(() => {
    if (focused) rowRefs.current.get(focused._id)?.scrollIntoView({ block: "nearest" });
  }, [focused?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFilter = (patch: Partial<QueueFilters>) => {
    setFocusIndex(0);
    onFiltersChange({ ...filters, ...patch, page: patch.page ?? 0 });
  };

  const decide = useCallback(async (item: any, status: Decision) => {
    if (!canWrite || !item) return;
    setDecided((prev) => new Map(prev).set(item._id, status));
    // In a filtered view the decided row leaves the list, so the next row
    // slides into the focused position; in "All" step to the next row.
    if (filters.status === "all") setFocusIndex((index) => index + 1);
    listRef.current?.focus({ preventScroll: true });
    try {
      await updateRecord({ recordId: item._id, status });
    } catch (error: any) {
      setDecided((prev) => { const next = new Map(prev); next.delete(item._id); return next; });
      toast.error(error?.message ?? "Could not update import record", item.title);
    }
  }, [canWrite, filters.status, toast, updateRecord]);

  const bulk = async (status: "Approved" | "Rejected") => {
    const targets = items.filter((item) => item.status !== status);
    if (!targets.length) return;
    const restricted = targets.filter((item) => item.risk?.restricted).length;
    const highRisk = targets.filter((item) => item.risk?.level === "high").length;
    const bySession = new Map<string, string[]>();
    for (const item of targets) bySession.set(item.sessionId, [...(bySession.get(item.sessionId) ?? []), item._id]);
    const ok = await confirm({
      title: `${status === "Approved" ? "Approve" : "Reject"} ${targets.length} shown candidate${targets.length === 1 ? "" : "s"}?`,
      message: `${targets.length} record${targets.length === 1 ? "" : "s"} across ${bySession.size} session${bySession.size === 1 ? "" : "s"} will be marked ${status.toLowerCase()}.${highRisk ? ` ${highRisk} ${highRisk === 1 ? "is" : "are"} high priority.` : ""}${restricted ? ` ${restricted} may contain restricted information.` : ""} Only the ${targets.length} rows on this page change — not every match.${status === "Approved" ? " Nothing is applied to the app until you run an apply step." : ""}`,
      confirmLabel: `${status === "Approved" ? "Approve" : "Reject"} ${targets.length}`,
      tone: status === "Rejected" ? "danger" : undefined,
    });
    if (!ok) return;
    setDecided((prev) => { const next = new Map(prev); for (const item of targets) next.set(item._id, status); return next; });
    try {
      let updated = 0;
      for (const [sessionId, recordIds] of bySession) {
        const result = await bulkSetStatus({ sessionId, status, recordIds });
        updated += Number(result?.updated ?? 0);
      }
      toast.success(`${updated} record${updated === 1 ? "" : "s"} ${status.toLowerCase()}`);
    } catch (error: any) {
      setDecided((prev) => { const next = new Map(prev); for (const item of targets) next.delete(item._id); return next; });
      toast.error(error?.message ?? "Could not update import records");
    }
    listRef.current?.focus({ preventScroll: true });
  };

  const openSource = (item: any) => {
    const created = item?.importedTargets?.documents;
    if (created) { navigate(`/app/documents/${created}`); return; }
    if (item?.url) window.open(item.url, "_blank", "noopener,noreferrer");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target !== listRef.current && target.closest("input, textarea, select, [contenteditable=true], [role=combobox], [role=listbox] [role=option]")) return;
    const key = event.key;
    if (key === "j" || key === "ArrowDown") { event.preventDefault(); setFocusIndex(Math.min(clampedIndex + 1, items.length - 1)); }
    else if (key === "k" || key === "ArrowUp") { event.preventDefault(); setFocusIndex(Math.max(clampedIndex - 1, 0)); }
    else if (key === "n") { event.preventDefault(); setFocusIndex(Math.min(clampedIndex + 1, items.length - 1)); }
    else if (key === "a" && focused) { event.preventDefault(); void decide(focused, "Approved"); }
    else if (key === "r" && focused) { event.preventDefault(); void decide(focused, "Rejected"); }
    else if (key === "u" && focused) { event.preventDefault(); void decide(focused, "Pending"); }
    else if (key === "e" && focused && canWrite) { event.preventDefault(); onEdit(focused._id); }
    else if ((key === "o" || key === "Enter") && focused && target === listRef.current) { event.preventDefault(); openSource(focused); }
  };

  const progress = data?.progress ?? { total: 0, reviewed: 0, pending: 0, approved: 0, rejected: 0 };
  const percent = progress.total ? Math.round((progress.reviewed / progress.total) * 100) : 0;
  const total = Math.max(0, (data?.total ?? 0) - hiddenByDecision);
  const firstShown = total ? filters.page * PAGE_SIZE + 1 : 0;
  const lastShown = Math.min(filters.page * PAGE_SIZE + items.length, filters.page * PAGE_SIZE + PAGE_SIZE);
  const facetOptions = (facets: any[] | undefined, label: (value: string) => string, all: string) => [
    { value: "", label: all },
    ...(facets ?? []).map((facet: any) => ({ value: facet.value, label: `${label(facet.value)} (${facet.count.toLocaleString()})` })),
  ];

  return (
    <div className="card import-queue">
      <div className="card__head import-queue__head">
        <div>
          <h2 className="card__title">Review queue</h2>
          <p className="card__subtitle">Every staged candidate across all import sessions, highest priority first.</p>
        </div>
        <div className="import-queue__progress" aria-label="Review progress">
          <div className="import-queue__progress-text">
            <strong>{progress.reviewed.toLocaleString()}</strong> of {progress.total.toLocaleString()} reviewed
            <span className="muted"> · {progress.pending.toLocaleString()} pending</span>
          </div>
          <div className="import-queue__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`${percent}% reviewed`}>
            <span style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>
      <div className="card__body import-queue__filters">
        <Segmented
          value={filters.status}
          onChange={(status) => setFilter({ status })}
          items={[
            { id: "Pending", label: "Pending" },
            { id: "Approved", label: "Approved" },
            { id: "Rejected", label: "Rejected" },
            { id: "all", label: "All" },
          ]}
        />
        <Select aria-label="Record type" className="import-queue__select" value={filters.recordKind ?? ""} onChange={(value) => setFilter({ recordKind: value || undefined })} searchable options={facetOptions(data?.facets?.kinds, importKindLabel, "All record types")} />
        <Select aria-label="Target module" className="import-queue__select" value={filters.targetModule ?? ""} onChange={(value) => setFilter({ targetModule: value || undefined })} searchable options={facetOptions(data?.facets?.targets, importTargetLabel, "All targets")} />
        <Select aria-label="Session" className="import-queue__select" value={filters.sessionId ?? ""} onChange={(value) => { setFilter({ sessionId: value || undefined }); if (value) onSessionPicked?.(value); }} searchable options={facetOptions(data?.facets?.sessions, (id) => labels.get(id)?.primary ?? "Session", "All sessions")} />
        <Select aria-label="Priority" className="import-queue__select" value={filters.risk ?? ""} onChange={(value) => setFilter({ risk: value || undefined })} options={facetOptions(data?.facets?.risks, (value) => REVIEW_RISK_LABELS[value as ReviewRiskLevel] ?? value, "Any priority")} />
        <Select aria-label="Source" className="import-queue__select" value={filters.source ?? ""} onChange={(value) => setFilter({ source: value || undefined })} options={[{ value: "", label: "All sources" }, ...((data?.facets?.sources ?? []) as any[]).map((facet) => ({ value: facet.value, label: `${facet.label} (${facet.count.toLocaleString()})` }))]} />
        <input className="input import-queue__search" aria-label="Search candidates" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search title, file, path, source id…" />
        <Select aria-label="Order" className="import-queue__select" value={filters.sort ?? "priority"} onChange={(value) => setFilter({ sort: value as QueueFilters["sort"] })} options={[{ value: "priority", label: "Priority first" }, { value: "session", label: "Session order" }]} />
      </div>
      <div className="card__body import-queue__toolbar">
        <span className="muted import-queue__count" aria-live="polite">
          {total ? `${firstShown.toLocaleString()}–${lastShown.toLocaleString()} of ${total.toLocaleString()} matching` : live === undefined ? "Loading…" : "No candidates match"}
        </span>
        <span className="import-queue__keys muted"><Keyboard size={12} /> j/k move · a approve · r reject · e edit · n skip · o open source</span>
        <div className="import-queue__bulk">
          <button className="btn-action" disabled={!canWrite || !items.length} onClick={() => { void bulk("Approved"); }}><Check size={12} /> Approve {items.length} shown</button>
          <button className="btn-action" disabled={!canWrite || !items.length} onClick={() => { void bulk("Rejected"); }}><X size={12} /> Reject {items.length} shown</button>
        </div>
      </div>
      <div className="import-queue__layout">
        <div
          ref={listRef}
          className="import-queue__list"
          role="listbox"
          tabIndex={0}
          aria-label="Import candidates"
          aria-activedescendant={focused ? `queue-item-${focused._id}` : undefined}
          onKeyDown={onKeyDown}
        >
          {items.map((item, index) => (
            <div
              key={item._id}
              id={`queue-item-${item._id}`}
              ref={(node) => { if (node) rowRefs.current.set(item._id, node); else rowRefs.current.delete(item._id); }}
              role="option"
              aria-selected={index === clampedIndex}
              className={`import-queue-row${index === clampedIndex ? " is-focused" : ""} import-queue-row--${item.status.toLowerCase()}`}
              onClick={() => { setFocusIndex(index); listRef.current?.focus({ preventScroll: true }); }}
            >
              <div className="import-queue-row__actions">
                <button className="btn btn--sm btn--icon import-queue-row__approve" aria-label={`Approve ${item.title}`} title="Approve (a)" disabled={!canWrite} onClick={(event) => { event.stopPropagation(); setFocusIndex(index); void decide(item, "Approved"); }}><Check size={14} /></button>
                <button className="btn btn--sm btn--icon import-queue-row__reject" aria-label={`Reject ${item.title}`} title="Reject (r)" disabled={!canWrite} onClick={(event) => { event.stopPropagation(); setFocusIndex(index); void decide(item, "Rejected"); }}><X size={14} /></button>
              </div>
              <div className="import-queue-row__main">
                <div className="import-queue-row__title">
                  <RiskBadge level={item.risk?.level} />
                  <strong title={item.title}>{item.title}</strong>
                </div>
                <div className="import-queue-row__meta">
                  <Badge tone="info">{importKindLabel(item.recordKind)}</Badge>
                  <span>→ {importTargetLabel(item.targetModule)}</span>
                  {item.sourceDate && <span className="mono">{item.sourceDate}</span>}
                  <span className="import-queue-row__session" title={labels.get(item.sessionId)?.full}>{labels.get(item.sessionId)?.primary ?? item.sessionName}</span>
                  {item.status !== "Pending" && <StatusBadge status={item.status} />}
                  {item.duplicateCount > 1 && <Badge tone="warn">{item.duplicateCount}× same file</Badge>}
                </div>
                {item.risk?.reasons?.length > 0 && (
                  <div className="import-queue-row__reasons muted">{item.risk.reasons.slice(0, 3).join(" · ")}</div>
                )}
              </div>
            </div>
          ))}
          {!items.length && (
            <div className="import-queue__empty">
              {live === undefined && !data ? "Loading the review queue…" : filters.status === "Pending" && progress.total > 0 && !filters.recordKind && !filters.targetModule && !filters.sessionId && !filters.risk && !filters.source && !filters.search
                ? "Every staged candidate has been reviewed. Apply approved records from their session below."
                : "No candidates match these filters."}
            </div>
          )}
        </div>
        <QueueDetail
          item={focused}
          canWrite={canWrite}
          sessionLabel={focused ? labels.get(focused.sessionId) : undefined}
          onDecide={(status) => { if (focused) void decide(focused, status); }}
          onSkip={() => { setFocusIndex(Math.min(clampedIndex + 1, items.length - 1)); listRef.current?.focus({ preventScroll: true }); }}
          onEdit={() => focused && onEdit(focused._id)}
          onOpenSession={() => focused && onSessionPicked?.(focused.sessionId)}
        />
      </div>
      {(data?.total ?? 0) > PAGE_SIZE && (
        <div className="card__body row import-queue__pager">
          <button className="btn btn--sm" disabled={!filters.page} onClick={() => setFilter({ page: filters.page - 1 })}><ChevronLeft size={12} /> Previous</button>
          <span className="muted">Page {filters.page + 1} of {Math.ceil((data?.total ?? 0) / PAGE_SIZE)}</span>
          <button className="btn btn--sm" disabled={(filters.page + 1) * PAGE_SIZE >= (data?.total ?? 0)} onClick={() => setFilter({ page: filters.page + 1 })}>Next <ChevronRight size={12} /></button>
        </div>
      )}
    </div>
  );
}

function QueueDetail({
  item,
  canWrite,
  sessionLabel,
  onDecide,
  onSkip,
  onEdit,
  onOpenSession,
}: {
  item: any;
  canWrite: boolean;
  sessionLabel?: { primary: string; full: string };
  onDecide: (status: Decision) => void;
  onSkip: () => void;
  onEdit: () => void;
  onOpenSession: () => void;
}) {
  const full = useQuery(api.importSessions.getRecord, item ? { recordId: item._id } : "skip");
  if (!item) {
    return <aside className="import-queue__detail import-queue__detail--empty muted">Select a candidate to see its source.</aside>;
  }
  const notes = String(full?.reviewNotes || full?.payload?.notes || "").trim();
  const created = item.importedTargets ?? {};
  return (
    <aside className="import-queue__detail" aria-label="Candidate details">
      <div className="import-queue__detail-head">
        <RiskBadge level={item.risk?.level} />
        <StatusBadge status={item.status} />
        <Badge tone="info">{importKindLabel(item.recordKind)}</Badge>
      </div>
      <h3 className="import-queue__detail-title">{item.title}</h3>
      {item.description && <p className="muted import-queue__detail-desc">{item.description}</p>}
      <div className="import-queue__decide">
        <button className="btn btn--accent" disabled={!canWrite} onClick={() => onDecide("Approved")}><Check size={14} /> Approve <kbd>a</kbd></button>
        <button className="btn" disabled={!canWrite} onClick={() => onDecide("Rejected")}><X size={14} /> Reject <kbd>r</kbd></button>
        <button className="btn btn--ghost" disabled={!canWrite} onClick={onEdit}><Pencil size={14} /> Edit <kbd>e</kbd></button>
        <button className="btn btn--ghost" onClick={onSkip}><SkipForward size={14} /> Next <kbd>n</kbd></button>
      </div>
      {item.risk?.reasons?.length > 0 && (
        <InspectorNote tone={item.risk.level === "high" ? "warn" : "info"} title="Why it needs attention">
          <ul className="import-queue__reasons">{item.risk.reasons.map((reason: string) => <li key={reason}>{reason}</li>)}</ul>
        </InspectorNote>
      )}
      <dl className="import-queue__facts">
        <Fact label="Target">{importTargetLabel(item.targetModule)}</Fact>
        <Fact label="Session">
          <button type="button" className="link-button" onClick={onOpenSession} title={sessionLabel?.full}>{sessionLabel?.full ?? item.sessionName}</button>
        </Fact>
        <Fact label="Source">{item.sourceSystemLabel}{item.sourceExternalIds?.[0] ? <span className="mono muted"> · {item.sourceExternalIds[0]}</span> : null}</Fact>
        {item.fileName && <Fact label="File">{item.fileName}</Fact>}
        {(item.locator?.path || item.locator?.page || item.locator?.section) && (
          <Fact label="Locator">{[item.locator.path, item.locator.section, item.locator.page ? `p. ${item.locator.page}` : null].filter(Boolean).join(" · ")}</Fact>
        )}
        {item.sourceDate && <Fact label="Source date">{item.sourceDate}</Fact>}
        {item.sha256 && <Fact label="SHA-256"><span className="mono import-queue__hash" title={item.sha256}>{item.sha256.slice(0, 16)}…</span></Fact>}
        <Fact label="Confidence">{item.confidence}</Fact>
      </dl>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {item.url && <a className="btn btn--sm" href={item.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={12} /> Open source <kbd>o</kbd></a>}
        {created.documents && <Link className="btn btn--sm" to={`/app/documents/${created.documents}`}><FileText size={12} /> Created document</Link>}
        {Object.entries(created).filter(([key, value]) => key !== "documents" && value).map(([key]) => <Badge key={key} tone="success">Applied: {key}</Badge>)}
      </div>
      {(item.excerpt || full?.payload?.extractedText) && (
        <details className="import-queue__excerpt" open>
          <summary>Extracted text{item.extractedTextLength ? ` (${Number(item.extractedTextLength).toLocaleString()} characters)` : ""}</summary>
          <pre>{String(full?.payload?.extractedText ?? item.excerpt).slice(0, 6000)}</pre>
        </details>
      )}
      {notes && (
        <details className="import-queue__notes" open>
          <summary>Notes</summary>
          <p>{notes}</p>
        </details>
      )}
    </aside>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export function RiskBadge({ level }: { level?: string }) {
  if (level === "high") return <Badge tone="danger">High priority</Badge>;
  if (level === "medium") return <Badge tone="warn">Medium</Badge>;
  return <Badge>Low</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  if (status === "Approved") return <Badge tone="success">Approved</Badge>;
  if (status === "Rejected") return <Badge tone="danger">Rejected</Badge>;
  return <Badge tone="warn">Pending</Badge>;
}
