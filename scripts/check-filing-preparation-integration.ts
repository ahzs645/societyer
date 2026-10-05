import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { toPortableQueryCtx } from "../convex/lib/portable";
import { buildFilingPacketPortable } from "../shared/functions/filingBot";
import { societiesOnlinePreFillPortable, craPreFillPortable } from "../shared/functions/filingExports";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { STATIC_DEMO_SOCIETY_ID } from "../src/lib/staticIds";
import { bcSocietyPreparationKind, bcSocietyBotKind, filingDueDateMonthsAfter } from "../shared/filingPreparation";

const native = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./filingExports.js": () => import("../convex/filingExports"),
  "./filingBot.js": () => import("../convex/filingBot"),
  "./accounting.js": () => import("../convex/accounting"),
});
const issuer = betterAuthIssuer();
const fixture = await native.run(async ctx => {
  const base = { isCharity: false, isMemberFunded: false, updatedAt: 0 };
  const societyId = await ctx.db.insert("societies", { ...base, name: "BC society", entityType: "society", actFormedUnder: "societies_act", jurisdictionCode: "CA-BC" });
  const corporationId = await ctx.db.insert("societies", { ...base, name: "Federal corporation", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act", jurisdictionCode: "CA-FED-CBCA" });
  const foreignId = await ctx.db.insert("societies", { ...base, name: "Foreign BC society", entityType: "society", actFormedUnder: "societies_act", jurisdictionCode: "CA-BC" });
  let adminUserId: any;
  for (const [subject, role] of [["filing-admin", "Admin"], ["filing-viewer", "Viewer"], ["filing-member", "Member"]]) {
    for (const target of [societyId, corporationId]) { const userId = await ctx.db.insert("users", { societyId: target, displayName: subject, email: `${subject}@fixture.example`, role, status: "Active", authIssuer: issuer, authSubject: subject, createdAtISO: new Date().toISOString() }); if (target === societyId && role === "Admin") adminUserId = userId; }
  }
  await ctx.db.insert("directors", { societyId, firstName: "Alex", lastName: "Operator", position: "Director", status: "Active", isBCResident: true, consentOnFile: true, termStart: "2026-01-01" });
  await ctx.db.insert("financials", { societyId, fiscalYear: "2026", periodEnd: "2026-08-31", revenueCents: 120000, expensesCents: 40000, netAssetsCents: 80000, auditStatus: "Unaudited", remunerationDisclosures: [] });
  const filingId = await ctx.db.insert("filings", { societyId, kind: "BCSocietyAnnualReport", dueDate: "2026-12-31", status: "Upcoming" });
  return { societyId, corporationId, foreignId, filingId, adminUserId };
});
const admin = native.withIdentity({ issuer, subject: "filing-admin" });
const viewer = native.withIdentity({ issuer, subject: "filing-viewer" });
const member = native.withIdentity({ issuer, subject: "filing-member" });
for (const [query, args] of [[api.accounting.exportCsv, { societyId: fixture.societyId, kind: "chart_of_accounts" }], [api.accounting.boardAuditorPackage, { societyId: fixture.societyId, fiscalYear: "2026" }]] as const) {
  await assert.rejects(() => viewer.query(query as any, args as any), /exports:download/);
  await assert.rejects(() => member.query(query as any, args as any));
  await assert.rejects(() => admin.query(query as any, { ...args, societyId: fixture.foreignId } as any));
  assert.ok(await admin.query(query as any, args as any));
}
await native.run(async ctx => {
  const portable = await toPortableQueryCtx(ctx);
  const args = { societyId: String(fixture.societyId), kind: "AnnualReport" };
  const scoped = (scopes: string[]) => ({ ...portable, principal: { kind: "service" as const, runtime: "test" as const, assurance: "trusted-internal" as const, subject: "filing-service", societyId: args.societyId, actorUserId: String(fixture.adminUserId), scopes } });
  await assert.rejects(() => buildFilingPacketPortable(scoped(["documents:read"]), args), /Service scope filings:read required/);
  await assert.rejects(() => buildFilingPacketPortable(scoped(["filings:read"]), args), /Service scope society:read required/);
  const combined = ["filings:read", "society:read", "directors:read", "members:read", "meetings:read", "minutes:read"];
  assert.equal((await buildFilingPacketPortable(scoped(combined), args)).form, "BC-Societies-Form-11");
  for (const missing of combined.slice(1)) await assert.rejects(() => buildFilingPacketPortable(scoped(combined.filter(scope => scope !== missing)), args), new RegExp(`Service scope ${missing} required`));
  await assert.rejects(() => societiesOnlinePreFillPortable(scoped(["filings:read", "society:read"]), args), /Service scope directors:read required/);
  await assert.rejects(() => craPreFillPortable(scoped(["filings:read", "society:read"]), { ...args, kind: "T2", fiscalYear: "2026" }), /Service scope financials:read required/);
  assert.equal((await societiesOnlinePreFillPortable(scoped(combined), args)).formName, "BC Societies Annual Report");
});
const runId = await admin.mutation(internal.filingBot._createRun, { societyId: fixture.societyId, filingId: fixture.filingId, kind: "BCSocietyAnnualReport", demo: false });
const run = await native.run(ctx => ctx.db.get(runId));
assert.equal(run?.kind, "AnnualReport");
assert.equal(run?.steps.length, 6);
await assert.rejects(() => admin.mutation(internal.filingBot._createRun, { societyId: fixture.societyId, filingId: fixture.filingId, kind: "Unsupported", demo: false }), /Unsupported/);
assert.equal((await native.run(ctx => ctx.db.query("filingBotRuns").collect())).length, 1, "Unsupported preparation must not queue an empty run.");
const annual = await admin.query(api.filingExports.societiesOnlinePreFill, { societyId: fixture.societyId, kind: "BCSocietyAnnualReport" });
assert.equal(annual.formName, "BC Societies Annual Report");
const packet = await viewer.query(api.filingBot.buildFilingPacket, { societyId: fixture.societyId, kind: "BCSocietyAnnualReport" });
assert.equal(packet.form, "BC-Societies-Form-11");
assert.equal(packet.directors[0].name, "Alex Operator");
for (const query of [api.filingExports.societiesOnlinePreFill, api.filingBot.buildFilingPacket]) {
  await assert.rejects(() => admin.query(query, { societyId: fixture.corporationId, kind: "AnnualReport" }), /only for a BC society/);
  await assert.rejects(() => admin.query(query, { societyId: fixture.foreignId, kind: "AnnualReport" }));
  await assert.rejects(() => member.query(query, { societyId: fixture.societyId, kind: "AnnualReport" }));
  await assert.rejects(() => admin.query(query, { societyId: fixture.societyId, kind: "unsupported" }), /Unsupported/);
}
const tax = await admin.query(api.filingExports.craPreFill, { societyId: fixture.societyId, kind: "T2", fiscalYear: "2026" });
assert.equal(tax.dueDate, "2027-02-28");
const charity = await admin.query(api.filingExports.craPreFill, { societyId: fixture.societyId, kind: "T3010", fiscalYear: "2026" });
assert.match(charity.error, /registered charities/);
await assert.rejects(() => admin.query(api.filingExports.craPreFill, { societyId: fixture.societyId, kind: "Unsupported", fiscalYear: "2026" }), /Unsupported/);
await assert.rejects(() => admin.query(api.filingExports.craPreFill, { societyId: fixture.societyId, kind: "T2", fiscalYear: "invalid" }), /four-digit/);
await assert.rejects(() => member.query(api.filingExports.craPreFill, { societyId: fixture.societyId, kind: "T2", fiscalYear: "2026" }));
await assert.rejects(() => admin.query(api.filingExports.craPreFill, { societyId: fixture.foreignId, kind: "T2", fiscalYear: "2026" }));
assert.equal(filingDueDateMonthsAfter("2023-08-31", 6), "2024-02-29");
assert.throws(() => filingDueDateMonthsAfter("2026-02-30", 6), /valid/);
assert.throws(() => bcSocietyPreparationKind({ entityType: "corporation__business_", jurisdictionCode: "CA-BC" }, "AnnualReport"), /only for a BC society/);
assert.throws(() => bcSocietyBotKind({ entityType: "society", jurisdictionCode: "CA-BC" }, "ChangeOfAddress"), /no preparation assistant/);

const local = new StaticConvexClient();
try {
  const localPacket = await local.query("filingBot:buildFilingPacket", { societyId: STATIC_DEMO_SOCIETY_ID, kind: "BCSocietyAnnualReport" }) as any;
  assert.equal(localPacket.form, "BC-Societies-Form-11");
  assert.ok(localPacket.directors.length > 0, "Local packet must contain actual workspace records, not a placeholder.");
  const newWorkspace = await local.mutation("society:createWorkspace", { name: "Local corporate preparation", fiscalYearEnd: "12-31", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act", jurisdictionCode: "CA-FED-CBCA" }) as any;
  await assert.rejects(() => local.query("filingBot:buildFilingPacket", { societyId: newWorkspace.societyId, kind: "AnnualReport" }), /only for a BC society/);
} finally { local.close(); }
console.log("Filing preparation integration passed: native/local real packets and annual aliases; jurisdiction/type/form/charity/year gates; Member/foreign-workspace denial and accounting Viewer export denial; calendar-month deadline clamping.");
