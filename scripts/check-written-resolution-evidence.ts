import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { MemoryDb, LocalStoreDb, MemoryRowStore, PortableRuntime, makeCapabilities, definePortableMutation, definePortableQuery } from "../shared/portable/index";
import * as handlers from "../shared/functions/writtenResolutions";
import { PORTABLE_TEST_IDENTITY } from "./portable-test-fixture";

// The clock changes between legal events without conflating signed time with entry time.
const RealDate = Date;
let clockISO = "2026-10-11T20:00:00.000Z";
class EvidenceClock extends RealDate {
  constructor(...args: unknown[]) { super(...((args.length ? args : [clockISO]) as [])); }
  static now() { return new RealDate(clockISO).getTime(); }
}
globalThis.Date = EvidenceClock as DateConstructor;

type Actor = { mutation(name: string, args: any): Promise<any>; query(name: string, args: any): Promise<any> };
type Store = { insert(table: string, doc: any): Promise<any>; patch(id: string, patch: any): Promise<void>; get(id: string): Promise<any> };
const circulation = "2026-10-11T09:00:00.000Z";
const evidence = {
  governingInstrumentEvidence: "Current articles and bylaws reviewed, including separate classes and any higher approval requirement.",
  electorateEvidence: "Complete legal register verified at the reviewed record date, with identity and voting authority checked.",
  circulationEvidence: "The exact final resolution was circulated to every eligible voter, with dispatch records retained.",
  authorityReviewed: true, circulatedAtISO: circulation,
};

async function seed(store: Store, issuer: string, provider: string) {
  const base = { isCharity: false, isMemberFunded: false, updatedAt: Date.now() };
  const bc = { entityType: "society", jurisdictionCode: "CA-BC", actFormedUnder: "societies_act" };
  const societyId = await store.insert("societies", { ...base, ...bc, name: "Written resolution society" });
  const foreignSocietyId = await store.insert("societies", { ...base, ...bc, name: "Foreign society" });
  const unknownSocietyId = await store.insert("societies", { ...base, ...bc, name: "Custom Act society", actFormedUnder: "unverified_special_act" });
  const onSocietyId = await store.insert("societies", { ...base, name: "Ontario company", entityType: "corporation__business_", jurisdictionCode: "CA-ON-OBCA", actFormedUnder: "business_corporations_act__ontario_", distributing: false });
  const user = { status: "Active", authIssuer: issuer, authProvider: provider, createdAtISO: clockISO };
  const member = { firstName: "Same", lastName: "Name", status: "Active", votingRights: true, membershipClass: "Regular", joinedAt: "2020-01-01" };
  const memberIds: string[] = [];
  for (let i = 0; i < 5; i++) memberIds.push(await store.insert("members", { ...member, societyId }));
  await store.insert("members", { ...member, societyId, votingRights: false });
  const foreignMemberId = await store.insert("members", { ...member, societyId: foreignSocietyId });
  const unknownMemberId = await store.insert("members", { ...member, societyId: unknownSocietyId });
  const ownerId = await store.insert("users", { ...user, societyId, role: "Owner", authSubject: "resolution-owner", email: "owner@example.test", displayName: "Recording officer" });
  await store.insert("users", { ...user, societyId, role: "Member", authSubject: "resolution-member", email: "member@example.test", displayName: "Member", memberId: memberIds[0] });
  await store.insert("users", { ...user, societyId: onSocietyId, role: "Owner", authSubject: "resolution-on-owner", email: "on@example.test", displayName: "Ontario officer" });
  await store.insert("users", { ...user, societyId: foreignSocietyId, role: "Owner", authSubject: "resolution-foreign-owner", email: "foreign@example.test", displayName: "Foreign officer" });
  await store.insert("users", { ...user, societyId: unknownSocietyId, role: "Owner", authSubject: "resolution-unknown-owner", email: "unknown@example.test", displayName: "Unknown Act officer" });
  const directors: string[] = [];
  for (let i = 0; i < 2; i++) directors.push(await store.insert("directors", { societyId, firstName: "Board", lastName: `Director ${i}`, position: "Director", status: "Active", termStart: "2026-01-01", isBCResident: true, consentOnFile: true }));
  const foreignDocumentId = await store.insert("documents", { societyId: foreignSocietyId, title: "Foreign consent", category: "Governance", createdAtISO: clockISO, flaggedForDeletion: false, tags: [] });
  const legacyId = await store.insert("writtenResolutions", { societyId, title: "Legacy carried claim", text: "Historic free-form claim", kind: "Ordinary", circulatedAtISO: "2025-01-01", completedAtISO: "2025-01-02", requiredCount: 1, status: "Carried", signatures: [{ signerName: "Unverified name", signedAtISO: "2025-01-02" }] });
  const provenance = { sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: clockISO, updatedAtISO: clockISO };
  const holder = { ...provenance, societyId: onSocietyId, roleType: "shareholder", status: "current", citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], controllingIndividualIds: [] };
  const holderIds: string[] = [];
  for (let i = 0; i < 3; i++) holderIds.push(await store.insert("roleHolders", { ...holder, fullName: `Legal shareholder ${i + 1}` }));
  const classBase = { ...provenance, societyId: onSocietyId, classType: "share", status: "active" };
  const common = await store.insert("rightsClasses", { ...classBase, className: "Common", votesPerShare: 1 });
  const superVoting = await store.insert("rightsClasses", { ...classBase, className: "Super voting", votesPerShare: 1000 });
  const nonVoting = await store.insert("rightsClasses", { ...classBase, className: "Non-voting", votesPerShare: 0 });
  const holdingIds: string[] = [];
  for (let i = 0; i < 3; i++) holdingIds.push(await store.insert("rightsHoldings", { ...provenance, societyId: onSocietyId, rightsClassId: i === 2 ? superVoting : common, holderRoleHolderId: holderIds[i], holderKey: `roleHolder:${holderIds[i]}`, quantity: i === 0 ? 4 : 3, status: "current" }));
  await store.insert("rightsHoldings", { ...provenance, societyId: onSocietyId, rightsClassId: nonVoting, holderRoleHolderId: holderIds[0], holderKey: `roleHolder:${holderIds[0]}`, quantity: 1000, status: "current" });
  return { societyId, onSocietyId, unknownSocietyId, ownerId, memberIds, foreignMemberId, unknownMemberId, directors, foreignDocumentId, legacyId, holderIds, holdingIds };
}

