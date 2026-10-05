import { buildSourceMinuteSections, hasRecordedMinuteSectionContent, attachSourceMinuteSectionLinks } from "../sourceMinutesTransposition";
import { buildSourceMeetingRecord, preflightSourceMeetingRecord, type SourceMeetingDocumentInput } from "../sourceMeetingRecord";
import { requireDocumentAccess, documentAccessPredicate } from "./documents";
import { minutesEvidenceOptions } from "../minutesExportEvidence";
import { bylawBaselineForOrganization, contextualBylawRules } from "../bylawBaselines";
/**
 * PORTABLE FUNCTIONS: the minutes domain
 * (list / getByMeeting / create / update / upsertFromDraft /
 *  backfillMotionPersonLinks).
 *
 * Reads/writes the `minutes` table (plus `meetings`, `members`, `directors`,
 * `bylawRuleSets`, `motions`) over `ctx.db`. The quorum-snapshot helpers are
 * portable copies of `convex/lib/bylawRules.ts`, and `syncMotionsForMinutes` is
 * a portable copy of `convex/motions.ts`'s dual-write helper (both only touch
 * `ctx.db`). Each handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 *
 * Server-only handlers stay on Convex (convex/minutes.ts):
 *   - generateDraft (action; ctx.runQuery/ctx.runMutation + summarizeMinutes)
 *   - backfillQuorumSnapshot (NOOP)
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, principalUserId, requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import {
  applyProceduralTags,
  classifyProceduralMotion,
  defaultDecidedByFor,
} from "../proceduralMotions";
import { motionRowToEmbedded } from "../minutesMotions";

// ----- portable quorum-snapshot helpers (copied from convex/lib/bylawRules) --

type BylawRuleSetLike = Record<string, any>;
type ResolvedBylawRuleSet = BylawRuleSetLike & { isFallback?: boolean };

export type QuorumSnapshot = {
  bylawRuleSetId?: string;
  quorumRuleVersion?: number;
  quorumRuleEffectiveFromISO?: string;
  quorumSourceLabel: string;
  quorumRequired?: number;
  quorumComputedAtISO: string;
};


export function getDefaultBylawRules(societyId: string, organization?: any) {
  return bylawBaselineForOrganization(organization, societyId);
}

async function getBylawRuleSetForDate(
  ctx: PortableQueryCtx | PortableMutationCtx,
  societyId: string,
  dateISO: string,
): Promise<ResolvedBylawRuleSet> {
  const rows = await ctx.db
    .query("bylawRuleSets")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const targetTs = timestampOrInfinity(dateISO);
  const eligible = rows
    .filter((row) => row.status !== "Draft")
    .filter((row) => effectiveTimestamp(row) <= targetTs);
  const selected = eligible.sort(compareRuleSetsDesc)[0];
  const organization = await ctx.db.get(societyId);
  return contextualBylawRules(organization, societyId, selected);
}

async function buildQuorumSnapshot(
  ctx: PortableQueryCtx | PortableMutationCtx,
  args: {
    societyId: string;
    meetingDateISO: string;
    meetingType?: string;
    quorumRequiredOverride?: number;
  },
): Promise<QuorumSnapshot> {
  const now = new Date().toISOString();
  const rules = await getBylawRuleSetForDate(
    ctx,
    args.societyId,
    args.meetingDateISO,
  );
  const ruleRequired = await computeRequiredQuorum(ctx, rules, args);
  const quorumRequired =
    args.quorumRequiredOverride ?? ruleRequired;
  const label = quorumSourceLabel(
    rules,
    quorumRequired != null &&
      ruleRequired != null &&
      quorumRequired !== ruleRequired,
  );

  return {
    bylawRuleSetId: rules._id,
    quorumRuleVersion: rules.version,
    quorumRuleEffectiveFromISO: rules.effectiveFromISO,
    quorumSourceLabel: label,
    quorumRequired,
    quorumComputedAtISO: now,
  };
}

async function computeRequiredQuorum(
  ctx: PortableQueryCtx | PortableMutationCtx,
  rules: ResolvedBylawRuleSet,
  args: {
    societyId: string;
    meetingType?: string;
  },
) {
  if ((rules as any).quorumRequiresLegalRegister || (rules as any).governanceAutomationBlocked) return undefined;
  if (rules.quorumType === "fixed") {
    return rules.quorumValue;
  }
  if (rules.quorumType === "percentage" && isGeneralMeeting(args.meetingType)) {
    const members = await ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    const eligible = members.filter(
      (member) => member.status === "Active" && member.votingRights,
    ).length;
    const percentageQuorum = Math.ceil(eligible * (rules.quorumValue / 100));
    return Math.max(rules.quorumMinimumCount ?? 1, percentageQuorum);
  }
  return undefined;
}

function quorumSourceLabel(
  rules: ResolvedBylawRuleSet,
  hasManualOverride: boolean,
) {
  const prefix = hasManualOverride ? "Manual quorum override; " : "";
  if (rules.isFallback || !rules._id) {
    return `${prefix}${(rules as any).baselineLabel ?? "Statutory draft baseline; governing instrument review required"}`;
  }
  const effective = rules.effectiveFromISO
    ? `, effective ${rules.effectiveFromISO.slice(0, 10)}`
    : "";
  return `${prefix}Bylaw rules v${rules.version}${effective}`;
}

function compareRuleSetsDesc(
  a: Record<string, any>,
  b: Record<string, any>,
) {
  const byEffective = effectiveTimestamp(b) - effectiveTimestamp(a);
  if (byEffective !== 0) return byEffective;
  return b.version - a.version;
}

function effectiveTimestamp(row: Record<string, any>) {
  return timestampOrNegativeInfinity(row.effectiveFromISO);
}

function timestampOrInfinity(value: string) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
}

function timestampOrNegativeInfinity(value?: string) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
}

function isGeneralMeeting(type?: string) {
  return type === "AGM" || type === "SGM";
}

// ----- portable motions dual-write helper (copied from convex/motions.ts) ----

function stripUndefined(obj: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, val] of Object.entries(obj)) if (val !== undefined) out[k] = val;
  return out;
}

const KNOWN_EMBEDDED_OUTCOMES = new Set([
  "",
  "pending",
  "carried",
  "defeated",
  "tabled",
  "deferred",
  "withdrawn",
]);

/** Map a legacy embedded `outcome` string to the explicit (status, outcome)
 *  split. See the backfill map in docs/motions-first-class-object-design.md. */
