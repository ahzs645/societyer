import assert from "node:assert/strict";

import {
  buildBundleFromAccessTables,
  countBundleRecords,
  decodeYcnCell,
  isCurrentRow,
  mapConstatingAction,
  mapServiceFunction,
  mapShareTransferType,
  mapYesNoUnknown,
  normalizeGender,
  parseMoneyCents,
  pick,
  pickDate,
  stripLeadingNumber,
  type YcnTables,
} from "../shared/ycnAccessImport";
import { parseCsv } from "./import-ycn-access";

// --- cell helpers -----------------------------------------------------------

assert.equal(pick({ Ent_ID: "BC1", DB_ID: "2" }, "ENT_ID"), "BC1", "case-insensitive pick");
assert.equal(pick({ A: "", B: "x" }, "A", "B"), "x", "pick skips empty, falls through");
assert.equal(pick({}, "MISSING"), undefined);

assert.equal(decodeYcnCell("20150330.09"), "2015-03-30T09:00:00");
assert.equal(decodeYcnCell("18991230.0"), undefined, "sentinel decodes to undefined");
assert.equal(decodeYcnCell(""), undefined);
assert.equal(decodeYcnCell(null), undefined);
assert.equal(decodeYcnCell("2024-01-02"), "2024-01-02", "already-ISO passthrough");

assert.equal(pickDate({ APPOINT_DT_TM: "20161201.09" }, "APPOINT_DT_TM"), "2016-12-01T09:00:00");

// REVISE_DT_TM empty / sentinel => current; a real stamp => superseded.
assert.equal(isCurrentRow({ REVISE_DT_TM: "" }), true);
assert.equal(isCurrentRow({ REVISE_DT_TM: "18991230" }), true);
assert.equal(isCurrentRow({ REVISE_DT_TM: "20210628.162047" }), false);

// --- vocabulary mappers -----------------------------------------------------

assert.equal(mapShareTransferType("Allot"), "issuance");
assert.equal(mapShareTransferType("Transfer"), "transfer");
assert.equal(mapShareTransferType("Subdivision"), "subdivision");
assert.equal(mapShareTransferType("Consolidation"), "consolidation");
assert.equal(mapShareTransferType("Cancel"), "cancellation");
assert.equal(mapShareTransferType(undefined), "transfer");

assert.equal(normalizeGender("M"), "M");
assert.equal(normalizeGender("f"), "F");
assert.equal(normalizeGender("X"), "X");
assert.equal(normalizeGender("Female"), "F");
assert.equal(normalizeGender(""), undefined);

assert.equal(mapServiceFunction("Auditors"), "auditor");
assert.equal(mapServiceFunction("Transfer_Agents"), "transfer_agent");
assert.equal(mapServiceFunction("Lawyers"), "lawyer");
assert.equal(mapServiceFunction("Something"), "other");

assert.equal(mapConstatingAction("incorporated"), "incorporated");
assert.equal(mapConstatingAction("Amalgamation"), "amalgamated");
assert.equal(mapConstatingAction("mystery"), "other");

assert.equal(mapYesNoUnknown("N"), "no");
assert.equal(mapYesNoUnknown("Y"), "yes");
assert.equal(mapYesNoUnknown("Unknown"), "unknown");

assert.equal(parseMoneyCents("$52,500"), 5250000);
assert.equal(parseMoneyCents("10"), 1000);
assert.equal(parseMoneyCents(""), undefined);

assert.equal(stripLeadingNumber("2. Avery Ward"), "Avery Ward");
assert.equal(stripLeadingNumber("Jane Smith"), "Jane Smith");

// --- CSV parsing (mdb-export shape) -----------------------------------------

const csv = parseCsv(
  'ENT_ID,Name,ADDRESS\n"BC1","Macintyre, David","6488 Macdonald Street, Vancouver"\n"BC1","Jane",\n',
);
assert.equal(csv.length, 2, "two data rows");
assert.equal(csv[0].Name, "Macintyre, David", "quoted comma preserved");
assert.equal(csv[0].ADDRESS, "6488 Macdonald Street, Vancouver");
assert.equal(csv[1].ADDRESS, "", "missing trailing field is empty");

// --- bundle build (real sample rows) ----------------------------------------

