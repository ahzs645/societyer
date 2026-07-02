/**
 * PORTABLE FUNCTIONS: the meetings domain
 * (list / get / create / applyTemplate / update / markSourceReview /
 *  setPackageReviewStatus / remove).
 *
 * Reads/writes the `meetings`, `agendas`, `agendaItems`, `minutes`,
 * `meetingTemplates`, `motionTemplates`, `bylawRuleSets`, `members`,
 * `directors`, and `activity` tables over `ctx.db`. Each handler runs unchanged
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 *
 * The bylaw-rule / quorum helpers are inlined portable copies of the pure
 * `ctx.db` helpers from `convex/lib/bylawRules.ts` (which import `_generated`).
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

/* ----------------------- Inlined bylaw / quorum helpers ----------------------- */

type ResolvedBylawRuleSet = Record<string, any> & { isFallback?: boolean };

type QuorumSnapshot = {
  bylawRuleSetId?: string;
  quorumRuleVersion?: number;
  quorumRuleEffectiveFromISO?: string;
  quorumSourceLabel: string;
  quorumRequired?: number;
  quorumComputedAtISO: string;
};

const DEFAULT_BYLAW_RULES: Record<string, any> = {
  societyId: "placeholder",
  version: 1,
  status: "Active",
  generalNoticeMinDays: 14,
  generalNoticeMaxDays: 60,
  allowElectronicMeetings: true,
  allowHybridMeetings: true,
  allowElectronicVoting: false,
  allowProxyVoting: false,
  proxyHolderMustBeMember: false,
  proxyLimitPerGrantorPerMeeting: 1,
  quorumType: "percentage",
  quorumValue: 10,
  quorumMinimumCount: 3,
  memberProposalThresholdPct: 5,
  memberProposalMinSignatures: 1,
  memberProposalLeadDays: 7,
  requisitionMeetingThresholdPct: 10,
  annualReportDueDaysAfterMeeting: 30,
  requireAgmFinancialStatements: true,
  requireAgmElections: true,
  ballotIsAnonymous: true,
  voterMustBeMemberAtRecordDate: true,
  inspectionMemberRegisterByMembers: true,
  inspectionMemberRegisterByPublic: false,
  inspectionDirectorRegisterByMembers: true,
  inspectionCopiesAllowed: true,
  ordinaryResolutionThresholdPct: 50,
  specialResolutionThresholdPct: 66.67,
  unanimousWrittenSpecialResolution: true,
  updatedAtISO: new Date(0).toISOString(),
};

