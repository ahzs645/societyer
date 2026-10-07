/**
 * PORTABLE FUNCTIONS: the agreements register (schema finding A5).
 *
 * list / get / forRecord / summary / conversionPreview (queries) and
 * create / update / terminate / renew / setRenewalDecision /
 * setObligationStatus / remove / syncObligations / convertGaps (mutations).
 *
 * Rules live in `shared/agreements.ts`. Every write re-derives the deadlines an
 * agreement implies (deliverables, reports, renewal notice, term end) and keeps
 * them linked through `deadlines.agreementId` + `sourceKey`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime and the conformance
 * engines. Permission: `agreements:read` / `agreements:write` (actionPolicy).
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";
import { requirePermissionPortable, type Permission } from "./permissions";
import { todayDateOnly } from "../dateOnly";
import {
  AGREEMENT_KINDS,
  CLOSED_AGREEMENT_STATUSES,
  DELIVERABLE_STATUSES,
  EXPIRING_WINDOW_DAYS,
  RENEWAL_DECISIONS,
  agreementObligations,
  agreementPayloadFromExtraction,
  assertAgreementValid,
  counterpartyNames,
  currentTermEnd,
  deriveAgreementStatus,
  hasCounterparty,
  hasRenewalDecision,
  inferAgreementKind,
  isExpiringWithin,
  isIsoDay,
  obligationRowId,
  renewalDueDate,
  renewalNoticeDate,
  signingAuthorityCheck,
  validateAgreementInput,
  type AgreementLike,
  type SigningAuthorityRow,
} from "../agreements";

type Row = Record<string, any> & { _id: string; societyId: string };

const today = () => todayDateOnly();
const nowISO = () => new Date().toISOString();

/** Fields a create/update may set. Everything else is server-managed. */
const EDITABLE_FIELDS = [
  "title", "kind", "status", "agreementNumber", "summary", "parties", "ourSignatories", "counterpartySignatories", "signedDate",
  "effectiveDate", "endDate", "autoRenew", "renewalTermMonths", "renewalNoticeDays", "terminationNoticeDays", "terminationTerms",
  "valueCents", "currency", "paymentTerms", "paymentSchedule", "deliverables", "reportingObligations", "confidential", "governingLaw",
  "signedDocumentId", "signedDocumentVersionId", "documentIds", "linkedGrantId", "linkedServiceProviderId", "linkedCommitteeId",
  "approvedAtMeetingId", "approvalMotionId", "approvalNote", "renewalDecision", "reviewStatus", "notes", "confidence",
] as const;

/** Reference fields and the table each must belong to (same workspace). */
const REFERENCE_TABLES: Record<string, string> = {
  signedDocumentId: "documents", signedDocumentVersionId: "documentVersions", linkedGrantId: "grants", linkedServiceProviderId: "serviceProviders",
  linkedCommitteeId: "committees", approvedAtMeetingId: "meetings", approvalMotionId: "motions",
};

const clean = (value: unknown, max = 1000) => {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
};

function compact<T extends Record<string, any>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

async function canRead(ctx: PortableQueryCtx, societyId: string, permission: Permission): Promise<boolean> {
  try {
    await requirePermissionPortable(ctx, societyId, permission);
    return true;
  } catch (error) {
    if (error instanceof Error && /^(?:Permission|Service scope) [a-zA-Z]+:[a-z]+ required\.$/.test(error.message)) return false;
    throw error;
  }
}

