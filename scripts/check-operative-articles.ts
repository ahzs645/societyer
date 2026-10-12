import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { verifyFixtureFormation } from "./helpers/verifiedFormation";
import {
  articlesAdoptionSentence,
  evaluateArticlesShareholderQuorum,
  operativeArticlesProblems,
  resolveOperativeArticles,
  transferConsentRequired,
} from "../shared/operativeArticles";
import { bylawBaselineForOrganization, contextualBylawRules, quorumRequiresLegalRegisterFor } from "../shared/bylawBaselines";
import { legalMeetingQuorum } from "../shared/legalDecision";
import { resolveMeetingQuorumRule, computeQuorumFromRule } from "../shared/bodyQuorum";
import { articlesClassParts, articlesDraftingWarnings, articlesPacketView } from "../shared/articlesPartSkeleton";
import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";
import { corporationPacketDocxBytes } from "../shared/corporationPacketDocx";
import { buildRenderContext } from "../shared/renderContext";
import { CORPORATE_LEGAL_SOURCES } from "../shared/corporateLegalSources";
import { incorporationPreparationForOrganization } from "../shared/incorporationPreparation";
import { incorporationWorksheetText } from "../shared/incorporationWorksheet";

/**
 * Operative articles of a BC company (Table 1 version or custom, custom Parts,
 * overrides), the Table 1 quorum wiring, the articles packets' Part skeleton
 * and drafting checks, and the indemnity / Table 1 / electronic sources.
 * Fixtures are synthetic.
 */