function statusFromEmbeddedOutcome(raw?: string): { status: string; outcome?: string } {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value === "pending") return { status: "Moved" };
  if (value === "carried") return { status: "Voted", outcome: "Carried" };
  if (value === "defeated") return { status: "Voted", outcome: "Defeated" };
  if (value === "tabled") return { status: "Tabled" };
  if (value === "deferred") return { status: "Deferred" };
  if (value === "withdrawn") return { status: "Withdrawn" };
  return { status: "Moved" }; // unknown → caller preserves the raw value in `note`
}

/** Mirror one minutes doc's embedded `motions[]` into the motions table by
 *  RECONCILE-BY-IDENTITY: an embedded motion carrying a `motionId` updates that
 *  row in place (stable id across saves), a new one is inserted, and rows whose
 *  motion was removed are deleted. The stable id is back-linked into
 *  `minutes.motions[]` and the ordered `minutes.motionIds`, so references
 *  (motionIds, history, future links) survive edits instead of churning on every
 *  save. Reads come from the table via resolveMinutesMotions. */
export async function syncMotionsForMinutes(
  ctx: PortableMutationCtx,
  args: { societyId: any; minutesId: any; meetingId?: any; motions?: any[] },
) {
  await requireSocietyMembership(ctx, String(args.societyId));
  await getOwned(ctx, "minutes", String(args.minutesId), String(args.societyId));
  if (args.meetingId) {
    await getOwned(ctx, "meetings", String(args.meetingId), String(args.societyId));
  }
  await assertMinutesForeignKeys(ctx, String(args.societyId), { motions: args.motions ?? [] });
  await assertMotionPersonLinksBelongToSociety(ctx, String(args.societyId), args.motions ?? []);
  // Best-effort: a mirror failure must never roll back the minutes save that
  // triggered it. A stale mirror is corrected by the step-2 backfill or the
  // next edit; a broken minutes save is a user-facing regression.
  try {
    const existing = await ctx.db
      .query("motions")
      .withIndex("by_minutes", (q) => q.eq("minutesId", args.minutesId))
      .collect();
    const existingById = new Map(existing.map((row: any) => [String(row._id), row]));
    const keptIds = new Set<string>();

    const now = new Date().toISOString();
    const motionIds: any[] = [];
    for (const m of args.motions ?? []) {
      const { status, outcome } = statusFromEmbeddedOutcome(m.outcome);
      const note = KNOWN_EMBEDDED_OUTCOMES.has(String(m.outcome ?? "").trim().toLowerCase())
        ? undefined
        : `legacy outcome: ${m.outcome}`;
      // Classify recurring procedural motions (adjournment, approve-minutes,
      // approve-agenda, recess, receive-reports) from their wording and stamp
      // the first-class record with an explicit kind + label, so the master
      // list filters by a stored tag instead of regex-matching every render.
      // Default the "decided by" axis from the catalogue (most procedural
      // motions pass by general consent, carrying without a recorded tally).
      const kind = classifyProceduralMotion({
        text: m.text,
        sectionTitle: m.sectionTitle,
        resolutionType: m.resolutionType,
      });
      const tags = applyProceduralTags(m.tags, {
        text: m.text,
        sectionTitle: m.sectionTitle,
      });
      const decidedBy =
        m.decidedBy ??
        defaultDecidedByFor({ text: m.text, sectionTitle: m.sectionTitle });
      const historyEntry = stripUndefined({
        at: now,
        minutesId: args.minutesId,
        meetingId: args.meetingId,
        status,
        outcome,
        votesFor: m.votesFor,
        votesAgainst: m.votesAgainst,
        abstentions: m.abstentions,
        note,
      });
      const fields = stripUndefined({
        societyId: args.societyId,
        minutesId: args.minutesId,
        primaryMeetingId: args.meetingId,
        title: m.name,
        text: m.text ?? "",
        movedBy: m.movedBy,
        movedByMemberId: m.movedByMemberId,
        movedByDirectorId: m.movedByDirectorId,
        secondedBy: m.secondedBy,
        secondedByMemberId: m.secondedByMemberId,
        secondedByDirectorId: m.secondedByDirectorId,
        resolutionTypeLabel: m.resolutionType,
        status,
        outcome,
        decidedBy,
        proceduralKind: kind?.key,
        tags: tags.length ? tags : undefined,
        votesFor: m.votesFor,
        votesAgainst: m.votesAgainst,
        abstentions: m.abstentions,
        sectionIndex: m.sectionIndex,
        sectionTitle: m.sectionTitle,
        motionTemplateId: m.motionTemplateId,
        adoptsMinutesId: m.adoptsMinutesId,
        source: "minutes",
      });
      // Reconcile by identity: an embedded motion that already links a row of
      // this minutes updates it in place (replace() overwrites the whole row so
      // fields cleared in the editor don't linger); otherwise insert a fresh row.
      const linkId = m.motionId != null && existingById.has(String(m.motionId)) ? m.motionId : null;
      let rowId: any;
      if (linkId) {
        const prev: any = existingById.get(String(linkId));
        await ctx.db.replace(linkId, {
          ...fields,
          history: [historyEntry],
          createdAtISO: prev?.createdAtISO ?? now,
          updatedAtISO: now,
        });
        rowId = linkId;
      } else {
        rowId = await ctx.db.insert("motions", {
          ...fields,
          history: [historyEntry],
          createdAtISO: now,
          updatedAtISO: now,
        });
      }
      keptIds.add(String(rowId));
      motionIds.push(rowId);
    }
    // Drop rows whose motion was removed from the embedded array this save.
    for (const row of existing) {
      if (!keptIds.has(String(row._id))) await ctx.db.delete(row._id);
    }
    // Maintain the ordered id references only — the embedded `minutes.motions[]`
    // is NO LONGER written (the table + motionIds ARE the record now, Phase 4C).
    // Reconcile keys on the motionId the caller carries in each submitted motion
    // (the editor supplies it from displayMotions; agenda sync from the resolver).
    await ctx.db.patch(args.minutesId, { motionIds });
  } catch (err) {
    console.warn(
      `[motions] dual-write sync failed for minutes ${String(args.minutesId)}: ${String(err)}`,
    );
  }
}

/** Adopted wording, attendance, appendices and metadata never resolve from later live edits. */
export function adoptedMinutesView(minutes: any) {
  return minutes?.approvedAt && minutes?.adoptedSnapshot
    ? { ...minutes, ...minutes.adoptedSnapshot, _id: minutes._id, adoptedSnapshot: minutes.adoptedSnapshot, adoptionHistory: minutes.adoptionHistory, adoptedRevision: minutes.adoptedRevision }
    : minutes;
}

