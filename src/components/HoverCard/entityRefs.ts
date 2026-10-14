/**
 * References to records that can be previewed (hover cards) and stacked
 * (record side panel). A reference names the kind and either an id or, for
 * people and payees known only by name, the name as written.
 */
export type EntityKind =
  | "person"
  | "member"
  | "director"
  | "document"
  | "meeting"
  | "counterparty"
  | "invoice"
  | "claim";

export type EntityRef = {
  kind: EntityKind;
  id?: string;
  /** Name as written (people and payees); also the fallback label. */
  name?: string;
};

export const ENTITY_KIND_LABEL: Record<EntityKind, string> = {
  person: "Person",
  member: "Member",
  director: "Director",
  document: "Document",
  meeting: "Meeting",
  counterparty: "Payee",
  invoice: "Invoice",
  claim: "Expense claim",
};

/** Permission needed to read each kind's preview data. */
export const ENTITY_KIND_PERMISSION: Record<EntityKind, string> = {
  person: "members:read",
  member: "members:read",
  director: "directors:read",
  document: "documents:read",
  meeting: "meetings:read",
  counterparty: "financials:read",
  invoice: "financials:read",
  claim: "financials:read",
};

export function entityKey(ref: EntityRef) {
  return `${ref.kind}:${ref.id ?? ""}:${ref.id ? "" : (ref.name ?? "").trim().toLowerCase()}`;
}

export function sameEntity(a: EntityRef | null | undefined, b: EntityRef | null | undefined) {
  return !!a && !!b && entityKey(a) === entityKey(b);
}

/** Where "Open full page" goes for each kind. */
export function entityHref(ref: EntityRef): string | null {
  const id = ref.id ? encodeURIComponent(ref.id) : null;
  switch (ref.kind) {
    case "member":
      return id ? `/app/members/${id}` : null;
    case "director":
      return id ? `/app/directors?record=${id}` : null;
    case "person":
      return id ? `/app/people-directory/${id}` : null;
    case "document":
      return id ? `/app/documents/${id}` : null;
    case "meeting":
      return id ? `/app/meetings/${id}` : null;
    case "invoice":
      return "/app/invoices";
    case "claim":
      return "/app/approvals";
    case "counterparty":
      return "/app/financials";
    default:
      return null;
  }
}

/* -------------------------- URL encoding --------------------------- */

const KIND_CODES: Record<EntityKind, string> = {
  person: "p",
  member: "m",
  director: "d",
  document: "doc",
  meeting: "mtg",
  counterparty: "cp",
  invoice: "inv",
  claim: "clm",
};
const CODE_KINDS = Object.fromEntries(
  Object.entries(KIND_CODES).map(([kind, code]) => [code, kind]),
) as Record<string, EntityKind>;

/** `m.abc123~doc.xyz~cp_Coastal%20Hydro` — ids after ".", names after "_". */
export function encodeEntityStack(refs: readonly EntityRef[]): string {
  return refs
    .map((ref) =>
      ref.id
        ? `${KIND_CODES[ref.kind]}.${encodeURIComponent(ref.id)}`
        : `${KIND_CODES[ref.kind]}_${encodeURIComponent(ref.name ?? "")}`,
    )
    .join("~");
}

export function decodeEntityStack(value: string | null | undefined): EntityRef[] {
  if (!value) return [];
  const refs: EntityRef[] = [];
  for (const part of value.split("~")) {
    const match = /^([a-z]+)([._])(.+)$/.exec(part);
    if (!match) continue;
    const kind = CODE_KINDS[match[1]];
    if (!kind) continue;
    let payload = match[3];
    try {
      payload = decodeURIComponent(payload);
    } catch {
      continue;
    }
    refs.push(match[2] === "." ? { kind, id: payload } : { kind, name: payload });
  }
  return refs;
}

/* --------------------- Finding references in records --------------------- */

/** Id-bearing keys that point at a previewable record. */
const LINK_KEYS: Array<{ key: string; kind: EntityKind; label: string }> = [
  { key: "memberId", kind: "member", label: "Member" },
  { key: "directorId", kind: "director", label: "Director" },
  { key: "directoryPersonId", kind: "person", label: "Person" },
  { key: "personId", kind: "person", label: "Person" },
  { key: "meetingId", kind: "meeting", label: "Meeting" },
  { key: "documentId", kind: "document", label: "Document" },
  { key: "receiptDocumentId", kind: "document", label: "Receipt" },
  { key: "sourceDocumentId", kind: "document", label: "Source document" },
  { key: "invoiceId", kind: "invoice", label: "Invoice" },
  { key: "expenseReportId", kind: "claim", label: "Expense claim" },
  { key: "claimId", kind: "claim", label: "Expense claim" },
];

/** Relation targets (field metadata `targetObjectNamePlural`) we can preview. */
const RELATION_TARGET_KINDS: Record<string, EntityKind> = {
  members: "member",
  directors: "director",
  documents: "document",
  meetings: "meeting",
  peopleDirectory: "person",
  people: "person",
  invoices: "invoice",
  expenseReports: "claim",
};

