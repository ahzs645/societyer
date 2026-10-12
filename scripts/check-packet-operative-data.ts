import assert from "node:assert/strict";

import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";
import {
  corporationPacketDocumentId,
  corporationPacketDocxFileName,
} from "../shared/corporationPacketDocx";
import { instrumentPlainLines, renderInstrument } from "../shared/packetInstrument";
import {
  assetTransferView,
  directorAppointmentView,
  directorDepartureView,
  formatAddress,
  formatCount,
  formatMoneyCents,
  officeChangeView,
  officerAppointmentView,
  shareCertificateView,
  shareTransferView,
} from "../shared/packetOperativeData";

/**
 * Operative views read only the transaction effective on the document date
 * (YCN `Main!P5`), or the selected transaction ids — never the whole register.
 */
const on = (asOf: string, ids?: string[]) => ({ asOf, ids });

// --- builders -----------------------------------------------------------------
{
  const rows = [
    { _id: "o1", roleType: "officer", fullName: "Jane Doe", officerTitle: "President", startDate: "2026-06-25" },
    { _id: "o2", roleType: "officer", fullName: "Sam Lee", officerTitle: "Secretary", startDate: "2020-01-01", endDate: "2024-01-01" },
    { _id: "o3", roleType: "officer", fullName: "Old Hand", officerTitle: "Treasurer", startDate: "2019-01-01" },
    { _id: "x", roleType: "director", fullName: "Not an officer", startDate: "2026-06-25" },
  ];
  const v = officerAppointmentView(rows, on("2026-06-25"));
  assert.deepEqual(v.appointment.officers, [{ name: "Jane Doe", title: "President" }], "only the appointment of the date");
  assert.deepEqual(officerAppointmentView(rows, on("2026-06-25", ["o3"])).appointment.officers, [{ name: "Old Hand", title: "Treasurer" }], "selected ids win");
  // Legacy call without a scope: officers currently in office.
  assert.deepEqual(officerAppointmentView(rows).appointment.officers.map((o) => o.name), ["Jane Doe", "Old Hand"]);
}

{
  const rows = [
    { roleType: "director", fullName: "Dee Rector", directorTerm: "three_years", startDate: "2026-06-25" },
    { roleType: "director", fullName: "Long Standing", startDate: "2015-01-01" },
    { roleType: "director", fullName: "Gone Director", status: "former", startDate: "2015-01-01", endDate: "2024-05-01" },
  ];
  const appointed = directorAppointmentView(rows, on("2026-06-25"));
  assert.deepEqual(appointed.appointment.directors.map((d) => d.name), ["Dee Rector"]);
  assert.equal(appointed.appointment.asDirector, "a director");
  const departed = directorDepartureView(rows, on("2024-05-01"));
  assert.deepEqual(departed.removal.removals.map((d) => d.name), ["Gone Director"]);
  assert.equal(departed.removal.removals[0].endDateLong, "May 1, 2024");
  assert.equal(directorDepartureView(rows, on("2026-06-25")).removal.hasRemovals, false, "no departure that day");
}

{
  const classes = [{ _id: "c1", className: "Common" }];
  const transfers = [
    { _id: "t1", transferType: "issuance", status: "posted", rightsClassId: "c1", destinationHolderName: "Alice", quantity: 30, transferDate: "2024-01-01" },
    { _id: "t2", transferType: "transfer", status: "posted", rightsClassId: "c1", sourceHolderName: "Alice", destinationHolderName: "Bob", quantity: 10, transferDate: "2024-02-02" },
    { _id: "t3", transferType: "transfer", status: "posted", rightsClassId: "c1", sourceHolderName: "Alice", destinationHolderName: "Cara", quantity: 5, transferDate: "2025-03-03" },
  ];
  const v = shareTransferView({ transfers, classes, certificates: [] }, on("2024-02-02"));
  assert.equal(v.transfer.transfers.length, 1, "only the transfer of the date");
  assert.deepEqual(v.transfer.transfers[0], { to: "Bob", from: "Alice", quantity: 10, quantityLabel: "10", className: "Common", sharesLabel: "10 Common Shares", date: "2024-02-02" });
  assert.ok(v.transfer.newCertificates.some((c) => c.isBalance && c.holder === "Alice" && c.sharesLabel === "20 Common Shares"), "balance certificate to the transferor");
}

