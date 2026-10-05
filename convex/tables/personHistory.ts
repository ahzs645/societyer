import {defineTable} from 'convex/server';import {v} from 'convex/values';
export const personHistoryTables={
 personContactPoints:defineTable({societyId:v.id('societies'),personId:v.id('peopleDirectory'),pointKey:v.string(),kind:v.string(),value:v.string(),observedDate:v.string(),reviewStatus:v.string(),sourceOccurrenceId:v.optional(v.id('personOccurrences')),sourceUrl:v.string(),sourceReference:v.string(),createdAtISO:v.string()}).index('by_society',['societyId']).index('by_person',['societyId','personId']).index('by_key',['societyId','pointKey']),
 personOccurrences:defineTable({
  societyId:v.id('societies'),occurrenceKey:v.string(),recordTable:v.string(),recordId:v.string(),
  personName:v.string(),context:v.string(),observedDate:v.optional(v.string()),
  roleTitle:v.optional(v.string()),affiliation:v.optional(v.string()),notes:v.optional(v.string()),
  meetingId:v.optional(v.id('meetings')),documentId:v.optional(v.id('documents')),
  sourceUrl:v.string(),sourceReference:v.string(),sourceExternalId:v.optional(v.string()),
  // Assumed identities remain explicitly separate from source-verified matches.
  // Their testOnly acknowledgement and cited rationale live in the append-only review trail.
  personId:v.optional(v.id('peopleDirectory')),matchStatus:v.string(),reviewHistory:v.array(v.any()),
  createdAtISO:v.string(),
 }).index('by_society',['societyId']).index('by_key',['societyId','occurrenceKey']).index('by_person',['societyId','personId']).index('by_record',['societyId','recordTable','recordId']),
 personHistoryEvents:defineTable({
  societyId:v.id('societies'),personId:v.id('peopleDirectory'),eventKey:v.string(),kind:v.string(),
  roleTitle:v.optional(v.string()),affiliation:v.optional(v.string()),title:v.string(),value:v.optional(v.string()),scope:v.string(),effectiveDate:v.string(),endDate:v.optional(v.string()),
  transition:v.string(),details:v.optional(v.string()),reviewStatus:v.string(),
  supersedesEventId:v.optional(v.id('personHistoryEvents')),sourceOccurrenceId:v.optional(v.id('personOccurrences')),
  meetingId:v.optional(v.id('meetings')),documentId:v.optional(v.id('documents')),
  sourceUrl:v.string(),sourceReference:v.string(),sourceExternalId:v.optional(v.string()),
  reviewHistory:v.optional(v.array(v.any())),createdAtISO:v.string(),createdByUserId:v.string(),
 }).index('by_society',['societyId']).index('by_person',['societyId','personId']).index('by_key',['societyId','eventKey']),
};
