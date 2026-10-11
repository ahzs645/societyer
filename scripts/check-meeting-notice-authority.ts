import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { toPortableMutationCtx, toPortableQueryCtx } from "../convex/lib/portable";
import { MemoryDb, LocalStoreDb, MemoryRowStore, PortableRuntime, makeCapabilities, definePortableMutation, definePortableQuery, type PortablePrincipal } from "../shared/portable/index";
import * as agm from "../shared/functions/agm";
import * as elections from "../shared/functions/elections";
import { PORTABLE_TEST_IDENTITY } from "./portable-test-fixture";

// Review findings: the meeting-notice audience must not expose the director or
// auditor registers to a meetings-only token; the campaign "voting_shareholders"
// audience is holders with votes only; election settings can be cleared; an
// election record date has a lower bound; and today's record date is labelled
// as the live register at snapshot time.
const RealDate = Date;
const clockISO = "2026-10-11T20:00:00.000Z";
class Clock extends RealDate {
  constructor(...args: unknown[]) { super(...((args.length ? args : [clockISO]) as [])); }
  static now() { return new RealDate(clockISO).getTime(); }
}
globalThis.Date = Clock as DateConstructor;

type Store = { insert(table: string, doc: any): Promise<any>; get(id: string): Promise<any> };
type Runner = { query(name: string, args: any): Promise<any>; mutation(name: string, args: any): Promise<any> };
const SECRET = ["Secret Director", "secret-director@example.test", "Hidden Role Director", "hidden-role@example.test", "Private Audit LLP"];
const federal = { entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act" };

async function seed(store: Store, issuer: string, provider: string) {
  const societyId = await store.insert("societies", { ...federal, name: "Notice authority corporation", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  const ownerId = await store.insert("users", { societyId, role: "Owner", status: "Active", authIssuer: issuer, authProvider: provider, authSubject: "notice-owner", email: "owner@example.test", displayName: "Owner", createdAtISO: clockISO });
  await store.insert("users", { societyId, role: "Member", status: "Active", authIssuer: issuer, authProvider: provider, authSubject: "notice-member", email: "member@example.test", displayName: "Member", createdAtISO: clockISO });
  const provenance = { sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: clockISO, updatedAtISO: clockISO };
  const person = { ...provenance, societyId, status: "current", citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], controllingIndividualIds: [] };
  const holderA = await store.insert("roleHolders", { ...person, roleType: "shareholder", fullName: "Voting holder A", email: "a@example.test" });
  const holderB = await store.insert("roleHolders", { ...person, roleType: "shareholder", fullName: "Voting holder B", email: "b@example.test" });
  const holderN = await store.insert("roleHolders", { ...person, roleType: "shareholder", fullName: "Non-voting holder", email: "n@example.test" });
  const roleDirector = await store.insert("roleHolders", { ...person, roleType: "director", fullName: "Hidden Role Director", email: "hidden-role@example.test" });
  const common = await store.insert("rightsClasses", { ...provenance, societyId, className: "Common", classType: "share", status: "active", votesPerShare: 1 });
  const preferred = await store.insert("rightsClasses", { ...provenance, societyId, className: "Preferred", classType: "share", status: "active", votesPerShare: 0 });
  for (const [holder, classId, quantity] of [[holderA, common, 10], [holderB, common, 5], [holderN, preferred, 50]] as const) {
    await store.insert("rightsHoldings", { ...provenance, societyId, rightsClassId: classId, holderRoleHolderId: holder, holderKey: `roleHolder:${holder}`, quantity, status: "current" });
  }
  const directorId = await store.insert("directors", { societyId, firstName: "Secret", lastName: "Director", email: "secret-director@example.test", position: "Director", status: "Active", termStart: "2026-01-01", isBCResident: false, consentOnFile: true });
  const auditorId = await store.insert("auditorAppointments", { societyId, firmName: "Private Audit LLP", engagementType: "Audit", fiscalYear: "2026", appointedBy: "Members", appointedAtISO: "2026-01-01", independenceAttested: true, status: "Active" });
  const meetingId = await store.insert("meetings", { societyId, type: "AGM", title: "Annual meeting", scheduledAt: "2026-11-20T17:00:00.000Z", electronic: false, status: "Scheduled", attendeeIds: [] });
  const delivery = { societyId, meetingId, channel: "mail", sentAtISO: clockISO, status: "sent" };
  await store.insert("noticeDeliveries", { ...delivery, recipientName: "Secret Director", recipientEmail: "secret-director@example.test", directorId, recipientKey: `director:${directorId}` });
  await store.insert("noticeDeliveries", { ...delivery, recipientName: "Hidden Role Director", recipientEmail: "hidden-role@example.test", roleHolderId: roleDirector, recipientKey: `roleHolder:${roleDirector}` });
  await store.insert("noticeDeliveries", { ...delivery, recipientName: "Private Audit LLP", auditorAppointmentId: auditorId, recipientKey: `auditor:${auditorId}` });
  await store.insert("noticeDeliveries", { ...delivery, recipientName: "Voting holder A", recipientEmail: "a@example.test", roleHolderId: holderA, recipientKey: `roleHolder:${holderA}` });
  const documentId = await store.insert("documents", { societyId, title: "Scrutineer report", category: "Governance", createdAtISO: clockISO, flaggedForDeletion: false, tags: [] });
  return { societyId, ownerId, meetingId, documentId, holderA, holderB };
}

async function qualifyNotices(label: string, ids: Awaited<ReturnType<typeof seed>>, meetingsOnly: Runner, withRegisters: Runner) {
  const coverage = await meetingsOnly.query("agm:noticeCoverage", { meetingId: ids.meetingId });
  const deliveries = await meetingsOnly.query("agm:noticeDeliveries", { meetingId: ids.meetingId });
  const text = JSON.stringify({ coverage, deliveries });
  for (const secret of SECRET) assert.ok(!text.includes(secret), `${label}: a meetings-only token must not read ${secret}`);
  assert.deepEqual(deliveries.map((row: any) => row.recipientName), ["Voting holder A"]);
  assert.equal(coverage.eligibleCount, 2, "Coverage counts only the registers this token can read");
  assert.equal(coverage.tone, "warn");
  assert.match(coverage.detail, /excludes directors and the auditor/);
  await assert.rejects(() => meetingsOnly.mutation("agm:queueNoticeToAllVotingMembers", { societyId: ids.societyId, meetingId: ids.meetingId, channel: "mail" }), /directors:read required/);
  const full = await withRegisters.query("agm:noticeCoverage", { meetingId: ids.meetingId });
  assert.equal(full.eligibleCount, 5, "Voting holders, both director registers and the auditor");
  assert.equal(full.deliveredCount, 4);
  assert.equal((await withRegisters.query("agm:noticeDeliveries", { meetingId: ids.meetingId })).length, 4);
  const queued = await withRegisters.mutation("agm:queueNoticeToAllVotingMembers", { societyId: ids.societyId, meetingId: ids.meetingId, channel: "mail" });
  assert.equal(queued.recorded, 5);
}

async function qualifyElections(label: string, ids: Awaited<ReturnType<typeof seed>>, owner: Runner, store: Store) {
  const review = (recordDateISO: string) => ({ recordDateISO, recordDateBasis: "Board resolution fixing the record date, reviewed against notice.", rightsBasis: "Articles: Common one vote per share; Preferred non-voting.", ledgerBasis: "Current complete register and all transfers verified.", votingMethod: "per_share" as const,
    representatives: [ids.holderA, ids.holderB].map((roleHolderId) => ({ roleHolderId, userId: ids.ownerId, authorityBasis: "Verified identity and signed authority to vote." })) });
  const base = { societyId: ids.societyId, title: `${label} election`, opensAtISO: "2026-11-20T17:00:00.000Z", closesAtISO: "2026-11-20T20:00:00.000Z", initialQuestion: { title: "Elect director", maxSelections: 1, options: [{ id: "yes", label: "For" }, { id: "no", label: "Against" }] } };
  // Record-date lower bound measured from the linked meeting (CBCA: conservative 60-day bound).
  await assert.rejects(() => owner.mutation("elections:create", { ...base, meetingId: ids.meetingId, corporateReview: review("2025-04-11") }), /more than 60 days before the meeting on 2026-11-20 \(s\. 134\).*on or after 2026-09-21/);
  await assert.rejects(() => owner.mutation("elections:create", { ...base, meetingId: ids.meetingId, corporateReview: review("2026-09-20") }), /more than 60 days/);
  const electionId = await owner.mutation("elections:create", { ...base, meetingId: ids.meetingId, corporateReview: review("2026-10-11") });
  await assert.rejects(() => owner.mutation("elections:updateSettings", { electionId, corporateReview: review("2026-01-01") }), /more than 60 days/);
  const bundle = await owner.query("elections:get", { id: electionId });
  assert.ok(bundle.corporatePreview.reviewNotes.some((note: string) => /conservative bound/.test(note)));
  // Clearing settings: null clears; omitted fields and the electorate review stay.
  await owner.mutation("elections:updateSettings", { electionId, resultsSummary: "Draft summary", evidenceDocumentId: ids.documentId, nominationsOpenAtISO: "2026-10-12T00:00:00.000Z", nominationsCloseAtISO: "2026-10-20T00:00:00.000Z" });
  let row = await store.get(electionId);
  assert.equal(row.resultsSummary, "Draft summary");
  assert.equal(row.evidenceDocumentId, ids.documentId);
  assert.equal(row.nominationsOpenAtISO, "2026-10-12T00:00:00.000Z");
  await owner.mutation("elections:updateSettings", { electionId, scrutineerUserIds: [] });
  row = await store.get(electionId);
  assert.equal(row.resultsSummary, "Draft summary", "An omitted field is left unchanged");
  await owner.mutation("elections:updateSettings", { electionId, resultsSummary: null, evidenceDocumentId: null, nominationsOpenAtISO: null, nominationsCloseAtISO: null });
  row = await store.get(electionId);
  assert.equal(row.resultsSummary, undefined);
  assert.equal(row.evidenceDocumentId, undefined);
  assert.equal(row.nominationsOpenAtISO, undefined);
  assert.equal(row.nominationsCloseAtISO, undefined);
  assert.equal(row.corporateReview.recordDateISO, "2026-10-11", "The electorate review is never cleared by a settings update");
  // Today's record date freezes the live register at snapshot time, not at the end of the day.
  await owner.mutation("elections:snapshotEligibleVoters", { electionId });
  const eligible = (await owner.query("elections:get", { id: electionId })).eligible;
  assert.ok(eligible.every((entry: any) => /^Live share register at snapshot time on 2026-10-11/.test(entry.eligibilityReason)));
}

const issuer = betterAuthIssuer();
try {
  // Native Convex: public endpoints for users, portable handlers for scoped service tokens.
  const native = convexTest(schema, {
    "./_generated/api.js": () => import("../convex/_generated/api.js"), "./_generated/server.js": () => import("../convex/_generated/server.js"),
    "./agm.js": () => import("../convex/agm"), "./elections.js": () => import("../convex/elections"), "./communications.js": () => import("../convex/communications"),
    "./authorization.js": () => import("../convex/authorization"), "./users.js": () => import("../convex/users"), "./society.js": () => import("../convex/society"),
    "./members.js": () => import("../convex/members"), "./directors.js": () => import("../convex/directors"), "./auditors.js": () => import("../convex/auditors"),
    "./legalOperations.js": () => import("../convex/legalOperations"), "./meetings.js": () => import("../convex/meetings"), "./volunteers.js": () => import("../convex/volunteers"),
    "./committees.js": () => import("../convex/committees"), "./subscriptions.js": () => import("../convex/subscriptions"), "./notifications.js": () => import("../convex/notifications"),
  } as any);
  const nativeStore: Store = { insert: (table, doc) => native.run((ctx) => ctx.db.insert(table as any, doc)), get: (id) => native.run((ctx) => ctx.db.get(id as any)) };
  const nativeIds = await seed(nativeStore, issuer, "better-auth");
  const service = (scopes: string[]): Runner => {
    const principal = (portable: any) => ({ ...portable, principal: { kind: "service" as const, runtime: "test" as const, assurance: "trusted-internal" as const, subject: "notice-service", actorUserId: String(nativeIds.ownerId), societyId: String(nativeIds.societyId), scopes } });
    const fn = (name: string) => (agm as any)[{ "agm:noticeCoverage": "noticeCoverage", "agm:noticeDeliveries": "noticeDeliveries", "agm:queueNoticeToAllVotingMembers": "queueNoticeToAllVotingMembers" }[name]!];
    return {
      query: (name, args) => native.run(async (ctx) => fn(name)(principal(await toPortableQueryCtx(ctx)), args)),
      mutation: (name, args) => native.run(async (ctx) => fn(name)(principal(await toPortableMutationCtx(ctx)), args)),
    };
  };
  await qualifyNotices("Native Convex (service token)", nativeIds, service(["meetings:read", "meetings:write"]), service(["meetings:read", "meetings:write", "directors:read", "auditors:read"]));
  // A Member account has meetings:read but not directors:read through the public endpoint.
  const member = native.withIdentity({ subject: "notice-member", issuer });
  const memberText = JSON.stringify([await member.query(api.agm.noticeDeliveries, { meetingId: nativeIds.meetingId }), await member.query(api.agm.noticeCoverage, { meetingId: nativeIds.meetingId })]);
  for (const secret of SECRET) assert.ok(!memberText.includes(secret), `A Member account must not read ${secret}`);
  const owner = native.withIdentity({ subject: "notice-owner", issuer });
  const ownerRunner: Runner = {
    query: (name, args) => owner.query((api as any)[name.split(":")[0]][name.split(":")[1]], args),
    mutation: (name, args) => owner.mutation((api as any)[name.split(":")[0]][name.split(":")[1]], args),
  };
  await qualifyElections("Native Convex", nativeIds, ownerRunner, nativeStore);

  // Campaign audience composition (Convex actions only).
  const votingCampaign = await owner.action(api.communications.sendCampaign, { societyId: nativeIds.societyId, audience: "voting_shareholders", kind: "general", channel: "mail", subject: "Update", bodyText: "Shareholder update" });
  const campaignRows = await native.run((ctx) => ctx.db.query("communicationDeliveries").collect());
  const votingNames = campaignRows.filter((row: any) => row.campaignId === votingCampaign.campaignId).map((row: any) => row.recipientName).sort();
  assert.deepEqual(votingNames, ["Voting holder A", "Voting holder B"], "voting_shareholders excludes directors, the auditor and non-voting holders");
  const voting = await owner.query(api.legalOperations.votingPower, { societyId: nativeIds.societyId });
  assert.equal(votingNames.length, voting.voting.length, "The campaign matches the Communications page count");
  await assert.rejects(() => owner.action(api.communications.sendCampaign, { societyId: nativeIds.societyId, audience: "meeting_notice", kind: "general", channel: "mail" }), /Send a meeting notice from the meeting/);
  const notice = await owner.action(api.communications.sendMeetingNotice, { societyId: nativeIds.societyId, meetingId: nativeIds.meetingId, channel: "mail" });
  const noticeNames = (await native.run((ctx) => ctx.db.query("communicationDeliveries").collect())).filter((row: any) => row.campaignId === notice.campaignId).map((row: any) => row.recipientName).sort();
  assert.deepEqual(noticeNames, ["Hidden Role Director", "Private Audit LLP", "Secret Director", "Voting holder A", "Voting holder B"], "The meeting notice reaches voting holders, every director and the auditor");
  console.log("Native Convex: meeting-notice register authority, Member endpoint isolation, election record-date bound, settings clearing, snapshot label and campaign audiences passed.");

  for (const label of ["MemoryDb", "LocalStoreDb"]) {
    const db = label === "MemoryDb" ? new MemoryDb() : new LocalStoreDb(new MemoryRowStore());
    const store: Store = { insert: (table, doc) => db.transaction(() => db.insert(table, doc)), get: (id) => db.get(id) };
    const ids = await seed(store, PORTABLE_TEST_IDENTITY.issuer, "portable-fixture");
    const runtime = (principal: PortablePrincipal): Runner => {
      const r = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => principal });
      r.registerAll([
        ...["noticeCoverage", "noticeDeliveries"].map((name) => ({ ...definePortableQuery({ name: `agm:${name}`, handler: (agm as any)[name] }), applicationPolicy: true })),
        { ...definePortableMutation({ name: "agm:queueNoticeToAllVotingMembers", handler: agm.queueNoticeToAllVotingMembers }), applicationPolicy: true },
        ...["get"].map((name) => ({ ...definePortableQuery({ name: `elections:${name}`, handler: (elections as any)[`${name}Portable`] }), applicationPolicy: true })),
        ...["create", "updateSettings", "snapshotEligibleVoters"].map((name) => ({ ...definePortableMutation({ name: `elections:${name}`, handler: (elections as any)[`${name}Portable`] }), applicationPolicy: true })),
      ]);
      return { query: (name, args) => r.runQuery(name, args), mutation: (name, args) => r.runMutation(name, args) };
    };
    const serviceToken = (scopes: string[]) => runtime({ kind: "service", runtime: "test", assurance: "trusted-internal", subject: "notice-service", actorUserId: String(ids.ownerId), societyId: String(ids.societyId), scopes });
    await qualifyNotices(label, ids, serviceToken(["meetings:read", "meetings:write"]), serviceToken(["meetings:read", "meetings:write", "directors:read", "auditors:read"]));
    const ownerRuntime = runtime({ kind: "user", runtime: "test", assurance: "verified-jwt", issuer: PORTABLE_TEST_IDENTITY.issuer, subject: "notice-owner" });
    await qualifyElections(label, ids, ownerRuntime, store);
    console.log(`${label}: meeting-notice register authority, election record-date bound, settings clearing and snapshot label passed.`);
  }
} finally { globalThis.Date = RealDate; }