async function ownedAgreement(ctx: PortableQueryCtx, id: string): Promise<Row> {
  const candidate = await ctx.db.get<Row>(id, "agreements");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("Record not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  return getOwned<Row>(ctx, "agreements", id, candidate.societyId);
}

/** Normalize nested rows so ids are present, text trimmed and unknown keys dropped. */
function normalizeNested(input: Record<string, any>, salt: string): Record<string, any> {
  const out: Record<string, any> = { ...input };
  if (Array.isArray(input.parties)) {
    out.parties = input.parties.map((party: any) => compact({
      name: clean(party?.name, 200) ?? "",
      role: String(party?.role ?? "counterparty"),
      organizationName: clean(party?.organizationName, 200),
      directoryPersonId: clean(party?.directoryPersonId, 120),
      contact: clean(party?.contact, 300),
      notes: clean(party?.notes, 500),
    }));
  }
  for (const key of ["ourSignatories", "counterpartySignatories"] as const) {
    if (!Array.isArray(input[key])) continue;
    out[key] = input[key].map((row: any) => compact({
      name: clean(row?.name, 200) ?? "",
      title: clean(row?.title, 200),
      directoryPersonId: clean(row?.directoryPersonId, 120),
      signedAtISO: clean(row?.signedAtISO, 40),
    })).filter((row: any) => row.name || row.directoryPersonId);
  }
  if (Array.isArray(input.paymentSchedule)) {
    out.paymentSchedule = input.paymentSchedule.map((row: any) => compact({
      label: clean(row?.label, 200) ?? "Payment",
      dueDate: clean(row?.dueDate, 10),
      amountCents: row?.amountCents === undefined || row?.amountCents === null || row?.amountCents === "" ? undefined : Number(row.amountCents),
      status: clean(row?.status, 40),
    }));
  }
  if (Array.isArray(input.deliverables)) {
    out.deliverables = input.deliverables.map((row: any, index: number) => compact({
      id: clean(row?.id, 80) ?? obligationRowId("deliverable", index, `${salt}|${row?.text ?? ""}`),
      text: clean(row?.text, 1000) ?? "",
      dueDate: clean(row?.dueDate, 10),
      owner: clean(row?.owner, 200),
      ownerPersonId: clean(row?.ownerPersonId, 120),
      status: clean(row?.status, 40) ?? "not_started",
      completedAtISO: clean(row?.completedAtISO, 40),
      notes: clean(row?.notes, 1000),
    }));
  }
  if (Array.isArray(input.reportingObligations)) {
    out.reportingObligations = input.reportingObligations.map((row: any, index: number) => compact({
      id: clean(row?.id, 80) ?? obligationRowId("report", index, `${salt}|${row?.text ?? ""}`),
      text: clean(row?.text, 1000) ?? "",
      dueDate: clean(row?.dueDate, 10),
      recurrence: clean(row?.recurrence, 40),
      recipient: clean(row?.recipient, 200),
      status: clean(row?.status, 40) ?? "not_started",
      submittedAtISO: clean(row?.submittedAtISO, 40),
      notes: clean(row?.notes, 1000),
    }));
  }
  if (Array.isArray(input.documentIds)) out.documentIds = [...new Set(input.documentIds.map(String).filter(Boolean))];
  if (input.renewalDecision && typeof input.renewalDecision === "object") {
    out.renewalDecision = compact({
      decision: String(input.renewalDecision.decision ?? "undecided"),
      decidedAtISO: clean(input.renewalDecision.decidedAtISO, 40),
      notes: clean(input.renewalDecision.notes, 1000),
      motionId: clean(input.renewalDecision.motionId, 120),
    });
  }
  for (const key of ["title", "agreementNumber", "summary", "governingLaw", "terminationTerms", "paymentTerms", "approvalNote", "notes", "currency"]) {
    if (typeof input[key] === "string") out[key] = clean(input[key], key === "summary" || key === "notes" ? 5000 : 500);
  }
  if (typeof out.currency === "string") out.currency = out.currency.toUpperCase();
  for (const key of ["valueCents", "renewalNoticeDays", "terminationNoticeDays", "renewalTermMonths"]) {
    if (input[key] === "" || input[key] === null) out[key] = undefined;
    else if (input[key] !== undefined) out[key] = Number(input[key]);
  }
  return out;
}

/** Every referenced row (links, documents, people, motions) must be in the agreement's workspace. */
async function assertReferences(ctx: PortableQueryCtx, societyId: string, fields: Record<string, any>) {
  for (const [field, table] of Object.entries(REFERENCE_TABLES)) {
    const id = fields[field];
    if (typeof id === "string" && id) await getOwned(ctx, table, id, societyId);
  }
  for (const id of fields.documentIds ?? []) await getOwned(ctx, "documents", String(id), societyId);
  const people = [
    ...(fields.parties ?? []).map((row: any) => row.directoryPersonId),
    ...(fields.ourSignatories ?? []).map((row: any) => row.directoryPersonId),
    ...(fields.counterpartySignatories ?? []).map((row: any) => row.directoryPersonId),
    ...(fields.deliverables ?? []).map((row: any) => row.ownerPersonId),
  ].filter(Boolean);
  for (const id of new Set(people.map(String))) await getOwned(ctx, "peopleDirectory", id, societyId);
  if (fields.renewalDecision?.motionId) await getOwned(ctx, "motions", String(fields.renewalDecision.motionId), societyId);
  if (fields.approvalMotionId && fields.approvedAtMeetingId) {
    const motion = await ctx.db.get<Row>(fields.approvalMotionId, "motions");
    const meetingId = motion?.primaryMeetingId ?? motion?.meetingId;
    if (meetingId && String(meetingId) !== String(fields.approvedAtMeetingId)) throw new Error("Agreement: the authorizing motion belongs to another meeting.");
  }
}

/* ------------------------------ obligations ------------------------------ */

/**
 * Bring the deadlines generated for one agreement in line with its current
 * obligations. Open generated rows are updated or removed; completed rows are
 * history and are never touched; a deliverable or report marked done
 * completes its deadline instead of deleting it.
 */
export async function syncAgreementDeadlines(ctx: PortableMutationCtx, agreement: Row, asOf = today()) {
  const obligations = agreementObligations(agreement as AgreementLike, asOf);
  const wanted = new Map(obligations.map((item) => [item.sourceKey, item]));
  const done = new Set<string>([
    ...(agreement.deliverables ?? []).filter((row: any) => ["submitted", "accepted", "waived"].includes(String(row.status))).map((row: any) => `deliverable:${row.id}`),
    ...(agreement.reportingObligations ?? []).filter((row: any) => ["submitted", "accepted", "waived"].includes(String(row.status))).map((row: any) => `report:${row.id}`),
  ]);
  const existing = await ctx.db.query<Row>("deadlines").withIndex("by_agreement", (q) => q.eq("agreementId", agreement._id)).collect();
  let created = 0, updated = 0, removed = 0, completed = 0;
  const seen = new Set<string>();
  for (const row of existing) {
    const key = typeof row.sourceKey === "string" ? row.sourceKey : undefined;
    if (!key) continue; // linked by a person, not generated
    const open = (row.status ?? (row.done ? "complete" : "open")) === "open";
    const item = wanted.get(key);
    if (item && open && !seen.has(key)) {
      seen.add(key);
      const patch = compact({
        title: item.title !== row.title ? item.title : undefined,
        dueDate: item.dueDate !== row.dueDate && !item.recurrence ? item.dueDate : undefined,
        category: item.category !== row.category ? item.category : undefined,
        description: (item.description ?? undefined) !== (row.description ?? undefined) ? item.description : undefined,
      });
      if (Object.keys(patch).length) { await ctx.db.patch(row._id, patch); updated += 1; }
      continue;
    }
    if (item) { seen.add(key); continue; } // a completed occurrence (or a duplicate) stays as history
    if (!open) continue;
    if (done.has(key)) { await ctx.db.patch(row._id, { status: "complete", done: true }); completed += 1; continue; }
    await ctx.db.delete(row._id);
    removed += 1;
  }
  for (const item of obligations) {
    if (seen.has(item.sourceKey)) continue;
    await ctx.db.insert("deadlines", compact({
      societyId: agreement.societyId,
      title: item.title.slice(0, 200),
      description: item.description,
      dueDate: item.dueDate,
      category: item.category,
      status: "open" as const,
      done: false,
      recurrence: item.recurrence,
      recurrenceEndDate: item.recurrence && isIsoDay(agreement.endDate) ? agreement.endDate : undefined,
      agreementId: agreement._id,
      sourceKey: item.sourceKey,
    }));
    created += 1;
  }
  return { created, updated, removed, completed };
}

/* ------------------------------- projection ------------------------------- */

async function signingAuthorities(ctx: PortableQueryCtx, societyId: string): Promise<SigningAuthorityRow[] | null> {
  if (!(await canRead(ctx, societyId, "documents:read"))) return null;
  const rows = await ctx.db.query<Row>("signingAuthorities").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  return rows.map((row) => ({ personName: row.personName, roleTitle: row.roleTitle, directoryPersonId: row.directoryPersonId ? String(row.directoryPersonId) : undefined, authorityType: row.authorityType, tiers: row.tiers, effectiveDate: row.effectiveDate, endDate: row.endDate, status: row.status }));
}

/** Derived values the register and detail page show (never stored). */
export function projectAgreement(row: Row, asOf: string, authorities: SigningAuthorityRow[] | null): Record<string, any> {
  const agreement = row as AgreementLike;
  const effectiveStatus = deriveAgreementStatus(agreement, asOf);
  const signing = authorities ? signingAuthorityCheck(agreement, authorities, asOf) : null;
  const obligations = [...(row.deliverables ?? []), ...(row.reportingObligations ?? [])];
  const overdue = CLOSED_AGREEMENT_STATUSES.has(effectiveStatus) && effectiveStatus !== "expired" ? 0 : obligations.filter((item: any) => isIsoDay(item.dueDate) && item.dueDate < asOf && !["submitted", "accepted", "waived"].includes(String(item.status))).length;
  return {
    ...row,
    effectiveStatus,
    counterparties: counterpartyNames(agreement.parties),
    hasCounterparty: hasCounterparty(agreement.parties),
    currentTermEnd: currentTermEnd(agreement, asOf),
    renewalNoticeDate: renewalNoticeDate(agreement, asOf),
    renewalDue: CLOSED_AGREEMENT_STATUSES.has(effectiveStatus) ? undefined : renewalDueDate(agreement, asOf),
    expiringSoon: isExpiringWithin(agreement, asOf),
    renewalDecided: hasRenewalDecision(agreement),
    openObligations: obligations.filter((item: any) => !["submitted", "accepted", "waived"].includes(String(item.status))).length,
    overdueObligations: overdue,
    signing,
    signingWarning: signing?.status === "warning",
  };
}

/* --------------------------------- queries --------------------------------- */

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const asOf = today();
  const [rows, authorities] = await Promise.all([
    ctx.db.query<Row>("agreements").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    signingAuthorities(ctx, societyId),
  ]);
  return rows
    .map((row) => projectAgreement(row, asOf, authorities))
    .sort((a, b) => String(a.renewalDue ?? "9999").localeCompare(String(b.renewalDue ?? "9999")) || String(a.title).localeCompare(String(b.title)));
}

