/**
 * PORTABLE FUNCTIONS: record continuity and governance expectations
 * (finding A15, audit section 4b).
 *
 * `gaps` (continuityGaps) expands each expectation into expected periods and
 * matches them against native records: meetings by body, AGMs, annual-report
 * filings, financial statements by fiscal year, director terms and consents,
 * insurance terms. Expectations come from a jurisdiction rule pack (implicit
 * until stored), the bylaw rule set, manual entry, or a cadence inferred from
 * history that a person confirms. "Adopt the minutes of <date>" references
 * with no matching minutes become cross-reference gaps.
 *
 * Every record family is read only when the caller may read it; unreadable
 * families are reported as not visible rather than as missing records.
 */

import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId, requireSocietyMembership } from "./access";
import { requirePermissionPortable, type Permission } from "./permissions";
import { documentAccessPredicate } from "./documents";
import {
  countStatuses,
  CROSS_REFERENCE_EXPECTATION_KEY,
  defaultRange,
  effectiveExpectations,
  evaluateContinuity,
  flattenRecordGaps,
  inferCadenceSuggestions,
  isHeldStatus,
  PERIOD_MARK_STATUSES,
  resolveCrossReferences,
  type ContinuitySnapshot,
  type EffectiveExpectation,
  type SnapshotMinutesText,
} from "../continuity";
import {
  EXPECTATION_KINDS,
  EXPECTATION_RULE_PACKS,
  normalizeCadenceRule,
  rulePackForSociety,
  type CadenceRule,
} from "../continuityRules";

const READ_PERMISSIONS = ["meetings:read", "minutes:read", "motions:read", "committees:read", "filings:read", "financials:read", "directors:read", "documents:read"] as const;

async function readAccess(ctx: PortableQueryCtx, societyId: string) {
  await requireSocietyMembership(ctx, societyId);
  const granted = await Promise.all(READ_PERMISSIONS.map(async (permission) => {
    try {
      await requirePermissionPortable(ctx, societyId, permission as Permission);
      return permission;
    } catch (error) {
      if (error instanceof Error && /^(?:Permission|Service scope) [a-zA-Z]+:read required\.$/.test(error.message)) return null;
      throw error;
    }
  }));
  return new Set(granted.filter(Boolean) as string[]);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function bySociety(ctx: PortableQueryCtx, table: string, societyId: string) {
  return ctx.db.query(table).withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
}

const TEXT_LIMIT = 60_000;

function collectText(value: unknown, out: string[], budget: { left: number }, depth = 0) {
  if (budget.left <= 0 || depth > 8 || value === null || value === undefined) return;
  if (typeof value === "string") {
    const text = value.slice(0, budget.left);
    out.push(text);
    budget.left -= text.length;
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out, budget, depth + 1);
    return;
  }
  if (typeof value === "object") for (const item of Object.values(value as Record<string, unknown>)) collectText(item, out, budget, depth + 1);
}

function minutesText(row: Record<string, any>): string {
  const out: string[] = [];
  const budget = { left: TEXT_LIMIT };
  for (const key of ["discussion", "decisions", "sections", "motions", "sourceMeetingRecord"]) collectText(row[key], out, budget);
  return out.join("\n");
}

type StoredExpectation = PortableDoc & {
  societyId: string;
  title: string;
  kind: string;
  bodyKind: string;
  committeeId?: string;
  meetingType?: string;
  rule: CadenceRule;
  effectiveFrom?: string;
  effectiveTo?: string;
  severity: string;
  origin: string;
  ruleKey?: string;
  citation?: string;
  status: string;
  notes?: string;
};

function toEffective(row: StoredExpectation): EffectiveExpectation {
  const template = row.ruleKey ? rulePackTemplate(row.ruleKey) : undefined;
  return {
    key: String(row._id),
    id: String(row._id),
    stored: true,
    title: row.title,
    kind: row.kind,
    bodyKind: row.bodyKind,
    committeeId: row.committeeId ? String(row.committeeId) : undefined,
    meetingType: row.meetingType,
    rule: row.rule,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    severity: row.severity,
    origin: row.origin,
    ruleKey: row.ruleKey,
    citation: row.citation ?? template?.citation,
    caveat: template?.caveat,
    status: row.status,
    notes: row.notes,
  };
}

