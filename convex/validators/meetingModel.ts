import { v } from "convex/values";

/**
 * Optional, back-compatible meeting / minutes / motion model extensions
 * (PGAIR audit findings A1, A3, A9, A11, A12, A13, A16, A17, A18, C13).
 *
 * Every field here is optional so existing rows and old backups keep
 * validating. Table definitions and the Convex function argument validators
 * spread the same objects so the two never drift.
 */

/** Action status vocabulary shared with `actionObservationValidator`. */
export const ACTION_ITEM_STATUSES = ["unknown", "open", "in_progress", "ongoing", "on_hold", "completed", "cancelled"] as const;
export const actionItemStatusValidator = v.union(
  v.literal("unknown"), v.literal("open"), v.literal("in_progress"), v.literal("ongoing"),
  v.literal("on_hold"), v.literal("completed"), v.literal("cancelled"),
);

/** A minutes action item. `done` is kept for compatibility and is derived from
 *  `status` (completed ⇒ done) whenever a status is present. */
export const minutesActionItemValidator = v.object({
  text: v.string(),
  assignee: v.optional(v.string()),
  // A1: the person the action was assigned to (people directory).
  assigneePersonId: v.optional(v.id("peopleDirectory")),
  dueDate: v.optional(v.string()),
  done: v.boolean(),
  // A12: explicit status; "unknown" when the source does not say.
  status: v.optional(actionItemStatusValidator),
  // Literal status wording from the source ("ongoing", "done", "carried").
  sourceStatus: v.optional(v.string()),
  // Native task created from (or linked to) this action item.
  taskId: v.optional(v.id("tasks")),
});

export const detailedAttendanceValidator = v.object({
  name: v.string(),
  status: v.string(), // present | absent | regrets | guest | staff | invited | proxy | unknown
  roleTitle: v.optional(v.string()),
  affiliation: v.optional(v.string()),
  // A1: organization the attendee represented at this meeting (seat holder).
  representedOrganization: v.optional(v.string()),
  memberIdentifier: v.optional(v.string()),
  // A1: link to the people directory.
  personId: v.optional(v.id("peopleDirectory")),
  proxyFor: v.optional(v.string()),
  quorumCounted: v.optional(v.boolean()),
  notes: v.optional(v.string()),
});

/** A11: a named person (abstainer / dissenter) with an optional directory link. */
export const namedPersonValidator = v.object({
  name: v.string(),
  personId: v.optional(v.id("peopleDirectory")),
  notes: v.optional(v.string()),
});

/** C13: where in the source a motion was read from. */
export const motionSourceLocatorValidator = v.object({
  voteSummary: v.optional(v.string()),
  pageRef: v.optional(v.string()),
  evidenceText: v.optional(v.string()),
  sectionReference: v.optional(v.string()),
  quote: v.optional(v.string()),
  sourceExternalIds: v.optional(v.array(v.string())),
});

/** Fields added to the first-class motion row AND to embedded/snapshot motions. */
export const motionExtensionFields = {
  // A1: mover / seconder as people-directory persons.
  movedByPersonId: v.optional(v.id("peopleDirectory")),
  secondedByPersonId: v.optional(v.id("peopleDirectory")),
  // A11: named abstainers / dissenters and a retained dissent report.
  abstainedBy: v.optional(v.array(namedPersonValidator)),
  opposedBy: v.optional(v.array(namedPersonValidator)),
  dissentDocumentId: v.optional(v.id("documents")),
  // C13: field-level source locator.
  sourceLocator: v.optional(motionSourceLocatorValidator),
  // C1: the outcome exactly as the source worded it ("Passed", "no objection").
  sourceOutcomeText: v.optional(v.string()),
  // G-04: why a recorded outcome stands despite the counted tally
  // (consensus first, chair ruling, ...). Required for such an override.
  outcomeOverrideNote: v.optional(v.string()),
};

/** A9: agenda item fields. */
export const agendaItemExtensionFields = {
  itemNumber: v.optional(v.string()),
  // approve | receive | discuss | decide | information | none
  requestedAction: v.optional(v.string()),
  scheduledTimeText: v.optional(v.string()),
  consent: v.optional(v.boolean()),
};

/** A16: several scheduled next meetings. */
export const nextMeetingValidator = v.object({
  at: v.optional(v.string()),
  dateText: v.optional(v.string()),
  precision: v.optional(v.string()), // datetime | date | month
  bodyKey: v.optional(v.string()),
  committeeId: v.optional(v.id("committees")),
  location: v.optional(v.string()),
  notes: v.optional(v.string()),
});

/** A13 + A18 + provenance fields on meetings. */
export const meetingExtensionFields = {
  // "date" when only the calendar day is known (scheduledAt is then a noon-UTC
  // placeholder, never a real time); "datetime" when the time is known.
  scheduledAtPrecision: v.optional(v.string()),
  localStartText: v.optional(v.string()),
  localEndText: v.optional(v.string()),
  timeZone: v.optional(v.string()),
  // A18: "own" (default) or "external" when staff attended another body's meeting.
  hostBody: v.optional(v.string()),
  externalOrganization: v.optional(v.string()),
  // The title exactly as imported (filename or header line) before cleanup.
  sourceTitle: v.optional(v.string()),
  // B8: a special (not regular) meeting of the board or a committee.
  special: v.optional(v.boolean()),
};

/** A3: one quorum rule. */
export const quorumRuleFields = {
  // fixed | percentage | all_members | majority
  quorumType: v.string(),
  quorumValue: v.optional(v.number()),
  quorumMinimumCount: v.optional(v.number()),
  // voting_members | directors_in_office | committee_members
  countBasis: v.optional(v.string()),
  notes: v.optional(v.string()),
};
export const quorumRuleValidator = v.object(quorumRuleFields);
export const bodyQuorumRuleValidator = v.object({
  // general | board | committee
  body: v.string(),
  committeeId: v.optional(v.id("committees")),
  committeeName: v.optional(v.string()),
  ...quorumRuleFields,
});

/** A17: signing authority amount tiers. */
export const signingAuthorityTierValidator = v.object({
  minCents: v.optional(v.number()),
  maxCents: v.optional(v.number()),
  signaturesRequired: v.number(),
  roles: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
});
