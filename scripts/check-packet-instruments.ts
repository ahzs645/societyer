import assert from "node:assert/strict";

import { BC_TRANSPARENCY_PACKET_KEY, CORPORATION_DOCUMENT_PACKETS, corporationPacketKeyForComplianceObligation } from "../shared/corporationDocumentPackets";
import { isPacketBlock } from "../shared/packetBlocks";
import { renderSections } from "../shared/packetRendering";
import { renderInstrument, renderedPacketBlocks, instrumentPlainLines, withExecution, type InstrumentBlock } from "../shared/packetInstrument";
import { buildSocietyRenderContext } from "../shared/societyRenderContext";
import { renderTemplate } from "../shared/templateAssembly";
import {
  corporateLawContext,
  directorAppointmentView,
  directorDepartureView,
  dividendDeclarationView,
  officeChangeView,
  officerAppointmentView,
  packetEventDates,
  packetEventDatesByKind,
  shareCertificateView,
  shareIssuanceView,
  shareRedemptionView,
  shareSplitView,
  shareTransferView,
  assetTransferView,
  TRANSACTION_SCOPED_PACKETS,
  type PacketScope,
} from "../shared/packetOperativeData";
import { bodySigners, buildExecutionBlock, instrumentTitle, resolvingBodyFor } from "../shared/executionBlock";
import { legalSourceById } from "../shared/legalSources";
import { StaticConvexClient } from "../src/lib/staticConvex";

/**
 * Packet instruments (YCN Doc - * sheets ported): every transaction-scoped
 * packet renders only the transaction of its date, with the lawyer's operative
 * wording, entity-aware law fragments and grammar. Synthetic fixtures only.
 */

// --- Synthetic BC company registers ------------------------------------------
const bc = { name: "Northwind Widgets Ltd.", shortName: "the Company", entityType: "corporation__business_", actFormedUnder: "business_corporations_act", jurisdictionCode: "CA-BC", sealLocation: "" };
const roleHolders = [
  { _id: "d1", roleType: "director", fullName: "Avery Stone", startDate: "2020-01-01" },
  { _id: "d2", roleType: "director", fullName: "Blake Rivers", startDate: "2020-01-01", endDate: "2026-03-01" },
  { _id: "d3", roleType: "director", fullName: "Casey Lane", startDate: "2026-03-01" },
  { _id: "d4", roleType: "director", fullName: "Devon Hart", startDate: "2026-03-01" },
  { _id: "o1", roleType: "officer", fullName: "Avery Stone", officerTitle: "president", startDate: "2020-01-01" },
  { _id: "o2", roleType: "officer", fullName: "Avery Stone", officerTitle: "secretary", startDate: "2020-01-01" },
  { _id: "o3", roleType: "officer", fullName: "Casey Lane", officerTitle: "treasurer", startDate: "2026-03-01" },
  { _id: "s1", roleType: "shareholder", fullName: "Avery Stone", startDate: "2020-01-01" },
  { _id: "s2", roleType: "shareholder", fullName: "Elm Holdings Ltd.", startDate: "2020-01-01", nonNaturalPerson: true },
  { _id: "s3", roleType: "shareholder", fullName: "Finley Park", startDate: "2020-01-01" },
];
const classes = [
  { _id: "cA", className: "Class A Common", classType: "share", votesPerShare: 1, singularDescription: "Class A Common Share", pluralDescription: "Class A Common Shares" },
  { _id: "cB", className: "Class B Non-Voting Preferred shares", classType: "share", votesPerShare: 0, redemption: { byCompany: true, byHolder: false, priceCents: 1000, includesDeclaredUnpaid: true, minNoticeDays: 21, nonProRataPermitted: true } },
];
const posted = (row: Record<string, unknown>) => ({ status: "posted", sourceDocumentIds: [], sourceExternalIds: [], ...row });
const transfers = [
  posted({ _id: "t1", transferType: "issuance", transferDate: "2020-01-01", rightsClassId: "cA", destinationRoleHolderId: "s1", quantity: 100, priceToOrganizationCents: 10000, priceToOrganizationCurrency: "cad", considerationType: "cash" }),
  posted({ _id: "t2", transferType: "issuance", transferDate: "2020-01-01", rightsClassId: "cA", destinationRoleHolderId: "s2", quantity: 50, priceToOrganizationCents: 5000, priceToOrganizationCurrency: "cad", considerationType: "cash" }),
  posted({ _id: "t3", transferType: "issuance", transferDate: "2020-01-01", rightsClassId: "cB", destinationRoleHolderId: "s3", quantity: 10, priceToOrganizationCents: 10000, priceToOrganizationCurrency: "cad", considerationType: "cash" }),
  posted({ _id: "t4", transferType: "issuance", transferDate: "2026-04-01", rightsClassId: "cA", destinationRoleHolderId: "s3", quantity: 1, priceToOrganizationCents: 100, priceToOrganizationCurrency: "cad", considerationType: "property", considerationDescription: "equipment" }),
  posted({ _id: "t5", transferType: "transfer", transferDate: "2026-05-01", rightsClassId: "cA", sourceRoleHolderId: "s1", destinationRoleHolderId: "s3", quantity: 40 }),
  posted({ _id: "t6", transferType: "redemption", transferDate: "2026-06-01", rightsClassId: "cB", sourceRoleHolderId: "s3", quantity: 4, priceToVendorCents: 4000, priceToVendorCurrency: "cad" }),
];
const certificates = [
  { _id: "c1", certificateNumber: "A-1", holderName: "Avery Stone", shareClass: "Class A Common", shares: 100, issuedOn: "2020-01-01", cancelledOn: "2026-05-01" },
  { _id: "c2", certificateNumber: "A-4", holderName: "Finley Park", shareClass: "Class A Common", shares: 40, issuedOn: "2026-05-01" },
  { _id: "c3", certificateNumber: "A-5", holderName: "Avery Stone", shareClass: "Class A Common", shares: 60, issuedOn: "2026-05-01" },
  { _id: "c4", certificateNumber: "A-2", holderName: "Elm Holdings Ltd.", shareClass: "Class A Common", shares: 50, issuedOn: "2020-01-01", cancelledOn: "2026-07-01" },
  { _id: "c5", certificateNumber: "A-6", holderName: "Elm Holdings Ltd.", shareClass: "Class A Common", shares: 50, issuedOn: "2026-07-01", replacesCertificateNumber: "A-2" },
];
const addresses = [
  { type: "registered_office", status: "past", street: "1 First St", city: "Vancouver", provinceState: "BC", country: "Canada", effectiveFrom: "2020-01-01", effectiveTo: "2026-08-01" },
  { type: "registered_office", status: "current", street: "2 Second St", city: "Vancouver", provinceState: "BC", country: "Canada", effectiveFrom: "2026-08-01" },
  { type: "records_office", status: "current", street: "3 Third St", city: "Victoria", provinceState: "BC", country: "Canada", effectiveFrom: "2026-08-01" },
];
const assets = [
  { _id: "a1", name: "Lot 7 warehouse", category: "Real estate", serialNumber: "000-111-222", purchaseDate: "2026-09-01", purchaseValueCents: 50000000, acquisitionCurrency: "cad", acquiredFrom: "Seller Co." },
  { _id: "a2", name: "Old forklift", category: "Equipment", status: "disposed", serialNumber: "FL-9", disposedAt: "2025-01-01", disposedTo: "Buyer Inc.", disposalValueCents: 100000, dispositionCurrency: "cad" },
];
const dividends = [
  { _id: "v1", declaredOn: "2025-12-01", shareClass: "Class A Common", perShareCents: 10, totalCents: 1500, currency: "cad", recordDate: "2025-12-05", paymentDate: "2025-12-15" },
  { _id: "v2", declaredOn: "2026-02-01", shareClass: "Class A Common", rightsClassId: "cA", perShareAmount: "0.125", sharesOutstanding: 150, totalCents: 1875, currency: "cad", recordDate: "2026-02-10", paymentDate: "2026-02-20", solvencyConfirmedAt: "2026-02-01", solvencyBasis: "the January management accounts", excludedClassIds: ["cB"] },
];