const tables: YcnTables = {
  DB_GLOB_DIRECTOR: [
    // current
    { Ent_ID: "BC0604404", DB_ID: "2", REVISE_DT_TM: "", APPOINT_DT_TM: "20150330.09", Name: "David Macintyre", REMOVE_DT_TM: "" },
    // superseded — excluded by default
    { Ent_ID: "BC0604404", DB_ID: "9", REVISE_DT_TM: "20170101.09", APPOINT_DT_TM: "20140101.09", Name: "Old Director", REMOVE_DT_TM: "20161231" },
  ],
  DB_GLOB_OFFICER: [
    { Ent_ID: "BC0604404", DB_ID: "3", REVISE_DT_TM: "", APPOINT_DT_TM: "20050214.09", REMOVE_DT_TM: "20160101", Name: "Robin Masters", OTHER: "Chief Operating Officer" },
  ],
  DB_GLOB_ENT_PEOPLE: [
    { ENT_ID: "BC1568723", PERS_ID: "KV001", GLOB_ID: "KV001", FULL_NAME: "Kyle Vander Hoeven", LAST_NAME: "Vander Hoeven", FIRST_NAME: "Kyle", ADDRESS: "6488 Macdonald Street", GENDER: "M", INFO_STR: "20251217", INFO_END: "29991231" },
    { ENT_ID: "BC1568723", PERS_ID: "KV002", GLOB_ID: "KV002", FULL_NAME: "Elizabeth Vander Hoeven", GENDER: "F", INFO_STR: "20251217", INFO_END: "29991231" },
  ],
  DB_GLOB_SHARE_CAPTL: [
    { ENT_ID: "BC0604404", DB_ID: "1", REVISE_DT_TM: "", CLASS: "COMMON", SHR_DESC: "Common Shares without par value", CREATION_DT_TM: "20000330.09", CANCEL_DT_TM: "", VOTING: "Y" },
  ],
  DB_GLOB_SHARE_TRANS: [
    { Ent_ID: "BC0604404", DB_ID: "3", REVISE_DT_TM: "", ISS_DT_TM: "20091028.09", HLDR_NAME: "Rebecca Macintyre", SHR_CLASS: "CLASSB", SHR_NUM: "1", SHR_CERT: "1A", SHR_CERT_REPL: "2A", SHR_CONSID_AMT: "10", SHR_CONSID_CUR: "$", SHR_CONSID_TYP: "Cash", ISS_TYP: "Allot" },
  ],
  DB_GLOB_REG_FILING: [
    { ENT_ID: "BC0604404", DB_ID: "2", REVISE_DT_TM: "", JURISDICTION: "Alberta", FILE_YEAR: "2016", REGN_DT_TM: "20160701.09" },
  ],
  DB_GLOB_REG_OFFICE: [
    { ENT_ID: "BC0604404", DB_ID: "1", REVISE_DT_TM: "", ADDRESS: "3596 West 22nd Avenue, Vancouver, BC Canada V6S 1K5", START_DT_TM: "20000808.09" },
  ],
  DB_GLOB_SERVICE_PROVIDERS: [
    { Ent_ID: "BC0604404", DB_ID: "1", REVISE_DT_TM: "", APPOINT_DT_TM: "20150330.09", FUNCTION: "Auditors", FIRM_ID: "DEL00001", FIRM_NAME: "Deloitte LLP", FIRM_LOCATION: "Langley", CONTACT_NAME: "Rebecca Smith" },
  ],
  DB_GLOB_DIVIDEND: [
    { Ent_ID: "BC0604404", DB_ID: "1", REVISE_DT_TM: "", DECLARE_DT_TM: "20110331.09", CLASS: "COMMON", DIV_PER_SHARE: "50", SHR_TOTAL: "200", DIV_CURRENCY: "C$", DIV_TOTAL: "10000" },
  ],
  DB_GLOB_CORP_NAME: [
    { Ent_ID: "BC0604404", DB_ID: "1", REVISE_DT_TM: "", CORP_NAME: "YCN Software Inc.", SHORT_NAME: "the Company", START_DT_TM: "20000808.09", REG_POSN: "1" },
  ],
  DB_GLOB_CONSTATING: [
    { ENT_ID: "BC0604404", DB_ID: "1", REVISE_DT_TM: "", JURISDICTION: "British Columbia", LEGISLATION: "Company Act (British Columbia)", REG_ACTION: "incorporated", REG_NUMBER: "808888", START_DT_TM: "20000808.09" },
  ],
  DB_GLOB_TRANSPARENCY_REG: [
    { DB_ID: "2", ENT_ID: "BC0604404", REVISE_DT_TM: "", NAME: "2. Avery Ward", ADDRESS: "5678 Magnolia St., Los Angeles, CA", BIRTH: "19520904.09", CITIZEN: "Ireland/U.S.", TAX_RESIDENT_YN: "N", START_DT: "20060903.09", END_DT: "", REASON: "Has the right to elect all directors" },
  ],
  DB_GLOB_TRANSPARENCY_DUE: [
    { DB_ID: "1", ENT_ID: "BC0604404", REVISE_DT_TM: "", NAME: "5. Jane Smith", STEPS: "Attempted contact by phone and email.", STEP_DT: "20091103.09" },
  ],
  DB_GLOB_CORP_ASSETS: [
    { ENT_ID: "BC0604404", DB_ID: "2", REVISE_DT_TM: "", ASSET_TYPE: "Equipment", ASSET_DESC: "2017 Tesla Model S", ASSET_ID: "XXX-111", ASSET_JUR: "BC", ASSET_QUANT: "1", ACQ_DT_TM: "20190331", ACQ_COST: "$52,500", ACQ_CURRENCY: "US$", ACQ_FROM: "T. Nikola" },
  ],
};