async function labelFor(ctx: PortableQueryCtx, table: string, id: unknown, societyId: string, permission: Permission): Promise<{ id: string; label: string } | null> {
  if (typeof id !== "string" || !id) return null;
  if (!(await canRead(ctx, societyId, permission))) return { id, label: "Not visible to you" };
  const row = await ctx.db.get<Row>(id, table);
  if (!row || row.societyId !== societyId) return null;
  const label = table === "grants" ? row.title
    : table === "serviceProviders" ? row.firmName
      : table === "committees" ? row.name
        : table === "meetings" ? `${row.title ?? "Meeting"}${row.scheduledAt ? ` · ${String(row.scheduledAt).slice(0, 10)}` : ""}`
          : table === "motions" ? String(row.text ?? "Motion").slice(0, 200)
            : table === "documents" ? row.title ?? row.fileName
              : table === "agreements" ? row.title
                : row.title ?? row.name;
  return { id, label: String(label ?? table) };
}

/** One agreement with derived values, labels for its links, its deadlines and version chain; null when missing. */
export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  let row: Row | null = null;
  try {
    row = await ctx.db.get<Row>(id, "agreements");
  } catch {
    return null;
  }
  if (!row || typeof row.societyId !== "string") return null;
  try {
    await requireSocietyMembership(ctx, row.societyId);
  } catch {
    return null;
  }
  const societyId = row.societyId;
  const asOf = today();
  const authorities = await signingAuthorities(ctx, societyId);
  const documentIds = [...new Set([row.signedDocumentId, ...(row.documentIds ?? []), ...(row.sourceDocumentIds ?? [])].filter(Boolean).map(String))];
  const documents = (await canRead(ctx, societyId, "documents:read"))
    ? (await Promise.all(documentIds.map(async (documentId) => {
      const doc = await ctx.db.get<Row>(documentId, "documents");
      if (!doc || doc.societyId !== societyId) return null;
      return { _id: doc._id, title: doc.title ?? doc.fileName ?? "Document", fileName: doc.fileName, category: doc.category, sourceVersionStatus: doc.sourceVersionStatus, createdAtISO: doc.createdAtISO, role: String(row!.signedDocumentId) === documentId ? "signed" : (row!.sourceDocumentIds ?? []).map(String).includes(documentId) ? "source" : "related" };
    }))).filter(Boolean)
    : [];
  const deadlines = (await canRead(ctx, societyId, "deadlines:read"))
    ? (await ctx.db.query<Row>("deadlines").withIndex("by_agreement", (q) => q.eq("agreementId", row!._id)).collect()).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    : null;
  // Version chain: predecessors through renewalOfId/supersedesId, successors through the index and supersededById.
  const chain: Array<{ _id: string; title: string; status: string; effectiveDate?: string; endDate?: string; relation: string }> = [];
  const seen = new Set<string>([String(row._id)]);
  let cursor: Row | null = row;
  for (let guard = 0; cursor && guard < 20; guard += 1) {
    const previousId: string | undefined = cursor.renewalOfId ?? cursor.supersedesId;
    if (!previousId || seen.has(String(previousId))) break;
    const previous: Row | null = await ctx.db.get<Row>(previousId, "agreements");
    if (!previous || previous.societyId !== societyId) break;
    seen.add(String(previous._id));
    chain.unshift({ _id: previous._id, title: previous.title, status: deriveAgreementStatus(previous as AgreementLike, asOf), effectiveDate: previous.effectiveDate, endDate: previous.endDate, relation: cursor.renewalOfId ? "renewed by the next" : "superseded by the next" });
    cursor = previous;
  }
  const successors: Row[] = [];
  let next: Row | null = row;
  for (let guard = 0; next && guard < 20; guard += 1) {
    const current: Row = next;
    const renewals = await ctx.db.query<Row>("agreements").withIndex("by_renewal_of", (q) => q.eq("renewalOfId", current._id)).collect();
    const candidate: Row | null = (current.supersededById ? await ctx.db.get<Row>(current.supersededById, "agreements") : null) ?? renewals[0] ?? null;
    if (!candidate || candidate.societyId !== societyId || seen.has(String(candidate._id))) break;
    seen.add(String(candidate._id));
    successors.push(candidate);
    next = candidate;
  }
  return {
    agreement: projectAgreement(row, asOf, authorities),
    links: {
      grant: await labelFor(ctx, "grants", row.linkedGrantId, societyId, "grants:read"),
      serviceProvider: await labelFor(ctx, "serviceProviders", row.linkedServiceProviderId, societyId, "settings:read"),
      committee: await labelFor(ctx, "committees", row.linkedCommitteeId, societyId, "committees:read"),
      meeting: await labelFor(ctx, "meetings", row.approvedAtMeetingId, societyId, "meetings:read"),
      motion: await labelFor(ctx, "motions", row.approvalMotionId, societyId, "motions:read"),
      renewalMotion: await labelFor(ctx, "motions", row.renewalDecision?.motionId, societyId, "motions:read"),
    },
    documents,
    deadlines,
    versions: [
      ...chain,
      { _id: row._id, title: row.title, status: deriveAgreementStatus(row as AgreementLike, asOf), effectiveDate: row.effectiveDate, endDate: row.endDate, relation: "this version" },
      ...successors.map((successor) => ({ _id: successor._id, title: successor.title, status: deriveAgreementStatus(successor as AgreementLike, asOf), effectiveDate: successor.effectiveDate, endDate: successor.endDate, relation: successor.renewalOfId ? "renewal" : "replacement" })),
    ],
  };
}