{
  const certs = [
    { certificateNumber: "1A", holderName: "Alice", shareClass: "Common", shares: 10, issuedOn: "2024-01-01", cancelledOn: "2025-01-01" },
    { certificateNumber: "2A", holderName: "Alice", shareClass: "Common", shares: 10, issuedOn: "2025-01-01", replacesCertificateNumber: "1A" },
    { certificateNumber: "0X", holderName: "Old", shareClass: "Common", shares: 1, issuedOn: "2020-01-01" },
  ];
  const v = shareCertificateView(certs, on("2025-01-01"));
  assert.deepEqual(v.certificate.certificates.map((c) => c.number), ["2A"]);
  assert.deepEqual(v.certificate.cancelled.map((c) => c.number), ["1A"]);
  assert.equal(v.certificate.certificates[0].sharesLabel, "10 Common Shares");
}

{
  assert.equal(
    formatAddress({ street: "123 Main St", city: "Vancouver", provinceState: "BC", postalCode: "V6S 1K5", country: "Canada" }),
    "123 Main St, Vancouver, BC V6S 1K5, Canada",
  );
  const dated = [
    { type: "registered_office", status: "past", street: "9 Old Rd", city: "Town", effectiveFrom: "2020-01-01", effectiveTo: "2024-01-01" },
    { type: "registered_office", status: "current", street: "1 New Rd", city: "Town", effectiveFrom: "2024-01-01" },
  ];
  const v = officeChangeView(dated, on("2024-01-01"));
  assert.equal(v.offices.registeredChanged, true);
  assert.ok(v.offices.priorRegistered.includes("9 Old Rd") && v.offices.registered.includes("1 New Rd"));
  assert.equal(officeChangeView(dated, on("2020-01-01")).offices.registeredInitial, true, "first address: initially at");
  assert.equal(officeChangeView(dated, on("2022-06-01")).offices.hasChanges, false);
  // Legacy undated rows: current versus past, flagged for date confirmation.
  const legacy = officeChangeView([
    { type: "registered_office", status: "current", street: "1 New Rd", city: "Town" },
    { type: "registered_office", status: "past", street: "9 Old Rd", city: "Town" },
  ], on("2026-06-25"));
  assert.equal(legacy.offices.registeredChanged, true);
  assert.equal(legacy.offices.undated, true);
}

{
  const v = assetTransferView([
    { name: "Tesla", category: "Equipment", status: "in_service", serialNumber: "VIN-1", purchaseValueCents: 5250000, currency: "US$", supplier: "T. Nikola", purchaseDate: "2019-03-31" },
    { name: "Old Server", category: "Equipment", status: "disposed", disposedAt: "2023-01-01", notes: "Recycled 2023" },
  ], on("2019-03-31"));
  assert.equal(v.assetTransfer.hasAcquisitions, true);
  assert.equal(v.assetTransfer.acquisitions[0].value, "US$52,500.00");
  assert.equal(v.assetTransfer.acquisitions[0].identifierText, "serial number VIN-1");
  assert.equal(v.assetTransfer.hasDispositions, false, "the 2023 disposal is another transaction");
  assert.equal(v.assetTransfer.isSingle, true);
}

assert.equal(formatMoneyCents(125000, "cad"), "CAD 1,250.00");
assert.equal(formatMoneyCents(50, "C$"), "C$0.50");