async function minutesSnapshot(ctx: PortableMutationCtx, record: any, motions: any[]) {
  const societyId = String(record.societyId);
  for (const permission of ['documents:read', 'conflicts:read', 'proxies:read', 'directors:read'] as const) await requirePermissionPortable(ctx, societyId, permission);
  const [signatures, conflicts, proxies, directors, meeting, agenda] = await Promise.all([
    ctx.db.query('signatures').withIndex('by_entity', q => q.eq('entityType', 'minutes').eq('entityId', record._id)).collect(),
    ctx.db.query('conflicts').withIndex('by_meeting', q => q.eq('meetingId', record.meetingId)).collect(),
    ctx.db.query('proxies').withIndex('by_meeting', q => q.eq('meetingId', record.meetingId)).collect(),
    ctx.db.query('directors').withIndex('by_society', q => q.eq('societyId', societyId)).collect(),
    getOwned(ctx, 'meetings', String(record.meetingId), societyId),
    ctx.db.query('agendas').withIndex('by_meeting', q => q.eq('meetingId', record.meetingId)).first(),
  ]);
  const { _id, _creationTime, adoptedSnapshot, adoptionHistory, displayMotions, ...snapshot } = record;
  return JSON.parse(JSON.stringify({ ...snapshot, motionSnapshots: motions,
    adoptedExportEvidence: minutesEvidenceOptions(signatures.filter(row => row.societyId === societyId && !row.revokedAtISO), conflicts, proxies, directors, motions),
    adoptedMeeting: meeting, adoptedAgenda: agenda,
  }));
}

/** Imported source copies obey the source document ACL as well as minutes access. */
async function sourceMinutesView(ctx: PortableQueryCtx, minutes: any) {
  if (!minutes?.sourceTransposition && !minutes?.sourceMeetingRecord) return minutes;
  let visible = true;
  try {
    await requirePermissionPortable(ctx,String(minutes.societyId),"documents:read");
    const allows = await documentAccessPredicate(ctx,String(minutes.societyId));
    const sourceIds = [...new Set([...(minutes.sourceDocumentIds ?? []),...(minutes.sourceTransposition?.originalSources ?? []).map((source:any) => source.documentId).filter(Boolean),...(minutes.sourceMeetingRecord?.documents ?? []).map((source:any) => source.documentId).filter(Boolean)])];
    for (const id of sourceIds) {
      const document = await ctx.db.get(id,"documents");
      if (!document || document.societyId !== minutes.societyId || !allows(document,"view")) {visible=false;break;}
    }
  } catch {visible=false;}
  if (visible) return minutes;
  return {...minutes,discussion:"Source content is restricted by document access.",decisions:[],actionItems:[],displayMotions:[],
    sections:(minutes.sections ?? []).map((section:any) => ({title:section.title,depth:section.depth ?? 0,type:section.type,discussion:"Source content is restricted by document access."})),
    sourceMeetingRecord:undefined,draftTranscript:undefined,motions:[],motionSnapshots:[],adoptedSnapshot:undefined,adoptionHistory:[],sourceTransposition:{version:1,reviewStatus:"restricted",note:"Open the source with an authorized document account to view imported evidence."}};
}

// ----- queries --------------------------------------------------------------

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db
    .query("minutes")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  // Attach the resolved display motions at the query boundary so every frontend
  // display read (all routed through minutesMotionsForDisplay in Phase 0) becomes
  // table-sourced transparently. The live embedded `motions[]` stays untouched on
  // the row for the editor's write path. See docs/motions-migration-finish-scope.md.
  return Promise.all(
    rows.map(async (m) => sourceMinutesView(ctx,{ ...adoptedMinutesView(m), displayMotions: await resolveMinutesMotions(ctx, m) })),
  );
}

export async function getByMeetingPortable(
  ctx: PortableQueryCtx,
  { meetingId }: { meetingId: string },
) {
  await requireOwnedRow(ctx, "meetings", meetingId);
  const rows = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  const m = rows[0];
  if (!m) return null;
  return sourceMinutesView(ctx,{ ...adoptedMinutesView(m), displayMotions: await resolveMinutesMotions(ctx, m) });
}

/**
 * Resolve a minutes' motions for DISPLAY from the single source of truth — the
 * async, table-backed counterpart to the pure `minutesMotionsForDisplay`.
 *
 * Approved minutes render from the frozen `motionSnapshots[]` (immutable legal
 * record). A draft resolves its ordered `motionIds` → first-class `motions`
 * rows → embedded display shape (`motionRowToEmbedded`). The embedded
 * `minutes.motions[]` is retired (Phase 4) — the table is the single source of
 * truth, so there is no embedded fallback.
 *
 * See docs/motions-migration-finish-scope.md.
 */
export async function resolveMinutesMotions(ctx: PortableQueryCtx, minutes: any): Promise<any[]> {
  if (!minutes) return [];
  // Presence of the array — NOT its length — marks an approved (frozen) minutes.
  // A minutes approved with zero motions freezes an empty [] and must stay empty;
  // treating [] as "no snapshot" would fall through to the live motionIds→rows
  // path and leak any motion added after approval into the immutable record.
  // Matches the freeze guards in updatePortable/applyAdoptionApprovals
  // (`!minutes.motionSnapshots`), which already treat [] as present.
  if (Array.isArray(minutes.motionSnapshots)) {
    return minutes.motionSnapshots;
  }
  const ids: any[] = Array.isArray(minutes.motionIds) ? minutes.motionIds : [];
  const rows = await Promise.all(ids.map((id) =>
    getOwned(ctx, "motions", String(id), String(minutes.societyId))));
  return rows.filter(Boolean).map(motionRowToEmbedded);
}

/** Enrich an imported draft from its linked original sources. Explicit and idempotent:
 * never rewrites adopted content, a previous extraction or an edited section. */
export type SourceMinuteSelection = {documentId:string;selectedText:string;sourceKind?:string;sourceReference?:string};
export type SourceMinutesTransposeArgs = {id:string;sourceSelection?:SourceMinuteSelection[];expectedAgendaItems?:any[]};
/** Used only immediately after a new import creates its agenda in the same
 * atomic transaction; no human edit can intervene in this baseline capture. */
export async function transposeFreshImportedSourcePortable(ctx:PortableMutationCtx,args:{id:string}) {
  const minutes = await requireOwnedRow(ctx,"minutes",args.id);
  const agenda = await ctx.db.query("agendas").withIndex("by_meeting",q=>q.eq("meetingId",minutes.meetingId)).first();
  const expectedAgendaItems = agenda ? await ctx.db.query("agendaItems").withIndex("by_agenda",q=>q.eq("agendaId",agenda._id)).collect() : undefined;
  return transposeSourcePortable(ctx,{...args,expectedAgendaItems});
}