const RECORD_FIELDS: Record<string, string[]> = {
  grants: ["linkedGrantId"], serviceProviders: ["linkedServiceProviderId"], committees: ["linkedCommitteeId"], meetings: ["approvedAtMeetingId"],
  motions: ["approvalMotionId"], documents: ["signedDocumentId", "documentIds", "sourceDocumentIds"],
};

/** Agreements linked to a grant, service provider, committee, meeting, motion or document. */
export async function forRecordPortable(ctx: PortableQueryCtx, { societyId, table, recordId }: { societyId: string; table: string; recordId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const fields = RECORD_FIELDS[table];
  if (!fields) throw new Error("Agreements cannot be linked to that kind of record.");
  const rows = table === "grants"
    ? await ctx.db.query<Row>("agreements").withIndex("by_grant", (q) => q.eq("linkedGrantId", recordId)).collect()
    : await ctx.db.query<Row>("agreements").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const asOf = today();
  return rows
    .filter((row) => row.societyId === societyId && fields.some((field) => Array.isArray(row[field]) ? row[field].map(String).includes(recordId) : String(row[field] ?? "") === recordId))
    .map((row) => ({ _id: row._id, title: row.title, kind: row.kind, effectiveStatus: deriveAgreementStatus(row as AgreementLike, asOf), effectiveDate: row.effectiveDate, endDate: row.endDate, valueCents: row.valueCents, currency: row.currency, counterparties: counterpartyNames(row.parties) }));
}

/** Dashboard and coverage summary: counts, agreements expiring within the window, overdue obligations. */
export async function summaryPortable(ctx: PortableQueryCtx, { societyId, windowDays }: { societyId: string; windowDays?: number }) {
  await requireSocietyMembership(ctx, societyId);
  const asOf = today();
  const window = Math.max(1, Math.min(Number(windowDays ?? EXPIRING_WINDOW_DAYS) || EXPIRING_WINDOW_DAYS, 730));
  const [rows, authorities] = await Promise.all([
    ctx.db.query<Row>("agreements").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    signingAuthorities(ctx, societyId),
  ]);
  const projected = rows.map((row) => projectAgreement(row, asOf, authorities));
  const byStatus: Record<string, number> = {};
  for (const row of projected) byStatus[row.effectiveStatus] = (byStatus[row.effectiveStatus] ?? 0) + 1;
  const expiring = projected
    .filter((row) => isExpiringWithin(row as AgreementLike, asOf, window))
    .sort((a, b) => String(a.currentTermEnd).localeCompare(String(b.currentTermEnd)))
    .map((row) => ({ _id: row._id, title: row.title, counterparties: row.counterparties, endDate: row.currentTermEnd, renewalDue: row.renewalDue, renewalDecided: row.renewalDecided, autoRenew: Boolean(row.autoRenew), effectiveStatus: row.effectiveStatus }));
  return {
    today: asOf,
    windowDays: window,
    total: rows.length,
    byStatus,
    expiring,
    needsReview: projected.filter((row) => row.reviewStatus === "NeedsReview").length,
    overdueObligations: projected.reduce((sum, row) => sum + row.overdueObligations, 0),
    signingWarnings: projected.filter((row) => row.signingWarning).length,
  };
}

/* -------------------------------- mutations -------------------------------- */

type AgreementInput = Partial<Record<(typeof EDITABLE_FIELDS)[number], any>>;

function pickEditable(input: Record<string, any>): AgreementInput {
  const out: AgreementInput = {};
  for (const key of EDITABLE_FIELDS) if (Object.prototype.hasOwnProperty.call(input, key)) (out as any)[key] = input[key];
  return out;
}

async function logActivity(ctx: PortableMutationCtx, societyId: string, id: string, action: string, summary: string) {
  await ctx.db.insert("activity", { societyId, actor: "You", entityType: "agreement", subjectId: id, entityId: id, action, summary: summary.slice(0, 300), createdAtISO: nowISO() });
}

export async function createPortable(ctx: PortableMutationCtx, args: { societyId: string } & AgreementInput & { sourceExternalIds?: string[]; importedFrom?: string }) {
  await requireSocietyMembership(ctx, args.societyId);
  const at = nowISO();
  const fields = normalizeNested(pickEditable(args), `${args.societyId}|${args.title ?? ""}|${at}`);
  assertAgreementValid(validateAgreementInput({ ...fields, parties: fields.parties ?? [] }));
  await assertReferences(ctx, args.societyId, fields);
  const id = await ctx.db.insert("agreements", compact({
    ...fields,
    societyId: args.societyId,
    title: fields.title,
    kind: fields.kind ?? "other",
    status: fields.status ?? "draft",
    currency: fields.currency ?? (fields.valueCents !== undefined ? "CAD" : undefined),
    sourceExternalIds: Array.isArray(args.sourceExternalIds) ? args.sourceExternalIds.map(String).slice(0, 50) : undefined,
    importedFrom: clean(args.importedFrom, 120),
    createdAtISO: at,
    updatedAtISO: at,
  }));
  const row = await ctx.db.get<Row>(id, "agreements");
  await syncAgreementDeadlines(ctx, row!);
  await logActivity(ctx, args.societyId, String(id), "created", `Created agreement "${fields.title}"`);
  return id;
}

export async function updatePortable(ctx: PortableMutationCtx, { id, patch, clear }: { id: string; patch: AgreementInput; clear?: string[] }) {
  const existing = await ownedAgreement(ctx, id);
  const fields = normalizeNested(pickEditable(patch ?? {}), `${existing._id}`);
  if (typeof fields.societyId !== "undefined") throw new Error("Workspace reassignment is not permitted.");
  const cleared = (clear ?? []).filter((key) => (EDITABLE_FIELDS as readonly string[]).includes(key) && key !== "title");
  // A person editing the parties must leave at least one counterparty; other edits of an imported draft without parties stay possible.
  assertAgreementValid(validateAgreementInput(fields, { partial: true, existing: existing as AgreementLike }));
  await assertReferences(ctx, existing.societyId, fields);
  const next: Record<string, any> = { ...fields, updatedAtISO: nowISO() };
  for (const key of cleared) next[key] = undefined;
  if (fields.status && fields.status !== "terminated" && existing.status === "terminated") {
    next.terminatedAtISO = undefined;
    next.terminationReason = undefined;
  }
  await ctx.db.patch(existing._id, next);
  const row = await ctx.db.get<Row>(existing._id, "agreements");
  const sync = await syncAgreementDeadlines(ctx, row!);
  return { ok: true, deadlines: sync };
}

export async function terminatePortable(ctx: PortableMutationCtx, { id, terminatedAtISO, reason }: { id: string; terminatedAtISO: string; reason: string }) {
  const existing = await ownedAgreement(ctx, id);
  if (!isIsoDay(terminatedAtISO)) throw new Error("Agreement: give the termination date (YYYY-MM-DD).");
  if (!clean(reason)) throw new Error("Agreement: give the reason for termination.");
  if (existing.status === "active" && isIsoDay(existing.effectiveDate) && terminatedAtISO < existing.effectiveDate) throw new Error("Agreement: the termination date is before the agreement took effect.");
  await ctx.db.patch(existing._id, {
    status: "terminated",
    terminatedAtISO,
    terminationReason: clean(reason, 1000),
    renewalDecision: compact({ decision: "terminate", decidedAtISO: terminatedAtISO, notes: clean(reason, 1000), motionId: existing.renewalDecision?.motionId }),
    updatedAtISO: nowISO(),
  });
  const row = await ctx.db.get<Row>(existing._id, "agreements");
  const sync = await syncAgreementDeadlines(ctx, row!);
  await logActivity(ctx, existing.societyId, existing._id, "terminated", `Terminated agreement "${existing.title}" on ${terminatedAtISO}`);
  return { ok: true, deadlines: sync };
}

/**
 * Renew (same agreement, a new term: the old one runs to its end) or
 * supersede (a replacement that takes over now: the old one becomes
 * superseded). Both create a linked new version that starts as a draft,
 * carrying the parties, kind, value and open obligations forward.
 */
export async function renewPortable(
  ctx: PortableMutationCtx,
  args: { id: string; mode: "renew" | "supersede"; title?: string; effectiveDate?: string; endDate?: string; valueCents?: number; status?: string; carryObligations?: boolean; notes?: string },
) {
  const existing = await ownedAgreement(ctx, args.id);
  if (args.mode !== "renew" && args.mode !== "supersede") throw new Error("Agreement: choose renew or supersede.");
  if (existing.supersededById) throw new Error("Agreement: this version has already been superseded; renew the latest version.");
  if (args.mode === "renew") {
    const renewals = await ctx.db.query<Row>("agreements").withIndex("by_renewal_of", (q) => q.eq("renewalOfId", existing._id)).collect();
    if (renewals.length) throw new Error("Agreement: a renewal of this version already exists.");
  }
  const at = nowISO();
  const effectiveDate = args.effectiveDate ?? (args.mode === "renew" && isIsoDay(existing.endDate) ? existing.endDate : undefined);
  const carry = args.carryObligations !== false;
  const openOnly = (rows: any[] | undefined) => (rows ?? []).filter((row) => !["submitted", "accepted", "waived"].includes(String(row.status))).map((row) => ({ ...row, id: obligationRowId(row.id.split("-")[0] || "item", 0, `${row.id}|${at}`) }));
  const fields = normalizeNested({
    title: args.title ?? existing.title,
    kind: existing.kind,
    status: args.status ?? "draft",
    agreementNumber: existing.agreementNumber,
    summary: existing.summary,
    parties: existing.parties ?? [],
    counterpartySignatories: undefined,
    effectiveDate,
    endDate: args.endDate,
    autoRenew: existing.autoRenew,
    renewalTermMonths: existing.renewalTermMonths,
    renewalNoticeDays: existing.renewalNoticeDays,
    terminationNoticeDays: existing.terminationNoticeDays,
    terminationTerms: existing.terminationTerms,
    valueCents: args.valueCents ?? existing.valueCents,
    currency: existing.currency,
    paymentTerms: existing.paymentTerms,
    deliverables: carry ? openOnly(existing.deliverables) : [],
    reportingObligations: carry ? openOnly(existing.reportingObligations) : [],
    confidential: existing.confidential,
    governingLaw: existing.governingLaw,
    linkedGrantId: existing.linkedGrantId,
    linkedServiceProviderId: existing.linkedServiceProviderId,
    linkedCommitteeId: existing.linkedCommitteeId,
    notes: clean(args.notes, 2000),
  }, `${existing._id}|${at}`);
  assertAgreementValid(validateAgreementInput(fields, { requireCounterparty: false }));
  const newId = await ctx.db.insert("agreements", compact({
    ...fields,
    societyId: existing.societyId,
    ...(args.mode === "renew" ? { renewalOfId: existing._id } : { supersedesId: existing._id }),
    reviewStatus: existing.reviewStatus === "NeedsReview" ? "NeedsReview" : undefined,
    createdAtISO: at,
    updatedAtISO: at,
  }));
  if (args.mode === "renew") {
    await ctx.db.patch(existing._id, { renewalDecision: { decision: "renew", decidedAtISO: at.slice(0, 10) }, updatedAtISO: at });
  } else {
    await ctx.db.patch(existing._id, { status: "superseded", supersededById: newId, renewalDecision: { decision: "renegotiate", decidedAtISO: at.slice(0, 10) }, updatedAtISO: at });
  }
  await syncAgreementDeadlines(ctx, (await ctx.db.get<Row>(existing._id, "agreements"))!);
  await syncAgreementDeadlines(ctx, (await ctx.db.get<Row>(newId, "agreements"))!);
  await logActivity(ctx, existing.societyId, String(newId), args.mode === "renew" ? "renewed" : "superseded", `${args.mode === "renew" ? "Renewed" : "Replaced"} agreement "${existing.title}"`);
  return newId;
}

export async function setRenewalDecisionPortable(ctx: PortableMutationCtx, { id, decision, notes, motionId, decidedAtISO }: { id: string; decision: string; notes?: string; motionId?: string; decidedAtISO?: string }) {
  const existing = await ownedAgreement(ctx, id);
  if (!(RENEWAL_DECISIONS as readonly string[]).includes(decision)) throw new Error("Agreement: choose a renewal decision.");
  if (decidedAtISO && !isIsoDay(decidedAtISO)) throw new Error("Agreement: use a date (YYYY-MM-DD) for the decision.");
  if (motionId) await getOwned(ctx, "motions", motionId, existing.societyId);
  await ctx.db.patch(existing._id, { renewalDecision: compact({ decision, decidedAtISO: decidedAtISO ?? today(), notes: clean(notes, 1000), motionId }), updatedAtISO: nowISO() });
  const sync = await syncAgreementDeadlines(ctx, (await ctx.db.get<Row>(existing._id, "agreements"))!);
  return { ok: true, deadlines: sync };
}

export async function setObligationStatusPortable(
  ctx: PortableMutationCtx,
  { id, list, rowKey, status, dateISO }: { id: string; list: "deliverables" | "reportingObligations"; rowKey: string; status: string; dateISO?: string },
) {
  const existing = await ownedAgreement(ctx, id);
  if (list !== "deliverables" && list !== "reportingObligations") throw new Error("Agreement: unknown obligation list.");
  if (!(DELIVERABLE_STATUSES as readonly string[]).includes(status)) throw new Error("Agreement: choose a status from the list.");
  if (dateISO && !isIsoDay(dateISO)) throw new Error("Agreement: use a date (YYYY-MM-DD).");
  const rows: any[] = Array.isArray(existing[list]) ? existing[list] : [];
  if (!rows.some((row) => row.id === rowKey)) throw new Error("Agreement: that obligation is not on this agreement.");
  const doneKey = list === "deliverables" ? "completedAtISO" : "submittedAtISO";
  const done = ["submitted", "accepted", "waived"].includes(status);
  await ctx.db.patch(existing._id, {
    [list]: rows.map((row) => (row.id === rowKey ? compact({ ...row, status, [doneKey]: done ? dateISO ?? row[doneKey] ?? today() : undefined }) : row)),
    updatedAtISO: nowISO(),
  });
  const sync = await syncAgreementDeadlines(ctx, (await ctx.db.get<Row>(existing._id, "agreements"))!);
  return { ok: true, deadlines: sync };
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const existing = await ownedAgreement(ctx, id);
  const deadlines = await ctx.db.query<Row>("deadlines").withIndex("by_agreement", (q) => q.eq("agreementId", existing._id)).collect();
  let removedDeadlines = 0;
  for (const row of deadlines) {
    const open = (row.status ?? (row.done ? "complete" : "open")) === "open";
    if (open && row.sourceKey) { await ctx.db.delete(row._id); removedDeadlines += 1; }
    else await ctx.db.patch(row._id, { agreementId: undefined, sourceKey: undefined });
  }
  // Keep the chain consistent: successors lose the link, a superseded predecessor becomes current again.
  const renewals = await ctx.db.query<Row>("agreements").withIndex("by_renewal_of", (q) => q.eq("renewalOfId", existing._id)).collect();
  for (const row of renewals) await ctx.db.patch(row._id, { renewalOfId: undefined });
  if (existing.supersededById) {
    const successor = await ctx.db.get<Row>(existing.supersededById, "agreements");
    if (successor && successor.societyId === existing.societyId) await ctx.db.patch(successor._id, { supersedesId: undefined });
  }
  const previousId = existing.supersedesId ?? existing.renewalOfId;
  if (previousId) {
    const previous = await ctx.db.get<Row>(previousId, "agreements");
    if (previous && previous.societyId === existing.societyId) {
      const restore: Record<string, any> = { renewalDecision: undefined, updatedAtISO: nowISO() };
      if (String(previous.supersededById ?? "") === String(existing._id)) { restore.supersededById = undefined; if (previous.status === "superseded") restore.status = "unknown"; }
      await ctx.db.patch(previous._id, restore);
      await syncAgreementDeadlines(ctx, (await ctx.db.get<Row>(previous._id, "agreements"))!);
    }
  }
  // Gaps this agreement resolved go back to open so nothing silently disappears.
  for (const gapId of existing.representationGapIds ?? []) {
    const gap = await ctx.db.get<Row>(gapId, "representationGaps");
    if (gap && gap.societyId === existing.societyId && gap.status === "resolved_native") {
      await ctx.db.patch(gap._id, { status: "open", resolvedTable: undefined, resolvedId: undefined, updatedAtISO: nowISO(), reviewHistory: [...(gap.reviewHistory ?? []), { atISO: nowISO(), fromStatus: "resolved_native", toStatus: "open", note: `Agreement "${existing.title}" was deleted.` }].slice(-50) });
    }
  }
  await ctx.db.delete(existing._id);
  await logActivity(ctx, existing.societyId, existing._id, "deleted", `Deleted agreement "${existing.title}"`);
  return { ok: true, removedDeadlines };
}

/** Re-derive the deadlines of every agreement (after a date passes or rules change). */
export async function syncObligationsPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db.query<Row>("agreements").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const totals = { agreements: rows.length, created: 0, updated: 0, removed: 0, completed: 0 };
  for (const row of rows) {
    const result = await syncAgreementDeadlines(ctx, row);
    totals.created += result.created; totals.updated += result.updated; totals.removed += result.removed; totals.completed += result.completed;
  }
  return totals;
}