function contextFor(org: Record<string, unknown>, asOf: string, extra: Record<string, unknown>) {
  const render = buildSocietyRenderContext(org as any, roleHolders, asOf, { transfers, rightsClasses: classes });
  const lawRaw = corporateLawContext(org as any, render.org.legislation);
  const law = Object.fromEntries(Object.entries(lawRaw).map(([k, v]) => [k, typeof v === "string" ? renderTemplate(v, render as any) : v]));
  return { ...render, law, signing: { officerPhrase: "the President", OfficerPhrase: "The President" }, ...extra } as Record<string, unknown>;
}

function render(key: string, ctx: Record<string, unknown>) {
  const packet = CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === key)!;
  assert.ok(packet?.instrument, `${key} has an instrument`);
  const rendered = renderInstrument(packet.instrument!, ctx);
  const text = instrumentPlainLines([...rendered.blocks, ...rendered.annex]).join("\n");
  if (process.env.PACKET_PREVIEW) console.log(`\n===== ${key}\n${text}`);
  assert.ok(!/\{[#/.a-zA-Z]/.test(text), `${key}: unbound template markup:\n${text}`);
  assert.ok(!/share\(s\)/.test(text), `${key}: never "share(s)"`);
  assert.ok(!/\s{2,}\S/.test(text.replace(/^ +/gm, "")), `${key}: no doubled spaces:\n${text}`);
  return { rendered, text, blocks: rendered.blocks };
}
const scope = (asOf: string, ids?: string[]): PacketScope => ({ asOf, ids });
const regs = { transfers, classes, roleHolders, certificates };

// --- 1. Director routes: election, resignation, removal -----------------------
{
  assert.equal(resolvingBodyFor(CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === "appoint-director")!.requiredSigners).noun, "voting shareholder");
  assert.equal(resolvingBodyFor(CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === "director-removal")!.requiredSigners).noun, "voting shareholder");
  assert.equal(resolvingBodyFor(CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === "director-resignation")!.requiredSigners).noun, "director");
  assert.equal(resolvingBodyFor(CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === "appoint-director-by-directors")!.requiredSigners).noun, "director");
  assert.equal(resolvingBodyFor(CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === "issue-shares")!.requiredSigners).noun, "director", "an entering shareholder does not adopt the directors' resolution");
  assert.equal(resolvingBodyFor(CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === "appoint-officer")!.requiredSigners).noun, "director", "the board appoints officers");
  assert.ok(CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === "director-removal")!.sourceIds!.includes("BC-BCA-DIRECTOR-REMOVAL"));
  const source = legalSourceById.get("BC-BCA-DIRECTOR-REMOVAL");
  assert.ok(source && /128/.test(source.section) && source.instrument.includes("British Columbia"));

  const appoint = render("appoint-director", contextFor(bc, "2026-03-01", directorAppointmentView(roleHolders, scope("2026-03-01"))));
  assert.ok(appoint.text.includes("CONSENT SHAREHOLDERS' RESOLUTION"), appoint.text);
  assert.ok(appoint.text.includes("The following persons be elected as directors of the Company"));
  assert.ok(appoint.text.includes("Casey Lane") && appoint.text.includes("Devon Hart") && !appoint.text.includes("Avery Stone"), "only the appointments of the date");
  assert.ok(appoint.text.includes("Business Corporations Act (British Columbia)"));

  const removal = render("director-removal", contextFor(bc, "2026-03-01", directorDepartureView(roleHolders, scope("2026-03-01"))));
  assert.ok(removal.text.includes("BE IT RESOLVED, AS A SPECIAL RESOLUTION, THAT:"));
  assert.ok(removal.text.includes("The following person be removed as a director of the Company before the expiration of the director's term of office"), removal.text);
  assert.ok(removal.text.includes("section 128(3)(a)") && removal.text.includes("128(3)(b)"), "articles may provide another method");
  assert.ok(!/remaining directors? confirm/.test(removal.text), "the directors never remove a director");

  const resignation = render("director-resignation", contextFor(bc, "2026-03-01", directorDepartureView(roleHolders, scope("2026-03-01"))));
  assert.ok(resignation.text.includes("WHEREAS Blake Rivers has delivered a written resignation as a director of Northwind Widgets Ltd. (the \"Company\");"), resignation.text);
  assert.ok(resignation.text.includes("section 128(2)"));
  assert.ok(resignation.rendered.annex.some((b) => b.kind === "paragraph" && b.text === "I, Blake Rivers, resign as a director of Northwind Widgets Ltd., effective March 1, 2026."), "resignation letter annex");

  const fed = { ...bc, jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act" };
  const fedRemoval = render("director-removal", contextFor(fed, "2026-03-01", directorDepartureView(roleHolders, scope("2026-03-01"))));
  assert.ok(fedRemoval.text.includes("AS AN ORDINARY RESOLUTION") && fedRemoval.text.includes("section 109(1)") && fedRemoval.text.includes("110(2)"));
  assert.ok(!fedRemoval.text.includes("128("), "no BC citation for a CBCA corporation");
  const on = { ...bc, jurisdictionCode: "CA-ON-OBCA", actFormedUnder: "business_corporations_act__ontario_" };
  const onRemoval = render("director-removal", contextFor(on, "2026-03-01", directorDepartureView(roleHolders, scope("2026-03-01"))));
  assert.ok(onRemoval.text.includes("section 122(1) of the Business Corporations Act (Ontario)"), onRemoval.text);

  const byDirectors = render("appoint-director-by-directors", contextFor(bc, "2026-03-01", directorAppointmentView(roleHolders, scope("2026-03-01"))));
  assert.ok(byDirectors.text.includes("to fill a casual vacancy") && byDirectors.text.includes("section 131") && byDirectors.text.includes("one-third"));
}

