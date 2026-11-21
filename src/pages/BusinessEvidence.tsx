import { useId, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { api } from "@/lib/convexApi";
import {
  FIELD_TYPES,
  RecordListTable,
  RecordTableEmpty,
  RecordTablePhoneCard,
  staticRecordTable,
  type RecordTableCardHelpers,
  type StaticFieldDefinition,
} from "@/platform/record-engine";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { useUrlTab } from "../hooks/useUrlTab";
import { Badge, Banner, Drawer, EmptyState, Field } from "../components/ui";
import { Checkbox } from "../components/Controls";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { Tabs } from "../components/primitives";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { businessRegisters, registerPermission, type EvidenceRegister, type EvidenceField } from "../../shared/businessEvidence";
import { evidenceRules } from "../../shared/businessEvidenceRules";
import type { GovernanceOrganization } from "../../shared/legalGovernanceProfiles";

interface Option {
  id: string;
  label: string;
}

type Choices = Record<string, Option[]>;

type NoticeParticulars = {
  company?: string;
  holder?: string;
  shareClass?: string;
  quantity?: number;
  issueOrTransferDate?: string;
};

interface EvidenceRow {
  particulars?: NoticeParticulars;
  _id: string;
  historical: boolean;
  recordedAt: string;
  documentId?: string;
  sourcePage?: number;
  documentMissing?: boolean;
  [key: string]: string | number | boolean | NoticeParticulars | undefined;
}

type DocumentSummary = { _id: string; title: string };

/**
 * A register row as the table reads it: each register field and the extra
 * columns as display text (so search, sort and filters see what the cell
 * shows), with the row itself for the cells that draw more than text.
 */
type EvidenceRecord = {
  _id: string;
  row: EvidenceRow;
  [column: string]: string | EvidenceRow;
};

/** Column names beside the register's own fields; no register field uses them. */
const PARTICULARS_COLUMN = "noticeParticulars";
const DOCUMENT_COLUMN = "supportingDocument";
const VERSION_COLUMN = "recordVersion";

const VERSION_LABELS = { current: "Current", previous: "Previous version" } as const;

function registerTable(register: EvidenceRegister) {
  const fields: StaticFieldDefinition[] = register.fields.map((field, index) => ({
    name: field.key,
    label: field.label,
    fieldType: FIELD_TYPES.TEXT,
    size: index === 0 ? 220 : 160,
    config: { groupable: Boolean(field.options || field.table) },
  }));
  if (register.shares) {
    fields.push({ name: PARTICULARS_COLUMN, label: "Particulars", fieldType: FIELD_TYPES.TEXT, size: 260, config: { groupable: false } });
  }
  fields.push(
    { name: DOCUMENT_COLUMN, label: "Supporting document", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    {
      name: VERSION_COLUMN,
      label: "Version",
      fieldType: FIELD_TYPES.SELECT,
      size: 150,
      config: {
        options: [
          { value: VERSION_LABELS.current, label: VERSION_LABELS.current, color: "green" },
          { value: VERSION_LABELS.previous, label: VERSION_LABELS.previous, color: "gray" },
        ],
      },
    },
  );
  return staticRecordTable({
    id: `business-records:${register.table}`,
    nameSingular: "businessRecord",
    namePlural: "businessRecords",
    labelSingular: "Record",
    labelPlural: "Records",
    labelIdentifierFieldName: register.fields[0].key,
    fields,
  });
}

/** One table definition per register, made once. */
const REGISTER_TABLES = new Map(businessRegisters.map((register) => [register.table, registerTable(register)]));

function displayValue(field: EvidenceField, value: unknown, choices: Choices) {
  if (value == null) return "";
  if (field.table) return choices[field.table]?.find((item) => item.id === value)?.label ?? "Linked record unavailable";
  if (field.type === "money") return (Number(value) / 100).toFixed(2);
  return String(value);
}

function particularsText(particulars: NoticeParticulars | undefined) {
  if (!particulars) return "";
  const quantity = particulars.quantity != null ? `${particulars.quantity} shares` : undefined;
  return [particulars.company, particulars.holder, particulars.shareClass, quantity, particulars.issueOrTransferDate]
    .filter(Boolean)
    .join(" · ");
}

function documentLabel(row: EvidenceRow, docs: DocumentSummary[] | undefined) {
  if (row.documentMissing) return "Supporting document deleted";
  if (!row.documentId) return "";
  const title = docs?.find((doc) => doc._id === row.documentId)?.title ?? "Supporting document";
  return row.sourcePage ? `${title} · p. ${row.sourcePage}` : title;
}

function evidenceRecord(row: EvidenceRow, register: EvidenceRegister, choices: Choices, docs: DocumentSummary[] | undefined): EvidenceRecord {
  const record: EvidenceRecord = { _id: row._id, row };
  for (const field of register.fields) record[field.key] = displayValue(field, row[field.key], choices);
  if (register.shares) record[PARTICULARS_COLUMN] = particularsText(row.particulars);
  record[DOCUMENT_COLUMN] = documentLabel(row, docs);
  record[VERSION_COLUMN] = row.historical ? VERSION_LABELS.previous : VERSION_LABELS.current;
  return record;
}

function VersionBadge({ row }: { row: EvidenceRow }) {
  return row.historical
    ? <Badge tone="neutral">{VERSION_LABELS.previous}</Badge>
    : <Badge tone="success">{VERSION_LABELS.current}</Badge>;
}

function SupportingDocument({ row, label }: { row: EvidenceRow; label: string }) {
  if (row.documentMissing) return <span className="muted">{label}</span>;
  if (!row.documentId) return <span className="muted">—</span>;
  return <Link to={`/app/documents/${row.documentId}`}>{label}</Link>;
}

/** A consent review stamped by the server when the reviewer also recorded the entry. */
const SELF_REVIEWED = "Recorded and reviewed by the same person";

/** Cells that draw more than their text: the document link, the version badge and a self-review stamp. */
function renderEvidenceCell({ record, field }: { record: EvidenceRecord; field: { name: string } }) {
  if (field.name === DOCUMENT_COLUMN) return <SupportingDocument row={record.row} label={String(record[DOCUMENT_COLUMN])} />;
  if (field.name === VERSION_COLUMN) return <VersionBadge row={record.row} />;
  if (field.name === "reviewStatus" && record.row.selfReviewed === true) {
    return <span title={SELF_REVIEWED}>{String(record.reviewStatus)}<span className="muted"> · {SELF_REVIEWED}</span></span>;
  }
  return undefined;
}

/** A record on phones: its first field as the title, the next few on the first line, the rest below. */
function EvidencePhoneCard({ register, record, selecting }: { register: EvidenceRegister; record: EvidenceRecord; selecting: boolean }) {
  const [identifier, ...rest] = register.fields;
  const values = rest.map((field) => String(record[field.key])).filter(Boolean);
  const documentText = String(record[DOCUMENT_COLUMN]);
  return (
    <RecordTablePhoneCard
      title={String(record[identifier.key])}
      badge={<VersionBadge row={record.row} />}
      meta={values.slice(0, 3)}
      detail={[
        documentText ? <SupportingDocument row={record.row} label={documentText} /> : "",
        register.shares ? String(record[PARTICULARS_COLUMN]) : "",
        ...values.slice(3),
        record.row.selfReviewed === true ? SELF_REVIEWED : "",
      ]}
      selecting={selecting}
    />
  );
}

/** The drawer's starting values: a new record's are empty, a revision's are the row's. */
function draftFor(register: EvidenceRegister, row: EvidenceRow | undefined): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of register.fields) {
    if (row?.[field.key] == null) continue;
    values[field.key] = field.type === "money" ? displayValue(field, row[field.key], {}) : String(row[field.key]);
  }
  // A deleted supporting document can't be cited again; the revision starts without one.
  const documentId = row?.documentMissing ? "" : row?.documentId ?? "";
  return { ...values, documentId, sourcePage: documentId ? String(row?.sourcePage ?? "") : "" };
}

