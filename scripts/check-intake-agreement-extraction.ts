/** Agreement extraction gate (synthetic text only): parties from BETWEEN … AND blocks (inline,
 * stacked, two columns, wrapped names), role labels, quoted role aliases, signature blocks and a
 * funder's own sentence; titles from headings, never label lines; terms from "commencing …
 * ending …"; the value from the strongest cue (a maximum amount beats fees; insurance and
 * liability limits are never the value); agreement numbers with a year. */
import assert from "node:assert/strict";
import { blocksFromPlainText, finalizeBlocks, type DraftBlock, type IntakeExtract } from "../shared/intake/blocks";
import { extractForClass } from "../shared/intake/extractors";
import { agreementParties, agreementTitleText, partyName } from "../shared/intake/extractors/agreement";
import { linesOf } from "../shared/intake/extractors/toolkit";
import { verifyRecord } from "../shared/intake/verify";

const extractOf = (text: string): IntakeExtract => {
  const drafts: DraftBlock[] = blocksFromPlainText(text);
  const { blocks, text: joined } = finalizeBlocks(drafts);
  return { method: "plain-text", methodVersion: "test", blocks, text: joined, warnings: [] };
};
const run = (fileName: string, text: string, docClass: "agreement" | "grant" = "agreement") => {
  const extract = extractOf(text);
  const envelope = extractForClass(docClass, { fileId: fileName, fileName, extract, asOfISO: "2026-01-01", organizationName: "Lakeside Clean Air Society" })!;
  const verification = verifyRecord(envelope.record, extract);
  assert.equal(verification.mismatched + verification.invalid, 0, `${fileName}: every quote re-verifies`);
  const record = envelope.record as any;
  const v = (field: any) => field?.value;
  return { record, parties: (record.parties ?? []).map(v), title: v(record.title), effective: v(record.effective)?.iso, expiry: v(record.expiry)?.iso, amount: v(record.amount)?.amountCents, number: v(record.agreementNumber) };
};

// Names: addresses, incorporation notes and defined-term tails are cut; fragments are rejected.
assert.equal(partyName("BETWEEN: HARBOUR CITY. A MUNICIPAL CORPORATION, OF 1100 MAIN STREET"), "HARBOUR CITY");
assert.equal(partyName("Northwind Monitoring Ltd. (GST No. 1234) Unit 4, 88 Avenue"), "Northwind Monitoring Ltd");
assert.equal(partyName("FRASER VALLEY COUNCIL SOCIETY the secretariat for the Air Working Group, a duly incorporated society"), "FRASER VALLEY COUNCIL SOCIETY");
assert.equal(partyName("Roundtable Society"), undefined, "a wrapped name's tail is not a party");
assert.equal(partyName("Lakeside Clean Air Society and when a copy is received by the Lung Foundation"), undefined);
assert.equal(partyName("1100 Main Street, Harbour City, BC V2L 3V9"), undefined);
assert.equal(agreementTitleText("Event #: 12756 License Agreement"), "License Agreement");
assert.equal(agreementTitleText("Contract #: LCAS-RWG-2013"), "");

// A general service agreement in two columns, the first name wrapped over two lines.
const gsa = run("GSA_Brightwater_2013.pdf", [
  "Contract #: LCAS-FBC 2019",
  "",
  "General Service Agreement",
  "",
  "BETWEEN\tAND",
  "The Lakeside Clean Air",
  "Roundtable Society (“LCAS”, “we” or “us”)\tBrightwater Monitoring Ltd. (the “Contractor”, “you”)",
  "PO Box 322\t12 Harbour Road",
  "",
  "Term: 3 Months\tStart Date: January 1, 2013\tEnd Date: March 31, 2013",
  "",
  "SCHEDULE B – FEES AND EXPENSES Fees: $82,500 Expenses: $2,500 Maximum Amount: $85,000",
  "",
  "The Contractor must maintain Commercial General Liability in an amount not less than $2,000,000 per occurrence.",
  "",
  "SIGNED AND DELIVERED on behalf of Brightwater Monitoring Ltd. by its authorized signatory",
].join("\n"));
assert.equal(gsa.title, "General Service Agreement", "the heading, not the 'Contract #' label line");
assert.equal(gsa.number, "LCAS-FBC 2019");
assert.deepEqual(gsa.parties, ["The Lakeside Clean Air Roundtable Society", "Brightwater Monitoring Ltd"]);
assert.equal(gsa.effective, "2013-01-01");
assert.equal(gsa.expiry, "2013-03-31");
assert.equal(gsa.amount, 8500000, "the maximum amount wins over the fees beside it and over an insurance limit");

