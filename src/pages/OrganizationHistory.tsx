import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Tabs } from "../components/primitives";
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
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileText,
  FolderOpen,
  Landmark,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from "lucide-react";

type Confidence = "High" | "Medium" | "Review";
type Status = "Draft" | "Verified" | "NeedsReview" | "Archived";
type BadgeTone = "neutral" | "success" | "warn" | "danger" | "info" | "accent";
type HistorySection = "facts" | "people" | "motions" | "budgets" | "timeline" | "sources";
type PeopleSection = "summary" | "terms";

const HISTORY_SECTIONS: HistorySection[] = ["facts", "people", "motions", "budgets", "timeline", "sources"];

function parseHistorySection(value: string | null): HistorySection | null {
  return HISTORY_SECTIONS.includes(value as HistorySection) ? (value as HistorySection) : null;
}

const CATEGORY_OPTIONS = [
  "Legal",
  "Registry",
  "Archive",
  "Governance",
  "Minutes",
  "Finance",
  "Budget",
  "Tax",
  "Publication",
  "Policy",
  "Other",
] as const;

const CONFIDENCE_OPTIONS: Confidence[] = ["High", "Medium", "Review"];
const STATUS_OPTIONS: Status[] = ["Draft", "Verified", "NeedsReview", "Archived"];
const CHANGE_TYPE_OPTIONS = ["appointed", "elected", "removed", "resigned", "ended", "unknown"];
const LINE_SECTION_OPTIONS = ["income", "expense", "balance", "note"];

function newSourceForm() {
  return {
    externalSystem: "paperless",
    externalId: "",
    title: "",
    sourceDate: "",
    category: "Other",
    confidence: "Review" as Confidence,
    notes: "",
    url: "",
  };
}

function newFactForm() {
  return {
    label: "",
    value: "",
    confidence: "Review" as Confidence,
    status: "Draft" as Status,
    sourceIds: [] as string[],
  };
}

function newEventForm() {
  return {
    eventDate: "",
    title: "",
    summary: "",
    category: "Other",
    confidence: "Review" as Confidence,
    status: "Draft" as Status,
    sourceIds: [] as string[],
  };
}

function newBoardTermForm() {
  return {
    personName: "",
    position: "",
    committeeName: "Executive Board",
    startDate: "",
    endDate: "",
    changeType: "unknown",
    confidence: "Review" as Confidence,
    status: "Draft" as Status,
    sourceIds: [] as string[],
    notes: "",
  };
}

function newMotionForm() {
  return {
    meetingDate: "",
    meetingTitle: "",
    motionText: "",
    outcome: "",
    movedByName: "",
    secondedByName: "",
    votesFor: "",
    votesAgainst: "",
    abstentions: "",
    category: "Governance",
    sourceIds: [] as string[],
    notes: "",
  };
}

function newBudgetForm() {
  return {
    fiscalYear: "",
    title: "",
    sourceDate: "",
    confidence: "Review" as Confidence,
    status: "Draft" as Status,
    currency: "CAD",
    totalIncomeCents: undefined as number | undefined,
    totalExpenseCents: undefined as number | undefined,
    netCents: undefined as number | undefined,
    endingBalanceCents: undefined as number | undefined,
    lines: [] as any[],
    sourceIds: [] as string[],
    notes: "",
  };
}