// --- rendered packet instruments bind the operative data ------------------------
function renderPacket(key: string, ctx: Record<string, unknown>): string {
  const packet = CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === key)!;
  const base = {
    org: { shortName: "Acme Inc.", ShortName: "Acme Inc.", definedTermIntro: "Acme Inc.", legislation: "Business Corporations Act", hasSeal: false },
    dir: { isSole: false, isMultiple: true, plural: "s", nounS: "s", possessive: "s'", verbS: "", count: 2 },
    law: { securitiesRegister: "securities register", officeChangeTask: "[File the notice of change.]" },
    signing: { officerPhrase: "the President", OfficerPhrase: "The President" },
    date: { long: "June 25, 2026" },
  };
  return instrumentPlainLines(renderInstrument(packet.instrument!, { ...base, ...ctx }).blocks).join("\n");
}

{
  const out = renderPacket("appoint-officer", officerAppointmentView([{ roleType: "officer", fullName: "Jane Doe", officerTitle: "President", startDate: "2026-06-25" }], on("2026-06-25")));
  assert.ok(out.includes("Jane Doe | President"), `officer packet bound: ${out}`);
}
{
  const out = renderPacket("share-transfer", shareTransferView({ transfers: [{ transferType: "transfer", status: "posted", rightsClassId: "c1", sourceHolderName: "Alice", destinationHolderName: "Bob", quantity: 10, transferDate: "2024-02-02" }], classes: [{ _id: "c1", className: "Common" }] }, on("2024-02-02")));
  assert.ok(out.includes("Alice | Bob | 10 Common Shares"), `transfer packet bound: ${out}`);
  assert.ok(!out.includes("share(s)"));
}
{
  const out = renderPacket("change-of-offices", officeChangeView([
    { type: "registered_office", status: "current", street: "1 New Rd", city: "Town", effectiveFrom: "2026-06-25" },
    { type: "registered_office", status: "past", street: "9 Old Rd", city: "Town", effectiveFrom: "2020-01-01", effectiveTo: "2026-06-25" },
  ], on("2026-06-25")));
  assert.ok(out.includes("be changed from: 9 Old Rd, Town to: 1 New Rd, Town."), `office packet bound: ${out}`);
}
{
  const out = renderPacket("asset-transfer", assetTransferView([{ name: "Tesla", category: "Equipment", status: "in_service", purchaseValueCents: 5250000, currency: "US$", supplier: "T. Nikola", purchaseDate: "2026-06-25" }], on("2026-06-25")));
  assert.ok(out.includes("Acme Inc. acquire the equipment asset identified as Tesla from T. Nikola for the purchase price of US$52,500.00."), `asset packet bound: ${out}`);
}
// Empty context falls back to a bracketed prompt (no crash, no leftover markup).
{
  const out = renderPacket("share-transfer", shareTransferView({ transfers: [], classes: [] }, on("2026-06-25")));
  assert.ok(out.includes("[transferor] to [transferee]") && out.includes("No share transfer is recorded on June 25, 2026"), `transfer fallback: ${out}`);
  assert.ok(!out.includes("{"), "no leftover block markup");
}

// --- thousands separators + deterministic file naming / doc id ---------------

assert.equal(formatCount(1234567), "1,234,567");
assert.equal(formatCount(undefined), "");

const splitPacket = CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === "share-split")!;
assert.equal(
  corporationPacketDocxFileName(splitPacket, { shortName: "Acme Inc.", effectiveDate: "2026-06-25" }),
  "acme-inc-share-split-2026-06-25.docx",
);
assert.equal(
  corporationPacketDocxFileName(splitPacket, { shortName: "Acme Inc." }),
  "acme-inc-share-split-NODATE.docx",
  "missing date -> NODATE",
);
// No shortName falls back to the legacy packageName slug.
assert.ok(corporationPacketDocxFileName(splitPacket).endsWith(".docx"));
assert.ok(!corporationPacketDocxFileName(splitPacket).startsWith("acme"));
assert.equal(
  corporationPacketDocumentId(splitPacket, { shortName: "Acme Inc.", effectiveDate: "2026-06-25" }),
  "acme-inc-share-split-2026-06-25",
);

console.log("OK packet-operative-data");