async function qualify(label: string, ids: Awaited<ReturnType<typeof seed>>, store: Store, actor: (subject: string) => Actor) {
  clockISO = "2026-10-11T20:00:00.000Z";
  const owner = actor("resolution-owner"), member = actor("resolution-member"), foreign = actor("resolution-foreign-owner"), on = actor("resolution-on-owner"), unknown = actor("resolution-unknown-owner");
  const create = (who: Actor, societyId: string, extra: any = {}) => who.mutation("create", { societyId, title: "Verified resolution", text: "Resolved that the reviewed action is approved.", kind: "Ordinary", ...evidence, ...extra });
  const record = async (who: Actor, societyId: string, id: string) => (await who.query("list", { societyId })).find((row: any) => row._id === id);
  const consent = (who: Actor, id: string, electorKey: string, signedAtISO = "2026-10-12T10:00:00.000Z", extra: any = {}) => who.mutation("sign", { id, electorKey, signedAtISO, consentEvidence: "Signed counterpart inspected and retained with verified voter identity.", ...extra });
  await assert.rejects(() => create(member, ids.societyId), /Permission|permission|authorized|authority/i);
  await assert.rejects(() => create(owner, ids.societyId, { requiredCount: 3 }), /statutory baseline \(4\)/);
  await assert.rejects(() => create(owner, ids.societyId, { circulatedAtISO: "2026-10-08T19:59:59.000Z" }), /within 72 hours/);
  await assert.rejects(() => create(owner, ids.societyId, { circulatedAtISO: "2026-10-12T12:00:00.000Z" }), /future/);
  await assert.rejects(() => create(owner, ids.societyId, { circulatedAtISO: "2026-02-31T12:00:00.000Z" }), /valid UTC timestamp/);
  const ordinaryId = await create(owner, ids.societyId);
  const specialId = await create(owner, ids.societyId, { kind: "Special" });
  const directorsId = await create(owner, ids.societyId, { body: "directors" });
  const unknownId = await create(unknown, ids.unknownSocietyId);
  const weightedId = await create(on, ids.onSocietyId, { body: "shareholders" });
  const chronologyId = await create(on, ids.onSocietyId, { body: "shareholders" });
  const higherId = await create(on, ids.onSocietyId, { body: "shareholders", requiredCount: 8 });
  const lateNoticeId = await create(on, ids.onSocietyId, { body: "shareholders" });
  await assert.rejects(() => create(on, ids.onSocietyId, { body: "shareholders", requiredCount: 5 }), /statutory baseline \(6\)/);
  const persisted = await store.get(ordinaryId);
  assert.equal(persisted.evidenceVersion, 2);
  assert.equal(persisted.recordDateISO, "2026-10-11", "Omitted record date must use the current reviewed date");
  assert.equal(persisted.circulatedAtISO, circulation);
  assert.equal(persisted.circulationRecordedAtISO, clockISO);
  assert.equal(persisted.circulationRecordedByUserId, ids.ownerId);
  assert.deepEqual(persisted.approvalRule, { numerator: 2, denominator: 3, strict: false, unit: "people", basis: "eligible" });
  assert.equal(persisted.electorate.length, 5, "Active nonvoters do not enter the ordinary written voting electorate");
  const ontario = await store.get(weightedId);
  assert.equal(ontario.countUnit, "shares");
  assert.equal(ontario.electorateTotal, 10, "Non-voting shares must not enlarge Ontario's eligible-share denominator");
  assert.equal(ontario.requiredCount, 6);
  assert.deepEqual(ontario.electorate.map((elector: any) => elector.weight).sort(), [3, 3, 4]);
  assert.equal((await record(owner, ids.societyId, ids.legacyId)).status, "Review required");
  assert.equal((await record(owner, ids.societyId, ids.legacyId)).originalStatus, "Carried");
  await assert.rejects(() => consent(owner, ids.legacyId, `member:${ids.memberIds[0]}`, circulation), /legacy record/);

  clockISO = "2026-10-20T20:00:00.000Z";
  const key = (i: number) => `member:${ids.memberIds[i]}`;
  await assert.rejects(() => consent(member, ordinaryId, key(0)), /Permission|permission|authorized|authority/i);
  await assert.rejects(() => consent(foreign, ordinaryId, key(0)), /Permission|permission|workspace|membership|authority|authorized/i);
  await assert.rejects(() => consent(owner, ordinaryId, `member:${ids.foreignMemberId}`), /frozen legal electorate/);
  await assert.rejects(() => consent(owner, ordinaryId, key(0), undefined, { consentDocumentId: ids.foreignDocumentId }), /not found|workspace|society/i);
  await assert.rejects(() => consent(owner, ordinaryId, key(0), undefined, { consentEvidence: "yes" }), /consent evidence/);
  await assert.rejects(() => consent(owner, ordinaryId, key(0), "2026-10-11T08:59:59.000Z"), /cannot precede/);
  await assert.rejects(() => consent(owner, ordinaryId, key(0), "2026-10-21T00:00:00.000Z"), /future/);
  await assert.rejects(() => consent(owner, ordinaryId, key(0), "2026-10-12"), /valid UTC timestamp/);
  await assert.rejects(() => consent(owner, ordinaryId, key(0), undefined, { memberId: ids.memberIds[1] }), /signer identity/);
  assert.equal((await store.get(ordinaryId)).signatures.length, 0, "Rejected evidence cannot partially mutate the minute-book record");
  for (let i = 0; i < 3; i++) await consent(owner, ordinaryId, key(i));
  assert.equal((await record(owner, ids.societyId, ordinaryId)).status, "Circulating", "Three of five is a majority but does not satisfy BC society ordinary written two-thirds");
  await store.patch(ids.memberIds[3], { status: "Inactive", votingRights: false });
  await consent(owner, ordinaryId, key(3), "2026-10-13T10:00:00.000Z");
  let result = await record(owner, ids.societyId, ordinaryId);
  assert.equal(result.status, "Carried");
  assert.equal(result.electorateTotal, 5, "Later register changes do not rewrite the frozen electorate");
  assert.equal(result.completedAtISO, "2026-10-13T10:00:00.000Z");
  assert.equal(result.signatures[0].signedAtISO, "2026-10-12T10:00:00.000Z");
  assert.equal(result.signatures[0].recordedAtISO, clockISO);
  assert.equal(result.signatures[0].recordedByUserId, ids.ownerId, "The recording officer is audited separately from the legal signer");
  await assert.rejects(() => consent(owner, ordinaryId, key(0)), /already recorded/);
  await assert.rejects(() => owner.mutation("remove", { id: ordinaryId }), /Keep resolutions/);
  await assert.rejects(() => owner.mutation("markFailed", { id: ordinaryId }), /cannot be failed/);
  for (let i = 0; i < 4; i++) await consent(owner, specialId, key(i));
  assert.equal((await record(owner, ids.societyId, specialId)).status, "Circulating", "Special written society resolutions need every eligible voter");
  await consent(owner, specialId, key(4));
  assert.equal((await record(owner, ids.societyId, specialId)).status, "Carried");
  await consent(owner, directorsId, `director:${ids.directors[0]}`);
  assert.equal((await record(owner, ids.societyId, directorsId)).status, "Circulating");
  await consent(owner, directorsId, `director:${ids.directors[1]}`);
  assert.equal((await record(owner, ids.societyId, directorsId)).status, "Carried");
  await consent(unknown, unknownId, `member:${ids.unknownMemberId}`);
  assert.equal((await record(unknown, ids.unknownSocietyId, unknownId)).status, "Review required", "An unknown Act cannot acquire an automated carried result even with all recorded consents");

  const shareholder = (i: number) => `shareholder:${ids.holderIds[i]}`;
  await consent(on, weightedId, shareholder(2));
  result = await record(on, ids.onSocietyId, weightedId);
  assert.equal(result.consentProgress.count, 3, "A holder with 3,000 votes has only three eligible shares for Ontario ordinary written consent");
  assert.equal(result.status, "Circulating");
  await store.patch(ids.holdingIds[0], { quantity: 400 });
  await consent(on, chronologyId, shareholder(0), "2026-10-13T10:00:00.000Z");
  assert.equal((await record(on, ids.onSocietyId, chronologyId)).consentProgress.count, 4);
  await consent(on, chronologyId, shareholder(1), "2026-10-14T10:00:00.000Z");
  result = await record(on, ids.onSocietyId, chronologyId);
  assert.equal(result.completedAtISO, "2026-10-14T10:00:00.000Z");
  assert.equal(result.completionRecordedAtISO, clockISO);
  assert.equal(result.nonSignerNoticeStatus, "Required");
  assert.deepEqual(result.noticeProgress.recipients.map((r: any) => r.key), [shareholder(2)]);
  const noticeEntry = { electorKey: shareholder(2), givenAtISO: "2026-10-15T12:00:00.000Z", evidence: "Individual written notice given with exact resolution, description and reasons; delivery proof retained." };
  const calendar = { dueDateISO: "2026-10-28", calendarEvidence: "Ontario Legislation Act holiday calendar checked; ten business days after October 14 ends October 28.", timeZone: "America/Toronto" };
  await assert.rejects(() => on.mutation("recordNotice", { id: chronologyId, notices: [{ ...noticeEntry, electorKey: `member:${ids.foreignMemberId}` }] }), /frozen notice audience/);
  await assert.rejects(() => on.mutation("recordNotice", { id: chronologyId, notices: [{ ...noticeEntry, documentId: ids.foreignDocumentId }] }), /not found|workspace|society/i);
  await assert.rejects(() => on.mutation("recordNotice", { id: chronologyId, notices: [{ ...noticeEntry, givenAtISO: "2026-10-13T12:00:00.000Z" }] }), /cannot precede/);
  await assert.rejects(() => on.mutation("recordNotice", { id: chronologyId, notices: [{ ...noticeEntry, givenAtISO: "2026-10-21T12:00:00.000Z" }] }), /future/);
  // The reviewed deadline must be the statutory tenth business day, allowing only for holidays.
  await assert.rejects(() => on.mutation("recordNotice", { id: chronologyId, notices: [], ...calendar, dueDateISO: "2099-01-01" }), /10th business day.*2026-10-28.*2026-11-04/);
  await assert.rejects(() => on.mutation("recordNotice", { id: chronologyId, notices: [], ...calendar, dueDateISO: "2026-10-27" }), /10th business day/);
  await on.mutation("recordNotice", { id: chronologyId, notices: [noticeEntry] });
  assert.equal((await record(on, ids.onSocietyId, chronologyId)).nonSignerNoticeStatus, "Deadline review required", "Notice coverage alone cannot certify business-day timing");
  await on.mutation("recordNotice", { id: chronologyId, notices: [], ...calendar });
  result = await record(on, ids.onSocietyId, chronologyId);
  assert.equal(result.nonSignerNoticeStatus, "Complete");
  // A stored far-future "reviewed" deadline cannot certify timely notice.
  await store.patch(chronologyId, { nonSignerNoticeDueDateISO: "2099-01-01" });
  assert.equal((await record(on, ids.onSocietyId, chronologyId)).nonSignerNoticeStatus, "Deadline review required");
  await store.patch(chronologyId, { nonSignerNoticeDueDateISO: calendar.dueDateISO });
  assert.equal(result.nonSignerNotices[0].givenAtISO, noticeEntry.givenAtISO);
  assert.equal(result.nonSignerNotices[0].recordedAtISO, clockISO);

  // An earlier consent entered later moves the actual majority event earlier.
  await consent(on, chronologyId, shareholder(2), "2026-10-12T10:00:00.000Z");
  result = await record(on, ids.onSocietyId, chronologyId);
  assert.equal(result.completedAtISO, "2026-10-13T10:00:00.000Z");
  assert.equal(result.completionHistory.length, 2);
  assert.equal(result.noticeProgress.deadlineReviewed, false, "A changed majority date invalidates the old deadline review");
  assert.equal(result.noticeProgress.recordedCount, 0);
  assert.deepEqual(result.noticeProgress.recipients.map((r: any) => r.key), [shareholder(1)], "Notice audience is based on signatures as of the actual majority event");
  await on.mutation("recordNotice", { id: chronologyId, notices: [{ ...noticeEntry, electorKey: shareholder(1) }], ...calendar, dueDateISO: "2026-10-27", calendarEvidence: "Re-reviewed actual October 13 majority event against Ontario holidays; tenth business day October 27." });
  result = await record(on, ids.onSocietyId, chronologyId);
  assert.equal(result.nonSignerNoticeStatus, "Complete");
  assert.equal(result.nonSignerNotices.length, 2, "Earlier notice evidence remains preserved after the audience changes");

  await consent(on, higherId, shareholder(0), "2026-10-13T10:00:00.000Z");
  await consent(on, higherId, shareholder(1), "2026-10-14T10:00:00.000Z");
  result = await record(on, ids.onSocietyId, higherId);
  assert.equal(result.status, "Circulating");
  assert.equal(result.nonSignerNoticeStatus, "Required", "A higher articles threshold does not silently postpone the conservative statutory-majority notice clock");
  assert.equal(result.nonSignerNoticeTriggeredAtISO, "2026-10-14T10:00:00.000Z");
  await on.mutation("recordNotice", { id: higherId, notices: [noticeEntry], ...calendar });
  await consent(on, higherId, shareholder(2), "2026-10-16T10:00:00.000Z");
  result = await record(on, ids.onSocietyId, higherId);
  assert.equal(result.completedAtISO, "2026-10-16T10:00:00.000Z");
  assert.equal(result.nonSignerNoticeTriggeredAtISO, "2026-10-14T10:00:00.000Z");
  assert.equal(result.noticeProgress.requiredCount, 1, "A later consent does not erase the original notice audience");

  await consent(on, lateNoticeId, shareholder(0), "2026-10-13T10:00:00.000Z");
  await consent(on, lateNoticeId, shareholder(1), "2026-10-14T10:00:00.000Z");
  await on.mutation("recordNotice", { id: lateNoticeId, notices: [], ...calendar });
  await store.patch(ordinaryId, { requiredCount: 1 });
  assert.equal((await record(owner, ids.societyId, ordinaryId)).status, "Review required", "A corrupted lowered threshold cannot preserve a carried conclusion");
  await assert.rejects(() => consent(owner, ordinaryId, key(4)), /verified electorate/);
  clockISO = "2026-10-30T20:00:00.000Z";
  assert.equal((await record(on, ids.onSocietyId, lateNoticeId)).noticeProgress.overdue, true);
  await on.mutation("recordNotice", { id: lateNoticeId, notices: [{ ...noticeEntry, givenAtISO: "2026-10-29T12:00:00.000Z" }] });
  result = await record(on, ids.onSocietyId, lateNoticeId);
  assert.equal(result.nonSignerNoticeStatus, "Complete late");
  assert.equal(result.noticeProgress.lateCount, 1);
  console.log(`${label}: frozen legal electorate and approval rule, two-thirds society ordinary consent, unanimous special/director consent, eligible-share Ontario majority, authenticated evidence entry, actual chronology, legacy review and individual Ontario notice timing passed.`);
}