export type CompleteSourceRecordEntry = {
  id: string;
  sourceSelection?: Array<SourceMeetingDocumentInput & {documentId:string}>;
  expectedSections?: any[];
  expectedStructured?: Record<string,any>;
};

/** Add the complete source representation without replacing a recorder's edits. */
export async function completeSourceRecordsPortable(ctx: PortableMutationCtx, {societyId,entries}: {societyId:string;entries:CompleteSourceRecordEntry[]}) {
  await requireSocietyMembership(ctx,societyId);
  await requirePermissionPortable(ctx,societyId,"minutes:write");
  await requirePermissionPortable(ctx,societyId,"documents:read");
  if (entries.length > 150) throw new Error("Complete at most 150 source records in one batch.");
  const prepared:Array<{id:string;record:any}> = [];
  const results:any[] = [];
  // Preflight the entire transaction before writing source representations.
  for (const entry of entries) {
    const minutes = await getOwned(ctx,"minutes",entry.id,societyId);
    if (minutes.approvedAt || minutes.adoptedSnapshot || Array.isArray(minutes.motionSnapshots)) {results.push({id:entry.id,skipped:"adopted"});continue;}
    if (minutes.sourceMeetingRecord?.completionRevision === "source-record-v3") {results.push({id:entry.id,skipped:"already_complete"});continue;}
    const linked = new Set<string>((minutes.sourceDocumentIds ?? []).map(String));
    const selections = new Map((entry.sourceSelection ?? []).map(source=>[source.documentId,source]));
    if ([...selections.keys()].some(id=>!linked.has(id))) throw new Error("A source must already be linked to these minutes.");
    const documents:SourceMeetingDocumentInput[] = [];
    for (const id of linked) {
      const document = await getOwned(ctx,"documents",id,societyId);
      await requireDocumentAccess(ctx,id);
      documents.push({...document,originalUrl:document.url,...selections.get(id),_id:id});
    }
    if (!documents.length) {results.push({id:entry.id,skipped:"no_source"});continue;}
    const meeting = await getOwned(ctx,"meetings",minutes.meetingId,societyId);
    const record = {...buildSourceMeetingRecord({sourceDocuments:documents,minutes:{...minutes,...entry.expectedStructured,sections:entry.expectedSections ?? minutes.sourceMeetingRecord?.sectionBaseline ?? minutes.sections ?? [],motions:entry.expectedStructured?.motions ?? await resolveMinutesMotions(ctx,minutes)},meeting}),completionRevision:"source-record-v3"};
    if (!preflightSourceMeetingRecord(record).passed) throw new Error("Complete source coverage could not be verified; no records were changed.");
    prepared.push({id:entry.id,record});
    results.push({id:entry.id,documents:record.documents.length,blocks:record.documents.reduce((n,doc)=>n+doc.blocks.length,0)});
  }
  for (const entry of prepared) await ctx.db.patch(entry.id,{sourceMeetingRecord:entry.record});
  return results;
}

export async function transposeSourcesPortable(ctx: PortableMutationCtx, {societyId,entries}: {societyId:string;entries:SourceMinutesTransposeArgs[]}) {
  await requireSocietyMembership(ctx,societyId);
  for (const entry of entries) await getOwned(ctx,"minutes",entry.id,societyId);
  if (entries.length > 150) throw new Error("Transpose at most 150 minutes in one batch.");
  const results: any[] = [];
  for (const entry of entries) results.push({id:entry.id,...await transposeSourcePortable(ctx,entry)});
  return results;
}