const bc = { entityType: "corporation__business_", jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act", formationStatus: "incorporated" };
const table1 = { base: "bc_table_1", table1Version: "am_186_2007", table1Incorporation: "by_reference", adoptedOn: "2016-12-10", customParts: [{ part: "Parts 21-23", title: "Class A, B and C special rights and restrictions" }] } as const;

// ---- 1. Record and resolve --------------------------------------------------
assert.deepEqual(operativeArticlesProblems(table1, bc), []);
assert.match(operativeArticlesProblems({ base: "bc_table_1" }, bc).join(" "), /Table 1 version/, "Table 1 is never assumed without its version");
assert.match(operativeArticlesProblems(table1, { ...bc, jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act" }).join(" "), /only for a BC company/);
assert.match(operativeArticlesProblems(table1, { entityType: "society", jurisdictionCode: "CA-BC", actFormedUnder: "societies_act" }).join(" "), /only for a BC company/);
assert.match(operativeArticlesProblems({ ...table1, noticeMinDays: 7 }, bc).join(" "), /from 10/);
assert.match(operativeArticlesProblems({ ...table1, noticeMinDays: 14 }, { ...bc, distributing: true }).join(" "), /from 21/);
assert.deepEqual(operativeArticlesProblems({ ...table1, noticeMinDays: 10 }, bc), []);
assert.match(operativeArticlesProblems({ ...table1, shareholderQuorum: { people: 2, minVotingSharesNumerator: 3, minVotingSharesDenominator: 2 } }, bc).join(" "), /between 0 and 1/);
assert.match(operativeArticlesProblems({ base: "custom", table1Version: "am_50_2023" }, bc).join(" "), /only when the base is Table 1/);

const org = { ...bc, operativeArticles: table1 };
const resolved = resolveOperativeArticles(org)!;
assert.equal(resolved.model, "bc_table_1");
assert.deepEqual(resolved.shareholderQuorum.value, { people: 2, numerator: 1, denominator: 20 });
assert.match(resolved.shareholderQuorum.citation, /Art\. 8\.2–8\.3/);
assert.deepEqual(resolved.boardQuorum?.value, { quorumType: "majority" });
assert.equal(resolved.chairCastingVote?.value, false);
assert.equal(resolved.directorIndemnity?.value, "mandatory");
assert.equal(resolved.noticeMinDays.value, 21);
assert.ok(resolved.warnings.some((warning) => /261\(2\)/.test(warning)), "an older by-reference Table 1 version warns about s. 261(2)");
assert.match(resolved.label, /186\/2007, supplemented by Parts 21-23/);
assert.equal(resolveOperativeArticles({ ...bc }), null, "nothing is inferred from silence");
assert.equal(resolveOperativeArticles({ ...bc, jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act", operativeArticles: table1 }), null, "CBCA ignores a BC articles record");
const custom = resolveOperativeArticles({ ...bc, operativeArticles: { base: "custom", noticeMinDays: 10, specialMajority: "three_quarters", shareholderQuorum: { people: 1 }, directorIndemnity: "permissive" } })!;
assert.equal(custom.model, "custom");
assert.equal(custom.boardQuorum, undefined, "custom articles without a board quorum leave it for review");
assert.deepEqual(custom.shareholderQuorum.value, { people: 1 });
assert.equal(custom.specialMajority.value, "three_quarters");
assert.equal(custom.directorIndemnity?.value, "permissive");
assert.match(articlesAdoptionSentence(org)!, /Table 1 Articles .*supplemented by Parts 21-23 \(Class A, B and C special rights and restrictions\)/);

// ---- transfer consent helper (shared contract) --------------------------------
assert.equal(transferConsentRequired(org), true, "Table 1 Art. 20.2");
assert.equal(transferConsentRequired({ ...org, distributing: true }), false, "Art. 20.1: not for a public company");
assert.equal(transferConsentRequired({ ...org, operativeArticles: { ...table1, transferConsentRequired: false } }), false, "explicit override wins");
assert.equal(transferConsentRequired({ ...bc }), false, "no articles recorded, nothing inferred");
assert.equal(transferConsentRequired({ entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA", operativeArticles: { base: "custom", transferConsentRequired: true } }), true, "an explicit flag is a plain fact for any corporation");
assert.equal(transferConsentRequired(null), false);

// ---- Table 1 quorum arithmetic (Art. 8.2–8.3) ---------------------------------
assert.equal(legalMeetingQuorum({ entityType: "corporation__business_", jurisdiction: "CA-BC", eligiblePeople: 4, presentPeople: 2, adoptedModel: "bc_table_1", eligibleVotingShares: 1000, presentVotingShares: 49 }).met, false);
assert.equal(legalMeetingQuorum({ entityType: "corporation__business_", jurisdiction: "CA-BC", eligiblePeople: 4, presentPeople: 2, adoptedModel: "bc_table_1", eligibleVotingShares: 1000, presentVotingShares: 50 }).met, true);
assert.equal(legalMeetingQuorum({ entityType: "corporation__business_", jurisdiction: "CA-BC", eligiblePeople: 4, presentPeople: 1, adoptedModel: "bc_table_1", eligibleVotingShares: 1000, presentVotingShares: 900 }).met, false, "two persons are required");
assert.equal(legalMeetingQuorum({ entityType: "corporation__business_", jurisdiction: "CA-BC", eligiblePeople: 1, presentPeople: 1, adoptedModel: "bc_table_1" }).met, true, "Art. 8.3 sole shareholder");
assert.equal(legalMeetingQuorum({ entityType: "corporation__business_", jurisdiction: "CA-BC", eligiblePeople: 3, presentPeople: 2, adoptedModel: "bc_table_1", eligibleVotingShares: 100, presentVotingShares: 24, votingShareFraction: { numerator: 1, denominator: 4 } }).met, false);
assert.equal(legalMeetingQuorum({ entityType: "corporation__business_", jurisdiction: "CA-BC", eligiblePeople: 3, presentPeople: 2, adoptedModel: "bc_table_1", eligibleVotingShares: 100, presentVotingShares: 25, votingShareFraction: { numerator: 1, denominator: 4 } }).met, true);
assert.equal(evaluateArticlesShareholderQuorum({ organization: org, eligibleShareholders: 3, presentPersons: 2, eligibleVotingShares: 100, presentVotingShares: 5 }).met, true);
assert.equal(evaluateArticlesShareholderQuorum({ organization: org, eligibleShareholders: 3, presentPersons: 2, eligibleVotingShares: 100, presentVotingShares: 4 }).met, false);
assert.equal(evaluateArticlesShareholderQuorum({ organization: org, eligibleShareholders: 3, presentPersons: 2 }).met, null, "a headcount alone cannot meet a share-fraction quorum");
assert.equal(evaluateArticlesShareholderQuorum({ organization: org, eligibleShareholders: 3, presentPersons: 2, eligibleVotingShares: 100, presentVotingShares: 5 }).minimumVotingShares, 5);
assert.equal(evaluateArticlesShareholderQuorum({ organization: { ...bc }, eligibleShareholders: 3, presentPersons: 2 }).met, null);

// ---- baseline wiring ----------------------------------------------------------
const baseline = bylawBaselineForOrganization(org, "bc-t1");
assert.equal(baseline.operativeArticlesModel, "bc_table_1");
assert.equal(baseline.quorumValue, 2);
assert.equal(baseline.generalNoticeMinDays, 21);
assert.equal(baseline.governingInstrumentLabel, "articles");
assert.deepEqual(baseline.articlesShareholderQuorum && { ...baseline.articlesShareholderQuorum, citation: undefined }, { people: 2, numerator: 1, denominator: 20, citation: undefined });
assert.equal((baseline as any).bodyQuorumRules?.[0]?.body, "board");
assert.match(baseline.authorityCitation, /Table 1 Arts\. 8\.2-8\.3, 11\.10-11\.11/);
assert.equal(quorumRequiresLegalRegisterFor(baseline, "Board"), false, "board quorum counts directors in office under Art. 11.10");
assert.equal(quorumRequiresLegalRegisterFor(baseline, "AGM"), true, "shareholder quorum still needs the securities register");
const board = resolveMeetingQuorumRule(baseline as any, { type: "Board" })!;
assert.equal(board.label, "Board quorum (articles)");
assert.equal(computeQuorumFromRule(board.rule, board.body, { directorsInOffice: 1 }), 1, "Art. 11.11 sole director");
assert.equal(computeQuorumFromRule(board.rule, board.body, { directorsInOffice: 4 }), 3, "majority of four directors");
const customBaseline = bylawBaselineForOrganization({ ...bc, operativeArticles: { base: "custom", noticeMinDays: 10, shareholderQuorum: { people: 1 }, boardQuorum: { quorumType: "fixed", quorumValue: 2 }, electronicParticipationRestricted: true, specialMajority: "three_quarters" } }, "bc-custom");
assert.equal(customBaseline.generalNoticeMinDays, 10);
assert.equal(customBaseline.quorumValue, 1);
assert.equal(customBaseline.allowElectronicMeetings, false);
assert.equal(customBaseline.specialResolutionThresholdPct, 75);
assert.deepEqual((customBaseline as any).bodyQuorumRules?.[0] && { quorumType: (customBaseline as any).bodyQuorumRules[0].quorumType, quorumValue: (customBaseline as any).bodyQuorumRules[0].quorumValue }, { quorumType: "fixed", quorumValue: 2 });
// Unaffected: unrecorded BC companies, societies, CBCA/OBCA, and unverified formation.
const plainBc = bylawBaselineForOrganization({ ...bc }, "plain");
assert.equal(plainBc.operativeArticlesModel, undefined);
assert.equal((plainBc as any).bodyQuorumRules, undefined);
assert.equal(quorumRequiresLegalRegisterFor(plainBc, "Board"), true);
for (const other of [
  { entityType: "society", jurisdictionCode: "CA-BC", actFormedUnder: "societies_act", operativeArticles: table1 },
  { entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act", operativeArticles: table1 },
  { entityType: "corporation__business_", jurisdictionCode: "CA-ON-OBCA", actFormedUnder: "business_corporations_act__ontario_", operativeArticles: table1 },
  { ...bc, formationStatus: "preparing", operativeArticles: table1 },
]) {
  const rules = bylawBaselineForOrganization(other, "other") as any;
  assert.equal(rules.operativeArticlesModel, undefined, JSON.stringify(other));
  assert.equal(rules.bodyQuorumRules, undefined);
  assert.doesNotMatch(String(rules.authorityCitation), /Table 1/);
}
assert.equal(bylawBaselineForOrganization({ entityType: "society", jurisdictionCode: "CA-BC", actFormedUnder: "societies_act" }, "soc").governingInstrumentLabel, "bylaw rules");
// A stored rule set keeps its own body rules and gains the articles' board rule.
const merged = contextualBylawRules(org, "bc-t1", { _id: "stored", status: "Active", version: 2, bodyQuorumRules: [{ body: "committee", quorumType: "all_members" }] }) as any;
assert.deepEqual(merged.bodyQuorumRules.map((row: any) => row.body).sort(), ["board", "committee"]);
assert.equal(merged.operativeArticlesModel, "bc_table_1");
const storedBoard = contextualBylawRules(org, "bc-t1", { _id: "stored", status: "Active", version: 2, bodyQuorumRules: [{ body: "board", quorumType: "fixed", quorumValue: 3 }] }) as any;
assert.deepEqual(storedBoard.bodyQuorumRules, [{ body: "board", quorumType: "fixed", quorumValue: 3 }], "an explicit stored board rule wins");

// ---- 2. Part skeleton and drafting checks -------------------------------------
const classes = [
  { _id: "c0", className: "Common", classType: "share", votesPerShare: 1, liquidationRank: 3 },
  { _id: "c1", className: "Class A Voting Preferred", classType: "share", votesPerShare: 1, articlesPart: "Part 21", dividendEntitlement: "cumulative_fixed", redemption: { byCompany: true, byHolder: false, priceCents: 1000, includesDeclaredUnpaid: true, minNoticeDays: 10, nonProRataPermitted: true }, liquidationRank: 3, preEmptiveRights: false },
  { _id: "c2", className: "Class B Non-Voting Preferred", classType: "share", votesPerShare: 0, articlesPart: "Part 22", dividendEntitlement: "discretionary_by_class", redemption: { byCompany: true, byHolder: false }, liquidationRank: 1 },
  { _id: "c3", className: "Class C Non-Voting Preferred", classType: "share", votesPerShare: 0, articlesPart: "Part 23", dividendEntitlement: "discretionary_by_class", redemption: { byCompany: true, byHolder: false, priceCents: 1000 } },
] as any[];
const parts = articlesClassParts(classes);
assert.equal(parts.length, 4);
const partA = parts[1].text;
assert.match(parts[1].heading, /^Part 21 — Special rights and restrictions of the Class A Voting Preferred Shares/);
assert.match(partA, /without par value have attached to them the special rights and restrictions set out in this Part/);
assert.match(partA, /cumulative preferential dividends at the rate of \[RATE\]/);
assert.match(partA, /\$10 per share, plus all dividends declared on that share and unpaid/);
assert.match(partA, /without redeeming shares held by others/);
assert.match(partA, /at least 10 days' written notice/);
assert.match(partA, /No Class A Voting Preferred Share that is the subject of an outstanding redemption notice may be transferred/);
assert.match(partA, /1 vote for each share/);
assert.match(partA, /no pre-emptive right/);
assert.match(partA, /s\. 82\(1\)\(a\)/);
assert.match(partA, /equally, share for share, with the Common Shares/);
assert.match(parts[2].text, /in priority to the Common Shares, Class A Voting Preferred Shares/);
assert.match(parts[2].text, /not, as holders of that class, entitled to receive notice of, attend or vote/);
assert.match(parts[2].text, /discretion|without declaring one on any other class/);
assert.match(parts[0].heading, /^Part \[21\]/, "a class without a recorded Part gets a numbered prompt");
assert.match(parts[3].text, /\[State the entitlement of the Class C Non-Voting Preferred Shares on a liquidation/);
const warnings = articlesDraftingWarnings(classes);
assert.ok(warnings.some((w) => /Class A Voting Preferred Shares: "cumulative" dividends need a stated rate/.test(w)));
assert.ok(warnings.some((w) => /Class B Non-Voting Preferred Shares: state the redemption price/.test(w)));
assert.ok(warnings.some((w) => /rank against each other on liquidation/.test(w)), "B and C ranking is not stated");
assert.ok(warnings.some((w) => /estate-freeze shares.*price-adjustment clause/.test(w)));
assert.ok(warnings.some((w) => /Common Shares: spell out the voting, dividend and liquidation rights/.test(w)));
assert.ok(warnings.some((w) => /tax on split income.*makes no tax claim/.test(w)));
assert.ok(!warnings.some((w) => /guarantee|tax-effective|will save/i.test(w)), "never claims a tax effect");
const view = articlesPacketView(org, classes);
assert.equal(view.articles.hasRecord, true);
assert.match(view.articles.partsSentence, /Parts 21-23/);

for (const key of ["bc-incorporation-agreement", "bc-articles-preparation", "bc-officer-indemnity-agreement"]) {
  const packet = CORPORATION_DOCUMENT_PACKETS.find((row) => row.key === key)!;
  assert.ok(packet, key);
  assert.equal(packet.preparationOnly, true, `${key} stays preparation only`);
  assert.deepEqual(packet.jurisdictions, ["CA-BC", "british_columbia"]);
  assert.match(packet.terms, /legal review/i);
}
const agreement = CORPORATION_DOCUMENT_PACKETS.find((row) => row.key === "bc-incorporation-agreement")!;
const articlesPacket = CORPORATION_DOCUMENT_PACKETS.find((row) => row.key === "bc-articles-preparation")!;
assert.match(agreement.terms, /federal CBCA/);
assert.match(articlesPacket.terms, /federal CBCA/);
const docxText = (packet: any, context: Record<string, unknown>) => new TextDecoder().decode(corporationPacketDocxBytes(packet, context as any));
const renderBase = buildRenderContext({ org: { name: "Synthetic Holdings Ltd.", entityType: "corporation__business_" }, asOf: "2026-10-12" }) as any;
const agreementDoc = docxText(agreement, { ...renderBase, ...view });
assert.ok(agreementDoc.includes("Table 1 Articles prescribed under the Business Corporations Regulation"));
assert.ok(agreementDoc.includes("supplemented by Parts 21-23"));
assert.ok(agreementDoc.includes("Drafting checks for review"));
const emptyAgreement = docxText(agreement, { ...renderBase, ...articlesPacketView({ ...bc }, []) });
assert.ok(emptyAgreement.includes("Table 1 is never assumed"));
assert.ok(emptyAgreement.includes("supplemented by Parts [n] to [n]"));
const articlesDoc = docxText(articlesPacket, { ...renderBase, ...view });
assert.ok(articlesDoc.includes("Part 22 — Special rights and restrictions of the Class B Non-Voting Preferred Shares"));
assert.ok(articlesDoc.includes("rank against each other on liquidation"));

// ---- 3. Indemnity -------------------------------------------------------------
const indemnity = CORPORATION_DOCUMENT_PACKETS.find((row) => row.key === "bc-officer-indemnity-agreement")!;
const indemnityText = JSON.stringify(indemnity.sections);
for (const pattern of [/s\. 160\(a\)/, /s\. 161/, /written undertaking to repay/, /honestly and in good faith/, /by or on behalf of the company/, /ss\. 163\(2\), 164/, /s\. 165/]) assert.match(indemnityText, pattern);
assert.equal(indemnity.signatureRequired, false);

// ---- 4. Sources ---------------------------------------------------------------
for (const id of ["BC-BCA-TABLE1-ARTICLES", "BC-BCA-INDEMNITY", "BC-BCA-ELECTRONIC-MEETINGS"]) {
  const source = CORPORATE_LEGAL_SOURCES.find((row) => row.id === id);
  assert.ok(source, id);
  assert.equal(source!.status, "in_force");
  assert.match(source!.url, /bclaws\.gov\.bc\.ca/);
}
assert.match(CORPORATE_LEGAL_SOURCES.find((row) => row.id === "BC-BCA-TABLE1-ARTICLES")!.summary, /1\/20 of the issued shares/);
assert.match(CORPORATE_LEGAL_SOURCES.find((row) => row.id === "BC-BCA-INDEMNITY")!.section, /ss\. 159–165/);
assert.match(CORPORATE_LEGAL_SOURCES.find((row) => row.id === "BC-BCA-ELECTRONIC-MEETINGS")!.section, /174/);
assert.ok(resolved.sourceIds.includes("BC-BCA-TABLE1-ARTICLES") && resolved.sourceIds.includes("BC-BCA-INDEMNITY") && resolved.sourceIds.includes("BC-BCA-ELECTRONIC-MEETINGS"));

// ---- worksheet ----------------------------------------------------------------
const bcGuide = incorporationPreparationForOrganization({ jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act" })!;
const worksheet = incorporationWorksheetText(bcGuide, { name: "Synthetic Holdings Ltd.", jurisdictionCode: "CA-BC", entityType: "corporation__business_" });
assert.ok(worksheet.includes("ARTICLES"));
assert.ok(worksheet.includes("Table 1 is never assumed"));
const fedGuide = incorporationPreparationForOrganization({ jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act" })!;
assert.ok(!incorporationWorksheetText(fedGuide, { name: "Federal Co", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_" }).includes("Table 1"), "federal worksheet has no BC Table 1 text");

// ---- end to end on the local runtime ------------------------------------------
const client = new StaticConvexClient({ databaseName: `operative-articles-${Date.now()}`, seed: { societies: [] } });
const created = await client.mutation("society:createWorkspace", { name: "Synthetic Table One Ltd.", jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act", legalSubtype: "ordinary_private_company", incorporationDate: "2026-01-15", fiscalYearEnd: "12-31" });
const societyId = created.societyId;
await verifyFixtureFormation(client, societyId, "2026-01-15");
const articlesDoc1 = await client.mutation("documents:create", { societyId, title: "Signed articles", category: "governance", tags: [] });
await assert.rejects(client.mutation("corporationSettings:updateOperativeArticles", { societyId, operativeArticles: { base: "bc_table_1" } }), /Table 1 version/);
await client.mutation("corporationSettings:updateOperativeArticles", { societyId, operativeArticles: { ...table1, sourceDocumentId: articlesDoc1 } });
let profile = await client.query("society:getById", { id: societyId });
assert.equal(profile.operativeArticles.table1Version, "am_186_2007");
assert.equal(profile.operativeArticles.sourceDocumentId, articlesDoc1);
assert.ok(profile.operativeArticles.recordedAtISO);
const fed = await client.mutation("society:createWorkspace", { name: "Synthetic Federal Inc.", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act" });
await assert.rejects(client.mutation("corporationSettings:updateOperativeArticles", { societyId: fed.societyId, operativeArticles: table1 }), /only for a BC company/);
const foreignDoc = await client.mutation("documents:create", { societyId: fed.societyId, title: "Foreign", category: "governance", tags: [] });
await assert.rejects(client.mutation("corporationSettings:updateOperativeArticles", { societyId, operativeArticles: { ...table1, sourceDocumentId: foreignDoc } }), /not found|Record not found/);

// Board meeting: majority of directors in office (Art. 11.10).
for (const [firstName, lastName] of [["Dana", "One"], ["Eli", "Two"], ["Fay", "Three"]]) {
  await client.mutation("directors:create", { societyId, firstName, lastName, position: "Director", isBCResident: true, termStart: "2026-01-15", consentOnFile: true, status: "Active" });
}
const boardMeetingId = await client.mutation("meetings:create", { societyId, type: "Board", title: "Board meeting", scheduledAt: "2026-11-01T17:00:00Z", electronic: false, status: "Scheduled", attendeeIds: [] });
const boardMeeting = await client.query("meetings:get", { id: boardMeetingId });
assert.equal(boardMeeting.quorumRequired, 2, "majority of three directors under Table 1 Art. 11.10");

// General meeting: the Table 1 description with the register's share count, never a headcount confirmation.
const holders: string[] = [];
for (const fullName of ["Holder Alpha", "Holder Beta"]) holders.push(await client.mutation("legalOperations:upsertRoleHolder", { societyId, roleType: "shareholder", status: "current", fullName }));
const common = await client.mutation("legalOperations:upsertRightsClass", { societyId, className: "Common shares", classType: "share", status: "active", votesPerShare: 1 });
for (const [index, holder] of holders.entries()) {
  await client.mutation("legalOperations:upsertRightsholdingTransfer", { societyId, transferType: "issuance", status: "posted", transferDate: "2026-01-16", rightsClassId: common, destinationRoleHolderId: holder, quantity: index ? 30 : 70, considerationType: "cash", priceToOrganizationCents: 100, priceToOrganizationCurrency: "cad" });
}
const agmId = await client.mutation("meetings:create", { societyId, type: "AGM", title: "Annual general meeting", scheduledAt: "2026-12-01T17:00:00Z", electronic: false, status: "Scheduled", attendeeIds: ["Holder Alpha", "Holder Beta"] });
const agm = await client.query("meetings:get", { id: agmId });
assert.equal(agm.quorumRequired, undefined, "share-fraction quorum is not reduced to a headcount");
assert.match(agm.quorumSourceLabel, /Art\. 8\.2–8\.3: 2 persons present or by proxy holding or representing at least 1\/20 of the issued shares entitled to vote \(5 of 100\)/);
const agmMinutes = await client.query("minutes:getByMeeting", { meetingId: agmId });
assert.notEqual(agmMinutes?.quorumStatus, "confirmed", "attendee names alone never confirm a Table 1 quorum");

// Packets render the recorded articles.
for (const packetKey of ["bc-incorporation-agreement", "bc-articles-preparation", "bc-officer-indemnity-agreement"]) {
  const generated = await client.mutation("legalOperations:generateDocumentFromCatalog", { societyId, packetKey });
  assert.ok(generated.draftDocumentId, packetKey);
}

// Clearing the record restores the statutory baseline.
await client.mutation("corporationSettings:updateOperativeArticles", { societyId, operativeArticles: null });
profile = await client.query("society:getById", { id: societyId });
assert.equal(profile.operativeArticles, undefined);
const clearedBoardId = await client.mutation("meetings:create", { societyId, type: "Board", title: "Board meeting 2", scheduledAt: "2026-11-02T17:00:00Z", electronic: false, status: "Scheduled", attendeeIds: [] });
assert.equal((await client.query("meetings:get", { id: clearedBoardId })).quorumRequired, undefined, "without recorded articles no board quorum is assumed");

console.log("Operative articles passed: Table 1 version recorded (never inferred), overrides, transfer-consent helper, Table 1 Art. 8.2/11.10 quorum wiring, BC-only scope, Part skeleton, drafting checks, indemnity draft and sources.");
