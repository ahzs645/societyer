import { defineTable } from 'convex/server';
import { v } from 'convex/values';
export const reviewEvidenceTables = {
 organizationSeats: defineTable({societyId:v.id('societies'),seatKey:v.string(),organizationName:v.string(),observations:v.array(v.any()),createdAtISO:v.string()}).index('by_society',['societyId']).index('by_seat',['societyId','seatKey']),
 seatProxyAuthorizations: defineTable({societyId:v.id('societies'),seatId:v.id('organizationSeats'),meetingId:v.id('meetings'),principalName:v.string(),proxyName:v.string(),authority:v.any(),source:v.any(),status:v.string(),createdAtISO:v.string()}).index('by_society',['societyId']).index('by_meeting',['meetingId']),
 membershipRuleVersions: defineTable({societyId:v.id('societies'),ruleKey:v.string(),version:v.number(),effectiveDate:v.string(),requirements:v.array(v.any()),authority:v.any(),reviewStatus:v.string(),createdAtISO:v.string()}).index('by_society',['societyId']),
 memberAssessments: defineTable({societyId:v.id('societies'),memberId:v.id('members'),ruleVersionId:v.id('membershipRuleVersions'),asOf:v.string(),results:v.array(v.any()),overall:v.string(),createdAtISO:v.string()}).index('by_society',['societyId']).index('by_member',['memberId']),
 financialVersionSelections: defineTable({societyId:v.id('societies'),scopeKey:v.string(),table:v.string(),selectedId:v.string(),source:v.any(),selectionHistory:v.array(v.any()),updatedAtISO:v.string()}).index('by_society',['societyId']),
 importTargets: defineTable({societyId:v.id('societies'),identity:v.string(),recordKind:v.string(),targetId:v.string(),payloadFingerprint:v.string(),createdAtISO:v.string()}).index('by_society',['societyId']).index('by_identity',['societyId','identity']),
};
