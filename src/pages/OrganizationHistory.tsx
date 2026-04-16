import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import {
  Archive,
  ArrowRight,
  BookOpen,
  FileText,
  FolderOpen,
  Landmark,
  Newspaper,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";

type Confidence = "High" | "Medium" | "Review";
type Status = "Draft" | "Verified" | "NeedsReview";
type BadgeTone = "neutral" | "success" | "warn" | "danger" | "info" | "accent";

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
const STATUS_OPTIONS: Status[] = ["Draft", "Verified", "NeedsReview"];
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

  const [sourceForm, setSourceForm] = useState<any | null>(null);
  const [factForm, setFactForm] = useState<any | null>(null);
  const [eventForm, setEventForm] = useState<any | null>(null);
  const [boardTermForm, setBoardTermForm] = useState<any | null>(null);
  const [motionForm, setMotionForm] = useState<any | null>(null);
  const [budgetForm, setBudgetForm] = useState<any | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");

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
    + motions.filter((item: any) => item.outcome.toLowerCase() !== "passed").length
    + budgets.filter((item: any) => item.status !== "Verified").length;

  const sourceById = useMemo(() => {
    return new Map(sources.map((source: any) => [source._id, source]));
  }, [sources]);

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

      <div className="two-col">
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Profile facts</h2>
            <button className="btn-action" onClick={() => setFactForm(newFactForm())}>
              <Plus size={12} /> Add fact
            </button>
          </div>
          <div className="card__body col" style={{ gap: 12 }}>
            {facts.map((fact: any) => (
              <div key={fact._id} style={{ display: "grid", gap: 6 }}>
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <strong>{fact.label}</strong>
                  <ConfidenceBadge confidence={fact.confidence} />
                  <StatusBadge status={fact.status} />
                  <div style={{ flex: 1 }} />
                  <IconButton label={`Edit ${fact.label}`} onClick={() => setFactForm({ ...fact, sourceIds: fact.sourceIds ?? [] })}>
                    <Pencil size={12} />
                  </IconButton>
                  <IconButton label={`Delete ${fact.label}`} onClick={() => removeItem({ id: fact._id, kind: "fact" })}>
                    <Trash2 size={12} />
                  </IconButton>
                </div>
                <div className="muted">{fact.value}</div>
                <SourceBadges ids={fact.sourceIds} sourceById={sourceById} />
              </div>
            ))}
            {facts.length === 0 && (
              <EmptyCallout
                title="No profile facts yet"
                body="Add facts manually or import a JSON source pack after reviewing Paperless documents."
                action={<button className="btn-action" onClick={() => setFactForm(newFactForm())}><Plus size={12} /> Add fact</button>}
              />
            )}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Import workflow</h2>
            <span className="card__subtitle">Everything here is data, not UI constants</span>
          </div>
          <div className="card__body col" style={{ gap: 10 }}>
            <WorkflowRow icon={<FolderOpen size={14} />} title="Add sources" body="Create a source for each Paperless document, registry record, archive note, or manual research citation." />
            <WorkflowRow icon={<FileText size={14} />} title="Attach facts" body="Connect profile claims to one or more source records, then mark each fact draft, verified, or needs review." />
            <WorkflowRow icon={<Landmark size={14} />} title="Build timeline" body="Create dated events from verified sources without overwriting current governance state." />
            <Link to="/app/documents" className="btn-action" style={{ width: "fit-content" }}>
              Open documents <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      </div>

      <div className="spacer-6" />

      <div className="two-col">
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">People and service</h2>
            <span className="card__subtitle">Derived from board terms and motion records</span>
          </div>
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
        </div>

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Board service terms</h2>
            <button className="btn-action" onClick={() => setBoardTermForm(newBoardTermForm())}>
              <Plus size={12} /> Add term
            </button>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Position</th>
                <th>Dates</th>
                <th>Change</th>
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
                <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 18 }}>No historical board terms yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="spacer-6" />

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Converted motions</h2>
          <button className="btn-action" onClick={() => setMotionForm(newMotionForm())}>
            <Plus size={12} /> Add motion
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Motion</th>
              <th>Moved / seconded</th>
              <th>Outcome</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {motions.map((motion: any) => (
              <tr key={motion._id}>
                <td className="table__cell--mono muted">{motion.meetingDate}</td>
                <td>
                  <strong>{motion.meetingTitle || motion.category}</strong>
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{motion.motionText}</div>
                </td>
                <td>{[motion.movedByName, motion.secondedByName].filter(Boolean).join(" / ") || "-"}</td>
                <td><Badge tone={motion.outcome.toLowerCase().includes("pass") || motion.outcome.toLowerCase().includes("approved") ? "success" : "neutral"}>{motion.outcome}</Badge></td>
                <td>
                  <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                    <IconButton label="Edit motion" onClick={() => setMotionForm({ ...motion, sourceIds: motion.sourceIds ?? [] })}>
                      <Pencil size={12} />
                    </IconButton>
                    <IconButton label="Delete motion" onClick={() => removeItem({ id: motion._id, kind: "motion" })}>
                      <Trash2 size={12} />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
            {motions.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 18 }}>No converted motions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="spacer-6" />

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Budget snapshots</h2>
          <button className="btn-action" onClick={() => setBudgetForm(newBudgetForm())}>
            <Plus size={12} /> Add budget
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Fiscal year</th>
              <th>Title</th>
              <th>Income</th>
              <th>Expenses</th>
              <th>Ending balance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {budgets.map((budget: any) => (
              <tr key={budget._id}>
                <td className="table__cell--mono">{budget.fiscalYear}</td>
                <td>
                  <strong>{budget.title}</strong>
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{budget.lines.length} line item{budget.lines.length === 1 ? "" : "s"}</div>
                </td>
                <td className="table__cell--mono">{formatCents(budget.totalIncomeCents, budget.currency)}</td>
                <td className="table__cell--mono">{formatCents(budget.totalExpenseCents, budget.currency)}</td>
                <td className="table__cell--mono">{formatCents(budget.endingBalanceCents, budget.currency)}</td>
                <td>
                  <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
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
              <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 18 }}>No budget snapshots yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="spacer-6" />

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

      <div className="spacer-6" />

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Source records</h2>
          <button className="btn-action" onClick={() => setSourceForm(newSourceForm())}>
            <Plus size={12} /> Add source
          </button>
        </div>
        {sources.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>External ID</th>
                <th>Title</th>
                <th>Date</th>
                <th>Category</th>
                <th>Confidence</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sources.map((source: any) => (
                <tr key={source._id}>
                  <td className="table__cell--mono">{source.externalId || "manual"}</td>
                  <td>
                    <strong>{source.title}</strong>
                    {source.notes && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{source.notes}</div>}
                  </td>
                  <td className="table__cell--mono muted">{source.sourceDate || "-"}</td>
                  <td><Badge>{source.category}</Badge></td>
                  <td><ConfidenceBadge confidence={source.confidence} /></td>
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
  ids: string[];
  sourceById: Map<any, any>;
}) {
  if (!ids || ids.length === 0) return <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>No sources linked.</div>;
  return (
    <div className="tag-list" style={{ marginTop: 4 }}>
      {ids.map((id) => {
        const source = sourceById.get(id);
        const label = source?.externalId ? `${source.externalSystem ?? "source"} ${source.externalId}` : source?.title ?? "source";
        return (
          <span key={id} title={source?.title ?? label}>
            <Badge tone="neutral">{label}</Badge>
          </span>
        );
      })}
    </div>
  );
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
        <div key={index} style={{ display: "grid", gridTemplateColumns: "110px 1fr 120px 34px", gap: 8, alignItems: "center" }}>
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