// Stacked BETWEEN: / AND: blocks with addresses, a person contractor, "commencing … ending".
const stacked = run("2016 Monitoring Contract.pdf", [
  "THIS AGREEMENT dated the 26 of August 2016 at the City of Vancouver,",
  "",
  "BETWEEN:",
  "HARBOUR CITY. A MUNICIPAL CORPORATION,",
  "OF 1100 MAIN STREET, IN THE PROVINCE OF BRITISH COLUMBIA, V2L 3V9",
  "(hereinafter referred to as the \"City\")",
  "",
  "AND:",
  "Avery Quill",
  "4 Lake Road",
  "(hereinafter referred to as the \"Contractor\")",
  "",
  "2.01. The terms set out herein cover the period commencing April 1, 2016 and ending March 31, 2017 (hereinafter called the \"expiration date\").",
  "",
  "The maximum amount of fees and expenses payable under this Schedule, excluding taxes, is 298939.87 (the “Maximum Amount Payable”).",
].join("\n"));
assert.deepEqual(stacked.parties, ["HARBOUR CITY", "Avery Quill"], "a person is a party when named as the contractor");
assert.equal(stacked.effective, "2016-04-01");
assert.equal(stacked.expiry, "2017-03-31");
assert.equal(stacked.amount, 29893987, "a maximum amount written without a dollar sign");

// A grant transfer agreement: the recipient label and the funder's own sentence.
const grant = run("2025 Transfer Agreement.pdf", [
  "COMMUNITY WOOD STOVE PROGRAM GRANT AGREEMENT",
  "",
  "January 13, 2025",
  "",
  "RECIPIENT OF THE GRANT",
  "The Lakeside Clean Air Society",
  "c/o Valley Council, 12 Main Street",
  "",
  "I am pleased to advise that the Coastal Lung Foundation, is able to provide funding of $ 8,000.00 (the “Grant”).",
  "",
  "The payment is to provide funds for a program to run from January 1, 2025 to December 31, 2025 (the “Project”).",
].join("\n"));
assert.deepEqual(grant.parties, ["The Lakeside Clean Air Society", "Coastal Lung Foundation"]);
assert.equal(grant.effective, "2025-01-01");
assert.equal(grant.expiry, "2025-12-31");
assert.equal(grant.amount, 800000);

// A letter of agreement names the parties in a sentence; label titles never win.
const letter = run("2023 Spring Grant Letter Agreement.pdf", [
  "Event #: 12756 License Agreement",
  "",
  "Re: 2023 Grant notification and Letter of Agreement between Harbour Cycling Society and Lakeside Bike Club, for 2023 Spring Bike Week",
].join("\n"));
assert.equal(letter.title, "License Agreement");
assert.deepEqual(letter.parties, ["Harbour Cycling Society", "Lakeside Bike Club"]);
// Defined terms in quotes are not parties: "the Lakeside Society’s grant application (the “Application”)".
const lines = linesOf(extractOf("This reflects the Lakeside Clean Air Society’s grant application dated September 2024 (the “Application”)."));
assert.deepEqual(agreementParties(lines).map((party) => party.value), []);
console.log("PASS intake agreement extraction: parties (inline, stacked, two-column, wrapped, labels, aliases, signatures, funder sentences), heading titles, commencing/ending terms, maximum amounts over fees and insurance limits");
