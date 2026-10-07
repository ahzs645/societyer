// Agreements register (schema finding A5): the `agreements` import bundle key.
//
// Payload contract (every field optional except a title or a source):
//   { title, kind, status, agreementNumber, summary,
//     parties: [{ name, role, organizationName?, contact? }] | ["Name"], counterparty?, funder?,
//     ourSignatories / counterpartySignatories: [{ name, title? }] | ["Name"],
//     signedDate, effectiveDate, endDate, autoRenew, renewalTermMonths, renewalNoticeDays,
//     terminationNoticeDays, terminationTerms, valueCents, currency, paymentTerms,
//     paymentSchedule: [{ label, dueDate?, amountCents? }],
//     deliverables: [{ text, dueDate?, owner?, status? }] | ["text"],
//     reportingObligations: [{ text, dueDate?, recurrence?, recipient?, status? }] | ["text"],
//     confidential, governingLaw, grantTitle, serviceProviderName, committeeName,
//     approvedAtMeetingDate (+ approvedAtMeetingBody), approvalMotionText,
//     renewalOfExternalId | renewalOfTitle, supersedesExternalId | supersedesTitle,
//     signed (the first source document is the signed copy), sourceExternalIds,
//     confidence, reviewStatus, notes }
//
// References resolve by name/date inside the importing workspace only; payload
// ids are never trusted. A record whose source is already held by an agreement
// (same source external id) updates that agreement instead of duplicating it:
// an unreviewed draft takes the incoming values, a reviewed one only gains
// missing fields. Every write re-derives the agreement's deadlines.

import {
  AGREEMENT_KINDS,
  AGREEMENT_STATUSES,
  DELIVERABLE_STATUSES,
  REPORTING_RECURRENCES,
  inferAgreementKind,
  isIsoDay,
  obligationRowId,
  partyRoleFor,
  type AgreementKind,
} from "../../agreements";
import { syncAgreementDeadlines } from "../agreements";
import { arrayOf, cleanText, compactRecord, numberOrUndefined, optionalBoolean, unique } from "./importSessionUtils";
import { directoryPersonId, loadDirectoryIndex } from "./importMeetingApply";
import { resolveMeetingReference } from "./importSectionHandlersExtra";

type HandlerContext = {
  ctx: any;
  societyId: string;
  record: any;
  payload: any;
  sourceDocumentIds: any[];
  firstSourceDocumentId: any;
  sourceNote: any;
};

const KIND_ALIASES: Record<string, AgreementKind> = {
  mou: "MOU", "memorandum of understanding": "MOU", license: "licence", licence: "licence", contract: "service", services: "service",
  grant: "funding", "funding agreement": "funding", "contribution agreement": "funding", "data sharing": "data_sharing", "data-sharing": "data_sharing",
  consultant: "consulting", partnership: "partnership", lease: "lease", employment: "employment",
};

function kindFor(payload: any): AgreementKind {
  const raw = cleanText(payload.kind);
  if (raw && (AGREEMENT_KINDS as readonly string[]).includes(raw)) return raw as AgreementKind;
  const alias = raw ? KIND_ALIASES[raw.toLowerCase()] : undefined;
  if (alias) return alias;
  return inferAgreementKind(raw?.toLowerCase(), `${cleanText(payload.title) ?? ""}`);
}

function statusFor(payload: any): string {
  const raw = cleanText(payload.status)?.toLowerCase();
  if (raw && (AGREEMENT_STATUSES as readonly string[]).includes(raw)) return raw;
  if (raw === "signed" || raw === "in force" || raw === "current") return "active";
  if (raw === "draft" || raw === "proposed") return "draft";
  if (raw === "ended" || raw === "lapsed") return "expired";
  if (raw === "cancelled" || raw === "canceled") return "terminated";
  return "unknown";
}

const day = (value: unknown) => {
  const text = cleanText(value);
  return text && isIsoDay(text.slice(0, 10)) ? text.slice(0, 10) : undefined;
};