function getDefaultBylawRules(societyId: string): Record<string, any> {
  return {
    ...DEFAULT_BYLAW_RULES,
    societyId,
    updatedAtISO: new Date().toISOString(),
  };
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
  if (selected) return selected;
  return {
    ...getDefaultBylawRules(societyId),
    isFallback: true,
  };
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
    return `${prefix}BC Model Bylaw baseline assumptions`;
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

/* ------------------------------ Template helpers ------------------------------ */

type TemplateItem = {
  title: string;
  depth: 0 | 1;
  sectionType?: string;
  presenter?: string;
  details?: string;
  motionTemplateId?: any;
  motionText?: string;
  adoptsPreviousMinutes?: boolean;
};

/** Governance grouping for "previous meeting" resolution: a board meeting
 *  adopts the previous BOARD meeting's minutes, and general meetings (AGM/SGM)
 *  adopt the previous GENERAL meeting's minutes — not just whatever meeting
 *  happened most recently. */
export function meetingTypeCategory(type: string | undefined | null): string {
  const value = String(type ?? "").trim().toLowerCase();
  if (value === "agm" || value === "sgm") return "general";
  return value || "other";
}

/** The meeting whose minutes a new meeting of `meetingType` would adopt: the
 *  most recent prior non-cancelled meeting, preferring the same type category
 *  and falling back to any prior meeting when the society has no history in
 *  that category yet. Exported for unit testing. */
export function pickPreviousMeeting(
  meetings: Array<{ scheduledAt?: string; status?: string; type?: string }>,
  scheduledAt: string,
  meetingType?: string,
) {
  const scheduledTs = new Date(scheduledAt).getTime();
  // Compare as timestamps, not strings — stored values mix naive local
  // ("2026-07-15T19:00") and UTC ("...Z") formats, which don't sort together.
  const candidates = meetings
    .filter((meeting) => {
      if (meeting.status === "Cancelled" || !meeting.scheduledAt) return false;
      const ts = new Date(meeting.scheduledAt).getTime();
      return Number.isFinite(ts) && Number.isFinite(scheduledTs) && ts < scheduledTs;
    })
    .sort((a, b) => new Date(b.scheduledAt!).getTime() - new Date(a.scheduledAt!).getTime());
  const category = meetingTypeCategory(meetingType);
  return candidates.find((meeting) => meetingTypeCategory(meeting.type) === category) ?? candidates[0];
}

/** Whether a template/agenda item is the "adopt the previous meeting's
 *  minutes" motion. Explicit flag wins; legacy items are detected from their
 *  wording (placeholder tokens or adopt/approve + previous + minutes). */
export function isPreviousMinutesAdoptionItem(item: {
  adoptsPreviousMinutes?: boolean;
  motionText?: string;
  title?: string;
}): boolean {
  if (item?.adoptsPreviousMinutes === true) return true;
  const text = `${item?.title ?? ""} ${item?.motionText ?? ""}`.toLowerCase();
  if (!text.includes("minute")) return false;
  if (text.includes("{{previousmeetingtitle}}") || text.includes("{{previousmeetingdate}}")) return true;
  const referencesPrevious =
    text.includes("previous") || text.includes("prior meeting") || text.includes("last meeting") || text.includes("last agm");
  const adopts = text.includes("adopt") || text.includes("approv");
  return referencesPrevious && adopts;
}

function normalizeTemplateItems(items: any[]): TemplateItem[] {
  const normalized: TemplateItem[] = [];
  let hasRoot = false;
  for (const item of items ?? []) {
    const title = String(item?.title ?? "").trim();
    if (!title) continue;
    const depth: 0 | 1 = item?.depth === 1 && hasRoot ? 1 : 0;
    normalized.push({
      title,
      depth,
      sectionType: item?.sectionType || undefined,
      presenter: item?.presenter || undefined,
      details: item?.details || undefined,
      motionTemplateId: item?.motionTemplateId,
      motionText: item?.motionText || undefined,
      adoptsPreviousMinutes: item?.adoptsPreviousMinutes === true || undefined,
    });
    if (depth === 0) hasRoot = true;
  }
  return normalized;
}

function normalizeAgendaJsonItems(agendaJson?: string) {
  if (!agendaJson) return [];
  try {
    const parsed = JSON.parse(agendaJson);
    const values = Array.isArray(parsed) ? parsed : [];
    const items: Array<{ title: string; depth: 0 | 1; type?: string; details?: string; presenter?: string; motionTemplateId?: any; motionText?: string; adoptsMinutesId?: string }> = [];
    let hasRoot = false;
    for (const value of values) {
      const title = typeof value === "string" ? value.trim() : String(value?.title ?? "").trim();
      if (!title) continue;
      const depth: 0 | 1 = typeof value === "object" && value?.depth === 1 && hasRoot ? 1 : 0;
      items.push({
        title,
        depth,
        type: typeof value === "object" ? value?.type ?? value?.sectionType : undefined,
        details: typeof value === "object" ? value?.details : undefined,
        presenter: typeof value === "object" ? value?.presenter : undefined,
        motionTemplateId: typeof value === "object" ? value?.motionTemplateId : undefined,
        motionText: typeof value === "object" ? value?.motionText : undefined,
        // Not stored on the agendaItems row — consumed when seeding the
        // adoption motion into minutes.motions below.
        adoptsMinutesId: typeof value === "object" ? value?.adoptsMinutesId : undefined,
      });
      if (depth === 0) hasRoot = true;
    }
    return items;
  } catch {
    return [];
  }
}

async function buildTemplateMotions(
  ctx: any,
  items: TemplateItem[],
  templateContext: Record<string, string>,
  previousMinutesId?: string,
) {
  const motions: any[] = [];
  const now = new Date().toISOString();
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    let text = item.motionText;
    let resolutionType = "Ordinary";
    if (item.motionTemplateId) {
      const template = await ctx.db.get(item.motionTemplateId);
      if (template) {
        text = text || template.body;
        resolutionType = template.requiresSpecialResolution ? "Special" : "Ordinary";
        await ctx.db.patch(template._id, {
          usageCount: (template.usageCount ?? 0) + 1,
          updatedAtISO: now,
        });
      }
    }
    text = resolveTemplateText(text, templateContext);
    if (!text?.trim()) continue;
    const motion: any = {
      text: text.trim(),
      outcome: "Pending",
      resolutionType,
      sectionIndex: index,
      sectionTitle: item.title,
    };
    // The "adopt previous minutes" item resolves to a live reference to the
    // actual minutes record being adopted; carrying the motion later stamps
    // that record's approval automatically.
    if (previousMinutesId && isPreviousMinutesAdoptionItem(item)) {
      motion.adoptsMinutesId = previousMinutesId;
    }
    motions.push(motion);
  }
  return motions;
}

