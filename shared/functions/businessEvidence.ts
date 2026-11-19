import { businessRegisters, registerPermission, type EvidenceField, type EvidenceRegister } from "../businessEvidence";
import { evidenceRules } from "../businessEvidenceRules";
import { isCalendarDate } from "../invoicing";
import type { PortableMutationCtx, PortableQueryCtx, PortableDoc } from "../portable/ctx";
import { getOwned } from "./access";
import { documentAccessPredicate } from "./documents";
import { requirePermissionPortable, type Permission } from "./permissions";

interface Scope { societyId: string; register: string }
type Fields = Record<string, string | number>;

const referencePermissions: Record<string, Permission> = {
  directors: "directors:read", rightsholdingTransfers: "documents:read", rightsClasses: "documents:read",
  organizationAddresses: "society:read", agreements: "agreements:read", corporateCards: "financials:read",
  financialAccounts: "financials:read", writtenResolutions: "motions:read",
  organizationIdentifiers: "settings:read", organizationRegistrations: "society:read",
};

async function authorize(ctx: PortableQueryCtx, args: Scope, mode: "read" | "write") {
  const register = businessRegisters.find(item => item.table === args.register);
  if (!register) throw new Error("Unknown register.");
  const user = await requirePermissionPortable(ctx, args.societyId, registerPermission(register, mode));
  const org = await ctx.db.get(args.societyId, "societies");
  if (!org || !evidenceRules(org, register).available) throw new Error("Unavailable for this organization.");
  return { register, user };
}

function referenceLabel(table: string, row: PortableDoc) {
  switch (table) {
    case "directors": return [row.firstName, row.lastName].join(" ");
    case "rightsholdingTransfers": return [row.transferDate, row.destinationHolderName, row.quantity, row.transferType].filter(x => x != null).join(" · ");
    case "organizationAddresses": return [row.type, row.street, row.city].filter(Boolean).join(" · ");
    case "organizationIdentifiers": return [row.kind, row.number?.slice(-4)].filter(Boolean).join(" · ");
    case "organizationRegistrations": return [row.jurisdiction, row.registrationNumber].filter(Boolean).join(" · ");
    case "corporateCards": return [row.issuer, row.last4].join(" · ");
    default: return String(row.title || row.name || row.className || row._id);
  }
}

function usableReference(register: string, table: string, row: PortableDoc) {
  if (table !== "rightsholdingTransfers") return true;
  return row.status === "posted" && (row.transferType === "issuance" || (register === "shareNotices" && row.transferType === "transfer"));
}

export async function list(ctx: PortableQueryCtx, args: Scope) {
  const { register } = await authorize(ctx, args, "read");
  const rows = await ctx.db.query(register.table).withIndex("by_society", q => q.eq("societyId", args.societyId)).collect();
  const superseded = new Set(rows.map(row => row.previousId).filter(Boolean));
  let opens: ((doc: PortableDoc) => boolean) | undefined;
  if (rows.some(row => row.documentId)) {
    try {
      await requirePermissionPortable(ctx, args.societyId, "documents:read");
      opens = await documentAccessPredicate(ctx, args.societyId);
    } catch { /* Linked rows are hidden when document access is unavailable. */ }
  }
  const visible = await Promise.all(rows.map(async row => {
    if (row.documentId) {
      if (!opens) return null;
      const doc = await ctx.db.get(row.documentId, "documents");
      // A deleted supporting document leaves the record listed, so it can be
      // revised to cite another document or none. Unreadable documents stay hidden.
      if (!doc) return { ...row, historical: superseded.has(row._id), documentMissing: true };
      if (!opens(doc)) return null;
    }
    return { ...row, historical: superseded.has(row._id) };
  }));
  return visible.filter(row => row !== null).reverse();
}

export async function choices(ctx: PortableQueryCtx, args: Scope) {
  const { register } = await authorize(ctx, args, "read");
  const result: Record<string, { id: string; label: string }[]> = {};
  for (const table of new Set(register.fields.map(field => field.table).filter((x): x is string => !!x))) {
    try { await requirePermissionPortable(ctx, args.societyId, referencePermissions[table]); }
    catch { result[table] = []; continue; }
    const rows = await ctx.db.query(table).withIndex("by_society", q => q.eq("societyId", args.societyId)).collect();
    result[table] = rows.filter(row => usableReference(register.table, table, row)).map(row => ({ id: row._id, label: referenceLabel(table, row) }));
  }
  return result;
}

function validatedValue(field: EvidenceField, raw: unknown): string | number {
  const invalid = () => new Error("Check the value for " + field.label + ".");
  if (field.type === "count" || field.type === "money") {
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < (field.type === "money" ? 0 : 1)) throw invalid();
    return raw; // Money is stored in minor units.
  }
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2000) throw invalid();
  const value = raw.trim();
  if (field.options && !field.options.includes(value)) throw invalid();
  if (field.type === "date" && !isCalendarDate(value)) throw invalid();
  if (field.type === "datetime-local" && (!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || !isCalendarDate(value.slice(0, 10)))) throw invalid();
  if (field.type === "currency" && !/^[A-Z]{3}$/.test(value)) throw invalid();
  if (field.type === "last4" && !/^\d{4}$/.test(value)) throw invalid();
  if (field.type === "zone") {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); } catch { throw invalid(); }
  }
  return value;
}