/* ------------------------------ gap conversion ------------------------------ */

const AGREEMENT_GAP_TYPES = new Set(["agreement", "agreement.contract"]);
const OPEN_GAP_STATUSES = new Set(["open", "kept_as_text", "schema_change_requested"]);

type ConversionCandidate =
  | { source: "gap"; gap: Row; extraction?: Row }
  | { source: "extraction"; extraction: Row };

async function conversionCandidates(ctx: PortableQueryCtx, societyId: string) {
  const [gaps, existing, extractions] = await Promise.all([
    (await canRead(ctx, societyId, "documents:read")) ? ctx.db.query<Row>("representationGaps").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect() : Promise.resolve([] as Row[]),
    ctx.db.query<Row>("agreements").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    (await canRead(ctx, societyId, "settings:read")) ? intakeAgreementExtractions(ctx, societyId) : Promise.resolve([] as Row[]),
  ]);
  const covered = new Set<string>();
  for (const row of existing) {
    for (const key of row.sourceExternalIds ?? []) covered.add(`ext:${String(key).toLowerCase()}`);
    for (const key of row.representationGapIds ?? []) covered.add(`gap:${key}`);
    if (row.intakeExtractionId) covered.add(`extraction:${row.intakeExtractionId}`);
  }
  const extractionByFile = new Map(extractions.map((row) => [String(row.fileKey).toLowerCase(), row]));
  const candidates: ConversionCandidate[] = [];
  const alreadyLinked: Row[] = [];
  const claimed = new Set<string>();
  for (const gap of gaps) {
    if (!AGREEMENT_GAP_TYPES.has(String(gap.infoType)) || !OPEN_GAP_STATUSES.has(String(gap.status))) continue;
    const ext = clean(gap.sourceExternalId, 600)?.toLowerCase();
    if (covered.has(`gap:${gap._id}`) || (ext && covered.has(`ext:${ext}`))) { alreadyLinked.push(gap); continue; }
    const extraction = ext ? extractionByFile.get(ext) : undefined;
    if (extraction) claimed.add(String(extraction._id));
    if (ext) {
      if (claimed.has(`ext:${ext}`)) { alreadyLinked.push(gap); continue; } // a second gap from the same source joins the first
      claimed.add(`ext:${ext}`);
    }
    candidates.push({ source: "gap", gap, extraction });
  }
  for (const extraction of extractions) {
    if (claimed.has(String(extraction._id)) || covered.has(`extraction:${extraction._id}`) || covered.has(`ext:${String(extraction.fileKey).toLowerCase()}`)) continue;
    candidates.push({ source: "extraction", extraction });
  }
  return { candidates, alreadyLinked, existing };
}