export async function transposeSourcePortable(ctx: PortableMutationCtx, {id,sourceSelection,expectedAgendaItems}: SourceMinutesTransposeArgs) {
  const minutes = await requireOwnedRow(ctx, "minutes", id);
  if (minutes.approvedAt || minutes.adoptedSnapshot || Array.isArray(minutes.motionSnapshots)) return {skipped:"adopted", sections:minutes.sections?.length ?? 0};
  if (minutes.sourceTransposition) return {skipped:"already_transposed", sections:minutes.sections?.length ?? 0};
  if (hasRecordedMinuteSectionContent(minutes.sections)) return {skipped:"edited_sections", sections:minutes.sections?.length ?? 0};
  const societyId = String(minutes.societyId);
  await requirePermissionPortable(ctx, societyId, "documents:read");
  const selections = new Map((sourceSelection ?? []).map(selection => [String(selection.documentId),selection]));
  if ((sourceSelection ?? []).some(selection => !(minutes.sourceDocumentIds ?? []).map(String).includes(String(selection.documentId)))) throw new Error("A selected source must already be linked to these minutes.");
  if ((sourceSelection ?? []).some(selection => selection.sourceKind && !["recorded_minutes","script","agenda","template"].includes(selection.sourceKind))) throw new Error("Invalid source kind.");
  const sourceDocuments: any[] = [];
  for (const documentId of minutes.sourceDocumentIds ?? []) {
    await getOwned(ctx, "documents", documentId, societyId);
    await requireDocumentAccess(ctx, documentId);
    const selection = selections.get(String(documentId));
    sourceDocuments.push({...await ctx.db.get(documentId),...(selection ? {selectedText:selection.selectedText,sourceKind:selection.sourceKind,sourceReference:selection.sourceReference}: {})});
  }
  const agendas = await ctx.db.query("agendas").withIndex("by_meeting", q => q.eq("meetingId", minutes.meetingId)).collect();
  const agenda = agendas.filter(row => row.societyId === societyId).sort((a,b) => String(a.createdAtISO).localeCompare(String(b.createdAtISO)))[0];
  const agendaItems = agenda ? (await ctx.db.query("agendaItems").withIndex("by_agenda", q => q.eq("agendaId", agenda._id)).collect()).filter(row => row.societyId === societyId).sort((a,b) => a.order-b.order) : [];
  const projection = buildSourceMinuteSections({minutes, agendaItems, sourceDocuments:sourceDocuments.filter(Boolean)});
  const nativeTasks = (await ctx.db.query("tasks").withIndex("by_society",q => q.eq("societyId",societyId)).collect()).filter(task => task.meetingId === minutes.meetingId);
  const nativeMotions = (await ctx.db.query("motions").withIndex("by_minutes",q => q.eq("minutesId",id)).collect()).filter(motion => motion.societyId === societyId);
  const nativeLinks = attachSourceMinuteSectionLinks(projection.sections,{tasks:nativeTasks,motions:nativeMotions});
  projection.sections = nativeLinks.sections;
  if (agenda && expectedAgendaItems) {
    const fields = ["_id","order","title","type","depth","details","presenter","timeAllottedMinutes","motionText","motionId","motionTemplateId","outcome","resolutionId"];
    const comparable = (rows:any[]) => JSON.stringify(rows.slice().sort((a,b)=>a.order-b.order).map(row=>fields.map(field=>row[field] ?? null)));
    if (agenda.status === "Draft" && comparable(agendaItems) === comparable(expectedAgendaItems)) {
      await requirePermissionPortable(ctx,societyId,"agendas:write");
      const keptIds = new Set<string>();
      const now = new Date().toISOString();
      for (let order=0;order<projection.sections.length;order++) {
        const section = projection.sections[order];
        const existing = section.agendaItemId ? agendaItems.find(item=>item._id===section.agendaItemId && !keptIds.has(item._id)) : undefined;
        const fields:any={societyId,agendaId:agenda._id,order,title:section.title,type:section.type ?? "discussion",depth:section.depth ?? 0,createdAtISO:existing?.createdAtISO ?? now};
        for (const key of ["presenter","motionId"] as const) if (section[key] !== undefined) fields[key]=section[key];
        const itemId = existing ? existing._id : await ctx.db.insert("agendaItems",fields);
        if (existing) await ctx.db.replace(existing._id,fields);
        section.agendaItemId=itemId;
        if (section.motionId) await ctx.db.patch(section.motionId,{agendaId:agenda._id,agendaItemId:itemId});
        keptIds.add(itemId);
      }
      // Old imported scaffolds can contain person names mistaken for items. The
      // exact prior agenda is retained in transposition metadata, not discarded.
      for (const item of agendaItems) if (!keptIds.has(item._id)) {
        for (const motion of nativeMotions) if (motion.agendaItemId === item._id && !projection.sections.some(section=>section.motionId === motion._id)) await ctx.db.patch(motion._id,{agendaItemId:undefined});
        await ctx.db.delete(item._id);
      }
      await ctx.db.patch(agenda._id,{updatedAtISO:now,notes:[agenda.notes,"Reconstructed from imported source headings; original agenda retained with source transposition evidence."].filter(Boolean).join("\n\n")});
      projection.sourceTransposition.agendaAlignment="source_baseline_matched";
    } else projection.sourceTransposition.agendaAlignment="preserved_changed_agenda";
  }

  for (const link of nativeLinks.motionLinks) await ctx.db.patch(link.id,{sectionIndex:link.sectionIndex,sectionTitle:link.sectionTitle});
  projection.sourceTransposition.transposedAtISO = new Date().toISOString();
  await ctx.db.patch(id, {...projection, sourceReviewStatus:"imported_needs_review"});
  if (projection.sourceTransposition.sourceKind !== "recorded_minutes") {
    const meeting = await getOwned(ctx,"meetings", minutes.meetingId,societyId);
    const explanation = "Source is an agenda, script or template. Proposed business is not evidence that the meeting was held or motions passed.";
    const notes = String(meeting.sourceReviewNotes ?? "");
    await ctx.db.patch(meeting._id,{status:"Draft",sourceReviewStatus:"imported_needs_review",sourceReviewNotes:notes.includes(explanation) ? notes : [notes,explanation].filter(Boolean).join("\n\n")});
    await ctx.db.patch(id,{quorumMet:false,quorumStatus:"not_recorded"});
    // Keep the native identity, provenance and prior audit history. A source
    // script is a draft wording object, not a motion actually moved in a room.
    const now = new Date().toISOString();
    for (const motion of nativeMotions) {
      const note = `Source classification correction: ${projection.sourceTransposition.sourceKind} wording is proposed business, not an observed motion or vote. Earlier extracted status: ${motion.status}; outcome: ${motion.outcome ?? "not recorded"}.`;
      await ctx.db.patch(motion._id,{status:"Draft",outcome:undefined,adoptsMinutesId:undefined,votesFor:undefined,votesAgainst:undefined,abstentions:undefined,decidedBy:undefined,
        notes:[motion.notes,note].filter(Boolean).join("\n\n"),updatedAtISO:now,
        history:[...(motion.history ?? []),{at:now,meetingId:minutes.meetingId,minutesId:id,status:"Draft",note}]});
    }
  }
  const sourceMeetingRecord = buildSourceMeetingRecord({sourceDocuments,minutes:{...minutes,...projection,motions:await resolveMinutesMotions(ctx,{...minutes,...projection})}});
  await ctx.db.patch(id,{sourceMeetingRecord});
  return {sections:projection.sections.length,sourceKind:projection.sourceTransposition.sourceKind};
}

// ----- mutations ------------------------------------------------------------

export async function createPortable(ctx: PortableMutationCtx, args: any) {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.sourceReviewedByUserId) {
    await getOwned(ctx, "users", args.sourceReviewedByUserId, args.societyId);
  }
  await assertMinutesForeignKeys(ctx, args.societyId, args);
  await assertMotionPersonLinksBelongToSociety(ctx, args.societyId, args.motions);
  const meeting = await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  const snapshot = meeting
    ? await quorumSnapshotForMeeting(ctx, meeting, args.quorumRequired)
    : null;
  // The motions table is the single source of truth; the minutes row no longer
  // stores the embedded motions[] (syncMotionsForMinutes materializes the rows +
  // maintains motionIds below). See Phase 4C.
  const { motions: _motions, ...minutesFields } = args;
  const id = await ctx.db.insert("minutes", {
    ...minutesFields,
    sourceReviewedByUserId: args.sourceReviewedByUserId
      ? await principalUserId(ctx, args.societyId)
      : undefined,
    ...minutesSnapshotFields(args, snapshot),
  });
  await ctx.db.patch(args.meetingId, { minutesId: id });
  await syncMotionsForMinutes(ctx, {
    societyId: args.societyId,
    minutesId: id,
    meetingId: args.meetingId,
    motions: args.motions,
  });
  return id;
}

function isCarriedOutcome(outcome: unknown) {
  return String(outcome ?? "").trim().toLowerCase() === "carried";
}

/** When an adoption motion (adoptsMinutesId) newly carries, stamp the
 *  referenced minutes approved: approvedAt = the adopting meeting's date,
 *  approvedInMeetingId = the adopting meeting. Idempotent and conservative —
 *  already-approved targets, cross-society references, and motions that were
 *  already carried before this save are all left untouched. Never *clears*
 *  an approval: flipping the motion back off Carried is ambiguous (was the
 *  approval also recorded manually?), so undoing is left to the explicit
 *  "Clear approval" action. */
