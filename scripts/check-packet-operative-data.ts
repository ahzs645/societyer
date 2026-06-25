import assert from "node:assert/strict";

import { renderTemplate } from "../shared/templateAssembly";
import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";
import {
  assetTransferView,
  directorAppointmentView,
  directorRemovalView,
  formatAddress,
  officeChangeView,
  officerAppointmentView,
  shareCertificateView,
  shareTransferView,
} from "../shared/packetOperativeData";

// --- builders ---------------------------------------------------------------

{
  const v = officerAppointmentView([
    { roleType: "officer", fullName: "Jane Doe", officerTitle: "President" },
    { roleType: "officer", fullName: "Sam Lee", officerTitle: "Secretary", endDate: "2024-01-01" }, // former, excluded
    { roleType: "director", fullName: "Not an officer" },
  ]);
  assert.equal(v.appointment.hasOfficers, true);
  assert.equal(v.appointment.officers.length, 1);
  assert.deepEqual(v.appointment.officers[0], { name: "Jane Doe", title: "President" });
}

{
  const v = directorAppointmentView([{ roleType: "director", fullName: "Dee Rector", directorTerm: "three_years" }]);
  assert.equal(v.appointment.hasDirectors, true);
  assert.equal(v.appointment.directors[0].name, "Dee Rector");
}

{
  const v = directorRemovalView([
    { roleType: "director", fullName: "Gone Director", status: "former", endDate: "2024-05-01" },
    { roleType: "director", fullName: "Current Director" },
  ]);
  assert.equal(v.removal.hasRemovals, true);
  assert.equal(v.removal.removals.length, 1);
  assert.equal(v.removal.removals[0].name, "Gone Director");
}

{
  const v = shareTransferView(
    [
      { transferType: "transfer", status: "posted", rightsClassId: "c1", sourceHolderName: "Alice", destinationHolderName: "Bob", quantity: 10, transferDate: "2024-02-02" },
      { transferType: "issuance", status: "posted", rightsClassId: "c1", quantity: 5 }, // not a transfer
    ],
    { c1: "Common" },
  );
  assert.equal(v.transfer.hasTransfers, true);
  assert.equal(v.transfer.transfers.length, 1);
  assert.deepEqual(v.transfer.transfers[0], { date: "2024-02-02", className: "Common", from: "Alice", to: "Bob", quantity: 10 });
}

{
  const v = shareCertificateView([
    { certificateNumber: "1A", holderName: "Alice", shareClass: "Common", shares: 10, issuedOn: "2024-01-01" },
    { certificateNumber: "0X", holderName: "Old", shareClass: "Common", shares: 1, issuedOn: "2020-01-01", cancelledOn: "2024-01-01" }, // cancelled, excluded
  ]);
  assert.equal(v.certificate.certificates.length, 1);
  assert.equal(v.certificate.certificates[0].number, "1A");
}

{
  assert.equal(
    formatAddress({ street: "123 Main St", city: "Vancouver", provinceState: "BC", postalCode: "V6S 1K5", country: "Canada" }),
    "123 Main St, Vancouver, BC V6S 1K5, Canada",
  );
  const v = officeChangeView([
    { type: "registered_office", status: "current", street: "1 New Rd", city: "Town", effectiveFrom: "2024-01-01" },
    { type: "registered_office", status: "past", street: "9 Old Rd", city: "Town", effectiveFrom: "2020-01-01" },
    { type: "records_office", status: "current", street: "2 Files Ave", city: "Town" },
  ]);
  assert.equal(v.offices.hasRegistered, true);
  assert.equal(v.offices.hasPriorRegistered, true);
  assert.ok(v.offices.registered.includes("1 New Rd"));
  assert.ok(v.offices.priorRegistered.includes("9 Old Rd"));
}

{
  const v = assetTransferView([
    { name: "Tesla", category: "Equipment", status: "in_service", purchaseValueCents: 5250000, currency: "US$", supplier: "T. Nikola", purchaseDate: "2019-03-31" },
    { name: "Old Server", category: "Equipment", status: "disposed", notes: "Recycled 2023" },
  ]);
  assert.equal(v.assetTransfer.hasAcquisitions, true);
  assert.equal(v.assetTransfer.acquisitions[0].value, "US$ 52,500.00");
  assert.equal(v.assetTransfer.hasDispositions, true);
}

// --- rendered packet bodies bind the operative data -------------------------

function renderPacket(key: string, ctx: Record<string, unknown>): string {
  const packet = CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === key)!;
  const base = {
    org: { shortName: "Acme Inc.", legislation: "Business Corporations Act" },
    dir: { isSole: false, isMultiple: true, plural: "s", verbS: "" },
    date: { long: "June 25, 2026" },
  };
  return packet.sections.flatMap((s) => s.body).map((line) => renderTemplate(line, { ...base, ...ctx })).join("\n");
}

{
  const out = renderPacket("appoint-officer", officerAppointmentView([{ roleType: "officer", fullName: "Jane Doe", officerTitle: "President" }]));
  assert.ok(out.includes("Jane Doe as President"), `officer packet bound: ${out}`);
}
{
  const out = renderPacket("share-transfer", shareTransferView([{ transferType: "transfer", status: "posted", rightsClassId: "c1", sourceHolderName: "Alice", destinationHolderName: "Bob", quantity: 10, transferDate: "2024-02-02" }], { c1: "Common" }));
  assert.ok(out.includes("10 Common share(s) from Alice to Bob"), `transfer packet bound: ${out}`);
}
{
  const out = renderPacket("change-of-offices", officeChangeView([
    { type: "registered_office", status: "current", street: "1 New Rd", city: "Town" },
    { type: "registered_office", status: "past", street: "9 Old Rd", city: "Town" },
  ]));
  assert.ok(out.includes("changed from 9 Old Rd") && out.includes("1 New Rd"), `office packet bound: ${out}`);
}
{
  const out = renderPacket("asset-transfer", assetTransferView([{ name: "Tesla", category: "Equipment", status: "in_service", purchaseValueCents: 5250000, currency: "US$", supplier: "T. Nikola" }]));
  assert.ok(out.includes("Tesla (Equipment)") && out.includes("US$ 52,500.00"), `asset packet bound: ${out}`);
}
// Empty context falls back to the generic prose (no crash, no leftover markup).
{
  const out = renderPacket("share-transfer", shareTransferView([], {}));
  assert.ok(out.includes("transferor to the transferee"), `transfer fallback: ${out}`);
  assert.ok(!out.includes("{#"), "no leftover block markup");
}

console.log("OK packet-operative-data");
