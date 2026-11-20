import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { History, Plus } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useToast } from "@/components/Toast";
import { Badge, Drawer, Field } from "@/components/ui";
import { Select } from "@/components/Select";
import { DatePicker } from "@/components/DatePicker";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import {
  CardHead,
  EVENT_KINDS,
  Fact,
  PARTIAL_DATE_HINT,
  REVIEW_STATUSES,
  ReviewStatusBadge,
  SourceLink,
  TRANSITIONS,
  errorMessage,
  plainOptions,
  plural,
  type HistoricalSnapshot,
  type HistoricalState,
  type HistoryEvent,
} from "./shared";

/** The person profile's History tab: the role and affiliation on a day, and the dated history entries. */

export type EventRecord = {
  _id: string;
  primary: HistoryEvent;
  others: HistoryEvent[];
  effectiveDate: string;
  title: string;
  kind: string;
  scope: string;
  transition: string;
  value: string;
  reviewStatus: string;
  sourceReference: string;
  otherSources: number;
};

/** P17: one row per fact. Events with the same kind, value and date from several sources collapse into one. */
export function groupEvents(events: HistoryEvent[]): EventRecord[] {
  const groups = new Map<string, HistoryEvent[]>();
  for (const event of events) {
    const value = (event.value || event.roleTitle || event.title || "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
    const key = [event.kind, value, (event.affiliation || "").toLocaleLowerCase(), event.effectiveDate, event.endDate ?? ""].join("|");
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.values()].map((list) => {
    const primary = list.find((event) => event.reviewStatus === "verified") ?? list[0];
    return {
      _id: primary._id,
      primary,
      others: list.filter((event) => event._id !== primary._id),
      effectiveDate: primary.endDate ? `${primary.effectiveDate} to ${primary.endDate}` : primary.effectiveDate,
      title: primary.title ?? "",
      kind: primary.kind,
      scope: primary.scope ?? "",
      transition: primary.transition ?? "",
      value: primary.value ?? "",
      reviewStatus: primary.reviewStatus,
      sourceReference: primary.sourceReference ?? "",
      otherSources: list.length - 1,
    };
  });
}

const EVENTS_TABLE = staticRecordTable({
  id: "person-profile:history",
  nameSingular: "personHistoryEvent",
  namePlural: "personHistoryEvents",
  labelSingular: "History entry",
  labelPlural: "History entries",
  labelIdentifierFieldName: "title",
  sorts: [{ field: "effectiveDate", direction: "desc" }],
  fields: [
    { name: "effectiveDate", label: "Date", fieldType: FIELD_TYPES.TEXT, size: 150 },
    { name: "title", label: "Entry", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    { name: "kind", label: "Kind", fieldType: FIELD_TYPES.SELECT, size: 130, config: { options: EVENT_KINDS.map((kind) => ({ value: kind, label: kind, color: "gray" })) } },
    { name: "value", label: "Value", fieldType: FIELD_TYPES.TEXT, size: 180 },
    { name: "scope", label: "Scope", fieldType: FIELD_TYPES.TEXT, size: 160 },
    { name: "transition", label: "Change", fieldType: FIELD_TYPES.TEXT, size: 110 },
    { name: "reviewStatus", label: "Review", fieldType: FIELD_TYPES.SELECT, size: 120, config: { options: REVIEW_STATUSES } },
    { name: "sourceReference", label: "Source", fieldType: FIELD_TYPES.TEXT, size: 200, config: { groupable: false } },
    { name: "otherSources", label: "Other sources", fieldType: FIELD_TYPES.NUMBER, size: 120, config: { groupable: false, hideZero: true } },
  ],
});

/* ------------------------------- history tab ------------------------------ */

export function HistoricalCard({
  historical,
  asOf,
  onAsOfChange,
}: {
  historical: HistoricalSnapshot | null;
  asOf: string;
  onAsOfChange: (value: string) => void;
}) {
  const describe = (state: HistoricalState) => {
    const values = state.values.map((value) => `${value.value} (${value.scope})`).join("; ");
    return (
      <>
        <strong>{state.state}</strong> · {values || "No verified effective interval"}
      </>
    );
  };
  return (
    <section className="card">
      <CardHead title="Historical role and affiliation" />
      <div className="card__body col" style={{ gap: 8 }}>
        <Field label="As of meeting day">
          <DatePicker value={asOf} onChange={onAsOfChange} placeholder="Choose a day" />
        </Field>
        {historical && (
          <>
            <Fact label="Role">{describe(historical.role)}</Fact>
            <Fact label="Affiliation">{describe(historical.affiliation)}</Fact>
          </>
        )}
        <p className="muted">
          A roster observation applies to its source period. It is not carried back or forward as a confirmed appointment. Changes
          with month or year precision remain uncertain inside that period.
        </p>
      </div>
    </section>
  );
}

export function HistoryCard({
  societyId,
  personId,
  events,
  grouped,
  canWrite,
}: {
  societyId: string;
  personId: string;
  events: HistoryEvent[];
  grouped: EventRecord[];
  canWrite: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = openId ? grouped.find((record) => record._id === openId) : undefined;
  const subtitle = grouped.length !== events.length
    ? `${plural(events.length, "entry", "entries")}, ${grouped.length} distinct`
    : plural(events.length, "entry", "entries");
  return (
    <section className="card">
      <CardHead title="Dated history and contextual notes" subtitle={subtitle}>
        {canWrite && (
          <button type="button" className="btn-action" onClick={() => setRecording(true)}>
            <Plus size={12} /> Record dated change
          </button>
        )}
      </CardHead>
      <RecordListTable<EventRecord>
        variant="card"
        table={EVENTS_TABLE}
        tableId="person-profile-history"
        label="History entries"
        icon={<History size={14} />}
        records={grouped}
        onOpen={(record) => setOpenId(record._id)}
        renderCell={({ record, field }) => {
          if (field.name === "title") {
            return (
              <span>
                <strong>{record.title || "Untitled"}</strong>
                {record.primary.testOnlyAssumption && <> <Badge tone="warn">Test assumption</Badge></>}
              </span>
            );
          }
          if (field.name === "reviewStatus") return <ReviewStatusBadge status={record.reviewStatus} />;
          if (field.name === "sourceReference") return <SourceLink url={record.primary.sourceUrl} reference={record.sourceReference} />;
          return undefined;
        }}
        renderPhoneCard={(record, { open, selecting }) => (
          <RecordTablePhoneCard
            title={record.title || "Untitled"}
            badge={<ReviewStatusBadge status={record.reviewStatus} />}
            meta={[record.effectiveDate, record.kind, record.value]}
            detail={[record.sourceReference]}
            onOpen={open}
            selecting={selecting}
          />
        )}
        emptyState={<RecordTableEmpty title="No dated history yet" description="Dated changes and contextual notes from sources appear here." />}
      />
      {canWrite && (
        <DatedEventDrawer
          open={recording}
          onClose={() => setRecording(false)}
          societyId={societyId}
          personId={personId}
          events={events}
        />
      )}
      <EventDrawer record={opened} events={events} societyId={societyId} canWrite={canWrite} onClose={() => setOpenId(null)} />
    </section>
  );
}

function EventDrawer({
  record,
  events,
  societyId,
  canWrite,
  onClose,
}: {
  record: EventRecord | undefined;
  events: HistoryEvent[];
  societyId: string;
  canWrite: boolean;
  onClose: () => void;
}) {
  const event = record?.primary;
  const previous = event?.supersedesEventId ? events.find((other) => other._id === event.supersedesEventId) : undefined;
  return (
    <Drawer
      open={Boolean(record)}
      onClose={onClose}
      title={event?.title || "History entry"}
      footer={<button className="btn" onClick={onClose}>Close</button>}
    >
      {record && event && (
        <div className="col" style={{ gap: 16 }}>
          <div className="col" style={{ gap: 6 }}>
            <Fact label="Date">{record.effectiveDate}</Fact>
            <Fact label="Kind">{event.kind}</Fact>
            {event.scope && <Fact label="Scope">{event.scope}</Fact>}
            {event.transition && <Fact label="Change">{event.transition}</Fact>}
            {event.value && <Fact label="Value">{event.value}</Fact>}
            <Fact label="Review">
              <ReviewStatusBadge status={event.reviewStatus} />
              {event.testOnlyAssumption && <> <Badge tone="warn">Test identity assumption</Badge></>}
            </Fact>
            <Fact label="Source"><SourceLink url={event.sourceUrl} reference={event.sourceReference} /></Fact>
            {event.supersedesEventId && <Fact label="Previous event retained">{previous?.title || event.supersedesEventId}</Fact>}
          </div>
          {event.details && <p>{event.details}</p>}
          {(event.href || event.meetingId || event.documentId) && (
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              {event.href && <Link to={event.href}>Linked member history</Link>}
              {event.meetingId && <Link to={`/app/meetings/${event.meetingId}?tab=minutes`}>Meeting</Link>}
              {event.documentId && <Link to={`/app/documents/${event.documentId}`}>Document</Link>}
            </div>
          )}
          {record.others.length > 0 && (
            <div className="col" style={{ gap: 6 }}>
              <h3 className="card__title">Also recorded in {plural(record.others.length, "other source")}</h3>
              {record.others.map((other) => (
                <div key={other._id} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span>{other.title}</span>
                  <ReviewStatusBadge status={other.reviewStatus} />
                  <SourceLink url={other.sourceUrl} reference={other.sourceReference} />
                </div>
              ))}
            </div>
          )}
          {canWrite && !event.derived && <EventReviewForm key={event._id} societyId={societyId} eventId={event._id} />}
        </div>
      )}
    </Drawer>
  );
}

function EventReviewForm({ societyId, eventId }: { societyId: string; eventId: string }) {
  const reviewEvent = useMutation(api.personHistory.reviewEvent);
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [rationale, setRationale] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!status || !rationale.trim()) return;
    try {
      await reviewEvent({ societyId, eventId, status, rationale });
      toast.success("History evidence review recorded");
      setRationale("");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  return (
    <form className="col" style={{ gap: 8 }} onSubmit={(event) => void submit(event)}>
      <h3 className="card__title">Review this history evidence</h3>
      <Field label="Review outcome">
        <Select
          value={status}
          onChange={setStatus}
          placeholder="Choose an outcome"
          options={[
            { value: "pending", label: "Pending" },
            { value: "verified", label: "Verified against source" },
            { value: "rejected", label: "Rejected" },
          ]}
        />
      </Field>
      <Field label="Review rationale">
        <input className="input" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="What you checked in the source" />
      </Field>
      <div>
        <button className="btn" type="submit" disabled={!status || !rationale.trim()}>Record review</button>
      </div>
    </form>
  );
}

type EventForm = {
  kind: string;
  title: string;
  value: string;
  scope: string;
  effectiveDate: string;
  endDate: string;
  transition: string;
  details: string;
  reviewStatus: string;
  sourceUrl: string;
  sourceReference: string;
  supersedesEventId: string;
};

const BLANK_EVENT: EventForm = {
  kind: "observation",
  title: "",
  value: "",
  scope: "general",
  effectiveDate: "",
  endDate: "",
  transition: "observed",
  details: "",
  reviewStatus: "pending",
  sourceUrl: "",
  sourceReference: "",
  supersedesEventId: "",
};

function DatedEventDrawer({
  open,
  onClose,
  societyId,
  personId,
  events,
}: {
  open: boolean;
  onClose: () => void;
  societyId: string;
  personId: string;
  events: HistoryEvent[];
}) {
  const add = useMutation(api.personHistory.addEvent);
  const toast = useToast();
  const [form, setForm] = useState<EventForm>(BLANK_EVENT);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) => setForm({ ...form, [key]: value });
  const ready = Boolean(form.title && form.effectiveDate && form.sourceReference && form.sourceUrl);
  const previousOptions = events
    .filter((event) => event.kind === form.kind && event.scope === form.scope)
    .map((event) => ({ value: event._id, label: `${event.effectiveDate} · ${event.title} · ${event.reviewStatus}` }));

  const save = async () => {
    if (busy || !ready) return;
    setBusy(true);
    try {
      const { endDate, supersedesEventId, ...rest } = form;
      const event = {
        ...rest,
        eventKey: crypto.randomUUID(),
        ...(endDate ? { endDate } : {}),
        ...(supersedesEventId ? { supersedesEventId } : {}),
      };
      await add({ societyId, personId, event });
      setForm(BLANK_EVENT);
      toast.success("Dated history recorded; earlier evidence retained");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const textField = (key: keyof EventForm, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input className="input" value={form[key]} onChange={(e) => set(key, e.target.value)} />
    </Field>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Record a dated change or contextual note"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" disabled={busy || !ready} onClick={() => void save()}>Save dated event</button>
        </>
      }
    >
      <Field label="Kind">
        <Select
          value={form.kind}
          onChange={(kind) => setForm({ ...form, kind, transition: ["role", "affiliation"].includes(kind) ? "changed" : "observed" })}
          options={plainOptions(EVENT_KINDS)}
        />
      </Field>
      {textField("title", "Title")}
      {textField("value", "New role or affiliation value")}
      {textField("scope", "Organization, committee or role scope")}
      {textField("effectiveDate", "Effective source date", PARTIAL_DATE_HINT)}
      {textField("endDate", "End date, if established", PARTIAL_DATE_HINT)}
      <Field label="Change type">
        <Select value={form.transition} onChange={(transition) => set("transition", transition)} options={plainOptions(TRANSITIONS)} />
      </Field>
      <Field label="Previous event retained in history">
        <Select
          value={form.supersedesEventId}
          onChange={(supersedesEventId) => set("supersedesEventId", supersedesEventId)}
          placeholder="No established previous event"
          clearable
          clearLabel="No established previous event"
          searchable
          options={previousOptions}
        />
      </Field>
      <Field label="Context / note">
        <textarea className="input" value={form.details} onChange={(e) => set("details", e.target.value)} />
      </Field>
      {textField("sourceUrl", "Source URL")}
      {textField("sourceReference", "Page, section or cell citation")}
      <Field label="Source review">
        <Select value={form.reviewStatus} onChange={(reviewStatus) => set("reviewStatus", reviewStatus)} options={plainOptions(["pending", "verified", "rejected"])} />
      </Field>
    </Drawer>
  );
}