function rulePackTemplate(ruleKey: string) {
  for (const pack of EXPECTATION_RULE_PACKS) {
    const rule = pack.rules.find((candidate) => candidate.ruleKey === ruleKey);
    if (rule) return rule;
  }
  return undefined;
}

async function loadSnapshot(ctx: PortableQueryCtx, societyId: string): Promise<{ snapshot: ContinuitySnapshot; stored: StoredExpectation[]; minutesTexts: SnapshotMinutesText[] }> {
  const access = await readAccess(ctx, societyId);
  const can = (permission: string) => access.has(permission);
  const empty = Promise.resolve([] as any[]);
  const [society, committees, meetings, minutes, motions, filings, financials, statementImports, directors, insurance, gaps, marks, stored] = await Promise.all([
    ctx.db.get(societyId, "societies"),
    can("committees:read") || can("meetings:read") ? bySociety(ctx, "committees", societyId) : empty,
    can("meetings:read") ? bySociety(ctx, "meetings", societyId) : empty,
    can("minutes:read") ? bySociety(ctx, "minutes", societyId) : empty,
    can("motions:read") ? bySociety(ctx, "motions", societyId) : empty,
    can("filings:read") ? bySociety(ctx, "filings", societyId) : empty,
    can("financials:read") ? bySociety(ctx, "financials", societyId) : empty,
    can("financials:read") ? bySociety(ctx, "financialStatementImports", societyId) : empty,
    can("directors:read") ? bySociety(ctx, "directors", societyId) : empty,
    can("financials:read") ? bySociety(ctx, "insurancePolicies", societyId) : empty,
    can("documents:read") ? bySociety(ctx, "representationGaps", societyId) : empty,
    bySociety(ctx, "continuityPeriodMarks", societyId),
    bySociety(ctx, "governanceExpectations", societyId),
  ]);
  const snapshot: ContinuitySnapshot = {
    today: todayISO(),
    society: society ? { incorporationDate: society.incorporationDate, jurisdictionCode: society.jurisdictionCode, entityType: society.entityType, isMemberFunded: society.isMemberFunded, fiscalYearEnd: society.fiscalYearEnd } : null,
    committees: committees.map((row: any) => ({ _id: String(row._id), name: String(row.name ?? "Committee"), status: row.status })),
    meetings: meetings.map((row: any) => ({ _id: String(row._id), type: row.type, title: row.title, scheduledAt: String(row.scheduledAt ?? ""), status: row.status, committeeId: row.committeeId ? String(row.committeeId) : undefined, minutesId: row.minutesId ? String(row.minutesId) : undefined })),
    minutes: minutes.map((row: any) => ({ _id: String(row._id), meetingId: String(row.meetingId), heldAt: row.heldAt, approvedAt: row.approvedAt, approvedInMeetingId: row.approvedInMeetingId ? String(row.approvedInMeetingId) : undefined, status: row.status })),
    adoptedMinutesIds: motions.map((row: any) => row.adoptsMinutesId).filter(Boolean).map(String),
    filings: filings.map((row: any) => ({ _id: String(row._id), kind: String(row.kind ?? ""), periodLabel: row.periodLabel, dueDate: row.dueDate, filedAt: row.filedAt, status: row.status, confirmationNumber: row.confirmationNumber })),
    financials: financials.map((row: any) => ({ _id: String(row._id), fiscalYear: String(row.fiscalYear ?? ""), periodEnd: row.periodEnd, presentedAtMeetingId: row.presentedAtMeetingId ? String(row.presentedAtMeetingId) : undefined, approvedByBoardAt: row.approvedByBoardAt })),
    statementImports: statementImports.map((row: any) => ({ _id: String(row._id), fiscalYear: String(row.fiscalYear ?? ""), periodEnd: row.periodEnd, status: row.status, title: row.title })),
    directors: directors.map((row: any) => ({ _id: String(row._id), firstName: row.firstName, lastName: row.lastName, termStart: row.termStart, termEnd: row.termEnd, consentOnFile: Boolean(row.consentOnFile), status: row.status })),
    insurance: insurance.map((row: any) => ({ _id: String(row._id), kind: row.kind, policySeriesKey: row.policySeriesKey, policyNumber: row.policyNumber, insurer: row.insurer, startDate: row.startDate, endDate: row.endDate, status: row.status })),
    sourceSignals: gaps
      .filter((row: any) => typeof row.observedDate === "string" && row.bodyKey && String(row.infoType ?? "").startsWith("meeting.") && row.status !== "wont_fix")
      .map((row: any) => ({ table: "representationGaps", id: String(row._id), date: String(row.observedDate), bodyKey: String(row.bodyKey), infoType: row.infoType, label: String(row.sourceTitle ?? row.title ?? "Source file") })),
    marks: marks.map((row: any) => ({ _id: String(row._id), expectationKey: String(row.expectationKey), periodKey: String(row.periodKey), status: String(row.status), reason: row.reason, evidenceDocumentIds: row.evidenceDocumentIds?.map(String), meetingId: row.meetingId ? String(row.meetingId) : undefined })),
    readable: {
      meetings: can("meetings:read") && can("minutes:read"),
      filings: can("filings:read"),
      financials: can("financials:read"),
      directors: can("directors:read"),
      insurance: can("financials:read"),
      sources: can("documents:read"),
    },
  };
  const minutesTexts = can("minutes:read")
    ? minutes.map((row: any) => ({ minutesId: String(row._id), meetingId: String(row.meetingId), heldAt: String(row.heldAt ?? ""), text: minutesText(row) })).filter((row: SnapshotMinutesText) => row.heldAt && row.text)
    : [];
  return { snapshot, stored: stored as StoredExpectation[], minutesTexts };
}

