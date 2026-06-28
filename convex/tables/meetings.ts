import { defineTable } from "convex/server";
import { v } from "convex/values";

export const meetingTables = {
  meetings: defineTable({
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    type: v.string(),
    title: v.string(),
    scheduledAt: v.string(),
    location: v.optional(v.string()),
    electronic: v.boolean(),
    remoteUrl: v.optional(v.string()),
    remoteMeetingId: v.optional(v.string()),
    remotePasscode: v.optional(v.string()),
    remoteInstructions: v.optional(v.string()),
    noticeSentAt: v.optional(v.string()),
    quorumRequired: v.optional(v.number()),
    bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
    quorumRuleVersion: v.optional(v.number()),
    quorumRuleEffectiveFromISO: v.optional(v.string()),
    quorumSourceLabel: v.optional(v.string()),
    quorumComputedAtISO: v.optional(v.string()),
    status: v.string(),
    attendeeIds: v.array(v.string()),
    // Deprecated: legacy stored agenda blob removed in 9bdf80b. Kept here as an
    // optional pass-through so pre-existing rows still validate; nothing reads
    // or writes it now. Strip + delete this entry once the field is gone from
    // every meeting row.
    agendaJson: v.optional(v.string()),
    meetingTemplateId: v.optional(v.id("meetingTemplates")),
    templateSnapshotJson: v.optional(v.string()),
    minutesId: v.optional(v.id("minutes")),
    sourceReviewStatus: v.optional(v.string()), // imported_needs_review | source_reviewed | rejected
    sourceReviewNotes: v.optional(v.string()),
    sourceReviewedAtISO: v.optional(v.string()),
    sourceReviewedByUserId: v.optional(v.id("users")),
    packageReviewStatus: v.optional(v.string()), // draft | needs_review | ready | released
    packageReviewNotes: v.optional(v.string()),
    packageReviewedAtISO: v.optional(v.string()),
    packageReviewedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_date", ["societyId", "scheduledAt"])
    .index("by_committee", ["committeeId"]),

  meetingTemplates: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    meetingType: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    items: v.array(
      v.object({
        title: v.string(),
        depth: v.optional(v.union(v.literal(0), v.literal(1))),
        sectionType: v.optional(v.string()),
        presenter: v.optional(v.string()),
        details: v.optional(v.string()),
        motionTemplateId: v.optional(v.id("motionTemplates")),
        motionText: v.optional(v.string()),
      }),
    ),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_default", ["societyId", "isDefault"]),

  minutes: defineTable({
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    heldAt: v.string(),
    chairName: v.optional(v.string()),
    secretaryName: v.optional(v.string()),
    recorderName: v.optional(v.string()),
    calledToOrderAt: v.optional(v.string()),
    adjournedAt: v.optional(v.string()),
    remoteParticipation: v.optional(
      v.object({
        url: v.optional(v.string()),
        meetingId: v.optional(v.string()),
        passcode: v.optional(v.string()),
        instructions: v.optional(v.string()),
      }),
    ),
    detailedAttendance: v.optional(
      v.array(
        v.object({
          name: v.string(),
          status: v.string(), // present | absent | regrets | guest | staff | invited | proxy
          roleTitle: v.optional(v.string()),
          affiliation: v.optional(v.string()),
          memberIdentifier: v.optional(v.string()),
          proxyFor: v.optional(v.string()),
          quorumCounted: v.optional(v.boolean()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    attendees: v.array(v.string()),
    absent: v.array(v.string()),
    quorumMet: v.boolean(),
    quorumRequired: v.optional(v.number()),
    bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
    quorumRuleVersion: v.optional(v.number()),
    quorumRuleEffectiveFromISO: v.optional(v.string()),
    quorumSourceLabel: v.optional(v.string()),
    quorumComputedAtISO: v.optional(v.string()),
    discussion: v.string(),
    sections: v.optional(
      v.array(
        v.object({
          title: v.string(),
          type: v.optional(v.string()), // discussion | motion | report | break | executive_session | other
          presenter: v.optional(v.string()),
          discussion: v.optional(v.string()),
          motionText: v.optional(v.string()),
          motionTemplateId: v.optional(v.id("motionTemplates")),
          motionId: v.optional(v.id("motions")),
          reportSubmitted: v.optional(v.boolean()),
          decisions: v.optional(v.array(v.string())),
          actionItems: v.optional(
            v.array(
              v.object({
                text: v.string(),
                assignee: v.optional(v.string()),
                dueDate: v.optional(v.string()),
                done: v.boolean(),
              }),
            ),
          ),
          linkedTaskIds: v.optional(v.array(v.id("tasks"))),
          // 0 = root agenda item, 1 = sub-item nested under the most recent
          // preceding root. Absent on legacy data, treated as 0.
          depth: v.optional(v.union(v.literal(0), v.literal(1))),
          // Absent or true → included in the redacted "Public copy" export.
          // false → kept in internal minutes but stripped from the public copy.
          publicVisible: v.optional(v.boolean()),
        }),
      ),
    ),
    motions: v.array(
      v.object({
        name: v.optional(v.string()),
        text: v.string(),
        movedBy: v.optional(v.string()),
        movedByMemberId: v.optional(v.id("members")),
        movedByDirectorId: v.optional(v.id("directors")),
        secondedBy: v.optional(v.string()),
        secondedByMemberId: v.optional(v.id("members")),
        secondedByDirectorId: v.optional(v.id("directors")),
        outcome: v.string(),
        votesFor: v.optional(v.number()),
        votesAgainst: v.optional(v.number()),
        abstentions: v.optional(v.number()),
        resolutionType: v.optional(v.string()), // Ordinary | Special | Unanimous
        sectionIndex: v.optional(v.number()),
        sectionTitle: v.optional(v.string()),
        motionTemplateId: v.optional(v.id("motionTemplates")),
        motionId: v.optional(v.id("motions")),
      }),
    ),
    // Immutable snapshot of motions[] frozen when the minutes are approved, so
    // later edits to the (now first-class) motions never rewrite the approved
    // legal record. See docs/motions-first-class-object-design.md.
    motionSnapshots: v.optional(
      v.array(
        v.object({
          name: v.optional(v.string()),
          text: v.string(),
          movedBy: v.optional(v.string()),
          movedByMemberId: v.optional(v.id("members")),
          movedByDirectorId: v.optional(v.id("directors")),
          secondedBy: v.optional(v.string()),
          secondedByMemberId: v.optional(v.id("members")),
          secondedByDirectorId: v.optional(v.id("directors")),
          outcome: v.string(),
          votesFor: v.optional(v.number()),
          votesAgainst: v.optional(v.number()),
          abstentions: v.optional(v.number()),
          resolutionType: v.optional(v.string()),
          sectionIndex: v.optional(v.number()),
          sectionTitle: v.optional(v.string()),
          motionTemplateId: v.optional(v.id("motionTemplates")),
          motionId: v.optional(v.id("motions")),
        }),
      ),
    ),
    motionSnapshotAtISO: v.optional(v.string()),
    decisions: v.array(v.string()),
    actionItems: v.array(
      v.object({
        text: v.string(),
        assignee: v.optional(v.string()),
        dueDate: v.optional(v.string()),
        done: v.boolean(),
      }),
    ),
    approvedAt: v.optional(v.string()),
    approvedInMeetingId: v.optional(v.id("meetings")),
    nextMeetingAt: v.optional(v.string()),
    nextMeetingLocation: v.optional(v.string()),
    nextMeetingNotes: v.optional(v.string()),
    sessionSegments: v.optional(
      v.array(
        v.object({
          type: v.string(), // public | in_camera | executive_session | closed | other
          title: v.optional(v.string()),
          startedAt: v.optional(v.string()),
          endedAt: v.optional(v.string()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    appendices: v.optional(
      v.array(
        v.object({
          title: v.string(),
          type: v.optional(v.string()),
          reference: v.optional(v.string()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    agmDetails: v.optional(
      v.object({
        financialStatementsPresented: v.optional(v.boolean()),
        financialStatementsNotes: v.optional(v.string()),
        directorElectionNotes: v.optional(v.string()),
        directorAppointments: v.optional(
          v.array(
            v.object({
              name: v.string(),
              roleTitle: v.optional(v.string()),
                affiliation: v.optional(v.string()),
                term: v.optional(v.string()),
                consentRecorded: v.optional(v.boolean()),
                votesReceived: v.optional(v.number()),
                elected: v.optional(v.boolean()),
                status: v.optional(v.string()),
                notes: v.optional(v.string()),
              }),
          ),
        ),
        specialResolutionExhibits: v.optional(
          v.array(
            v.object({
              title: v.string(),
              reference: v.optional(v.string()),
              notes: v.optional(v.string()),
            }),
          ),
        ),
      }),
    ),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    sourceReviewStatus: v.optional(v.string()), // imported_needs_review | source_reviewed | rejected
    sourceReviewNotes: v.optional(v.string()),
    sourceReviewedAtISO: v.optional(v.string()),
    sourceReviewedByUserId: v.optional(v.id("users")),
    draftTranscript: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  meetingAttendanceRecords: defineTable({
    societyId: v.id("societies"),
    meetingId: v.optional(v.id("meetings")),
    minutesId: v.optional(v.id("minutes")),
    meetingTitle: v.string(),
    meetingDate: v.string(),
    personName: v.string(),
    memberId: v.optional(v.id("members")),
    directorId: v.optional(v.id("directors")),
    roleTitle: v.optional(v.string()),
    attendanceStatus: v.string(), // present | absent | regrets | guest | needs_review
    quorumCounted: v.optional(v.boolean()),
    confidence: v.string(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"])
    .index("by_society_date", ["societyId", "meetingDate"]),

  motionEvidence: defineTable({
    societyId: v.id("societies"),
    meetingId: v.optional(v.id("meetings")),
    minutesId: v.optional(v.id("minutes")),
    meetingTitle: v.string(),
    meetingDate: v.string(),
    motionText: v.string(),
    movedBy: v.optional(v.string()),
    movedByMemberId: v.optional(v.id("members")),
    movedByDirectorId: v.optional(v.id("directors")),
    secondedBy: v.optional(v.string()),
    secondedByMemberId: v.optional(v.id("members")),
    secondedByDirectorId: v.optional(v.id("directors")),
    outcome: v.string(),
    voteSummary: v.optional(v.string()),
    pageRef: v.optional(v.string()),
    evidenceText: v.optional(v.string()),
    confidence: v.string(),
    status: v.string(), // Extracted | Verified | Rejected
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"])
    .index("by_society_date", ["societyId", "meetingDate"]),
};