// --- 2. Grammar: shareholder groups, capitalized sentence starts, Act names ----
{
  const ctx = buildSocietyRenderContext(bc, roleHolders, "2026-03-15", { transfers, rightsClasses: classes });
  assert.equal(ctx.shareholders.count, 3);
  assert.equal(ctx.votingShareholders.count, 2, "the non-voting preferred holder is not a voting shareholder");
  assert.equal(buildSocietyRenderContext(bc, roleHolders, "2026-06-25", { transfers, rightsClasses: classes }).votingShareholders.count, 3, "voting status is read as at the date");
  assert.deepEqual(ctx.votingShareholders.list.map((a) => a.name), ["Avery Stone", "Elm Holdings Ltd."]);
  assert.equal(ctx.org.ShortName, "The Company");
  assert.equal(ctx.org.definedTermIntro, "Northwind Widgets Ltd. (the \"Company\")");
  assert.equal(ctx.org.legislation, "Business Corporations Act (British Columbia)");
  assert.equal(buildSocietyRenderContext(bc, roleHolders, "2001-05-01").org.legislation, "Company Act (British Columbia)");
  assert.equal(buildSocietyRenderContext({ ...bc, jurisdictionCode: "CA-ON-OBCA", actFormedUnder: "business_corporations_act__ontario_" }, [], "2026-01-01").org.legislation, "Business Corporations Act (Ontario)");
  assert.equal(buildSocietyRenderContext({ ...bc, jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act" }, [], "2026-01-01").org.legislation, "Canada Business Corporations Act");
  assert.equal(buildSocietyRenderContext(bc, [], "2026-01-01", { constating: [{ action: "incorporated", jurisdiction: "CA-BC", legislation: "Company Act", startISO: "1990-01-01" }, { action: "transitioned", jurisdiction: "CA-BC", legislation: "Business Corporations Act", startISO: "2005-01-01" }] }).org.legislation, "Business Corporations Act (British Columbia)");
  // Name as at the date.
  const named = buildSocietyRenderContext(bc, [], "2019-01-01", { nameHistory: [{ name: "Old Widgets Ltd.", startISO: "2010-01-01" }, { name: "Northwind Widgets Ltd.", startISO: "2020-01-01" }] });
  assert.equal(named.org.name, "Old Widgets Ltd.");

  for (const [key, group] of [["all-shareholders-resolution", "shareholders"], ["all-voting-shareholders-resolution", "votingShareholders"]] as const) {
    const out = render(key, contextFor(bc, "2026-06-25", {}));
    assert.ok(!out.text.includes("being  of"), `${key}: no empty body noun`);
    assert.ok(out.text.includes(key === "all-shareholders-resolution" ? "being all the shareholders of the Company, hereby sign the following" : "being all the voting shareholders of the Company, hereby sign"), out.text);
    void group;
    const packet = CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === key)!;
    const sectionText = packet.sections.flatMap((s) => s.body).map((line) => renderTemplate(line, contextFor(bc, "2026-06-25", {}))).join("\n");
    assert.ok(!sectionText.includes("being  of") && !sectionText.includes("being of"), sectionText);
  }
  // A single voting shareholder reads "the sole voting shareholder … signs"; an empty register reads plural with a prompt.
  const sole = buildSocietyRenderContext(bc, [{ _id: "x", roleType: "shareholder", fullName: "Solo Owner" }], "2026-01-01");
  const soleText = render("all-voting-shareholders-resolution", { ...contextFor(bc, "2026-01-01", {}), ...sole, law: {} }).text;
  assert.ok(soleText.includes("being the sole voting shareholder of the Company, hereby signs"), soleText);
  assert.ok(soleText.includes("CONSENT SHAREHOLDER'S RESOLUTION"));
  const none = buildSocietyRenderContext(bc, [], "2026-01-01");
  const noneText = render("all-shareholders-resolution", { ...none, law: {} }).text;
  assert.ok(noneText.includes("being all the shareholders of the Company") && noneText.includes("No shareholders are recorded"), noneText);

  assert.equal(instrumentTitle("director", 1), "CONSENT DIRECTOR'S RESOLUTION");
  assert.equal(instrumentTitle("director", 2), "CONSENT DIRECTORS' RESOLUTION");
}

// --- 3/4. Transaction scoping and operative wording ---------------------------
{
  // Issue: only the 2026-04-01 subscription, never the 2020 issuances.
  const issue = render("issue-shares", contextFor(bc, "2026-04-01", shareIssuanceView(regs, scope("2026-04-01"))));
  assert.ok(issue.text.includes("WHEREAS a subscription has been received for the issuance of shares in the capital of Northwind Widgets Ltd. (the \"Company\");"), issue.text);
  assert.ok(issue.text.includes("Finley Park | 1 | Class A Common Share | CAD 1.00 Property (equipment)"), issue.text);
  assert.ok(!issue.text.includes("Avery Stone | 100"), "no other issuance rows");
  assert.ok(issue.text.includes("full consideration"));
  assert.ok(issue.text.includes("The President of the Company be authorized to sign the share certificate on behalf of the Company and to deliver it to the person entitled to it."), issue.text);
  assert.ok(!issue.text.includes("affix the seal"), "no seal clause without a seal");
  const sealed = render("issue-shares", contextFor({ ...bc, sealLocation: "Records office safe" }, "2026-04-01", shareIssuanceView(regs, scope("2026-04-01"))));
  assert.ok(sealed.text.includes("affix the seal of the Company thereto"));
  // Selected transaction ids override the date.
  assert.equal(shareIssuanceView(regs, scope("2026-04-01", ["t1"])).issue.subscriptions[0].subscriber, "Avery Stone");
  assert.equal(shareIssuanceView(regs, scope("2026-04-01", ["t1"])).issue.subscriptions[0].sharesLabel, "100 Class A Common Shares");

  // Transfer: approvals, new certificate to the transferee and a balance certificate to the transferor, cancellation.
  const transferView = shareTransferView(regs, scope("2026-05-01"), { consentRequired: true });
  const transfer = render("share-transfer", contextFor(bc, "2026-05-01", transferView));
  assert.ok(transfer.text.includes("AND WHEREAS the articles of the Company provide that no share may be transferred without the consent of the directors;"));
  assert.ok(transfer.text.includes("The directors consent to and approve the transfer of shares in the capital of the Company to the following person:"), transfer.text);
  assert.ok(transfer.text.includes("Avery Stone | Finley Park | 40 Class A Common Shares"));
  assert.ok(transfer.text.includes("A-4 | Finley Park | 40 Class A Common Shares"), "new certificate");
  assert.ok(transfer.text.includes("A-5 | Avery Stone | 60 Class A Common Shares"), "balance certificate to the transferor");
  assert.ok(transfer.text.includes("Certificate No. | Shareholder |"), "heading switches to Shareholder with a balance certificate");
  assert.ok(transfer.text.includes("and the shares of the transferor remaining untransferred"));
  assert.ok(transfer.text.includes("A-1 | Avery Stone | 100 Class A Common Shares"), "surrendered certificate cancelled");
  // Without a recorded surrendered certificate the balance comes from the holdings before the date.
  const noCerts = shareTransferView({ ...regs, certificates: [] }, scope("2026-05-01"));
  assert.equal(noCerts.transfer.balanceUnverified, true);
  assert.ok(noCerts.transfer.newCertificates.some((c) => c.isBalance && c.sharesLabel === "60 Class A Common Shares"));

  // Replacement certificate: issued replacing A-2, cancel A-2, with cross-references.
  const certificate = render("share-certificate", contextFor(bc, "2026-07-01", shareCertificateView(certificates, scope("2026-07-01"), classes)));
  assert.ok(certificate.text.includes("1. The Company issue the following share certificate representing the shares previously issued to the shareholder, as evidenced by the share certificates cancelled by resolution 2:"), certificate.text);
  assert.ok(certificate.text.includes("replaced by the share certificate issued by resolution 1"));
  assert.ok(certificate.text.includes("A-6 | Elm Holdings Ltd. | 50 Class A Common Shares") && certificate.text.includes("A-2 | Elm Holdings Ltd."));

  // Split: shareholders' special resolution recital, then the directors' steps and the alteration task.
  const split = render("share-split", contextFor(bc, "2026-06-25", shareSplitView({ kind: "subdivision", ratioLabel: "2-for-1 subdivision", lines: [{ holderName: "Avery Stone", before: 60, after: 120 }] }, classes[0] as any)));
  assert.ok(split.text.includes("WHEREAS the shareholders of Northwind Widgets Ltd. (the \"Company\") have by special resolution resolved to subdivide the issued Class A Common Shares on the basis of a 2-for-1 subdivision"), split.text);
  assert.ok(split.text.includes("Share Subdivision — The Company allot and issue the following additional Class A Common Shares"));
  assert.ok(split.text.includes("Avery Stone | 60 Class A Common Shares"));
  assert.ok(split.text.includes("Notice of Alteration"));

  // Dividend: only the declaration of the date, per class, with record and payment dates and the solvency recital.
  const dividend = render("dividend-declaration", contextFor(bc, "2026-02-01", dividendDeclarationView(dividends, scope("2026-02-01"), classes)));
  assert.ok(dividend.text.includes("The Company declare a dividend of CAD 0.125 per share on the issued and outstanding Class A Common Shares, for a total of CAD 18.75, payable on February 20, 2026 to holders of record of Class A Common Shares on February 10, 2026."), dividend.text);
  assert.ok(dividend.text.includes("(section 70(2) of the Business Corporations Act (British Columbia)), as confirmed on February 1, 2026 on the basis of the January management accounts;"), dividend.text);
  assert.ok(dividend.text.includes("No dividend is declared on the Class B Non-Voting Preferred shares."), dividend.text);
  assert.ok(!dividend.text.includes("0.10"), "the earlier declaration is not rendered");
  const missing = render("dividend-declaration", contextFor(bc, "2026-02-01", dividendDeclarationView([{ declaredOn: "2026-02-01", shareClass: "Class A Common", perShareCents: 5, totalCents: 750, currency: "cad" }], scope("2026-02-01"), classes)));
  assert.ok(missing.text.includes("[payment date]") && missing.text.includes("Record the record date and payment date"));

  // Offices: changed from … to (registered) and initially at (records).
  const offices = render("change-of-offices", contextFor(bc, "2026-08-01", officeChangeView(addresses, scope("2026-08-01"))));
  assert.ok(offices.text.includes("The registered office of the Company be changed from: 1 First St, Vancouver, BC, Canada to: 2 Second St, Vancouver, BC, Canada."), offices.text);
  assert.ok(offices.text.includes("The records office of the Company be initially at the following address: 3 Third St, Victoria, BC, Canada."));
  assert.ok(offices.text.includes("notice of change of address"));
  assert.equal(officeChangeView(addresses, scope("2026-09-01")).offices.hasChanges, false, "no change on another date");

  // Assets: single asset prose with the PID, deliver-documents and further-actions clauses.
  const asset = render("asset-transfer", contextFor(bc, "2026-09-01", assetTransferView(assets as any, scope("2026-09-01"))));
  assert.ok(asset.text.includes("The Company acquire the real estate property identified as Lot 7 warehouse (PID 000-111-222) from Seller Co. for the purchase price of CAD 500,000.00."), asset.text);
  assert.ok(asset.text.includes("Deliver Documents — The President of the Company be authorized") && asset.text.includes("Further Actions —"));
  assert.ok(!asset.text.includes("Old forklift"));
  const both = assetTransferView(assets as any, scope("2026-09-01", ["a1", "a2"]));
  assert.equal(both.assetTransfer.useTables, true);

  // Officers: combined titles, only appointments of the date.
  const officers = officerAppointmentView(roleHolders, scope("2026-03-01"));
  assert.deepEqual(officers.appointment.officers, [{ name: "Casey Lane", title: "Treasurer" }]);
  assert.deepEqual(officerAppointmentView(roleHolders, scope("2026-06-25"), { allInOffice: true }).appointment.officers.find((o) => o.name === "Avery Stone"), { name: "Avery Stone", title: "President and Secretary" });

  // Event dates: only dates on which the transaction type exists.
  const dates = packetEventDatesByKind({ roleHolders, transfers: transfers as any, certificates, addresses, assets: assets as any, dividends });
  assert.deepEqual(dates["issue-shares"], ["2026-04-01", "2020-01-01"]);
  assert.deepEqual(dates["share-transfer"], ["2026-05-01"]);
  assert.deepEqual(dates["director-removal"], ["2026-03-01"]);
  assert.deepEqual(dates["share-certificate"], ["2026-07-01"]);
  assert.deepEqual(dates["dividend-declaration"], ["2026-02-01", "2025-12-01"]);
  assert.deepEqual(dates["change-of-offices"], ["2026-08-01", "2020-01-01"]);
  assert.deepEqual(packetEventDates("organize-corporation", { roleHolders }), []);
  for (const key of TRANSACTION_SCOPED_PACKETS) assert.ok(CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === key)?.transactionScoped, `${key} is marked transaction-scoped`);
}

// --- 6. Redemption --------------------------------------------------------------
{
  const view = shareRedemptionView(regs, scope("2026-06-01"), { redemptionPlace: "the registered office" });
  const out = render("share-redemption", contextFor(bc, "2026-06-01", view));
  assert.ok(out.text.includes("may be redeemed by the Company at a redemption price of CAD 10.00 per share, together with all dividends declared on them and unpaid (section 77(a) of the Business Corporations Act (British Columbia));"), out.text);
  assert.ok(out.text.includes("(section 79(1) of the Business Corporations Act (British Columbia));"));
  assert.ok(out.text.includes("Finley Park | 4 Class B Non-Voting Preferred shares | CAD 10.00 plus declared and unpaid dividends | CAD 40.00"), out.text);
  assert.ok(out.text.includes("at least 21 days before the redemption date"));
  assert.ok(out.text.includes("June 1, 2026 | the registered office | CAD 10.00 | 21 days before the redemption date"));
  assert.ok(!out.text.includes("pro rata"), "the class permits a non-pro-rata redemption");
  const waived = render("share-redemption", contextFor(bc, "2026-06-01", shareRedemptionView(regs, scope("2026-06-01"), { noticeWaived: true, redemptionPlace: "the registered office" })));
  assert.ok(waived.text.includes("having waived notice of redemption in writing") && !waived.text.includes("at least 21 days"));
  // Read defensively: a class without redemption terms prompts instead of failing.
  const bare = shareRedemptionView({ ...regs, classes: classes.map((c) => ({ ...c, redemption: undefined })) }, scope("2026-06-01"));
  assert.equal(bare.redemption.rows[0].price, "CAD 10.00", "price per share falls back to the ledger payment");
  assert.ok(bare.redemption.minNoticeDays.startsWith("["));
  assert.ok(CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === "share-redemption")!.sourceIds!.includes("BC-BCA-REDEMPTION"));
}

