import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { MemoryDb, LocalStoreDb, MemoryRowStore, PortableRuntime, makeCapabilities, definePortableMutation, definePortableQuery } from "../shared/portable/index";
import * as handlers from "../shared/functions/writtenResolutions";
import { overviewPortable } from "../shared/functions/minuteBook";
import { requiredWrittenConsents, writtenResolutionRule } from "../shared/legalGovernanceProfiles";
import { noticeDueDateWindow, resolutionTimeZone } from "../shared/writtenResolutionEvidence";
import { PORTABLE_TEST_IDENTITY } from "./portable-test-fixture";

// Review findings: split director registers, evening BC circulation, record-date
// lower bound, the Societies Act s. 1 (c) votes-cast route, a reviewed directors'
// override and minute-book status consistency.
const RealDate = Date;
let clockISO = "2026-10-12T00:30:00.000Z"; // 5:30 pm PDT on October 11
class Clock extends RealDate {
  constructor(...args: unknown[]) { super(...((args.length ? args : [clockISO]) as [])); }
  static now() { return new RealDate(clockISO).getTime(); }
}
globalThis.Date = Clock as DateConstructor;

type Actor = { mutation(name: string, args: any): Promise<any>; query(name: string, args: any): Promise<any>; overview(societyId: string): Promise<any> };
type Store = { insert(table: string, doc: any): Promise<any>; patch(id: string, patch: any): Promise<void>; get(id: string): Promise<any> };
const evidence = {
  governingInstrumentEvidence: "Current constitution and bylaws reviewed, including any higher approval requirement.",
  electorateEvidence: "Complete register verified on the circulation date, with identity and voting authority checked.",
  circulationEvidence: "The exact final resolution was circulated to every eligible voter, with dispatch records retained.",
  authorityReviewed: true,
};
const consentEvidence = "Signed counterpart inspected and retained with verified voter identity.";