async function adoptionApprovalTargets(
  ctx: PortableMutationCtx,
  minutes: any,
  nextMotions: any[],
) {
  const before: any[] = await resolveMinutesMotions(ctx, minutes);
  const previouslyCarried = new Set(
    before
      .filter((motion) => motion?.adoptsMinutesId && isCarriedOutcome(motion.outcome))
      .map((motion) => String(motion.adoptsMinutesId)),
  );
  const stamped = new Set<string>();
  const targets: any[] = [];
  for (const motion of nextMotions) {
    const targetId = motion?.adoptsMinutesId;
    if (!targetId || !isCarriedOutcome(motion.outcome)) continue;
    const key = String(targetId);
    if (previouslyCarried.has(key) || stamped.has(key)) continue;
    if (key === String(minutes._id)) continue;
    const target = await getOwned(ctx, "minutes", targetId, String(minutes.societyId));
    if (target.approvedAt) continue;
    targets.push(target);
    stamped.add(key);
  }
  return targets;
}

async function applyAdoptionApprovals(
  ctx: PortableMutationCtx,
  minutes: any,
  targets: any[],
) {
  for (const target of targets) {
    const now = new Date().toISOString();
    const targetPatch: Record<string, unknown> = {
      approvedAt: minutes.heldAt || now,
      approvedInMeetingId: minutes.meetingId,
    };
    // Mirror the snapshot-on-approval freeze from updatePortable — this patch
    // bypasses that path, and the approved record must be frozen either way.
    if (!target.motionSnapshots) {
      targetPatch.motionSnapshots = await resolveMinutesMotions(ctx, target);
      targetPatch.motionSnapshotAtISO = now;
      targetPatch.adoptedSnapshot = await minutesSnapshot(ctx, { ...target, ...targetPatch }, targetPatch.motionSnapshots as any[]);
      targetPatch.adoptedRevision = target.adoptedRevision || 1;
    }
    await ctx.db.patch(target._id, targetPatch);
    const targetMeeting = target.meetingId
      ? await getOwned(ctx, "meetings", target.meetingId, String(minutes.societyId))
      : null;
    await ctx.db.insert("activity", {
      societyId: minutes.societyId,
      actor: "You",
      entityType: "minutes",
      subjectId: String(target._id),
      // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
      entityId: String(target._id),
      action: "approved",
      summary: `Marked minutes${targetMeeting ? ` of ${targetMeeting.title}` : ""} approved — adoption motion carried`,
      createdAtISO: now,
    });
  }
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { id, patch: rawPatch }: { id: string; patch: any },
) {
  const minutes = await requireOwnedRow(ctx, "minutes", id);
  if (Object.prototype.hasOwnProperty.call(rawPatch,"sourceMeetingRecord")) throw new Error("Source records are managed through cited source completion.");
  if (["adoptedSnapshot", "adoptedRevision", "adoptionHistory", "motionSnapshots", "motionSnapshotAtISO"].some(key => Object.prototype.hasOwnProperty.call(rawPatch, key))) throw new Error("Adopted snapshots are managed by approval and amendment operations.");
  const approvalMetadata = new Set(["clearApproval", "clearApprovedInMeeting", "approvedAt", "approvedInMeetingId", "motions"]);
  if (minutes.approvedAt && !rawPatch.clearApproval && Object.keys(rawPatch).some(key => !approvalMetadata.has(key))) throw new Error("Adopted minutes are frozen. Start an amendment to change recorded content.");
  const societyId = String(minutes.societyId);
  await assertMinutesForeignKeys(ctx, societyId, rawPatch);
  const adoptionTargets = Array.isArray(rawPatch.motions)
    ? await adoptionApprovalTargets(ctx, minutes, rawPatch.motions) : [];
  // Approval authority is separate from drafting. Check every approval change
  // before writing either this record or a carried adoption target. Unchanged
  // carried motions remain editable by a drafter without a fresh approval.
  if (["approvedAt", "approvedInMeetingId", "clearApproval", "clearApprovedInMeeting"].some(field => Object.prototype.hasOwnProperty.call(rawPatch, field)) || adoptionTargets.length) {
    await requirePermissionPortable(ctx, societyId, "minutes:approve");
  }
  // `undefined` fields are stripped from the wire, so unsetting approval
  // arrives as explicit clear flags (mirrors meetings.clearNoticeSent).
  const { clearApproval, clearApprovedInMeeting, motions: submittedMotions, ...patch } = rawPatch;
  if (patch.sourceReviewedByUserId) {
    patch.sourceReviewedByUserId = await principalUserId(ctx, societyId);
  }
  if (clearApproval) {
    patch.approvedAt = undefined;
    patch.approvedInMeetingId = undefined;
    // Un-approving reverts the minutes to an editable draft, so drop the frozen
    // motion snapshot too. Otherwise resolveMinutesMotions keeps serving the
    // stale approved set (snapshots take precedence over the live table): later
    // motion edits wouldn't show, and a re-approval couldn't re-freeze (the
    // snapshot-on-approval guard below skips when a snapshot already exists).
    // Invariant: motionSnapshots exists iff the minutes are approved.
    patch.motionSnapshots = undefined;
    patch.motionSnapshotAtISO = undefined;
    if (minutes.adoptedSnapshot) {
      patch.adoptionHistory = [...(minutes.adoptionHistory ?? []), { revision: minutes.adoptedRevision ?? 1, snapshot: minutes.adoptedSnapshot, supersededAtISO: new Date().toISOString(), amendedByUserId: await principalUserId(ctx, societyId) }];
    }
    patch.adoptedSnapshot = undefined;
    patch.adoptedRevision = (minutes.adoptedRevision ?? 0) + 1;
  } else if (clearApprovedInMeeting) {
    patch.approvedInMeetingId = undefined;
  }
  if (submittedMotions) {
    await assertMotionPersonLinksBelongToSociety(ctx, String(minutes.societyId), submittedMotions);
  }
  // `motions` is NOT written back to the minutes row (Phase 4C) — it flows only
  // to syncMotionsForMinutes below, which materializes the table + motionIds.
  const willApprove = !!patch.approvedAt && !minutes.approvedAt;
  const frozenForApproval = willApprove ? submittedMotions ?? (await resolveMinutesMotions(ctx, minutes)) : null;
  const adoptedForApproval = willApprove ? await minutesSnapshot(ctx, { ...minutes, ...patch }, frozenForApproval!) : null;
  await ctx.db.patch(id, patch);

  // Snapshot-on-approval: the first time minutes become approved, freeze the
  // motion set so later edits to live motions never rewrite the approved legal
  // record. Skipped if a snapshot already exists (idempotent).
  const newlyApproved = !!patch.approvedAt && !minutes.approvedAt;
  if (newlyApproved && !minutes.motionSnapshots) {
    // Freeze the approved motion set from the single source of truth: the motions
    // submitted with this save, else whatever the table currently resolves to.
    const frozen = submittedMotions ?? (await resolveMinutesMotions(ctx, minutes));
    await ctx.db.patch(id, {
      motionSnapshots: frozen,
      adoptedSnapshot: adoptedForApproval,
      adoptedRevision: minutes.adoptedRevision || 1,
      motionSnapshotAtISO: new Date().toISOString(),
    });
  }

  // Adoption carry-through: when an "adopt previous minutes" motion
  // (adoptsMinutesId) newly records as Carried, stamp the referenced minutes
  // approved — the step people forget after the vote in the room.
  if (Array.isArray(submittedMotions)) {
    await applyAdoptionApprovals(ctx, minutes, adoptionTargets);
  }

  // Materialize the table + motionIds when motions were part of this save.
  if (submittedMotions) {
    await syncMotionsForMinutes(ctx, {
      societyId: minutes.societyId,
      minutesId: id,
      meetingId: minutes.meetingId,
      motions: submittedMotions,
    });
  }
}

