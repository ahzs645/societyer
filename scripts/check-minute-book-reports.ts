import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

import {
  consentAdoptionClause,
  corporationPacketDocumentId,
  corporationPacketDocxBytes,
  corporationPacketDocxFileName,
  corporationPacketInstrumentDocxBytes,
  corporationPacketReviewMemoDocxBytes,
  executionSigners,
  instrumentTitle,
  nextPacketDocumentSequence,
} from "../shared/corporationPacketDocx";
import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";
import { SOCIETY_DOCUMENT_PACKETS } from "../shared/societyDocumentPackets";
import { CORPORATION_REPORT_PACKETS, isReportPacketKey, isRestrictedReportPacketKey, reportKindForPacket } from "../shared/corporationReportPackets";
import { buildMinuteBookReport, ledgerHoldingsAsOf, nameAsOf, type MinuteBookReportInput } from "../shared/minuteBookReports";
import { assertMinuteBookReportAccess, roleMayViewRestrictedRegisters } from "../shared/minuteBookReportData";
import { buildSocietyRenderContext } from "../shared/societyRenderContext";
import { buildExecutionBlock } from "../shared/executionBlock";
import { packetBodyItemText, sectionsUseBlocks, type PacketBlock } from "../shared/packetBlocks";
import { assertPacketCompatible } from "../shared/templateProvenance";
import { pathwayForPacket } from "../shared/pathways/registry";

/**
 * Minute-book reports and the signable-instrument DOCX layout (lawyer review
 * items 9 and 10): block rendering, entity-aware adoption wording, signature
 * table, review memo separation, unique document IDs, the report builders
 * (as-of registers, consents, transparency, LOTA, summary, covering letter),
 * catalog scoping and restricted access. All fixtures are synthetic.
 */