const bundle = buildBundleFromAccessTables(tables, { name: "Sample" });

assert.equal(bundle.metadata.name, "Sample");
assert.equal(bundle.metadata.createdFrom, "YCN/Access");

// Directors: only the current row; superseded "Old Director" excluded.
const directors = bundle.roleHolders.filter((r) => r.roleType === "director");
assert.equal(directors.length, 1, "superseded director excluded by default");
assert.equal(directors[0].fullName, "David Macintyre");
assert.equal(directors[0].startDate, "2015-03-30T09:00:00", "appoint date decoded");

// Officer title resolved from OTHER, end date decoded.
const officer = bundle.roleHolders.find((r) => r.roleType === "officer");
assert.ok(officer);
assert.equal(officer?.officerTitle, "Chief Operating Officer");
assert.equal(officer?.endDate, "2016-01-01T00:00:00");

// ENT_PEOPLE carry gender (consumed by the NLG engine once roleHolders has it).
const people = bundle.roleHolders.filter((r) => r.roleType === "authorized_representative");
assert.equal(people.length, 2);
assert.equal(people[0].gender, "M");
assert.equal(people[1].gender, "F");

// Share class + transfer.
assert.equal(bundle.rightsClasses[0].className, "Common Shares without par value");
assert.equal(bundle.rightsholdingTransfers[0].transferType, "issuance");
assert.equal(bundle.rightsholdingTransfers[0].quantity, 1);
assert.equal(bundle.rightsholdingTransfers[0].transferDate, "2009-10-28T09:00:00");

// Registration + address.
assert.equal(bundle.organizationRegistrations[0].jurisdiction, "Alberta");
assert.equal(bundle.organizationAddresses[0].addressType, "registered");
assert.equal(bundle.organizationAddresses[0].street, "3596 West 22nd Avenue");
assert.equal(bundle.organizationAddresses[0].city, "Vancouver");

// Service providers, dividends, name history, constating, transparency, assets, certs.
assert.equal(bundle.serviceProviders[0].function, "auditor");
assert.equal(bundle.serviceProviders[0].firmName, "Deloitte LLP");
assert.equal(bundle.dividends[0].perShareCents, 5000, "$50/share -> 5000 cents");
assert.equal(bundle.dividends[0].totalCents, 1000000, "$10,000 -> 1,000,000 cents");
assert.equal(bundle.nameHistory[0].name, "YCN Software Inc.");
assert.equal(bundle.constatingEvents[0].action, "incorporated");
assert.equal(bundle.significantIndividualSteps[0].individualName, "Jane Smith", "leading index stripped");
assert.equal(bundle.assets[0].name, "2017 Tesla Model S");
assert.equal(bundle.assets[0].purchaseValueCents, 5250000);
assert.equal(bundle.shareCertificates[0].certificateNumber, "1A");
assert.equal(bundle.shareCertificates[0].replacesCertificateNumber, "2A");

// Transparency register's significant individuals are controller role holders.
const controller = bundle.roleHolders.find((r) => r.roleType === "controller");
assert.ok(controller, "transparency controller present");
assert.equal(controller?.fullName, "Avery Ward", "leading index stripped");
assert.equal(controller?.taxResidentHomeJurisdiction, "no");
assert.equal(controller?.significanceReason, "Has the right to elect all directors");

// includeSuperseded brings the historical director back.
const full = buildBundleFromAccessTables(tables, { includeSuperseded: true });
assert.equal(full.roleHolders.filter((r) => r.roleType === "director").length, 2);

// countBundleRecords sums every mapped collection.
assert.equal(
  countBundleRecords(bundle),
  bundle.roleHolders.length +
    bundle.rightsClasses.length +
    bundle.rightsholdingTransfers.length +
    bundle.organizationRegistrations.length +
    bundle.organizationAddresses.length +
    bundle.serviceProviders.length +
    bundle.dividends.length +
    bundle.nameHistory.length +
    bundle.constatingEvents.length +
    bundle.significantIndividualSteps.length +
    bundle.assets.length +
    bundle.shareCertificates.length,
);

console.log("OK ycn-access-import");