// --- 5. Annual directors' companion -------------------------------------------
{
  const view = officerAppointmentView(roleHolders, scope("2026-06-25"), { allInOffice: true });
  const out = render("annual-directors-resolution", contextFor(bc, "2026-06-25", { ...view, annualDirectors: { year: "2026", hasFinancialPeriod: true, financialPeriodLong: "December 31, 2025", registered: "2 Second St", records: "3 Third St", hasRegistered: true, hasRecords: true } }));
  assert.ok(out.text.includes("2026 DIRECTORS' ANNUAL CONSENT RESOLUTION"), out.text);
  assert.ok(out.text.includes("Avery Stone | President and Secretary") && out.text.includes("Casey Lane | Treasurer"));
  assert.ok(out.text.includes("financial year ended December 31, 2025 be approved"));
}

// --- Execution: numbering drives "resolution(s)"; signers come from the body ----
{
  const ctx = contextFor(bc, "2026-03-15", {});
  const packet = CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === "all-voting-shareholders-resolution")!;
  const rendered = renderInstrument(packet.instrument!, ctx);
  assert.equal(rendered.clauseCount, 1);
  const body = resolvingBodyFor(packet.requiredSigners);
  const signers = bodySigners((ctx as any).votingShareholders.list, body, [{ name: "Jordan Elm", corpSign: "Elm Holdings Ltd.", signOrder: 1 }]);
  assert.deepEqual(signers, [{ name: "Jordan Elm", corpSign: "Elm Holdings Ltd." }, { name: "Avery Stone", capacity: "Voting Shareholder" }]);
  const execution = buildExecutionBlock({ shortName: "the Company", legislation: "Business Corporations Act (British Columbia)", noun: body.noun, resolutionsPlural: rendered.resolutionsPlural, signers, dateLong: "June 25, 2026" });
  assert.equal(execution.adoptionClause, "The undersigned, being all the voting shareholders of the Company, hereby adopt the foregoing resolution pursuant to the provisions of the Business Corporations Act (British Columbia).");
  const blocks: InstrumentBlock[] = withExecution(rendered, { adoptionClause: execution.adoptionClause, dateLong: "June 25, 2026", signers });
  assert.deepEqual(blocks.slice(-3).map((b) => b.kind), ["dated", "adoption", "signatures"]);
}