// Upsert a minutes row from an AI-generated draft (transcripts.runPipeline).
export async function upsertFromDraftPortable(ctx: PortableMutationCtx, args: any) {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.sourceReviewedByUserId) {
    await getOwned(ctx, "users", args.sourceReviewedByUserId, args.societyId);
  }
  await assertMinutesForeignKeys(ctx, args.societyId, args);
  await assertMotionPersonLinksBelongToSociety(ctx, args.societyId, args.motions);
  const meeting = await getOwned(ctx, "meetings", args.meetingId, args.societyId);
  const snapshot = meeting
    ? await quorumSnapshotForMeeting(ctx, meeting, args.quorumRequired)
    : null;
  const quorumRequired = args.quorumRequired ?? snapshot?.quorumRequired;
  // Motions are materialized into the table by syncMotionsForMinutes below, not
  // stored on the minutes row (Phase 4C).
  const { motions: _motions, ...argsFields } = args;
  const payload = {
    ...argsFields,
    sourceReviewedByUserId: args.sourceReviewedByUserId
      ? await principalUserId(ctx, args.societyId)
      : undefined,
    ...minutesSnapshotFields(args, snapshot),
    quorumMet:
      args.quorumStatus
        ? args.quorumStatus === "confirmed"
        : quorumRequired == null
        ? args.quorumMet
        : args.attendees.length >= quorumRequired,
  };
  const existing = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
    .collect();
  if (existing[0]) {
    if (existing[0].approvedAt || existing[0].adoptedSnapshot || Array.isArray(existing[0].motionSnapshots)) throw new Error("Adopted minutes are frozen. Start an amendment before importing a draft.");
    if (hasRecordedMinuteSectionContent(existing[0].sections)) throw new Error("Existing minute sections contain recorded content. Review the new draft separately before replacing them.");
    await ctx.db.patch(existing[0]._id, payload);
    await syncMotionsForMinutes(ctx, {
      societyId: args.societyId,
      minutesId: existing[0]._id,
      meetingId: args.meetingId,
      motions: args.motions,
    });
    return existing[0]._id;
  }
  const id = await ctx.db.insert("minutes", payload);
  await ctx.db.patch(args.meetingId, { minutesId: id });
  await syncMotionsForMinutes(ctx, {
    societyId: args.societyId,
    minutesId: id,
    meetingId: args.meetingId,
    motions: args.motions,
  });
  return id;
}

export async function backfillMotionPersonLinksPortable(
  ctx: PortableMutationCtx,
  { societyId }: { societyId: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const [rows, members, directors] = await Promise.all([
    ctx.db
      .query("minutes")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("directors")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
  ]);

  let minutesUpdated = 0;
  let motionRowsUpdated = 0;
  const linkedNames: Record<string, string> = {};
  const unresolvedNames: Record<string, number> = {};

  for (const row of rows) {
    let changed = false;
    const motions = row.motions.map((motion: any) => {
      const movedBy = resolveMotionPersonLink(motion.movedBy, members, directors);
      const secondedBy = resolveMotionPersonLink(motion.secondedBy, members, directors);
      const next = { ...motion };

      if (movedBy.label || !motion.movedBy) {
        next.movedByMemberId = movedBy.memberId;
        next.movedByDirectorId = movedBy.directorId;
      }
      if (secondedBy.label || !motion.secondedBy) {
        next.secondedByMemberId = secondedBy.memberId;
        next.secondedByDirectorId = secondedBy.directorId;
      }

      if (motion.movedBy) {
        if (movedBy.label) linkedNames[motion.movedBy] = movedBy.label;
        else unresolvedNames[motion.movedBy] = (unresolvedNames[motion.movedBy] ?? 0) + 1;
      }
      if (motion.secondedBy) {
        if (secondedBy.label) linkedNames[motion.secondedBy] = secondedBy.label;
        else unresolvedNames[motion.secondedBy] = (unresolvedNames[motion.secondedBy] ?? 0) + 1;
      }

      if (
        next.movedByMemberId !== motion.movedByMemberId ||
        next.movedByDirectorId !== motion.movedByDirectorId ||
        next.secondedByMemberId !== motion.secondedByMemberId ||
        next.secondedByDirectorId !== motion.secondedByDirectorId
      ) {
        changed = true;
        motionRowsUpdated += 1;
      }
      return next;
    });

    if (changed) {
      await ctx.db.patch(row._id, { motions });
      minutesUpdated += 1;
    }
  }

  return { minutesScanned: rows.length, minutesUpdated, motionRowsUpdated, linkedNames, unresolvedNames };
}

export async function backfillQuorumSnapshotPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const minutes = await requireOwnedRow(ctx, "minutes", id);
  const societyId = String(minutes.societyId);
  const meeting = await getOwned(ctx, "meetings", minutes.meetingId, societyId);
  const snapshot = await quorumSnapshotForMeeting(
    ctx,
    meeting,
    minutes.quorumRequired ?? meeting.quorumRequired,
  );
  const patch: any = {};
  if (minutes.quorumRequired == null && snapshot.quorumRequired != null) {
    patch.quorumRequired = snapshot.quorumRequired;
  }
  if (!minutes.bylawRuleSetId && snapshot.bylawRuleSetId) {
    patch.bylawRuleSetId = snapshot.bylawRuleSetId;
  }
  if (minutes.quorumRuleVersion == null && snapshot.quorumRuleVersion != null) {
    patch.quorumRuleVersion = snapshot.quorumRuleVersion;
  }
  if (!minutes.quorumRuleEffectiveFromISO && snapshot.quorumRuleEffectiveFromISO) {
    patch.quorumRuleEffectiveFromISO = snapshot.quorumRuleEffectiveFromISO;
  }
  if (!minutes.quorumSourceLabel) {
    patch.quorumSourceLabel = snapshot.quorumSourceLabel;
  }
  if (!minutes.quorumComputedAtISO) {
    patch.quorumComputedAtISO = snapshot.quorumComputedAtISO;
  }
  if (Object.keys(patch).length > 0) {
    await ctx.db.patch(id, patch);
  }
  return { patched: Object.keys(patch) };
}