async function noticeParticulars(ctx: PortableQueryCtx, societyId: string, transactionId: string) {
  const transaction = await getOwned(ctx, "rightsholdingTransfers", transactionId, societyId);
  const org = await ctx.db.get(societyId, "societies");
  const shareClass = transaction.rightsClassId && await getOwned(ctx, "rightsClasses", transaction.rightsClassId, societyId);
  const holder = transaction.destinationRoleHolderId && await getOwned(ctx, "roleHolders", transaction.destinationRoleHolderId, societyId);
  return Object.fromEntries(Object.entries({
    company: org?.name, holder: transaction.destinationHolderName || holder?.fullName,
    shareClass: shareClass?.className, quantity: transaction.quantity, issueOrTransferDate: transaction.transferDate,
    parValueCents: shareClass?.parValueCents, transactionType: transaction.transferType,
  }).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

async function validateFields(ctx: PortableQueryCtx, societyId: string, register: EvidenceRegister, values: Fields) {
  const clean: Fields = {};
  if (Object.keys(values).some(key => !register.fields.some(f => f.key === key))) throw new Error("Unexpected field.");
  for (const field of register.fields) {
    const raw = values[field.key];
    if (raw == null || raw === "") {
      if (field.required) throw new Error(field.label + " is required.");
      continue;
    }
    const value = validatedValue(field, raw);
    if (field.table) {
      await requirePermissionPortable(ctx, societyId, referencePermissions[field.table]);
      const row = await getOwned(ctx, field.table, String(value), societyId);
      if (!usableReference(register.table, field.table, row)) throw new Error("Choose a posted issuance or transfer.");
      if (field.table === "rightsholdingTransfers" && register.table === "equitySubscriptions" && row.rightsClassId !== values.classId) throw new Error("The issuance must match the subscribed share class.");
    }
    clean[field.key] = value;
  }
  for (const [start, end] of [["noticeDate", "sentOn"], ["validFrom", "validTo"], ["periodStart", "periodEnd"], ["subscribedOn", "acceptedOn"]]) {
    if (clean[start] && clean[end] && clean[start] > clean[end]) throw new Error("Check the order of the dates.");
  }
  if (register.fields.some(field => field.type === "money" && clean[field.key] !== undefined) && !clean.currency) throw new Error("Choose the currency for the amount.");
  return clean;
}

export async function save(ctx: PortableMutationCtx, args: Scope & {
  values: Fields; documentId?: string; sourcePage?: number; previousId?: string;
}) {
  const { register, user } = await authorize(ctx, args, "write");
  const values = await validateFields(ctx, args.societyId, register, args.values);
  if (args.sourcePage !== undefined && (!args.documentId || !Number.isSafeInteger(args.sourcePage) || args.sourcePage < 1)) throw new Error("Choose a document and a positive page number.");
  async function checkDocument(id: string) {
    await requirePermissionPortable(ctx, args.societyId, "documents:read");
    const doc = await getOwned(ctx, "documents", id, args.societyId);
    if (!(await documentAccessPredicate(ctx, args.societyId))(doc)) throw new Error("Document unavailable.");
  }
  if (args.documentId) await checkDocument(args.documentId);
  let particulars;
  if (args.previousId) {
    const previous = await getOwned(ctx, register.table, args.previousId, args.societyId);
    if (register.table === "shareNotices") {
      if (previous.transactionId !== values.transactionId) throw new Error("A revised notice retains its ledger transaction.");
      particulars = previous.particulars;
    }
    if (register.table === "directorConsents" && previous.directorId !== values.directorId) throw new Error("A consent revision must refer to the same director.");
    // Revising needs access to the document the record cites, unless it was deleted.
    if (previous.documentId && await ctx.db.get(previous.documentId, "documents")) await checkDocument(previous.documentId);
    const newer = await ctx.db.query(register.table).withIndex("by_previous", q => q.eq("previousId", args.previousId)).first();
    if (newer) throw new Error("This record has a newer version. Open the latest entry.");
    if (register.table === "shareNotices" && previous.noticeNumber !== values.noticeNumber) throw new Error("A revised notice retains its number.");
  } else if (register.table === "shareNotices") {
    const existing = await ctx.db.query(register.table).withIndex("by_notice", q => q.eq("societyId", args.societyId).eq("noticeNumber", values.noticeNumber)).first();
    if (existing) throw new Error("This notice number already exists.");
    particulars = await noticeParticulars(ctx, args.societyId, String(values.transactionId));
  }
  return ctx.db.insert(register.table, {
    ...values, ...(particulars && { particulars }), societyId: args.societyId, recordedAt: new Date().toISOString(), recordedBy: user._id,
    ...(args.previousId && { previousId: args.previousId }), ...(args.documentId && { documentId: args.documentId }),
    ...(args.sourcePage && { sourcePage: args.sourcePage }),
  });
}
