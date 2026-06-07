// Private sub-components/helpers for WorkflowDetail.tsx (node panels, field/mapping editors, modals).

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { Badge, Drawer, Field } from "../components/ui";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { Modal } from "../components/Modal";
import { SeedPrompt } from "./_helpers";
import {
  ArrowLeft,
  Bot,
  ClipboardList,
  ExternalLink,
  FileText,
  FormInput,
  History,
  Mail,
  Pause,
  Play,
  Plus,
  Power,
  Save,
  Settings,
  Trash2,
  UserPlus,
} from "lucide-react";
import { formatDateTime } from "../lib/format";


import {
  IntakeField,
} from "./WorkflowDetail.internal.part1";

function PdfPickerModal({
  open,
  onClose,
  pdfs,
  selectedId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  pdfs: any[];
  selectedId?: string;
  onPick: (id: string) => void | Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [focusedId, setFocusedId] = useState<string | undefined>(selectedId);

  useEffect(() => {
    if (open) setFocusedId(selectedId);
  }, [open, selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pdfs;
    return pdfs.filter((doc: any) =>
      [doc.title, doc.fileName, doc.category]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q)),
    );
  }, [search, pdfs]);

  const focused = filtered.find((d: any) => d._id === focusedId) ?? filtered[0];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Select a fillable PDF template"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--accent"
            disabled={!focused}
            onClick={() => focused && onPick(focused._id)}
          >
            Select template
          </button>
        </>
      }
    >
      <div className="pdf-picker">
        <aside className="pdf-picker__list">
          <input
            className="input"
            placeholder="Search title, filename, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="pdf-picker__items">
            {filtered.length === 0 && (
              <div className="muted" style={{ padding: 12 }}>
                No PDFs match.
              </div>
            )}
            {filtered.map((doc: any) => (
              <button
                key={doc._id}
                type="button"
                className={`pdf-picker__item${
                  focused && focused._id === doc._id ? " is-active" : ""
                }`}
                onClick={() => setFocusedId(doc._id)}
                onDoubleClick={() => onPick(doc._id)}
              >
                <strong>{doc.title ?? doc.fileName}</strong>
                {doc.fileName && doc.fileName !== doc.title && (
                  <span className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
                    {doc.fileName}
                  </span>
                )}
                {doc.category && (
                  <span className="cell-tag" style={{ alignSelf: "flex-start" }}>
                    {doc.category}
                  </span>
                )}
              </button>
            ))}
          </div>
        </aside>
        <section className="pdf-picker__preview">
          {focused ? (
            <PdfPreviewPane doc={focused} />
          ) : (
            <div className="muted" style={{ padding: 24 }}>
              Pick a document on the left to preview it here.
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}


function PdfPreviewPane({ doc }: { doc: any }) {
  const latest = useQuery(api.documentVersions.latest, { documentId: doc._id });
  const getDownloadTarget = useAction(api.documentVersions.getDownloadTarget);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    setError(null);
    if (!latest?._id) return;
    let cancelled = false;
    (async () => {
      try {
        const target = await getDownloadTarget({ versionId: latest._id });
        if (cancelled) return;
        if (target?.kind === "url" && target.url) {
          setUrl(target.url);
        } else if (target?.kind === "local-filesystem") {
          setError("Local filesystem documents cannot be previewed in this web iframe.");
        } else {
          setError(target?.reason ?? "This document version does not expose a preview URL.");
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Unable to load preview.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [latest?._id, getDownloadTarget]);

  return (
    <div className="pdf-preview">
      <div className="pdf-preview__meta">
        <strong>{doc.title ?? doc.fileName}</strong>
        <div className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
          {doc.fileName ?? "—"} · {doc.category ?? "—"}
        </div>
      </div>
      <div className="pdf-preview__frame">
        {error && (
          <div className="muted" style={{ padding: 16 }}>
            {error}
          </div>
        )}
        {!error && url && (
          <iframe title="PDF preview" src={url} className="pdf-preview__iframe" />
        )}
        {!error && !url && latest?._id && (
          <div className="muted" style={{ padding: 16 }}>
            Loading preview…
          </div>
        )}
        {!error && !latest?._id && (
          <div className="muted" style={{ padding: 16 }}>
            No file attached to this document yet.
          </div>
        )}
      </div>
    </div>
  );
}


type MappingKind = "literal" | "dynamic" | "intake" | "person" | "personRef" | "manager" | "empty";


type PersonCategory = "members" | "directors" | "volunteers" | "employees";


type FieldMapping = {
  kind: MappingKind;
  // literal/default text
  value?: string;
  // dynamic: "today" | "today:long" | "now" | "society.name" | ...
  // intake/person/manager/personRef: "firstName" | "lastName" | "email" | "custom:<key>" | ...
  source?: string;
  // personRef-specific: which category + which person
  category?: PersonCategory;
  personId?: string;
};


const DYNAMIC_SOURCES: Array<{ value: string; label: string }> = [
  { value: "today", label: "Today (YYYY-MM-DD)" },
  { value: "today:long", label: "Today (Apr 20, 2026)" },
  { value: "now", label: "Now (ISO timestamp)" },
  { value: "society.name", label: "Society name" },
  { value: "currentUser.name", label: "Current user name" },
  { value: "currentUser.email", label: "Current user email" },
];


const PERSON_SOURCES: Array<{ value: string; label: string }> = [
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "mailingAddress", label: "Mailing address" },
  { value: "birthdate", label: "Birthdate" },
];


const MANAGER_SOURCES: Array<{ value: string; label: string }> = [
  { value: "name", label: "Name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "department", label: "Department / Organization" },
];


const PERSON_CATEGORIES: Array<{ value: PersonCategory; label: string }> = [
  { value: "members", label: "Members" },
  { value: "directors", label: "Directors" },
  { value: "volunteers", label: "Volunteers" },
  { value: "employees", label: "Employees" },
];

// Heuristic: given a raw PDF AcroForm field name, guess a sensible mapping.
// Returns null if nothing confident — the user sees "Empty" and picks manually.

function suggestMappingForField(fieldName: string, intakeFields: IntakeField[] = []): FieldMapping | null {
  const norm = fieldName.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();
  const contains = (needle: string) => norm.includes(needle);
  const match = (re: RegExp) => re.test(norm);
  const intakeMatch = intakeFields.find((field) => {
    const fieldLabel = field.label.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();
    const fieldKey = field.key.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();
    return fieldLabel === norm || fieldKey === norm;
  });
  if (intakeMatch) return { kind: "intake", source: intakeMatch.key };

  // Date signed / signature date / date of signature
  if (match(/(date.*sign|sign.*date|signature.*date)/)) {
    return { kind: "dynamic", source: "today" };
  }
  // Society / organization's own name
  if (match(/society.*name|organization.*name\b/) && !contains("manager")) {
    return { kind: "dynamic", source: "society.name" };
  }
  // Manager/authorizer block — must run BEFORE the generic person matchers.
  if (contains("manager") || contains("authoriz")) {
    if (match(/(email|e-?mail)/)) return { kind: "manager", source: "email" };
    if (match(/(phone|tel)/)) return { kind: "manager", source: "phone" };
    if (match(/(department|organization|org|dept)/)) {
      return { kind: "manager", source: "department" };
    }
    if (match(/(name|authoriz)/)) return { kind: "manager", source: "name" };
  }
  // Emergency contact — leave empty, the user probably wants a literal.
  if (contains("emergency")) return null;
  // Person/affiliate fields (runtime input from the workflow form).
  if (match(/\bfirst\b.*\bname\b/) || match(/\bfirst.?name\b/) || match(/\bgiven.?name\b/)) {
    return { kind: "person", source: "firstName" };
  }
  if (match(/\bmiddle\b.*\bname\b/)) {
    // No middle-name source — fallback to empty so the user notices.
    return null;
  }
  if (match(/\blast\b.*\bname\b/) || match(/\blast.?name\b/) || match(/\bsurname\b/) || match(/\bfamily.?name\b/)) {
    return { kind: "person", source: "lastName" };
  }
  if (match(/(birth.?date|date.*birth|\bdob\b)/)) {
    return { kind: "person", source: "birthdate" };
  }
  if (match(/(personal.*email|e-?mail.*address|^email$|\bemail\b)/)) {
    return { kind: "person", source: "email" };
  }
  if (match(/(mailing.*address|home.*address|current.*address|^address$|\baddress\b)/)) {
    return { kind: "person", source: "mailingAddress" };
  }
  if (match(/(phone|tel|mobile|cell)/)) {
    return { kind: "person", source: "phone" };
  }
  // Check boxes — leave empty.
  if (match(/^check\s*box/)) return null;
  return null;
}


function mappingEqualsSuggestion(a: FieldMapping | undefined, b: FieldMapping | null): boolean {
  if (!a || !b) return false;
  return a.kind === b.kind && (a.source ?? "") === (b.source ?? "") && (a.value ?? "") === (b.value ?? "");
}


function summariseMappings(fields: string[], mappings: Record<string, FieldMapping>) {
  const total = fields.length;
  let mapped = 0;
  const counts: Record<MappingKind, number> = {
    literal: 0,
    dynamic: 0,
    intake: 0,
    person: 0,
    personRef: 0,
    manager: 0,
    empty: 0,
  };
  for (const field of fields) {
    const m = mappings[field];
    if (!m || m.kind === "empty") continue;
    if (m.kind === "literal" && !(m.value ?? "").trim()) continue;
    if ((m.kind === "dynamic" || m.kind === "intake" || m.kind === "person" || m.kind === "manager") && !m.source) continue;
    if (m.kind === "personRef" && (!m.category || !m.personId || !m.source)) continue;
    counts[m.kind] += 1;
    mapped += 1;
  }
  const parts: string[] = [];
  if (counts.literal) parts.push(`${counts.literal} literal`);
  if (counts.dynamic) parts.push(`${counts.dynamic} dynamic`);
  if (counts.intake) parts.push(`${counts.intake} intake`);
  if (counts.person) parts.push(`${counts.person} person`);
  if (counts.personRef) parts.push(`${counts.personRef} record`);
  if (counts.manager) parts.push(`${counts.manager} manager`);
  const breakdown = parts.length > 0 ? parts.join(" · ") : "No mappings yet.";
  return { total, mapped, breakdown };
}


const KIND_LABEL: Record<MappingKind, string> = {
  empty: "Empty",
  literal: "Literal",
  dynamic: "Dynamic",
  intake: "Intake",
  person: "Person",
  personRef: "Person record",
  manager: "Manager",
};


function FieldMappingWizardModal({
  open,
  onClose,
  fields,
  mappings,
  intakeFields,
  onFieldsChange,
  onMappingsChange,
}: {
  open: boolean;
  onClose: () => void;
  fields: string[];
  mappings: Record<string, FieldMapping>;
  intakeFields: IntakeField[];
  onFieldsChange: (fields: string[]) => void | Promise<void>;
  onMappingsChange: (next: Record<string, FieldMapping>) => void | Promise<void>;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [newField, setNewField] = useState("");

  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open, fields.length]);

  const safeIndex = Math.min(stepIndex, Math.max(0, fields.length - 1));
  const currentField = fields[safeIndex];
  const current: FieldMapping = mappings[currentField] ?? { kind: "empty" };

  const summary = summariseMappings(fields, mappings);

  const updateMapping = (patch: Partial<FieldMapping>) => {
    if (!currentField) return;
    const existing = mappings[currentField] ?? { kind: "empty" as MappingKind };
    const next = { ...mappings, [currentField]: { ...existing, ...patch } };
    onMappingsChange(next);
  };

  const pickKind = (kind: MappingKind) => {
    if (!currentField) return;
    const next = {
      ...mappings,
      [currentField]: { kind, value: undefined, source: undefined } as FieldMapping,
    };
    onMappingsChange(next);
  };

  const removeField = (field: string) => {
    const nextFields = fields.filter((f) => f !== field);
    onFieldsChange(nextFields);
    if (mappings[field]) {
      const { [field]: _drop, ...rest } = mappings;
      onMappingsChange(rest);
    }
    setStepIndex((i) => Math.max(0, Math.min(i, nextFields.length - 1)));
  };

  const addField = () => {
    const name = newField.trim();
    if (!name || fields.includes(name)) return;
    onFieldsChange([...fields, name]);
    const suggestion = suggestMappingForField(name, intakeFields);
    if (suggestion) {
      onMappingsChange({ ...mappings, [name]: suggestion });
    }
    setNewField("");
    setStepIndex(fields.length); // jump to the newly added one
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Map PDF fields"
      footer={
        <>
          <div className="muted" style={{ marginRight: "auto", fontSize: "var(--fs-sm)" }}>
            {summary.mapped} of {summary.total} mapped · {summary.breakdown}
          </div>
          <button
            className="btn"
            title="Apply the heuristic suggestion to every field that's currently empty."
            onClick={() => {
              const next = { ...mappings };
              let applied = 0;
              for (const field of fields) {
                const existing = next[field];
                const isEmpty =
                  !existing ||
                  existing.kind === "empty" ||
                  (existing.kind === "literal" && !(existing.value ?? "").trim()) ||
                  ((existing.kind === "dynamic" || existing.kind === "intake" || existing.kind === "person" || existing.kind === "manager") && !existing.source);
                if (!isEmpty) continue;
                const suggestion = suggestMappingForField(field, intakeFields);
                if (!suggestion) continue;
                next[field] = suggestion;
                applied += 1;
              }
              if (applied > 0) onMappingsChange(next);
            }}
          >
            Auto-fill empty fields
          </button>
          <button
            className="btn"
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            disabled={safeIndex <= 0}
          >
            Previous
          </button>
          <button
            className="btn"
            onClick={() => setStepIndex((i) => Math.min(fields.length - 1, i + 1))}
            disabled={safeIndex >= fields.length - 1}
          >
            Next
          </button>
          <button className="btn btn--accent" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="mapping-wizard">
        <aside className="mapping-wizard__sidebar">
          <div className="field__label">Fields</div>
          <div className="mapping-wizard__list">
            {fields.length === 0 && (
              <div className="muted" style={{ padding: 8, fontSize: "var(--fs-sm)" }}>
                No fields yet. Add one below.
              </div>
            )}
            {fields.map((field, idx) => {
              const m = mappings[field];
              const isDone =
                m &&
                m.kind !== "empty" &&
                !(m.kind === "literal" && !(m.value ?? "").trim()) &&
                !((m.kind === "dynamic" || m.kind === "intake" || m.kind === "person" || m.kind === "manager") && !m.source);
              return (
                <button
                  key={field}
                  type="button"
                  className={`mapping-wizard__item${idx === safeIndex ? " is-active" : ""}`}
                  onClick={() => setStepIndex(idx)}
                >
                  <span className="mapping-wizard__item-label mono">{field}</span>
                  <span
                    className={`mapping-wizard__item-badge${isDone ? " is-done" : ""}`}
                    aria-label={isDone ? "Mapped" : "Not yet mapped"}
                  >
                    {isDone ? KIND_LABEL[m.kind] : "—"}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mapping-wizard__add">
            <input
              className="input"
              placeholder="Add field name"
              value={newField}
              onChange={(e) => setNewField(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addField();
                }
              }}
            />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={addField}
              disabled={!newField.trim()}
            >
              <Plus size={12} /> Add
            </button>
          </div>
        </aside>

        <section className="mapping-wizard__main">
          {!currentField ? (
            <div className="muted" style={{ padding: 16 }}>
              Add a PDF field in the sidebar to start mapping.
            </div>
          ) : (
            <>
              <div className="mapping-wizard__stepper muted" style={{ fontSize: "var(--fs-xs)" }}>
                Field {safeIndex + 1} of {fields.length}
              </div>
              <h3 className="mapping-wizard__field mono">{currentField}</h3>

              {(() => {
                const suggestion = suggestMappingForField(currentField, intakeFields);
                if (!suggestion) return null;
                const label =
                  suggestion.kind === "dynamic"
                    ? `Dynamic · ${DYNAMIC_SOURCES.find((s) => s.value === suggestion.source)?.label ?? suggestion.source}`
                    : suggestion.kind === "intake"
                      ? `Intake · ${intakeFields.find((field) => field.key === suggestion.source)?.label ?? suggestion.source}`
                    : suggestion.kind === "person"
                      ? `Person · ${PERSON_SOURCES.find((s) => s.value === suggestion.source)?.label ?? suggestion.source}`
                      : suggestion.kind === "manager"
                        ? `Manager · ${MANAGER_SOURCES.find((s) => s.value === suggestion.source)?.label ?? suggestion.source}`
                        : suggestion.kind === "literal"
                          ? `Literal · "${suggestion.value ?? ""}"`
                          : suggestion.kind;
                const already = mappingEqualsSuggestion(current, suggestion);
                return (
                  <div className="mapping-wizard__suggestion">
                    <span
                      className={`mapping-wizard__suggestion-badge${already ? " is-applied" : ""}`}
                    >
                      {already ? "Suggestion applied" : "Suggested"}
                    </span>
                    <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                      {label}
                    </span>
                    {!already && (
                      <button
                        type="button"
                        className="btn btn--accent btn--sm"
                        onClick={() => {
                          onMappingsChange({ ...mappings, [currentField]: suggestion });
                        }}
                      >
                        Apply
                      </button>
                    )}
                  </div>
                );
              })()}

              <div className="field__label">Source</div>
              <div className="mapping-wizard__kinds">
                {(["literal", "dynamic", "intake", "person", "personRef", "manager", "empty"] as MappingKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`mapping-wizard__kind${current.kind === k ? " is-active" : ""}`}
                    onClick={() => pickKind(k)}
                  >
                    <strong>{KIND_LABEL[k]}</strong>
                    <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                      {
                        {
                          literal: "A default string you type in",
                          dynamic: "Today / Now / society name etc.",
                          intake: "Value collected by the intake form",
                          person: "Field from the affiliate (runtime input)",
                          personRef: "Specific person record (director, member, …)",
                          manager: "Field from the requesting manager",
                          empty: "Leave blank at runtime",
                        }[k]
                      }
                    </span>
                  </button>
                ))}
              </div>

              <div className="field__label" style={{ marginTop: 16 }}>
                Value
              </div>
              <div className="mapping-wizard__value">
                {current.kind === "literal" && (
                  <input
                    className="input"
                    value={current.value ?? ""}
                    placeholder="Default value"
                    onChange={(e) => updateMapping({ value: e.target.value })}
                  />
                )}
                {current.kind === "dynamic" && (
                  <select
                    className="input"
                    value={current.source ?? ""}
                    onChange={(e) => updateMapping({ source: e.target.value })}
                  >
                    <option value="">— Pick token —</option>
                    {DYNAMIC_SOURCES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
                {current.kind === "intake" && (
                  <select
                    className="input"
                    value={current.source ?? ""}
                    onChange={(e) => updateMapping({ source: e.target.value })}
                  >
                    <option value="">— Pick intake field —</option>
                    {intakeFields.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                )}
                {current.kind === "person" && (
                  <select
                    className="input"
                    value={current.source ?? ""}
                    onChange={(e) => updateMapping({ source: e.target.value })}
                  >
                    <option value="">— Pick person field —</option>
                    {PERSON_SOURCES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
                {current.kind === "personRef" && (
                  <PersonRefPicker
                    category={current.category}
                    personId={current.personId}
                    source={current.source}
                    onChange={(patch) => updateMapping(patch)}
                  />
                )}
                {current.kind === "manager" && (
                  <select
                    className="input"
                    value={current.source ?? ""}
                    onChange={(e) => updateMapping({ source: e.target.value })}
                  >
                    <option value="">— Pick manager field —</option>
                    {MANAGER_SOURCES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
                {current.kind === "empty" && (
                  <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                    This field will be left blank at runtime.
                  </span>
                )}
              </div>

              <div className="mapping-wizard__row-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => removeField(currentField)}
                >
                  <Trash2 size={12} /> Remove field
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}


function PersonRefPicker({
  category,
  personId,
  source,
  onChange,
}: {
  category?: PersonCategory;
  personId?: string;
  source?: string;
  onChange: (patch: Partial<FieldMapping>) => void;
}) {
  const society = useSociety();
  const societyArg = society ? { societyId: society._id } : "skip";
  const members = useQuery(api.members.list, category === "members" ? societyArg : "skip");
  const directors = useQuery(api.directors.list, category === "directors" ? societyArg : "skip");
  const volunteers = useQuery(api.volunteers.list, category === "volunteers" ? societyArg : "skip");
  const employees = useQuery(api.employees.list, category === "employees" ? societyArg : "skip");
  const definitions = useQuery(
    api.customFields.listDefinitions,
    society && category ? { societyId: society._id, entityType: category } : "skip",
  );

  const peopleRaw: any[] =
    category === "members"
      ? members ?? []
      : category === "directors"
        ? directors ?? []
        : category === "volunteers"
          ? volunteers ?? []
          : category === "employees"
            ? employees ?? []
            : [];

  const displayName = (p: any) => {
    const first = p.firstName ?? "";
    const last = p.lastName ?? "";
    const full = `${first} ${last}`.trim();
    return full || p.name || p.email || "Unnamed";
  };

  const fieldOptionsFor = (cat?: PersonCategory) => {
    const base: Array<{ value: string; label: string }> = [
      { value: "firstName", label: "First name" },
      { value: "lastName", label: "Last name" },
      { value: "fullName", label: "Full name" },
      { value: "email", label: "Email" },
    ];
    if (cat === "members") {
      base.push(
        { value: "phone", label: "Phone" },
        { value: "address", label: "Mailing address" },
        { value: "membershipClass", label: "Membership class" },
      );
    } else if (cat === "directors") {
      base.push({ value: "position", label: "Position" });
    } else if (cat === "volunteers") {
      base.push({ value: "phone", label: "Phone" });
    } else if (cat === "employees") {
      base.push({ value: "role", label: "Role" });
    }
    return base;
  };

  return (
    <div className="person-ref-picker">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <select
          className="input"
          value={category ?? ""}
          onChange={(e) =>
            onChange({
              category: (e.target.value || undefined) as PersonCategory | undefined,
              personId: undefined,
              source: undefined,
            })
          }
        >
          <option value="">— Pick category —</option>
          {PERSON_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={personId ?? ""}
          disabled={!category}
          onChange={(e) =>
            onChange({ personId: e.target.value || undefined, source: undefined })
          }
        >
          <option value="">— Pick person —</option>
          {peopleRaw.map((p: any) => (
            <option key={p._id} value={p._id}>
              {displayName(p)}
              {p.email ? ` · ${p.email}` : ""}
            </option>
          ))}
        </select>
      </div>
      <select
        className="input"
        value={source ?? ""}
        disabled={!category || !personId}
        onChange={(e) => onChange({ source: e.target.value || undefined })}
      >
        <option value="">— Pick field —</option>
        <optgroup label="Built-in">
          {fieldOptionsFor(category).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </optgroup>
        {definitions && definitions.length > 0 && (
          <optgroup label="Custom">
            {definitions.map((d: any) => (
              <option key={d._id} value={`custom:${d.key}`}>
                {d.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {category && !peopleRaw.length && (
        <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          No {category} yet. Add some in <span className="mono">/app/{category}</span>.
        </div>
      )}
    </div>
  );
}


function FieldMappingEditor({
  fields,
  mappings,
  onFieldsChange,
  onMappingsChange,
}: {
  fields: string[];
  mappings: Record<string, FieldMapping>;
  onFieldsChange: (fields: string[]) => void | Promise<void>;
  onMappingsChange: (next: Record<string, FieldMapping>) => void | Promise<void>;
}) {
  const [newField, setNewField] = useState("");

  const updateMapping = (field: string, patch: Partial<FieldMapping>) => {
    const next = { ...mappings, [field]: { ...(mappings[field] ?? { kind: "empty" }), ...patch } };
    onMappingsChange(next);
  };

  const removeField = (field: string) => {
    const nextFields = fields.filter((f) => f !== field);
    onFieldsChange(nextFields);
    if (mappings[field]) {
      const { [field]: _drop, ...rest } = mappings;
      onMappingsChange(rest);
    }
  };

  const addField = () => {
    const name = newField.trim();
    if (!name || fields.includes(name)) return;
    onFieldsChange([...fields, name]);
    setNewField("");
  };

  return (
    <div className="field-mapping">
      <div className="field-mapping__head">
        <div className="field__label">PDF field mapping</div>
        <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          Each field can be filled from a literal value, a dynamic token, a person record, or the
          requesting manager. Auto-detection of fields from the template ships with Phase 2.
        </div>
      </div>

      {fields.length === 0 && (
        <div className="muted" style={{ fontSize: "var(--fs-sm)", padding: "8px 0" }}>
          No fields yet. Add one below.
        </div>
      )}

      <div className="field-mapping__rows">
        {fields.map((field) => {
          const mapping: FieldMapping = mappings[field] ?? { kind: "empty" };
          return (
            <div key={field} className="field-mapping__row">
              <div className="field-mapping__name mono">{field}</div>
              <select
                className="input field-mapping__kind"
                value={mapping.kind}
                onChange={(e) =>
                  updateMapping(field, {
                    kind: e.target.value as MappingKind,
                    value: undefined,
                    source: undefined,
                  })
                }
              >
                <option value="empty">— Empty —</option>
                <option value="literal">Literal / default</option>
                <option value="dynamic">Dynamic token</option>
                <option value="person">Person field</option>
                <option value="manager">Manager field</option>
              </select>
              <div className="field-mapping__value">
                {mapping.kind === "literal" && (
                  <input
                    className="input"
                    value={mapping.value ?? ""}
                    placeholder="Default value"
                    onChange={(e) => updateMapping(field, { value: e.target.value })}
                  />
                )}
                {mapping.kind === "dynamic" && (
                  <select
                    className="input"
                    value={mapping.source ?? ""}
                    onChange={(e) => updateMapping(field, { source: e.target.value })}
                  >
                    <option value="">— Pick token —</option>
                    {DYNAMIC_SOURCES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
                {mapping.kind === "person" && (
                  <select
                    className="input"
                    value={mapping.source ?? ""}
                    onChange={(e) => updateMapping(field, { source: e.target.value })}
                  >
                    <option value="">— Pick person field —</option>
                    {PERSON_SOURCES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
                {mapping.kind === "manager" && (
                  <select
                    className="input"
                    value={mapping.source ?? ""}
                    onChange={(e) => updateMapping(field, { source: e.target.value })}
                  >
                    <option value="">— Pick manager field —</option>
                    {MANAGER_SOURCES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
                {mapping.kind === "empty" && (
                  <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                    No value at runtime.
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--icon"
                aria-label={`Remove field ${field}`}
                onClick={() => removeField(field)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="field-mapping__add">
        <input
          className="input"
          placeholder="Add PDF field name (e.g. Legal First Name of Affiliate)"
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addField();
            }
          }}
        />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={addField}
          disabled={!newField.trim()}
        >
          <Plus size={12} /> Add field
        </button>
      </div>
    </div>
  );
}



export {
  PdfPickerModal,
  PdfPreviewPane,
  DYNAMIC_SOURCES,
  PERSON_SOURCES,
  MANAGER_SOURCES,
  PERSON_CATEGORIES,
  suggestMappingForField,
  mappingEqualsSuggestion,
  summariseMappings,
  KIND_LABEL,
  FieldMappingWizardModal,
  PersonRefPicker,
  FieldMappingEditor,
};

export type {
  MappingKind,
  PersonCategory,
  FieldMapping,
};