type TemplateContextResult = {
  context: Record<string, string>;
  /** The minutes record an "adopt previous minutes" motion should link to. */
  previousMinutesId?: string;
};

async function buildTemplateContext(
  ctx: any,
  societyId: any,
  scheduledAt: string,
  meetingType?: string,
): Promise<TemplateContextResult> {
  const meetings = await ctx.db
    .query("meetings")
    .withIndex("by_society_date", (q: any) => q.eq("societyId", societyId))
    .order("desc")
    .collect();
  const previous = pickPreviousMeeting(meetings, scheduledAt, meetingType);
  let previousMinutesId: string | undefined;
  if (previous) {
    const rows = await ctx.db
      .query("minutes")
      .withIndex("by_meeting", (q: any) => q.eq("meetingId", (previous as any)._id))
      .collect();
    previousMinutesId = rows[0]?._id ? String(rows[0]._id) : undefined;
  }
  return {
    context: {
      previousMeetingTitle: (previous as any)?.title ?? "previous meeting",
      previousMeetingDate: previous?.scheduledAt ? formatLongDate(previous.scheduledAt) : "the previous meeting date",
      calledToOrderTime: "[time]",
      adjournedAt: "[time]",
    },
    previousMinutesId,
  };
}

function resolveTemplateText(value: string | undefined, context: Record<string, string>) {
  if (!value) return "";
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => context[key] ?? "");
}

function formatLongDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Vancouver",
  });
}

function inferAgendaSectionType(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("motion") || lower.includes("adopt") || lower.includes("approve") || lower.includes("adjourn")) return "motion";
  if (lower.includes("report") || lower.includes("financial statement")) return "report";
  if (lower.includes("decision") || lower.includes("resolution")) return "decision";
  return "discussion";
}

/* --------------------------------- Handlers --------------------------------- */