/** Intake extractions of agreements still waiting for review whose agreement was carried as a system gap. */
async function intakeAgreementExtractions(ctx: PortableQueryCtx, societyId: string): Promise<Row[]> {
  const runs = await ctx.db.query<Row>("intakeRuns").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const out: Row[] = [];
  for (const run of runs) {
    const rows = await ctx.db.query<Row>("intakeExtractions").withIndex("by_run", (q) => q.eq("runId", run._id)).collect();
    for (const row of rows) {
      if (row.societyId !== societyId || row.parentFileKey) continue;
      // Agreements, plus signed funding agreements classified as grant documents (their grant is linked by source).
      const fundingAgreement = row.docClass === "grant" && (row.record?.grantStage?.value === "agreement" || ["agreement", "contract", "mou"].includes(String(row.record?.kind?.value)));
      if (row.docClass !== "agreement" && !fundingAgreement) continue;
      if (row.status === "rejected" || row.status === "covered") continue;
      if (row.status === "promoted" && !(row.unsupported ?? []).some((detail: any) => AGREEMENT_GAP_TYPES.has(String(detail?.infoType)))) continue;
      out.push({ ...row, runName: run.name });
    }
  }
  return out;
}

export async function conversionPreviewPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const { candidates, alreadyLinked, existing } = await conversionCandidates(ctx, societyId);
  return {
    gaps: candidates.filter((item) => item.source === "gap").length,
    extractions: candidates.filter((item) => item.source === "extraction").length,
    total: candidates.length,
    alreadyLinked: alreadyLinked.length,
    existingAgreements: existing.length,
    examples: candidates.slice(0, 8).map((item) => item.source === "gap" ? String(item.gap.sourceTitle ?? item.gap.title ?? "Agreement") : String(item.extraction.record?.title?.value ?? item.extraction.fileKey)),
  };
}

