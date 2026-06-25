import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * People & governance tables (members, directors, board role assignments/changes, signing authorities, committees, committee members, org-chart assignments), extracted from convex/schema.ts. Spread back into defineSchema; byte-identical.
 */
export const peopleTables = {
  members: defineTable({
    societyId: v.id("societies"),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    membershipClass: v.string(),
    status: v.string(),
    joinedAt: v.string(),
    leftAt: v.optional(v.string()),
    votingRights: v.boolean(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  directors: defineTable({
    societyId: v.id("societies"),
    memberId: v.optional(v.id("members")),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    position: v.string(),
    isBCResident: v.boolean(),
    termStart: v.string(),
    termEnd: v.optional(v.string()),
    consentOnFile: v.boolean(),
    resignedAt: v.optional(v.string()),
    status: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  boardRoleAssignments: defineTable({
    societyId: v.id("societies"),
    personName: v.string(),
    personKey: v.optional(v.string()),
    memberId: v.optional(v.id("members")),
    directorId: v.optional(v.id("directors")),
    roleTitle: v.string(),
    roleGroup: v.optional(v.string()),
    roleType: v.string(), // director | officer | committee | staff | observed
    startDate: v.string(),
    endDate: v.optional(v.string()),
    status: v.string(), // Observed | Verified | Superseded | Rejected
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    importedFrom: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_start", ["societyId", "startDate"])
    .index("by_person", ["societyId", "personKey"]),

  boardRoleChanges: defineTable({
    societyId: v.id("societies"),
    effectiveDate: v.string(),
    changeType: v.string(), // added | removed | renamed | appointed | resigned | elected
    roleTitle: v.string(),
    personName: v.optional(v.string()),
    previousPersonName: v.optional(v.string()),
    memberId: v.optional(v.id("members")),
    directorId: v.optional(v.id("directors")),
    previousMemberId: v.optional(v.id("members")),
    previousDirectorId: v.optional(v.id("directors")),
    meetingId: v.optional(v.id("meetings")),
    minutesId: v.optional(v.id("minutes")),
    motionEvidenceId: v.optional(v.string()),
    status: v.string(),
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "effectiveDate"]),

  signingAuthorities: defineTable({
    societyId: v.id("societies"),
    personName: v.string(),
    roleTitle: v.optional(v.string()),
    institutionName: v.optional(v.string()),
    accountLabel: v.optional(v.string()),
    authorityType: v.string(), // signing | banking | card | online-banking | other
    effectiveDate: v.string(),
    endDate: v.optional(v.string()),
    status: v.string(),
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "effectiveDate"]),

  committees: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    mission: v.optional(v.string()),
    cadence: v.string(),
    cadenceNotes: v.optional(v.string()),
    nextMeetingAt: v.optional(v.string()),
    chairDirectorId: v.optional(v.id("directors")),
    color: v.string(),
    status: v.string(),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  committeeMembers: defineTable({
    committeeId: v.id("committees"),
    societyId: v.id("societies"),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.string(),
    directorId: v.optional(v.id("directors")),
    memberId: v.optional(v.id("members")),
    joinedAt: v.string(),
    leftAt: v.optional(v.string()),
  })
    .index("by_committee", ["committeeId"])
    .index("by_society", ["societyId"]),

  orgChartAssignments: defineTable({
    societyId: v.id("societies"),
    subjectType: v.string(), // director | employee | volunteer
    subjectId: v.string(),
    subjectName: v.string(),
    managerType: v.optional(v.string()), // director | employee | volunteer
    managerId: v.optional(v.string()),
    managerName: v.optional(v.string()),
    notes: v.optional(v.string()),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_subject", ["societyId", "subjectType", "subjectId"]),
};