function textRows(value: unknown, prefix: string, salt: string, defaults: Record<string, any> = {}) {
  return arrayOf(value).map((row: any, index: number) => {
    const item = typeof row === "string" ? { text: row } : row ?? {};
    const status = cleanText(item.status);
    const recurrence = cleanText(item.recurrence)?.toLowerCase();
    return compactRecord({
      id: cleanText(item.id) || obligationRowId(prefix, index, `${salt}|${item.text ?? ""}`),
      text: (cleanText(item.text) || cleanText(item.label) || cleanText(item.title) || "").slice(0, 1000),
      dueDate: day(item.dueDate ?? item.due),
      owner: cleanText(item.owner),
      recipient: cleanText(item.recipient),
      recurrence: recurrence && (REPORTING_RECURRENCES as readonly string[]).includes(recurrence) ? recurrence : undefined,
      status: status && (DELIVERABLE_STATUSES as readonly string[]).includes(status) ? status : defaults.status,
      notes: cleanText(item.notes),
    });
  }).filter((row: any) => row?.text);
}

function signatories(value: unknown, directory: any) {
  return arrayOf(value).map((row: any) => {
    const item = typeof row === "string" ? { name: row } : row ?? {};
    const name = cleanText(item.name) || cleanText(item.nameAsWritten);
    if (!name) return undefined;
    return compactRecord({ name, title: cleanText(item.title) || cleanText(item.role), directoryPersonId: directoryPersonId(directory, name), signedAtISO: day(item.signedAtISO ?? item.signedAt) });
  }).filter(Boolean);
}

async function findByTitle(ctx: any, societyId: string, table: string, field: string, value: unknown) {
  const wanted = cleanText(value)?.toLowerCase();
  if (!wanted) return undefined;
  const rows = await ctx.db.query(table).withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
  const hits = rows.filter((row: any) => String(row[field] ?? "").trim().toLowerCase() === wanted);
  return hits.length === 1 ? hits[0] : undefined;
}

async function agreementBySource(ctx: any, societyId: string, externalIds: string[]) {
  const keys = new Set(externalIds.map((value) => value.toLowerCase()));
  if (!keys.size) return undefined;
  const rows = await ctx.db.query("agreements").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
  return rows.find((row: any) => arrayOf(row.sourceExternalIds).some((id: unknown) => keys.has(String(id).toLowerCase())));
}