// ----- helpers --------------------------------------------------------------

async function quorumSnapshotForMeeting(
  ctx: PortableMutationCtx,
  meeting: Record<string, any>,
  quorumRequiredOverride?: number,
) {
  return await buildQuorumSnapshot(ctx, {
    societyId: meeting.societyId,
    meetingDateISO: meeting.scheduledAt,
    meetingType: meeting.type,
    quorumRequiredOverride,
  });
}

function minutesSnapshotFields(
  args: {
    quorumRequired?: number;
    bylawRuleSetId?: any;
    quorumRuleVersion?: number;
    quorumRuleEffectiveFromISO?: string;
    quorumSourceLabel?: string;
    quorumComputedAtISO?: string;
  },
  snapshot: QuorumSnapshot | null,
) {
  return {
    quorumRequired: args.quorumRequired ?? snapshot?.quorumRequired,
    bylawRuleSetId: args.bylawRuleSetId ?? snapshot?.bylawRuleSetId,
    quorumRuleVersion: args.quorumRuleVersion ?? snapshot?.quorumRuleVersion,
    quorumRuleEffectiveFromISO:
      args.quorumRuleEffectiveFromISO ??
      snapshot?.quorumRuleEffectiveFromISO,
    quorumSourceLabel: args.quorumSourceLabel ?? snapshot?.quorumSourceLabel,
    quorumComputedAtISO: args.quorumComputedAtISO ?? snapshot?.quorumComputedAtISO,
  };
}

async function assertMotionPersonLinksBelongToSociety(ctx: PortableMutationCtx, societyId: string, motions: any[]) {
  for (const motion of motions) {
    await assertPersonLinkBelongsToSociety(ctx, societyId, "members", motion.movedByMemberId, "movedByMemberId");
    await assertPersonLinkBelongsToSociety(ctx, societyId, "directors", motion.movedByDirectorId, "movedByDirectorId");
    await assertPersonLinkBelongsToSociety(ctx, societyId, "members", motion.secondedByMemberId, "secondedByMemberId");
    await assertPersonLinkBelongsToSociety(ctx, societyId, "directors", motion.secondedByDirectorId, "secondedByDirectorId");
  }
}

type MinutesForeignKeyFields = {
  meetingId?: string;
  bylawRuleSetId?: string;
  approvedInMeetingId?: string;
  sourceDocumentIds?: string[];
  sections?: Array<{
    agendaItemId?: string;
    motionTemplateId?: string;
    motionId?: string;
    linkedTaskIds?: string[];
  }>;
  motions?: Array<{
    motionTemplateId?: string;
    motionId?: string;
    adoptsMinutesId?: string;
  }>;
};

async function assertMinutesForeignKeys(
  ctx: PortableMutationCtx,
  societyId: string,
  fields: MinutesForeignKeyFields,
) {
  await Promise.all([
    fields.meetingId ? getOwned(ctx, "meetings", fields.meetingId, societyId) : Promise.resolve(),
    fields.bylawRuleSetId ? getOwned(ctx, "bylawRuleSets", fields.bylawRuleSetId, societyId) : Promise.resolve(),
    fields.approvedInMeetingId
      ? getOwned(ctx, "meetings", fields.approvedInMeetingId, societyId)
      : Promise.resolve(),
    ...(fields.sourceDocumentIds ?? []).map((id: string) =>
      getOwned(ctx, "documents", id, societyId)),
    ...(fields.sections ?? []).flatMap((section) => [
      section.agendaItemId ? getOwned(ctx,"agendaItems",section.agendaItemId,societyId) : Promise.resolve(),
      section.motionTemplateId
        ? getOwned(ctx, "motionTemplates", section.motionTemplateId, societyId)
        : Promise.resolve(),
      section.motionId ? getOwned(ctx, "motions", section.motionId, societyId) : Promise.resolve(),
      ...(section.linkedTaskIds ?? []).map((id: string) =>
        getOwned(ctx, "tasks", id, societyId)),
    ]),
    ...(fields.motions ?? []).flatMap((motion) => [
      motion.motionTemplateId
        ? getOwned(ctx, "motionTemplates", motion.motionTemplateId, societyId)
        : Promise.resolve(),
      motion.motionId ? getOwned(ctx, "motions", motion.motionId, societyId) : Promise.resolve(),
      motion.adoptsMinutesId
        ? getOwned(ctx, "minutes", motion.adoptsMinutesId, societyId)
        : Promise.resolve(),
    ]),
  ]);
}

async function assertPersonLinkBelongsToSociety(
  ctx: PortableMutationCtx,
  societyId: string,
  table: "members" | "directors",
  id: string | undefined,
  fieldName: string,
) {
  if (!id) return;
  await getOwned(ctx, table, id, societyId);
}

function resolveMotionPersonLink(
  value: unknown,
  members: any[],
  directors: any[],
): { memberId?: string; directorId?: string; label?: string } {
  const key = normalizePersonLookupName(value);
  if (!key) return {};
  const memberMatches = members.filter((member) => personLookupKeys(member).includes(key));
  const directorMatches = directors.filter((director) => personLookupKeys(director).includes(key));
  const matches = [
    ...memberMatches.map((member) => ({
      memberId: member._id,
      label: `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim(),
    })),
    ...directorMatches.map((director) => ({
      directorId: director._id,
      label: `${director.firstName ?? ""} ${director.lastName ?? ""}`.trim(),
    })),
  ];
  return matches.length === 1 ? matches[0] : {};
}

function personLookupKeys(row: any) {
  return unique([
    `${row?.firstName ?? ""} ${row?.lastName ?? ""}`,
    `${row?.lastName ?? ""}, ${row?.firstName ?? ""}`,
    row?.name,
    ...(Array.isArray(row?.aliases) ? row.aliases : []),
  ]).map(normalizePersonLookupName).filter(Boolean);
}

function normalizePersonLookupName(value: unknown) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  const withoutFormer = text.replace(/\([^)]*\)/g, " ");
  const commaMatch = withoutFormer.match(/^\s*([^,]+),\s*(.+?)\s*$/);
  const name = commaMatch ? `${commaMatch[2]} ${commaMatch[1]}` : withoutFormer;
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
