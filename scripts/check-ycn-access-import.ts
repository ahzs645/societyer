import assert from "node:assert/strict";

import {
  buildBundleFromAccessTables,
  countBundleRecords,
  decodeYcnCell,
  isCurrentRow,
  mapShareTransferType,
  normalizeGender,
  pick,
  pickDate,
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
    { Ent_ID: "BC0604404", DB_ID: "3", REVISE_DT_TM: "", ISS_DT_TM: "20091028.09", HLDR_NAME: "Rebecca Macintyre", SHR_CLASS: "CLASSB", SHR_NUM: "1", SHR_CONSID_AMT: "10", SHR_CONSID_CUR: "$", SHR_CONSID_TYP: "Cash", ISS_TYP: "Allot" },
  ],
  DB_GLOB_REG_FILING: [
    { ENT_ID: "BC0604404", DB_ID: "2", REVISE_DT_TM: "", JURISDICTION: "Alberta", FILE_YEAR: "2016", REGN_DT_TM: "20160701.09" },
  ],
  DB_GLOB_REG_OFFICE: [
    { ENT_ID: "BC0604404", DB_ID: "1", REVISE_DT_TM: "", ADDRESS: "3596 West 22nd Avenue, Vancouver, BC Canada V6S 1K5", START_DT_TM: "20000808.09" },
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

// includeSuperseded brings the historical director back.
const full = buildBundleFromAccessTables(tables, { includeSuperseded: true });
assert.equal(full.roleHolders.filter((r) => r.roleType === "director").length, 2);

assert.equal(countBundleRecords(bundle), bundle.roleHolders.length + 1 + 1 + 1 + 1);

console.log("OK ycn-access-import");