/* -------------------------------- queries -------------------------------- */

export async function gapsPortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; from?: string; to?: string; includeCrossReferences?: boolean },
) {
  const { snapshot, stored, minutesTexts } = await loadSnapshot(ctx, args.societyId);
  const expectations = effectiveExpectations(stored.map(toEffective), snapshot);
  const range = defaultRange(snapshot, args.from, args.to);
  const rows = evaluateContinuity(expectations, snapshot, range);
  const crossReferences = args.includeCrossReferences === false ? [] : resolveCrossReferences(minutesTexts, snapshot);
  const pack = rulePackForSociety(snapshot.society);
  return {
    today: snapshot.today,
    range,
    readable: snapshot.readable,
    rows,
    counts: countStatuses(rows),
    recordGaps: flattenRecordGaps(rows),
    crossReferences,
    suggestions: inferCadenceSuggestions(snapshot, expectations),
    rulePack: pack ? { packId: pack.packId, title: pack.title, sources: pack.sources } : null,
    storedExpectations: stored.length,
  };
}

/** Dashboard checks derived from continuity: AGM, annual report, minutes approval, consent. */
export async function dashboardChecksPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const { snapshot, stored } = await loadSnapshot(ctx, societyId);
  const today = snapshot.today;
  const year = Number(today.slice(0, 4));
  const expectations = effectiveExpectations(stored.map(toEffective), snapshot);
  const rows = evaluateContinuity(expectations, snapshot, { fromYear: year - 1, toYear: year });
  const checks: { id: string; level: "ok" | "warn" | "err" | "info"; title: string; text: string; to: string; citation?: string }[] = [];
  const periodFor = (kind: string, key: string) => rows.find((row) => row.expectation.kind === kind)?.periods.find((period) => period.periodKey === key);
  const agmRow = rows.find((row) => row.expectation.kind === "agm");
  if (snapshot.readable.meetings && agmRow) {
    const current = periodFor("agm", String(year));
    const previous = periodFor("agm", String(year - 1));
    const held = current && ["satisfied", "draft_only", "record_missing"].includes(current.status) && current.foundCount > 0;
    const level = held ? "ok" : previous && previous.status === "record_missing" && previous.foundCount === 0 ? "err" : "warn";
    checks.push({
      id: "CONTINUITY-AGM-THIS-YEAR",
      level,
      title: `AGM held in ${year}`,
      text: held
        ? `AGM recorded on ${current!.evidence.find((item) => item.table === "meetings")?.date ?? "a date this year"}.`
        : current?.mark ? current.note ?? "Period marked." : `No AGM recorded yet for ${year}; it must be held by Dec 31.${previous && previous.status === "record_missing" && previous.foundCount === 0 ? ` ${year - 1} also has no AGM record.` : ""}`,
      to: "/app/coverage?tab=continuity",
      citation: agmRow.expectation.citation,
    });
  }
  const filingRow = rows.find((row) => row.expectation.kind === "annual_filing");
  if (filingRow && snapshot.readable.filings) {
    const latest = [...filingRow.periods].reverse().find((period) => period.status !== "not_applicable");
    const level = !latest ? "info" : latest.status === "satisfied" ? "ok" : latest.status === "upcoming" ? "warn" : "err";
    checks.push({
      id: "CONTINUITY-ANNUAL-REPORT-FILED",
      level,
      title: "Annual report filed after the AGM",
      text: !latest ? "No AGM recorded in the last two years, so no annual report is expected yet." : latest.status === "satisfied" ? `Filed for ${latest.label}${latest.note ? ` (${latest.note})` : ""}.` : latest.status === "upcoming" ? `Annual report for ${latest.label} due ${latest.dueDate}.` : `No filing evidence for the ${latest.label} AGM (due ${latest.dueDate}).`,
      to: "/app/filings",
      citation: filingRow.expectation.citation,
    });
  }
  if (snapshot.readable.meetings) {
    const cutoff = `${year - 1}${today.slice(4)}`;
    const recent = snapshot.meetings.filter((meeting) => isHeldStatus(meeting.status) && meeting.scheduledAt.slice(0, 10) >= cutoff && meeting.scheduledAt.slice(0, 10) <= today);
    const minutesByMeeting = new Map(snapshot.minutes.map((row) => [row.meetingId, row]));
    const adopted = new Set(snapshot.adoptedMinutesIds);
    const missing = recent.filter((meeting) => meeting.status === "HeldMinutesMissing" || !minutesByMeeting.has(meeting._id));
    const unapproved = recent.filter((meeting) => {
      const minutes = minutesByMeeting.get(meeting._id);
      return minutes && !minutes.approvedAt && !minutes.approvedInMeetingId && !adopted.has(minutes._id);
    });
    const level = missing.length ? "err" : unapproved.length ? "warn" : "ok";
    checks.push({
      id: "CONTINUITY-MINUTES-APPROVED",
      level,
      title: "Minutes approved (last 12 months)",
      text: !recent.length ? "No meetings held in the last 12 months." : `${recent.length - missing.length - unapproved.length} of ${recent.length} held meeting(s) have approved minutes${unapproved.length ? `; ${unapproved.length} awaiting approval` : ""}${missing.length ? `; ${missing.length} with no minutes` : ""}.`,
      to: "/app/minutes",
    });
  }
  if (snapshot.readable.directors) {
    const active = snapshot.directors.filter((director) => director.status === "Active");
    const missing = active.filter((director) => !director.consentOnFile);
    checks.push({
      id: "CONTINUITY-DIRECTOR-CONSENT",
      level: !active.length ? "warn" : missing.length ? "warn" : "ok",
      title: "Director consent on file",
      text: !active.length ? "No active directors in the register." : missing.length ? `${missing.length} of ${active.length} active director(s) have no consent evidence.` : `All ${active.length} active directors have consent evidence.`,
      to: "/app/directors",
      citation: "Societies Act, SBC 2015, c. 18, s. 42(4)",
    });
  }
  return { checks, today };
}

