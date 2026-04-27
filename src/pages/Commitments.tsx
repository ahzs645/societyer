import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { FilterField } from "../components/FilterBar";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  FolderOpen,
  Link as LinkIcon,
  ListTodo,
  Plus,
  Trash2,
} from "lucide-react";
import { formatDate, relative } from "../lib/format";

const CATEGORIES = ["Contract", "Grant", "Facility", "Governance", "Privacy", "Funding", "Other"] as const;
const CADENCES = ["Once", "Monthly", "Quarterly", "Annual", "Every 2 years", "Custom"] as const;
const STATUSES = ["Active", "Watching", "Paused", "Closed"] as const;
const REVIEW_STATUSES = ["NeedsReview", "Verified", "Rejected"] as const;
const EVIDENCE_STATUSES = ["NeedsReview", "Verified", "Rejected"] as const;

const COMMITMENT_FIELDS: FilterField<any>[] = [
  { id: "title", label: "Title", icon: <ClipboardList size={14} />, match: (c, q) => c.title.toLowerCase().includes(q.toLowerCase()) },
  { id: "category", label: "Category", icon: <FileText size={14} />, options: [...CATEGORIES], match: (c, q) => c.category === q },
  { id: "cadence", label: "Cadence", icon: <CalendarClock size={14} />, options: [...CADENCES], match: (c, q) => c.cadence === q },
  { id: "status", label: "Status", icon: <CheckCircle2 size={14} />, options: [...STATUSES], match: (c, q) => c.status === q },
  { id: "reviewStatus", label: "Review", icon: <AlertTriangle size={14} />, options: [...REVIEW_STATUSES], match: (c, q) => (c.reviewStatus ?? "NeedsReview") === q },
  { id: "overdue", label: "Overdue", icon: <CalendarClock size={14} />, options: ["Yes", "No"], match: (c, q) => {
    const overdue = c.status !== "Closed" && c.status !== "Paused" && c.nextDueDate && new Date(c.nextDueDate).getTime() < Date.now();
    return q === (overdue ? "Yes" : "No");
  } },
];

type CommitmentForm = {
  _id?: string;
  title: string;
  category: string;
  sourceDocumentId?: string;
  sourceLabel?: string;
  sourceExcerpt?: string;
  counterparty?: string;
  requirement: string;
  cadence: string;
  nextDueDate?: string;
  dueDateBasis?: string;
  noticeLeadDays?: number | "";
  owner?: string;
  status: string;
  reviewStatus?: string;
  confidence?: number | "";
  uncertaintyNote?: string;
  notes?: string;
};

type EventForm = {
  commitment: any;
  title: string;
  happenedAtISO: string;
  meetingId?: string;
  evidenceDocumentIds: string[];
  evidenceStatus?: string;
  evidenceNotes?: string;
  summary?: string;
  nextDueDate?: string;
};