export function relationTargetKind(targetObjectNamePlural: string | undefined | null): EntityKind | null {
  if (!targetObjectNamePlural) return null;
  return RELATION_TARGET_KINDS[targetObjectNamePlural] ?? null;
}

export type LinkedEntity = { ref: EntityRef; label: string; fieldName: string };

/**
 * Previewable records a row points at through id fields (memberId,
 * meetingId, receiptDocumentId…). The record's own object is excluded.
 */
export function linkedEntitiesForRecord(
  record: Record<string, unknown> | null | undefined,
  options: { selfKind?: EntityKind | null; skipFields?: ReadonlySet<string> } = {},
): LinkedEntity[] {
  if (!record) return [];
  const seen = new Set<string>();
  const out: LinkedEntity[] = [];
  const push = (fieldName: string, ref: EntityRef, label: string) => {
    if (options.skipFields?.has(fieldName)) return;
    const key = entityKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ref, label, fieldName });
  };
  for (const { key, kind, label } of LINK_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value) {
      if (options.selfKind === kind && String(record._id ?? "") === value) continue;
      push(key, { kind, id: value, name: labelFor(record, key) }, label);
    }
  }
  if (record.matchedKind === "receipt" && typeof record.matchedId === "string") {
    push("matchedId", { kind: "claim", id: record.matchedId }, "Matched claim");
  }
  if (Array.isArray(record.sourceDocumentIds)) {
    for (const id of record.sourceDocumentIds.slice(0, 6)) {
      if (typeof id === "string" && id) push("sourceDocumentIds", { kind: "document", id }, "Source document");
    }
  }
  return out;
}

function labelFor(record: Record<string, unknown>, key: string) {
  const base = key.replace(/Id$/, "");
  const candidates = [`${key}Label`, `${base}Label`, `${base}Name`, `${base}Title`, base];
  for (const candidate of candidates) {
    const value = record[candidate];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Text fields that hold a person's name as written (Moved by, Contact,
 * Proxy holder…). They preview the matching directory person, if any.
 */
const PERSON_NAME_ICONS = new Set(["User", "UserCheck", "UserCog", "UserRound"]);
const NOT_A_PERSON_FIELD = /^(firstName|lastName|middleName|fullName|name|fromName|clientName|firmName)$/;

export function isPersonNameField(field: { name: string; fieldType: string; icon?: string | null }) {
  if (field.fieldType !== "TEXT") return false;
  if (NOT_A_PERSON_FIELD.test(field.name)) return false;
  return !!field.icon && PERSON_NAME_ICONS.has(field.icon);
}

/**
 * The related record a panel field points at: a relation to a previewable
 * object, or a person's name as written.
 */
export function fieldEntityRef(
  field: { name: string; fieldType: string; icon?: string | null; config?: Record<string, any> | null },
  value: unknown,
  label?: unknown,
): EntityRef | null {
  if (field.fieldType === "RELATION") {
    const kind = relationTargetKind(field.config?.targetObjectNamePlural);
    if (!kind || typeof value !== "string" || !value) return null;
    return { kind, id: value, name: typeof label === "string" ? label : undefined };
  }
  if (isPersonNameField(field) && typeof value === "string" && value.trim()) {
    return { kind: "person", name: value.trim() };
  }
  return null;
}

/* ------------------- Table cells that show a preview -------------------- */

type CellPreview = (record: any) => EntityRef | null;

const idRef = (kind: EntityKind, nameOf?: (record: any) => string | undefined): CellPreview =>
  (record) => (record?._id ? { kind, id: String(record._id), name: nameOf?.(record) } : null);

const fullName = (record: any) =>
  [record?.firstName, record?.lastName].filter(Boolean).join(" ") || record?.name || undefined;

/**
 * Opt-in, per object: which table cells show a hover card. `"*"` is the
 * object's label identifier (the record's own name cell).
 */
export const RECORD_TABLE_CELL_PREVIEWS: Record<string, Record<string, CellPreview>> = {
  // People tables lead with the first name rather than a label identifier.
  member: { "*": idRef("member", fullName), firstName: idRef("member", fullName) },
  director: { "*": idRef("director", fullName), firstName: idRef("director", fullName) },
  document: { "*": idRef("document", (record) => record?.title) },
  meeting: { "*": idRef("meeting", (record) => record?.title) },
  financialTransaction: {
    counterparty: (record) =>
      typeof record?.counterparty === "string" && record.counterparty.trim()
        ? { kind: "counterparty", name: record.counterparty.trim() }
        : null,
  },
};

export function cellPreviewRef(
  objectNameSingular: string | undefined,
  fieldName: string,
  isLabelIdentifier: boolean,
  record: any,
): EntityRef | null {
  if (!objectNameSingular) return null;
  const previews = RECORD_TABLE_CELL_PREVIEWS[objectNameSingular];
  if (!previews) return null;
  const resolve = previews[fieldName] ?? (isLabelIdentifier ? previews["*"] : undefined);
  return resolve ? resolve(record) : null;
}

/** The kind of the records an object's table lists, when previewable. */
export function entityKindForObject(objectNameSingular: string | undefined): EntityKind | null {
  switch (objectNameSingular) {
    case "member":
    case "director":
    case "document":
    case "meeting":
      return objectNameSingular;
    default:
      return null;
  }
}