/** The drawer's values as the register stores them: money in cents, counts as numbers, blanks left out. */
function savedValues(register: EvidenceRegister, draft: Record<string, string>) {
  const values: Record<string, string | number> = {};
  for (const field of register.fields) {
    const input = draft[field.key]?.trim();
    if (!input) continue;
    if (field.type === "money") values[field.key] = Math.round(Number(input) * 100);
    else if (field.type === "count") values[field.key] = Number(input);
    else values[field.key] = input;
  }
  return values;
}

function inputType(field: EvidenceField) {
  if (field.type === "datetime-local") return "datetime-local";
  if (field.type === "money" || field.type === "count") return "number";
  return "text";
}

function Register({ register, org, societyId }: { register: EvidenceRegister; org: GovernanceOrganization; societyId: string }) {
  const { can } = usePermissions();
  const titleId = useId();
  const args = { societyId, register: register.table };
  const records = useQuery(api.businessEvidence.list, args) as EvidenceRow[] | undefined;
  const choices = useQuery(api.businessEvidence.choices, args) as Choices | undefined;
  const canReadDocuments = can("documents:read");
  const docs = useQuery(api.documents.listSummaries, canReadDocuments ? { societyId } : "skip") as DocumentSummary[] | undefined;
  const save = useMutation(api.businessEvidence.save);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [previousId, setPreviousId] = useState<string>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState(false);
  const canWrite = can(registerPermission(register, "write"));
  const table = REGISTER_TABLES.get(register.table);
  const sources = evidenceRules(org, register).sources;

  const tableRecords = useMemo(
    () => (records ?? [])
      .filter((row) => history || !row.historical)
      .map((row) => evidenceRecord(row, register, choices ?? {}, docs)),
    [records, history, register, choices, docs],
  );
  const currentCount = records?.filter((row) => !row.historical).length;
  const hasHistory = Boolean(records?.some((row) => row.historical));
  const missingDocuments = canWrite && Boolean(records?.some((row) => !row.historical && row.documentMissing));

  const update = (key: string, value: string) => setDraft((old) => ({ ...old, [key]: value }));

  const open = (row?: EvidenceRow) => {
    setDraft(draftFor(register, row));
    setPreviousId(row?._id);
    setError("");
  };

  const close = () => {
    if (!saving) setDraft(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || saving) return;
    // The pickers aren't native inputs, so required choices and dates are checked here.
    const missing = register.fields.find(
      (field) => field.required && (field.table || field.options || field.type === "date") && !draft[field.key],
    );
    if (missing) {
      setError(`${missing.label} is required.`);
      return;
    }
    setSaving(true);
    try {
      await save({
        ...args,
        values: savedValues(register, draft),
        previousId,
        documentId: draft.documentId || undefined,
        sourcePage: draft.documentId && draft.sourcePage ? Number(draft.sourcePage) : undefined,
      });
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the record.");
    } finally {
      setSaving(false);
    }
  };

  // Previous versions are kept as they were: only the current version opens for revision.
  const revise = (record: EvidenceRecord) => {
    if (!record.row.historical) open(record.row);
  };

  const renderRowActions = (record: EvidenceRecord) => {
    if (record.row.historical) return null;
    return (
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => open(record.row)}>
        Revise record
      </button>
    );
  };

  const renderPhoneCard = (record: EvidenceRecord, { selecting }: RecordTableCardHelpers) => (
    <EvidencePhoneCard register={register} record={record} selecting={selecting} />
  );

  return (
    <>
      <section className="card business-records" aria-labelledby={titleId}>
        <div className="card__head">
          <h2 className="card__title" id={titleId}>{register.label}</h2>
          {currentCount !== undefined && <Badge>{currentCount}</Badge>}
          <div className="business-records__head-actions">
            {hasHistory && <Checkbox checked={history} onChange={setHistory} label="Show previous versions" />}
            {canWrite && (
              <button type="button" className="btn-action btn-action--primary" onClick={() => open()}>
                <Plus size={12} /> Add record
              </button>
            )}
          </div>
        </div>
        {(sources.length > 0 || missingDocuments) && (
          <div className="card__body business-records__notes">
            {missingDocuments && (
              <Banner tone="warn" title="A supporting document was deleted">
                Revise the records that cited it to cite another document.
              </Banner>
            )}
            {sources.map((source) => (
              <p key={source.url} className="muted business-records__source">
                {source.text}{" "}
                <a href={source.url} target="_blank" rel="noreferrer">{source.citation}</a>
              </p>
            ))}
          </div>
        )}
        {table && (
          <RecordListTable<EvidenceRecord>
            variant="card"
            table={table}
            tableId={`business-records-${register.table}`}
            label={register.label}
            records={tableRecords}
            loading={records === undefined}
            onOpen={canWrite ? revise : undefined}
            renderCell={renderEvidenceCell}
            renderRowActions={canWrite ? renderRowActions : undefined}
            renderPhoneCard={renderPhoneCard}
            emptyState={
              <RecordTableEmpty
                title="No records yet"
                description={canWrite ? "Add the first record to this register." : undefined}
              />
            }
          />
        )}
      </section>

      <RecordDrawer
        register={register}
        draft={draft}
        revising={Boolean(previousId)}
        error={error}
        saving={saving}
        choices={choices}
        documents={canReadDocuments ? docs ?? [] : undefined}
        onChange={update}
        onClose={close}
        onSubmit={submit}
      />
    </>
  );
}