export async function listPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  return ctx.db
    .query("meetings")
    .withIndex("by_society_date", (q) => q.eq("societyId", societyId))
    .order("desc")
    .collect();
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    type: string;
    title: string;
    scheduledAt: string;
    location?: string;
    electronic: boolean;
    remoteUrl?: string;
    remoteMeetingId?: string;
    remotePasscode?: string;
    remoteInstructions?: string;
    quorumRequired?: number;
    bylawRuleSetId?: string;
    quorumRuleVersion?: number;
    quorumRuleEffectiveFromISO?: string;
    quorumSourceLabel?: string;
    quorumComputedAtISO?: string;
    status: string;
    attendeeIds: string[];
    agendaJson?: string;
    meetingTemplateId?: string;
    sourceReviewStatus?: string;
    sourceReviewNotes?: string;
    sourceReviewedAtISO?: string;
    sourceReviewedByUserId?: string;
    packageReviewStatus?: string;
    packageReviewNotes?: string;
    packageReviewedAtISO?: string;
    packageReviewedByUserId?: string;
    notes?: string;
  },
) {
  const rules = await getBylawRuleSetForDate(
    ctx,
    args.societyId,
    args.scheduledAt,
  );
  if (args.electronic && !rules.allowElectronicMeetings) {
    throw new Error(
      "Electronic participation is disabled by the bylaw rule set effective for this meeting date.",
    );
  }

  const snapshot = await buildQuorumSnapshot(ctx, {
    societyId: args.societyId,
    meetingDateISO: args.scheduledAt,
    meetingType: args.type,
    quorumRequiredOverride: args.quorumRequired,
  });

  const template = args.meetingTemplateId
    ? await ctx.db.get(args.meetingTemplateId)
    : null;
  if (args.meetingTemplateId && !template) {
    throw new Error("Meeting template not found.");
  }
  if (template && template.societyId !== args.societyId) {
    throw new Error("Meeting template belongs to a different society.");
  }
  const templateItems = template ? normalizeTemplateItems(template.items) : [];
  // Resolved even without a template: the agendaJson path ("Schedule next
  // meeting") can also seed an adoption motion, and both need the previous
  // same-category meeting's minutes id.
  const { context: templateContext, previousMinutesId } = await buildTemplateContext(
    ctx,
    args.societyId,
    args.scheduledAt,
    args.type,
  );
  const templateMotions = template
    ? await buildTemplateMotions(ctx, templateItems, templateContext, previousMinutesId)
    : [];
  const templateSnapshotJson = template
    ? JSON.stringify({
        templateId: template._id,
        name: template.name,
        description: template.description,
        meetingType: template.meetingType,
        items: templateItems,
        capturedAtISO: new Date().toISOString(),
      })
    : undefined;

  const { agendaJson: _agendaJsonInput, ...meetingArgs } = args;
  const meetingId = await ctx.db.insert("meetings", {
    ...meetingArgs,
    templateSnapshotJson,
    bylawRuleSetId: args.bylawRuleSetId ?? snapshot.bylawRuleSetId,
    quorumRuleVersion: args.quorumRuleVersion ?? snapshot.quorumRuleVersion,
    quorumRuleEffectiveFromISO:
      args.quorumRuleEffectiveFromISO ??
      snapshot.quorumRuleEffectiveFromISO,
    quorumSourceLabel: args.quorumSourceLabel ?? snapshot.quorumSourceLabel,
    quorumRequired: args.quorumRequired ?? snapshot.quorumRequired,
    quorumComputedAtISO:
      args.quorumComputedAtISO ?? snapshot.quorumComputedAtISO,
  });
  const agendaJsonItems = !templateItems.length ? normalizeAgendaJsonItems(args.agendaJson) : [];
  if (templateItems.length > 0 || args.agendaJson) {
    const agendaId = await ctx.db.insert("agendas", {
      societyId: args.societyId,
      meetingId,
      title: `${args.title} agenda`,
      status: "Draft",
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    });
    const initialAgendaItems = templateItems.length
      ? templateItems.map((item) => ({
          title: resolveTemplateText(item.title, templateContext),
          depth: item.depth,
          type: item.sectionType ?? inferAgendaSectionType(item.title),
          details: item.details ? resolveTemplateText(item.details, templateContext) : undefined,
          presenter: item.presenter || undefined,
          motionTemplateId: item.motionTemplateId,
          motionText: item.motionText ? resolveTemplateText(item.motionText, templateContext) : undefined,
        }))
      : agendaJsonItems;
    for (let order = 0; order < initialAgendaItems.length; order++) {
      const item = initialAgendaItems[order];
      await ctx.db.insert("agendaItems", {
        societyId: args.societyId,
        agendaId,
        order,
        type: item.type ?? inferAgendaSectionType(item.title),
        title: item.title,
        depth: item.depth,
        details: item.details,
        presenter: item.presenter,
        motionTemplateId: item.motionTemplateId,
        motionText: item.motionText,
        createdAtISO: new Date().toISOString(),
      });
    }
  }
  // agendaJson items carrying motion text (e.g. the adoption-of-minutes item
  // seeded by "Schedule next meeting") become real motions immediately, same
  // as template items do — otherwise they'd only materialize on the first
  // agenda re-save. `adoptsMinutesId` may be supplied explicitly by the caller
  // or fall back to the resolved previous same-category meeting's minutes.
  const agendaJsonMotions = agendaJsonItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => String(item.motionText ?? "").trim())
    .map(({ item, index }) => {
      const motion: any = {
        text: String(item.motionText).trim(),
        outcome: "Pending",
        resolutionType: "Ordinary",
        sectionIndex: index,
        sectionTitle: item.title,
      };
      const adoptsId =
        item.adoptsMinutesId ??
        (previousMinutesId && isPreviousMinutesAdoptionItem({ title: item.title, motionText: item.motionText })
          ? previousMinutesId
          : undefined);
      if (adoptsId) motion.adoptsMinutesId = adoptsId;
      return motion;
    });
  // Resolve attendees. Explicit form input wins; otherwise auto-snapshot
  // current directors for Board meetings. One-shot at create time only —
  // edits never re-seed, so the user can manage the list freely afterwards.
  let attendees = Array.isArray(args.attendeeIds) ? args.attendeeIds.map(String) : [];
  if (attendees.length === 0 && args.type === "Board") {
    const allDirectors = await ctx.db
      .query("directors")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    const todayISO = new Date().toISOString().slice(0, 10);
    attendees = allDirectors
      .filter((d) => {
        const status = String(d.status ?? "").toLowerCase();
        if (status && !["active", "current", "verified"].includes(status)) return false;
        const end = d.termEnd || d.resignedAt;
        if (!end) return true;
        return String(end).slice(0, 10) >= todayISO;
      })
      .map((d) => `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim())
      .filter(Boolean);
  }

  const quorumRequired = args.quorumRequired ?? snapshot.quorumRequired;
  const minutesId = await ctx.db.insert("minutes", {
    societyId: args.societyId,
    meetingId,
    heldAt: args.scheduledAt,
    attendees,
    absent: [],
    quorumMet: quorumRequired == null ? false : attendees.length >= quorumRequired,
    quorumRequired: quorumRequired ?? undefined,
    bylawRuleSetId: args.bylawRuleSetId ?? snapshot.bylawRuleSetId,
    quorumRuleVersion: args.quorumRuleVersion ?? snapshot.quorumRuleVersion,
    quorumRuleEffectiveFromISO:
      args.quorumRuleEffectiveFromISO ??
      snapshot.quorumRuleEffectiveFromISO,
    quorumSourceLabel: args.quorumSourceLabel ?? snapshot.quorumSourceLabel,
    quorumComputedAtISO:
      args.quorumComputedAtISO ?? snapshot.quorumComputedAtISO,
    discussion: "",
    sections: templateItems.length > 0
      ? templateItems.map((item) => ({
          title: resolveTemplateText(item.title, templateContext),
          type: item.sectionType ?? inferAgendaSectionType(item.title),
          presenter: item.presenter || undefined,
          discussion: item.details ? resolveTemplateText(item.details, templateContext) : "",
          decisions: [],
          actionItems: [],
          depth: item.depth,
        }))
      : [],
    motions: templateMotions.length ? templateMotions : agendaJsonMotions,
    decisions: [],
    actionItems: [],
  });
  await ctx.db.patch(meetingId, { minutesId });
  return meetingId;
}

// Apply (or re-apply) a meeting template's agenda + minutes scaffolding onto an
// EXISTING meeting. create() only materializes a template at creation time, so a
// meeting made without one — or one that needs a different template — could
// never get the standardized agenda/section scaffolding. Safe by default:
// refuses to overwrite existing agenda items unless `replace` is set, and only
// fills minutes sections/motions when they are still empty (never clobbers
// recorded minutes) unless `replace` is set.
export async function applyTemplatePortable(
  ctx: PortableMutationCtx,
  { meetingId, meetingTemplateId, replace }: {
    meetingId: string;
    meetingTemplateId: string;
    replace?: boolean;
  },
) {
  const meeting = await ctx.db.get(meetingId);
  if (!meeting) throw new Error("Meeting not found.");
  const template = await ctx.db.get(meetingTemplateId);
  if (!template) throw new Error("Meeting template not found.");
  if (template.societyId !== meeting.societyId) {
    throw new Error("Meeting template belongs to a different society.");
  }

  const templateItems = normalizeTemplateItems(template.items);
  if (templateItems.length === 0) {
    throw new Error("This template has no agenda items to apply.");
  }
  const { context: templateContext, previousMinutesId } = await buildTemplateContext(
    ctx,
    meeting.societyId,
    meeting.scheduledAt,
    meeting.type,
  );
  const templateMotions = await buildTemplateMotions(ctx, templateItems, templateContext, previousMinutesId);
  const now = new Date().toISOString();

  // Resolve (or create) the meeting's agenda.
  const agendas = await ctx.db
    .query("agendas")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  agendas.sort((a, b) => String(a.createdAtISO).localeCompare(String(b.createdAtISO)));
  let agendaId = agendas[0]?._id;
  if (!agendaId) {
    agendaId = await ctx.db.insert("agendas", {
      societyId: meeting.societyId,
      meetingId,
      title: `${meeting.title} agenda`,
      status: "Draft",
      createdAtISO: now,
      updatedAtISO: now,
    });
  }

  // Guard existing agenda items.
  const existingItems = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q) => q.eq("agendaId", agendaId))
    .collect();
  if (existingItems.length > 0) {
    if (!replace) {
      throw new Error(
        "This meeting already has agenda items. Re-apply with replace to overwrite them.",
      );
    }
    for (const it of existingItems) await ctx.db.delete(it._id);
  }

  const resolvedItems = templateItems.map((item) => ({
    title: resolveTemplateText(item.title, templateContext),
    depth: item.depth,
    type: item.sectionType ?? inferAgendaSectionType(item.title),
    details: item.details ? resolveTemplateText(item.details, templateContext) : undefined,
    presenter: item.presenter || undefined,
    motionTemplateId: item.motionTemplateId,
    motionText: item.motionText ? resolveTemplateText(item.motionText, templateContext) : undefined,
  }));
  for (let order = 0; order < resolvedItems.length; order++) {
    const item = resolvedItems[order];
    await ctx.db.insert("agendaItems", {
      societyId: meeting.societyId,
      agendaId,
      order,
      type: item.type,
      title: item.title,
      depth: item.depth,
      details: item.details,
      presenter: item.presenter,
      motionTemplateId: item.motionTemplateId,
      motionText: item.motionText,
      createdAtISO: now,
    });
  }

  // Scaffold minutes sections/motions, but never clobber recorded minutes
  // unless the caller explicitly asked to replace.
  let minutesScaffolded = false;
  if (meeting.minutesId) {
    const minutes = await ctx.db.get(meeting.minutesId);
    const hasSections = Array.isArray(minutes?.sections) && minutes.sections.length > 0;
    const hasMotions = Array.isArray(minutes?.motions) && minutes.motions.length > 0;
    if (minutes && (replace || (!hasSections && !hasMotions))) {
      await ctx.db.patch(meeting.minutesId, {
        sections: templateItems.map((item) => ({
          title: resolveTemplateText(item.title, templateContext),
          type: item.sectionType ?? inferAgendaSectionType(item.title),
          presenter: item.presenter || undefined,
          discussion: item.details ? resolveTemplateText(item.details, templateContext) : "",
          decisions: [],
          actionItems: [],
          depth: item.depth,
        })),
        motions: templateMotions,
      });
      minutesScaffolded = true;
    }
  }

  const templateSnapshotJson = JSON.stringify({
    templateId: template._id,
    name: template.name,
    description: template.description,
    meetingType: template.meetingType,
    items: templateItems,
    capturedAtISO: now,
  });
  await ctx.db.patch(meetingId, { meetingTemplateId, templateSnapshotJson });

  return { agendaId, items: resolvedItems.length, minutesScaffolded };
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { id, patch }: {
    id: string;
    patch: {
      type?: string;
      title?: string;
      scheduledAt?: string;
      location?: string;
      electronic?: boolean;
      remoteUrl?: string;
      remoteMeetingId?: string;
      remotePasscode?: string;
      remoteInstructions?: string;
      noticeSentAt?: string;
      quorumRequired?: number;
      bylawRuleSetId?: string;
      quorumRuleVersion?: number;
      quorumRuleEffectiveFromISO?: string;
      quorumSourceLabel?: string;
      quorumComputedAtISO?: string;
      status?: string;
      attendeeIds?: string[];
      meetingTemplateId?: string;
      templateSnapshotJson?: string;
      minutesId?: string;
      sourceReviewStatus?: string;
      sourceReviewNotes?: string;
      sourceReviewedAtISO?: string;
      sourceReviewedByUserId?: string;
      packageReviewStatus?: string;
      packageReviewNotes?: string;
      packageReviewedAtISO?: string;
      packageReviewedByUserId?: string;
      notes?: string;
      clearNoticeSent?: boolean;
    };
  },
) {
  const { clearNoticeSent, ...rest } = patch;
  const next: Record<string, unknown> = { ...rest };
  if (clearNoticeSent) next.noticeSentAt = undefined;
  const existing = rest.scheduledAt !== undefined ? await ctx.db.get(id) : null;
  await ctx.db.patch(id, next);
  // Rescheduling: keep the auto-created minutes stub in step. Only touch
  // minutes whose heldAt still mirrors the old scheduledAt and that aren't
  // approved — a manually recorded or approved heldAt must never move.
  if (
    existing &&
    rest.scheduledAt &&
    rest.scheduledAt !== existing.scheduledAt
  ) {
    const minutesRows = await ctx.db
      .query("minutes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", id))
      .collect();
    for (const row of minutesRows) {
      if (!row.approvedAt && row.heldAt === existing.scheduledAt) {
        await ctx.db.patch(row._id, { heldAt: rest.scheduledAt });
      }
    }
  }
}

export async function markSourceReviewPortable(
  ctx: PortableMutationCtx,
  { id, status, notes, actingUserId }: {
    id: string;
    status: string;
    notes?: string;
    actingUserId?: string;
  },
) {
  const meeting = await ctx.db.get(id);
  if (!meeting) throw new Error("Meeting not found.");
  const actor = actingUserId ? await ctx.db.get(actingUserId) : null;
  if (actor && actor.societyId !== meeting.societyId) {
    throw new Error("Reviewer is not part of this society.");
  }
  const now = new Date().toISOString();
  const patch: any = {
    sourceReviewStatus: status,
    sourceReviewNotes: notes || undefined,
  };
  if (status === "source_reviewed") {
    patch.sourceReviewedAtISO = now;
    patch.sourceReviewedByUserId = actingUserId;
  }
  await ctx.db.patch(id, patch);

  const minutes = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q) => q.eq("meetingId", id))
    .first();
  if (minutes) {
    await ctx.db.patch(minutes._id, {
      sourceReviewStatus: status,
      sourceReviewNotes: notes || undefined,
      sourceReviewedAtISO: status === "source_reviewed" ? now : undefined,
      sourceReviewedByUserId: status === "source_reviewed" ? actingUserId : undefined,
    });
  }

  await ctx.db.insert("activity", {
    societyId: meeting.societyId,
    actor: actor?.displayName ?? "You",
    entityType: "meeting",
    entityId: id,
    action: "source-review",
    summary: `Marked source review ${status.replace(/_/g, " ")} for ${meeting.title}`,
    createdAtISO: now,
  });
}

export async function setPackageReviewStatusPortable(
  ctx: PortableMutationCtx,
  { id, status, notes, actingUserId }: {
    id: string;
    status: string;
    notes?: string;
    actingUserId?: string;
  },
) {
  const meeting = await ctx.db.get(id);
  if (!meeting) throw new Error("Meeting not found.");
  const actor = actingUserId ? await ctx.db.get(actingUserId) : null;
  if (actor && actor.societyId !== meeting.societyId) {
    throw new Error("Reviewer is not part of this society.");
  }
  const now = new Date().toISOString();
  const patch: any = {
    packageReviewStatus: status,
    packageReviewNotes: notes || undefined,
  };
  if (status === "ready" || status === "released") {
    patch.packageReviewedAtISO = now;
    patch.packageReviewedByUserId = actingUserId;
  }
  await ctx.db.patch(id, patch);
  await ctx.db.insert("activity", {
    societyId: meeting.societyId,
    actor: actor?.displayName ?? "You",
    entityType: "meeting",
    entityId: id,
    action: "package-review",
    summary: `Marked board package ${status.replace(/_/g, " ")} for ${meeting.title}`,
    createdAtISO: now,
  });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  // Cascade to the scaffolding created alongside the meeting so deletes don't
  // leave orphan minutes/agendas that render as broken links elsewhere.
  const agendas = await ctx.db
    .query("agendas")
    .withIndex("by_meeting", (q) => q.eq("meetingId", id))
    .collect();
  for (const agenda of agendas) {
    const items = await ctx.db
      .query("agendaItems")
      .withIndex("by_agenda", (q) => q.eq("agendaId", agenda._id))
      .collect();
    for (const item of items) await ctx.db.delete(item._id);
    await ctx.db.delete(agenda._id);
  }
  const minutesRows = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q) => q.eq("meetingId", id))
    .collect();
  for (const row of minutesRows) await ctx.db.delete(row._id);
  await ctx.db.delete(id);
}

export async function backfillQuorumSnapshotPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const meeting = await ctx.db.get(id);
  if (!meeting) return null;
  const snapshot = await buildQuorumSnapshot(ctx, {
    societyId: String(meeting.societyId),
    meetingDateISO: meeting.scheduledAt,
    meetingType: meeting.type,
    quorumRequiredOverride: meeting.quorumRequired,
  });
  const patch: any = {};
  if (meeting.quorumRequired == null && snapshot.quorumRequired != null) {
    patch.quorumRequired = snapshot.quorumRequired;
  }
  if (!meeting.bylawRuleSetId && snapshot.bylawRuleSetId) {
    patch.bylawRuleSetId = snapshot.bylawRuleSetId;
  }
  if (meeting.quorumRuleVersion == null && snapshot.quorumRuleVersion != null) {
    patch.quorumRuleVersion = snapshot.quorumRuleVersion;
  }
  if (!meeting.quorumRuleEffectiveFromISO && snapshot.quorumRuleEffectiveFromISO) {
    patch.quorumRuleEffectiveFromISO = snapshot.quorumRuleEffectiveFromISO;
  }
  if (!meeting.quorumSourceLabel) {
    patch.quorumSourceLabel = snapshot.quorumSourceLabel;
  }
  if (!meeting.quorumComputedAtISO) {
    patch.quorumComputedAtISO = snapshot.quorumComputedAtISO;
  }
  if (Object.keys(patch).length > 0) {
    await ctx.db.patch(id, patch);
  }
  return { patched: Object.keys(patch) };
}
