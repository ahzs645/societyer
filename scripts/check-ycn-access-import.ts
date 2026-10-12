/**
 * GATE: the YCN/Access importer. One entity at a time, field names that the
 * apply step reads, people linked to the roster, and an end-to-end import that
 * validates against the real Convex schema and leaves a share ledger that
 * agrees with the certificate register. Synthetic data only
 * (scripts/fixtures/ycnSynthetic.ts).
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";

import schema from "../convex/schema";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { deriveCurrentHoldings } from "../shared/equityLedger";
import { importBundlePreflightIssues } from "../shared/importBundlePreflight";
import { sharesOutstandingByClass } from "../shared/shareCertificates";
import { isYcnOpenEndDate, resolveTwoDigitBirthYear } from "../shared/ycnDate";
import {
  buildBundleFromAccessTables,
  countBundleRecords,
  decodeYcnCell,
  extractCorpSettings,
  extractDirectoryPeople,
  fiscalYearEndFrom,
  isCurrentRow,
  linkDirectoryPeople,
  listYcnEntities,
  mapConstatingAction,
  mapServiceFunction,
  mapShareTransferType,
  mapYcnCurrency,
  mapYesNoUnknown,
  monthToNumber,
  normalizeGender,
  officerTitles,
  parseAccessBirthDate,
  parseAccessDate,
  parseCitizenship,
  parseMoneyCents,
  particularsAt,
  buildRoster,
  pick,
  pickDate,
  splitYcnAddress,
  stagedBundle,
  stripLeadingNumber,
  type BundlePayload,
} from "../shared/ycnAccessImport";
import { describeBundle, parseArgs, parseCsv } from "./import-ycn-access";
import { SYNTHETIC_ENTITY_IDS, syntheticYcnTables } from "./fixtures/ycnSynthetic";

const { primary: E1, second: E2 } = SYNTHETIC_ENTITY_IDS;
const REF = "2026-10-12";

// --- cell helpers -----------------------------------------------------------
assert.equal(pick({ Ent_ID: "BC1", DB_ID: "2" }, "ENT_ID"), "BC1", "case-insensitive pick");
assert.equal(pick({ A: "", B: "x" }, "A", "B"), "x", "pick skips empty, falls through");
assert.equal(pick({}, "MISSING"), undefined);
assert.equal(decodeYcnCell("20150612.09"), "2015-06-12T09:00:00");
assert.equal(decodeYcnCell("18991230.0"), undefined, "null sentinel");
assert.equal(decodeYcnCell("29991231"), undefined, "2999 open-end sentinel");
assert.equal(decodeYcnCell("2999-12-31"), undefined, "2999 open-end sentinel (ISO)");
assert.equal(decodeYcnCell(""), undefined);
assert.equal(decodeYcnCell(null), undefined);
assert.equal(decodeYcnCell("2024-01-02"), "2024-01-02", "already-ISO passthrough");
assert.equal(isYcnOpenEndDate("29991231"), true);
assert.equal(isYcnOpenEndDate("20251231.09"), false);
assert.equal(pickDate({ APPOINT_DT_TM: "20161201.09" }, "APPOINT_DT_TM"), "2016-12-01T09:00:00");
assert.equal(isCurrentRow({ REVISE_DT_TM: "" }), true);
assert.equal(isCurrentRow({ REVISE_DT_TM: "18991230" }), true);
assert.equal(isCurrentRow({ REVISE_DT_TM: "20210628.162047" }), false);

// --- vocabulary mappers -----------------------------------------------------
assert.equal(mapShareTransferType("Allot"), "issuance");
assert.equal(mapShareTransferType("Transfer"), "transfer");
assert.equal(mapShareTransferType("Subdivision"), "subdivision");
assert.equal(mapShareTransferType("Consolidation"), "consolidation");
assert.equal(mapShareTransferType("Redeem"), "redemption", "a redemption is not a cancellation");
assert.equal(mapShareTransferType("Cancel"), "cancellation");
assert.equal(mapShareTransferType("Certificate"), "replacement_certificate", "a replacement is not a transfer");
assert.equal(normalizeGender("f"), "F");
assert.equal(mapServiceFunction("Auditors"), "auditor");
assert.equal(mapServiceFunction("Corp_Rec_Lawyer"), "lawyer");
assert.equal(mapServiceFunction("Transfer_Agents"), "transfer_agent");
assert.equal(mapServiceFunction("Something"), "other");
assert.equal(mapConstatingAction("Amalgamation"), "amalgamated");
assert.equal(mapYesNoUnknown("Unknown"), "unknown");
assert.equal(parseMoneyCents("$48,000"), 4800000);
assert.equal(parseMoneyCents(""), undefined);
assert.equal(mapYcnCurrency("C$"), "cad");
assert.equal(mapYcnCurrency("$"), "cad");
assert.equal(mapYcnCurrency("US$"), "usd");
assert.equal(mapYcnCurrency("EU€"), "eur");
assert.equal(stripLeadingNumber("2. Person B"), "Person B");
assert.equal(monthToNumber("feb"), 2);
assert.equal(fiscalYearEndFrom("February", "29"), "02-29", "a 29 February year end is kept (end of February)");
assert.equal(fiscalYearEndFrom("December", "31"), "12-31");
assert.equal(fiscalYearEndFrom("April", "31"), undefined, "an impossible day is not imported");
assert.deepEqual(parseCitizenship("France/U.S.").countries, ["France", "United States"]);
assert.deepEqual(parseCitizenship("Yes").countries, []);

// Officer titles: President and Secretary together; a coded OTHER; a free-text OTHER.
assert.deepEqual(officerTitles({ PRES: "Y", SECR: "Y" }), { officerTitle: "president", additionalOfficerTitles: ["secretary"], freeText: undefined });
assert.deepEqual(officerTitles({ OTHER: "Chief Operating Officer" }).officerTitle, "chief_operating_officer");
assert.deepEqual(officerTitles({ PRES: "Y", OTHER: "Treasurer" }), { officerTitle: "president", additionalOfficerTitles: ["treasurer"], freeText: undefined });
assert.deepEqual(officerTitles({ OTHER: "Chief Synthetic Strategist" }), { officerTitle: "other", additionalOfficerTitles: ["Chief Synthetic Strategist"], freeText: "Chief Synthetic Strategist" });

// Addresses.
assert.deepEqual(splitYcnAddress("250 Sample Road, Suite 4, Exampleton, BC Canada V1A 2B2"),
  { street: "250 Sample Road, Suite 4", city: "Exampleton", provinceState: "BC", postalCode: "V1A 2B2", country: "Canada" });
assert.deepEqual(splitYcnAddress("Testville, British Columbia, V2C 3D4"), { street: "Testville", provinceState: "BC", postalCode: "V2C 3D4", country: "Canada" });
assert.deepEqual(splitYcnAddress("1 Faraway Road, Elsewhere, CA 90000"), { street: "1 Faraway Road", city: "Elsewhere", provinceState: "CA", postalCode: "90000", country: "United States" });
assert.deepEqual(splitYcnAddress("12 Lonely Lane"), { street: "12 Lonely Lane" });

// Birth dates: 4-digit export, and 2-digit years resolved and flagged when unclear.
assert.deepEqual(parseAccessBirthDate("1920-02-17 00:00:00", { referenceYear: 2026 }), { iso: "1920-02-17", ambiguous: false });
assert.equal(parseAccessBirthDate("02/17/20 00:00:00", { referenceYear: 2026, atAgeOfMajority: true }).iso, "1920-02-17", "an adult can't be born in 2020");
assert.equal(parseAccessBirthDate("02/17/20 00:00:00", { referenceYear: 2026, atAgeOfMajority: false }).iso, "2020-02-17", "a minor born in 2020");
assert.equal(parseAccessBirthDate("03/09/93", { referenceYear: 2026 }).iso, "1993-03-09", "2094 is in the future");
assert.equal(parseAccessBirthDate("03/09/93", { referenceYear: 2026 }).ambiguous, false);
const unclear = parseAccessBirthDate("03/04/18", { referenceYear: 2026 });
assert.equal(unclear.iso, "1918-03-04");
assert.equal(unclear.ambiguous, true, "1918 and 2018 are both possible without the majority flag");
assert.equal(resolveTwoDigitBirthYear(10, { referenceYear: 2026 }).year, 2010, "1910 is beyond a living age");
assert.equal(parseAccessDate("02/17/20 00:00:00", 2026), "1920-02-17", "never 2020 by a fixed pivot when both are possible");
assert.equal(parseAccessDate(""), undefined);

// --- CSV parsing and CLI ------------------------------------------------------
const csv = parseCsv('ENT_ID,Name,ADDRESS\n"BC1","Sample, Pat","1 Example St, Exampleton"\n"BC1","Lee",\n');
assert.equal(csv.length, 2);
assert.equal(csv[0].Name, "Sample, Pat", "quoted comma preserved");
assert.equal(csv[1].ADDRESS, "", "missing trailing field is empty");
assert.deepEqual(parseArgs(["--db", "x.accdb", "--entity", E1, "--out", "b.json"]), { listEntities: false, db: "x.accdb", entity: E1, out: "b.json" });
assert.throws(() => parseArgs(["--include-superseded"]), /no longer supported/);
assert.throws(() => parseArgs(["--cancellation-kind", "maybe"]), /redemption or cancellation/);

// --- entities: list first, import one at a time ------------------------------------
const tables = syntheticYcnTables();
const entities = listYcnEntities(tables);
assert.deepEqual(entities.map((e) => e.entityId), [E1, E2]);
assert.equal(entities[0].name, "Synthetic Holdings Ltd.");
assert.deepEqual(entities[0].formerNames, ["Example Widgets Ltd."]);
assert.equal(entities[0].rowCounts.DB_GLOB_SHARE_TRANS, 18, "superseded rows are not counted");
assert.throws(() => buildBundleFromAccessTables(tables), /2 entities; import one at a time with --entity/);
assert.throws(() => buildBundleFromAccessTables(tables, { entityId: "BC0000000" }), /not in this database/);

const second = buildBundleFromAccessTables(tables, { entityId: E2, referenceDate: REF });
assert.equal(second.metadata.ycnEntityId, E2);
assert.equal(second.roleHolders.filter((r) => r.roleType === "director").length, 1, "only the second company's director");
assert.equal(second.rightsholdingTransfers.length, 1);
assert.equal(second.rightsClasses[0].votesPerShare, 1, "numeric VOTING");
assert.ok(second.directoryPeople.every((p) => p.globalId === "SYN101"), "only the second company's roster");
assert.equal(second.societySettings?.fiscalYearEnd, "03-31");
assert.equal(second.societySettings?.responsibleLawyer, undefined);
assert.ok(!JSON.stringify(second).includes("Sample Holdco"), "nothing from the first company leaks into the second");
const sole = buildBundleFromAccessTables({ ...tables, DB_GLOB_SHARE_TRANS: [], DB_GLOB_CORP_NAME: tables.DB_GLOB_CORP_NAME.filter((r) => r.ENT_ID === E2), DB_GLOB_ENT_PEOPLE: [], DB_GLOB_DIRECTOR: [], DB_GLOB_OFFICER: [], DB_GLOB_SHARE_CAPTL: [], DB_GLOB_REG_OFFICE: [], DB_GLOB_REC_OFFICE: [], DB_GLOB_BUS_ADDRESS: [], DB_GLOB_REG_FILING: [], DB_GLOB_CORP_SETTINGS: [], DB_GLOB_DIVIDEND: [], DB_GLOB_TRANSPARENCY_REG: [], DB_GLOB_TRANSPARENCY_DUE: [], DB_GLOB_SERVICE_PROVIDERS: [], DB_GLOB_CORP_ASSETS: [], DB_GLOB_CONSTATING: [] });
assert.equal(sole.metadata.ycnEntityId, E2, "a one-entity database needs no --entity");

// --- the primary entity ------------------------------------------------------------
const bundle = buildBundleFromAccessTables(tables, { entityId: E1, referenceDate: REF });
const byRole = (type: string) => bundle.roleHolders.filter((r) => r.roleType === type);
assert.equal(bundle.metadata.ycnEntityName, "Synthetic Holdings Ltd.");

// People: no roster-wide signers; the roster-only person gets no role at all.
assert.equal(byRole("authorized_representative").length, 0, "the roster is not imported as signers");
assert.ok(!(bundle as any).entitySigners, "no signer roster overriding role-based signatories");
assert.ok(!bundle.roleHolders.some((r) => r.fullName === "Harper Roster"), "a roster-only person has no register role");
// Directors keep their address and directory link; the current name is used.
const directors = byRole("director");
assert.equal(directors.length, 2, "superseded director excluded");
const alex = directors.find((r) => r.ycnPersonId === "P001")!;
assert.equal(alex.fullName, "Alexandra Sample", "current particulars for a sitting director");
assert.equal(alex.street, "200 Second Avenue");
assert.equal(alex.city, "Exampleton");
assert.equal(alex.postalCode, "V1A 2B2");
assert.equal(alex.ycnGlobalId, "SYN001");
assert.equal(alex.status, "current");
assert.match(String(alex.notes), /2000-01-01 to 2018-12-31: Alex Sample, 100 Example Street/, "dated particulars kept with the record");
const blake = directors.find((r) => r.ycnPersonId === "P002")!;
assert.equal(blake.status, "former");
assert.equal(blake.endDate, "2016-11-15");
// Particulars as of a date (INFO_STR / INFO_END windows; 29991231 is open).
const roster = buildRoster(tables.DB_GLOB_ENT_PEOPLE.filter((r) => r.ENT_ID === E1));
assert.equal(particularsAt(roster, "P001", "2010-06-01")?.fullName, "Alex Sample");
assert.equal(particularsAt(roster, "P001", "2019-06-01")?.fullName, "Alexandra Sample");
assert.equal(particularsAt(roster, "P001", "2019-06-01")?.to, undefined, "29991231 means no end");
// Officers: several offices for one person.
const officers = byRole("officer");
const president = officers.find((r) => r.ycnPersonId === "P001")!;
assert.equal(president.officerTitle, "president");
assert.deepEqual(president.additionalOfficerTitles, ["secretary"]);
assert.equal(officers.find((r) => r.ycnPersonId === "P008")?.officerTitle, "chief_operating_officer");
assert.equal(officers.find((r) => r.ycnPersonId === "P008")?.status, "former");
// Shareholders: one per holder, stable identity, holding company flagged.
const holders = byRole("shareholder");
assert.equal(holders.length, 7);
assert.equal(holders.find((r) => r.ycnPersonId === "P007")?.nonNaturalPerson, true);
assert.equal(holders.find((r) => r.ycnPersonId === "P006")?.status, "former", "redeemed out");
assert.equal(holders.find((r) => r.ycnPersonId === "P001")?.fullName, "Alexandra Sample");
// Significant individuals: citizenship parsed, not forced into an option code.
const controllers = byRole("controller");
assert.deepEqual(controllers.find((r) => r.fullName === "Morgan Abroad")?.citizenshipCountries, ["France", "United States"]);
assert.equal(controllers.find((r) => r.fullName === "Morgan Abroad")?.citizenshipResidency, undefined);

// Offices with effective dates (BCA ss. 35, 42), not undated "other" addresses.
const offices = (type: string) => bundle.organizationAddresses.filter((a) => a.type === type)
  .map((a) => `${a.effectiveFrom}..${a.effectiveTo ?? ""} ${a.status} ${a.street}, ${a.city}`);
assert.deepEqual(offices("registered_office"), [
  "2005-03-01..2010-01-15 past 100 Example Street, Exampleton",
  "2010-01-15..2018-07-01 past 250 Sample Road, Suite 4, Exampleton",
  "2018-07-01.. current 77 Placeholder Way, Testville",
]);
assert.deepEqual(offices("records_office"), [
  "2005-03-01..2018-07-01 past 100 Example Street, Exampleton",
  "2018-07-01.. current 77 Placeholder Way, Testville",
]);
const business = bundle.organizationAddresses.find((a) => a.type === "physical")!;
assert.deepEqual(business.contacts, [{ name: "Alexandra Sample", role: "Director" }]);
assert.equal((business.freeformLines as string[]).length, 4);
assert.equal(business.city, "Testville");
assert.ok(!bundle.organizationAddresses.some((a) => "addressType" in a || "startDate" in a), "no field names the apply step ignores");

// Registrations (number + date) and the annual-filing ledger.
assert.deepEqual(bundle.organizationRegistrations.map((r) => [r.jurisdiction, r.registrationType, r.registrationNumber, r.registrationDate]), [
  ["british_columbia", "home", "BC9900001", "2005-03-01"],
  ["alberta", "extra_provincial", "A0000001", "2012-08-14"],
]);
assert.match(String(bundle.organizationRegistrations[0].notes), /Transition under the Business Corporations Act \(British Columbia\) on 2006-06-01/, "the transition is history, not a second registration");
assert.deepEqual(bundle.annualFilingLedger.map((f) => [f.jurisdiction, f.year, f.filed, f.filedOn ?? null]), [
  ["CA-BC", "2016", true, "2016-03-15"],
  ["CA-BC", "2017", true, "2017-03-14"],
  ["CA-BC", "2018", false, null],
  ["CA-AB", "2017", false, null],
]);
assert.ok(bundle.report.warnings.some((w) => /2018: a date \(2018-03-20\) is recorded but the filing is not marked filed/.test(w)));

// Share classes: singular wording and votes per share.
const common = bundle.rightsClasses.find((c) => c.idPrefix === "COMMON")!;
const classB = bundle.rightsClasses.find((c) => c.idPrefix === "CLASSB")!;
assert.equal(common.singularForm, "Common Share without par value");
assert.equal(common.votesPerShare, undefined, "no reading, no inference from a plain name");
assert.equal(classB.votesPerShare, 0, "non-voting inferred from the class name");
assert.match(String(classB.notes), /confirm against the articles/);

// The share ledger: reconciled and posted, with sources and class links.
assert.equal(bundle.report.shareConversion.clean, true, JSON.stringify(bundle.report.shareConversion.issues));
assert.equal(bundle.report.shareConversion.reconciledDates.length, 11);
assert.equal(bundle.report.shareConversion.mismatches, 0);
assert.ok(bundle.rightsholdingTransfers.every((t) => t.status === "posted" && (t.quantity as number) > 0));
const transfers = bundle.rightsholdingTransfers.filter((t) => t.transferType === "transfer");
assert.ok(transfers.every((t) => t.sourceHolderName && t.destinationHolderName && t.sourceHolderExternalId), "every transfer has a source holder");
assert.ok(bundle.rightsholdingTransfers.every((t) => t.rightsClassExternalId && t.rightsClassCode));
assert.equal(bundle.rightsholdingTransfers.filter((t) => t.transferType === "redemption").length, 1);
assert.equal(bundle.rightsholdingTransfers.filter((t) => t.transferType === "cancellation").length, 0);
const firstIssue = bundle.rightsholdingTransfers[0];
assert.equal(firstIssue.priceToOrganizationCents, 10000);
assert.equal(firstIssue.priceToOrganizationCurrency, "cad");
assert.ok(!bundle.shareCertificates.some((c) => c.replacesCertificateNumber === "Replacement"), "the literal is not a certificate number");
assert.equal(bundle.shareCertificates.find((c) => c.certificateNumber === "5A")?.replacesCertificateNumber, "4A", "back pointer");
assert.equal(bundle.shareCertificates.find((c) => c.certificateNumber === "1")?.holderName, "Alex Sample", "a certificate shows the name at issue");

// Other registers.
assert.equal(bundle.assets.find((a) => a.status === "disposed")?.disposedTo, "Example Buyer Inc.");
assert.equal(bundle.assets.find((a) => a.status === "disposed")?.disposalValueCents, 42000000);
assert.equal(bundle.assets.find((a) => a.status === "in_service")?.acquiredFrom, "Example Motors Ltd.");
assert.equal(bundle.assets.find((a) => a.status === "in_service")?.assetJurisdiction, "BC");
assert.ok(!bundle.assets.some((a) => a.notes), "disposition is not squashed into notes");
assert.equal(bundle.serviceProviders.find((p) => p.firmName === "Sample Law Corporation")?.function, "lawyer");
assert.equal(bundle.significantIndividualSteps[0].individualName, "Morgan Abroad");
assert.equal(bundle.nameHistory.length, 2);

// Settings: current row, fiscal year end, and the responsible lawyer from Retain_List.
assert.equal(bundle.societySettings?.agmMonth, 5);
assert.equal(bundle.societySettings?.fiscalYearEnd, "02-29");
assert.equal(bundle.societySettings?.responsibleLawyer, "Pat Counsel");
assert.equal(extractCorpSettings(tables, E1)?.primaryContactEmail, "contact@example.test", "superseded settings row ignored");

// Directory: only this entity's roster; birth years resolved and flagged.
const directory = extractDirectoryPeople(tables, E1);
assert.deepEqual(directory.map((p) => p.globalId), ["SYN001", "SYN002", "SYN003", "SYN007"]);
assert.equal(directory.find((p) => p.globalId === "SYN002")?.dob, "1920-02-17");
assert.equal(directory.find((p) => p.globalId === "SYN003")?.dobNeedsReview, true);
assert.equal(directory.find((p) => p.globalId === "SYN007")?.dob, undefined, "an organization has no birth date");
assert.ok(bundle.report.warnings.some((w) => /SYN003: two-digit year 18 could be 1918 or 2018/.test(w)));

// The staged bundle only uses keys and fields the import pipeline keeps.
const staged = stagedBundle(bundle);
assert.ok(!("societySettings" in staged) && !("directoryPeople" in staged) && !("report" in staged));
assert.deepEqual(importBundlePreflightIssues(staged), []);
assert.equal(countBundleRecords(bundle), Object.entries(staged).filter(([key]) => key !== "metadata").reduce((sum, [, rows]) => sum + (rows as unknown[]).length, 0));
assert.ok(describeBundle(bundle).some((line) => /reconciled at 11 event date\(s\), 40 holder\/class\/date point\(s\), 0 mismatch\(es\) — clean/.test(line)));

// --- end to end: stage, approve, apply against the real Convex schema ----------------------
const api: any = anyApi;
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./importSessions.js": () => import("../convex/importSessions"),
} as any);
const issuer = betterAuthIssuer();
const now = new Date().toISOString();
const { societyId, directoryIdList } = await t.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Synthetic Holdings Ltd.", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  await ctx.db.insert("users", { societyId, email: "ycn-owner@example.invalid", displayName: "Owner", role: "Owner", status: "Active", authSubject: "ycn-owner", authIssuer: issuer, authProvider: "better-auth", createdAtISO: now });
  // The runner upserts the roster's directory people first.
  const directoryIdList: Array<[string, string]> = [];
  for (const person of bundle.directoryPeople) {
    const { globalId, dobNeedsReview: _flag, ...fields } = person as BundlePayload & { globalId: string };
    directoryIdList.push([globalId, await ctx.db.insert("peopleDirectory", { ...(fields as any), societyId, searchName: String(fields.fullName).toLowerCase(), createdAtISO: now, updatedAtISO: now })]);
  }
  return { societyId, directoryIdList };
});
const directoryIds = new Map(directoryIdList);
assert.equal(linkDirectoryPeople(bundle, directoryIds), bundle.roleHolders.filter((r) => ["SYN001", "SYN002", "SYN003", "SYN007"].includes(String(r.ycnGlobalId))).length);
const owner = t.withIdentity({ subject: "ycn-owner", issuer });
const sessionId = await owner.mutation(api.importSessions.createFromBundle, { societyId, bundle: stagedBundle(bundle) });
await owner.mutation(api.importSessions.bulkSetStatus, { sessionId, status: "Approved" });
const firstApply = await owner.mutation(api.importSessions.applyApprovedSectionRecords, { sessionId });
// Review-confidence records wait for a reviewer note: the inferred non-voting class B (and the redemption);
// the class B ledger rows wait until their class is in the register.
const blockedKinds = (firstApply.blocked ?? []).map((b: any) => `${b.recordKind}:${b.title}`).sort();
assert.deepEqual(blockedKinds.map((k: string) => k.split(":")[0]), ["rightsClass", ...Array(7).fill("rightsholdingTransfer")], JSON.stringify(firstApply.blocked));
assert.ok(firstApply.blocked.every((b: any) => b.issues.some((issue: string) => /reviewer notes|share class is not in the register yet/.test(issue))), "the class B ledger rows wait for their class");
const session = await owner.query(api.importSessions.get, { sessionId });
for (const record of session.records.filter((r: any) => (firstApply.blockedRecordIds ?? []).includes(r._id))) {
  await owner.mutation(api.importSessions.updateRecord, { recordId: record._id, reviewNotes: "Checked against the articles and the certificate stubs." });
}
const secondApply = await owner.mutation(api.importSessions.applyApprovedSectionRecords, { sessionId });
assert.equal(secondApply.blocked, undefined, JSON.stringify(secondApply.blocked));

const db = await t.run(async (ctx) => {
  const all = async (table: string) => (await (ctx.db as any).query(table).collect()) as any[];
  return {
    addresses: await all("organizationAddresses"),
    registrations: await all("organizationRegistrations"),
    ledger: await all("annualFilingLedger"),
    roleHolders: await all("roleHolders"),
    classes: await all("rightsClasses"),
    transfers: await all("rightsholdingTransfers"),
    certificates: await all("shareCertificates"),
    assets: await all("assets"),
    signers: await all("entitySigners"),
  };
});
assert.deepEqual(db.addresses.filter((a) => a.type === "registered_office").map((a) => [a.effectiveFrom, a.effectiveTo ?? null, a.status]).sort(), [
  ["2005-03-01", "2010-01-15", "past"], ["2010-01-15", "2018-07-01", "past"], ["2018-07-01", null, "current"],
]);
assert.equal(db.addresses.filter((a) => a.type === "other").length, 0);
assert.deepEqual(db.addresses.find((a) => a.type === "physical")?.contacts, [{ name: "Alexandra Sample", role: "Director" }]);
assert.deepEqual(db.registrations.map((r) => [r.registrationType, r.registrationNumber, r.registrationDate]).sort(), [["extra_provincial", "A0000001", "2012-08-14"], ["home", "BC9900001", "2005-03-01"]]);
assert.deepEqual(db.ledger.map((r) => `${r.jurisdiction} ${r.year} ${r.filed} ${r.filedOn ?? ""}`).sort(), ["CA-AB 2017 false ", "CA-BC 2016 true 2016-03-15", "CA-BC 2017 true 2017-03-14", "CA-BC 2018 false "]);
const officerRow = db.roleHolders.find((r) => r.roleType === "officer" && r.officerTitle === "president");
assert.deepEqual(officerRow?.additionalOfficerTitles, ["secretary"]);
assert.equal(String(officerRow?.directoryPersonId), directoryIds.get("SYN001"));
const directorRow = db.roleHolders.find((r) => r.roleType === "director" && r.status === "current");
assert.equal(directorRow?.city, "Exampleton", "the director keeps an address");
assert.equal(String(directorRow?.directoryPersonId), directoryIds.get("SYN001"));
assert.equal(db.roleHolders.filter((r) => r.roleType === "authorized_representative").length, 0);
assert.equal(db.signers.length, 0, "no roster-wide signer list");
assert.equal(db.classes.find((c) => c.idPrefix === "CLASSB")?.votesPerShare, 0);
assert.equal(db.classes.find((c) => c.idPrefix === "COMMON")?.singularForm, "Common Share without par value");
assert.ok(db.transfers.every((tr) => tr.rightsClassId), "every ledger row is linked to its class by id");
assert.ok(db.transfers.filter((tr) => tr.transferType === "transfer").every((tr) => tr.sourceRoleHolderId && tr.destinationRoleHolderId), "transfers link both holders");
assert.equal(db.transfers.find((tr) => tr.transferType === "redemption")?.sourceRoleHolderId !== undefined, true);
assert.equal(db.assets.find((a) => a.status === "disposed")?.disposedTo, "Example Buyer Inc.");
assert.deepEqual(db.assets[0].disposalDocumentIds, []);
// The applied ledger agrees with the applied certificate register today.
const holdings = deriveCurrentHoldings(db.transfers);
const className = new Map(db.classes.map((c) => [String(c._id), c.className]));
const ledgerByClass: Record<string, number> = {};
for (const h of holdings) ledgerByClass[className.get(h.rightsClassId)!] = (ledgerByClass[className.get(h.rightsClassId)!] ?? 0) + h.quantity;
assert.deepEqual(ledgerByClass, sharesOutstandingByClass(db.certificates, `${REF}T23:59:59`));
assert.deepEqual(ledgerByClass, { "Common Shares without par value": 31 });
assert.ok(holdings.every((h) => h.holderKey.startsWith("roleHolder:")), "holdings keyed by holder id, not by name");
// Re-applying is idempotent.
const again = await owner.mutation(api.importSessions.applyApprovedSectionRecords, { sessionId });
assert.equal(again.total, 0);

console.log("OK ycn-access-import");
