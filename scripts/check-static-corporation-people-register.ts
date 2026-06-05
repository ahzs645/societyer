import assert from "node:assert/strict";

import { StaticConvexClient } from "../src/lib/staticConvex";

const client = new StaticConvexClient({
  databaseName: `societyer-static-corp-people-${Date.now()}`,
  seed: { societies: [] },
});

const created = await client.mutation("society:createWorkspace", {
  name: "Northstar People Register Inc.",
  incorporationNumber: "765432-1",
  incorporationDate: "2025-03-20",
  fiscalYearEnd: "12-31",
  jurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act",
});

const directorId = await client.mutation("legalOperations:upsertRoleHolder", {
  societyId: created.societyId,
  roleType: "director",
  status: "current",
  fullName: "Mina Director",
  ageOver18: true,
  directorTerm: "none_specified",
});
const officerId = await client.mutation("legalOperations:upsertRoleHolder", {
  societyId: created.societyId,
  roleType: "officer",
  status: "current",
  fullName: "Owen Officer",
  officerTitle: "president",
});
const shareholderId = await client.mutation("legalOperations:upsertRoleHolder", {
  societyId: created.societyId,
  roleType: "shareholder",
  status: "current",
  fullName: "Sasha Shareholder",
  membershipClassName: "Common shares",
});
const controllerId = await client.mutation("legalOperations:upsertRoleHolder", {
  societyId: created.societyId,
  roleType: "controller",
  status: "current",
  fullName: "Casey Controller",
  natureOfControl: "Owns or controls voting shares.",
});

const people = await client.query("legalOperations:listRoleHolders", { societyId: created.societyId });
assert.deepEqual(
  people.map((row: any) => row.roleType).sort(),
  ["controller", "director", "officer", "shareholder"],
);
assert.ok(people.find((row: any) => row._id === directorId));
assert.ok(people.find((row: any) => row._id === officerId));
assert.ok(people.find((row: any) => row._id === shareholderId));
assert.ok(people.find((row: any) => row._id === controllerId));

const commonSharesId = await client.mutation("legalOperations:upsertRightsClass", {
  societyId: created.societyId,
  className: "Common shares",
  classType: "share",
  status: "active",
  votingRights: "One vote per share.",
});
const issuanceId = await client.mutation("legalOperations:upsertRightsholdingTransfer", {
  societyId: created.societyId,
  transferType: "issuance",
  status: "posted",
  transferDate: "2025-03-21",
  rightsClassId: commonSharesId,
  destinationRoleHolderId: shareholderId,
  quantity: 100,
  considerationType: "cash",
  priceToOrganizationCents: 100,
  priceToOrganizationCurrency: "cad",
});

const ledger = await client.query("legalOperations:rightsLedger", { societyId: created.societyId });
assert.equal(ledger.classes.length, 1);
assert.equal(ledger.classes[0].classType, "share");
assert.equal(ledger.transfers.length, 1);
assert.equal(ledger.transfers[0]._id, issuanceId);
assert.equal(ledger.transfers[0].destinationRoleHolderId, shareholderId);
assert.equal(ledger.roleHolders.length, 4);

console.log("Static corporation people register checks passed.");