/** Adds or revises one record: the register's fields, then the supporting document and page. */
function RecordDrawer({ register, draft, revising, error, saving, choices, documents, onChange, onClose, onSubmit }: {
  register: EvidenceRegister;
  draft: Record<string, string> | null;
  revising: boolean;
  error: string;
  saving: boolean;
  choices: Choices | undefined;
  /** The documents a record can cite; undefined when the role can't read documents. */
  documents: DocumentSummary[] | undefined;
  onChange: (key: string, value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const formId = useId();
  return (
    <Drawer
      open={draft !== null}
      title={revising ? "Revise record" : "Add record"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--accent" form={formId} disabled={saving}>
            {saving ? "Saving…" : "Save record"}
          </button>
        </>
      }
    >
      {draft && (
        <form id={formId} onSubmit={onSubmit}>
          {error && <Banner tone="danger">{error}</Banner>}
          {register.fields.map((field) => (
            <Field key={field.key} label={field.label} required={field.required}>
              <RecordInput field={field} value={draft[field.key] ?? ""} choices={choices} onChange={(value) => onChange(field.key, value)} />
            </Field>
          ))}
          {documents && (
            <Field label="Supporting document">
              <Select
                aria-label="Supporting document"
                value={draft.documentId}
                placeholder="None"
                clearable
                clearLabel="None"
                searchable
                options={documents.map((doc) => ({ value: doc._id, label: doc.title }))}
                onChange={(value) => onChange("documentId", value)}
              />
            </Field>
          )}
          {draft.documentId && (
            <Field label="Source page">
              <input
                className="input"
                aria-label="Source page"
                type="number"
                min="1"
                value={draft.sourcePage}
                onChange={(event) => onChange("sourcePage", event.target.value)}
              />
            </Field>
          )}
        </form>
      )}
    </Drawer>
  );
}

/** The drawer's control for one register field: a picker for choices, linked records and dates, else an input. */
function RecordInput({ id, field, value, choices, onChange }: {
  /** Set by the enclosing Field, so its label names the control. */
  id?: string;
  field: EvidenceField;
  value: string;
  choices: Choices | undefined;
  onChange: (value: string) => void;
}) {
  const options = field.table
    ? choices?.[field.table] ?? []
    : field.options?.map((label) => ({ label, id: label }));
  if (options) {
    return (
      <Select
        id={id}
        aria-label={field.label}
        value={value}
        placeholder="Choose…"
        clearable={!field.required}
        clearLabel="None"
        searchable={field.table ? true : undefined}
        options={options.map((option) => ({ value: option.id, label: option.label }))}
        onChange={onChange}
      />
    );
  }
  if (field.type === "date") return <DatePicker id={id} value={value} clearable={!field.required} onChange={onChange} />;
  return (
    <input
      id={id}
      className="input"
      aria-label={field.label}
      required={field.required}
      value={value}
      type={inputType(field)}
      min={field.type === "money" ? 0 : field.type === "count" ? 1 : undefined}
      step={field.type === "money" ? "0.01" : undefined}
      maxLength={field.type === "last4" ? 4 : 2000}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function BusinessEvidencePage() {
  const org = useSociety();
  const { can, loaded } = usePermissions();
  const available = org && loaded
    ? businessRegisters.filter((register) => can(registerPermission(register, "read")) && evidenceRules(org, register).available)
    : [];
  const registerIds = available.map((register) => register.table);
  const [registerId, setRegisterId] = useUrlTab(registerIds, registerIds[0] ?? "", "register");

  if (org === null) return <SeedPrompt />;
  if (!org || !loaded) return <PageLoading />;

  const register = available.find((item) => item.table === registerId);

  return (
    <div className="page business-records-page">
      <PageHeader
        title="Business records"
        subtitle="Registers of business evidence, each record tied to its supporting document."
        info={
          <p>
            Each register holds particulars the organization has to be able to show, with the document that supports them.
            Revising a record keeps the earlier version; turn on "Show previous versions" to see it.
          </p>
        }
      />
      {register ? (
        <>
          <Tabs<string>
            value={register.table}
            onChange={setRegisterId}
            tabRoles
            ariaLabel="Business registers"
            items={available.map((item) => ({ id: item.table, label: item.label }))}
          />
          <div role="tabpanel" aria-label={register.label}>
            <Register key={org._id + register.table} societyId={org._id} org={org} register={register} />
          </div>
        </>
      ) : (
        <div className="card">
          <div className="card__body">
            <EmptyState title="No registers available" description="Your role can't read any of the business registers for this organization." />
          </div>
        </div>
      )}
    </div>
  );
}