/** Same-workspace documents for an external id (source id tag, sourceExternalIds or the import content's externalId). */
function documentResolver(ctx: PortableQueryCtx, societyId: string) {
  let index: Map<string, string> | null = null;
  return async (externalId: unknown): Promise<string | undefined> => {
    const key = clean(externalId, 600)?.toLowerCase();
    if (!key) return undefined;
    if (!index) {
      const built = new Map<string, string>();
      const docs = await ctx.db.query<Row>("documents").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
      for (const doc of docs) {
        if (doc.importRecordKind || (doc.tags ?? []).includes("import-session-record")) continue;
        const ids: unknown[] = [...(doc.sourceExternalIds ?? []), ...(doc.tags ?? [])];
        if (typeof doc.content === "string" && doc.content.includes("externalId")) {
          try {
            const content = JSON.parse(doc.content);
            ids.push(content?.externalId, ...(Array.isArray(content?.sourceExternalIds) ? content.sourceExternalIds : []));
          } catch { /* not JSON */ }
        }
        for (const id of ids) {
          const idKey = typeof id === "string" ? id.trim().toLowerCase() : "";
          if (idKey.includes(":") && !built.has(idKey)) built.set(idKey, String(doc._id));
        }
      }
      index = built;
    }
    return index.get(key);
  };
}

const PROVENANCE_FIELDS: Array<[string, string]> = [
  ["title", "title"], ["kind", "kind"], ["parties", "parties"], ["effective", "effectiveDate"], ["expiry", "endDate"], ["amount", "valueCents"],
  ["agreementNumber", "agreementNumber"], ["status", "status"], ["purpose", "summary"], ["funder", "parties"],
];

function firstLocator(field: any, fileKey: string) {
  const locator = Array.isArray(field?.locators) ? field.locators[0] : undefined;
  return compact({ fileId: fileKey.slice(0, 600), kind: String(locator?.kind ?? "file"), blockIndex: typeof locator?.blockIndex === "number" ? locator.blockIndex : undefined, page: typeof locator?.page === "number" ? locator.page : undefined, sheet: clean(locator?.sheet, 200), cell: clean(locator?.cell, 40), charStart: typeof locator?.charStart === "number" ? locator.charStart : undefined, charEnd: typeof locator?.charEnd === "number" ? locator.charEnd : undefined, quote: clean(locator?.quote, 400) });
}

/**
 * "Convert agreement gaps to agreements": every open `agreement` /
 * `agreement.contract` representation gap (from earlier imports or intake)
 * and every unreviewed intake extraction of an agreement becomes a draft
 * agreement for review (status draft, review NeedsReview), linked to its
 * source documents, with "View source" provenance for the extracted values.
 * The gaps become `resolved_native`. Funding agreements are linked to the
 * grant built from the same source. Idempotent and batched (`limit`).
 */