try {
  const native = convexTest(schema, { "./_generated/api.js": () => import("../convex/_generated/api.js"), "./_generated/server.js": () => import("../convex/_generated/server.js"), "./writtenResolutions.js": () => import("../convex/writtenResolutions") } as any);
  const issuer = betterAuthIssuer();
  const nativeStore: Store = {
    insert: (table, doc) => native.run((ctx) => ctx.db.insert(table as any, doc)),
    patch: (id, patch) => native.run((ctx) => ctx.db.patch(id as any, patch)),
    get: (id) => native.run((ctx) => ctx.db.get(id as any)),
  };
  const nativeIds = await seed(nativeStore, issuer, "better-auth");
  await qualify("Native Convex", nativeIds, nativeStore, (subject) => {
    const actor = native.withIdentity({ subject, issuer });
    return { mutation: (name, args) => actor.mutation((api.writtenResolutions as any)[name], args), query: (name, args) => actor.query((api.writtenResolutions as any)[name], args) };
  });
  for (const label of ["MemoryDb", "LocalStoreDb"]) {
    clockISO = "2026-10-11T20:00:00.000Z";
    const db = label === "MemoryDb" ? new MemoryDb() : new LocalStoreDb(new MemoryRowStore());
    const store: Store = { insert: (table, doc) => db.transaction(() => db.insert(table, doc)), patch: (id, patch) => db.transaction(() => db.patch(id, patch)), get: (id) => db.get(id) };
    const ids = await seed(store, PORTABLE_TEST_IDENTITY.issuer, "portable-fixture");
    await qualify(label, ids, store, (subject) => {
      const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: "user", runtime: "test", assurance: "verified-jwt", issuer: PORTABLE_TEST_IDENTITY.issuer, subject }) });
      runtime.registerAll([
        ...["create", "sign", "recordNotice", "markFailed", "remove"].map((name) => ({ ...definePortableMutation({ name: `writtenResolutions:${name}`, handler: (handlers as any)[`${name}Portable`] }), applicationPolicy: true })),
        ...["list", "preview"].map((name) => ({ ...definePortableQuery({ name: `writtenResolutions:${name}`, handler: (handlers as any)[`${name}Portable`] }), applicationPolicy: true })),
      ]);
      return { mutation: (name, args) => runtime.runMutation(`writtenResolutions:${name}`, args), query: (name, args) => runtime.runQuery(`writtenResolutions:${name}`, args) };
    });
  }
} finally { globalThis.Date = RealDate; }