/** Visible text of a stored-zip DOCX (document.xml), with paragraph/cell breaks. */
function docxText(bytes: Uint8Array): string {
  const text = Buffer.from(bytes).toString("utf8");
  const xml = text.slice(text.indexOf("<w:body>"), text.indexOf("</w:document>"));
  return xml
    .replace(/<w:p>/g, "\n")
    .replace(/<w:tc>/g, " | ")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/ \| \n/g, " | ");
}
function docxXml(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

const BC_ORG = {
  name: "Harbourline Ventures Ltd.",
  shortName: "the Company",
  entityType: "corporation__business_",
  jurisdictionCode: "CA-BC",
  actFormedUnder: "business_corporations_act__british_columbia_",
  legalSubtype: "ordinary_private_company",
  incorporationNumber: "BC1234567",
  incorporationDate: "2016-03-01",
  minuteBookLocation: "Records office",
  primaryContactName: "Robin Example",
};
const CBCA_ORG = { ...BC_ORG, name: "Northpoint Federal Inc.", jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act", legalSubtype: "federal_private_corporation", incorporationNumber: "1234567-8" };
const ON_ORG = { ...BC_ORG, name: "Lakeshore Ontario Inc.", jurisdictionCode: "CA-ON-OBCA", actFormedUnder: "business_corporations_act__ontario_", legalSubtype: undefined };
const SOCIETY = { name: "Riverbend Community Society", entityType: "society", jurisdictionCode: "CA-BC", actFormedUnder: "societies_act", legalSubtype: "ordinary_society" };

const directorsCtx = buildSocietyRenderContext(BC_ORG, [{ roleType: "director", fullName: "Dana Wells" }, { roleType: "director", fullName: "Sam Okoro" }], "2026-06-25");
const board = buildExecutionBlock({
  shortName: "the Company", legislation: directorsCtx.org.legislation, noun: "director", resolutionsPlural: true,
  signers: [{ name: "Dana Wells", capacity: "Director" }, { name: "Sam Okoro", capacity: "Director" }], dateLong: "June 25, 2026",
});

// --- 1. wording helpers ------------------------------------------------------
assert.equal(
  consentAdoptionClause({ noun: "director", count: 2, shortName: "the Company", legislation: "Business Corporations Act", dateLong: "June 25, 2026", resolutionsPlural: true }),
  "The foregoing resolutions are consented to in writing by all the directors of the Company, effective June 25, 2026, pursuant to the Business Corporations Act.",
);
assert.equal(
  consentAdoptionClause({ noun: "director", count: 1, shortName: "the Company", resolutionsPlural: false }),
  "The foregoing resolution is consented to in writing by the sole director of the Company.",
);
assert.ok(consentAdoptionClause({ noun: "shareholder", count: 3, shortName: "Acme", resolutionsPlural: true })!.includes("by all the shareholders of Acme"));
assert.ok(consentAdoptionClause({ noun: "voting shareholder", count: 1, shortName: "Acme", resolutionsPlural: false })!.includes("by the sole voting shareholder of Acme"));
assert.ok(consentAdoptionClause({ noun: "member", count: 4, shortName: "Riverbend", resolutionsPlural: false })!.includes("by all the voting members of Riverbend"));
assert.equal(consentAdoptionClause({ noun: "officer", count: 1, shortName: "Acme", resolutionsPlural: false }), undefined, "officers do not pass written resolutions");
assert.equal(instrumentTitle("director", 1, "x"), "CONSENT DIRECTOR'S RESOLUTION");
assert.equal(instrumentTitle("director", 3, "x"), "CONSENT DIRECTORS' RESOLUTION");
assert.equal(instrumentTitle("voting shareholder", 2, "x"), "CONSENT SHAREHOLDERS' RESOLUTION");
assert.equal(instrumentTitle("officer", 1, "Evidence packet"), "EVIDENCE PACKET");
const corporate = buildExecutionBlock({ shortName: "Acme", legislation: "Act", noun: "shareholder", resolutionsPlural: false, signers: [{ name: "Jordan Vane", capacity: "President", corpSign: "Vane Holdings Ltd." }, { name: "Ana Ruiz" }] });
assert.deepEqual(executionSigners(corporate), [{ corpSign: "Vane Holdings Ltd.", name: "Jordan Vane, President" }, { name: "Ana Ruiz" }]);

// --- 2. signable instrument from structured blocks ---------------------------
const base = CORPORATION_DOCUMENT_PACKETS.find((packet) => packet.key === "share-transfer")!;
const blockPacket = {
  ...base,
  sections: [{
    heading: "",
    body: [
      { kind: "title", text: "Transfer of Shares" },
      { kind: "recital", text: "an application has been received to transfer shares in the capital of {org.shortName};" },
      { kind: "recital", text: "the transfer is permitted by the articles;", when: "transfer.permitted" },
      { kind: "clause", text: "The transfer of shares to the following person is approved:" },
      { kind: "table", columns: ["Transferee", "Number and class"], each: "transfer.rows", cells: ["{.to}", "{.qty} {.cls}"] },
      { kind: "clause", text: "The certificate below is cancelled:" },
      { kind: "table", columns: ["Certificate", "Holder"], each: "transfer.none", cells: ["{.n}", "{.h}"], emptyText: "No certificate is cancelled." },
      { kind: "clause", text: "Hidden clause", when: "!transfer.permitted" },
    ] as PacketBlock[],
  }],
};
assert.ok(sectionsUseBlocks(blockPacket.sections));
assert.equal(packetBodyItemText({ kind: "table", columns: ["A", "B"], rows: [["1", "2"]] }), "A | B\n1 | 2");
const blockCtx = { ...directorsCtx, execution: board, transfer: { permitted: true, rows: [{ to: "Ana {Ruiz}", qty: 10, cls: "Class A Common Shares" }], none: [] } };
const blockText = docxText(corporationPacketDocxBytes(blockPacket as never, blockCtx as never));
assert.ok(blockText.includes("HARBOURLINE VENTURES LTD."), "company name header");
assert.ok(blockText.includes("CONSENT DIRECTORS' RESOLUTION"), "possessive title");
assert.ok(blockText.includes("Transfer of Shares"), "subtitle from a title block");
assert.ok(blockText.includes("WHEREAS an application has been received to transfer shares in the capital of the Company;"));
assert.ok(blockText.includes("AND WHEREAS the transfer is permitted by the articles;"), "second recital and `when`");
assert.ok(blockText.indexOf("BE IT RESOLVED THAT:") < blockText.indexOf("1.\tThe transfer of shares"), "resolving words precede clause 1");
assert.ok(blockText.includes("2.\tThe certificate below is cancelled:"));
assert.ok(!blockText.includes("Hidden clause"), "`when: !path` hides a clause");
assert.ok(blockText.includes(" | Ana {Ruiz} | 10 Class A Common Shares"), "data row rendered as a real table row; braces in data stay literal");
assert.ok(blockText.includes("No certificate is cancelled."), "empty table falls back to its emptyText");
assert.ok(blockText.includes("The foregoing resolutions are consented to in writing by all the directors of the Company, effective June 25, 2026"), "two clauses → plural adoption clause");
const blockXml = docxXml(corporationPacketDocxBytes(blockPacket as never, blockCtx as never));
assert.ok(/<w:tbl>.*Transferee.*<\/w:tbl>/s.test(blockXml), "real DOCX table");
assert.ok(blockXml.includes("<w:cantSplit/>") && blockXml.includes("<w:tblHeader/>"), "rows never split; heading row repeats");

// The signature group stays together and the date travels with it.
const instrumentText = docxText(corporationPacketInstrumentDocxBytes(blockPacket as never, blockCtx as never));
const datedAt = instrumentText.indexOf("Dated: June 25, 2026");
assert.ok(datedAt > instrumentText.indexOf("2.\tThe certificate"), "Dated follows the clauses");
assert.ok(instrumentText.includes("[Signature page to the consent directors' resolution of Harbourline Ventures Ltd. dated June 25, 2026]"), "date repeated on the signature page");
assert.ok(/____\n\s*Dana Wells, Director \|/.test(instrumentText) && instrumentText.includes("Sam Okoro, Director"), "name printed under the line, two columns");
const sigXml = docxXml(corporationPacketInstrumentDocxBytes(blockPacket as never, blockCtx as never));
const datedXml = sigXml.slice(sigXml.lastIndexOf("<w:p>", sigXml.indexOf("Dated: June 25, 2026")), sigXml.indexOf("Dated: June 25, 2026"));
assert.ok(datedXml.includes("<w:keepNext/>"), "Dated line keeps with the adoption clause and signatures");
assert.ok(!instrumentText.includes("Review memo") && !instrumentText.includes("Required data"), "checklist is not in the signed instrument");
const memoText = docxText(corporationPacketReviewMemoDocxBytes(blockPacket as never, blockCtx as never));
assert.ok(memoText.includes("Review memo") && memoText.includes("Required data") && memoText.includes("Review terms"));
assert.ok(!memoText.includes("BE IT RESOLVED"));
// The combined file puts the memo in its own section after a section break.
const combinedXml = docxXml(corporationPacketDocxBytes(blockPacket as never, blockCtx as never));
assert.ok(combinedXml.indexOf("<w:pPr><w:sectPr>") < combinedXml.indexOf("Review memo"), "memo starts a new section");

// Explicit adoption block and the per-organization omit option.
const adoptionPacket = { ...blockPacket, sections: [{ heading: "", body: [{ kind: "clause", text: "Only clause." }, { kind: "adoption", text: "CUSTOM ADOPTION LINE." }] as PacketBlock[] }] };
const adoptionText = docxText(corporationPacketDocxBytes(adoptionPacket as never, blockCtx as never));
assert.ok(adoptionText.includes("CUSTOM ADOPTION LINE.") && !adoptionText.includes("consented to in writing"));
const omitted = docxText(corporationPacketDocxBytes(blockPacket as never, { ...blockCtx, omitAdoptionClause: true } as never));
assert.ok(!omitted.includes("consented to in writing") && omitted.includes("Dated: June 25, 2026") && omitted.includes("Dana Wells"), "omit option drops only the adoption clause");

// --- 3. legacy plain-string bodies still render --------------------------------
const organize = CORPORATION_DOCUMENT_PACKETS.find((packet) => packet.key === "organize-corporation")!;
const legacy = docxText(corporationPacketDocxBytes(organize, { ...directorsCtx, execution: board } as never));
assert.ok(legacy.includes("The directors confirm the corporation's organization records"), "plain strings render as paragraphs");
assert.ok(!legacy.includes("BE IT RESOLVED THAT:"), "no resolving words are invented for prose bodies");
assert.ok(legacy.includes("consented to in writing by all the directors of the Company"));
const sole = buildSocietyRenderContext(BC_ORG, [{ roleType: "director", fullName: "Dana Wells" }], "2026-06-25");
const soleExec = buildExecutionBlock({ shortName: "the Company", legislation: "Business Corporations Act", noun: "director", resolutionsPlural: true, signers: [{ name: "Dana Wells" }], dateLong: "June 25, 2026" });
const soleText = docxText(corporationPacketDocxBytes(organize, { ...sole, execution: soleExec } as never));
assert.ok(soleText.includes("CONSENT DIRECTOR'S RESOLUTION") && soleText.includes("by the sole director of the Company"));
// Shareholder bodies are entity-aware.
const shareholders = CORPORATION_DOCUMENT_PACKETS.find((packet) => packet.key === "all-voting-shareholders-resolution")!;
const shExec = buildExecutionBlock({ shortName: "the Company", legislation: "Business Corporations Act", noun: "voting shareholder", resolutionsPlural: false, signers: [{ name: "Ana Ruiz" }, { name: "Lee Park" }], dateLong: "June 25, 2026" });
const shText = docxText(corporationPacketDocxBytes(shareholders, { ...directorsCtx, execution: shExec } as never));
assert.ok(shText.includes("CONSENT SHAREHOLDERS' RESOLUTION") && shText.includes("by all the voting shareholders of the Company"));
// French keeps the French adoption clause.
const frExec = buildExecutionBlock({ shortName: "Acme", legislation: "Loi", noun: "director", resolutionsPlural: false, signers: [{ name: "A" }], dateLong: "25 juin 2026", locale: "fr" });
const frText = docxText(corporationPacketDocxBytes(organize, { ...directorsCtx, execution: frExec } as never));
assert.ok(frText.includes("Le soussigné, étant le seul administrateur de Acme") && frText.includes("Daté le: 25 juin 2026"));
// Preparation-only worksheets keep the preparation banner and never get signatures.
const worksheet = CORPORATION_DOCUMENT_PACKETS.find((packet) => packet.key === "bc-articles-preparation")!;
const worksheetText = docxText(corporationPacketDocxBytes(worksheet, { ...directorsCtx, execution: board } as never));
assert.ok(worksheetText.includes("PREPARATION DRAFT — NOT FOR EXECUTION"));
assert.ok(!worksheetText.includes("consented to in writing") && !worksheetText.includes("Dana Wells") && !worksheetText.includes("Dated:"));
// Society packets render with society wording only.
const societyRes = SOCIETY_DOCUMENT_PACKETS.find((packet) => packet.key === "society-special-resolution")!;
const socCtx = buildSocietyRenderContext({ ...SOCIETY, shortName: "Riverbend" }, [{ roleType: "member", fullName: "A" }, { roleType: "member", fullName: "B" }], "2026-06-25");
const socExec = buildExecutionBlock({ shortName: "Riverbend", legislation: "Societies Act", noun: "member", resolutionsPlural: false, signers: [{ name: "A" }, { name: "B" }] });
const socText = docxText(corporationPacketDocxBytes(societyRes, { ...socCtx, execution: socExec } as never));
assert.ok(socText.includes("CONSENT MEMBERS' RESOLUTION") && socText.includes("by all the voting members of Riverbend"));
assert.ok(!/shareholder|Business Corporations/i.test(socText.split("Review memo")[0]), "no corporate wording in a society instrument");

// --- 4. unique document IDs --------------------------------------------------
const transfer = CORPORATION_DOCUMENT_PACKETS.find((packet) => packet.key === "share-transfer")!;
assert.equal(corporationPacketDocumentId(transfer, { registryNumber: "BC1234567", shortName: "Harbourline", effectiveDate: "2026-10-12", sequence: 2 }), "BC1234567-share-transfer-2026-10-12-02");
assert.equal(corporationPacketDocumentId(transfer, { shortName: "Acme Inc.", effectiveDate: "2026-06-25" }), "acme-inc-share-transfer-2026-06-25", "legacy id without registry or sequence");
assert.equal(corporationPacketDocumentId(transfer, { registryNumber: "1234567-8", effectiveDate: "2026-06-25", sequence: 1 }), "12345678-share-transfer-2026-06-25-01");
const prior = [
  { effectiveDate: "2026-10-12", sourceExternalIds: ["societyer:corporation-packet-run:share-transfer"] },
  { effectiveDate: "2026-10-12T09:00:00Z", sourceExternalIds: ["societyer:corporation-packet-run:share-transfer"] },
  { effectiveDate: "2026-10-11", sourceExternalIds: ["societyer:corporation-packet-run:share-transfer"] },
  { effectiveDate: "2026-10-12", sourceExternalIds: ["societyer:corporation-packet-run:share-split"] },
];
assert.equal(nextPacketDocumentSequence(prior, "share-transfer", "2026-10-12"), 3);
assert.equal(nextPacketDocumentSequence(prior, "share-split", "2026-10-12"), 2);
assert.equal(nextPacketDocumentSequence([], "share-transfer", "2026-10-12"), 1);
assert.equal(corporationPacketDocxFileName(transfer, { shortName: "Acme", effectiveDate: "2026-10-12", sequence: 1 }), "acme-share-transfer-2026-10-12.docx");
assert.equal(corporationPacketDocxFileName(transfer, { shortName: "Acme", effectiveDate: "2026-10-12", sequence: 3 }), "acme-share-transfer-2026-10-12-03.docx");
const idText = docxText(corporationPacketDocxBytes(organize, { ...directorsCtx, documentId: "BC1234567-organize-corporation-2026-06-25-01" } as never));
assert.ok(idText.trimStart().startsWith("Document ID: BC1234567-organize-corporation-2026-06-25-01"), "doc ID at the top");

// --- 5. report builders --------------------------------------------------------
const roleHolders = [
  { _id: "d1", roleType: "director", fullName: "Dana Wells", startDate: "2016-03-01", serviceStreet: "100 Example St", serviceCity: "Vancouver", serviceProvinceState: "BC", serviceCountry: "Canada" },
  { _id: "d2", roleType: "director", fullName: "Sam Okoro", startDate: "2016-03-01", endDate: "2024-05-01" },
  { _id: "d3", roleType: "director", fullName: "Lee Park", startDate: "2026-06-25", street: "9 Sample Rd", city: "Victoria", country: "Canada" },
  { _id: "o1", roleType: "officer", fullName: "Dana Wells", officerTitle: "President", startDate: "2016-03-01" },
  { _id: "o2", roleType: "officer", fullName: "Sam Okoro", officerTitle: "Secretary", startDate: "2016-03-01", endDate: "2024-05-01" },
  { _id: "s1", roleType: "shareholder", fullName: "Ana Ruiz", street: "1 Test Ave", city: "Kelowna", country: "Canada", dateOfBirth: "1980-01-02" },
  { _id: "s2", roleType: "shareholder", fullName: "Birch Holdings Ltd.", nonNaturalPerson: true },
  { _id: "c1", roleType: "controller", fullName: "Ana Ruiz", startDate: "2016-03-01", dateOfBirth: "1980-01-02", street: "1 Test Ave", city: "Kelowna", country: "Canada", citizenshipResidency: "Canadian citizen", taxResidentHomeJurisdiction: "yes", significanceReason: "Holds 25% or more of the voting shares" },
  { _id: "c2", roleType: "controller", fullName: "Future Person", startDate: "2027-01-01" },
];
const rightsClasses = [
  { _id: "A", className: "Class A Voting Common", classType: "share", status: "active", votesPerShare: 1 },
  { _id: "B", className: "Class B Non-Voting Preferred", classType: "share", status: "active", votesPerShare: 0 },
];
const posted = (row: Record<string, unknown>) => ({ societyId: "s", status: "posted", sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: "2016-03-01T00:00:00Z", updatedAtISO: "2016-03-01T00:00:00Z", ...row }) as never;
const transfers = [
  posted({ _id: "t1", transferType: "issuance", transferDate: "2016-03-01", rightsClassId: "A", destinationRoleHolderId: "s1", quantity: 60, considerationType: "cash" }),
  posted({ _id: "t2", transferType: "issuance", transferDate: "2016-03-01", rightsClassId: "A", destinationRoleHolderId: "s2", quantity: 40 }),
  posted({ _id: "t3", transferType: "issuance", transferDate: "2020-01-15", rightsClassId: "B", destinationHolderName: "Chris Minor", quantity: 500 }),
  posted({ _id: "t4", transferType: "transfer", transferDate: "2026-07-01", rightsClassId: "A", sourceRoleHolderId: "s1", destinationRoleHolderId: "s2", quantity: 50 }),
  { ...posted({ _id: "t5", transferType: "issuance", transferDate: "2026-01-01", rightsClassId: "A", destinationRoleHolderId: "s1", quantity: 999 }), status: "draft" },
];
const certificates = [
  { certificateNumber: "A-1", holderName: "Ana Ruiz", shareClass: "Class A Voting Common", shares: 60, issuedOn: "2016-03-01" },
  { certificateNumber: "A-2", holderName: "Birch Holdings Ltd.", shareClass: "Class A Voting Common", shares: 40, issuedOn: "2016-03-01" },
  { certificateNumber: "A-0", holderName: "Ana Ruiz", shareClass: "Class A Voting Common", shares: 60, issuedOn: "2015-01-01", cancelledOn: "2016-02-01" },
];
const reportBase: Omit<MinuteBookReportInput, "kind"> = {
  organization: BC_ORG, asOf: "2026-06-25", roleHolders, rightsClasses, transfers, certificates, canViewRestricted: true,
  nameHistory: [{ name: "1234567 B.C. Ltd.", startISO: "2016-03-01" }, { name: "Harbourline Ventures Ltd.", startISO: "2018-05-01" }],
  addresses: [
    { type: "registered_office", status: "current", effectiveFrom: "2016-03-01", street: "200 Office Way", city: "Vancouver", country: "Canada" },
    { type: "records_office", status: "past", effectiveFrom: "2016-03-01", effectiveTo: "2020-01-01", street: "Old Records Rd", city: "Vancouver", country: "Canada" },
  ],
};
const text = (report: { blocks: PacketBlock[] }) => report.blocks.map(packetBodyItemText).join("\n");

// Ledger as of a date: later transfers and drafts are excluded.
const holdings = ledgerHoldingsAsOf(transfers, "2026-06-25");
assert.equal(holdings.find((h) => h.holderKey === "roleHolder:s1")?.quantity, 60);
assert.equal(ledgerHoldingsAsOf(transfers, "2026-07-01").find((h) => h.holderKey === "roleHolder:s1")?.quantity, 10, "end-of-day view includes that day's transfer");
assert.equal(nameAsOf(BC_ORG, reportBase.nameHistory, "2017-01-01"), "1234567 B.C. Ltd.");

const securities = buildMinuteBookReport({ ...reportBase, kind: "securities-register" });
const securitiesText = text(securities);
assert.ok(securitiesText.includes("Ana Ruiz | 1 Test Ave, Kelowna, Canada | 60 | A-1"), "holder, address, quantity and certificate");
assert.ok(securitiesText.includes("Chris Minor |  | 500 | Uncertificated / not recorded"));
assert.ok(!securitiesText.includes("A-0"), "cancelled certificate not listed");
assert.ok(!securitiesText.includes("999"), "draft ledger rows ignored");
assert.equal(securities.warnings.length, 0);
const laterSecurities = buildMinuteBookReport({ ...reportBase, kind: "securities-register", asOf: "2026-07-02" });
assert.ok(laterSecurities.warnings.some((w) => w.includes("Ana Ruiz") && w.includes("ledger shows 10")), "certificate/ledger disagreement flagged");

const directorsRegister = text(buildMinuteBookReport({ ...reportBase, kind: "directors-register" }));
assert.ok(directorsRegister.includes("Prescribed address"), "BC wording");
assert.ok(directorsRegister.includes("Sam Okoro |  | March 1, 2016 | May 1, 2024 | Secretary (March 1, 2016 to May 1, 2024)"));
assert.ok(directorsRegister.includes("Dana Wells | 100 Example St, Vancouver, BC, Canada | March 1, 2016 |  | President (March 1, 2016)"));
assert.ok(directorsRegister.includes("Lee Park"), "appointed on the as-of date counts");
assert.ok(!text(buildMinuteBookReport({ ...reportBase, kind: "directors-register", asOf: "2026-06-24" })).includes("Lee Park"));
assert.ok(!text(buildMinuteBookReport({ ...reportBase, organization: CBCA_ORG, kind: "directors-register" })).includes("Prescribed address"), "CBCA wording differs");

const officers = text(buildMinuteBookReport({ ...reportBase, kind: "officers-register" }));
assert.ok(officers.includes("Dana Wells | President | March 1, 2016 |  | Yes") && officers.includes("Sam Okoro | Secretary | March 1, 2016 | May 1, 2024 | No"));

const summary = buildMinuteBookReport({ ...reportBase, kind: "corporate-summary" });
const summaryText = text(summary);
assert.ok(summaryText.includes("Legal name | Harbourline Ventures Ltd.") && summaryText.includes("Incorporation number | BC1234567"));
assert.ok(summaryText.includes("Business Corporations Act (British Columbia)"));
assert.ok(summaryText.includes("1234567 B.C. Ltd. | March 1, 2016"), "name history");
assert.ok(summaryText.includes("Registered office | 200 Office Way, Vancouver, Canada") && summaryText.includes("Records office | Not recorded"), "offices as of the date");
assert.ok(summaryText.includes("Ana Ruiz | 60 | 60.00%"), "voting percentages");
assert.ok(!summaryText.includes("Sam Okoro |"), "former directors and officers are not in office");
const oldSummary = text(buildMinuteBookReport({ ...reportBase, kind: "corporate-summary", asOf: "2017-06-01" }));
assert.ok(oldSummary.includes("Legal name | 1234567 B.C. Ltd.") && oldSummary.includes("Sam Okoro"), "a historical date shows historical facts");

const bcConsent = text(buildMinuteBookReport({ ...reportBase, kind: "director-consent" }));
assert.ok(bcConsent.includes("I, Lee Park, consent to act as a director of the Company, effective June 25, 2026."));
assert.ok(bcConsent.includes("section 123(1)(a)") && bcConsent.includes("prescribed address") && bcConsent.includes("9 Sample Rd, Victoria, Canada"));
assert.ok(!bcConsent.includes("Dana Wells"), "only directors appointed on the date");
const cbcaConsent = text(buildMinuteBookReport({ ...reportBase, organization: CBCA_ORG, kind: "director-consent" }));
assert.ok(cbcaConsent.includes("section 106(9) of the Canada Business Corporations Act") && !cbcaConsent.includes("123(1)"));
const onConsent = text(buildMinuteBookReport({ ...reportBase, organization: ON_ORG, kind: "director-consent" }));
assert.ok(onConsent.includes("section 119(9) of the Business Corporations Act (Ontario)"));
const blankConsent = buildMinuteBookReport({ ...reportBase, kind: "director-consent", asOf: "2026-06-26" });
assert.ok(text(blankConsent).includes("[Full name of director]") && blankConsent.warnings.length === 1);

const transparency = buildMinuteBookReport({ ...reportBase, kind: "bc-transparency-register", transparencySteps: [{ individualName: "Ana Ruiz", stepsNarrative: "Requested confirmation", stepDate: "2026-03-05" }] });
const transparencyText = text(transparency);
assert.equal(transparency.restricted, true);
assert.ok(transparencyText.includes("section 119.61(2)") && transparencyText.includes("RESTRICTED ACCESS"));
assert.ok(transparencyText.includes("Date of birth | January 2, 1980") && transparencyText.includes("Resident in Canada for purposes of the Income Tax Act (Canada) | Yes"));
assert.ok(!transparencyText.includes("Future Person"), "entries after the as-of date excluded");
assert.ok(transparencyText.includes("Requested confirmation"), "steps-taken log");
const redacted = buildMinuteBookReport({ ...reportBase, kind: "bc-transparency-register", canViewRestricted: false });
assert.ok(!text(redacted).includes("Ana Ruiz") && !text(redacted).includes("1980"), "no personal information without access");
const federalTransparency = buildMinuteBookReport({ ...reportBase, organization: CBCA_ORG, kind: "bc-transparency-register" });
assert.ok(!text(federalTransparency).includes("Ana Ruiz"), "the BC register never prints for a federal corporation");
const empty = text(buildMinuteBookReport({ ...reportBase, roleHolders: [], kind: "bc-transparency-register" }));
assert.ok(empty.includes("section 119.2(3)") && empty.includes("No significant individuals are recorded"));

const lota = buildMinuteBookReport({ ...reportBase, kind: "lota-report", asOf: "2026-07-02", assets: [{ name: "Warehouse lot", category: "Land", location: "Surrey, BC", serialNumber: "000-111-222", purchaseDate: "2019-01-01" }, { name: "Laptop", category: "Equipment" }] });
const lotaText = text(lota);
assert.equal(lota.restricted, true);
assert.ok(lotaText.includes("Warehouse lot | Surrey, BC | 000-111-222") && !lotaText.includes("Laptop"));
assert.ok(lotaText.includes("Social insurance number | <FILL>") && lotaText.includes("Individual tax number | <FILL>"), "identifiers stay fill-ins");
assert.ok(lotaText.includes("Chris Minor"), "500 of 600 issued shares (non-voting) meets the 10% share test");
assert.ok(lotaText.includes("Percentage of votes | 10.00%"), "exactly 10% of the votes meets the threshold");
assert.ok(lota.warnings.some((w) => w.includes("look through")), "corporate holder above threshold flagged for look-through");
assert.ok(lotaText.includes("Birch Holdings Ltd. | 15.00% | 90.00%"));

const letter = buildMinuteBookReport({ ...reportBase, kind: "cover-letter", generatedDocuments: [
  { title: "Share transfer packet", effectiveDate: "2026-06-25" },
  { title: "Share transfer packet", effectiveDate: "2026-06-25" },
  { title: "Old packet", effectiveDate: "2026-01-01" },
] });
const letterText = text(letter);
assert.ok(letterText.includes("1 | Share transfer packet") && !letterText.includes("Old packet") && letterText.split("Share transfer packet").length === 2, "enclosures from the date, deduplicated");
assert.ok(letterText.includes("Dear Robin Example:"));

// Report DOCX: blocks printed verbatim (no template evaluation of data).
const reportPacket = CORPORATION_DOCUMENT_PACKETS.find((packet) => packet.key === "securities-register-report")!;
const tricky = buildMinuteBookReport({ ...reportBase, kind: "securities-register", roleHolders: roleHolders.map((row) => row._id === "s1" ? { ...row, fullName: "{org.name} Ruiz" } : row) });
const reportDocx = docxText(corporationPacketDocxBytes(reportPacket, { ...directorsCtx, execution: board, report: tricky } as never));
assert.ok(reportDocx.includes("{org.name} Ruiz"), "register data never passes through the template engine");
assert.ok(reportDocx.includes("Securities register") && reportDocx.includes("Harbourline Ventures Ltd., as at June 25, 2026"));
assert.ok(!reportDocx.split("Review memo")[0].includes("consented to in writing"), "reports carry no board adoption clause");
const fallbackDocx = docxText(corporationPacketDocxBytes(reportPacket));
assert.ok(fallbackDocx.includes("Generate this output from the document catalog"));

// --- 6. catalog scoping ------------------------------------------------------
assert.equal(CORPORATION_REPORT_PACKETS.length, 8);
for (const packet of CORPORATION_REPORT_PACKETS) {
  assert.ok(CORPORATION_DOCUMENT_PACKETS.includes(packet), `${packet.key} is in the corporation catalog`);
  assert.ok(isReportPacketKey(packet.key) && reportKindForPacket(packet.key));
  assert.throws(() => assertPacketCompatible(SOCIETY as never, packet), /entity type/i, `${packet.key} never applies to a society`);
  assert.ok(!SOCIETY_DOCUMENT_PACKETS.some((candidate) => candidate.key === packet.key));
}
assert.equal(new Set(CORPORATION_DOCUMENT_PACKETS.map((packet) => packet.key)).size, CORPORATION_DOCUMENT_PACKETS.length, "unique packet keys");
const bcOnly = CORPORATION_REPORT_PACKETS.filter((packet) => isRestrictedReportPacketKey(packet.key)).map((packet) => packet.key).sort();
assert.deepEqual(bcOnly, ["bc-transparency-register", "lota-interest-holder-report"]);
for (const key of bcOnly) {
  const packet = CORPORATION_REPORT_PACKETS.find((candidate) => candidate.key === key)!;
  assert.doesNotThrow(() => pathwayForPacket(BC_ORG, packet));
  assert.throws(() => pathwayForPacket(CBCA_ORG, packet), /jurisdiction/i, `${key} is BC only`);
}
assert.equal(CORPORATION_DOCUMENT_PACKETS.find((packet) => packet.key === "isc-register-update")!.jurisdictions.every((code) => /fed|federal/i.test(code)), true, "federal ISC packet stays federal");
assert.doesNotThrow(() => pathwayForPacket(CBCA_ORG, CORPORATION_REPORT_PACKETS.find((packet) => packet.key === "securities-register-report")!));
assert.equal(roleMayViewRestrictedRegisters("Director"), true);
assert.equal(roleMayViewRestrictedRegisters("Admin"), true);
assert.equal(roleMayViewRestrictedRegisters("Member"), false);
assert.equal(roleMayViewRestrictedRegisters("Viewer"), false);
const viewerCtx = {
  principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "viewer", userId: "u1", societyId: "s1" },
  db: { get: async () => ({ _id: "u1", societyId: "s1", role: "Viewer", status: "Active" }) },
};
await assert.rejects(assertMinuteBookReportAccess(viewerCtx as never, "s1", "bc-transparency-register"), /restricted access/i);
await assertMinuteBookReportAccess(viewerCtx as never, "s1", "securities-register-report");

// --- 7. end to end through the generation mutation (convex-test) -------------
const issuer = betterAuthIssuer();
{
  const test = convexTest(schema, {
    "./_generated/api.js": () => import("../convex/_generated/api.js"),
    "./_generated/server.js": () => import("../convex/_generated/server.js"),
    "./legalOperations.js": () => import("../convex/legalOperations"),
  });
  const now = "2026-01-01T00:00:00.000Z";
  const seeded = await test.run(async (ctx: any) => {
    const societyId = await ctx.db.insert("societies", { ...BC_ORG, isCharity: false, isMemberFunded: false, includeDocumentIdHeader: true, updatedAt: 0 });
    for (const [subject, role] of [["owner", "Owner"], ["viewer", "Viewer"], ["director", "Director"]]) {
      await ctx.db.insert("users", { societyId, email: `${subject}@reports.test`, displayName: subject, role, status: "Active", authSubject: subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: now });
    }
    const ids: Record<string, any> = {};
    for (const row of roleHolders) {
      const { _id, ...rest } = row as any;
      ids[_id] = await ctx.db.insert("roleHolders", { societyId, status: rest.endDate ? "former" : "current", citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], controllingIndividualIds: [], sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: now, updatedAtISO: now, ...rest });
    }
    const classIds: Record<string, any> = {};
    for (const row of rightsClasses) {
      const { _id, ...rest } = row;
      classIds[_id] = await ctx.db.insert("rightsClasses", { societyId, sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: now, updatedAtISO: now, ...rest });
    }
    for (const row of transfers as any[]) {
      const { _id, societyId: _ignored, ...rest } = row;
      await ctx.db.insert("rightsholdingTransfers", {
        ...rest, societyId, rightsClassId: classIds[rest.rightsClassId],
        ...(rest.sourceRoleHolderId ? { sourceRoleHolderId: ids[rest.sourceRoleHolderId] } : {}),
        ...(rest.destinationRoleHolderId ? { destinationRoleHolderId: ids[rest.destinationRoleHolderId] } : {}),
      });
    }
    for (const cert of certificates) await ctx.db.insert("shareCertificates", { societyId, ...cert, createdAtISO: now });
    return { societyId };
  });
  const owner = test.withIdentity({ issuer, subject: "owner" });
  const viewer = test.withIdentity({ issuer, subject: "viewer" });
  const director = test.withIdentity({ issuer, subject: "director" });
  const generate = (who: typeof owner, packetKey: string, effectiveDate = "2026-06-25") =>
    who.mutation(api.legalOperations.generateDocumentFromCatalog, { societyId: seeded.societyId, packetKey, effectiveDate });
  const readDocx = async (documentId: string) => test.run(async (ctx: any) => {
    const doc = await ctx.db.get(documentId);
    return { doc, text: docxText(Buffer.from(String(doc.url).split(",")[1], "base64")) };
  });

  const first = await generate(owner, "securities-register-report");
  const { doc: securitiesDoc, text: securitiesStored } = await readDocx(first.draftDocumentId);
  assert.ok(securitiesStored.includes("Ana Ruiz | 1 Test Ave, Kelowna, Canada | 60 | A-1"), "stored DOCX is built from the registers as of the date");
  assert.ok(securitiesStored.includes("Document ID: BC1234567-securities-register-report-2026-06-25-01"));
  const second = await generate(owner, "securities-register-report");
  const { doc: secondDoc, text: secondStored } = await readDocx(second.draftDocumentId);
  assert.ok(secondStored.includes("Document ID: BC1234567-securities-register-report-2026-06-25-02"), "per-day sequence");
  assert.notEqual(securitiesDoc.fileName, secondDoc.fileName, "file names do not collide");

  // The hosted wrapper already requires documents:write; the portable gate (tested above) also refuses.
  await assert.rejects(generate(viewer, "bc-transparency-register"), /restricted access|documents:write/i, "a viewer cannot print the transparency register");
  const runsAfterRefusal = await test.run(async (ctx: any) => (await ctx.db.query("legalPrecedentRuns").collect()).filter((row: any) => String(row.name).startsWith("BC transparency")).length);
  assert.equal(runsAfterRefusal, 0, "nothing is written for a refused restricted report");
  const transparencyRun = await generate(director, "bc-transparency-register");
  const { doc: transparencyDoc, text: transparencyStored } = await readDocx(transparencyRun.draftDocumentId);
  assert.ok(transparencyStored.includes("RESTRICTED ACCESS") && transparencyStored.includes("Ana Ruiz"));
  assert.ok(transparencyDoc.tags.includes("restricted-register"));
  const evidence = await test.run(async (ctx: any) => ctx.db.get(transparencyRun.sourceEvidenceId));
  assert.equal(evidence.accessLevel, "restricted");

  // The per-organization adoption-clause option reaches the generated document.
  await test.run(async (ctx: any) => ctx.db.patch(seeded.societyId, { omitAdoptionClause: true }));
  const organizeRun = await generate(owner, "organize-corporation");
  const { text: organizeStored } = await readDocx(organizeRun.draftDocumentId);
  assert.ok(organizeStored.includes("Dated: June 25, 2026") && !organizeStored.includes("consented to in writing"));
}

console.log("OK minute-book-reports");