export async function convertGapsPortable(ctx: PortableMutationCtx, { societyId, dryRun, limit }: { societyId: string; dryRun?: boolean; limit?: number }) {
  await requireSocietyMembership(ctx, societyId);
  await requirePermissionPortable(ctx, societyId, "documents:write");
  const { candidates, alreadyLinked } = await conversionCandidates(ctx, societyId);
  const batch = candidates.slice(0, Math.max(1, Math.min(Number(limit ?? 200) || 200, 500)));
  if (dryRun) return { dryRun: true, total: candidates.length, wouldConvert: batch.length, alreadyLinked: alreadyLinked.length };
  const asOf = today();
  const at = nowISO();
  const society = await ctx.db.get<Row>(societyId, "societies");
  const resolveDocument = documentResolver(ctx, societyId);
  const grants = (await canRead(ctx, societyId, "grants:read")) ? await ctx.db.query<Row>("grants").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect() : [];
  const grantBySource = new Map<string, Row>();
  for (const grant of grants) for (const key of grant.sourceExternalIds ?? []) grantBySource.set(String(key).toLowerCase(), grant);
  const grantByDocument = new Map<string, Row>();
  for (const grant of grants) for (const key of grant.sourceDocumentIds ?? []) grantByDocument.set(String(key), grant);
  let created = 0, resolvedGaps = 0, provenance = 0, linkedDocuments = 0, linkedGrants = 0, deadlines = 0;
  const createdIds: string[] = [];
  for (const candidate of batch) {
    const extraction = candidate.extraction;
    const gap = candidate.source === "gap" ? candidate.gap : undefined;
    const fileKey = String(extraction?.fileKey ?? gap?.sourceExternalId ?? "");
    let file: Row | null = null;
    if (extraction) file = await ctx.db.query<Row>("intakeFiles").withIndex("by_run_file_key", (q) => q.eq("runId", extraction.runId).eq("fileKey", extraction.fileKey)).first();
    const payload: Record<string, any> = extraction
      ? agreementPayloadFromExtraction(extraction.record ?? {}, { fileKey, fileName: file?.name, organizationName: society?.name, asOfISO: asOf })
      : gapPayload(gap!, society?.name);
    const sourceDocumentIds = new Set<string>();
    if (gap?.sourceDocumentId) sourceDocumentIds.add(String(gap.sourceDocumentId));
    if (file?.documentId) sourceDocumentIds.add(String(file.documentId));
    const resolved = fileKey ? await resolveDocument(fileKey) : undefined;
    if (resolved) sourceDocumentIds.add(resolved);
    const ownedDocs: string[] = [];
    for (const documentId of sourceDocumentIds) {
      const doc = await ctx.db.get<Row>(documentId, "documents");
      if (doc && doc.societyId === societyId) ownedDocs.push(documentId);
    }
    linkedDocuments += ownedDocs.length;
    const grant = (fileKey && grantBySource.get(fileKey.toLowerCase())) || ownedDocs.map((id) => grantByDocument.get(id)).find(Boolean);
    if (grant) linkedGrants += 1;
    const fields = normalizeNested(payload, fileKey || String(gap?._id));
    const id = await ctx.db.insert("agreements", compact({
      ...fields,
      societyId,
      kind: grant && fields.kind === "other" ? "funding" : fields.kind,
      sourceExternalIds: fileKey ? [fileKey] : undefined,
      sourceDocumentIds: ownedDocs.length ? ownedDocs : undefined,
      signedDocumentId: ownedDocs.length && payload.status !== "draft" ? ownedDocs[0] : undefined,
      intakeRunId: extraction?.runId,
      intakeExtractionId: extraction?._id,
      representationGapIds: gap ? [gap._id] : undefined,
      linkedGrantId: grant?._id,
      importedFrom: gap ? "Converted from a system gap" : `Converted from intake run "${String(extraction?.runName ?? "intake")}"`,
      createdAtISO: at,
      updatedAtISO: at,
    }));
    created += 1;
    createdIds.push(String(id));
    const row = await ctx.db.get<Row>(id, "agreements");
    deadlines += (await syncAgreementDeadlines(ctx, row!, asOf)).created;
    if (extraction) {
      for (const [sourceField, targetField] of PROVENANCE_FIELDS) {
        const field = extraction.record?.[sourceField];
        const fieldsToWrite = Array.isArray(field) ? field.map((item: any, index: number) => [item, `${sourceField}[${index}]`] as const) : [[field, sourceField] as const];
        for (const [item, path] of fieldsToWrite) {
          if (!item || item.status === "not_stated" || item.value === undefined) continue;
          await ctx.db.insert("fieldProvenance", compact({ societyId, targetTable: "agreements", targetId: String(id), fieldPath: targetField, sourceFieldPath: path, runId: extraction.runId, extractionId: extraction._id, fileKey: extraction.fileKey, locator: firstLocator(item, fileKey), value: item.value, decision: "unreviewed", createdAtISO: at }));
          provenance += 1;
        }
      }
    }
    // Every gap this source produced is now held natively.
    const gapsForSource = gap ? [gap] : [];
    if (extraction) {
      const more = await ctx.db.query<Row>("representationGaps").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
      for (const other of more) if (AGREEMENT_GAP_TYPES.has(String(other.infoType)) && OPEN_GAP_STATUSES.has(String(other.status)) && String(other.sourceExternalId ?? "").toLowerCase() === fileKey.toLowerCase()) gapsForSource.push(other);
    }
    for (const other of alreadyLinked.filter((row) => fileKey && String(row.sourceExternalId ?? "").toLowerCase() === fileKey.toLowerCase())) if (!gapsForSource.some((row) => row._id === other._id)) gapsForSource.push(other);
    for (const target of gapsForSource) {
      const fresh = await ctx.db.get<Row>(target._id, "representationGaps");
      if (!fresh || !OPEN_GAP_STATUSES.has(String(fresh.status))) continue;
      await ctx.db.patch(fresh._id, {
        status: "resolved_native", resolvedTable: "agreements", resolvedId: String(id), affectedTable: "agreements", affectedId: String(id), updatedAtISO: at,
        reviewHistory: [...(fresh.reviewHistory ?? []), { atISO: at, fromStatus: fresh.status, toStatus: "resolved_native", note: "Converted to a draft agreement for review." }].slice(-50),
      });
      resolvedGaps += 1;
    }
    if (gapsForSource.length > 1 || (gap && extraction)) await ctx.db.patch(id, { representationGapIds: [...new Set(gapsForSource.map((row) => row._id))] });
  }
  return { dryRun: false, total: candidates.length, created, resolvedGaps, provenance, linkedDocuments, linkedGrants, deadlines, remaining: Math.max(0, candidates.length - batch.length), createdIds: createdIds.slice(0, 50) };
}

/** A draft from a gap with no extraction behind it: title and kind from the source title, the excerpt as notes. */
function gapPayload(gap: Row, organizationName: string | undefined): Record<string, any> {
  const rawTitle = clean(gap.sourceTitle, 300) ?? clean(gap.title, 300) ?? "Agreement";
  const title = rawTitle.replace(/\.(?:pdf|docx?|xlsx?|msg|eml|rtf|txt|odt)$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || "Agreement";
  const kind = inferAgreementKind(undefined, `${title} ${gap.excerpt ?? ""}`);
  void organizationName;
  return {
    title,
    kind: (AGREEMENT_KINDS as readonly string[]).includes(kind) ? kind : "other",
    status: "draft",
    parties: [],
    confidence: "Review",
    reviewStatus: "NeedsReview",
    notes: [
      "Draft created from a system gap; open the source and fill in the parties, term and value.",
      gap.observedDate ? `Date seen in the source: ${gap.observedDate}.` : "",
      gap.excerpt ? `Source excerpt: ${String(gap.excerpt).slice(0, 600)}` : "",
    ].filter(Boolean).join("\n"),
  };
}