/** Build the native fields for an imported agreement (no writes). */
async function agreementFields({ ctx, societyId, record, payload, sourceDocumentIds, firstSourceDocumentId }: HandlerContext) {
  const society = await ctx.db.get(societyId);
  const directory = await loadDirectoryIndex(ctx, societyId);
  const kind = kindFor(payload);
  const title = (cleanText(payload.title) || cleanText(payload.name) || record?.title || "Imported agreement").slice(0, 200);
  const sourceExternalIds = unique([...arrayOf(record?.sourceExternalIds), ...arrayOf(payload.sourceExternalIds)]);
  const parties: any[] = [];
  for (const row of arrayOf(payload.parties)) {
    const item = typeof row === "string" ? { name: row } : row ?? {};
    const name = cleanText(item.name);
    if (!name) continue;
    const role = cleanText(item.role);
    parties.push(compactRecord({ name, role: role && ["us", "counterparty", "funder", "guarantor", "other"].includes(role) ? role : partyRoleFor(name, society?.name, kind), organizationName: cleanText(item.organizationName), contact: cleanText(item.contact), notes: cleanText(item.notes) }));
  }
  for (const [key, role] of [["counterparty", "counterparty"], ["funder", "funder"]] as const) {
    for (const name of arrayOf(payload[key] ?? payload[`${key === "counterparty" ? "counterparties" : "funders"}`]).concat(typeof payload[key] === "string" ? [payload[key]] : [])) {
      const value = cleanText(name);
      if (value && !parties.some((party) => party.name.toLowerCase() === value.toLowerCase())) parties.push({ name: value, role });
    }
  }
  const effectiveDate = day(payload.effectiveDate ?? payload.startDate);
  let endDate = day(payload.endDate ?? payload.expiryDate);
  const notes: string[] = [];
  if (effectiveDate && endDate && endDate < effectiveDate) { notes.push(`Source end date ${endDate} is before the effective date; left blank for review.`); endDate = undefined; }
  let valueCents = numberOrUndefined(payload.valueCents ?? payload.amountCents);
  if (valueCents !== undefined && valueCents < 0) { notes.push("Source value was negative; left blank for review."); valueCents = undefined; }
  const salt = sourceExternalIds[0] ?? title;
  const grant = (await findByTitle(ctx, societyId, "grants", "title", payload.grantTitle ?? payload.grant)) ?? (await (async () => {
    // A grant built from the same source document (a funding agreement) is the linked grant.
    if (!sourceExternalIds.length) return undefined;
    const keys = new Set(sourceExternalIds.map((id) => id.toLowerCase()));
    const grants = await ctx.db.query("grants").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
    const hits = grants.filter((row: any) => arrayOf(row.sourceExternalIds).some((id: unknown) => keys.has(String(id).toLowerCase())));
    return hits.length === 1 ? hits[0] : undefined;
  })());
  const provider = await findByTitle(ctx, societyId, "serviceProviders", "firmName", payload.serviceProviderName ?? payload.serviceProvider);
  const committee = await findByTitle(ctx, societyId, "committees", "name", payload.committeeName ?? payload.committee);
  const meeting = payload.approvedAtMeetingDate ? await resolveMeetingReference(ctx, societyId, { meetingDate: payload.approvedAtMeetingDate, body: payload.approvedAtMeetingBody, meetingTitle: payload.approvedAtMeetingTitle }) : null;
  let approvalMotionId: any;
  if (meeting && cleanText(payload.approvalMotionText)) {
    const wanted = String(payload.approvalMotionText).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
    const motions = await ctx.db.query("motions").withIndex("by_meeting", (q: any) => q.eq("primaryMeetingId", meeting.meetingId)).collect();
    const hits = motions.filter((row: any) => String(row.text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().startsWith(wanted));
    if (hits.length === 1) approvalMotionId = hits[0]._id;
  }
  const previous = cleanText(payload.renewalOfExternalId) ? await agreementBySource(ctx, societyId, [String(payload.renewalOfExternalId)]) : await findByTitle(ctx, societyId, "agreements", "title", payload.renewalOfTitle);
  const replaced = cleanText(payload.supersedesExternalId) ? await agreementBySource(ctx, societyId, [String(payload.supersedesExternalId)]) : await findByTitle(ctx, societyId, "agreements", "title", payload.supersedesTitle);
  for (const [label, wanted, found] of [["grant", payload.grantTitle ?? payload.grant, grant], ["service provider", payload.serviceProviderName, provider], ["committee", payload.committeeName, committee]] as const) {
    if (cleanText(wanted) && !found) notes.push(`The source names the ${label} "${cleanText(wanted)}", which was not found (or not uniquely) in this workspace.`);
  }
  if (payload.approvedAtMeetingDate && !meeting) notes.push(`Approved at a meeting on ${cleanText(payload.approvedAtMeetingDate)} that was not found.`);
  const reviewStatus = ["NeedsReview", "Verified", "Rejected"].includes(String(payload.reviewStatus)) ? String(payload.reviewStatus) : "NeedsReview";
  return compactRecord({
    title,
    kind,
    status: statusFor(payload),
    agreementNumber: cleanText(payload.agreementNumber),
    summary: cleanText(payload.summary) ?? cleanText(payload.purpose),
    parties,
    ourSignatories: signatories(payload.ourSignatories, directory),
    counterpartySignatories: signatories(payload.counterpartySignatories, directory),
    signedDate: day(payload.signedDate),
    effectiveDate,
    endDate,
    autoRenew: optionalBoolean(payload.autoRenew),
    renewalTermMonths: numberOrUndefined(payload.renewalTermMonths),
    renewalNoticeDays: numberOrUndefined(payload.renewalNoticeDays),
    terminationNoticeDays: numberOrUndefined(payload.terminationNoticeDays),
    terminationTerms: cleanText(payload.terminationTerms),
    valueCents,
    currency: valueCents !== undefined ? (/^[A-Z]{3}$/.test(String(payload.currency ?? "")) ? String(payload.currency) : "CAD") : undefined,
    paymentTerms: cleanText(payload.paymentTerms),
    paymentSchedule: arrayOf(payload.paymentSchedule).map((row: any) => compactRecord({ label: cleanText(row?.label) || cleanText(row?.text) || "Payment", dueDate: day(row?.dueDate ?? row?.due), amountCents: numberOrUndefined(row?.amountCents) })).filter(Boolean),
    deliverables: textRows(payload.deliverables, "deliverable", salt, { status: "not_started" }),
    reportingObligations: textRows(payload.reportingObligations ?? payload.reportingRequirements, "report", salt, { status: "not_started" }),
    confidential: optionalBoolean(payload.confidential),
    governingLaw: cleanText(payload.governingLaw),
    signedDocumentId: optionalBoolean(payload.signed) ? firstSourceDocumentId : undefined,
    sourceDocumentIds: sourceDocumentIds.length ? sourceDocumentIds : undefined,
    renewalOfId: previous?._id,
    supersedesId: replaced?._id,
    linkedGrantId: grant?._id,
    linkedServiceProviderId: provider?._id,
    linkedCommitteeId: committee?._id,
    approvedAtMeetingId: meeting?.meetingId,
    approvalMotionId,
    sourceExternalIds: sourceExternalIds.length ? sourceExternalIds : undefined,
    confidence: cleanText(payload.confidence) || "Review",
    reviewStatus,
    importedFrom: "Import session",
    notes: [cleanText(payload.notes), ...notes].filter(Boolean).join("\n") || undefined,
  }) as Record<string, any>;
}

export const AGREEMENT_SECTION_RECORD_HANDLERS: Record<string, (context: HandlerContext) => Promise<any>> = {
  agreement: async (context) => {
    const { ctx, societyId } = context;
    const fields = await agreementFields(context);
    const now = new Date().toISOString();
    const existing = await agreementBySource(ctx, societyId, arrayOf(fields.sourceExternalIds).map(String));
    let id: any;
    if (existing) {
      // Same source: an unreviewed draft takes the incoming (reviewed) values; a reviewed agreement only gains missing fields.
      const overwrite = existing.reviewStatus === "NeedsReview" || !existing.reviewStatus;
      const patch: Record<string, any> = { updatedAtISO: now };
      for (const [key, value] of Object.entries(fields)) {
        if (["importedFrom", "sourceExternalIds", "sourceDocumentIds", "notes"].includes(key)) continue;
        const empty = existing[key] === undefined || existing[key] === null || (Array.isArray(existing[key]) && !existing[key].length);
        if (empty || (overwrite && key !== "reviewStatus" && key !== "status")) patch[key] = value;
      }
      if (overwrite && fields.status && fields.status !== "unknown") patch.status = fields.status;
      patch.sourceExternalIds = unique([...arrayOf(existing.sourceExternalIds), ...arrayOf(fields.sourceExternalIds)]);
      const docs = unique([...arrayOf(existing.sourceDocumentIds), ...arrayOf(fields.sourceDocumentIds)]);
      if (docs.length) patch.sourceDocumentIds = docs;
      if (fields.notes && !String(existing.notes ?? "").includes(fields.notes)) patch.notes = [existing.notes, fields.notes].filter(Boolean).join("\n").slice(0, 5000);
      await ctx.db.patch(existing._id, patch);
      id = existing._id;
    } else {
      id = await ctx.db.insert("agreements", { ...fields, societyId, createdAtISO: now, updatedAtISO: now });
    }
    if (fields.supersedesId) {
      const replaced = await ctx.db.get(fields.supersedesId);
      if (replaced && !replaced.supersededById) await ctx.db.patch(replaced._id, { supersededById: id, status: "superseded", updatedAtISO: now });
    }
    await syncAgreementDeadlines(ctx, await ctx.db.get(id));
    return id;
  },
};

/** Promotion blockers for an imported agreement (checked before any write). */
export async function agreementPromotionIssues(_ctx: any, _societyId: string, record: any): Promise<string[]> {
  if (record?.recordKind !== "agreement") return [];
  const payload = record.payload ?? {};
  const issues: string[] = [];
  if (!cleanText(payload.title) && !cleanText(payload.name) && !arrayOf(record.sourceExternalIds).length && !arrayOf(payload.sourceExternalIds).length) issues.push("An agreement needs a title or a source document.");
  for (const key of ["effectiveDate", "endDate", "signedDate"]) {
    if (cleanText(payload[key]) && !day(payload[key])) issues.push(`Agreement ${key} must be an exact day (YYYY-MM-DD).`);
  }
  return issues;
}