export async function listExpectationsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [society, stored, bylawRuleSets] = await Promise.all([
    ctx.db.get(societyId, "societies"),
    bySociety(ctx, "governanceExpectations", societyId),
    bySociety(ctx, "bylawRuleSets", societyId),
  ]);
  const pack = rulePackForSociety(society as any);
  const storedKeys = new Set(stored.map((row: any) => row.ruleKey).filter(Boolean));
  return {
    stored: stored.sort((a: any, b: any) => String(a.title).localeCompare(String(b.title))),
    rulePack: pack
      ? { packId: pack.packId, title: pack.title, sources: pack.sources, rules: pack.rules.map((rule) => ({ ...rule, stored: storedKeys.has(rule.ruleKey) })) }
      : null,
    hasActiveBylawRules: bylawRuleSets.some((row: any) => row.status === "Active"),
  };
}

/** Documents a person can attach as period evidence (title search, access-filtered). */
export async function evidenceDocumentsPortable(ctx: PortableQueryCtx, { societyId, search }: { societyId: string; search: string }) {
  await requirePermissionPortable(ctx, societyId, "documents:read");
  const text = String(search ?? "").trim();
  if (text.length < 2) return [];
  const allows = await documentAccessPredicate(ctx, societyId);
  const rows = await ctx.db.query("documents").withSearchIndex("search_title", (q) => q.search("title", text).eq("societyId", societyId)).filter((doc) => allows(doc)).take(20);
  return rows.map((row: any) => ({ _id: String(row._id), title: String(row.title ?? "Document"), category: row.category, createdAtISO: row.createdAtISO }));
}