export function CommitmentsPage() {
  const society = useSociety();
  const commitments = useQuery(api.commitments.list, society ? { societyId: society._id } : "skip");
  const events = useQuery(api.commitments.eventsForSociety, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const tasks = useQuery(api.tasks.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.commitments.create);
  const update = useMutation(api.commitments.update);
  const remove = useMutation(api.commitments.remove);
  const recordEvent = useMutation(api.commitments.recordEvent);
  const removeEvent = useMutation(api.commitments.removeEvent);
  const createTask = useMutation(api.tasks.create);
  const confirm = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState<CommitmentForm | null>(null);
  const [eventForm, setEventForm] = useState<EventForm | null>(null);

  const documentsById = useMemo<Map<string, any>>(() => new Map((documents ?? []).map((doc: any) => [String(doc._id), doc])), [documents]);
  const meetingsById = useMemo<Map<string, any>>(() => new Map((meetings ?? []).map((meeting: any) => [String(meeting._id), meeting])), [meetings]);
  const eventsByCommitment = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const event of events ?? []) {
      const key = String(event.commitmentId);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [events]);
  const openTasksByCommitment = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const task of tasks ?? []) {
      if (task.status === "Done") continue;
      const key = task.commitmentId ? String(task.commitmentId) : task.eventId?.startsWith("commitment:") ? task.eventId.slice("commitment:".length) : "";
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    return map;
  }, [tasks]);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const now = Date.now();
  const rows = (commitments ?? []) as any[];
  const activeRows = rows.filter((row) => row.status !== "Closed");
  const overdue = activeRows.filter((row) => row.nextDueDate && row.status !== "Paused" && new Date(row.nextDueDate).getTime() < now);
  const dueSoon = activeRows.filter((row) => {
    if (!row.nextDueDate || row.status === "Paused") return false;
    const due = new Date(row.nextDueDate).getTime();
    return due >= now && due <= now + 30 * 24 * 60 * 60 * 1000;
  });
  const needsReview = activeRows.filter((row) => (row.reviewStatus ?? "NeedsReview") !== "Verified");
  const linkedEvidenceCount = (events ?? []).filter((event: any) => event.evidenceDocumentIds?.length > 0 || event.meetingId).length;
  const tenancyWorkflow = rows.find((row) => {
    const source = documentsById.get(String(row.sourceDocumentId));
    const sourceTags = Array.isArray(source?.tags) ? source.tags.join(" ").toLowerCase() : "";
    return sourceTags.includes("tenancy") || row.title.toLowerCase().includes("presentation");
  }) ?? rows[0];

  const openNew = () => {
    setForm({
      title: "",
      category: "Contract",
      requirement: "",
      cadence: "Annual",
      nextDueDate: new Date().toISOString().slice(0, 10),
      noticeLeadDays: 30,
      status: "Active",
      reviewStatus: "NeedsReview",
      confidence: "",
    });
  };

  const openEdit = (row: any) => {
    setForm({
      _id: row._id,
      title: row.title,
      category: row.category,
      sourceDocumentId: row.sourceDocumentId,
      sourceLabel: row.sourceLabel,
      sourceExcerpt: row.sourceExcerpt,
      counterparty: row.counterparty,
      requirement: row.requirement,
      cadence: row.cadence,
      nextDueDate: row.nextDueDate,
      dueDateBasis: row.dueDateBasis,
      noticeLeadDays: row.noticeLeadDays ?? "",
      owner: row.owner,
      status: row.status,
      reviewStatus: row.reviewStatus ?? "NeedsReview",
      confidence: row.confidence ?? "",
      uncertaintyNote: row.uncertaintyNote,
      notes: row.notes,
    });
  };

  const openRecord = (row: any) => {
    const today = new Date().toISOString().slice(0, 10);
    setEventForm({
      commitment: row,
      title: `${row.title} completed`,
      happenedAtISO: today,
      evidenceDocumentIds: [],
      evidenceStatus: "NeedsReview",
      nextDueDate: nextDueDate(row.cadence, today) ?? row.nextDueDate,
    });
  };

  const saveCommitment = async () => {
    if (!form) return;
    const payload = commitmentPayload(form);
    if (form._id) {
      await update({ id: form._id as any, patch: payload });
      toast.success("Commitment updated");
    } else {
      await create({ societyId: society._id, ...payload });
      toast.success("Commitment added");
    }
    setForm(null);
  };

  const saveEvent = async () => {
    if (!eventForm) return;
    await recordEvent({
      commitmentId: eventForm.commitment._id,
      title: eventForm.title.trim() || `${eventForm.commitment.title} completed`,
      happenedAtISO: eventForm.happenedAtISO,
      meetingId: emptyToUndefined(eventForm.meetingId) as any,
      evidenceDocumentIds: eventForm.evidenceDocumentIds as any[],
      evidenceStatus: eventForm.evidenceStatus,
      evidenceNotes: emptyToUndefined(eventForm.evidenceNotes),
      summary: emptyToUndefined(eventForm.summary),
      nextDueDate: emptyToUndefined(eventForm.nextDueDate),
    });
    toast.success("Completion recorded");
    setEventForm(null);
  };

  const createPreparationTask = async (row: any) => {
    const existing = openTasksByCommitment.get(String(row._id)) ?? [];
    if (existing.length > 0) {
      toast.info("Open task already exists", existing[0].title);
      return;
    }
    const dueDate = row.nextDueDate ? subtractDays(row.nextDueDate, row.noticeLeadDays ?? 14) : undefined;
    const sourceTitle = documentsById.get(String(row.sourceDocumentId))?.title;
    await createTask({
      societyId: society._id,
      title: `Prepare ${row.title}`,
      description: [
        row.requirement,
        row.sourceLabel ? `Source: ${row.sourceLabel}` : undefined,
        sourceTitle ? `Document: ${sourceTitle}` : undefined,
        row.uncertaintyNote ? `Review note: ${row.uncertaintyNote}` : undefined,
      ].filter(Boolean).join("\n"),
      status: "Todo",
      priority: isOverdue(row) ? "High" : "Medium",
      assignee: row.owner,
      dueDate,
      documentId: row.sourceDocumentId,
      commitmentId: row._id,
      eventId: `commitment:${row._id}`,
      tags: ["commitment", row.category?.toLowerCase?.()].filter(Boolean),
    });
    toast.success("Preparation task created", dueDate ? `Due ${formatDate(dueDate)}` : row.title);
  };

  return (
    <div className="page">
      <PageHeader
        title="Commitments"
        icon={<ClipboardList size={16} />}
        iconColor="green"
        subtitle="Contract, grant, facility, and policy requirements with source documents, cadence, due dates, and completion evidence."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New commitment
          </button>
        }
      />

      <div className="stat-grid">
        <div className="stat">
          <div className="stat__label">Active</div>
          <div className="stat__value">{activeRows.length}</div>
          <div className="stat__sub">open obligations</div>
        </div>
        <div className="stat">
          <div className="stat__label">Overdue</div>
          <div className="stat__value">{overdue.length}</div>
          <div className="stat__sub">need attention</div>
        </div>
        <div className="stat">
          <div className="stat__label">Due in 30 days</div>
          <div className="stat__value">{dueSoon.length}</div>
          <div className="stat__sub">watch list</div>
        </div>
        <div className="stat">
          <div className="stat__label">Needs review</div>
          <div className="stat__value">{needsReview.length}</div>
          <div className="stat__sub">source or cadence uncertainty</div>
        </div>
        <div className="stat">
          <div className="stat__label">Evidence links</div>
          <div className="stat__value">{linkedEvidenceCount}</div>
          <div className="stat__sub">meetings or documents</div>
        </div>
      </div>

      {tenancyWorkflow && (
        <TenancyWorkflowCard
          commitment={tenancyWorkflow}
          sourceDocument={documentsById.get(String(tenancyWorkflow.sourceDocumentId))}
          events={eventsByCommitment.get(String(tenancyWorkflow._id)) ?? []}
          openTasks={openTasksByCommitment.get(String(tenancyWorkflow._id)) ?? []}
          documentsById={documentsById}
          meetingsById={meetingsById}
          onRecord={() => openRecord(tenancyWorkflow)}
          onPlanTask={() => createPreparationTask(tenancyWorkflow)}
        />
      )}

      <DataTable
        label="All commitments"
        icon={<ClipboardList size={14} />}
        data={rows}
        loading={commitments === undefined}
        rowKey={(row) => String(row._id)}
        filterFields={COMMITMENT_FIELDS}
        searchPlaceholder="Search requirement, source, counterparty..."
        searchExtraFields={[
          (row) => row.requirement,
          (row) => row.sourceExcerpt,
          (row) => row.counterparty,
          (row) => row.sourceLabel,
          (row) => row.dueDateBasis,
          (row) => row.uncertaintyNote,
          (row) => documentsById.get(String(row.sourceDocumentId))?.title,
        ]}
        defaultSort={{ columnId: "nextDueDate", dir: "asc" }}
        onRowClick={openEdit}
        rowActionLabel={(row) => `Edit ${row.title}`}
        viewsKey="commitments"
        sharedViewsContext={{ societyId: society._id, nameSingular: "commitment" }}
        columns={[
          {
            id: "title",
            header: "Requirement",
            sortable: true,
            accessor: (row) => row.title,
            render: (row) => (
              <div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <strong>{row.title}</strong>
                  <Badge tone={reviewStatusTone(row.reviewStatus)}>{reviewStatusLabel(row.reviewStatus)}</Badge>
                  {typeof row.confidence === "number" && <Badge tone="neutral">{formatConfidence(row.confidence)}</Badge>}
                </div>
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{row.requirement}</div>
                {row.sourceExcerpt && (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 4 }}>
                    "{truncate(row.sourceExcerpt, 120)}"
                  </div>
                )}
                {row.sourceDocumentId && (
                  <div className="row" style={{ gap: 6, marginTop: 4 }}>
                    <LinkIcon size={12} />
                    <Link
                      to={`/app/documents/${row.sourceDocumentId}`}
                      className="muted"
                      style={{ fontSize: "var(--fs-sm)" }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {documentsById.get(String(row.sourceDocumentId))?.title ?? "Source document"}
                    </Link>
                  </div>
                )}
              </div>
            ),
          },
          {
            id: "category",
            header: "Category",
            sortable: true,
            accessor: (row) => row.category,
            render: (row) => <Badge tone={categoryTone(row.category)}>{row.category}</Badge>,
          },
          {
            id: "counterparty",
            header: "Source",
            sortable: true,
            accessor: (row) => row.counterparty ?? row.sourceLabel ?? "",
            render: (row) => (
              <div>
                {row.counterparty && <div>{row.counterparty}</div>}
                {row.sourceLabel && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{row.sourceLabel}</div>}
                {row.dueDateBasis && <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 4 }}>{row.dueDateBasis}</div>}
                {!row.counterparty && !row.sourceLabel && <span className="muted">No source label</span>}
              </div>
            ),
          },
          {
            id: "review",
            header: "Review",
            sortable: true,
            accessor: (row) => row.reviewStatus ?? "NeedsReview",
            render: (row) => (
              <div>
                <Badge tone={reviewStatusTone(row.reviewStatus)}>{reviewStatusLabel(row.reviewStatus)}</Badge>
                {typeof row.confidence === "number" && <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 4 }}>{formatConfidence(row.confidence)}</div>}
                {row.uncertaintyNote && <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 4 }}>{truncate(row.uncertaintyNote, 90)}</div>}
              </div>
            ),
          },
          {
            id: "cadence",
            header: "Cadence",
            sortable: true,
            accessor: (row) => row.cadence,
            render: (row) => <span className="muted">{row.cadence}</span>,
          },
          {
            id: "nextDueDate",
            header: "Next due",
            sortable: true,
            accessor: (row) => row.nextDueDate ?? "",
            render: (row) => <DueBadge row={row} />,
          },
          {
            id: "lastCompletedAtISO",
            header: "Last done",
            sortable: true,
            accessor: (row) => row.lastCompletedAtISO ?? "",
            render: (row) => {
              const latestEvent = eventsByCommitment.get(String(row._id))?.[0];
              return (
                <div>
                  <span className="mono">{formatDate(row.lastCompletedAtISO)}</span>
                  {latestEvent?.evidenceStatus && (
                    <div style={{ marginTop: 4 }}>
                      <Badge tone={evidenceStatusTone(latestEvent.evidenceStatus)}>{reviewStatusLabel(latestEvent.evidenceStatus)}</Badge>
                    </div>
                  )}
                  {row.lastCompletionSummary && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{row.lastCompletionSummary}</div>}
                </div>
              );
            },
          },
          {
            id: "tasks",
            header: "Tasks",
            accessor: (row) => openTasksByCommitment.get(String(row._id))?.length ?? 0,
            render: (row) => {
              const openTasks = openTasksByCommitment.get(String(row._id)) ?? [];
              if (openTasks.length === 0) return <span className="muted">No open task</span>;
              return (
                <div className="tag-list">
                  {openTasks.slice(0, 2).map((task) => (
                    <Link key={task._id} className="badge badge--info" to="/app/tasks" onClick={(event) => event.stopPropagation()}>
                      {task.title}
                    </Link>
                  ))}
                  {openTasks.length > 2 && <Badge tone="neutral">+{openTasks.length - 2}</Badge>}
                </div>
              );
            },
          },
          {
            id: "status",
            header: "Status",
            sortable: true,
            accessor: (row) => row.status,
            render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge>,
          },
        ]}
        renderRowActions={(row) => (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => openRecord(row)}>
              <CheckCircle2 size={12} /> Record
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => createPreparationTask(row)}>
              <ListTodo size={12} /> Task
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => openEdit(row)}>
              Edit
            </button>
            <button
              className="btn btn--ghost btn--sm btn--icon"
              aria-label={`Delete commitment ${row.title}`}
              onClick={async () => {
                const ok = await confirm({
                  title: "Delete commitment?",
                  message: `"${row.title}" and ${eventsByCommitment.get(String(row._id))?.length ?? 0} completion record(s) will be removed.`,
                  confirmLabel: "Delete",
                  tone: "danger",
                });
                if (!ok) return;
                await remove({ id: row._id });
                toast.success("Commitment deleted");
              }}
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      />

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__head">
          <div>
            <h2 className="card__title">Completion history</h2>
            <p className="card__subtitle">Past presentations, reports, renewals, and other fulfillment evidence.</p>
          </div>
        </div>
        <div className="card__body">
          <div className="timeline-vertical">
            {(events ?? []).slice(0, 12).map((event: any) => {
              const commitment = rows.find((row) => String(row._id) === String(event.commitmentId));
              const meeting = meetingsById.get(String(event.meetingId));
              return (
                <div className="timeline-vertical__item is-past" key={event._id}>
                  <span className="timeline-vertical__dot" />
                  <div className="row">
                    <span className="mono muted" style={{ fontSize: "var(--fs-sm)" }}>{formatDate(event.happenedAtISO)}</span>
                    <Badge tone="success">Completed</Badge>
                    {event.evidenceStatus && <Badge tone={evidenceStatusTone(event.evidenceStatus)}>{reviewStatusLabel(event.evidenceStatus)}</Badge>}
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      aria-label={`Delete completion ${event.title}`}
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Delete completion record?",
                          message: `"${event.title}" will be removed from the commitment history.`,
                          confirmLabel: "Delete",
                          tone: "danger",
                        });
                        if (!ok) return;
                        await removeEvent({ id: event._id });
                        toast.success("Completion removed");
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="timeline-vertical__title">
                    {event.title}
                    {commitment && <span className="muted"> · {commitment.title}</span>}
                  </div>
                  {event.summary && <div className="timeline-vertical__desc">{event.summary}</div>}
                  {event.evidenceNotes && <div className="timeline-vertical__desc">{event.evidenceNotes}</div>}
                  <div className="tag-list" style={{ marginTop: 6 }}>
                    {meeting && <Link className="badge badge--info" to={`/app/meetings/${meeting._id}`}>{meeting.title}</Link>}
                    {event.evidenceDocumentIds?.map((id: string) => {
                      const doc = documentsById.get(String(id));
                      return (
                        <Link key={id} className="badge" to={`/app/documents/${id}`}>
                          {doc?.title ?? "Evidence document"}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {events === undefined && <div className="muted">Loading history...</div>}
            {events?.length === 0 && <div className="muted">No completion history yet.</div>}
          </div>
        </div>
      </div>

      <Drawer
        open={!!form}
        onClose={() => setForm(null)}
        title={form?._id ? "Edit commitment" : "Add commitment"}
        footer={
          <>
            <button className="btn" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn btn--accent" onClick={saveCommitment} disabled={!form?.title.trim() || !form?.requirement.trim()}>
              Save
            </button>
          </>
        }
      >
        {form && (
          <CommitmentFormFields
            form={form}
            setForm={setForm}
            documents={(documents ?? []) as any[]}
          />
        )}
      </Drawer>

      <Drawer
        open={!!eventForm}
        onClose={() => setEventForm(null)}
        title="Record completion"
        footer={
          <>
            <button className="btn" onClick={() => setEventForm(null)}>Cancel</button>
            <button className="btn btn--accent" onClick={saveEvent} disabled={!eventForm?.happenedAtISO}>
              Record
            </button>
          </>
        }
      >
        {eventForm && (
          <EventFormFields
            form={eventForm}
            setForm={setEventForm}
            documents={(documents ?? []) as any[]}
            meetings={(meetings ?? []) as any[]}
          />
        )}
      </Drawer>
    </div>
  );
}

function CommitmentFormFields({
  form,
  setForm,
  documents,
}: {
  form: CommitmentForm;
  setForm: (form: CommitmentForm) => void;
  documents: any[];
}) {
  return (
    <div>
      <Field label="Title" required>
        <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="Requirement" required hint="What the contract, policy, grant, or agreement requires the organization to do.">
        <textarea className="textarea" value={form.requirement} onChange={(e) => setForm({ ...form, requirement: e.target.value })} />
      </Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Category">
          <Select value={form.category} onChange={(value) => setForm({ ...form, category: value })} options={CATEGORIES.map((value) => ({ value, label: value }))} />
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(value) => setForm({ ...form, status: value })} options={STATUSES.map((value) => ({ value, label: value }))} />
        </Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Source review">
          <Select value={form.reviewStatus ?? "NeedsReview"} onChange={(value) => setForm({ ...form, reviewStatus: value })} options={REVIEW_STATUSES.map((value) => ({ value, label: reviewStatusLabel(value) }))} />
        </Field>
        <Field label="Confidence">
          <input
            className="input"
            type="number"
            min={0}
            max={100}
            value={form.confidence === "" || form.confidence == null ? "" : Math.round(form.confidence * 100)}
            onChange={(e) => setForm({ ...form, confidence: e.target.value === "" ? "" : Number(e.target.value) / 100 })}
          />
        </Field>
      </div>
      <Field label="Source document">
        <Select
          value={form.sourceDocumentId ?? ""}
          onChange={(value) => setForm({ ...form, sourceDocumentId: value || undefined })}
          clearable
          searchable
          options={documents.map((doc) => ({ value: String(doc._id), label: doc.title, hint: doc.category }))}
        />
      </Field>
      <Field label="Source excerpt" hint="Clause or paragraph text that created this obligation.">
        <textarea className="textarea" value={form.sourceExcerpt ?? ""} onChange={(e) => setForm({ ...form, sourceExcerpt: e.target.value })} />
      </Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Source label">
          <input className="input" value={form.sourceLabel ?? ""} placeholder="Clause 8, Schedule B, award letter..." onChange={(e) => setForm({ ...form, sourceLabel: e.target.value })} />
        </Field>
        <Field label="Counterparty">
          <input className="input" value={form.counterparty ?? ""} placeholder="Landlord, funder, ministry..." onChange={(e) => setForm({ ...form, counterparty: e.target.value })} />
        </Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Cadence">
          <Select value={form.cadence} onChange={(value) => setForm({ ...form, cadence: value })} options={CADENCES.map((value) => ({ value, label: value }))} />
        </Field>
        <Field label="Next due">
          <DatePicker value={form.nextDueDate ?? ""} onChange={(value) => setForm({ ...form, nextDueDate: value })} />
        </Field>
        <Field label="Lead time">
          <input
            className="input"
            type="number"
            min={0}
            value={form.noticeLeadDays ?? ""}
            onChange={(e) => setForm({ ...form, noticeLeadDays: e.target.value === "" ? "" : Number(e.target.value) })}
          />
        </Field>
      </div>
      <Field label="Due date basis">
        <input className="input" value={form.dueDateBasis ?? ""} placeholder="Annual anniversary, fiscal year end, fixed contract date..." onChange={(e) => setForm({ ...form, dueDateBasis: e.target.value })} />
      </Field>
      <Field label="Owner">
        <input className="input" value={form.owner ?? ""} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
      </Field>
      <Field label="Uncertainty or review note">
        <textarea className="textarea" value={form.uncertaintyNote ?? ""} onChange={(e) => setForm({ ...form, uncertaintyNote: e.target.value })} />
      </Field>
      <Field label="Notes">
        <textarea className="textarea" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>
    </div>
  );
}

function EventFormFields({
  form,
  setForm,
  documents,
  meetings,
}: {
  form: EventForm;
  setForm: (form: EventForm) => void;
  documents: any[];
  meetings: any[];
}) {
  const selected = new Set(form.evidenceDocumentIds);
  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__body">
          <div className="row" style={{ gap: 8 }}>
            <Badge tone={categoryTone(form.commitment.category)}>{form.commitment.category}</Badge>
            <span className="muted">{form.commitment.cadence}</span>
          </div>
          <h3 className="card__title" style={{ marginTop: 8 }}>{form.commitment.title}</h3>
          <p className="card__subtitle">{form.commitment.requirement}</p>
        </div>
      </div>
      <Field label="Completion title">
        <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Happened on">
          <DatePicker
            value={form.happenedAtISO}
            onChange={(value) => setForm({ ...form, happenedAtISO: value, nextDueDate: nextDueDate(form.commitment.cadence, value) ?? form.nextDueDate })}
          />
        </Field>
        <Field label="Next due">
          <DatePicker value={form.nextDueDate ?? ""} onChange={(value) => setForm({ ...form, nextDueDate: value })} />
        </Field>
      </div>
      <Field label="Meeting">
        <Select
          value={form.meetingId ?? ""}
          onChange={(value) => setForm({ ...form, meetingId: value || undefined })}
          clearable
          searchable
          options={meetings.map((meeting) => ({ value: String(meeting._id), label: meeting.title, hint: formatDate(meeting.scheduledAt) }))}
        />
      </Field>
      <Field label="Evidence review">
        <Select
          value={form.evidenceStatus ?? "NeedsReview"}
          onChange={(value) => setForm({ ...form, evidenceStatus: value })}
          options={EVIDENCE_STATUSES.map((value) => ({ value, label: reviewStatusLabel(value) }))}
        />
      </Field>
      <Field label="Evidence documents" hint="Select presentations, reports, minutes, confirmations, or source records.">
        <div className="card-list" style={{ maxHeight: 220, overflow: "auto" }}>
          {documents.map((doc) => (
            <label key={doc._id} className="card-list__item" style={{ cursor: "pointer" }}>
              <span className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={selected.has(String(doc._id))}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(String(doc._id));
                    else next.delete(String(doc._id));
                    setForm({ ...form, evidenceDocumentIds: Array.from(next) });
                  }}
                />
                <FolderOpen size={14} />
                <span>{doc.title}</span>
              </span>
              <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>{doc.category}</span>
            </label>
          ))}
          {documents.length === 0 && <div className="muted">No documents available.</div>}
        </div>
      </Field>
      <Field label="Evidence notes">
        <textarea className="textarea" value={form.evidenceNotes ?? ""} onChange={(e) => setForm({ ...form, evidenceNotes: e.target.value })} />
      </Field>
      <Field label="Summary">
        <textarea className="textarea" value={form.summary ?? ""} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
      </Field>
    </div>
  );
}