// --- Every corporate instrument renders cleanly against an empty register -----
{
  const empty = buildSocietyRenderContext(bc, [], "2026-06-25");
  const law = corporateLawContext(bc as any, empty.org.legislation);
  for (const packet of CORPORATION_DOCUMENT_PACKETS.filter((p) => p.instrument)) {
    const blank = { ...empty, law: Object.fromEntries(Object.entries(law).map(([k, v]) => [k, typeof v === "string" ? renderTemplate(v, empty as any) : v])), signing: { officerPhrase: "any director", OfficerPhrase: "Any director" } };
    const ctx = { ...blank, ...directorAppointmentView([], scope("2026-06-25")), ...shareIssuanceView({ transfers: [], classes: [] }, scope("2026-06-25")) };
    const rendered = renderInstrument(packet.instrument!, ctx as any);
    const text = instrumentPlainLines(rendered.blocks).join("\n");
    assert.ok(!text.includes("{"), `${packet.key}: empty-register render leaves no markup:\n${text}`);
    assert.ok(rendered.blocks.some((b) => b.kind === "title"), `${packet.key}: has a title`);
  }
}

// --- Section bodies use the shared block shape (shared/packetBlocks.ts) ---------
{
  for (const packet of CORPORATION_DOCUMENT_PACKETS.filter((p) => p.instrument)) {
    for (const item of packet.sections.flatMap((s) => s.body)) {
      if (typeof item === "string") continue;
      assert.ok(isPacketBlock(item), `${packet.key}: body items are strings or packet blocks`);
    }
  }
  const transferPacket = CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === "share-transfer")!;
  const blocks = transferPacket.sections[0].body.filter(isPacketBlock);
  assert.ok(blocks.some((b) => b.kind === "title" && b.text === "Transfer of Shares"), "subtitle becomes the title block");
  assert.ok(!blocks.some((b) => b.kind === "title" && /CONSENT/.test(b.text)), "the renderer generates the possessive title");
  assert.ok(blocks.some((b) => b.kind === "table" && b.each === "transfer.newCertificates" && b.when === "transfer.hasTransfers"));
  assert.ok(blocks.some((b) => b.kind === "note" && b.when === "!transfer.hasTransfers"), "unless becomes a negated when");
  // Rendered for a transaction: static rows, resolved cross-references, braces escaped.
  const certificateView = shareCertificateView(certificates, scope("2026-07-01"), classes);
  const rendered = renderInstrument(CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === "share-certificate")!.instrument!, contextFor(bc, "2026-07-01", certificateView));
  const statics = renderedPacketBlocks(rendered);
  assert.ok(statics.some((b) => b.kind === "clause" && b.text.includes("cancelled by resolution 2")));
  assert.ok(statics.some((b) => b.kind === "table" && b.rows?.some((row) => row[0] === "A-6")));
  assert.ok(renderedPacketBlocks({ blocks: [{ kind: "paragraph", text: "Use {braces}" }], annex: [] }).some((b) => b.kind === "paragraph" && b.text === "Use {{braces}}"));
  // The plain-text section view (legacy DOCX, previews) binds the blocks.
  const lines = renderSections(transferPacket.sections, contextFor(bc, "2026-05-01", shareTransferView(regs, scope("2026-05-01")))).flatMap((s) => s.body).join("\n");
  assert.ok(lines.includes("A-5 | Avery Stone | 60 Class A Common Shares") && !lines.includes("No share transfer is recorded"), lines);
}