/* ------------------------------- mutations ------------------------------- */

type ExpectationInput = {
  title: string;
  kind: string;
  bodyKind: string;
  committeeId?: string;
  meetingType?: string;
  rule: CadenceRule;
  effectiveFrom?: string;
  effectiveTo?: string;
  severity?: string;
  origin?: string;
  ruleKey?: string;
  citation?: string;
  sourceIds?: string[];
  authorityDocumentId?: string;
  authorityLocator?: string;
  status?: string;
  confidence?: number;
  notes?: string;
};

const BODY_KINDS = ["members", "board", "committee", "organization"];
const SEVERITIES = ["statutory", "bylaw", "practice"];
const ORIGINS = ["rule_pack", "bylaw_rules", "manual", "inferred", "schedule_document"];
const EXPECTATION_STATUSES = ["active", "suggested", "archived"];

function cleanDate(value: string | undefined, label: string) {
  if (value === undefined || value === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be a date (YYYY-MM-DD).`);
  return value;
}

async function validateExpectation(ctx: PortableQueryCtx, societyId: string, input: Partial<ExpectationInput>, partial = false) {
  const out: Record<string, unknown> = {};
  if (input.title !== undefined || !partial) {
    const title = String(input.title ?? "").trim();
    if (!title) throw new Error("An expectation needs a title.");
    out.title = title.slice(0, 200);
  }
  if (input.kind !== undefined || !partial) {
    if (!(EXPECTATION_KINDS as readonly string[]).includes(String(input.kind))) throw new Error(`Unsupported expectation kind: ${String(input.kind)}.`);
    out.kind = input.kind;
  }
  if (input.bodyKind !== undefined || !partial) {
    if (!BODY_KINDS.includes(String(input.bodyKind))) throw new Error(`Unsupported body: ${String(input.bodyKind)}.`);
    out.bodyKind = input.bodyKind;
  }
  if (input.committeeId) {
    await getOwned(ctx, "committees", input.committeeId, societyId);
    out.committeeId = input.committeeId;
  }
  if ((out.bodyKind ?? input.bodyKind) === "committee" && !input.committeeId && !partial) throw new Error("Choose the committee this expectation applies to.");
  if (input.meetingType !== undefined) out.meetingType = String(input.meetingType).slice(0, 40) || undefined;
  if (input.rule !== undefined || !partial) out.rule = normalizeCadenceRule(input.rule as CadenceRule);
  const effectiveFrom = cleanDate(input.effectiveFrom, "Effective from");
  const effectiveTo = cleanDate(input.effectiveTo, "Effective to");
  if (input.effectiveFrom !== undefined) out.effectiveFrom = effectiveFrom;
  if (input.effectiveTo !== undefined) out.effectiveTo = effectiveTo;
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) throw new Error("Effective to must be on or after effective from.");
  if (input.severity !== undefined || !partial) {
    const severity = input.severity ?? "practice";
    if (!SEVERITIES.includes(severity)) throw new Error(`Unsupported severity: ${severity}.`);
    out.severity = severity;
  }
  if (input.origin !== undefined || !partial) {
    const origin = input.origin ?? "manual";
    if (!ORIGINS.includes(origin)) throw new Error(`Unsupported origin: ${origin}.`);
    out.origin = origin;
  }
  if (input.status !== undefined || !partial) {
    const status = input.status ?? "active";
    if (!EXPECTATION_STATUSES.includes(status)) throw new Error(`Unsupported status: ${status}.`);
    out.status = status;
  }
  if (input.authorityDocumentId) {
    await getOwned(ctx, "documents", input.authorityDocumentId, societyId);
    out.authorityDocumentId = input.authorityDocumentId;
  }
  for (const key of ["ruleKey", "citation", "authorityLocator", "notes"] as const) {
    if (input[key] !== undefined) out[key] = String(input[key]).slice(0, key === "notes" ? 2000 : 300) || undefined;
  }
  if (input.sourceIds !== undefined) out.sourceIds = input.sourceIds.map(String).slice(0, 20);
  if (input.confidence !== undefined) {
    if (!(input.confidence >= 0 && input.confidence <= 1)) throw new Error("Confidence must be between 0 and 1.");
    out.confidence = input.confidence;
  }
  return out;
}

async function logActivity(ctx: PortableMutationCtx, societyId: string, subjectId: string, action: string, summary: string) {
  const nowISO = new Date().toISOString();
  await ctx.db.insert("activity", { societyId, actor: "You", entityType: "governanceExpectation", subjectId, entityId: subjectId, action, summary, createdAtISO: nowISO });
}

export async function createExpectationPortable(ctx: PortableMutationCtx, args: ExpectationInput & { societyId: string }) {
  await requireSocietyMembership(ctx, args.societyId);
  const { societyId, ...input } = args;
  const fields = await validateExpectation(ctx, societyId, input);
  if (fields.ruleKey) {
    const existing = await ctx.db.query("governanceExpectations").withIndex("by_society_rule_key", (q) => q.eq("societyId", societyId).eq("ruleKey", fields.ruleKey)).first();
    if (existing) throw new Error("An expectation for this rule already exists; edit it instead.");
  }
  const nowISO = new Date().toISOString();
  const row: Record<string, unknown> = { societyId, ...fields, createdAtISO: nowISO, updatedAtISO: nowISO };
  for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
  const id = await ctx.db.insert("governanceExpectations", row);
  await logActivity(ctx, societyId, id, "created", `Added expectation "${fields.title}"`);
  return id;
}

export async function updateExpectationPortable(ctx: PortableMutationCtx, { id, patch }: { id: string; patch: Partial<ExpectationInput> }) {
  const candidate = await ctx.db.get(id, "governanceExpectations");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("governanceExpectations not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "governanceExpectations", id, candidate.societyId);
  if ((patch as any).societyId) throw new Error("Workspace reassignment is not permitted.");
  const fields = await validateExpectation(ctx, candidate.societyId, { ...patch, bodyKind: patch.bodyKind ?? candidate.bodyKind }, true);
  const nextBody = (fields.bodyKind ?? candidate.bodyKind) as string;
  if (nextBody === "committee" && !(fields.committeeId ?? candidate.committeeId)) throw new Error("Choose the committee this expectation applies to.");
  await ctx.db.patch(id, { ...fields, updatedAtISO: new Date().toISOString() });
  return { ok: true };
}

export async function removeExpectationPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "governanceExpectations");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("governanceExpectations not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  const row = await getOwned(ctx, "governanceExpectations", id, candidate.societyId);
  const marks = await ctx.db.query("continuityPeriodMarks").withIndex("by_society", (q) => q.eq("societyId", candidate.societyId)).collect();
  for (const mark of marks.filter((mark: any) => mark.expectationKey === id)) await ctx.db.delete(mark._id);
  await ctx.db.delete(id);
  await logActivity(ctx, candidate.societyId, id, "deleted", `Removed expectation "${row.title}"`);
  return { ok: true };
}

/** Store the jurisdiction rule pack's expectations so they can be edited or switched off. */
export async function seedRulePackPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const society = await ctx.db.get(societyId, "societies");
  const pack = rulePackForSociety(society as any);
  if (!pack) throw new Error("No record-continuity rule pack exists for this organization's jurisdiction and type yet.");
  const stored = await bySociety(ctx, "governanceExpectations", societyId);
  const meetings = await bySociety(ctx, "meetings", societyId);
  const existing = new Set(stored.map((row: any) => row.ruleKey).filter(Boolean));
  const implicit = effectiveExpectations([], {
    today: todayISO(),
    society: society ? { incorporationDate: society.incorporationDate, jurisdictionCode: society.jurisdictionCode, entityType: society.entityType, isMemberFunded: society.isMemberFunded } : null,
    meetings: meetings.map((row: any) => ({ _id: String(row._id), scheduledAt: String(row.scheduledAt ?? "") })),
  });
  const nowISO = new Date().toISOString();
  let created = 0;
  for (const rule of pack.rules) {
    if (existing.has(rule.ruleKey)) continue;
    const effective = implicit.find((row) => row.ruleKey === rule.ruleKey);
    const id = await ctx.db.insert("governanceExpectations", {
      societyId,
      title: rule.title,
      kind: rule.kind,
      bodyKind: rule.bodyKind,
      ...(rule.meetingType ? { meetingType: rule.meetingType } : {}),
      rule: rule.rule,
      ...(effective?.effectiveFrom ? { effectiveFrom: effective.effectiveFrom } : {}),
      severity: rule.severity,
      origin: "rule_pack",
      ruleKey: rule.ruleKey,
      citation: rule.citation,
      sourceIds: rule.sourceIds,
      status: effective ? "active" : "archived",
      notes: rule.caveat,
      createdAtISO: nowISO,
      updatedAtISO: nowISO,
    });
    await logActivity(ctx, societyId, id, "created", `Added rule-pack expectation "${rule.title}"`);
    created += 1;
  }
  return { created };
}

/** Derive expectations from the active bylaw rule set (annual report timing, statements at the AGM). */
export async function deriveFromBylawRulesPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const ruleSets = await bySociety(ctx, "bylawRuleSets", societyId);
  const active = ruleSets.filter((row: any) => row.status === "Active").sort((a: any, b: any) => Number(b.version ?? 0) - Number(a.version ?? 0))[0];
  if (!active) throw new Error("Activate a bylaw rule set first (Governance records → Bylaw rules).");
  const nowISO = new Date().toISOString();
  const effectiveFrom = typeof active.effectiveFromISO === "string" ? active.effectiveFromISO.slice(0, 10) : undefined;
  const derived = [
    {
      ruleKey: "BYLAW-ANNUAL-REPORT",
      title: `Annual report filed within ${active.annualReportDueDaysAfterMeeting} days after the AGM (bylaw rules)`,
      kind: "annual_filing",
      bodyKind: "organization",
      rule: { frequency: "after_event", anchor: "agm", offsetDays: Number(active.annualReportDueDaysAfterMeeting ?? 30) },
      include: Number(active.annualReportDueDaysAfterMeeting ?? 30) !== 30,
    },
    {
      ruleKey: "BYLAW-FS-AT-AGM",
      title: "Financial statements presented at each AGM (bylaw rules)",
      kind: "financial_statement",
      bodyKind: "members",
      rule: { frequency: "after_event", anchor: "agm", offsetDays: 0 },
      include: Boolean(active.requireAgmFinancialStatements),
    },
  ];
  let created = 0;
  let updated = 0;
  for (const item of derived) {
    const existing: any = await ctx.db.query("governanceExpectations").withIndex("by_society_rule_key", (q) => q.eq("societyId", societyId).eq("ruleKey", item.ruleKey)).first();
    if (!item.include) {
      if (existing && existing.status !== "archived") { await ctx.db.patch(existing._id, { status: "archived", updatedAtISO: nowISO }); updated += 1; }
      continue;
    }
    const fields = {
      title: item.title,
      kind: item.kind,
      bodyKind: item.bodyKind,
      rule: item.rule,
      severity: "bylaw",
      origin: "bylaw_rules",
      ruleKey: item.ruleKey,
      citation: `Bylaw rule set v${active.version}`,
      ...(active.sourceBylawDocumentId ? { authorityDocumentId: active.sourceBylawDocumentId } : {}),
      ...(effectiveFrom ? { effectiveFrom } : {}),
      status: "active",
      updatedAtISO: nowISO,
    };
    if (existing) { await ctx.db.patch(existing._id, fields); updated += 1; }
    else { await ctx.db.insert("governanceExpectations", { societyId, ...fields, createdAtISO: nowISO }); created += 1; }
  }
  return { created, updated, ruleSetVersion: active.version };
}

async function assertExpectationKey(ctx: PortableQueryCtx, societyId: string, expectationKey: string) {
  if (expectationKey === CROSS_REFERENCE_EXPECTATION_KEY) return;
  const pack = rulePackForSociety((await ctx.db.get(societyId, "societies")) as any);
  if (pack?.rules.some((rule) => rule.ruleKey === expectationKey)) return;
  await getOwned(ctx, "governanceExpectations", expectationKey, societyId);
}

/** Record a person's disposition of one expected period (upsert). */
export async function markPeriodPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; expectationKey: string; periodKey: string; status: string; reason?: string; evidenceDocumentIds?: string[]; meetingId?: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  if (!(PERIOD_MARK_STATUSES as readonly string[]).includes(args.status)) throw new Error(`Unsupported period status: ${args.status}.`);
  if (!/^\d{4}(?:-(?:\d{2}|Q[1-4])(?:-\d{2})?)?$/.test(args.periodKey)) throw new Error("Unsupported period.");
  await assertExpectationKey(ctx, args.societyId, args.expectationKey);
  const reason = String(args.reason ?? "").trim().slice(0, 1000) || undefined;
  if ((args.status === "never_held" || args.status === "waived") && !reason) throw new Error("Give a reason when marking a period never held or waived.");
  for (const documentId of args.evidenceDocumentIds ?? []) await getOwned(ctx, "documents", documentId, args.societyId);
  if (args.meetingId) await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  if (args.status === "satisfied" && !(args.evidenceDocumentIds?.length || args.meetingId)) throw new Error("Attach a document or meeting as evidence.");
  const nowISO = new Date().toISOString();
  const markedByUserId = await principalUserId(ctx, args.societyId);
  const existing: any = await ctx.db
    .query("continuityPeriodMarks")
    .withIndex("by_society_expectation_period", (q) => q.eq("societyId", args.societyId).eq("expectationKey", args.expectationKey).eq("periodKey", args.periodKey))
    .first();
  const fields: Record<string, unknown> = {
    status: args.status,
    reason,
    evidenceDocumentIds: args.evidenceDocumentIds?.length ? [...new Set(args.evidenceDocumentIds)] : undefined,
    meetingId: args.meetingId || undefined,
    markedByUserId,
    updatedAtISO: nowISO,
  };
  for (const key of Object.keys(fields)) if (fields[key] === undefined) delete fields[key];
  if (existing) {
    await ctx.db.replace(existing._id, { societyId: existing.societyId, expectationKey: existing.expectationKey, periodKey: existing.periodKey, createdAtISO: existing.createdAtISO, ...fields });
    return existing._id;
  }
  return ctx.db.insert("continuityPeriodMarks", { societyId: args.societyId, expectationKey: args.expectationKey, periodKey: args.periodKey, createdAtISO: nowISO, ...fields });
}

export async function clearPeriodMarkPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "continuityPeriodMarks");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("continuityPeriodMarks not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "continuityPeriodMarks", id, candidate.societyId);
  await ctx.db.delete(id);
  return { ok: true };
}