function TenancyWorkflowCard({
  commitment,
  sourceDocument,
  events,
  openTasks,
  documentsById,
  meetingsById,
  onRecord,
  onPlanTask,
}: {
  commitment: any;
  sourceDocument?: any;
  events: any[];
  openTasks: any[];
  documentsById: Map<string, any>;
  meetingsById: Map<string, any>;
  onRecord: () => void;
  onPlanTask: () => void;
}) {
  const latest = events[0];
  const meeting = latest?.meetingId ? meetingsById.get(String(latest.meetingId)) : null;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <Badge tone="orange">Tenancy agreement workflow</Badge>
            <Badge tone={reviewStatusTone(commitment.reviewStatus)}>{reviewStatusLabel(commitment.reviewStatus)}</Badge>
            {typeof commitment.confidence === "number" && <Badge tone="neutral">{formatConfidence(commitment.confidence)}</Badge>}
          </div>
          <h2 className="card__title">{commitment.title}</h2>
          <p className="card__subtitle">{commitment.requirement}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn-action" onClick={onPlanTask}>
            <ListTodo size={12} /> Plan task
          </button>
          <button className="btn-action btn-action--primary" onClick={onRecord}>
            <CheckCircle2 size={12} /> Record evidence
          </button>
        </div>
      </div>
      <div className="card__body">
        <div className="stat-grid" style={{ marginBottom: 14 }}>
          <div className="stat">
            <div className="stat__label">Next due</div>
            <div className="stat__value" style={{ fontSize: "var(--fs-xl)" }}>{formatDate(commitment.nextDueDate)}</div>
            <div className="stat__sub">{commitment.noticeLeadDays ?? 0} day lead</div>
          </div>
          <div className="stat">
            <div className="stat__label">Last satisfied</div>
            <div className="stat__value" style={{ fontSize: "var(--fs-xl)" }}>{formatDate(commitment.lastCompletedAtISO)}</div>
            <div className="stat__sub">{latest?.evidenceStatus ? reviewStatusLabel(latest.evidenceStatus) : "No review status"}</div>
          </div>
          <div className="stat">
            <div className="stat__label">Open tasks</div>
            <div className="stat__value" style={{ fontSize: "var(--fs-xl)" }}>{openTasks.length}</div>
            <div className="stat__sub">{openTasks[0]?.title ?? "No preparation task"}</div>
          </div>
        </div>

        <div className="row" style={{ alignItems: "flex-start", gap: 18, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 320px" }}>
            <div className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 4 }}>Source reference</div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {sourceDocument ? (
                <Link className="badge badge--orange" to={`/app/documents/${sourceDocument._id}`}>
                  {sourceDocument.title}
                </Link>
              ) : (
                <Badge tone="warn">No source document</Badge>
              )}
              {commitment.sourceLabel && <Badge tone="neutral">{commitment.sourceLabel}</Badge>}
              {sourceDocument?.reviewStatus && <Badge tone={documentReviewTone(sourceDocument.reviewStatus)}>{documentReviewLabel(sourceDocument.reviewStatus)}</Badge>}
            </div>
            {commitment.sourceExcerpt && (
              <p className="muted" style={{ marginTop: 8, fontSize: "var(--fs-sm)" }}>
                "{commitment.sourceExcerpt}"
              </p>
            )}
            {commitment.uncertaintyNote && (
              <div className="row" style={{ gap: 6, color: "var(--warn)", fontSize: "var(--fs-sm)" }}>
                <AlertTriangle size={14} /> {commitment.uncertaintyNote}
              </div>
            )}
          </div>

          <div style={{ flex: "1 1 320px" }}>
            <div className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 4 }}>Last satisfaction evidence</div>
            {latest ? (
              <>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <Badge tone={evidenceStatusTone(latest.evidenceStatus)}>{reviewStatusLabel(latest.evidenceStatus)}</Badge>
                  <Badge tone="success">{formatDate(latest.happenedAtISO)}</Badge>
                  {meeting && <Link className="badge badge--info" to={`/app/meetings/${meeting._id}`}>{meeting.title}</Link>}
                  {latest.evidenceDocumentIds?.map((id: string) => {
                    const doc = documentsById.get(String(id));
                    return <Link key={id} className="badge" to={`/app/documents/${id}`}>{doc?.title ?? "Evidence document"}</Link>;
                  })}
                </div>
                {latest.summary && <p className="muted" style={{ marginTop: 8, fontSize: "var(--fs-sm)" }}>{latest.summary}</p>}
                {latest.evidenceNotes && <p className="muted" style={{ marginTop: 4, fontSize: "var(--fs-sm)" }}>{latest.evidenceNotes}</p>}
              </>
            ) : (
              <div className="muted">No satisfaction evidence recorded yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DueBadge({ row }: { row: any }) {
  if (!row.nextDueDate) return <span className="muted">No due date</span>;
  if (row.status === "Closed") return <Badge>Closed</Badge>;
  if (row.status === "Paused") return <Badge tone="neutral">Paused</Badge>;
  const overdue = isOverdue(row);
  return (
    <div>
      <span className="mono">{formatDate(row.nextDueDate)}</span>
      <div>
        <Badge tone={overdue ? "danger" : "info"}>{overdue ? `Overdue ${relative(row.nextDueDate)}` : relative(row.nextDueDate)}</Badge>
      </div>
    </div>
  );
}

function commitmentPayload(form: CommitmentForm) {
  return stripEmpty({
    title: form.title.trim(),
    category: form.category,
    sourceDocumentId: form.sourceDocumentId,
    sourceLabel: form.sourceLabel,
    sourceExcerpt: form.sourceExcerpt,
    counterparty: form.counterparty,
    requirement: form.requirement.trim(),
    cadence: form.cadence,
    nextDueDate: form.nextDueDate,
    dueDateBasis: form.dueDateBasis,
    noticeLeadDays: form.noticeLeadDays === "" ? undefined : form.noticeLeadDays,
    owner: form.owner,
    status: form.status,
    reviewStatus: form.reviewStatus,
    confidence: form.confidence === "" ? undefined : form.confidence,
    uncertaintyNote: form.uncertaintyNote,
    notes: form.notes,
  });
}

function nextDueDate(cadence: string, from: string) {
  if (!from || cadence === "Once" || cadence === "Custom") return undefined;
  const date = new Date(`${from}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  if (cadence === "Monthly") date.setMonth(date.getMonth() + 1);
  if (cadence === "Quarterly") date.setMonth(date.getMonth() + 3);
  if (cadence === "Annual") date.setFullYear(date.getFullYear() + 1);
  if (cadence === "Every 2 years") date.setFullYear(date.getFullYear() + 2);
  return date.toISOString().slice(0, 10);
}

function stripEmpty<T extends Record<string, any>>(value: T) {
  const out: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === "" || entry == null) continue;
    out[key] = entry;
  }
  return out as T;
}

function emptyToUndefined(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function categoryTone(category: string) {
  switch (category) {
    case "Contract":
    case "Facility": return "orange" as const;
    case "Grant":
    case "Funding": return "green" as const;
    case "Governance": return "purple" as const;
    case "Privacy": return "info" as const;
    default: return "neutral" as const;
  }
}

function statusTone(status: string) {
  switch (status) {
    case "Active": return "success" as const;
    case "Watching": return "info" as const;
    case "Paused": return "warn" as const;
    case "Closed": return "neutral" as const;
    default: return "neutral" as const;
  }
}

function reviewStatusLabel(status?: string) {
  switch (status) {
    case "Verified": return "Verified";
    case "Rejected": return "Rejected";
    case "NeedsReview":
    default: return "Needs review";
  }
}

function reviewStatusTone(status?: string) {
  switch (status) {
    case "Verified": return "success" as const;
    case "Rejected": return "danger" as const;
    case "NeedsReview":
    default: return "warn" as const;
  }
}

function evidenceStatusTone(status?: string) {
  return reviewStatusTone(status);
}

function documentReviewLabel(status?: string) {
  switch (status) {
    case "approved": return "Document approved";
    case "in_review": return "Document in review";
    case "needs_signature": return "Needs signature";
    case "blocked": return "Document blocked";
    default: return "Document not reviewed";
  }
}

function documentReviewTone(status?: string) {
  switch (status) {
    case "approved": return "success" as const;
    case "in_review": return "info" as const;
    case "needs_signature": return "warn" as const;
    case "blocked": return "danger" as const;
    default: return "neutral" as const;
  }
}

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}% confidence`;
}

function isOverdue(row: any) {
  return row.status !== "Closed" && row.status !== "Paused" && row.nextDueDate && new Date(row.nextDueDate).getTime() < Date.now();
}

function subtractDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}