// --- Compliance routing: a BC company never gets the federal ISC packet ----------
{
  assert.equal(corporationPacketKeyForComplianceObligation({ obligationKey: "transparency_register.annual_review", organization: { entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act" } }), "isc-register-update");
  const bcKey = corporationPacketKeyForComplianceObligation({ obligationKey: "transparency_register.annual_review", organization: bc });
  const bcPacketPresent = CORPORATION_DOCUMENT_PACKETS.some((p) => p.key === BC_TRANSPARENCY_PACKET_KEY);
  assert.equal(bcKey, bcPacketPresent ? BC_TRANSPARENCY_PACKET_KEY : undefined);
  assert.equal(corporationPacketKeyForComplianceObligation({ filingKind: "FederalIscUpdate", organization: bc }), "isc-register-update", "an explicit federal ISC filing stays federal");
}

// --- End to end through the portable generator (local runtime) -----------------
{
  const client = new StaticConvexClient({ databaseName: `packet-instruments-${Date.now()}`, seed: { societies: [] } });
  const created = await client.mutation("society:createWorkspace", {
    name: "Harbour Pine Holdings Ltd.", incorporationNumber: "BC0000001", incorporationDate: "2020-01-01", fiscalYearEnd: "12-31",
    jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act", seedDocumentPackets: false,
  });
  const societyId = created.societyId;
  const up = (args: Record<string, unknown>) => client.mutation("legalOperations:upsertRoleHolder", { societyId, status: "current", ...args });
  const director = await up({ roleType: "director", fullName: "Avery Stone", startDate: "2020-01-01" });
  await up({ roleType: "director", fullName: "Blake Rivers", startDate: "2020-01-01", endDate: "2026-03-01", status: "former" });
  const holderA = await up({ roleType: "shareholder", fullName: "Avery Stone", startDate: "2020-01-01" });
  const holderB = await up({ roleType: "shareholder", fullName: "Finley Park", startDate: "2020-01-01" });
  const common = await client.mutation("legalOperations:upsertRightsClass", { societyId, className: "Class A Common", classType: "share", status: "active", votesPerShare: 1 });
  const preferred = await client.mutation("legalOperations:upsertRightsClass", { societyId, className: "Class B Preferred", classType: "share", status: "active", votesPerShare: 0 });
  for (const [holder, cls, quantity, date] of [[holderA, common, 100, "2020-01-01"], [holderB, preferred, 10, "2020-01-01"], [holderB, common, 5, "2026-04-01"]] as const) {
    await client.mutation("legalOperations:upsertRightsholdingTransfer", { societyId, transferType: "issuance", status: "posted", transferDate: date, rightsClassId: cls, destinationRoleHolderId: holder, quantity, considerationType: "cash", fullyPaidConfirmedAt: date, priceToOrganizationCents: quantity * 100, priceToOrganizationCurrency: "cad" });
  }
  void director;
  const engine = await client.query("legalOperations:templateEngine", { societyId });
  assert.deepEqual(engine.packetEventDates["issue-shares"], ["2026-04-01", "2020-01-01"]);
  assert.deepEqual(engine.packetEventDates["director-removal"], ["2026-03-01"]);

  const docText = async (packetKey: string, effectiveDate: string) => {
    const result = await client.mutation("legalOperations:generateDocumentFromCatalog", { societyId, packetKey, effectiveDate });
    const doc = await client.query("documents:get", { id: result.draftDocumentId });
    const xml = Buffer.from(doc.url.split(",")[1], "base64").toString("utf8");
    // Visible text with table cells separated by spaces, as a reader sees it.
    const text = xml.replace(/<[^>]+>/g, " ").replace(/&apos;/g, "'").replace(/\s+/g, " ");
    return { result, xml, text };
  };
  const issue = await docText("issue-shares", "2026-04-01");
  assert.ok(issue.text.includes("Finley Park 5 Class A Common Shares"), "the 2026-04-01 subscription only");
  assert.ok(!issue.text.includes("Avery Stone 100"), "earlier issuances are not listed");
  assert.ok(issue.text.includes("The foregoing resolutions are consented to in writing by the sole director of Harbour Pine Holdings Ltd."));
  const removal = await docText("director-removal", "2026-03-01");
  assert.ok(removal.text.includes("Blake Rivers") && removal.text.includes("AS A SPECIAL RESOLUTION"));
  assert.ok(removal.text.includes("consented to in writing by the sole voting shareholder of Harbour Pine Holdings Ltd."), "only the voting shareholder adopts the removal");
  assert.ok(removal.text.includes("Avery Stone, Voting Shareholder") && !removal.text.includes("Finley Park, Voting Shareholder"));
  const removalDoc = (await client.query("legalOperations:templateEngine", { societyId })).generatedDocuments.find((d: any) => d._id === removal.result.generatedDocumentId);
  assert.deepEqual(removalDoc.signersRequiredRoleHolderIds, [holderA], "signer placeholders are the voting shareholders");
  const shell = await docText("all-shareholders-resolution", "2026-06-25");
  assert.ok(shell.xml.includes("being all the shareholders of Harbour Pine Holdings Ltd., hereby sign"), "shareholder shell grammar");
  // A consent to act is signed by the director who consents, not the whole board.
  const entering = await up({ roleType: "director", fullName: "Jordan Pike", startDate: "2026-07-01" });
  const signersFor = async (effectiveDate: string) => {
    const generated = await client.mutation("legalOperations:generateDocumentFromCatalog", { societyId, packetKey: "director-consent-to-act", effectiveDate });
    const row = (await client.query("legalOperations:templateEngine", { societyId })).generatedDocuments.find((d: any) => d._id === generated.generatedDocumentId);
    return row.signersRequiredRoleHolderIds;
  };
  assert.deepEqual(await signersFor("2026-07-01"), [entering], "only the entering director signs the consent");
  assert.deepEqual(await signersFor("2026-08-01"), [], "no entering director: left for the user to choose, never every director");
}

console.log("OK packet-instruments");