export function OrganizationHistoryPage() {
  const society = useSociety();
  const data = useQuery(api.organizationHistory.list, society ? { societyId: society._id } : "skip");
  const saveSourceRecord = useMutation(api.organizationHistory.saveSource);
  const removeSource = useMutation(api.organizationHistory.removeSource);
  const saveItem = useMutation(api.organizationHistory.saveItem);
  const removeItem = useMutation(api.organizationHistory.removeItem);
  const bulkImport = useMutation(api.organizationHistory.bulkImport);
  const [searchParams, setSearchParams] = useSearchParams();

  const [sourceForm, setSourceForm] = useState<any | null>(null);
  const [factForm, setFactForm] = useState<any | null>(null);
  const [eventForm, setEventForm] = useState<any | null>(null);
  const [boardTermForm, setBoardTermForm] = useState<any | null>(null);
  const [motionForm, setMotionForm] = useState<any | null>(null);
  const [budgetForm, setBudgetForm] = useState<any | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [peopleSection, setPeopleSection] = useState<PeopleSection>("summary");
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [factsViewId, setFactsViewId] = useState<Id<"views"> | undefined>(undefined);
  const [factsFilterOpen, setFactsFilterOpen] = useState(false);
  const section = parseHistorySection(searchParams.get("section")) ?? "facts";

  const factsTableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "profileFact",
    viewId: factsViewId,
  });

  const sources = data?.sources ?? [];
  const facts = data?.facts ?? [];
  const events = data?.events ?? [];
  const boardTerms = data?.boardTerms ?? [];
  const motions = data?.motions ?? [];
  const budgets = data?.budgets ?? [];
  const reviewCount = facts.filter((item: any) => item.status !== "Verified").length
    + events.filter((item: any) => item.status !== "Verified").length
    + sources.filter((item: any) => item.confidence === "Review").length
    + boardTerms.filter((item: any) => item.status !== "Verified").length
    + motions.filter((item: any) => !isPositiveMotionOutcome(item.outcome)).length
    + budgets.filter((item: any) => item.status === "NeedsReview").length;

  const sourceById = useMemo(() => {
    return new Map(sources.map((source: any) => [source._id, source]));
  }, [sources]);

  const factRecords = useMemo(
    () =>
      facts.map((f: any) => ({
        _id: f._id,
        label: f.label,
        value: f.value,
        confidence: f.confidence,
        status: f.status,
        sourceIds: f.sourceIds ?? [],
      })),
    [facts],
  );

  const motionOutcomeOptions = useMemo(
    () => uniqueOptions(motions.map((motion: any) => motion.outcome)),
    [motions],
  );
  const motionRecordSourceOptions = useMemo(
    () => uniqueOptions(motions.map(motionReviewSourceLabel)),
    [motions],
  );
  const motionFilterFields = useMemo(() => [
    {
      id: "outcome",
      label: "Outcome",
      options: motionOutcomeOptions,
      match: (motion: any, query: string) => String(motion.outcome ?? "").toLowerCase() === query.toLowerCase(),
    },
    {
      id: "meeting",
      label: "Meeting",
      match: (motion: any, query: string) => String(motion.meetingTitle ?? "").toLowerCase().includes(query.toLowerCase()),
    },
    {
      id: "source",
      label: "Source",
      match: (motion: any, query: string) => sourceSearchText(motion.sourceIds, sourceById).toLowerCase().includes(query.toLowerCase()),
    },
    {
      id: "recordSource",
      label: "Record source",
      options: motionRecordSourceOptions,
      match: (motion: any, query: string) => motionReviewSourceLabel(motion).toLowerCase() === query.toLowerCase(),
    },
  ], [motionOutcomeOptions, motionRecordSourceOptions, sourceById]);

  const peopleConnections = useMemo(
    () => buildPeopleConnections(boardTerms, motions),
    [boardTerms, motions],
  );

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;
  if (data === undefined) return <div className="page">Loading...</div>;

  const saveSource = async () => {
    const payload = normalizeSource(sourceForm);
    if (!payload.title) return;
    await saveSourceRecord({ societyId: society._id, id: sourceForm._id, payload });
    setSourceForm(null);
  };

  const saveFact = async () => {
    const payload = normalizeFact(factForm);
    if (!payload.label || !payload.value) return;
    await saveItem({ societyId: society._id, id: factForm._id, kind: "fact", payload });
    setFactForm(null);
  };

  const saveEvent = async () => {
    const payload = normalizeEvent(eventForm);
    if (!payload.eventDate || !payload.title || !payload.summary) return;
    await saveItem({ societyId: society._id, id: eventForm._id, kind: "event", payload });
    setEventForm(null);
  };

  const saveBoardTerm = async () => {
    const payload = normalizeBoardTerm(boardTermForm);
    if (!payload.personName || !payload.position) return;
    await saveItem({ societyId: society._id, id: boardTermForm._id, kind: "boardTerm", payload });
    setBoardTermForm(null);
  };

  const saveMotion = async () => {
    const payload = normalizeMotion(motionForm);
    if (!payload.meetingDate || !payload.motionText || !payload.outcome) return;
    await saveItem({ societyId: society._id, id: motionForm._id, kind: "motion", payload });
    setMotionForm(null);
  };

  const saveBudget = async () => {
    const payload = normalizeBudget(budgetForm);
    if (!payload.fiscalYear || !payload.title) return;
    await saveItem({ societyId: society._id, id: budgetForm._id, kind: "budget", payload });
    setBudgetForm(null);
  };

  const runBulkImport = async () => {
    try {
      const parsed = JSON.parse(importText);
      await bulkImport({
        societyId: society._id,
        sources: normalizeImportSources(parsed.sources),
        facts: normalizeImportFacts(parsed.facts),
        events: normalizeImportEvents(parsed.events),
        boardTerms: normalizeImportBoardTerms(parsed.boardTerms),
        motions: normalizeImportMotions(parsed.motions),
        budgets: normalizeImportBudgets(parsed.budgets),
      });
      setImportText("");
      setImportError("");
      setImportOpen(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import failed");
    }
  };

  const setSection = (nextSection: HistorySection) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextSection === "facts") {
      nextParams.delete("section");
    } else {
      nextParams.set("section", nextSection);
    }
    setSearchParams(nextParams);
  };

  return (
    <div className="page">
      <PageHeader
        title="Org history"
        icon={<Newspaper size={16} />}
        iconColor="purple"
        subtitle="Build an editable, source-backed organization profile from Paperless, archive, registry, and meeting records."
        actions={
          <>
            <button className="btn-action" onClick={() => setImportOpen(true)}>
              <Upload size={12} /> Import JSON
            </button>
            <button className="btn-action btn-action--primary" onClick={() => setSourceForm(newSourceForm())}>
              <Plus size={12} /> Add source
            </button>
          </>
        }
      />

      <div className="stat-grid">
        <Stat label="Sources" value={String(sources.length)} icon={<Archive size={14} />} sub="documents, links, and external IDs" />
        <Stat label="Profile facts" value={String(facts.length)} icon={<FileText size={14} />} sub="editable about/profile fields" />
        <Stat label="Converted records" value={String(boardTerms.length + motions.length + budgets.length)} icon={<BookOpen size={14} />} sub="boards, motions, and budgets" />
        <Stat label="Needs review" value={String(reviewCount)} icon={<ShieldCheck size={14} />} sub="drafts and low-confidence records" />
      </div>

      <Tabs<HistorySection>
        value={section}
        onChange={setSection}
        items={[
          { id: "facts", label: "Facts", count: facts.length },
          { id: "people", label: "People", count: peopleConnections.length },
          { id: "motions", label: "Motions", count: motions.length },
          { id: "budgets", label: "Budgets", count: budgets.length },
          { id: "timeline", label: "Timeline", count: events.length },
          { id: "sources", label: "Sources", count: sources.length },
        ]}
      />

      {section === "facts" && (
        <div className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Profile facts</h2>
              <span className="card__subtitle">Paged, searchable claims with source-document links</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn-action" onClick={() => setWorkflowOpen(true)}>
                <BookOpen size={12} /> Workflow
              </button>
              <button className="btn-action" onClick={() => setFactForm(newFactForm())}>
                <Plus size={12} /> Add fact
              </button>
            </div>
          </div>
          {!factsTableData.loading && !factsTableData.objectMetadata ? (
            <RecordTableMetadataEmpty societyId={society?._id} objectLabel="profile-fact" />
          ) : factsTableData.objectMetadata ? (
            <RecordTableScope
              tableId="profileFacts"
              objectMetadata={factsTableData.objectMetadata}
              hydratedView={factsTableData.hydratedView}
              records={factRecords}
              onUpdate={async ({ recordId, fieldName, value }) => {
                const existing = facts.find((f: any) => f._id === recordId);
                if (!existing) return;
                if (fieldName === "sourceIds") return;
                const merged = { ...existing, [fieldName]: value };
                const payload = normalizeFact(merged);
                if (!payload.label || !payload.value) return;
                await saveItem({
                  societyId: society._id,
                  id: existing._id,
                  kind: "fact",
                  payload,
                });
              }}
            >
              <RecordTableViewToolbar
                societyId={society._id}
                objectMetadataId={factsTableData.objectMetadata._id as Id<"objectMetadata">}
                icon={<FileText size={14} />}
                label="Profile facts"
                views={factsTableData.views}
                currentViewId={factsViewId ?? factsTableData.views[0]?._id ?? null}
                onChangeView={(viewId) => setFactsViewId(viewId as Id<"views">)}
                onOpenFilter={() => setFactsFilterOpen((x) => !x)}
              />
              <RecordTableFilterPopover open={factsFilterOpen} onClose={() => setFactsFilterOpen(false)} />
              <RecordTableFilterChips />
              <RecordTable
                loading={factsTableData.loading}
                renderCell={({ record, field }) => {
                  if (field.name === "sourceIds") {
                    return <SourceBadges ids={record.sourceIds} sourceById={sourceById} />;
                  }
                  return undefined;
                }}
                renderRowActions={(fact) => {
                  const original = facts.find((f: any) => f._id === fact._id) ?? fact;
                  return (
                    <>
                      <IconButton
                        label={`Edit ${fact.label}`}
                        onClick={() => setFactForm({ ...original, sourceIds: original.sourceIds ?? [] })}
                      >
                        <Pencil size={12} />
                      </IconButton>
                      <IconButton
                        label={`Delete ${fact.label}`}
                        onClick={() => removeItem({ id: fact._id, kind: "fact" })}
                      >
                        <Trash2 size={12} />
                      </IconButton>
                    </>
                  );
                }}
              />
            </RecordTableScope>
          ) : (
            <div className="record-table__loading">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="record-table__loading-row" />
              ))}
            </div>
          )}
        </div>
      )}

      {section === "people" && (
        <div className="card">
          <div className="card__head org-history__people-head">
            <div className="org-history__people-title-row">
              <div>
                <h2 className="card__title">{peopleSection === "summary" ? "People and service" : "Board service terms"}</h2>
                <span className="card__subtitle">
                  {peopleSection === "summary"
                    ? "Derived from board terms and motion records"
                    : "Editable service terms with linked source documents"}
                </span>
              </div>
              {peopleSection === "terms" && (
                <button className="btn-action" onClick={() => setBoardTermForm(newBoardTermForm())}>
                  <Plus size={12} /> Add term
                </button>
              )}
            </div>

            <div className="org-history__inline-tabs" role="tablist" aria-label="People history views">
              <button
                type="button"
                role="tab"
                aria-selected={peopleSection === "summary"}
                className={`org-history__inline-tab${peopleSection === "summary" ? " is-active" : ""}`}
                onClick={() => setPeopleSection("summary")}
              >
                <Users size={16} />
                <span>People and service</span>
                <span className="org-history__inline-tab-count">{peopleConnections.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={peopleSection === "terms"}
                className={`org-history__inline-tab${peopleSection === "terms" ? " is-active" : ""}`}
                onClick={() => setPeopleSection("terms")}
              >
                <Landmark size={16} />
                <span>Board service terms</span>
                <span className="org-history__inline-tab-count">{boardTerms.length}</span>
              </button>
            </div>
          </div>
          {peopleSection === "summary" ? (
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Positions</th>
                    <th>Terms</th>
                    <th>Motions</th>
                  </tr>
                </thead>
                <tbody>
                  {peopleConnections.map((person) => (
                    <tr key={person.name}>
                      <td><strong>{person.name}</strong></td>
                      <td>{person.positions.join(", ") || "-"}</td>
                      <td className="table__cell--mono">{person.termCount}</td>
                      <td className="table__cell--mono">{person.motionCount}</td>
                    </tr>
                  ))}
                  {peopleConnections.length === 0 && (
                    <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 18 }}>No board or motion connections yet.</td></tr>
                  )}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Position</th>
                    <th>Dates</th>
                    <th>Change</th>
                    <th>Source documents</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {boardTerms.map((term: any) => (
                    <tr key={term._id}>
                      <td><strong>{term.personName}</strong></td>
                      <td>{term.position}</td>
                      <td className="table__cell--mono muted">{term.startDate || "?"} - {term.endDate || "present/unknown"}</td>
                      <td><Badge>{term.changeType}</Badge></td>
                      <td><SourceBadges ids={term.sourceIds} sourceById={sourceById} /></td>
                      <td>
                        <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                          <IconButton label={`Edit ${term.personName}`} onClick={() => setBoardTermForm({ ...term, sourceIds: term.sourceIds ?? [] })}>
                            <Pencil size={12} />
                          </IconButton>
                          <IconButton label={`Delete ${term.personName}`} onClick={() => removeItem({ id: term._id, kind: "boardTerm" })}>
                            <Trash2 size={12} />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {boardTerms.length === 0 && (
                    <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 18 }}>No historical board terms yet.</td></tr>
                  )}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
      )}

      {section === "motions" && (
        <div className="card org-history__motions-card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Converted motions</h2>
              <span className="card__subtitle">Paperless minute motions merged with editable org-history records</span>
            </div>
            <button className="btn-action" onClick={() => setMotionForm(newMotionForm())}>
              <Plus size={12} /> Add motion
            </button>
          </div>
          <DataTable<any>
            label="Converted motions"
            icon={<BookOpen size={14} />}
            data={motions}
            rowKey={(motion) => motion._id}
            pagination
            initialPageSize={50}
            pageSizeOptions={[25, 50, 100]}
            defaultSort={{ columnId: "meetingDate", dir: "asc" }}
            searchPlaceholder="Search motions, meetings, people, or sources..."
            searchExtraFields={[
              (motion) => sourceSearchText(motion.sourceIds, sourceById),
              (motion) => motionPeopleText(motion),
              (motion) => motionReviewSourceLabel(motion),
            ]}
            filterFields={motionFilterFields}
            emptyMessage="No converted motions yet."
            columns={[
              {
                id: "motion",
                header: "Motion",
                sortable: true,
                accessor: (motion) => motion.motionText,
                render: (motion) => <MotionReviewCell motion={motion} sourceById={sourceById} />,
                width: "52%",
              },
              {
                id: "meetingDate",
                header: "Date",
                sortable: true,
                accessor: (motion) => motion.meetingDate,
                render: (motion) => <span className="table__cell--mono muted">{motion.meetingDate || "-"}</span>,
                width: 120,
              },
              {
                id: "meeting",
                header: "Meeting",
                sortable: true,
                accessor: (motion) => motion.meetingTitle,
                render: (motion) => <span className="org-history__motion-meeting">{motion.meetingTitle || "-"}</span>,
                width: "22%",
              },
              {
                id: "people",
                header: "Moved / seconded",
                accessor: motionPeopleText,
                render: (motion) => <MotionPeople motion={motion} />,
                width: 180,
              },
              {
                id: "outcome",
                header: "Outcome",
                sortable: true,
                accessor: (motion) => motion.outcome,
                render: (motion) => <MotionOutcomeBadge outcome={motion.outcome} />,
                width: 130,
              },
            ]}
            renderRowActions={(motion) => (
              <>
                <IconButton label={isPersistedMotion(motion) ? "Edit motion" : "Review motion as org-history item"} onClick={() => setMotionForm(motionEditForm(motion))}>
                  <Pencil size={12} />
                </IconButton>
                {isPersistedMotion(motion) && (
                  <IconButton label="Delete motion" onClick={() => removeItem({ id: motion._id, kind: "motion" })}>
                    <Trash2 size={12} />
                  </IconButton>
                )}
              </>
            )}
          />
        </div>
      )}

      {section === "budgets" && (
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Budget snapshots</h2>
            <button className="btn-action" onClick={() => setBudgetForm(newBudgetForm())}>
              <Plus size={12} /> Add budget
            </button>
          </div>
          <TableScroll>
            <table className="table">
              <thead>
                <tr>
                  <th>Fiscal year</th>
                  <th>Title</th>
                  <th>Income</th>
                  <th>Expenses</th>
                  <th>Ending balance</th>
                  <th>Source documents</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {budgets.map((budget: any) => (
                  <tr key={budget._id}>
                    <td className="table__cell--mono">{budget.fiscalYear}</td>
                    <td>
                      <Link
                        to={`/app/org-history/budgets/${budget._id}`}
                        className="table__cell-button org-history__budget-open"
                      >
                        <span>
                          <strong>{budget.title}</strong>
                          <span className="muted" style={{ display: "block", fontSize: "var(--fs-sm)" }}>
                            {budget.lines.length} line item{budget.lines.length === 1 ? "" : "s"}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="table__cell--mono">{formatCents(budget.totalIncomeCents, budget.currency)}</td>
                    <td className="table__cell--mono">{formatCents(budget.totalExpenseCents, budget.currency)}</td>
                    <td className="table__cell--mono">{formatCents(budget.endingBalanceCents, budget.currency)}</td>
                    <td><SourceBadges ids={budget.sourceIds} sourceById={sourceById} /></td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                        <Link
                          className="btn btn--ghost btn--sm btn--icon"
                          aria-label={`Open ${budget.title}`}
                          title={`Open ${budget.title}`}
                          to={`/app/org-history/budgets/${budget._id}`}
                        >
                          <Eye size={12} />
                        </Link>
                        <IconButton label={`Edit ${budget.title}`} onClick={() => setBudgetForm({ ...budget, sourceIds: budget.sourceIds ?? [] })}>
                          <Pencil size={12} />
                        </IconButton>
                        <IconButton label={`Delete ${budget.title}`} onClick={() => removeItem({ id: budget._id, kind: "budget" })}>
                          <Trash2 size={12} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
                {budgets.length === 0 && (
                  <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 18 }}>No budget snapshots yet.</td></tr>
                )}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}

      {section === "timeline" && (
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">History timeline</h2>
            <button className="btn-action" onClick={() => setEventForm(newEventForm())}>
              <Plus size={12} /> Add event
            </button>
          </div>
          <div className="card__body">
            {events.length > 0 ? (
              <div className="timeline-vertical">
                {events.map((event: any) => (
                  <div className="timeline-vertical__item" key={event._id}>
                    <span className="timeline-vertical__dot" />
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <span className="mono muted" style={{ fontSize: "var(--fs-sm)" }}>{event.eventDate}</span>
                      <Badge tone="accent">{event.category}</Badge>
                      <ConfidenceBadge confidence={event.confidence} />
                      <StatusBadge status={event.status} />
                      <div style={{ flex: 1 }} />
                      <IconButton label={`Edit ${event.title}`} onClick={() => setEventForm({ ...event, sourceIds: event.sourceIds ?? [] })}>
                        <Pencil size={12} />
                      </IconButton>
                      <IconButton label={`Delete ${event.title}`} onClick={() => removeItem({ id: event._id, kind: "event" })}>
                        <Trash2 size={12} />
                      </IconButton>
                    </div>
                    <div className="timeline-vertical__title" style={{ marginTop: 4 }}>
                      <strong>{event.title}</strong>
                    </div>
                    <div className="timeline-vertical__desc">{event.summary}</div>
                    <SourceBadges ids={event.sourceIds} sourceById={sourceById} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyCallout
                title="No history events yet"
                body="Create dated milestones after source records are added and reviewed."
                action={<button className="btn-action" onClick={() => setEventForm(newEventForm())}><Plus size={12} /> Add event</button>}
              />
            )}
          </div>
        </div>
      )}

      {section === "sources" && (
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Source records</h2>
            <button className="btn-action" onClick={() => setSourceForm(newSourceForm())}>
              <Plus size={12} /> Add source
            </button>
          </div>
          {sources.length > 0 ? (
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th>External ID</th>
                    <th>Title</th>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Confidence</th>
                    <th>Document</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sources.map((source: any) => (
                    <tr key={source._id}>
                      <td className="table__cell--mono">{source.externalId || "manual"}</td>
                      <td style={{ minWidth: 320, maxWidth: 640, whiteSpace: "normal" }}>
                        <strong>{source.title}</strong>
                        {source.notes && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{source.notes}</div>}
                      </td>
                      <td className="table__cell--mono muted">{source.sourceDate || "-"}</td>
                      <td><Badge>{source.category}</Badge></td>
                      <td><ConfidenceBadge confidence={source.confidence} /></td>
                      <td><SourceRecordLink source={source} /></td>
                      <td>
                        <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                          <IconButton label={`Edit ${source.title}`} onClick={() => setSourceForm(source)}>
                            <Pencil size={12} />
                          </IconButton>
                          <IconButton label={`Delete ${source.title}`} onClick={() => removeSource({ id: source._id })}>
                            <Trash2 size={12} />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <div className="card__body">
              <EmptyCallout
                title="No source records yet"
                body="Start by adding Paperless document IDs or importing a reviewed JSON bundle."
                action={<button className="btn-action" onClick={() => setSourceForm(newSourceForm())}><Plus size={12} /> Add source</button>}
              />
            </div>
          )}
        </div>
      )}

      <Modal
        open={workflowOpen}
        onClose={() => setWorkflowOpen(false)}
        title="Import workflow"
        size="lg"
        footer={<button className="btn btn--accent" onClick={() => setWorkflowOpen(false)}>Done</button>}
      >
        <div className="col" style={{ gap: 10 }}>
          <div className="muted">Everything here is data, not UI constants.</div>
          <WorkflowRow icon={<FolderOpen size={14} />} title="Add sources" body="Create a source for each Paperless document, registry record, archive note, or manual research citation." />
          <WorkflowRow icon={<FileText size={14} />} title="Attach facts" body="Connect profile claims to one or more source records, then mark each fact draft, verified, or needs review." />
          <WorkflowRow icon={<Landmark size={14} />} title="Build timeline" body="Create dated events from verified sources without overwriting current governance state." />
          <Link to="/app/documents" className="btn-action" style={{ width: "fit-content" }} onClick={() => setWorkflowOpen(false)}>
            Open documents <ArrowRight size={12} />
          </Link>
        </div>
      </Modal>

      <Drawer
        open={!!sourceForm}
        onClose={() => setSourceForm(null)}
        title={sourceForm?._id ? "Edit source" : "Add source"}
        footer={<><button className="btn" onClick={() => setSourceForm(null)}>Cancel</button><button className="btn btn--accent" onClick={saveSource}>Save source</button></>}
      >
        {sourceForm && (
          <div>
            <Field label="Title" required>
              <input className="input" value={sourceForm.title} onChange={(e) => setSourceForm({ ...sourceForm, title: e.target.value })} />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="System">
                <input className="input" value={sourceForm.externalSystem ?? ""} onChange={(e) => setSourceForm({ ...sourceForm, externalSystem: e.target.value })} />
              </Field>
              <Field label="External ID">
                <input className="input" value={sourceForm.externalId ?? ""} onChange={(e) => setSourceForm({ ...sourceForm, externalId: e.target.value })} />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Source date">
                <input className="input" value={sourceForm.sourceDate ?? ""} onChange={(e) => setSourceForm({ ...sourceForm, sourceDate: e.target.value })} placeholder="YYYY-MM-DD or YYYY" />
              </Field>
              <Field label="Category">
                <select className="input" value={sourceForm.category} onChange={(e) => setSourceForm({ ...sourceForm, category: e.target.value })}>
                  {CATEGORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </Field>
              <Field label="Confidence">
                <select className="input" value={sourceForm.confidence} onChange={(e) => setSourceForm({ ...sourceForm, confidence: e.target.value as Confidence })}>
                  {CONFIDENCE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </Field>
            </div>
            <Field label="URL">
              <input className="input" value={sourceForm.url ?? ""} onChange={(e) => setSourceForm({ ...sourceForm, url: e.target.value })} />
            </Field>
            <Field label="Notes">
              <textarea className="textarea" value={sourceForm.notes ?? ""} onChange={(e) => setSourceForm({ ...sourceForm, notes: e.target.value })} />
            </Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!factForm}
        onClose={() => setFactForm(null)}
        title={factForm?._id ? "Edit profile fact" : "Add profile fact"}
        footer={<><button className="btn" onClick={() => setFactForm(null)}>Cancel</button><button className="btn btn--accent" onClick={saveFact}>Save fact</button></>}
      >
        {factForm && (
          <div>
            <Field label="Label" required>
              <input className="input" value={factForm.label} onChange={(e) => setFactForm({ ...factForm, label: e.target.value })} />
            </Field>
            <Field label="Value" required>
              <textarea className="textarea" value={factForm.value} onChange={(e) => setFactForm({ ...factForm, value: e.target.value })} />
            </Field>
            <StatusFields form={factForm} setForm={setFactForm} />
            <Field label="Sources">
              <SourcePicker sources={sources} selectedIds={factForm.sourceIds ?? []} onChange={(sourceIds) => setFactForm({ ...factForm, sourceIds })} />
            </Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!eventForm}
        onClose={() => setEventForm(null)}
        title={eventForm?._id ? "Edit history event" : "Add history event"}
        footer={<><button className="btn" onClick={() => setEventForm(null)}>Cancel</button><button className="btn btn--accent" onClick={saveEvent}>Save event</button></>}
      >
        {eventForm && (
          <div>
            <Field label="Date" required>
              <input className="input" value={eventForm.eventDate} onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })} placeholder="YYYY-MM-DD or YYYY" />
            </Field>
            <Field label="Title" required>
              <input className="input" value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} />
            </Field>
            <Field label="Summary" required>
              <textarea className="textarea" value={eventForm.summary} onChange={(e) => setEventForm({ ...eventForm, summary: e.target.value })} />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Category">
                <select className="input" value={eventForm.category} onChange={(e) => setEventForm({ ...eventForm, category: e.target.value })}>
                  {CATEGORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </Field>
              <StatusFields form={eventForm} setForm={setEventForm} />
            </div>
            <Field label="Sources">
              <SourcePicker sources={sources} selectedIds={eventForm.sourceIds ?? []} onChange={(sourceIds) => setEventForm({ ...eventForm, sourceIds })} />
            </Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import history JSON"
        footer={<><button className="btn" onClick={() => setImportOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={runBulkImport}>Import</button></>}
      >
        <Field
          label="JSON bundle"
          hint='Shape: {"sources":[...],"facts":[...],"events":[...],"boardTerms":[...],"motions":[...],"budgets":[...]}. Converted records can reference sourceExternalIds.'
          error={importError}
        >
          <textarea
            className="textarea"
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setImportError("");
            }}
            rows={16}
            spellCheck={false}
          />
        </Field>
      </Drawer>

      <Drawer
        open={!!boardTermForm}
        onClose={() => setBoardTermForm(null)}
        title={boardTermForm?._id ? "Edit board term" : "Add board term"}
        footer={<><button className="btn" onClick={() => setBoardTermForm(null)}>Cancel</button><button className="btn btn--accent" onClick={saveBoardTerm}>Save term</button></>}
      >
        {boardTermForm && (
          <div>
            <Field label="Person" required>
              <input className="input" value={boardTermForm.personName} onChange={(e) => setBoardTermForm({ ...boardTermForm, personName: e.target.value })} />
            </Field>
            <Field label="Position" required>
              <input className="input" value={boardTermForm.position} onChange={(e) => setBoardTermForm({ ...boardTermForm, position: e.target.value })} />
            </Field>
            <Field label="Board / committee">
              <input className="input" value={boardTermForm.committeeName ?? ""} onChange={(e) => setBoardTermForm({ ...boardTermForm, committeeName: e.target.value })} />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Start date">
                <input className="input" value={boardTermForm.startDate ?? ""} onChange={(e) => setBoardTermForm({ ...boardTermForm, startDate: e.target.value })} />
              </Field>
              <Field label="End date">
                <input className="input" value={boardTermForm.endDate ?? ""} onChange={(e) => setBoardTermForm({ ...boardTermForm, endDate: e.target.value })} />
              </Field>
              <Field label="Change">
                <select className="input" value={boardTermForm.changeType} onChange={(e) => setBoardTermForm({ ...boardTermForm, changeType: e.target.value })}>
                  {CHANGE_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </Field>
            </div>
            <StatusFields form={boardTermForm} setForm={setBoardTermForm} />
            <Field label="Notes">
              <textarea className="textarea" value={boardTermForm.notes ?? ""} onChange={(e) => setBoardTermForm({ ...boardTermForm, notes: e.target.value })} />
            </Field>
            <Field label="Sources">
              <SourcePicker sources={sources} selectedIds={boardTermForm.sourceIds ?? []} onChange={(sourceIds) => setBoardTermForm({ ...boardTermForm, sourceIds })} />
            </Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!motionForm}
        onClose={() => setMotionForm(null)}
        title={motionForm?._id ? "Edit motion" : "Add motion"}
        footer={<><button className="btn" onClick={() => setMotionForm(null)}>Cancel</button><button className="btn btn--accent" onClick={saveMotion}>Save motion</button></>}
      >
        {motionForm && (
          <div>
            <Field label="Meeting date" required>
              <input className="input" value={motionForm.meetingDate} onChange={(e) => setMotionForm({ ...motionForm, meetingDate: e.target.value })} />
            </Field>
            <Field label="Meeting title">
              <input className="input" value={motionForm.meetingTitle ?? ""} onChange={(e) => setMotionForm({ ...motionForm, meetingTitle: e.target.value })} />
            </Field>
            <Field label="Motion text" required>
              <textarea className="textarea" value={motionForm.motionText} onChange={(e) => setMotionForm({ ...motionForm, motionText: e.target.value })} />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Outcome" required>
                <input className="input" value={motionForm.outcome} onChange={(e) => setMotionForm({ ...motionForm, outcome: e.target.value })} />
              </Field>
              <Field label="Category">
                <input className="input" value={motionForm.category} onChange={(e) => setMotionForm({ ...motionForm, category: e.target.value })} />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Moved by">
                <input className="input" value={motionForm.movedByName ?? ""} onChange={(e) => setMotionForm({ ...motionForm, movedByName: e.target.value })} />
              </Field>
              <Field label="Seconded by">
                <input className="input" value={motionForm.secondedByName ?? ""} onChange={(e) => setMotionForm({ ...motionForm, secondedByName: e.target.value })} />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <NumberField label="For" value={motionForm.votesFor} onChange={(votesFor) => setMotionForm({ ...motionForm, votesFor })} />
              <NumberField label="Against" value={motionForm.votesAgainst} onChange={(votesAgainst) => setMotionForm({ ...motionForm, votesAgainst })} />
              <NumberField label="Abstain" value={motionForm.abstentions} onChange={(abstentions) => setMotionForm({ ...motionForm, abstentions })} />
            </div>
            <Field label="Notes">
              <textarea className="textarea" value={motionForm.notes ?? ""} onChange={(e) => setMotionForm({ ...motionForm, notes: e.target.value })} />
            </Field>
            <Field label="Sources">
              <SourcePicker sources={sources} selectedIds={motionForm.sourceIds ?? []} onChange={(sourceIds) => setMotionForm({ ...motionForm, sourceIds })} />
            </Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!budgetForm}
        onClose={() => setBudgetForm(null)}
        title={budgetForm?._id ? "Edit budget snapshot" : "Add budget snapshot"}
        footer={<><button className="btn" onClick={() => setBudgetForm(null)}>Cancel</button><button className="btn btn--accent" onClick={saveBudget}>Save budget</button></>}
      >
        {budgetForm && (
          <div>
            <Field label="Fiscal year" required>
              <input className="input" value={budgetForm.fiscalYear} onChange={(e) => setBudgetForm({ ...budgetForm, fiscalYear: e.target.value })} />
            </Field>
            <Field label="Title" required>
              <input className="input" value={budgetForm.title} onChange={(e) => setBudgetForm({ ...budgetForm, title: e.target.value })} />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Source date">
                <input className="input" value={budgetForm.sourceDate ?? ""} onChange={(e) => setBudgetForm({ ...budgetForm, sourceDate: e.target.value })} />
              </Field>
              <Field label="Currency">
                <input className="input" value={budgetForm.currency} onChange={(e) => setBudgetForm({ ...budgetForm, currency: e.target.value.toUpperCase() })} />
              </Field>
            </div>
            <StatusFields form={budgetForm} setForm={setBudgetForm} />
            <div className="row" style={{ gap: 12 }}>
              <MoneyField label="Income" value={budgetForm.totalIncomeCents} onChange={(totalIncomeCents) => setBudgetForm({ ...budgetForm, totalIncomeCents })} />
              <MoneyField label="Expenses" value={budgetForm.totalExpenseCents} onChange={(totalExpenseCents) => setBudgetForm({ ...budgetForm, totalExpenseCents })} />
            </div>
            <div className="row" style={{ gap: 12 }}>
              <MoneyField label="Net" value={budgetForm.netCents} onChange={(netCents) => setBudgetForm({ ...budgetForm, netCents })} />
              <MoneyField label="Ending balance" value={budgetForm.endingBalanceCents} onChange={(endingBalanceCents) => setBudgetForm({ ...budgetForm, endingBalanceCents })} />
            </div>
            <Field label="Line items">
              <BudgetLinesEditor lines={budgetForm.lines ?? []} onChange={(lines) => setBudgetForm({ ...budgetForm, lines })} />
            </Field>
            <Field label="Notes">
              <textarea className="textarea" value={budgetForm.notes ?? ""} onChange={(e) => setBudgetForm({ ...budgetForm, notes: e.target.value })} />
            </Field>
            <Field label="Sources">
              <SourcePicker sources={sources} selectedIds={budgetForm.sourceIds ?? []} onChange={(sourceIds) => setBudgetForm({ ...budgetForm, sourceIds })} />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

export function OrganizationHistoryBudgetPage() {
  const { budgetId } = useParams();
  const society = useSociety();
  const data = useQuery(api.organizationHistory.list, society ? { societyId: society._id } : "skip");
  const extractBudgetSourceDetails = useMutation(api.organizationHistory.extractBudgetSourceDetails);
  const toast = useToast();
  const [extracting, setExtracting] = useState(false);
  const [collapsedBudgetGroups, setCollapsedBudgetGroups] = useState<Record<string, boolean>>({});

  const sources = data?.sources ?? [];
  const budgets = data?.budgets ?? [];
  const sourceById = useMemo(() => {
    return new Map(sources.map((source: any) => [source._id, source]));
  }, [sources]);
  const budget = budgets.find((item: any) => item._id === budgetId);
  const budgetLines = Array.isArray(budget?.lines) ? budget.lines : [];
  const budgetLineGroups = useMemo(() => groupBudgetLines(budgetLines), [budgetLines]);
  const registerTransactions = Array.isArray(budget?.registerTransactions) ? budget.registerTransactions : [];
  const sourceObservations = Array.isArray(budget?.sourceObservations) ? budget.sourceObservations : [];
  const sourceSummary = budget?.sourceSummary;

  const toggleBudgetGroup = (groupKey: string) => {
    setCollapsedBudgetGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  };

  const runSourceExtraction = async () => {
    if (!society || !budget?._id) return;
    setExtracting(true);
    try {
      const result = await extractBudgetSourceDetails({ societyId: society._id, budgetId: budget._id });
      if (!result) {
        toast.error("No linked budget source could be extracted.");
        return;
      }
      toast.success(`Extracted ${result.budgetLineCount} budget lines and ${result.registerTransactionCount} register rows.`);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not extract budget source details");
    } finally {
      setExtracting(false);
    }
  };

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;
  if (data === undefined) return <div className="page">Loading...</div>;

  if (!budget) {
    return (
      <div className="page">
        <PageHeader
          title="Budget snapshot"
          icon={<Archive size={16} />}
          iconColor="purple"
          subtitle="The requested budget snapshot could not be found."
          actions={<Link className="btn-action" to="/app/org-history?section=budgets"><ArrowLeft size={12} /> Org history</Link>}
        />
        <div className="card">
          <div className="card__body">
            <EmptyCallout
              title="Budget not found"
              body="Return to Org history and open a current budget snapshot."
              action={<Link className="btn-action" to="/app/org-history?section=budgets"><ArrowLeft size={12} /> Back to Org history</Link>}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title={budget.title}
        icon={<Archive size={16} />}
        iconColor="purple"
        subtitle={`Budget snapshot for ${budget.fiscalYear}${budget.sourceDate ? ` · source date ${budget.sourceDate}` : ""}`}
        actions={(
          <>
            <button className="btn-action" type="button" disabled={extracting || !budget.sourceIds?.length} onClick={runSourceExtraction}>
              {extracting ? <RefreshCw size={12} /> : <FileText size={12} />}
              {extracting ? "Extracting" : "Extract source detail"}
            </button>
            <Link className="btn-action" to="/app/org-history?section=budgets"><ArrowLeft size={12} /> Org history</Link>
          </>
        )}
      />

      <div className="stat-grid org-history__budget-stats">
        <Stat label="Fiscal year" value={budget.fiscalYear} icon={<BookOpen size={14} />} sub={budget.sourceDate || "No source date"} />
        <Stat label="Income" value={formatCents(budget.totalIncomeCents, budget.currency)} icon={<FileText size={14} />} />
        <Stat label="Expenses" value={formatCents(budget.totalExpenseCents, budget.currency)} icon={<FileText size={14} />} />
        <Stat label="Register rows" value={String(registerTransactions.length)} icon={<Archive size={14} />} sub={sourceSummary?.pageCount ? `${sourceSummary.pageCount} source pages` : undefined} />
      </div>

      <div className="two-col org-history__budget-detail-grid">
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Line items</h2>
            <span className="card__subtitle">{budgetLines.length} item{budgetLines.length === 1 ? "" : "s"}</span>
          </div>
          <TableScroll>
            <table className="table org-history__budget-lines">
              <thead>
                <tr>
                  <th>Line item</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {budgetLineGroups.map((group) => {
                  const collapsed = collapsedBudgetGroups[group.key] === true;
                  return (
                    <Fragment key={group.key}>
                      <tr className="org-history__budget-group-row">
                        <td>
                          <button
                            className="org-history__budget-group-toggle"
                            type="button"
                            aria-expanded={!collapsed}
                            aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.label} budget lines`}
                            onClick={() => toggleBudgetGroup(group.key)}
                          >
                            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                            <span>{group.label}</span>
                            <span className="org-history__budget-group-count">{group.lines.length}</span>
                          </button>
                        </td>
                        <td><Badge>{formatBudgetSection(group.section)}</Badge></td>
                        <td className="table__cell--mono">{formatCents(group.totalCents, budget.currency)}</td>
                        <td className="muted">{group.hasExplicitTotal ? "Source total" : "Calculated from visible lines"}</td>
                      </tr>
                      {!collapsed && group.lines.map((line: any, index: number) => (
                        <tr key={`${group.key}-${line.section}-${line.label}-${index}`} className={isBudgetTotalLine(line) ? "org-history__budget-line-row is-total" : "org-history__budget-line-row"}>
                          <td>
                            <div className="org-history__budget-line-label">
                              <span>{line.label}</span>
                              {line.rawLabel && line.rawLabel !== line.label && <span className="muted">{line.rawLabel}</span>}
                            </div>
                          </td>
                          <td>{formatBudgetLineType(line.lineType ?? line.section)}</td>
                          <td className="table__cell--mono">{formatCents(line.amountCents, budget.currency)}</td>
                          <td className="muted">{line.notes || "-"}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                {budgetLineGroups.length === 0 && (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 18 }}>No line items recorded.</td></tr>
                )}
              </tbody>
            </table>
          </TableScroll>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Source documents</h2>
              <span className="card__subtitle">Paperless and archive links</span>
            </div>
            <div className="card__body">
              <SourceDocumentList ids={budget.sourceIds} sourceById={sourceById} societyId={society._id} />
            </div>
          </div>

          {sourceSummary && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Source extraction</h2>
                <span className="card__subtitle">{sourceSummary.extractedAtISO ?? "Extracted source detail"}</span>
              </div>
              <div className="card__body">
                <div className="kv-list">
                  <div><span>Prepared by</span><strong>{sourceSummary.preparedBy ?? "-"}</strong></div>
                  <div><span>Last modified</span><strong>{sourceSummary.lastModified ?? "-"}</strong></div>
                  <div><span>Budget rows</span><strong>{sourceSummary.budgetLineCount ?? 0}</strong></div>
                  <div><span>Register rows</span><strong>{sourceSummary.registerTransactionCount ?? 0}</strong></div>
                  <div><span>Closing balance</span><strong>{formatCents(sourceSummary.closingBalanceCents, budget.currency)}</strong></div>
                </div>
              </div>
            </div>
          )}

          {budget.notes && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Notes</h2>
              </div>
              <div className="card__body muted">{budget.notes}</div>
            </div>
          )}
        </div>
      </div>

      {registerTransactions.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card__head">
            <h2 className="card__title">Source register</h2>
            <span className="card__subtitle">Debit, credit, cheque/reference, and running-balance candidates from the linked PDF</span>
          </div>
          <TableScroll>
            <table className="table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Description</th>
                  <th>Debit/Credit</th>
                  <th>Amount</th>
                  <th>Cheque/ref</th>
                  <th>Balance</th>
                  <th>Category</th>
                </tr>
              </thead>
              <tbody>
                {registerTransactions.map((row: any, index: number) => (
                  <tr key={`${row.transactionDate}-${row.description}-${index}`}>
                    <td className="table__cell--mono">{row.monthLabel ?? row.transactionDate}</td>
                    <td><strong>{row.description}</strong></td>
                    <td><Badge tone={row.debitCredit === "credit" ? "success" : row.debitCredit === "debit" ? "warn" : "neutral"}>{row.debitCredit ?? "review"}</Badge></td>
                    <td className="table__cell--mono">{formatCents(row.amountCents, budget.currency)}</td>
                    <td className="table__cell--mono">{row.checkNumber ?? "-"}</td>
                    <td className="table__cell--mono">{formatCents(row.balanceCents, budget.currency)}</td>
                    <td>{row.category ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}

      {sourceObservations.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card__head">
            <h2 className="card__title">Unlabelled source figures</h2>
            <span className="card__subtitle">OCR amounts that need reviewer labelling before use</span>
          </div>
          <TableScroll>
            <table className="table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Amount</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {sourceObservations.map((row: any, index: number) => (
                  <tr key={`${row.label}-${index}`}>
                    <td><strong>{row.label}</strong></td>
                    <td className="table__cell--mono">{formatCents(row.amountCents, budget.currency)}</td>
                    <td className="muted">{row.notes ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
    </div>
  );
}

function normalizeOptional(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function normalizeSource(form: any) {
  return {
    externalSystem: normalizeOptional(form.externalSystem),
    externalId: normalizeOptional(form.externalId),
    title: String(form.title ?? "").trim(),
    sourceDate: normalizeOptional(form.sourceDate),
    category: String(form.category ?? "Other"),
    confidence: (form.confidence ?? "Review") as Confidence,
    notes: normalizeOptional(form.notes),
    url: normalizeOptional(form.url),
  };
}

function normalizeFact(form: any) {
  return {
    label: String(form.label ?? "").trim(),
    value: String(form.value ?? "").trim(),
    confidence: (form.confidence ?? "Review") as Confidence,
    status: (form.status ?? "Draft") as Status,
    sourceIds: form.sourceIds ?? [],
  };
}

function normalizeEvent(form: any) {
  return {
    eventDate: String(form.eventDate ?? "").trim(),
    title: String(form.title ?? "").trim(),
    summary: String(form.summary ?? "").trim(),
    category: String(form.category ?? "Other"),
    confidence: (form.confidence ?? "Review") as Confidence,
    status: (form.status ?? "Draft") as Status,
    sourceIds: form.sourceIds ?? [],
  };
}

function normalizeBoardTerm(form: any) {
  return {
    personName: String(form.personName ?? "").trim(),
    position: String(form.position ?? "").trim(),
    committeeName: normalizeOptional(form.committeeName),
    startDate: normalizeOptional(form.startDate),
    endDate: normalizeOptional(form.endDate),
    changeType: String(form.changeType ?? "unknown"),
    confidence: (form.confidence ?? "Review") as Confidence,
    status: (form.status ?? "Draft") as Status,
    sourceIds: form.sourceIds ?? [],
    notes: normalizeOptional(form.notes),
  };
}

function normalizeMotion(form: any) {
  return {
    meetingDate: String(form.meetingDate ?? "").trim(),
    meetingTitle: normalizeOptional(form.meetingTitle),
    motionText: String(form.motionText ?? "").trim(),
    outcome: String(form.outcome ?? "").trim(),
    movedByName: normalizeOptional(form.movedByName),
    secondedByName: normalizeOptional(form.secondedByName),
    votesFor: normalizeNumber(form.votesFor),
    votesAgainst: normalizeNumber(form.votesAgainst),
    abstentions: normalizeNumber(form.abstentions),
    category: String(form.category ?? "Governance"),
    sourceIds: form.sourceIds ?? [],
    notes: normalizeOptional(form.notes),
  };
}

function motionTitle(motion: any) {
  return String(motion?.motionText || motion?.meetingTitle || motion?.category || "Motion").trim();
}

function MotionReviewCell({ motion, sourceById }: { motion: any; sourceById: Map<any, any> }) {
  return (
    <div className="org-history__motion-cell">
      <div className="org-history__motion-text">{motionTitle(motion)}</div>
      <div className="org-history__motion-meta">
        <span className="table__cell--mono">{motion.meetingDate || "Undated"}</span>
        {motion.meetingTitle && <span>{motion.meetingTitle}</span>}
        <Badge tone={motionReviewSourceTone(motion)}>{motionReviewSourceLabel(motion)}</Badge>
        {motion.matchedPaperlessMinutes && isPersistedMotion(motion) && <Badge tone="info">Matched minutes</Badge>}
      </div>
      <SourceBadges ids={motion.sourceIds} sourceById={sourceById} />
    </div>
  );
}

function MotionPeople({ motion }: { motion: any }) {
  const people = motionPeopleText(motion);
  const votes = motionVoteText(motion);
  if (!people && !votes) return <span className="muted">-</span>;
  return (
    <div className="org-history__motion-people">
      {people && <span>{people}</span>}
      {votes && <span className="table__cell--mono muted">{votes}</span>}
    </div>
  );
}

function MotionOutcomeBadge({ outcome }: { outcome: string }) {
  return <Badge tone={motionOutcomeTone(outcome)}>{outcome || "NeedsReview"}</Badge>;
}

function motionPeopleText(motion: any) {
  return [motion.movedByName, motion.secondedByName].map(normalizeOptional).filter(Boolean).join(" / ");
}

function motionVoteText(motion: any) {
  return [
    motion.votesFor != null ? `For ${motion.votesFor}` : "",
    motion.votesAgainst != null ? `Against ${motion.votesAgainst}` : "",
    motion.abstentions != null ? `Abstain ${motion.abstentions}` : "",
  ].filter(Boolean).join(" · ");
}

function isPersistedMotion(motion: any) {
  return motion?.motionRecordSource !== "paperlessMinutes" && !String(motion?._id ?? "").startsWith("minutes:");
}

function motionEditForm(motion: any) {
  const form = {
    meetingDate: motion.meetingDate ?? "",
    meetingTitle: motion.meetingTitle ?? "",
    motionText: motion.motionText ?? "",
    outcome: motion.outcome ?? "",
    movedByName: motion.movedByName ?? "",
    secondedByName: motion.secondedByName ?? "",
    votesFor: motion.votesFor ?? "",
    votesAgainst: motion.votesAgainst ?? "",
    abstentions: motion.abstentions ?? "",
    category: motion.category ?? "Governance",
    sourceIds: motion.sourceIds ?? [],
    notes: motion.notes ?? "",
  };
  return isPersistedMotion(motion) ? { ...form, _id: motion._id } : form;
}

function motionReviewSourceLabel(motion: any) {
  return motion?.motionRecordSource === "paperlessMinutes" ? "Paperless minutes" : "Org history";
}

function motionReviewSourceTone(motion: any): BadgeTone {
  return motion?.motionRecordSource === "paperlessMinutes" ? "info" : "neutral";
}

function motionOutcomeTone(outcome: string): BadgeTone {
  const text = String(outcome ?? "").toLowerCase();
  if (isPositiveMotionOutcome(text)) return "success";
  if (text.includes("defeat") || text.includes("reject") || text.includes("fail")) return "danger";
  if (text.includes("table") || text.includes("pending") || text.includes("review")) return "warn";
  return "neutral";
}

function isPositiveMotionOutcome(outcome: unknown) {
  const text = String(outcome ?? "").toLowerCase();
  return text.includes("pass") || text.includes("approv") || text.includes("carried") || text.includes("carry") || text.includes("unanimous");
}

function uniqueOptions(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function normalizeBudget(form: any) {
  return {
    fiscalYear: String(form.fiscalYear ?? "").trim(),
    title: String(form.title ?? "").trim(),
    sourceDate: normalizeOptional(form.sourceDate),
    confidence: (form.confidence ?? "Review") as Confidence,
    status: (form.status ?? "Draft") as Status,
    currency: String(form.currency ?? "CAD").trim().toUpperCase(),
    totalIncomeCents: normalizeNumber(form.totalIncomeCents),
    totalExpenseCents: normalizeNumber(form.totalExpenseCents),
    netCents: normalizeNumber(form.netCents),
    endingBalanceCents: normalizeNumber(form.endingBalanceCents),
    lines: normalizeBudgetLines(form.lines),
    sourceIds: form.sourceIds ?? [],
    notes: normalizeOptional(form.notes),
  };
}

function normalizeNumber(value: unknown) {
  if (value === "" || value === undefined || value === null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeImportSources(value: any) {
  return Array.isArray(value) ? value.map(normalizeSource).filter((source) => source.title) : [];
}

function normalizeImportFacts(value: any) {
  if (!Array.isArray(value)) return [];
  return value.map((fact) => ({
    label: String(fact.label ?? "").trim(),
    value: String(fact.value ?? "").trim(),
    confidence: (fact.confidence ?? "Review") as Confidence,
    status: (fact.status ?? "Draft") as Status,
    sourceExternalIds: Array.isArray(fact.sourceExternalIds) ? fact.sourceExternalIds.map(String) : [],
  })).filter((fact) => fact.label && fact.value);
}

function normalizeImportEvents(value: any) {
  if (!Array.isArray(value)) return [];
  return value.map((event) => ({
    eventDate: String(event.eventDate ?? "").trim(),
    title: String(event.title ?? "").trim(),
    summary: String(event.summary ?? "").trim(),
    category: String(event.category ?? "Other"),
    confidence: (event.confidence ?? "Review") as Confidence,
    status: (event.status ?? "Draft") as Status,
    sourceExternalIds: Array.isArray(event.sourceExternalIds) ? event.sourceExternalIds.map(String) : [],
  })).filter((event) => event.eventDate && event.title && event.summary);
}

function normalizeImportBoardTerms(value: any) {
  if (!Array.isArray(value)) return [];
  return value.map((term) => ({
    personName: String(term.personName ?? "").trim(),
    position: String(term.position ?? "").trim(),
    committeeName: normalizeOptional(term.committeeName),
    startDate: normalizeOptional(term.startDate),
    endDate: normalizeOptional(term.endDate),
    changeType: String(term.changeType ?? "unknown"),
    confidence: (term.confidence ?? "Review") as Confidence,
    status: (term.status ?? "Draft") as Status,
    sourceExternalIds: Array.isArray(term.sourceExternalIds) ? term.sourceExternalIds.map(String) : [],
    notes: normalizeOptional(term.notes),
  })).filter((term) => term.personName && term.position);
}

function normalizeImportMotions(value: any) {
  if (!Array.isArray(value)) return [];
  return value.map((motion) => ({
    meetingDate: String(motion.meetingDate ?? "").trim(),
    meetingTitle: normalizeOptional(motion.meetingTitle),
    motionText: String(motion.motionText ?? "").trim(),
    outcome: String(motion.outcome ?? "").trim(),
    movedByName: normalizeOptional(motion.movedByName),
    secondedByName: normalizeOptional(motion.secondedByName),
    votesFor: normalizeNumber(motion.votesFor),
    votesAgainst: normalizeNumber(motion.votesAgainst),
    abstentions: normalizeNumber(motion.abstentions),
    category: String(motion.category ?? "Governance"),
    sourceExternalIds: Array.isArray(motion.sourceExternalIds) ? motion.sourceExternalIds.map(String) : [],
    notes: normalizeOptional(motion.notes),
  })).filter((motion) => motion.meetingDate && motion.motionText && motion.outcome);
}

function normalizeImportBudgets(value: any) {
  if (!Array.isArray(value)) return [];
  return value.map((budget) => ({
    fiscalYear: String(budget.fiscalYear ?? "").trim(),
    title: String(budget.title ?? "").trim(),
    sourceDate: normalizeOptional(budget.sourceDate),
    confidence: (budget.confidence ?? "Review") as Confidence,
    status: (budget.status ?? "Draft") as Status,
    currency: String(budget.currency ?? "CAD").trim().toUpperCase(),
    totalIncomeCents: normalizeNumber(budget.totalIncomeCents),
    totalExpenseCents: normalizeNumber(budget.totalExpenseCents),
    netCents: normalizeNumber(budget.netCents),
    endingBalanceCents: normalizeNumber(budget.endingBalanceCents),
    lines: normalizeBudgetLines(budget.lines),
    sourceExternalIds: Array.isArray(budget.sourceExternalIds) ? budget.sourceExternalIds.map(String) : [],
    notes: normalizeOptional(budget.notes),
  })).filter((budget) => budget.fiscalYear && budget.title);
}

function normalizeBudgetLines(lines: any[]) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line) => ({
      section: String(line.section ?? "note"),
      label: String(line.label ?? "").trim(),
      amountCents: normalizeNumber(line.amountCents),
      notes: normalizeOptional(line.notes),
    }))
    .filter((line) => line.label);
}

function buildPeopleConnections(boardTerms: any[], motions: any[]) {
  const byName = new Map<string, { name: string; positions: Set<string>; termCount: number; motionCount: number }>();
  const ensure = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (!byName.has(trimmed)) byName.set(trimmed, { name: trimmed, positions: new Set(), termCount: 0, motionCount: 0 });
    return byName.get(trimmed)!;
  };

  for (const term of boardTerms) {
    const person = ensure(term.personName);
    if (!person) continue;
    person.positions.add(term.position);
    person.termCount += 1;
  }

  for (const motion of motions) {
    for (const name of [motion.movedByName, motion.secondedByName]) {
      const person = ensure(name ?? "");
      if (person) person.motionCount += 1;
    }
  }

  return [...byName.values()]
    .map((person) => ({
      ...person,
      positions: [...person.positions].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function formatCents(value: number | undefined, currency = "CAD") {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(value / 100);
}

type BudgetLineGroup = {
  key: string;
  label: string;
  section: string;
  lines: any[];
  totalCents?: number;
  hasExplicitTotal: boolean;
};

function groupBudgetLines(lines: any[]): BudgetLineGroup[] {
  const groups: BudgetLineGroup[] = [];
  const groupByKey = new Map<string, BudgetLineGroup>();

  for (const line of lines) {
    const section = normalizeText(line?.section) || "note";
    const label = normalizeText(line?.category) || formatBudgetSection(section);
    const key = `${section}:${label.toLowerCase()}`;
    let group = groupByKey.get(key);

    if (!group) {
      group = { key, label, section, lines: [], hasExplicitTotal: false };
      groups.push(group);
      groupByKey.set(key, group);
    }

    group.lines.push(line);
  }

  return groups.map((group) => {
    const explicitTotalLine = [...group.lines].reverse().find((line) => isBudgetTotalLine(line) && typeof line?.amountCents === "number");
    const numericDetailLines = group.lines.filter((line) => !isBudgetTotalLine(line) && typeof line?.amountCents === "number");
    const detailTotalCents = numericDetailLines.reduce((total, line) => total + line.amountCents, 0);

    return {
      ...group,
      totalCents: explicitTotalLine?.amountCents ?? (numericDetailLines.length > 0 ? detailTotalCents : undefined),
      hasExplicitTotal: Boolean(explicitTotalLine),
    };
  });
}

function isBudgetTotalLine(line: any) {
  const lineType = normalizeText(line?.lineType ?? line?.rowKind).toLowerCase();
  const label = normalizeText(line?.label ?? line?.rawLabel).toLowerCase();
  return lineType.includes("total") || /^total\b/.test(label);
}

function formatBudgetSection(value: any) {
  return titleize(normalizeText(value) || "note");
}

function formatBudgetLineType(value: any) {
  const label = titleize(normalizeText(value).replace(/[-_]+/g, " "));
  return label || "-";
}

function normalizeText(value: any) {
  return String(value ?? "").trim();
}

function titleize(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function Stat({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat__label">{icon} {label}</div>
      <div className="stat__value">{value}</div>
      {sub && <div className="stat__sub">{sub}</div>}
    </div>
  );
}

function TableScroll({ children }: { children: ReactNode }) {
  return <div className="table-wrap">{children}</div>;
}

function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const tone: BadgeTone = confidence === "High" ? "success" : confidence === "Medium" ? "info" : "warn";
  return <Badge tone={tone}>{confidence}</Badge>;
}

function StatusBadge({ status }: { status: Status }) {
  const tone: BadgeTone = status === "Verified" ? "success" : status === "NeedsReview" ? "warn" : "neutral";
  return <Badge tone={tone}>{status}</Badge>;
}

function SourceBadges({
  ids,
  sourceById,
}: {
  ids?: string[];
  sourceById: Map<any, any>;
}) {
  const sourceIds = Array.isArray(ids) ? ids : [];
  if (sourceIds.length === 0) return <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>No sources linked.</div>;
  return (
    <div className="tag-list source-chip-list" style={{ marginTop: 4 }}>
      {sourceIds.map((id) => {
        const source = sourceById.get(id);
        return <SourceRecordLink key={id} source={source} missingLabel="Missing source" />;
      })}
    </div>
  );
}

function SourceDocumentList({
  ids,
  sourceById,
  societyId,
}: {
  ids?: string[];
  sourceById: Map<any, any>;
  societyId: any;
}) {
  const sourceIds = Array.isArray(ids) ? ids : [];
  if (sourceIds.length === 0) return <div className="muted">No source documents linked.</div>;

  return (
    <div className="source-document-list">
      {sourceIds.map((id) => (
        <SourceDocumentRow key={id} source={sourceById.get(id)} societyId={societyId} />
      ))}
    </div>
  );
}

function SourceDocumentRow({ source, societyId }: { source: any; societyId: any }) {
  const downloadUrl = useQuery(api.files.getUrl, source?.storageId ? { storageId: source.storageId } : "skip");
  const pullSourceDocument = useAction(api.paperless.pullSourceDocument);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const label = source ? sourceLabel(source) : "Missing source";
  const url = sourceUrl(source);
  const canPull = Boolean(source?._id && sourcePaperlessExternalId(source));

  const pull = async () => {
    const externalId = sourcePaperlessExternalId(source);
    if (!source?._id || !externalId) return;
    setBusy(true);
    try {
      const result = await pullSourceDocument({
        societyId,
        documentId: source._id,
        externalId,
      });
      toast.success(`Pulled ${result.fileName} from Paperless-ngx`);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not pull the Paperless source document");
    } finally {
      setBusy(false);
    }
  };

  if (!source) {
    return (
      <div className="source-document">
        <FileText className="source-document__icon" size={14} />
        <div className="source-document__main">
          <div className="source-document__title">Missing source</div>
          <div className="source-document__meta"><Badge tone="warn">Unresolved</Badge></div>
        </div>
      </div>
    );
  }

  return (
    <div className="source-document">
      <FileText className="source-document__icon" size={14} />
      <div className="source-document__main">
        <div className="source-document__title">{source.title}</div>
        <div className="source-document__meta">
          <Badge tone={sourceTone(source)}>{label}</Badge>
          {source.storageId ? (
            <Badge tone="success">Local copy</Badge>
          ) : canPull ? (
            <Badge tone="warn">No local copy</Badge>
          ) : null}
          {source.fileName && <span className="mono muted" style={{ fontSize: "var(--fs-xs)" }}>{source.fileName}</span>}
        </div>
      </div>
      <div className="source-document__actions">
        {downloadUrl && (
          <a className="btn btn--ghost btn--sm" href={downloadUrl} target="_blank" rel="noreferrer">
            <Download size={12} /> Open file
          </a>
        )}
        {url && (
          <a className="btn btn--ghost btn--sm" href={url} target="_blank" rel="noreferrer">
            <ExternalLink size={12} /> Open Paperless
          </a>
        )}
        {canPull && (
          <button className="btn btn--ghost btn--sm" disabled={busy} onClick={pull}>
            {busy ? <RefreshCw size={12} /> : <Download size={12} />}
            {busy ? "Pulling" : source.storageId ? "Refresh file" : "Pull file"}
          </button>
        )}
      </div>
    </div>
  );
}

function SourceRecordLink({ source, missingLabel }: { source: any; missingLabel?: string }) {
  const label = source ? sourceLabel(source) : (missingLabel ?? "Source");
  const url = sourceUrl(source);
  const tone = sourceTone(source);
  const className = sourceChipClass(tone, Boolean(url));
  const title = source ? [source.title, source.externalId, source.category].filter(Boolean).join(" · ") : label;

  if (url) {
    const external = /^https?:\/\//i.test(url);
    return (
      <a
        className={className}
        href={url}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        title={title}
      >
        {label}
        <ExternalLink size={10} />
      </a>
    );
  }

  return <span className={className} title={title}>{label}</span>;
}

function sourceSearchText(ids: string[] | undefined, sourceById: Map<any, any>) {
  if (!Array.isArray(ids)) return "";
  return ids
    .map((id) => {
      const source = sourceById.get(id);
      return source ? [sourceLabel(source), source.title, source.externalId, source.category].filter(Boolean).join(" ") : "";
    })
    .join(" ");
}

function sourceLabel(source: any) {
  const externalSystem = String(source?.externalSystem ?? "").trim();
  const externalId = String(source?.externalId ?? "").trim();
  const paperlessMatch = externalId.match(/^paperless:(\d+)$/i);
  if (paperlessMatch) return `Paperless #${paperlessMatch[1]}`;
  if (externalSystem.toLowerCase() === "paperless" && /^\d+$/.test(externalId)) return `Paperless #${externalId}`;
  if (externalId) return `${externalSystem || "source"} ${externalId}`;
  return String(source?.title ?? "Manual source");
}

function sourceUrl(source: any) {
  const url = String(source?.url ?? source?.paperlessDocumentUrl ?? "").trim();
  return url || undefined;
}

function sourcePaperlessExternalId(source: any) {
  const externalSystem = String(source?.externalSystem ?? "").toLowerCase();
  const externalId = String(source?.externalId ?? "").trim();
  if (/^paperless:\d+$/i.test(externalId)) return externalId;
  if (externalSystem === "paperless" && /^\d+$/.test(externalId)) return `paperless:${externalId}`;
  return undefined;
}

function sourceTone(source: any): BadgeTone {
  if (!source) return "warn";
  const externalSystem = String(source.externalSystem ?? "").toLowerCase();
  const externalId = String(source.externalId ?? "").toLowerCase();
  return externalSystem === "paperless" || externalId.startsWith("paperless:") ? "info" : "neutral";
}

function sourceChipClass(tone: BadgeTone, interactive: boolean) {
  const classes = ["badge", "source-chip"];
  if (tone !== "neutral") classes.push(`badge--${tone}`);
  if (interactive) classes.push("source-chip--link");
  return classes.join(" ");
}

function SourcePicker({
  sources,
  selectedIds,
  onChange,
}: {
  sources: any[];
  selectedIds: string[];
  onChange: (sourceIds: string[]) => void;
}) {
  if (sources.length === 0) return <div className="muted">Add source records before linking them here.</div>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {sources.map((source) => {
        const checked = selectedIds.includes(source._id);
        return (
          <label key={source._id} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...selectedIds, source._id]
                    : selectedIds.filter((id) => id !== source._id),
                );
              }}
            />
            <span>
              <strong>{source.title}</strong>
              <span className="muted"> · {source.externalId || "manual"} · {source.category}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function StatusFields({ form, setForm }: { form: any; setForm: (form: any) => void }) {
  return (
    <>
      <Field label="Confidence">
        <select className="input" value={form.confidence} onChange={(e) => setForm({ ...form, confidence: e.target.value as Confidence })}>
          {CONFIDENCE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </Field>
      <Field label="Status">
        <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Status })}>
          {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </Field>
    </>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string | number | undefined; onChange: (value: number | undefined) => void }) {
  return (
    <Field label={label}>
      <input
        className="input"
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(normalizeNumber(e.target.value))}
      />
    </Field>
  );
}

function MoneyField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (value: number | undefined) => void }) {
  return (
    <Field label={label}>
      <input
        className="input"
        type="number"
        step="0.01"
        value={value == null ? "" : value / 100}
        onChange={(e) => {
          const number = normalizeNumber(e.target.value);
          onChange(number == null ? undefined : Math.round(number * 100));
        }}
      />
    </Field>
  );
}

function BudgetLinesEditor({ lines, onChange }: { lines: any[]; onChange: (lines: any[]) => void }) {
  const updateLine = (index: number, patch: any) => {
    onChange(lines.map((line, i) => i === index ? { ...line, ...patch } : line));
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      {lines.map((line, index) => (
        <div
          key={index}
          className="budget-line-row"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(90px, 110px) minmax(0, 1fr) minmax(96px, 120px) 34px",
            gap: 8,
            alignItems: "center",
          }}
        >
          <select className="input" value={line.section ?? "note"} onChange={(e) => updateLine(index, { section: e.target.value })}>
            {LINE_SECTION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <input className="input" value={line.label ?? ""} onChange={(e) => updateLine(index, { label: e.target.value })} placeholder="Line label" />
          <input
            className="input"
            type="number"
            step="0.01"
            value={line.amountCents == null ? "" : line.amountCents / 100}
            onChange={(e) => {
              const number = normalizeNumber(e.target.value);
              updateLine(index, { amountCents: number == null ? undefined : Math.round(number * 100) });
            }}
            placeholder="Amount"
          />
          <button className="btn btn--ghost btn--sm btn--icon" aria-label="Remove line" onClick={() => onChange(lines.filter((_, i) => i !== index))}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button
        className="btn-action"
        onClick={() => onChange([...lines, { section: "note", label: "", amountCents: undefined, notes: "" }])}
        type="button"
      >
        <Plus size={12} /> Add line
      </button>
    </div>
  );
}

function WorkflowRow({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
      <span style={{ marginTop: 2 }}>{icon}</span>
      <span>
        <strong>{title}</strong>
        <span className="muted"> · {body}</span>
      </span>
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button className="btn btn--ghost btn--sm btn--icon" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

function EmptyCallout({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="col" style={{ gap: 10, alignItems: "flex-start" }}>
      <strong>{title}</strong>
      <div className="muted">{body}</div>
      {action}
    </div>
  );
}