// Pure rule checks: (c) thresholds count votes cast; overrides are opt-in only.
const bcSociety = { entityType: "society", jurisdictionCode: "CA-BC", actFormedUnder: "societies_act" };
const ordinaryVote = writtenResolutionRule(bcSociety, "Ordinary", "members", { route: "mail_electronic_vote" })!;
assert.deepEqual([ordinaryVote.numerator, ordinaryVote.denominator, ordinaryVote.strict, ordinaryVote.basis], [1, 2, true, "votes_cast"]);
assert.equal(requiredWrittenConsents(4, ordinaryVote), 3, "A tie is not a simple majority of votes cast");
const specialVote = writtenResolutionRule(bcSociety, "Special", "members", { route: "mail_electronic_vote" })!;
assert.equal(requiredWrittenConsents(3, specialVote), 2);
assert.equal(writtenResolutionRule(bcSociety, "Ordinary", "directors")?.unanimous, true, "Directors' written consent stays unanimous by default");
assert.equal(writtenResolutionRule({ entityType: "corporation__business_", jurisdictionCode: "CA-ON-OBCA", actFormedUnder: "business_corporations_act__ontario_" }, "Ordinary", "directors", { directorsOverride: { numerator: 2, denominator: 3 } }), undefined);
assert.equal(writtenResolutionRule(bcSociety, "Ordinary", "members", { route: "mail_electronic_vote" })?.route, "mail_electronic_vote");
assert.equal(writtenResolutionRule({ entityType: "corporation__business_", jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act" }, "Ordinary", "shareholders", { route: "mail_electronic_vote" }), undefined);
assert.equal(resolutionTimeZone(bcSociety), "America/Vancouver");
assert.equal(resolutionTimeZone({ entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act" }), "America/Toronto");
assert.equal(resolutionTimeZone({ entityType: "corporation__business_", jurisdictionCode: "CA-ON-OBCA", actFormedUnder: "business_corporations_act__ontario_" }), "America/Toronto");
assert.deepEqual(noticeDueDateWindow("2026-10-14", 10), { earliestISO: "2026-10-28", latestISO: "2026-11-04" });

async function seed(store: Store, issuer: string, provider: string) {
  const base = { isCharity: false, isMemberFunded: false, updatedAt: Date.now() };
  const society = (name: string) => store.insert("societies", { ...base, ...bcSociety, name });
  const splitId = await society("Split register society");
  const rolesOnlyId = await society("Role-holder director society");
  const linkedId = await society("Linked register society");
  const onId = await store.insert("societies", { ...base, name: "Ontario company", entityType: "corporation__business_", jurisdictionCode: "CA-ON-OBCA", actFormedUnder: "business_corporations_act__ontario_", distributing: false });
  const user = { status: "Active", authIssuer: issuer, authProvider: provider, createdAtISO: clockISO, role: "Owner" };
  const bcCoId = await store.insert("societies", { ...base, name: "BC company", entityType: "corporation__business_", jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act" });
  for (const [societyId, subject] of [[splitId, "split-owner"], [rolesOnlyId, "roles-owner"], [linkedId, "linked-owner"], [onId, "on-owner"], [bcCoId, "bcco-owner"]]) {
    await store.insert("users", { ...user, societyId, authSubject: subject, email: `${subject}@example.test`, displayName: subject });
  }
  const memberIds: string[] = [];
  for (let i = 0; i < 5; i++) memberIds.push(await store.insert("members", { societyId: splitId, firstName: "Voting", lastName: `Member ${i}`, status: "Active", votingRights: true, membershipClass: "Regular", joinedAt: "2020-01-01" }));
  const director = (societyId: string, i: number, directoryPersonId?: string) => store.insert("directors", { societyId, firstName: "Board", lastName: `Director ${i}`, position: "Director", status: "Active", termStart: "2026-01-01", isBCResident: true, consentOnFile: true, ...(directoryPersonId ? { directoryPersonId } : {}) });
  const provenance = { sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: clockISO, updatedAtISO: clockISO, citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], controllingIndividualIds: [] };
  const roleDirector = (societyId: string, i: number, directoryPersonId?: string) => store.insert("roleHolders", { ...provenance, societyId, roleType: "director", status: "current", fullName: `Role director ${i}`, ...(directoryPersonId ? { directoryPersonId } : {}) });
  // One Active `directors` row while the three real directors are recorded as role holders.
  await director(splitId, 0);
  for (let i = 0; i < 3; i++) await roleDirector(splitId, i);
  const roleDirectorIds: string[] = [];
  for (let i = 0; i < 3; i++) roleDirectorIds.push(await roleDirector(rolesOnlyId, i));
  for (let i = 0; i < 2; i++) {
    const person = await store.insert("peopleDirectory", { societyId: linkedId, fullName: `Linked person ${i}`, searchName: `linked person ${i}`, createdAtISO: clockISO, updatedAtISO: clockISO });
    await director(linkedId, i, person);
    await roleDirector(linkedId, i, person);
  }
  const holder = await store.insert("roleHolders", { ...provenance, societyId: onId, roleType: "shareholder", status: "current", fullName: "Ontario holder" });
  const common = await store.insert("rightsClasses", { societyId: onId, className: "Common", classType: "share", status: "active", votesPerShare: 1, sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: clockISO, updatedAtISO: clockISO });
  await store.insert("rightsHoldings", { societyId: onId, rightsClassId: common, holderRoleHolderId: holder, holderKey: `roleHolder:${holder}`, quantity: 10, status: "current", sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: clockISO, updatedAtISO: clockISO });
  const bcHolder = await store.insert("roleHolders", { ...provenance, societyId: bcCoId, roleType: "shareholder", status: "current", fullName: "BC holder" });
  const bcCommon = await store.insert("rightsClasses", { societyId: bcCoId, className: "Common", classType: "share", status: "active", votesPerShare: 1, sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: clockISO, updatedAtISO: clockISO });
  await store.insert("rightsHoldings", { societyId: bcCoId, rightsClassId: bcCommon, holderRoleHolderId: bcHolder, holderKey: `roleHolder:${bcHolder}`, quantity: 10, status: "current", sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: clockISO, updatedAtISO: clockISO });
  return { splitId, rolesOnlyId, linkedId, onId, bcCoId, memberIds, roleDirectorIds };
}

async function qualify(label: string, ids: Awaited<ReturnType<typeof seed>>, store: Store, actor: (subject: string) => Actor) {
  clockISO = "2026-10-12T00:30:00.000Z";
  const split = actor("split-owner"), roles = actor("roles-owner"), linked = actor("linked-owner"), on = actor("on-owner");
  const create = (who: Actor, societyId: string, extra: any = {}) => who.mutation("create", { societyId, title: "Reviewed resolution", text: "Resolved that the reviewed action is approved.", kind: "Ordinary", circulatedAtISO: "2026-10-11T23:30:00.000Z", ...evidence, ...extra });
  const record = async (who: Actor, societyId: string, id: string) => (await who.query("list", { societyId })).find((row: any) => row._id === id);
  const sign = (who: Actor, id: string, electorKey: string, signedAtISO: string, extra: any = {}) => who.mutation("sign", { id, electorKey, signedAtISO, consentEvidence, ...extra });

  // Evening circulation in BC: 4:30 pm PDT is already the next UTC day when recorded at 5:30 pm.
  const evening = await create(split, ids.splitId, { recordDateISO: "2026-10-11" });
  const stored = await store.get(evening);
  assert.equal(stored.recordDateISO, "2026-10-11");
  assert.equal(stored.circulationTimeZone, "America/Vancouver");
  assert.equal((await create(split, ids.splitId)).length > 0, true, "An omitted record date is the local circulation date");
  assert.equal((await store.get((await split.query("list", { societyId: ids.splitId })).at(-1)._id)).recordDateISO, "2026-10-11");
  await assert.rejects(() => create(split, ids.splitId, { recordDateISO: "2026-10-12" }), /cannot follow circulation on 2026-10-11 \(America\/Vancouver\)/);
  await assert.rejects(() => create(split, ids.splitId, { recordDateISO: "2026-10-10" }), /record date must be the circulation date/);
  // Elapsed-time bound instead of a UTC calendar-date rule.
  await assert.rejects(() => create(split, ids.splitId, { circulatedAtISO: "2026-10-08T23:00:00.000Z" }), /within 72 hours/);
  await assert.rejects(() => create(split, ids.splitId, { circulatedAtISO: "2026-10-12T00:31:00.000Z" }), /future/);
  await create(split, ids.splitId, { circulatedAtISO: "2026-10-09T01:00:00.000Z", recordDateISO: "2026-10-08" });

  // Split director registers must be reconciled before a board electorate is frozen.
  const splitPreview = await split.query("preview", { societyId: ids.splitId, body: "directors", kind: "Ordinary", circulatedAtISO: "2026-10-11T23:30:00.000Z" });
  assert.equal(splitPreview.electorate.length, 4);
  assert.ok(splitPreview.issues.some((issue: string) => /disagree: 1 active director entries .* 3 current director role holders/.test(issue)));
  await assert.rejects(() => create(split, ids.splitId, { body: "directors" }), /registers? disagree/);
  const linkedPreview = await linked.query("preview", { societyId: ids.linkedId, body: "directors", kind: "Ordinary" });
  assert.equal(linkedPreview.electorate.length, 2, "Directory-linked directors are counted once across both registers");
  assert.deepEqual(linkedPreview.issues, []);
  const board = await create(roles, ids.rolesOnlyId, { body: "directors" });
  assert.deepEqual((await store.get(board)).electorate.map((row: any) => row.key).sort(), ids.roleDirectorIds.map((id) => `roleHolder:${id}`).sort());
  await sign(roles, board, `roleHolder:${ids.roleDirectorIds[0]}`, "2026-10-12T00:00:00.000Z");
  assert.equal((await record(roles, ids.rolesOnlyId, board)).status, "Circulating", "One consent of three role-holder directors cannot carry");
  for (const i of [1, 2]) await sign(roles, board, `roleHolder:${ids.roleDirectorIds[i]}`, "2026-10-12T00:00:00.000Z");
  assert.equal((await record(roles, ids.rolesOnlyId, board)).status, "Carried");

  // Reviewed directors' override: Societies Act s. 54(2)(b) needs governing-instrument evidence.
  const overrideArgs = { body: "directors", directorsOverride: { numerator: 2, denominator: 3 } };
  await assert.rejects(() => create(roles, ids.rolesOnlyId, overrideArgs), /clause that sets the lesser directors' threshold/);
  await assert.rejects(() => create(roles, ids.rolesOnlyId, { ...overrideArgs, directorsOverride: { numerator: 3, denominator: 3 }, directorsOverrideEvidence: "Bylaw 4.7 permits two-thirds of directors to consent." }), /below unanimity/);
  await assert.rejects(() => create(on, ids.onId, { ...overrideArgs, directorsOverrideEvidence: "By-law 4.7 permits two-thirds of directors to consent." }), /every director entitled to vote/);
  const overrideId = await create(roles, ids.rolesOnlyId, { ...overrideArgs, directorsOverrideEvidence: "Bylaw 4.7 (2024 version) permits two-thirds of directors to consent in writing." });
  const overrideRow = await store.get(overrideId);
  assert.equal(overrideRow.requiredCount, 2);
  assert.deepEqual(overrideRow.citationIds, ["BC-SOC-DIRECTORS-WRITTEN"]);
  assert.equal(overrideRow.approvalOverride.kind, "directors_governing_instrument");
  for (const i of [0, 1]) await sign(roles, overrideId, `roleHolder:${ids.roleDirectorIds[i]}`, `2026-10-12T00:0${i}:00.000Z`);
  assert.equal((await record(roles, ids.rolesOnlyId, overrideId)).status, "Carried");
  await store.patch(overrideId, { approvalOverride: { ...overrideRow.approvalOverride, evidence: "" } });
  assert.equal((await record(roles, ids.rolesOnlyId, overrideId)).status, "Review required", "An override without its clause evidence cannot support passage");

  // Record-date lower bound: an 18-month-old register would make former holders the electorate.
  // BC company: two-thirds is a default to check against the articles, never silently applied.
  const bcco = actor("bcco-owner");
  const unchecked = await bcco.query("preview", { societyId: ids.bcCoId, body: "shareholders", kind: "Ordinary" });
  assert.ok(unchecked.issues.some((issue: string) => /Confirm the special majority in the company's articles/.test(issue)));
  const checked = await bcco.query("preview", { societyId: ids.bcCoId, body: "shareholders", kind: "Ordinary", specialMajority: "two_thirds" });
  assert.ok(!checked.issues.some((issue: string) => /Confirm the special majority/.test(issue)));
  assert.ok(checked.reviewNotes.some((note: string) => /statutory default special majority/.test(note)));
  await assert.rejects(() => create(bcco, ids.bcCoId, { body: "shareholders" }), /Confirm the special majority/);
  const old = await on.query("preview", { societyId: ids.onId, body: "shareholders", kind: "Ordinary", specialMajority: undefined, recordDateISO: "2025-04-11", circulatedAtISO: "2026-10-11T23:30:00.000Z" });
  assert.ok(old.issues.some((issue: string) => /more than 60 days before the circulation on 2026-10-11/.test(issue)));
  assert.ok(old.reviewNotes.some((note: string) => /conservative bound/.test(note)));
  await assert.rejects(() => create(on, ids.onId, { body: "shareholders", recordDateISO: "2025-04-11" }), /more than 60 days before the circulation.*on or after 2026-08-12/);

  // Societies Act s. 1 (c): bylaws authorize voting by mail or electronic means.
  const key = (i: number) => `member:${ids.memberIds[i]}`;
  const voteArgs = { route: "mail_electronic_vote", votingRouteEvidence: "Bylaw 9.3 authorizes electronic voting through the verified member portal.", votingClosesAtISO: "2026-10-13T23:30:00.000Z" };
  await assert.rejects(() => create(split, ids.splitId, { ...voteArgs, votingRouteEvidence: "" }), /authorizes voting by mail or electronic means/);
  await assert.rejects(() => create(split, ids.splitId, { ...voteArgs, votingClosesAtISO: "2026-10-11T23:00:00.000Z" }), /after circulation/);
  await assert.rejects(() => create(on, ids.onId, { ...voteArgs, body: "shareholders" }), /applies only to BC society member resolutions/);
  const ordinaryVote = await create(split, ids.splitId, voteArgs);
  const specialVote = await create(split, ids.splitId, { ...voteArgs, kind: "Special" });
  await assert.rejects(() => sign(split, ordinaryVote, key(0), "2026-10-12T00:00:00.000Z"), /for or against/);
  await assert.rejects(() => sign(split, evening, key(0), "2026-10-12T00:00:00.000Z", { vote: "against" }), /records consents only/);
  await sign(split, ordinaryVote, key(0), "2026-10-12T00:00:00.000Z", { vote: "for" });
  await sign(split, ordinaryVote, key(1), "2026-10-12T00:10:00.000Z", { vote: "for" });
  await sign(split, ordinaryVote, key(2), "2026-10-12T00:20:00.000Z", { vote: "against" });
  await sign(split, specialVote, key(0), "2026-10-12T00:00:00.000Z", { vote: "for" });
  await sign(split, specialVote, key(1), "2026-10-12T00:10:00.000Z", { vote: "against" });
  let row = await record(split, ids.splitId, ordinaryVote);
  assert.equal(row.status, "Circulating", "A votes-cast result is not decided while voting is open");
  assert.deepEqual([row.voteProgress.count, row.voteProgress.against, row.voteProgress.requiredCount], [2, 1, 2]);
  await assert.rejects(() => split.mutation("certifyVoteCount", { id: ordinaryVote, evidence: "Scrutineer report of all electronic votes cast." }), /after voting closes/);
  clockISO = "2026-10-14T01:00:00.000Z";
  await assert.rejects(() => sign(split, ordinaryVote, key(3), "2026-10-14T00:00:00.000Z", { vote: "against" }), /after voting closed/);
  assert.equal((await record(split, ids.splitId, ordinaryVote)).status, "Count certification required");
  await assert.rejects(() => split.mutation("certifyVoteCount", { id: ordinaryVote, evidence: "ok" }), /scrutineer or officer report/);
  assert.equal((await split.mutation("certifyVoteCount", { id: ordinaryVote, evidence: "Scrutineer report: three electronic votes cast, none rejected." })).status, "Carried");
  row = await record(split, ids.splitId, ordinaryVote);
  assert.equal(row.status, "Carried");
  assert.equal(row.passageDateVerified, true);
  assert.equal(row.completedAtISO, voteArgs.votingClosesAtISO);
  await assert.rejects(() => sign(split, ordinaryVote, key(3), "2026-10-12T00:30:00.000Z", { vote: "for" }), /certified/);
  assert.equal((await split.mutation("certifyVoteCount", { id: specialVote, evidence: "Scrutineer report: two electronic votes cast, none rejected." })).status, "Failed", "One of two votes cast is below two-thirds");

  // Minute book and Written resolutions agree on an unverified "Carried" record.
  await store.patch(board, { requiredCount: 1 });
  assert.equal((await record(roles, ids.rolesOnlyId, board)).status, "Review required");
  const overview = await roles.overview(ids.rolesOnlyId);
  const bundle = overview.recordBundles.find((entry: any) => entry.key === `writtenResolution:${board}`);
  assert.equal(bundle.status, "Review required");
  assert.ok(!bundle.badges.some((entry: any) => entry.label === "carried"));
  assert.equal(overview.writtenResolutions.find((entry: any) => entry._id === board).status, "Review required");
  const carriedBundle = (await roles.overview(ids.rolesOnlyId)).recordBundles.find((entry: any) => entry.key === `writtenResolution:${overrideId}`);
  assert.equal(carriedBundle.status, "Review required");
  console.log(`${label}: split director registers, evening BC circulation, 72-hour recording window, record-date lower bound, s. 1 (c) votes-cast route, reviewed directors' override and minute-book status consistency passed.`);
}

try {
  const native = convexTest(schema, { "./_generated/api.js": () => import("../convex/_generated/api.js"), "./_generated/server.js": () => import("../convex/_generated/server.js"),
    "./writtenResolutions.js": () => import("../convex/writtenResolutions"), "./minuteBook.js": () => import("../convex/minuteBook") } as any);
  const issuer = betterAuthIssuer();
  const nativeStore: Store = {
    insert: (table, doc) => native.run((ctx) => ctx.db.insert(table as any, doc)),
    patch: (id, patch) => native.run((ctx) => ctx.db.patch(id as any, patch)),
    get: (id) => native.run((ctx) => ctx.db.get(id as any)),
  };
  await qualify("Native Convex", await seed(nativeStore, issuer, "better-auth"), nativeStore, (subject) => {
    const actor = native.withIdentity({ subject, issuer });
    return { mutation: (name, args) => actor.mutation((api.writtenResolutions as any)[name], args), query: (name, args) => actor.query((api.writtenResolutions as any)[name], args),
      overview: (societyId) => actor.query(api.minuteBook.overview, { societyId: societyId as any }) };
  });
  for (const label of ["MemoryDb", "LocalStoreDb"]) {
    clockISO = "2026-10-12T00:30:00.000Z";
    const db = label === "MemoryDb" ? new MemoryDb() : new LocalStoreDb(new MemoryRowStore());
    const store: Store = { insert: (table, doc) => db.transaction(() => db.insert(table, doc)), patch: (id, patch) => db.transaction(() => db.patch(id, patch)), get: (id) => db.get(id) };
    const ids = await seed(store, PORTABLE_TEST_IDENTITY.issuer, "portable-fixture");
    await qualify(label, ids, store, (subject) => {
      const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: "user", runtime: "test", assurance: "verified-jwt", issuer: PORTABLE_TEST_IDENTITY.issuer, subject }) });
      runtime.registerAll([
        ...["create", "sign", "certifyVoteCount", "recordNotice", "markFailed", "remove"].map((name) => ({ ...definePortableMutation({ name: `writtenResolutions:${name}`, handler: (handlers as any)[`${name}Portable`] }), applicationPolicy: true })),
        ...["list", "preview"].map((name) => ({ ...definePortableQuery({ name: `writtenResolutions:${name}`, handler: (handlers as any)[`${name}Portable`] }), applicationPolicy: true })),
        { ...definePortableQuery({ name: "minuteBook:overview", handler: overviewPortable }), applicationPolicy: true },
      ]);
      return { mutation: (name, args) => runtime.runMutation(`writtenResolutions:${name}`, args), query: (name, args) => runtime.runQuery(`writtenResolutions:${name}`, args),
        overview: (societyId) => runtime.runQuery("minuteBook:overview", { societyId }) };
    });
  }
} finally { globalThis.Date = RealDate; }
